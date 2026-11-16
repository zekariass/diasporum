-- =============================================================================
-- DIASPORUM v10.15 SCHEMA DELTA
-- Additive changes to the v10.14 baseline. Not a clean-install script.
-- Apply as a versioned Flyway migration against a v10.14 database.
-- This file has been statically authored and NOT executed against PostgreSQL.
-- Validate in a disposable PostgreSQL 15+ / PostGIS database before use.
--
-- IDEMPOTENCY: CREATE TABLE / CREATE INDEX use IF NOT EXISTS where safe.
-- ALTER TABLE ADD COLUMN already uses IF NOT EXISTS. ALTER TABLE ADD CONSTRAINT
-- cannot use IF NOT EXISTS (pre-PG 17); the enclosing BEGIN/COMMIT transaction
-- ensures a failed run rolls back cleanly so you can fix and re-run.
-- DO NOT run this file twice without fixing errors first.
-- =============================================================================
BEGIN;

-- =====================================================================
-- 0. ENUM EXTENSIONS
-- =====================================================================

-- Extend visibility_scope for matchmaking granularity
-- (matchmaking uses TEXT CHECK instead of enum; no ALTER needed)

-- Extend content_reference_type for new ad/featured targets
ALTER TYPE content_reference_type ADD VALUE IF NOT EXISTS 'SERVICE' AFTER 'SPARE_BAG_LISTING';

-- Extend notification_type for ticketing, ads, moderation
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'EVENT_TICKET_PURCHASED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'EVENT_TICKET_CHECKED_IN';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'EVENT_PAYOUT';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'AD_CAMPAIGN_STATUS';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'AD_CAMPAIGN_REVIEW';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'MODERATION_APPEAL';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'TRANSLATION_READY';

-- Extend report_target_type for new content
ALTER TYPE report_target_type ADD VALUE IF NOT EXISTS 'AD_CAMPAIGN';
ALTER TYPE report_target_type ADD VALUE IF NOT EXISTS 'AD_CREATIVE';
ALTER TYPE report_target_type ADD VALUE IF NOT EXISTS 'SPARE_BAG_SENDER_REQUEST';
ALTER TYPE report_target_type ADD VALUE IF NOT EXISTS 'SPARE_BAG_TRAVELLER_JOURNEY';

-- Extend moderation_action_type
ALTER TYPE moderation_action_type ADD VALUE IF NOT EXISTS 'QUARANTINE_CONTENT';
ALTER TYPE moderation_action_type ADD VALUE IF NOT EXISTS 'RESTRICT_ACCOUNT';

-- Extend media_objects purpose for new modules
-- (purpose is a TEXT CHECK, not an enum — handled by ALTER TABLE below)


-- =====================================================================
-- 1. COMMUNITY MODEL CHANGES
-- =====================================================================

-- 1a. Add membership_type to community_memberships
ALTER TABLE community_memberships
    ADD COLUMN IF NOT EXISTS membership_type text NOT NULL DEFAULT 'SECONDARY'
        CHECK(membership_type IN ('PRIMARY','SECONDARY'));

-- Backfill: mark each user's membership as PRIMARY when it matches
-- their origin country + current country (from profiles).
UPDATE community_memberships cm
SET membership_type = 'PRIMARY'
FROM profiles p, communities c
WHERE cm.user_id = p.user_id
  AND cm.community_id = c.id
  AND cm.membership_type = 'SECONDARY'
  AND c.origin_country_id = p.origin_country_id
  AND c.destination_country_id = p.current_country_id
  AND c.is_active = true;

-- Enforce exactly one PRIMARY membership per user (active only).
-- membership_status enum includes 'LEFT' — a user who left their primary
-- community can still acquire a new primary membership.
CREATE UNIQUE INDEX IF NOT EXISTS ux_community_membership_primary
    ON community_memberships(user_id)
    WHERE membership_type = 'PRIMARY'
      AND status = 'ACTIVE'::membership_status
      AND left_at IS NULL;

-- 1b. Replace the origin-only membership trigger with a broader one.
-- The old trigger blocks different-origin community joins. The new trigger:
--   * Validates PRIMARY membership matches user origin+current country
--   * Allows SECONDARY joins to any active community (entitlement checked in app)
CREATE OR REPLACE FUNCTION validate_membership_v10_15()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_user_origin uuid;
    v_user_current uuid;
    v_community_origin uuid;
    v_community_destination uuid;
    v_community_active boolean;
BEGIN
    SELECT origin_country_id, current_country_id
      INTO v_user_origin, v_user_current
      FROM profiles WHERE id = NEW.user_id;

    SELECT origin_country_id, destination_country_id, is_active
      INTO v_community_origin, v_community_destination, v_community_active
      FROM communities WHERE id = NEW.community_id;

    IF v_user_origin IS NULL THEN
        RAISE EXCEPTION 'User must have a completed profile to join a community' USING ERRCODE = '23514';
    END IF;
    IF NOT COALESCE(v_community_active, false) THEN
        RAISE EXCEPTION 'Community must be active' USING ERRCODE = '23514';
    END IF;

    -- PRIMARY membership must match user origin + current country
    IF NEW.membership_type = 'PRIMARY' THEN
        IF v_community_origin <> v_user_origin OR v_community_destination <> v_user_current THEN
            RAISE EXCEPTION 'Primary community must match user origin and current country'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- SECONDARY membership: any active community is allowed (entitlement checked by app)
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_membership_origin_country ON community_memberships;
-- Drop the orphaned function (was only called by the dropped trigger)
DROP FUNCTION IF EXISTS validate_membership_origin();
CREATE TRIGGER trg_membership_v10_15
    BEFORE INSERT OR UPDATE OF user_id, community_id, membership_type
    ON community_memberships
    FOR EACH ROW EXECUTE FUNCTION validate_membership_v10_15();


-- =====================================================================
-- 2. FEED POST MULTI-COMMUNITY TARGETING & STATISTICS
-- =====================================================================

-- 2a. Add target_mode to feed_posts
ALTER TABLE feed_posts
    ADD COLUMN IF NOT EXISTS target_mode text NOT NULL DEFAULT 'SINGLE_COMMUNITY'
        CHECK(target_mode IN ('SINGLE_COMMUNITY','SELECTED_COMMUNITIES',
            'ALL_SAME_ORIGIN','ALL_SAME_CURRENT_COUNTRY'));

-- 2b. Add CTA (call-to-action) fields to feed_posts
ALTER TABLE feed_posts
    ADD COLUMN IF NOT EXISTS cta_label varchar(60) NULL,
    ADD COLUMN IF NOT EXISTS cta_url text NULL;
-- Constraint: cta_url must be http(s) if provided
ALTER TABLE feed_posts
    ADD CONSTRAINT ck_feed_posts_cta_url
        CHECK(cta_url IS NULL OR cta_url ~* '^https?://');

-- 2c. Feed post community statistics (impressions per community per day)
CREATE TABLE feed_post_community_stats (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id uuid NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
    community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    metric_date date NOT NULL,
    impressions_count bigint NOT NULL DEFAULT 0 CHECK(impressions_count >= 0),
    unique_viewers_count bigint NOT NULL DEFAULT 0 CHECK(unique_viewers_count >= 0),
    likes_count bigint NOT NULL DEFAULT 0 CHECK(likes_count >= 0),
    comments_count bigint NOT NULL DEFAULT 0 CHECK(comments_count >= 0),
    shares_count bigint NOT NULL DEFAULT 0 CHECK(shares_count >= 0),
    saves_count bigint NOT NULL DEFAULT 0 CHECK(saves_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(post_id, community_id, metric_date)
);
CREATE INDEX ix_feed_post_stats_post_date ON feed_post_community_stats(post_id, metric_date DESC);
CREATE INDEX ix_feed_post_stats_community_date ON feed_post_community_stats(community_id, metric_date DESC);


-- =====================================================================
-- 3. BILLING FEATURES FOR CROSS-COMMUNITY ACCESS
-- =====================================================================

-- 3a. Same-origin community billing features
INSERT INTO billing_features(feature_key, display_name, description, feature_kind, reset_period) VALUES
 ('JOIN_SAME_ORIGIN_COMMUNITY','Join same-origin community','Allows users to join additional communities associated with the same country of origin as their own','BOOLEAN',NULL),
 ('VIEW_SAME_ORIGIN_COMMUNITY_CONTENT','View same-origin content','Allows users to view posts and other content in same-origin communities','BOOLEAN',NULL),
 ('LIKE_ON_SAME_ORIGIN_COMMUNITY','Like in same-origin community','Allows users to like posts in same-origin communities','QUOTA','MONTH'),
 ('COMMENT_ON_SAME_ORIGIN_COMMUNITY','Comment in same-origin community','Allows users to comment on posts in same-origin communities','QUOTA','MONTH'),
 ('SAVE_ON_SAME_ORIGIN_COMMUNITY','Save from same-origin community','Allows users to save posts from same-origin communities','BOOLEAN',NULL),
 ('SHARE_FROM_SAME_ORIGIN_COMMUNITY','Share from same-origin community','Allows users to share posts originating from same-origin communities','BOOLEAN',NULL),
 ('POST_IN_SAME_ORIGIN_COMMUNITY','Post in same-origin community','Allows users to post in the feed of communities that have same origin','QUOTA','MONTH'),
 ('TARGET_ALL_SAME_ORIGIN_COMMUNITIES','Target all same-origin communities','Allows user to create posts for all same origin communities','BOOLEAN',NULL),
 ('VIEW_ALL_SAME_ORIGIN_COMMUNITIES_CONTENT','View all same-origin feeds','Allows users to view feeds from all same origin communities','BOOLEAN',NULL)
ON CONFLICT(feature_key) DO NOTHING;

-- 3b. Different-origin community billing features
INSERT INTO billing_features(feature_key, display_name, description, feature_kind, reset_period) VALUES
 ('JOIN_DIFF_ORIGIN_COMMUNITY','Join different-origin community','Allows users to join communities associated with a different country of origin from their own','BOOLEAN',NULL),
 ('VIEW_DIFF_ORIGIN_COMMUNITY_CONTENT','View different-origin content','Allows users to view posts and other content in different-origin communities','BOOLEAN',NULL),
 ('LIKE_ON_DIFF_ORIGIN_COMMUNITY','Like in different-origin community','Allows users to like posts in different-origin communities','QUOTA','MONTH'),
 ('COMMENT_ON_DIFF_ORIGIN_COMMUNITY','Comment in different-origin community','Allows users to comment on posts in different-origin communities','QUOTA','MONTH'),
 ('SAVE_ON_DIFF_ORIGIN_COMMUNITY','Save from different-origin community','Allows users to save posts from different-origin communities','BOOLEAN',NULL),
 ('SHARE_FROM_DIFF_ORIGIN_COMMUNITY','Share from different-origin community','Allows users to share posts originating from different-origin communities','BOOLEAN',NULL),
 ('POST_IN_DIFF_ORIGIN_COMMUNITY','Post in different-origin community','Allows users to post in the feed of communities that have different origin','QUOTA','MONTH'),
 ('TARGET_ALL_DIFF_ORIGIN_COMMUNITIES','Target all different-origin communities','Allows user to create posts for all different origin communities','BOOLEAN',NULL)
ON CONFLICT(feature_key) DO NOTHING;

-- 3c. Seed disabled entitlement placeholders for all plans
INSERT INTO billing_plan_entitlements(plan_id, feature_id, enabled, quantity_limit, reset_period, config)
SELECT p.id, f.id, false, NULL, NULL,
       jsonb_build_object('requires_admin_configuration', true,
           'note', 'Configure cross-community entitlements before enabling.')
FROM billing_plans p
CROSS JOIN billing_features f
WHERE f.feature_key IN (
    'JOIN_SAME_ORIGIN_COMMUNITY','VIEW_SAME_ORIGIN_COMMUNITY_CONTENT',
    'LIKE_ON_SAME_ORIGIN_COMMUNITY','COMMENT_ON_SAME_ORIGIN_COMMUNITY',
    'SAVE_ON_SAME_ORIGIN_COMMUNITY','SHARE_FROM_SAME_ORIGIN_COMMUNITY',
    'POST_IN_SAME_ORIGIN_COMMUNITY','TARGET_ALL_SAME_ORIGIN_COMMUNITIES',
    'VIEW_ALL_SAME_ORIGIN_COMMUNITIES_CONTENT',
    'JOIN_DIFF_ORIGIN_COMMUNITY','VIEW_DIFF_ORIGIN_COMMUNITY_CONTENT',
    'LIKE_ON_DIFF_ORIGIN_COMMUNITY','COMMENT_ON_DIFF_ORIGIN_COMMUNITY',
    'SAVE_ON_DIFF_ORIGIN_COMMUNITY','SHARE_FROM_DIFF_ORIGIN_COMMUNITY',
    'POST_IN_DIFF_ORIGIN_COMMUNITY','TARGET_ALL_DIFF_ORIGIN_COMMUNITIES'
)
ON CONFLICT(plan_id, feature_id) DO NOTHING;

-- 3d. Ad creation billing feature (both individual and business)
INSERT INTO billing_features(feature_key, display_name, description, feature_kind, reset_period) VALUES
 ('AD_CAMPAIGN_CREATE','Create ad campaign','Allows users or businesses to create advertising campaigns','QUOTA','MONTH')
ON CONFLICT(feature_key) DO NOTHING;

INSERT INTO billing_plan_entitlements(plan_id, feature_id, enabled, quantity_limit, reset_period, config)
SELECT p.id, f.id, false, NULL, NULL,
       jsonb_build_object('requires_admin_configuration', true,
           'note', 'Configure ad campaign creation limits before enabling.')
FROM billing_plans p
CROSS JOIN billing_features f
WHERE f.feature_key = 'AD_CAMPAIGN_CREATE'
ON CONFLICT(plan_id, feature_id) DO NOTHING;


-- =====================================================================
-- 4. ADVERTISING MODULE (COMPLETE, SEPARATE FROM POSTS)
-- =====================================================================

-- 4a. Standard CTA (call-to-action) codes — validated reference
CREATE TABLE ad_call_to_action_types (
    code varchar(40) PRIMARY KEY CHECK(code = upper(trim(code))),
    display_label varchar(80) NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0
);
INSERT INTO ad_call_to_action_types(code, display_label, sort_order) VALUES
 ('LEARN_MORE','Learn More',1),
 ('SHOP_NOW','Shop Now',2),
 ('BOOK_NOW','Book Now',3),
 ('CONTACT_US','Contact Us',4),
 ('SIGN_UP','Sign Up',5),
 ('GET_OFFER','Get Offer',6),
 ('GET_DIRECTIONS','Get Directions',7),
 ('SEND_MESSAGE','Send Message',8),
 ('CALL_NOW','Call Now',9),
 ('VISIT_WEBSITE','Visit Website',10),
 ('VIEW_EVENT','View Event',11),
 ('VIEW_LISTING','View Listing',12),
 ('VIEW_PRODUCT','View Product',13),
 ('APPLY_NOW','Apply Now',14),
 ('DOWNLOAD','Download',15),
 ('GET_QUOTE','Get Quote',16),
 ('VIEW_PROFILE','View Profile',17)
ON CONFLICT(code) DO NOTHING;

-- 4b. Ad campaigns — the top-level entity
CREATE TABLE ad_campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    individual_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    business_account_id uuid REFERENCES business_accounts(id) ON DELETE RESTRICT,
    created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name varchar(200) NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
    description text,
    campaign_kind varchar(40) NOT NULL
        CHECK(campaign_kind IN ('STANDARD','COMMUNITY_SPONSORSHIP','MARKETPLACE_AD')),
    objective varchar(40) NOT NULL
        CHECK(objective IN ('AWARENESS','TRAFFIC','ENGAGEMENT','LEADS','CONVERSIONS')),
    pricing_model varchar(30) NOT NULL
        CHECK(pricing_model IN ('FIXED_FEE','PREPAID_BUDGET')),
    currency_code char(3) NOT NULL CHECK(currency_code ~ '^[A-Z]{3}$'),
    -- Fixed-fee payment linkage
    fixed_fee_amount_minor bigint CHECK(fixed_fee_amount_minor IS NULL OR fixed_fee_amount_minor > 0),
    billing_order_id uuid REFERENCES billing_orders(id) ON DELETE SET NULL,
    -- Prepaid budget limits
    budget_limit_minor bigint CHECK(budget_limit_minor IS NULL OR budget_limit_minor > 0),
    daily_budget_limit_minor bigint CHECK(daily_budget_limit_minor IS NULL OR daily_budget_limit_minor > 0),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    timezone varchar(64) NOT NULL DEFAULT 'UTC',
    frequency_cap_count integer CHECK(frequency_cap_count IS NULL OR frequency_cap_count > 0),
    frequency_cap_window_hours integer CHECK(frequency_cap_window_hours IS NULL OR frequency_cap_window_hours > 0),
    -- Community-scope targeting (Diasporum-specific)
    community_target_scope varchar(30) NOT NULL DEFAULT 'SELECTED'
        CHECK(community_target_scope IN (
            'SELECTED',                -- manually picked communities in ad_campaign_community_targets
            'ALL_SAME_ORIGIN',         -- all communities sharing advertiser's origin country
            'ALL_SAME_CURRENT_COUNTRY',-- all communities in advertiser's current country
            'ALL_COMMUNITIES'          -- platform-wide — application must restrict to admin-approved campaigns
        )),
    -- Denormalised summary counters (updated by backend on metric flush)
    total_impressions bigint NOT NULL DEFAULT 0 CHECK(total_impressions >= 0),
    total_clicks bigint NOT NULL DEFAULT 0 CHECK(total_clicks >= 0),
    total_spend_minor bigint NOT NULL DEFAULT 0 CHECK(total_spend_minor >= 0),
    status varchar(30) NOT NULL DEFAULT 'DRAFT'
        CHECK(status IN ('DRAFT','PENDING_PAYMENT','PENDING_REVIEW','APPROVED','SCHEDULED',
            'ACTIVE','PAUSED','REJECTED','COMPLETED','CANCELLED','BUDGET_EXHAUSTED')),
    rejection_reason text,
    moderation_queue_id uuid, -- link to moderation_queue row when under review (FK added after moderation_queue is created)
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(ends_at > starts_at),
    CHECK((individual_user_id IS NOT NULL)::int + (business_account_id IS NOT NULL)::int = 1),
    CHECK(pricing_model <> 'FIXED_FEE' OR fixed_fee_amount_minor IS NOT NULL),
    CHECK(pricing_model <> 'PREPAID_BUDGET' OR budget_limit_minor IS NOT NULL),
    -- Frequency cap: both fields must be set together or both NULL
    CHECK((frequency_cap_count IS NULL) = (frequency_cap_window_hours IS NULL)),
    -- Daily budget cannot exceed total budget
    CHECK(daily_budget_limit_minor IS NULL OR budget_limit_minor IS NULL
        OR daily_budget_limit_minor <= budget_limit_minor),
    -- Rejection reason required when status = REJECTED
    CHECK(status <> 'REJECTED' OR rejection_reason IS NOT NULL)
);
CREATE INDEX ix_ad_campaigns_user_status ON ad_campaigns(individual_user_id, status, created_at DESC)
    WHERE individual_user_id IS NOT NULL;
