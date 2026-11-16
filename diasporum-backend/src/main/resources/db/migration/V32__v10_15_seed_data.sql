-- =============================================================================
-- DIASPORUM v10.15 SEED DATA
-- Reference/seed rows from Diasporum_v10_15_schema_delta.sql, moved out of the
-- schema migration (V31). Every INSERT is ON CONFLICT DO NOTHING, so the
-- statements are idempotent. Section numbers match the original delta.
-- =============================================================================

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
-- 4. ADVERTISING MODULE — SEED DATA
-- =====================================================================

-- 4a. ad_call_to_action_types
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

-- 4e. ad_placement_types
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


-- =====================================================================
-- 6. EVENT TICKETING — SEED DATA
-- =====================================================================

-- 6c. payout_account_field_requirements
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


-- =====================================================================
-- 7. SPARE BAG MODULE — SEED DATA
-- =====================================================================

-- 7a. spare_bag_measurement_units
INSERT INTO spare_bag_measurement_units(unit_code, display_name, unit_type) VALUES
 ('KG','Kilogram','WEIGHT'),('G','Gram','WEIGHT'),
 ('ML','Millilitre','VOLUME'),('L','Litre','VOLUME'),
 ('PIECE','Piece','PIECE'),('PAIR','Pair','PAIR'),
 ('BOX','Box','PACKAGE'),('PACK','Pack','PACKAGE')
ON CONFLICT(unit_code) DO NOTHING;


-- =====================================================================
-- 8. AI MODERATION MODULE — SEED DATA
-- =====================================================================

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


-- =====================================================================
-- 11. BUSINESS ACCOUNT ENHANCEMENTS — SEED DATA
-- =====================================================================

-- Requires trg_validate_addon_feature_key (V31) and the active billing
-- features PROPERTY_LISTING_PUBLISH / VEHICLE_LISTING_PUBLISH /
-- JOB_LISTING_PUBLISH (V1 baseline).
-- 11d. Seed example add-on packages (admin must configure pricing before enabling)
INSERT INTO billing_addon_packages(package_key, display_name, description, target_feature_key, quantity_granted, validity_days) VALUES
 ('EXTRA_PROPERTY_30','30 Extra Property Listings','Additional property listing quota','PROPERTY_LISTING_PUBLISH',30,365),
 ('EXTRA_PROPERTY_50','50 Extra Property Listings','Additional property listing quota','PROPERTY_LISTING_PUBLISH',50,365),
 ('EXTRA_VEHICLE_30','30 Extra Vehicle Listings','Additional vehicle listing quota','VEHICLE_LISTING_PUBLISH',30,365),
 ('EXTRA_JOB_30','30 Extra Job Listings','Additional job listing quota','JOB_LISTING_PUBLISH',30,365),
 ('EXTRA_JOB_50','50 Extra Job Listings','Additional job listing quota','JOB_LISTING_PUBLISH',50,365)
ON CONFLICT(package_key) DO NOTHING;