CREATE INDEX ix_ad_campaigns_business_status ON ad_campaigns(business_account_id, status, created_at DESC)
    WHERE business_account_id IS NOT NULL;
CREATE INDEX ix_ad_campaigns_active ON ad_campaigns(status, starts_at, ends_at)
    WHERE status IN ('ACTIVE','SCHEDULED','APPROVED');

-- 4b. Ad creatives
CREATE TABLE ad_creatives (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
    name varchar(200) NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
    creative_type varchar(30) NOT NULL
        CHECK(creative_type IN ('PROMOTED_CONTENT','DEDICATED')),
    headline varchar(300),
    primary_text text,
    description text,
    call_to_action_code varchar(40) REFERENCES ad_call_to_action_types(code) ON DELETE SET NULL,
    call_to_action_url text CHECK(call_to_action_url IS NULL OR call_to_action_url ~* '^https?://'),
    language_code varchar(20),
    status varchar(20) NOT NULL DEFAULT 'DRAFT'
        CHECK(status IN ('DRAFT','READY','ARCHIVED')),
    created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_ad_creatives_campaign ON ad_creatives(campaign_id, status);

-- 4c. Ad creative assets (media)
CREATE TABLE ad_creative_assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    creative_id uuid NOT NULL REFERENCES ad_creatives(id) ON DELETE CASCADE,
    media_asset_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE RESTRICT,
    asset_role varchar(30) NOT NULL
        CHECK(asset_role IN ('PRIMARY_IMAGE','PRIMARY_VIDEO','THUMBNAIL','CAROUSEL_IMAGE','LOGO')),
    display_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_ad_creative_assets_creative ON ad_creative_assets(creative_id, display_order);

-- 4d. Ad creative sources (for promoted content)
CREATE TABLE ad_creative_sources (
    creative_id uuid PRIMARY KEY REFERENCES ad_creatives(id) ON DELETE CASCADE,
    source_type varchar(40) NOT NULL
        CHECK(source_type IN ('FEED_POST','PROPERTY_LISTING','VEHICLE_LISTING','JOB_LISTING',
            'EVENT','SHOP_PRODUCT','SERVICE_LISTING','BUSINESS_PROFILE','SPARE_BAG_SENDER_REQUEST',
            'SPARE_BAG_TRAVELLER_JOURNEY')),
    source_id uuid NOT NULL
);
CREATE INDEX ix_ad_creative_sources_source ON ad_creative_sources(source_type, source_id);

-- 4e. Ad placement types (seed table)
CREATE TABLE ad_placement_types (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(80) NOT NULL UNIQUE
        CHECK(code = upper(trim(code)) AND code ~ '^[A-Z][A-Z0-9_]*$'),
    name varchar(150) NOT NULL,
    surface varchar(30) NOT NULL
        CHECK(surface IN ('FEED','MARKETPLACE','EVENTS','JOBS','PROPERTY','VEHICLE',
            'SPARE_BAG','SERVICE','BANNER','INTERSTITIAL')),
    format varchar(30) NOT NULL
        CHECK(format IN ('NATIVE_CARD','BANNER','INTERSTITIAL','CAROUSEL','VIDEO')),
    description text,
    supports_image boolean NOT NULL DEFAULT true,
    supports_video boolean NOT NULL DEFAULT false,
    supports_text_only boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    display_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ad_placement_types(code, name, surface, format) VALUES
 ('FEED_NATIVE','Feed Native Ad','FEED','NATIVE_CARD'),
 ('FEED_BANNER','Feed Banner','FEED','BANNER'),
 ('MARKETPLACE_NATIVE','Marketplace Ad','MARKETPLACE','NATIVE_CARD'),
 ('EVENTS_NATIVE','Events Ad','EVENTS','NATIVE_CARD'),
 ('JOBS_NATIVE','Jobs Ad','JOBS','NATIVE_CARD'),
 ('PROPERTY_NATIVE','Property Ad','PROPERTY','NATIVE_CARD'),
 ('VEHICLE_NATIVE','Vehicle Ad','VEHICLE','NATIVE_CARD'),
 ('SPARE_BAG_NATIVE','Spare Bag Ad','SPARE_BAG','NATIVE_CARD'),
 ('SERVICE_NATIVE','Service Ad','SERVICE','NATIVE_CARD')
ON CONFLICT(code) DO NOTHING;

-- 4f. Campaign-to-placement mapping
CREATE TABLE ad_campaign_placements (
    campaign_id uuid NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
    placement_type_id uuid NOT NULL REFERENCES ad_placement_types(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(campaign_id, placement_type_id)
);

-- 4g. Campaign community targeting
CREATE TABLE ad_campaign_community_targets (
    campaign_id uuid NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
    community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    target_mode varchar(10) NOT NULL DEFAULT 'INCLUDE'
        CHECK(target_mode IN ('INCLUDE','EXCLUDE')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(campaign_id, community_id)
);

-- 4h. Campaign status history (audit trail)
CREATE TABLE ad_campaign_status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
    previous_status varchar(30),
    new_status varchar(30) NOT NULL,
    reason_code varchar(80),
    reason_description text,
    changed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    change_source varchar(20) NOT NULL
        CHECK(change_source IN ('USER','ADMIN','SYSTEM','AI_MODERATION')),
    changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_ad_campaign_status_history_campaign
    ON ad_campaign_status_history(campaign_id, changed_at DESC);

-- 4i. Campaign metrics (aggregated daily per creative/placement/community)
CREATE TABLE ad_campaign_metrics (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
    creative_id uuid NOT NULL REFERENCES ad_creatives(id) ON DELETE RESTRICT,
    placement_type_id uuid REFERENCES ad_placement_types(id) ON DELETE SET NULL,
    community_id uuid REFERENCES communities(id) ON DELETE SET NULL,
    metric_date date NOT NULL,
    impressions_count bigint NOT NULL DEFAULT 0 CHECK(impressions_count >= 0),
    viewable_impressions_count bigint NOT NULL DEFAULT 0 CHECK(viewable_impressions_count >= 0),
    clicks_count bigint NOT NULL DEFAULT 0 CHECK(clicks_count >= 0),
    invalid_clicks_count bigint NOT NULL DEFAULT 0 CHECK(invalid_clicks_count >= 0),
    conversions_count bigint NOT NULL DEFAULT 0 CHECK(conversions_count >= 0),
    delivery_cost_minor bigint NOT NULL DEFAULT 0 CHECK(delivery_cost_minor >= 0),
    -- currency_code may differ from campaign.currency_code for multi-currency reporting
    currency_code char(3) NOT NULL CHECK(currency_code ~ '^[A-Z]{3}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(viewable_impressions_count <= impressions_count),
    CHECK(invalid_clicks_count <= clicks_count)
);
-- NULLS NOT DISTINCT requires PG15+
CREATE UNIQUE INDEX ux_ad_campaign_metrics_daily
    ON ad_campaign_metrics(campaign_id, creative_id, placement_type_id, community_id, metric_date)
    NULLS NOT DISTINCT;
CREATE INDEX ix_ad_campaign_metrics_campaign_date
    ON ad_campaign_metrics(campaign_id, metric_date DESC);

-- 4j. Campaign budget ledger (for prepaid budgets)
CREATE TABLE ad_campaign_budget_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
    entry_type varchar(30) NOT NULL
        CHECK(entry_type IN ('DEPOSIT','SPEND','REFUND','ADJUSTMENT')),
    -- Sign convention: DEPOSIT/REFUND = positive (credit), SPEND/ADJUSTMENT = negative (debit)
    -- Balance = SUM(amount_minor). ADJUSTMENT can be positive or negative.
    amount_minor bigint NOT NULL
        CHECK(entry_type IN ('SPEND') AND amount_minor < 0
            OR entry_type IN ('DEPOSIT','REFUND') AND amount_minor > 0
            OR entry_type = 'ADJUSTMENT'),
    currency_code char(3) NOT NULL CHECK(currency_code ~ '^[A-Z]{3}$'),
    billing_order_id uuid REFERENCES billing_orders(id) ON DELETE SET NULL,
    billing_payment_id uuid REFERENCES billing_payments(id) ON DELETE SET NULL,
    billing_refund_id uuid REFERENCES billing_refunds(id) ON DELETE SET NULL,
    source_reference varchar(150),
    adjustment_reason text,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    idempotency_key varchar(150) NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_ad_budget_ledger_campaign ON ad_campaign_budget_ledger(campaign_id, created_at DESC);

-- 4k. Ad conversion events (for advanced tracking)
CREATE TABLE ad_conversion_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
    creative_id uuid REFERENCES ad_creatives(id) ON DELETE SET NULL,
    community_id uuid REFERENCES communities(id) ON DELETE SET NULL,
    conversion_type varchar(40) NOT NULL
        CHECK(conversion_type IN ('SIGN_UP','PURCHASE','LEAD','PAGE_VIEW','ADD_TO_CART',
            'CHECKOUT','CONTACT','DOWNLOAD','OTHER')),
    attribution_method varchar(30) NOT NULL
        CHECK(attribution_method IN ('LAST_CLICK','LAST_VIEW','MULTI_TOUCH','DIRECT')),
    source_module varchar(40),
    source_event_reference varchar(150),
    attribution_reference_hash bytea,
    conversion_value_minor bigint CHECK(conversion_value_minor IS NULL OR conversion_value_minor >= 0),
    currency_code char(3) CHECK(currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
    idempotency_key varchar(150) NOT NULL UNIQUE,
    converted_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_ad_conversion_events_campaign ON ad_conversion_events(campaign_id, converted_at DESC);

-- 4l. Community sponsorship details (for COMMUNITY_SPONSORSHIP campaigns)
CREATE TABLE ad_community_sponsorships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL UNIQUE REFERENCES ad_campaigns(id) ON DELETE CASCADE,
    sponsored_community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    sponsorship_tier varchar(30) NOT NULL DEFAULT 'STANDARD'
        CHECK(sponsorship_tier IN ('STANDARD','PREMIUM','EXCLUSIVE')),
    sponsor_display_name varchar(200),
    sponsor_logo_media_id uuid REFERENCES media_objects(id) ON DELETE SET NULL,
    benefits jsonb NOT NULL DEFAULT '[]'::jsonb,
    visible_to_members boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_ad_community_sponsorships_community
    ON ad_community_sponsorships(sponsored_community_id)
    WHERE visible_to_members;


-- =====================================================================
-- 5. FEATURED LISTING STATISTICS
-- =====================================================================

CREATE TABLE featured_item_statistics (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    featured_item_id uuid NOT NULL REFERENCES featured_items(id) ON DELETE CASCADE,
    community_id uuid REFERENCES communities(id) ON DELETE SET NULL,
    metric_date date NOT NULL,
    impressions_count bigint NOT NULL DEFAULT 0 CHECK(impressions_count >= 0),
    clicks_count bigint NOT NULL DEFAULT 0 CHECK(clicks_count >= 0),
    saves_count bigint NOT NULL DEFAULT 0 CHECK(saves_count >= 0),
    contacts_count bigint NOT NULL DEFAULT 0 CHECK(contacts_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_featured_item_stats_daily
    ON featured_item_statistics(featured_item_id, community_id, metric_date)
    NULLS NOT DISTINCT;
CREATE INDEX ix_featured_item_stats_item_date
    ON featured_item_statistics(featured_item_id, metric_date DESC);


-- =====================================================================
-- 6. EVENT TICKETING SYSTEM
-- =====================================================================

-- 6a. Extend events table for ticketing
ALTER TABLE events
    ADD COLUMN IF NOT EXISTS business_account_id uuid REFERENCES business_accounts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS is_ticketed boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS ticket_currency_code char(3) CHECK(ticket_currency_code IS NULL OR ticket_currency_code ~ '^[A-Z]{3}$'),
    ADD COLUMN IF NOT EXISTS ticket_fee_model varchar(30)
        CHECK(ticket_fee_model IS NULL OR ticket_fee_model IN ('BUYER_PAYS','ORGANISER_ABSORBS','SPLIT')),
    ADD COLUMN IF NOT EXISTS refund_policy varchar(30) NOT NULL DEFAULT 'ORGANISER_DISCRETION'
        CHECK(refund_policy IN ('NO_REFUNDS','ORGANISER_DISCRETION','REFUND_UNTIL_EVENT','REFUND_UNTIL_CUTOFF')),
    ADD COLUMN IF NOT EXISTS refund_cutoff_hours integer CHECK(refund_cutoff_hours IS NULL OR refund_cutoff_hours > 0),
    ADD COLUMN IF NOT EXISTS cancellation_reason text,
    ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- REFUND_UNTIL_CUTOFF requires a cutoff value
ALTER TABLE events
    ADD CONSTRAINT ck_events_refund_cutoff_required
        CHECK(refund_policy <> 'REFUND_UNTIL_CUTOFF' OR refund_cutoff_hours IS NOT NULL);

-- 6b. Extend events for multi-community targeting
ALTER TABLE events
    ADD COLUMN IF NOT EXISTS target_mode text NOT NULL DEFAULT 'SINGLE_COMMUNITY'
        CHECK(target_mode IN ('SINGLE_COMMUNITY','SELECTED_COMMUNITIES',
            'ALL_SAME_ORIGIN','ALL_SAME_CURRENT_COUNTRY'));

-- 6c. Payout account field requirements (per country, per payout method)
--     Defines WHICH fields the app must collect for a given country.
--     The mobile app reads this table to render the correct form and
--     validate inputs client-side; the backend re-validates server-side.
CREATE TABLE payout_account_field_requirements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
    payout_method varchar(30) NOT NULL
        CHECK(payout_method IN ('BANK_ACCOUNT','MOBILE_MONEY')),
    required_fields text[] NOT NULL,
    optional_fields text[] NOT NULL DEFAULT '{}',
    field_labels jsonb NOT NULL DEFAULT '{}'::jsonb,
    field_patterns jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(country_id, payout_method)
);

-- Seed field requirements for key markets (admin extends as needed).
-- Each INSERT selects from countries by iso2 — if a country is absent, 0 rows are inserted.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM countries WHERE iso2 = 'GB') THEN
        RAISE NOTICE 'GB country not found — GB payout requirements not seeded';
    END IF;
END $$;
INSERT INTO payout_account_field_requirements(country_id, payout_method, required_fields, optional_fields, field_labels, field_patterns)
SELECT c.id, 'BANK_ACCOUNT',
    '{sort_code,account_number}'::text[],
    '{iban,swift_code,branch_name}'::text[],
    '{"sort_code":"Sort Code","account_number":"Account Number","iban":"IBAN","swift_code":"SWIFT/BIC","branch_name":"Branch"}'::jsonb,
    '{"sort_code":"^[0-9]{6}$","account_number":"^[0-9]{8}$"}'::jsonb
FROM countries c WHERE c.iso2 = 'GB'
ON CONFLICT(country_id, payout_method) DO NOTHING;

INSERT INTO payout_account_field_requirements(country_id, payout_method, required_fields, optional_fields, field_labels, field_patterns)
SELECT c.id, 'BANK_ACCOUNT',
    '{routing_number,account_number}'::text[],
    '{swift_code,bank_name}'::text[],
    '{"routing_number":"ABA Routing Number","account_number":"Account Number","swift_code":"SWIFT/BIC","bank_name":"Bank Name"}'::jsonb,
    '{"routing_number":"^[0-9]{9}$","account_number":"^[0-9]{4,17}$"}'::jsonb
FROM countries c WHERE c.iso2 = 'US'
ON CONFLICT(country_id, payout_method) DO NOTHING;

INSERT INTO payout_account_field_requirements(country_id, payout_method, required_fields, optional_fields, field_labels, field_patterns)
SELECT c.id, 'BANK_ACCOUNT',
    '{account_number,bank_name}'::text[],
    '{branch_name,swift_code}'::text[],
    '{"account_number":"Account Number","bank_name":"Bank Name","branch_name":"Branch","swift_code":"SWIFT"}'::jsonb,
    '{"account_number":"^[0-9]{6,20}$"}'::jsonb
FROM countries c WHERE c.iso2 = 'ET'
ON CONFLICT(country_id, payout_method) DO NOTHING;

INSERT INTO payout_account_field_requirements(country_id, payout_method, required_fields, optional_fields, field_labels, field_patterns)
SELECT c.id, 'MOBILE_MONEY',
    '{mobile_money_provider,mobile_money_phone}'::text[],
    '{}'::text[],
    '{"mobile_money_provider":"Provider (e.g. Telebirr, M-Pesa)","mobile_money_phone":"Phone Number"}'::jsonb,
    '{"mobile_money_phone":"^(\\+251|0)?[79][0-9]{8}$"}'::jsonb
FROM countries c WHERE c.iso2 = 'ET'
ON CONFLICT(country_id, payout_method) DO NOTHING;

INSERT INTO payout_account_field_requirements(country_id, payout_method, required_fields, optional_fields, field_labels, field_patterns)
SELECT c.id, 'BANK_ACCOUNT',
    '{account_number,bank_name}'::text[],
    '{branch_code,swift_code}'::text[],
    '{"account_number":"Account Number","bank_name":"Bank Name","branch_code":"Branch Code","swift_code":"SWIFT"}'::jsonb,
    '{}'::jsonb
FROM countries c WHERE c.iso2 = 'KE'
ON CONFLICT(country_id, payout_method) DO NOTHING;

INSERT INTO payout_account_field_requirements(country_id, payout_method, required_fields, optional_fields, field_labels, field_patterns)
SELECT c.id, 'MOBILE_MONEY',
    '{mobile_money_provider,mobile_money_phone}'::text[],
    '{}'::text[],
    '{"mobile_money_provider":"Provider (e.g. M-Pesa)","mobile_money_phone":"Phone Number"}'::jsonb,
    '{"mobile_money_phone":"^(\\+254|0)?[17][0-9]{8}$"}'::jsonb
FROM countries c WHERE c.iso2 = 'KE'
ON CONFLICT(country_id, payout_method) DO NOTHING;

INSERT INTO payout_account_field_requirements(country_id, payout_method, required_fields, optional_fields, field_labels, field_patterns)
SELECT c.id, 'BANK_ACCOUNT',
    '{account_number,bank_code}'::text[],
    '{bank_name}'::text[],
    '{"account_number":"NUBAN Account Number","bank_code":"Bank Code","bank_name":"Bank Name"}'::jsonb,
    '{"account_number":"^[0-9]{10}$"}'::jsonb
FROM countries c WHERE c.iso2 = 'NG'
ON CONFLICT(country_id, payout_method) DO NOTHING;

INSERT INTO payout_account_field_requirements(country_id, payout_method, required_fields, optional_fields, field_labels, field_patterns)
SELECT c.id, 'BANK_ACCOUNT',
    '{ifsc_code,account_number}'::text[],
    '{bank_name,branch_name}'::text[],
    '{"ifsc_code":"IFSC Code","account_number":"Account Number","bank_name":"Bank Name","branch_name":"Branch"}'::jsonb,
    '{"ifsc_code":"^[A-Z]{4}0[A-Z0-9]{6}$","account_number":"^[0-9]{9,18}$"}'::jsonb
FROM countries c WHERE c.iso2 = 'IN'
ON CONFLICT(country_id, payout_method) DO NOTHING;

INSERT INTO payout_account_field_requirements(country_id, payout_method, required_fields, optional_fields, field_labels, field_patterns)
SELECT c.id, 'BANK_ACCOUNT',
    '{transit_number,institution_number,account_number}'::text[],
    '{swift_code}'::text[],
    '{"transit_number":"Transit Number","institution_number":"Institution Number","account_number":"Account Number","swift_code":"SWIFT"}'::jsonb,
    '{"transit_number":"^[0-9]{5}$","institution_number":"^[0-9]{3}$","account_number":"^[0-9]{7,12}$"}'::jsonb
FROM countries c WHERE c.iso2 = 'CA'
ON CONFLICT(country_id, payout_method) DO NOTHING;

INSERT INTO payout_account_field_requirements(country_id, payout_method, required_fields, optional_fields, field_labels, field_patterns)
SELECT c.id, 'BANK_ACCOUNT',
    '{bsb,account_number}'::text[],
    '{swift_code}'::text[],
    '{"bsb":"BSB","account_number":"Account Number","swift_code":"SWIFT"}'::jsonb,
    '{"bsb":"^[0-9]{6}$","account_number":"^[0-9]{6,9}$"}'::jsonb
FROM countries c WHERE c.iso2 = 'AU'
ON CONFLICT(country_id, payout_method) DO NOTHING;

-- IBAN-based countries (most of EU, UAE, Turkey, etc.) share one pattern
INSERT INTO payout_account_field_requirements(country_id, payout_method, required_fields, optional_fields, field_labels, field_patterns)
SELECT c.id, 'BANK_ACCOUNT',
    '{iban}'::text[],
    '{swift_code,bank_name}'::text[],
    '{"iban":"IBAN","swift_code":"BIC/SWIFT","bank_name":"Bank Name"}'::jsonb,
    '{"iban":"^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$"}'::jsonb
FROM countries c WHERE c.iso2 IN ('DE','FR','ES','IT','NL','BE','IE','AT','PT','SE','NO','DK','FI','PL','GR','CZ','AE','SA','TR','QA','KW')
ON CONFLICT(country_id, payout_method) DO NOTHING;

INSERT INTO payout_account_field_requirements(country_id, payout_method, required_fields, optional_fields, field_labels, field_patterns)
SELECT c.id, 'BANK_ACCOUNT',
    '{clabe}'::text[],
    '{bank_name}'::text[],
    '{"clabe":"CLABE","bank_name":"Bank Name"}'::jsonb,
    '{"clabe":"^[0-9]{18}$"}'::jsonb
FROM countries c WHERE c.iso2 = 'MX'
ON CONFLICT(country_id, payout_method) DO NOTHING;

INSERT INTO payout_account_field_requirements(country_id, payout_method, required_fields, optional_fields, field_labels, field_patterns)
SELECT c.id, 'BANK_ACCOUNT',
    '{pix_key}'::text[],
    '{bank_code,agency,account_number}'::text[],
    '{"pix_key":"PIX Key","bank_code":"Bank Code","agency":"Agency","account_number":"Account Number"}'::jsonb,
    '{}'::jsonb
FROM countries c WHERE c.iso2 = 'BR'
ON CONFLICT(country_id, payout_method) DO NOTHING;

-- Report which expected countries were not found in the countries table
DO $$
DECLARE
    v_expected text[] := ARRAY['GB','US','ET','KE','NG','IN','CA','AU','MX','BR',
        'DE','FR','ES','IT','NL','BE','IE','AT','PT','SE','NO','DK','FI','PL','GR','CZ','AE','SA','TR','QA','KW'];
    v_found text[];
BEGIN
    SELECT array_agg(iso2) INTO v_found
      FROM countries WHERE iso2 = ANY(v_expected);
    IF array_length(v_expected,1) <> COALESCE(array_length(v_found,1),0) THEN
        RAISE NOTICE 'Missing countries for payout requirements: %',
            (SELECT array_agg(e) FROM unnest(v_expected) e
             WHERE e <> ALL(COALESCE(v_found,'{}')));
    END IF;
END $$;

-- 6d. Organiser payout accounts (bank/mobile-money details for manual transfers)
--     Organisers add payout destination details once; platform staff
--     verify them and manually transfer payouts, recording the reference.
--     Country-specific bank fields are stored in bank_details JSONB and
--     validated against payout_account_field_requirements for that country.
--     NOTE: sensitive financial data — the application must encrypt
--     account_number, iban, bank_details and mobile_money_phone at rest
--     and mask them in all API responses and logs.
CREATE TABLE event_organiser_payout_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organiser_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    business_account_id uuid REFERENCES business_accounts(id) ON DELETE RESTRICT,
    payout_method varchar(30) NOT NULL
        CHECK(payout_method IN ('BANK_ACCOUNT','MOBILE_MONEY','OTHER')),
    country_id uuid NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
    currency_code char(3) NOT NULL CHECK(currency_code ~ '^[A-Z]{3}$'),
    account_holder_name varchar(200) NOT NULL,
    bank_name varchar(200),
    -- Universal structured fields (kept as columns for masking/lookup)
    iban varchar(34),
    account_number varchar(64),
    -- Country-specific bank fields, e.g.
    --   GB: {"sort_code":"200415"}
    --   US: {"routing_number":"021000021"}
    --   IN: {"ifsc_code":"HDFC0001234"}
    --   ET: {"branch_name":"Bole Branch"}
    --   CA: {"transit_number":"01642","institution_number":"001"}
    bank_details jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Mobile money fields (Telebirr, M-Pesa, Amole, etc.)
    mobile_money_provider varchar(50),
    mobile_money_phone varchar(20),
    -- Any other payout details
    other_details jsonb,
    verification_status varchar(20) NOT NULL DEFAULT 'PENDING'
        CHECK(verification_status IN ('PENDING','VERIFIED','REJECTED')),
    verified_at timestamptz,
    verified_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    verification_notes text,
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK((organiser_user_id IS NOT NULL)::int + (business_account_id IS NOT NULL)::int = 1),
    CHECK(payout_method <> 'BANK_ACCOUNT'
        OR iban IS NOT NULL
        OR account_number IS NOT NULL
        OR bank_details <> '{}'::jsonb),
    CHECK(payout_method <> 'MOBILE_MONEY'
        OR (mobile_money_provider IS NOT NULL AND mobile_money_phone IS NOT NULL)),
    CHECK(payout_method <> 'OTHER' OR other_details IS NOT NULL),
    CHECK(verification_status <> 'VERIFIED' OR verified_at IS NOT NULL)
);
-- One default payout account per organiser
CREATE UNIQUE INDEX ux_organiser_payout_accounts_user_default
    ON event_organiser_payout_accounts(organiser_user_id)
    WHERE organiser_user_id IS NOT NULL AND is_default;
CREATE UNIQUE INDEX ux_organiser_payout_accounts_biz_default
    ON event_organiser_payout_accounts(business_account_id)
    WHERE business_account_id IS NOT NULL AND is_default;

-- 6e. Event ticket types
CREATE TABLE event_ticket_types (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name varchar(150) NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 150),
    description text,
    price_amount numeric(12,2) NOT NULL CHECK(price_amount >= 0),
    currency_code char(3) NOT NULL CHECK(currency_code ~ '^[A-Z]{3}$'),
    quantity_total integer NOT NULL CHECK(quantity_total > 0),
    quantity_sold integer NOT NULL DEFAULT 0 CHECK(quantity_sold >= 0),
    quantity_reserved integer NOT NULL DEFAULT 0 CHECK(quantity_reserved >= 0),
    max_per_order integer NOT NULL DEFAULT 10 CHECK(max_per_order >= 1),
    sales_start_at timestamptz NOT NULL,
    sales_end_at timestamptz NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    restrictions jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(sales_end_at > sales_start_at),
    CHECK(quantity_sold + quantity_reserved <= quantity_total)
);
CREATE INDEX ix_event_ticket_types_event ON event_ticket_types(event_id, sort_order) WHERE is_active;

-- Trigger: ticket type currency must match event ticket_currency_code
CREATE OR REPLACE FUNCTION validate_ticket_type_currency()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_event_currency char(3);
BEGIN
    SELECT ticket_currency_code INTO v_event_currency
      FROM events WHERE id = NEW.event_id;
    IF v_event_currency IS NOT NULL AND NEW.currency_code <> v_event_currency THEN
        RAISE EXCEPTION 'Ticket type currency (%) must match event currency (%)',
            NEW.currency_code, v_event_currency USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_ticket_type_currency
    BEFORE INSERT OR UPDATE OF currency_code ON event_ticket_types
    FOR EACH ROW EXECUTE FUNCTION validate_ticket_type_currency();

-- 6f. Event ticket promo codes (must be defined before ticket_orders references it)
CREATE TABLE event_ticket_promo_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    code varchar(50) NOT NULL CHECK(code = upper(trim(code)) AND length(code) BETWEEN 2 AND 50),
    discount_type varchar(20) NOT NULL CHECK(discount_type IN ('PERCENTAGE','FIXED_AMOUNT')),
    discount_value numeric(12,2) NOT NULL CHECK(discount_value > 0),
    currency_code char(3) CHECK(currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
    max_uses integer CHECK(max_uses IS NULL OR max_uses > 0),
    used_count integer NOT NULL DEFAULT 0 CHECK(used_count >= 0),
    max_uses_per_user integer CHECK(max_uses_per_user IS NULL OR max_uses_per_user > 0),
    applicable_ticket_type_ids uuid[],
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_until timestamptz,
    is_active boolean NOT NULL DEFAULT true,
    created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(event_id, code),
    CHECK(valid_until IS NULL OR valid_until > valid_from),
    CHECK(max_uses IS NULL OR used_count <= max_uses),
    CHECK(discount_type <> 'FIXED_AMOUNT' OR currency_code IS NOT NULL),
    CHECK(discount_type <> 'PERCENTAGE' OR discount_value <= 100)
);

-- Trigger: all applicable_ticket_type_ids must belong to the same event
CREATE OR REPLACE FUNCTION validate_promo_ticket_types()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.applicable_ticket_type_ids IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM unnest(NEW.applicable_ticket_type_ids) AS tid
            WHERE NOT EXISTS (
                SELECT 1 FROM event_ticket_types ett
                WHERE ett.id = tid AND ett.event_id = NEW.event_id
            )
        ) THEN
            RAISE EXCEPTION 'All applicable ticket type IDs must belong to event %',
                NEW.event_id USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_promo_ticket_types
    BEFORE INSERT OR UPDATE OF applicable_ticket_type_ids ON event_ticket_promo_codes
    FOR EACH ROW EXECUTE FUNCTION validate_promo_ticket_types();

-- 6g. Ticket reservations (hold tickets during checkout, TTL-based)
--     confirmed_order_id FK is added after ticket_orders is created
--     to avoid a circular dependency (ticket_orders.reservation_id also
--     references this table).
CREATE TABLE ticket_reservations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_type_id uuid NOT NULL REFERENCES event_ticket_types(id) ON DELETE CASCADE,
    buyer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quantity integer NOT NULL CHECK(quantity > 0),
    status varchar(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK(status IN ('ACTIVE','CONFIRMED','RELEASED','EXPIRED')),
    expires_at timestamptz NOT NULL,
    confirmed_order_id uuid, -- FK added after ticket_orders is created (deferred)
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(expires_at > created_at),
    CHECK(status <> 'CONFIRMED' OR confirmed_order_id IS NOT NULL)
);
CREATE INDEX ix_ticket_reservations_type_active
    ON ticket_reservations(ticket_type_id, status) WHERE status = 'ACTIVE';
CREATE INDEX ix_ticket_reservations_expires
    ON ticket_reservations(expires_at) WHERE status = 'ACTIVE';
CREATE INDEX ix_ticket_reservations_buyer
    ON ticket_reservations(buyer_user_id, status);

-- 6h. Ticket orders
CREATE TABLE ticket_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    buyer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    order_number text NOT NULL UNIQUE
        CHECK(length(trim(order_number)) BETWEEN 1 AND 80),
    currency_code char(3) NOT NULL CHECK(currency_code ~ '^[A-Z]{3}$'),
    subtotal_amount numeric(12,2) NOT NULL CHECK(subtotal_amount >= 0),
    platform_fee_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK(platform_fee_amount >= 0),
    discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK(discount_amount >= 0),
    total_amount numeric(12,2) NOT NULL CHECK(total_amount >= 0),
    fee_paid_by varchar(30) NOT NULL
        CHECK(fee_paid_by IN ('BUYER_PAYS','ORGANISER_ABSORBS','SPLIT')),
    promo_code_id uuid REFERENCES event_ticket_promo_codes(id) ON DELETE SET NULL,
    status varchar(30) NOT NULL DEFAULT 'PENDING'
        CHECK(status IN ('PENDING','RESERVED','PAYMENT_PENDING','PAID','CANCELLED',
            'REFUND_REQUESTED','PARTIALLY_REFUNDED','REFUNDED','EXPIRED')),
    payment_provider text,
    payment_provider_id text,
    payment_method_summary varchar(60),
    idempotency_key text UNIQUE,
    reservation_id uuid, -- FK added below (deferred to break circular dep)
    created_at timestamptz NOT NULL DEFAULT now(),
    paid_at timestamptz,
    cancelled_at timestamptz,
    expires_at timestamptz,
    CHECK(total_amount = subtotal_amount - discount_amount + platform_fee_amount),
    CHECK(status <> 'PAID' OR paid_at IS NOT NULL)
);
-- Deferred FK: ticket_orders.reservation_id -> ticket_reservations.id
ALTER TABLE ticket_orders
    ADD CONSTRAINT fk_ticket_orders_reservation
        FOREIGN KEY (reservation_id) REFERENCES ticket_reservations(id) ON DELETE SET NULL;
-- Deferred FK: ticket_reservations.confirmed_order_id -> ticket_orders.id
ALTER TABLE ticket_reservations
    ADD CONSTRAINT fk_ticket_reservations_order
        FOREIGN KEY (confirmed_order_id) REFERENCES ticket_orders(id) ON DELETE SET NULL;
-- Unique: one order can only be linked to one reservation
CREATE UNIQUE INDEX ux_ticket_orders_reservation
    ON ticket_orders(reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX ix_ticket_reservations_order ON ticket_reservations(confirmed_order_id)
    WHERE confirmed_order_id IS NOT NULL;

CREATE INDEX ix_ticket_orders_event ON ticket_orders(event_id, status, created_at DESC);
CREATE INDEX ix_ticket_orders_buyer ON ticket_orders(buyer_user_id, status, created_at DESC)
    WHERE buyer_user_id IS NOT NULL;
-- Prevent duplicate provider payment records (idempotency at provider level)
CREATE UNIQUE INDEX ux_ticket_orders_provider_payment
    ON ticket_orders(payment_provider, payment_provider_id)
    WHERE payment_provider_id IS NOT NULL;

-- Trigger: ticket order currency must match event ticket_currency_code
CREATE OR REPLACE FUNCTION validate_order_currency()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_event_currency char(3);
BEGIN
    SELECT ticket_currency_code INTO v_event_currency
      FROM events WHERE id = NEW.event_id;
    IF v_event_currency IS NOT NULL AND NEW.currency_code <> v_event_currency THEN
        RAISE EXCEPTION 'Order currency (%) must match event ticket currency (%)',
            NEW.currency_code, v_event_currency USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_ticket_order_currency
    BEFORE INSERT OR UPDATE OF currency_code ON ticket_orders
    FOR EACH ROW EXECUTE FUNCTION validate_order_currency();

-- 6i. Ticket order items
CREATE TABLE ticket_order_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES ticket_orders(id) ON DELETE CASCADE,
    ticket_type_id uuid NOT NULL REFERENCES event_ticket_types(id) ON DELETE RESTRICT,
    ticket_type_name_snapshot varchar(150) NOT NULL,
    quantity integer NOT NULL CHECK(quantity > 0),
    unit_price numeric(12,2) NOT NULL CHECK(unit_price >= 0),
    discount_per_unit numeric(12,2) NOT NULL DEFAULT 0 CHECK(discount_per_unit >= 0),
    line_total numeric(12,2) NOT NULL CHECK(line_total >= 0),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_ticket_order_items_order ON ticket_order_items(order_id);

-- 6j. Ticket order status history (audit trail)
CREATE TABLE ticket_order_status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES ticket_orders(id) ON DELETE CASCADE,
    previous_status varchar(30),
    new_status varchar(30) NOT NULL,
    changed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    change_source varchar(20) NOT NULL
        CHECK(change_source IN ('BUYER','ORGANISER','ADMIN','SYSTEM','PAYMENT_WEBHOOK')),
    reason text,
    metadata jsonb,
    changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_ticket_order_status_history_order
    ON ticket_order_status_history(order_id, changed_at DESC);

-- 6k. Issued tickets (one per purchased ticket, with QR code)
CREATE TABLE issued_tickets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_item_id uuid NOT NULL REFERENCES ticket_order_items(id) ON DELETE CASCADE,
    ticket_type_id uuid NOT NULL REFERENCES event_ticket_types(id) ON DELETE RESTRICT,
    event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    holder_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    holder_name varchar(200),
    holder_email varchar(320),
    ticket_code text NOT NULL UNIQUE
        CHECK(length(trim(ticket_code)) BETWEEN 8 AND 100),
    qr_payload text NOT NULL UNIQUE
        CHECK(length(trim(qr_payload)) BETWEEN 16 AND 500),
    status varchar(20) NOT NULL DEFAULT 'VALID'
        CHECK(status IN ('VALID','CHECKED_IN','CANCELLED','REFUNDED','EXPIRED','TRANSFERRED')),
    checked_in_at timestamptz,
    checked_in_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    transferred_to_ticket_id uuid REFERENCES issued_tickets(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK((status = 'CHECKED_IN') = (checked_in_at IS NOT NULL)),
    CHECK(transferred_to_ticket_id IS NULL OR transferred_to_ticket_id <> id),
    CHECK(status <> 'TRANSFERRED' OR transferred_to_ticket_id IS NOT NULL),
    CHECK(holder_email IS NULL OR holder_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);
CREATE INDEX ix_issued_tickets_event ON issued_tickets(event_id, status);
CREATE INDEX ix_issued_tickets_holder ON issued_tickets(holder_user_id, status)
    WHERE holder_user_id IS NOT NULL;
CREATE INDEX ix_issued_tickets_order_item ON issued_tickets(order_item_id);

-- 6l. Ticket check-in log (every scan attempt)
CREATE TABLE ticket_check_ins (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    issued_ticket_id uuid NOT NULL REFERENCES issued_tickets(id) ON DELETE RESTRICT,
    scanned_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    scan_result varchar(20) NOT NULL
        CHECK(scan_result IN ('VALID','ALREADY_CHECKED_IN','INVALID','REFUNDED',
            'CANCELLED','EXPIRED','TRANSFERRED')),
    scanned_at timestamptz NOT NULL DEFAULT now(),
    device_id text,
    latitude numeric(9,6) CHECK(latitude IS NULL OR latitude BETWEEN -90 AND 90),
    longitude numeric(9,6) CHECK(longitude IS NULL OR longitude BETWEEN -180 AND 180),
    is_offline_scan boolean NOT NULL DEFAULT false,
    synced_at timestamptz,
    notes text CHECK(notes IS NULL OR length(notes) <= 1000)
);
CREATE INDEX ix_ticket_check_ins_ticket ON ticket_check_ins(issued_ticket_id, scanned_at DESC);
-- Index for unsynced offline scans (synced_at IS NULL is the search key)
CREATE INDEX ix_ticket_check_ins_unsynced ON ticket_check_ins(issued_ticket_id, synced_at)
    WHERE is_offline_scan AND synced_at IS NULL;

-- 6m. Ticket refunds
CREATE TABLE ticket_refunds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES ticket_orders(id) ON DELETE RESTRICT,
    issued_ticket_id uuid REFERENCES issued_tickets(id) ON DELETE SET NULL,
    refund_amount numeric(12,2) NOT NULL CHECK(refund_amount > 0),
    platform_fee_refund numeric(12,2) NOT NULL DEFAULT 0 CHECK(platform_fee_refund >= 0),
    currency_code char(3) NOT NULL CHECK(currency_code ~ '^[A-Z]{3}$'),
    refund_type varchar(20) NOT NULL DEFAULT 'BUYER_REQUESTED'
        CHECK(refund_type IN ('BUYER_REQUESTED','ORGANISER_INITIATED','EVENT_CANCELLED','ADMIN_OVERRIDE')),
    status varchar(20) NOT NULL DEFAULT 'PENDING'
        CHECK(status IN ('PENDING','APPROVED','PROCESSING','PROCESSED','REJECTED','FAILED')),
    reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 2000),
    provider_refund_id text,
    idempotency_key text UNIQUE,
    requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
    approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    approved_at timestamptz,
    processed_at timestamptz
);
CREATE INDEX ix_ticket_refunds_order ON ticket_refunds(order_id, status);
CREATE INDEX ix_ticket_refunds_pending ON ticket_refunds(status, created_at)
    WHERE status IN ('PENDING','APPROVED','PROCESSING');

-- 6n. Ticket payment events (webhook handling from Stripe/Chapa/ArifPay)
CREATE TABLE ticket_payment_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_key varchar(40) NOT NULL,
    provider_event_id text NOT NULL,
    event_type text NOT NULL,
    order_id uuid REFERENCES ticket_orders(id) ON DELETE SET NULL,
    refund_id uuid REFERENCES ticket_refunds(id) ON DELETE SET NULL,
    payload jsonb NOT NULL,
    signature_verified boolean NOT NULL DEFAULT false,
    status varchar(20) NOT NULL DEFAULT 'RECEIVED'
        CHECK(status IN ('RECEIVED','PROCESSING','PROCESSED','FAILED','IGNORED')),
    error_detail text,
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    UNIQUE(provider_key, provider_event_id)
);
CREATE INDEX ix_ticket_payment_events_order ON ticket_payment_events(order_id)
    WHERE order_id IS NOT NULL;
CREATE INDEX ix_ticket_payment_events_pending ON ticket_payment_events(status, received_at)
    WHERE status IN ('RECEIVED','PROCESSING');

-- 6o. Organiser payouts (must be defined before ledger references it)
CREATE TABLE ticket_organiser_payouts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    payout_account_id uuid NOT NULL REFERENCES event_organiser_payout_accounts(id) ON DELETE RESTRICT,
    organiser_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    business_account_id uuid REFERENCES business_accounts(id) ON DELETE RESTRICT,
    period_start timestamptz NOT NULL,
    period_end timestamptz NOT NULL,
    gross_revenue numeric(12,2) NOT NULL CHECK(gross_revenue >= 0),
    total_platform_fees numeric(12,2) NOT NULL DEFAULT 0 CHECK(total_platform_fees >= 0),
    total_refunds_deducted numeric(12,2) NOT NULL DEFAULT 0 CHECK(total_refunds_deducted >= 0),
    net_payout_amount numeric(12,2) NOT NULL CHECK(net_payout_amount >= 0),
    currency_code char(3) NOT NULL CHECK(currency_code ~ '^[A-Z]{3}$'),
    tickets_sold_count integer NOT NULL DEFAULT 0 CHECK(tickets_sold_count >= 0),
    tickets_refunded_count integer NOT NULL DEFAULT 0 CHECK(tickets_refunded_count >= 0),
    status varchar(20) NOT NULL DEFAULT 'PENDING'
        CHECK(status IN ('PENDING','PROCESSING','COMPLETED','FAILED','ON_HOLD','CANCELLED')),
    -- How the platform disburses the payout. MANUAL = staff transfer via banking
    -- facilities (universal). STRIPE_GLOBAL = Stripe Global Payouts, a later
    -- per-country option that pays the organiser's bank without a Stripe account.
    disbursement_method varchar(20) NOT NULL DEFAULT 'MANUAL'
        CHECK(disbursement_method IN ('MANUAL','STRIPE_GLOBAL')),
    provider_payout_id text,  -- Stripe payout object id when disbursement_method='STRIPE_GLOBAL'
    requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,  -- user who submitted the payout request (NULL = admin-initiated)
    approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,   -- admin who approved the payout
    approved_at timestamptz,
    transfer_reference text,   -- bank transfer ref / mobile money txn id recorded by staff
    transferred_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,  -- staff who made the transfer
    failure_reason text,
    idempotency_key text UNIQUE,
    scheduled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CHECK(period_end >= period_start),
    CHECK((organiser_user_id IS NOT NULL)::int + (business_account_id IS NOT NULL)::int = 1),
    CHECK(approved_at IS NULL OR approved_by_user_id IS NOT NULL),
    CHECK(provider_payout_id IS NULL OR disbursement_method='STRIPE_GLOBAL'),
    CHECK(status NOT IN ('PROCESSING','COMPLETED') OR approved_at IS NOT NULL),
    CHECK(status <> 'COMPLETED' OR completed_at IS NOT NULL),
    CHECK(status <> 'COMPLETED' OR disbursement_method <> 'MANUAL'
        OR transfer_reference IS NOT NULL)
);
CREATE UNIQUE INDEX ux_ticket_payouts_provider
    ON ticket_organiser_payouts(provider_payout_id)
    WHERE provider_payout_id IS NOT NULL;
CREATE INDEX ix_ticket_payouts_event ON ticket_organiser_payouts(event_id, status);
CREATE INDEX ix_ticket_payouts_pending ON ticket_organiser_payouts(status, scheduled_at)
    WHERE status IN ('PENDING','PROCESSING');

-- 6p. Organiser financial ledger (immutable journal of all money movements)
--     Running balance = SUM(credit_amount - debit_amount) per event/organiser.
CREATE TABLE ticket_organiser_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    organiser_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    business_account_id uuid REFERENCES business_accounts(id) ON DELETE RESTRICT,
    entry_type varchar(30) NOT NULL
        CHECK(entry_type IN ('TICKET_SALE','PLATFORM_FEE','REFUND_DEDUCTION',
            'FEE_REFUND','PAYOUT','ADJUSTMENT')),
    order_id uuid REFERENCES ticket_orders(id) ON DELETE RESTRICT,
    refund_id uuid REFERENCES ticket_refunds(id) ON DELETE RESTRICT,
    payout_id uuid REFERENCES ticket_organiser_payouts(id) ON DELETE RESTRICT,
    credit_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK(credit_amount >= 0),
    debit_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK(debit_amount >= 0),
    currency_code char(3) NOT NULL CHECK(currency_code ~ '^[A-Z]{3}$'),
    description text,
    idempotency_key text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK((organiser_user_id IS NOT NULL)::int + (business_account_id IS NOT NULL)::int = 1),
    CHECK(credit_amount > 0 OR debit_amount > 0),
    CHECK(NOT (credit_amount > 0 AND debit_amount > 0)),
    -- entry_type consistency: each type must link to its source record
    CHECK(entry_type <> 'TICKET_SALE' OR order_id IS NOT NULL),
    CHECK(entry_type <> 'REFUND_DEDUCTION' OR refund_id IS NOT NULL),
    CHECK(entry_type <> 'FEE_REFUND' OR refund_id IS NOT NULL),
    CHECK(entry_type <> 'PAYOUT' OR payout_id IS NOT NULL)
);
CREATE INDEX ix_ticket_organiser_ledger_event
    ON ticket_organiser_ledger(event_id, created_at);
CREATE INDEX ix_ticket_organiser_ledger_user
    ON ticket_organiser_ledger(organiser_user_id, created_at DESC)
    WHERE organiser_user_id IS NOT NULL;
CREATE INDEX ix_ticket_organiser_ledger_biz
    ON ticket_organiser_ledger(business_account_id, created_at DESC)
    WHERE business_account_id IS NOT NULL;

-- Immutability: ledger entries cannot be updated or deleted, only appended
CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Ledger entries are immutable. Use ADJUSTMENT entries to correct.'
        USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER trg_ticket_ledger_immutable_update
    BEFORE UPDATE ON ticket_organiser_ledger
    FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE TRIGGER trg_ticket_ledger_immutable_delete
    BEFORE DELETE ON ticket_organiser_ledger
    FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

-- 6q. Ticket fee configuration (per country, configurable by admin)
CREATE TABLE ticket_fee_configurations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id uuid REFERENCES countries(id) ON DELETE CASCADE,
    event_category_id uuid REFERENCES event_categories(id) ON DELETE SET NULL,
    fixed_fee_minor bigint NOT NULL DEFAULT 0 CHECK(fixed_fee_minor >= 0),
    commission_rate_bps integer NOT NULL DEFAULT 0 CHECK(commission_rate_bps BETWEEN 0 AND 5000),
    currency_code char(3) NOT NULL CHECK(currency_code ~ '^[A-Z]{3}$'),
    fee_model varchar(30) NOT NULL DEFAULT 'BUYER_PAYS'
        CHECK(fee_model IN ('BUYER_PAYS','ORGANISER_ABSORBS','SPLIT')),
    organiser_split_bps integer CHECK(organiser_split_bps IS NULL OR organiser_split_bps BETWEEN 0 AND 10000),
    min_payout_amount numeric(12,2) CHECK(min_payout_amount IS NULL OR min_payout_amount >= 0),
    payout_delay_days integer NOT NULL DEFAULT 7 CHECK(payout_delay_days BETWEEN 0 AND 90),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(fee_model <> 'SPLIT' OR organiser_split_bps IS NOT NULL),
    CHECK(fee_model = 'SPLIT' OR organiser_split_bps IS NULL)
);
-- Only one active fee config per (country, category) combination
-- NULLS NOT DISTINCT needed because event_category_id can be NULL (all categories)
CREATE UNIQUE INDEX ux_ticket_fee_config_active
    ON ticket_fee_configurations(country_id, event_category_id)
    NULLS NOT DISTINCT
    WHERE is_active;
CREATE INDEX ix_ticket_fee_config_country ON ticket_fee_configurations(country_id, is_active)
    WHERE is_active;

-- =====================================================================
-- 7. SPARE BAG MODULE REDESIGN
-- =====================================================================

-- 7a. Measurement units reference table
CREATE TABLE spare_bag_measurement_units (
    unit_code varchar(10) PRIMARY KEY CHECK(unit_code = upper(trim(unit_code))),
    display_name varchar(50) NOT NULL,
    unit_type varchar(20) NOT NULL CHECK(unit_type IN ('WEIGHT','VOLUME','PIECE','PAIR','PACKAGE'))
);
INSERT INTO spare_bag_measurement_units(unit_code, display_name, unit_type) VALUES
 ('KG','Kilogram','WEIGHT'),('G','Gram','WEIGHT'),
 ('ML','Millilitre','VOLUME'),('L','Litre','VOLUME'),
 ('PIECE','Piece','PIECE'),('PAIR','Pair','PAIR'),
 ('BOX','Box','PACKAGE'),('PACK','Pack','PACKAGE')
ON CONFLICT(unit_code) DO NOTHING;

-- 7b. Traveller profiles (reusable, separate from individual journeys)
CREATE TABLE spare_bag_traveller_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    display_name varchar(150),
    bio text CHECK(bio IS NULL OR length(bio) <= 2000),
    -- verification_status is the single source of truth; is_verified is
    -- derived (verification_status = 'VERIFIED') at query time
    verification_status varchar(20) NOT NULL DEFAULT 'NOT_VERIFIED'
        CHECK(verification_status IN ('NOT_VERIFIED','PENDING','VERIFIED','REJECTED','REVOKED')),
    -- text[] validated at app layer against spare_bag_categories.category_key
    accepted_item_categories text[],
    regular_routes jsonb,
    status varchar(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK(status IN ('ACTIVE','PAUSED','SUSPENDED','CLOSED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_spare_bag_traveller_profiles_status ON spare_bag_traveller_profiles(status)
    WHERE status = 'ACTIVE';

-- 7c. Sender requests (Items to Send tab)
CREATE TABLE spare_bag_sender_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_country_id uuid NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
    from_city varchar(150) NOT NULL CHECK(length(trim(from_city)) BETWEEN 1 AND 150),
    to_country_id uuid NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
    to_city varchar(150) NOT NULL CHECK(length(trim(to_city)) BETWEEN 1 AND 150),
    description text CHECK(description IS NULL OR length(description) <= 5000),
    status varchar(20) NOT NULL DEFAULT 'DRAFT'
        CHECK(status IN ('DRAFT','PENDING_REVIEW','PUBLISHED','PAUSED','MATCHED','CLOSED','EXPIRED','REMOVED')),
    published_at timestamptz,
    closes_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CHECK(from_country_id <> to_country_id OR from_city <> to_city),
    CHECK(closes_at IS NULL OR closes_at > created_at)
);
CREATE INDEX ix_spare_bag_sender_requests_route
    ON spare_bag_sender_requests(from_country_id, to_country_id, status)
    WHERE deleted_at IS NULL;
CREATE INDEX ix_spare_bag_sender_requests_owner
    ON spare_bag_sender_requests(owner_user_id, status, created_at DESC)
    WHERE deleted_at IS NULL;

-- 7d. Sender items (line items within a sender request)
CREATE TABLE spare_bag_sender_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_request_id uuid NOT NULL REFERENCES spare_bag_sender_requests(id) ON DELETE CASCADE,
    item_name varchar(200) NOT NULL CHECK(length(trim(item_name)) BETWEEN 1 AND 200),
    item_description text CHECK(item_description IS NULL OR length(item_description) <= 1000),
    category_key text REFERENCES spare_bag_categories(category_key) ON DELETE RESTRICT,
    quantity numeric(10,2) NOT NULL CHECK(quantity > 0),
    unit_code varchar(10) NOT NULL REFERENCES spare_bag_measurement_units(unit_code) ON DELETE RESTRICT,
    per_unit_amount numeric(10,2) CHECK(per_unit_amount IS NULL OR per_unit_amount > 0),
    per_unit_unit varchar(10) REFERENCES spare_bag_measurement_units(unit_code) ON DELETE RESTRICT,
    declared_value_amount numeric(12,2) CHECK(declared_value_amount IS NULL OR declared_value_amount >= 0),
    declared_value_currency char(3) CHECK(declared_value_currency IS NULL OR declared_value_currency ~ '^[A-Z]{3}$'),
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK((per_unit_amount IS NULL) = (per_unit_unit IS NULL)),
    CHECK((declared_value_amount IS NULL) = (declared_value_currency IS NULL))
);
CREATE INDEX ix_spare_bag_sender_items_request ON spare_bag_sender_items(sender_request_id, sort_order);

-- 7e. Sender request media
CREATE TABLE spare_bag_sender_request_media (
    sender_request_id uuid NOT NULL REFERENCES spare_bag_sender_requests(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE RESTRICT,
    sort_order integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(sender_request_id, media_id),
    UNIQUE(sender_request_id, sort_order)
);

-- 7f. Traveller journeys (posted by travellers with spare capacity)
CREATE TABLE spare_bag_traveller_journeys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    traveller_profile_id uuid NOT NULL REFERENCES spare_bag_traveller_profiles(id) ON DELETE CASCADE,
    from_country_id uuid NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
    from_city varchar(150) NOT NULL CHECK(length(trim(from_city)) BETWEEN 1 AND 150),
    to_country_id uuid NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
    to_city varchar(150) NOT NULL CHECK(length(trim(to_city)) BETWEEN 1 AND 150),
    from_airport_id uuid REFERENCES airports(id) ON DELETE SET NULL,
    to_airport_id uuid REFERENCES airports(id) ON DELETE SET NULL,
    pickup_location text CHECK(pickup_location IS NULL OR length(pickup_location) <= 500),
    delivery_location text CHECK(delivery_location IS NULL OR length(delivery_location) <= 500),
    -- application should enforce travel_date >= CURRENT_DATE for new PUBLISHED journeys
    travel_date date NOT NULL,
    travel_date_end date,
    available_capacity_kg numeric(8,2) CHECK(available_capacity_kg IS NULL OR available_capacity_kg > 0),
    max_single_parcel_kg numeric(8,2) CHECK(max_single_parcel_kg IS NULL OR max_single_parcel_kg > 0),
    price_per_kg numeric(12,2) CHECK(price_per_kg IS NULL OR price_per_kg >= 0),
    price_per_piece numeric(12,2) CHECK(price_per_piece IS NULL OR price_per_piece >= 0),
    price_currency char(3) CHECK(price_currency IS NULL OR price_currency ~ '^[A-Z]{3}$'),
    accepted_categories text[], -- app-layer validated against spare_bag_categories
    notes text CHECK(notes IS NULL OR length(notes) <= 3000),
    status varchar(20) NOT NULL DEFAULT 'DRAFT'
        CHECK(status IN ('DRAFT','PENDING_REVIEW','PUBLISHED','PAUSED','CLOSED','EXPIRED','REMOVED')),
    published_at timestamptz,
    closes_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CHECK(travel_date_end IS NULL OR travel_date_end >= travel_date),
    CHECK(from_country_id <> to_country_id OR from_city <> to_city),
    CHECK(max_single_parcel_kg IS NULL OR available_capacity_kg IS NULL OR max_single_parcel_kg <= available_capacity_kg),
    CHECK(closes_at IS NULL OR closes_at > created_at),
    -- If any price is set, a currency must be provided
    CHECK((price_per_kg IS NULL AND price_per_piece IS NULL) OR price_currency IS NOT NULL)
);
CREATE INDEX ix_spare_bag_journeys_route
    ON spare_bag_traveller_journeys(from_country_id, to_country_id, travel_date, status)
    WHERE deleted_at IS NULL;
CREATE INDEX ix_spare_bag_journeys_traveller
    ON spare_bag_traveller_journeys(traveller_profile_id, status, created_at DESC)
    WHERE deleted_at IS NULL;

-- 7g. Spare Bag country-level configuration
CREATE TABLE spare_bag_country_config (
    country_id uuid PRIMARY KEY REFERENCES countries(id) ON DELETE CASCADE,
    is_enabled boolean NOT NULL DEFAULT true,
    requires_item_disclosure boolean NOT NULL DEFAULT true,
    prohibited_categories text[], -- app-layer validated against spare_bag_categories
    legal_notice text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Note: The old spare_bag_listings, spare_bag_listing_categories, spare_bag_listing_media,
-- spare_bag_listing_saves, and spare_bag_contact_requests tables are retained for backward
-- compatibility. A data migration should move existing data to the new tables in a separate
-- reviewed migration script. Do not drop old tables in this delta.


-- =====================================================================
-- 8. AI MODERATION MODULE
-- =====================================================================

-- 8a. Moderation review queue (central AI + human review)
CREATE TABLE moderation_queue (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    content_type varchar(40) NOT NULL
        CHECK(content_type IN ('FEED_POST','COMMENT','POLL','PROFILE','PROFILE_PICTURE',
            'BUSINESS_PROFILE','PROPERTY_LISTING','VEHICLE_LISTING','JOB_LISTING',
            'SHOP','SHOP_PRODUCT','AD_CAMPAIGN','AD_CREATIVE','PRIVATE_MESSAGE','GROUP_CHAT_MESSAGE',
            'VOICE_ROOM','EVENT','SERVICE_LISTING','SPARE_BAG_SENDER_REQUEST',
            'SPARE_BAG_TRAVELLER_JOURNEY','MATCHMAKING_PROFILE','MATCHMAKING_MATCH',
            'USER','COUNTRY_VERIFICATION','REVIEW')),
    -- UUID PK of the flagged content (all Diasporum tables use uuid PKs)
    content_id uuid NOT NULL,
    submitted_by varchar(20) NOT NULL CHECK(submitted_by IN ('AI','USER_REPORT','ADMIN','SYSTEM')),
    ai_risk_score numeric(5,4) CHECK(ai_risk_score IS NULL OR ai_risk_score BETWEEN 0 AND 1),
    ai_risk_level varchar(10) CHECK(ai_risk_level IS NULL OR ai_risk_level IN ('LOW','UNCERTAIN','HIGH')),
    ai_categories text[],
    ai_provider text,
    ai_response_id text,
    queue_status varchar(20) NOT NULL DEFAULT 'PENDING'
        CHECK(queue_status IN ('PENDING','ASSIGNED','IN_REVIEW','RESOLVED','ESCALATED','AUTO_RESOLVED')),
    assigned_to_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    priority integer NOT NULL DEFAULT 0,
    decision varchar(20)
        CHECK(decision IS NULL OR decision IN ('APPROVE','REJECT','RESTRICT','QUARANTINE','WARN','ESCALATE')),
    decision_reason text,
    decided_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- decision and decided_at must be set together (or both NULL)
    CHECK((decision IS NULL) = (decided_at IS NULL))
);
CREATE INDEX ix_moderation_queue_pending ON moderation_queue(queue_status, priority DESC, created_at)
    WHERE queue_status IN ('PENDING','ASSIGNED','ESCALATED');
CREATE INDEX ix_moderation_queue_content ON moderation_queue(content_type, content_id, created_at DESC);
CREATE INDEX ix_moderation_queue_assigned ON moderation_queue(assigned_to_user_id, queue_status)
    WHERE assigned_to_user_id IS NOT NULL;

-- Deferred FK: ad_campaigns.moderation_queue_id -> moderation_queue.id
ALTER TABLE ad_campaigns
    ADD CONSTRAINT fk_ad_campaigns_moderation_queue
        FOREIGN KEY (moderation_queue_id) REFERENCES moderation_queue(id) ON DELETE SET NULL;

-- 8b. Moderation policy rules (thresholds per content type)
CREATE TABLE moderation_policy_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_key varchar(80) NOT NULL UNIQUE
        CHECK(policy_key = upper(trim(policy_key)) AND policy_key ~ '^[A-Z][A-Z0-9_]*$'),
    content_type varchar(40) NOT NULL
        CHECK(content_type IN ('FEED_POST','COMMENT','POLL','PROFILE','PROFILE_PICTURE',
            'BUSINESS_PROFILE','PROPERTY_LISTING','VEHICLE_LISTING','JOB_LISTING',
            'SHOP','SHOP_PRODUCT','AD_CAMPAIGN','AD_CREATIVE','PRIVATE_MESSAGE','GROUP_CHAT_MESSAGE',
            'VOICE_ROOM','EVENT','SERVICE_LISTING','SPARE_BAG_SENDER_REQUEST',
            'SPARE_BAG_TRAVELLER_JOURNEY','MATCHMAKING_PROFILE','MATCHMAKING_MATCH',
            'USER','COUNTRY_VERIFICATION','REVIEW')),
    risk_threshold_auto_approve numeric(5,4) NOT NULL DEFAULT 0.2
        CHECK(risk_threshold_auto_approve BETWEEN 0 AND 1),
    risk_threshold_auto_reject numeric(5,4) NOT NULL DEFAULT 0.9
        CHECK(risk_threshold_auto_reject BETWEEN 0 AND 1),
    requires_human_review boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(risk_threshold_auto_reject > risk_threshold_auto_approve)
);

-- 8c. Seed moderation policy rules
INSERT INTO moderation_policy_rules(policy_key, content_type, risk_threshold_auto_approve, risk_threshold_auto_reject, requires_human_review) VALUES
 ('FEED_POST_MODERATION','FEED_POST',0.2,0.85,false),
 ('COMMENT_MODERATION','COMMENT',0.2,0.85,false),
 ('POLL_MODERATION','POLL',0.2,0.85,false),
 ('PROFILE_MODERATION','PROFILE',0.3,0.9,false),
 ('PROFILE_PICTURE_MODERATION','PROFILE_PICTURE',0.2,0.8,false),
 ('BUSINESS_PROFILE_MODERATION','BUSINESS_PROFILE',0.3,0.85,true),
 ('PROPERTY_LISTING_MODERATION','PROPERTY_LISTING',0.3,0.85,true),
 ('VEHICLE_LISTING_MODERATION','VEHICLE_LISTING',0.3,0.85,true),
 ('JOB_LISTING_MODERATION','JOB_LISTING',0.3,0.85,true),
 ('SHOP_PRODUCT_MODERATION','SHOP_PRODUCT',0.3,0.85,false),
 ('AD_CAMPAIGN_MODERATION','AD_CAMPAIGN',0.15,0.7,true),
 ('AD_CREATIVE_MODERATION','AD_CREATIVE',0.15,0.7,true),
 ('EVENT_MODERATION','EVENT',0.3,0.85,false),
 ('SERVICE_LISTING_MODERATION','SERVICE_LISTING',0.3,0.85,false),
 ('MATCHMAKING_PROFILE_MODERATION','MATCHMAKING_PROFILE',0.3,0.85,false)
ON CONFLICT(policy_key) DO NOTHING;

-- 8d. Moderation appeals
CREATE TABLE moderation_appeals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    moderation_queue_id uuid REFERENCES moderation_queue(id) ON DELETE CASCADE,
    moderation_action_id uuid REFERENCES moderation_actions(id) ON DELETE CASCADE,
    appellant_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    appeal_reason text NOT NULL CHECK(length(trim(appeal_reason)) BETWEEN 1 AND 4000),
    status varchar(20) NOT NULL DEFAULT 'SUBMITTED'
        CHECK(status IN ('SUBMITTED','IN_REVIEW','UPHELD','OVERTURNED','DISMISSED')),
    reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    review_notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    reviewed_at timestamptz,
    CHECK(moderation_queue_id IS NOT NULL OR moderation_action_id IS NOT NULL)
);
CREATE INDEX ix_moderation_appeals_status ON moderation_appeals(status, created_at)
    WHERE status IN ('SUBMITTED','IN_REVIEW');
CREATE INDEX ix_moderation_appeals_user ON moderation_appeals(appellant_user_id, created_at DESC);

-- 8e. Moderation audit log (all automated + manual decisions)
CREATE TABLE moderation_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    moderation_queue_id uuid REFERENCES moderation_queue(id) ON DELETE SET NULL,
    action_type varchar(30) NOT NULL
        CHECK(action_type IN ('AI_REVIEW','HUMAN_REVIEW','AUTO_ACTION','MANUAL_ACTION',
            'APPEAL_SUBMITTED','APPEAL_REVIEWED','CONTENT_RESTORED','ACCOUNT_SANCTION')),
    actor_type varchar(20) NOT NULL CHECK(actor_type IN ('AI','ADMIN','MODERATOR','SYSTEM')),
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    content_type varchar(40),
    content_id uuid,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_moderation_audit_log_queue ON moderation_audit_log(moderation_queue_id, created_at DESC)
    WHERE moderation_queue_id IS NOT NULL;
CREATE INDEX ix_moderation_audit_log_target ON moderation_audit_log(target_user_id, created_at DESC)
    WHERE target_user_id IS NOT NULL;


-- =====================================================================
-- 9. ON-DEMAND TRANSLATION
-- =====================================================================

CREATE TABLE content_translations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    content_type varchar(40) NOT NULL
        CHECK(content_type IN ('FEED_POST','COMMENT','POLL_QUESTION','POLL_OPTION',
            'EVENT_DESCRIPTION','BUSINESS_POST','PROPERTY_DESCRIPTION','VEHICLE_DESCRIPTION',
            'JOB_DESCRIPTION','SHOP_PRODUCT_DESCRIPTION','SERVICE_LISTING',
            'GROUP_CHAT_MESSAGE')),
    content_id uuid NOT NULL,
    field_name varchar(60) NOT NULL DEFAULT 'body',
    source_language_code varchar(20) NOT NULL REFERENCES languages(language_code) ON DELETE RESTRICT,
    target_language_code varchar(20) NOT NULL REFERENCES languages(language_code) ON DELETE RESTRICT,
    translated_text text NOT NULL,
    provider text NOT NULL,
    provider_response_id text,
    content_hash varchar(64) NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
    confidence_score numeric(5,4) CHECK(confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    CHECK(source_language_code <> target_language_code),
    CHECK(expires_at IS NULL OR expires_at > created_at)
);
CREATE UNIQUE INDEX ux_content_translations_target
    ON content_translations(content_type, content_id, field_name, target_language_code);
CREATE INDEX ix_content_translations_content
    ON content_translations(content_type, content_id);
CREATE INDEX ix_content_translations_expires
    ON content_translations(expires_at) WHERE expires_at IS NOT NULL;


-- =====================================================================
-- 10. COUNTRY VERIFICATION
-- =====================================================================

-- 10a. Country verification records
CREATE TABLE country_verifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    country_id uuid NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
    verification_method varchar(30) NOT NULL
        CHECK(verification_method IN ('LIVE_LOCATION','MANUAL_REVIEW','ADMIN_OVERRIDE','DOCUMENT')),
    latitude numeric(9,6) CHECK(latitude IS NULL OR latitude BETWEEN -90 AND 90),
    longitude numeric(9,6) CHECK(longitude IS NULL OR longitude BETWEEN -180 AND 180),
    location_accuracy_m numeric(10,2) CHECK(location_accuracy_m IS NULL OR location_accuracy_m >= 0),
    verified_at timestamptz,
    expires_at timestamptz,
    status varchar(20) NOT NULL DEFAULT 'PENDING'
        CHECK(status IN ('PENDING','VERIFIED','FAILED','EXPIRED','REVOKED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK((latitude IS NULL) = (longitude IS NULL)),
    CHECK(status <> 'VERIFIED' OR verified_at IS NOT NULL)
);
CREATE INDEX ix_country_verifications_user ON country_verifications(user_id, status, created_at DESC);
CREATE INDEX ix_country_verifications_active ON country_verifications(user_id, country_id, status)
    WHERE status = 'VERIFIED';

-- 10b. Country verification configuration (admin-managed)
CREATE TABLE country_verification_config (
    country_id uuid PRIMARY KEY REFERENCES countries(id) ON DELETE CASCADE,
    verification_required boolean NOT NULL DEFAULT false,
    grace_period_days integer NOT NULL DEFAULT 30 CHECK(grace_period_days >= 0),
    reverification_interval_days integer CHECK(reverification_interval_days IS NULL OR reverification_interval_days > 0),
    allowed_methods text[] NOT NULL DEFAULT '{LIVE_LOCATION}'
        CHECK(allowed_methods <@ '{LIVE_LOCATION,MANUAL_REVIEW,ADMIN_OVERRIDE,DOCUMENT}'::text[]
            AND array_length(allowed_methods, 1) > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);


-- =====================================================================
-- 11. BUSINESS ACCOUNT ENHANCEMENTS
-- =====================================================================

-- 11a. Violation tracking and identity verification on business_accounts
ALTER TABLE business_accounts
    ADD COLUMN IF NOT EXISTS violation_count integer NOT NULL DEFAULT 0 CHECK(violation_count >= 0),
    ADD COLUMN IF NOT EXISTS restricted_until timestamptz,
    ADD COLUMN IF NOT EXISTS identity_verified boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS identity_verification_required boolean NOT NULL DEFAULT false;

-- 11b. Add-on packages (extra listing quotas)
CREATE TABLE billing_addon_packages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    package_key varchar(80) NOT NULL UNIQUE
        CHECK(package_key = upper(trim(package_key)) AND package_key ~ '^[A-Z0-9_]+$'),
    display_name varchar(200) NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 200),
    description text,
    target_feature_key text NOT NULL,
    quantity_granted integer NOT NULL CHECK(quantity_granted > 0),
    validity_days integer NOT NULL CHECK(validity_days > 0),
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Validate target_feature_key references billing_features
CREATE OR REPLACE FUNCTION validate_addon_feature_key()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM billing_features WHERE feature_key = NEW.target_feature_key AND is_active) THEN
        RAISE EXCEPTION 'Add-on package must reference an active billing feature'
            USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_addon_feature_key
    BEFORE INSERT OR UPDATE OF target_feature_key ON billing_addon_packages
    FOR EACH ROW EXECUTE FUNCTION validate_addon_feature_key();

-- 11c. Add-on package prices
CREATE TABLE billing_addon_prices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    addon_package_id uuid NOT NULL REFERENCES billing_addon_packages(id) ON DELETE CASCADE,
    currency_code char(3) NOT NULL CHECK(currency_code ~ '^[A-Z]{3}$'),
    amount numeric(12,2) NOT NULL CHECK(amount > 0),
    provider_key text,
    provider_product_id text,
    is_active boolean NOT NULL DEFAULT true,
    effective_from timestamptz NOT NULL DEFAULT now(),
    effective_until timestamptz,
    UNIQUE(addon_package_id, currency_code, effective_from),
    CHECK(effective_until IS NULL OR effective_until > effective_from)
);

-- 11d. Seed example add-on packages (admin must configure pricing before enabling)
INSERT INTO billing_addon_packages(package_key, display_name, description, target_feature_key, quantity_granted, validity_days) VALUES
 ('EXTRA_PROPERTY_30','30 Extra Property Listings','Additional property listing quota','PROPERTY_LISTING_PUBLISH',30,365),
 ('EXTRA_PROPERTY_50','50 Extra Property Listings','Additional property listing quota','PROPERTY_LISTING_PUBLISH',50,365),
 ('EXTRA_VEHICLE_30','30 Extra Vehicle Listings','Additional vehicle listing quota','VEHICLE_LISTING_PUBLISH',30,365),
 ('EXTRA_JOB_30','30 Extra Job Listings','Additional job listing quota','JOB_LISTING_PUBLISH',30,365),
 ('EXTRA_JOB_50','50 Extra Job Listings','Additional job listing quota','JOB_LISTING_PUBLISH',50,365)
ON CONFLICT(package_key) DO NOTHING;


-- =====================================================================
-- 12. MATCHMAKING VISIBILITY ENHANCEMENTS
-- =====================================================================

-- Add matchmaking-specific visibility column (more granular than the
-- existing visibility_scope enum). matchmaking_visibility controls
-- matchmaking-specific discovery; visibility_scope controls general
-- profile visibility. Both exist — matchmaking_visibility takes
-- precedence for matchmaking features.
ALTER TABLE matchmaking_profiles
    ADD COLUMN IF NOT EXISTS matchmaking_visibility text NOT NULL DEFAULT 'OWN_COMMUNITY'
        CHECK(matchmaking_visibility IN (
            'OWN_COMMUNITY',
            'SAME_CURRENT_COUNTRY',
            'SAME_ORIGIN_COUNTRY',
            'SELECTED_COMMUNITIES'
        ));

COMMENT ON COLUMN matchmaking_profiles.matchmaking_visibility IS
    'Controls who can see this profile: OWN_COMMUNITY = only in primary community, '
    'SAME_CURRENT_COUNTRY = communities with same destination country, '
    'SAME_ORIGIN_COUNTRY = communities with same origin country, '
    'SELECTED_COMMUNITIES = specific list in matchmaking_profile_communities.';

COMMENT ON COLUMN feed_posts.community_id IS
    'The author''s anchor/origin community — always populated even when '
    'target_mode distributes the post to multiple communities.';


-- =====================================================================
-- 13. EXTEND EVENTS FOR BUSINESS OWNERSHIP AND VISIBILITY
-- =====================================================================

-- The existing ck_events_visibility_v10 handles visibility_scope + community_id.
-- target_mode is additive and checked via its own column CHECK (added in 6b).
-- No constraint cleanup is needed here — the baseline events table has no
-- target_mode CHECK to drop.


-- =====================================================================
-- 14. UPDATE featured_placement_rules FOR NEW CONTENT TYPES
-- =====================================================================
-- NOTE: This INSERT uses the 'SERVICE' enum value added at the top of this
-- file. PostgreSQL does not allow using a newly added enum value within the
-- same transaction. This insert MUST run in a separate migration/commit:
--
--   INSERT INTO featured_placement_rules(content_type, placement_key) VALUES
--    ('SERVICE','MAIN_FEED'),('SERVICE','SERVICE_MARKETPLACE')
--   ON CONFLICT(content_type, placement_key) DO NOTHING;
--
-- If this file is executed as a single Flyway migration (transactional),
-- remove the BEGIN/COMMIT wrapper and run this insert separately.


-- =====================================================================
-- 15. EXTEND billing_products FOR AD AND TICKETING TARGETS
-- =====================================================================

-- The existing CHECK on billing_products.target_type needs updating for new types.
-- Drop the old CHECK and add an expanded one.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'billing_products'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%target_type%'
      AND conname NOT LIKE '%product_kind%'
  LOOP EXECUTE format('ALTER TABLE billing_products DROP CONSTRAINT %I', c.conname); END LOOP;
END $$;

ALTER TABLE billing_products
    ADD CONSTRAINT ck_billing_products_target_type_v10_15
        CHECK(target_type IN ('PROPERTY','VEHICLE','EVENT','JOB','BUSINESS','FEED_POST',
            'VOICE_ROOM','AD_CAMPAIGN','SPARE_BAG','SERVICE','SHOP','PRODUCT','OTHER'));


-- =====================================================================
-- 16. EXTEND media_objects PURPOSE FOR NEW MODULES
-- =====================================================================

-- The purpose CHECK on media_objects needs to allow new module purposes.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'media_objects'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%purpose%'
  LOOP EXECUTE format('ALTER TABLE media_objects DROP CONSTRAINT %I', c.conname); END LOOP;
END $$;

ALTER TABLE media_objects
    ADD CONSTRAINT ck_media_objects_purpose_v10_15
        CHECK(purpose IN ('AVATAR','FEED_IMAGE','FEED_VIDEO','FEED_AUDIO','BUSINESS','EVENT',
            'JOB','MATCHMAKING_PROFILE_PHOTO','MATCHMAKING_PROFILE_BLURRED','CHAT_ATTACHMENT',
            'SPARE_BAG_LISTING','SPARE_BAG_SENDER','SPARE_BAG_TRAVELLER',
            'SHOP','PRODUCT','AD_CREATIVE','TICKET','MODERATION_EVIDENCE',
            'DOCUMENT','OTHER'));


-- =====================================================================
-- 17. EXTEND direct_conversations CONTEXT FOR CROSS-COMMUNITY MESSAGING
-- =====================================================================

-- Add new context types to the direct_conversations context_type CHECK.
-- Cross-community messaging: no community boundary on DMs.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'direct_conversations'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%context_type%'
  LOOP EXECUTE format('ALTER TABLE direct_conversations DROP CONSTRAINT %I', c.conname); END LOOP;
END $$;

ALTER TABLE direct_conversations
    ADD CONSTRAINT ck_direct_conversations_context_type_v10_15
        CHECK(context_type IN ('GENERAL','PROPERTY_LISTING','VEHICLE_LISTING','BUSINESS_PROFILE',
            'EVENT','JOB_LISTING','SPARE_BAG_CONTACT','SERVICE_REQUEST','COMMUNITY_HELP_POST',
            'SHOP','SHOP_PRODUCT','SHOP_ORDER',
            'SPARE_BAG_SENDER_REQUEST','SPARE_BAG_TRAVELLER_JOURNEY',
            'AD_CAMPAIGN'));

-- Re-add the context_id presence CHECK (was dropped by the DO block above)
ALTER TABLE direct_conversations
    ADD CONSTRAINT ck_direct_conversations_context_id_v10_15
        CHECK((context_type = 'GENERAL' AND context_id IS NULL)
           OR (context_type <> 'GENERAL' AND context_id IS NOT NULL));


-- =====================================================================
-- 18. SERVICE MARKETPLACE — COUNTRY-ONLY ACCESS
-- =====================================================================

-- Service marketplace should not cross country boundaries.
-- This is enforced by the application layer using service_requests.country_id
-- and service_providers.base_location + country-scoped provider discovery.
-- No schema change needed; this is documented as a backend invariant.
COMMENT ON TABLE service_requests IS
    'Service requests are country-scoped. Discovery and lead access must not cross '
    'country boundaries. The application must enforce that providers and customers '
    'are in the same country as the service request.';


-- =====================================================================
-- 19. SHOPS — CROSS-COMMUNITY SHOPPING FILTER SUPPORT
-- =====================================================================

-- Shops are owned by local businesses. Cross-community shopping is allowed.
-- Users filter by own community and same-current-country communities (not same origin).
-- No additional table needed; the application applies community destination_country_id
-- filtering on shop/product queries. Document the invariant:
COMMENT ON TABLE shops IS
    'Shop marketplace. Cross-community shopping is allowed. Users can filter products '
    'from own community and communities of same current country (destination_country_id). '
    'Shop and product discovery is not restricted by community origin.';


-- =====================================================================
-- 20. LISTINGS VISIBILITY — SAME CURRENT COUNTRY
-- =====================================================================

-- Property, vehicle, job, and business listings can be created in own community
-- and communities of same current country. Other community users can view and contact.
-- This is enforced by the application validating that all selected communities in
-- property_listing_communities, vehicle_listing_communities, job_listing_communities,
-- and business_listing_communities share the same destination_country_id.
-- Document the invariant:
COMMENT ON TABLE property_listing_communities IS
    'Listings can only be created in communities of same current country as the lister. '
    'Users in other communities can view and contact listers but cannot create listings there. '
    'The application must validate that all selected communities share destination_country_id.';


-- =====================================================================
-- 21. MISCELLANEOUS INDEXES AND CONSTRAINTS
-- =====================================================================

-- Index for same-origin community lookups
CREATE INDEX IF NOT EXISTS ix_communities_origin_active
    ON communities(origin_country_id, is_active) WHERE is_active;

-- Index for same-current-country community lookups
CREATE INDEX IF NOT EXISTS ix_communities_destination_origin
    ON communities(destination_country_id, origin_country_id, is_active) WHERE is_active;

-- NOTE: ix_profiles_origin_current already exists on (origin_country_id, current_country_id)
-- in the baseline — no additional index needed for primary community resolution.


-- =====================================================================
-- 22. UPDATE README
-- =====================================================================

-- This schema delta adds the following new table groups (~48 new tables):
--
-- Community enhancements:
--   feed_post_community_stats
--
-- Advertising module (13 tables):
--   ad_call_to_action_types, ad_campaigns, ad_creatives, ad_creative_assets,
--   ad_creative_sources, ad_placement_types, ad_campaign_placements,
--   ad_campaign_community_targets, ad_campaign_status_history, ad_campaign_metrics,
--   ad_campaign_budget_ledger, ad_conversion_events, ad_community_sponsorships
--
-- Featured listing statistics:
--   featured_item_statistics
--
-- Event ticketing (16 tables):
--   payout_account_field_requirements, event_organiser_payout_accounts,
--   event_ticket_types, event_ticket_promo_codes, ticket_reservations,
--   ticket_orders, ticket_order_items, ticket_order_status_history,
--   issued_tickets, ticket_check_ins, ticket_refunds, ticket_payment_events,
--   ticket_organiser_payouts, ticket_organiser_ledger, ticket_fee_configurations
--
-- Spare Bag redesign (7 tables):
--   spare_bag_measurement_units, spare_bag_traveller_profiles,
--   spare_bag_sender_requests, spare_bag_sender_items, spare_bag_sender_request_media,
--   spare_bag_traveller_journeys, spare_bag_country_config
--
-- AI Moderation (4 tables):
--   moderation_queue, moderation_policy_rules, moderation_appeals, moderation_audit_log
--
-- Translation:
--   content_translations
--
-- Country verification (2 tables):
--   country_verifications, country_verification_config
--
-- Business add-ons (2 tables):
--   billing_addon_packages, billing_addon_prices
--
-- Column additions to existing tables:
--   community_memberships.membership_type
--   feed_posts.target_mode, cta_label, cta_url
--   events.business_account_id, is_ticketed, ticket_currency_code,
--     ticket_fee_model, refund_policy, refund_cutoff_hours,
--     cancellation_reason, cancelled_at, target_mode
--   business_accounts.violation_count, restricted_until,
--     identity_verified, identity_verification_required
--   matchmaking_profiles.matchmaking_visibility
--   ad_campaigns.fixed_fee_amount_minor, billing_order_id,
--     community_target_scope, total_impressions, total_clicks,
--     total_spend_minor, rejection_reason, moderation_queue_id
--
-- 17 new billing features seeded for cross-community access control
-- 15 moderation policy rules seeded
-- 9 ad placement types seeded
-- 17 CTA codes seeded
-- 13 payout field requirement rows seeded (13 countries)
-- 5 add-on packages seeded (pricing must be configured by admin)
-- Updated CHECK constraints on: billing_products, media_objects, direct_conversations
-- New CHECK constraints: ad_campaigns.pricing_model validations,
--   ticket_currency_code trigger, ticket_organiser_ledger immutability


-- =====================================================================
-- 21. MISSING FOREIGN KEY INDEXES
--     Indexes on all FK columns that lack supporting indexes.
--     Without these, parent DELETEs/UPDATEs cause sequential scans.
-- =====================================================================

-- ad_campaigns
CREATE INDEX IF NOT EXISTS ix_ad_campaigns_billing_order ON ad_campaigns(billing_order_id)
    WHERE billing_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ad_campaigns_created_by ON ad_campaigns(created_by_user_id);
CREATE INDEX IF NOT EXISTS ix_ad_campaigns_moderation ON ad_campaigns(moderation_queue_id)
    WHERE moderation_queue_id IS NOT NULL;

-- ad_creatives
CREATE INDEX IF NOT EXISTS ix_ad_creatives_created_by ON ad_creatives(created_by_user_id);

-- ad_creative_assets
CREATE INDEX IF NOT EXISTS ix_ad_creative_assets_media ON ad_creative_assets(media_asset_id);

-- ad_campaign_status_history
CREATE INDEX IF NOT EXISTS ix_ad_campaign_status_history_changed_by
    ON ad_campaign_status_history(changed_by_user_id) WHERE changed_by_user_id IS NOT NULL;

-- ad_campaign_budget_ledger
CREATE INDEX IF NOT EXISTS ix_ad_budget_ledger_created_by ON ad_campaign_budget_ledger(created_by_user_id)
    WHERE created_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ad_budget_ledger_billing_order ON ad_campaign_budget_ledger(billing_order_id)
    WHERE billing_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ad_budget_ledger_billing_payment ON ad_campaign_budget_ledger(billing_payment_id)
    WHERE billing_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ad_budget_ledger_billing_refund ON ad_campaign_budget_ledger(billing_refund_id)
    WHERE billing_refund_id IS NOT NULL;

-- ad_conversion_events
CREATE INDEX IF NOT EXISTS ix_ad_conversion_events_creative ON ad_conversion_events(creative_id)
    WHERE creative_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ad_conversion_events_community ON ad_conversion_events(community_id)
    WHERE community_id IS NOT NULL;

-- ad_community_sponsorships
CREATE INDEX IF NOT EXISTS ix_ad_community_sponsorships_logo ON ad_community_sponsorships(sponsor_logo_media_id)
    WHERE sponsor_logo_media_id IS NOT NULL;

-- ad_campaign_community_targets / ad_campaign_placements (2nd column of PK needs index for FK lookups)
CREATE INDEX IF NOT EXISTS ix_ad_campaign_community_targets_community ON ad_campaign_community_targets(community_id);
CREATE INDEX IF NOT EXISTS ix_ad_campaign_placements_placement ON ad_campaign_placements(placement_type_id);

-- ticket tables
CREATE INDEX IF NOT EXISTS ix_ticket_orders_promo ON ticket_orders(promo_code_id) WHERE promo_code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ticket_order_items_type ON ticket_order_items(ticket_type_id);
CREATE INDEX IF NOT EXISTS ix_issued_tickets_type ON issued_tickets(ticket_type_id);
CREATE INDEX IF NOT EXISTS ix_issued_tickets_checked_in_by ON issued_tickets(checked_in_by_user_id)
    WHERE checked_in_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_issued_tickets_transferred_to ON issued_tickets(transferred_to_ticket_id)
    WHERE transferred_to_ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ticket_check_ins_scanned_by ON ticket_check_ins(scanned_by_user_id)
    WHERE scanned_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ticket_refunds_issued ON ticket_refunds(issued_ticket_id)
    WHERE issued_ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ticket_refunds_requested_by ON ticket_refunds(requested_by)
    WHERE requested_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ticket_refunds_approved_by ON ticket_refunds(approved_by)
    WHERE approved_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ticket_payment_events_refund ON ticket_payment_events(refund_id)
    WHERE refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ticket_payouts_account ON ticket_organiser_payouts(payout_account_id);
CREATE INDEX IF NOT EXISTS ix_ticket_payouts_organiser ON ticket_organiser_payouts(organiser_user_id)
    WHERE organiser_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ticket_payouts_biz ON ticket_organiser_payouts(business_account_id)
    WHERE business_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ticket_payouts_transferred_by ON ticket_organiser_payouts(transferred_by_user_id)
    WHERE transferred_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ticket_payouts_requested_by ON ticket_organiser_payouts(requested_by_user_id)
    WHERE requested_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ticket_payouts_approved_by ON ticket_organiser_payouts(approved_by_user_id)
    WHERE approved_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ticket_organiser_ledger_order ON ticket_organiser_ledger(order_id)
    WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ticket_organiser_ledger_refund ON ticket_organiser_ledger(refund_id)
    WHERE refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ticket_organiser_ledger_payout ON ticket_organiser_ledger(payout_id)
    WHERE payout_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ticket_fee_config_category ON ticket_fee_configurations(event_category_id)
    WHERE event_category_id IS NOT NULL;

-- event_organiser_payout_accounts
CREATE INDEX IF NOT EXISTS ix_organiser_payout_country ON event_organiser_payout_accounts(country_id);
CREATE INDEX IF NOT EXISTS ix_organiser_payout_verified_by ON event_organiser_payout_accounts(verified_by_user_id)
    WHERE verified_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_organiser_payout_user ON event_organiser_payout_accounts(organiser_user_id)
    WHERE organiser_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_organiser_payout_biz ON event_organiser_payout_accounts(business_account_id)
    WHERE business_account_id IS NOT NULL;

-- event_ticket_promo_codes
CREATE INDEX IF NOT EXISTS ix_event_ticket_promo_codes_created_by ON event_ticket_promo_codes(created_by_user_id);

-- event_ticket_types (FK needs non-partial index for delete lookups)
CREATE INDEX IF NOT EXISTS ix_event_ticket_types_event_fk ON event_ticket_types(event_id);

-- featured_item_statistics
CREATE INDEX IF NOT EXISTS ix_featured_item_stats_community ON featured_item_statistics(community_id)
    WHERE community_id IS NOT NULL;

-- spare_bag tables
CREATE INDEX IF NOT EXISTS ix_spare_bag_sender_items_category ON spare_bag_sender_items(category_key);
CREATE INDEX IF NOT EXISTS ix_spare_bag_sender_items_unit ON spare_bag_sender_items(unit_code);
CREATE INDEX IF NOT EXISTS ix_spare_bag_sender_items_per_unit ON spare_bag_sender_items(per_unit_unit)
    WHERE per_unit_unit IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_spare_bag_media_media ON spare_bag_sender_request_media(media_id);
CREATE INDEX IF NOT EXISTS ix_spare_bag_journeys_from_airport ON spare_bag_traveller_journeys(from_airport_id)
    WHERE from_airport_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_spare_bag_journeys_to_airport ON spare_bag_traveller_journeys(to_airport_id)
    WHERE to_airport_id IS NOT NULL;

-- moderation tables
CREATE INDEX IF NOT EXISTS ix_moderation_queue_decided_by ON moderation_queue(decided_by_user_id)
    WHERE decided_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_moderation_appeals_queue ON moderation_appeals(moderation_queue_id);
CREATE INDEX IF NOT EXISTS ix_moderation_appeals_action ON moderation_appeals(moderation_action_id);
CREATE INDEX IF NOT EXISTS ix_moderation_appeals_reviewed_by ON moderation_appeals(reviewed_by_user_id)
    WHERE reviewed_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_moderation_audit_actor ON moderation_audit_log(actor_user_id)
    WHERE actor_user_id IS NOT NULL;

-- country_verifications
CREATE INDEX IF NOT EXISTS ix_country_verifications_country ON country_verifications(country_id);

COMMIT;
