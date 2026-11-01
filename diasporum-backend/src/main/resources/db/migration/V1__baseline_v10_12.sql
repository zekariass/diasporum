-- =============================================================================
-- DIASPORUM PostgreSQL v10.12 schema baseline (Flyway-managed transaction)
-- Apply through a versioned migration workflow to a brand-new, empty database.
-- This is a clean-install baseline, not an in-place migration.
-- Tested only by static checks in this package; run live PostgreSQL validation before application use.
-- Greenfield clean-install schema for a self-hosted PostgreSQL database (PostgreSQL 15+).
-- Authentication is first-party: Spring Boot manages Diasporum accounts, email/password
-- credentials, sessions and Diasporum-issued access tokens. Google and Apple are external
-- identity-verification providers only; neither is the application session authority.
-- A future Keycloak migration is supported through provider-independent account IDs.
-- Object bytes live in Cloudflare R2. Ably is the application realtime transport.
-- Voice sessions use one configured provider per session: LiveKit or Cloudflare
-- Realtime SFU. Do not combine both providers in the same session.
--
-- v9.0 consolidated sequence-based chat read cursors, shared addresses, controlled interests/languages,
-- module-specific taxonomies, broader job listing source/types, and profile-based mutual-like
-- matchmaking with adult eligibility, privacy, blocking and reporting protections. The Guides module
-- has been removed from this v10.12 product/schema baseline.
-- Voice-room stage seats, speaker requests, role controls, host counting and concurrent
-- capacity checks are included. Inbox activity previews are refreshed from durable DMs.
-- Apply to a clean staging database using a versioned migration workflow (Flyway
-- recommended). This v10.12 file is a clean-install baseline, not an in-place migration from any existing schema.
-- v10.1 normalized address references for listings/events/jobs and added provider-neutral
-- billing_provider_products mappings. v10.2 added two billing features. v10.3 adds polymorphic featured-item scheduling, user-level content view tracking and optional
-- featured-impression analytics. v10.4 fixes visibility-scope enum/mapping support, normalizes business addresses,
-- makes listing ownership explicit, attaches business accounts to events/jobs, protects address references,
-- bootstraps business owners, adds subscription-plan account-type validation, and clarifies account-level limits.
-- v10.5 removed the Guides module and added matchmaking reversal history, dedicated vehicle fields,
-- JSONB listing attributes, and separate FREE/PREMIUM/ROLE feature access rules.
-- v10.6 adds DIRECT_MESSAGE_SEND with per-recipient quota scope, per-plan configurable reset periods,
-- and explicit NULL quantity_limit semantics (unlimited when the entitlement is enabled).
-- v10.7 added the service marketplace and context-specific conversations; v10.9 replaces match-created friendships with derived mutual follows and makes voice rooms persistent with session-scoped ephemeral comments.
-- v10.8 adds shared PostGIS address discovery points, opt-in approximate people-discovery locations and PostGIS-based matchmaking distances.
-- v10.12 replaces external OIDC authentication with backend-owned accounts/sessions, separates users from
-- optional profiles, adds email/password auth and Google/Apple identity linking, adds scoped platform role
-- assignments, and removes the database-driven business permission matrix. v10.11 product capabilities
-- remain otherwise carried forward.
-- v10.10 Reels extension (carried forward): feed_posts supports REEL; Reels reuse feed_post_media/media_objects,
-- existing comments/reactions/views/moderation, and separate Community/Nearby/Following feed queries.
-- Nearby orders eligible Reels by server-side distance between viewer and creator current-address points;
-- exact addresses/coordinates and numeric distances are not serialized to clients. No per-Reel Nearby toggle.
-- PostGIS is required for shared address geography, private opt-in people discovery, matchmaking,
-- radius-based provider/job/listing searches, and creator-address-based Nearby Reels.
-- RevenueCat remains under evaluation, not selected.
-- Review secrets, backup/restore, grants, monitoring and operational settings before
-- production. The application server is the only ordinary database client.
-- v10.1 follow-up decisions (2026-10-19):
-- * Normalize listing/event/job locations: location detail lives in addresses;
--   do not duplicate city/region/postcode on linked content rows. Use an address
--   row with city only when an approximate city-level location is intended.
-- * Use ON DELETE RESTRICT for linked addresses so a referenced address cannot
--   be silently detached from a listing or event.
-- * Keep billing provider-neutral and add billing_provider_products so platform
--   store product IDs can map to plans or one-off products. RevenueCat is under
--   evaluation, not selected as the final provider. See the v10.1 design doc.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- Transaction is managed by Flyway.

CREATE TYPE account_status AS ENUM ('PENDING_VERIFICATION','ACTIVE','SUSPENDED','DELETION_PENDING','DELETED');
CREATE TYPE privacy_request_type AS ENUM ('DELETE_ACCOUNT','EXPORT_DATA','ACCESS_DATA','RECTIFY_DATA');
CREATE TYPE privacy_request_status AS ENUM ('REQUESTED','CONFIRMED','PROCESSING','COMPLETED','CANCELLED','FAILED');
CREATE TYPE community_role AS ENUM ('MEMBER','TRUSTED_HELPER','MODERATOR','COMMUNITY_ADMIN');
CREATE TYPE membership_status AS ENUM ('ACTIVE','SUSPENDED','LEFT');
CREATE TYPE content_status AS ENUM ('DRAFT','PENDING_REVIEW','PUBLISHED','HIDDEN','REMOVED','REJECTED','EXPIRED','DELETED');
CREATE TYPE visibility_scope AS ENUM ('COMMUNITY','SELECTED_COMMUNITIES','COUNTRY');
CREATE TYPE category_module AS ENUM ('FEED','EVENT','COMMUNITY_HELP');
CREATE TYPE room_visibility AS ENUM ('PUBLIC','PRIVATE');
CREATE TYPE voice_room_status AS ENUM ('ACTIVE','LOCKED','ARCHIVED','SUSPENDED');
CREATE TYPE voice_session_status AS ENUM ('ACTIVE','INACTIVE','ENDED','EXPIRED');
CREATE TYPE participant_role AS ENUM ('LISTENER','SPEAKER','HOST','MODERATOR');
CREATE TYPE rtc_provider AS ENUM ('LIVEKIT','CLOUDFLARE_SFU');
CREATE TYPE media_status AS ENUM ('PENDING_UPLOAD','UPLOADED','PROCESSING','READY','REJECTED','DELETED');
CREATE TYPE media_access_scope AS ENUM ('PUBLIC','AUTHENTICATED','OWNER_ONLY','AUTHORIZED_VIEWERS');
CREATE TYPE event_mode AS ENUM ('IN_PERSON','ONLINE_VOICE','ONLINE_EXTERNAL');
CREATE TYPE rsvp_status AS ENUM ('GOING','INTERESTED','NOT_GOING','WAITLISTED');
CREATE TYPE business_verification_status AS ENUM ('UNVERIFIED','PENDING','VERIFIED','REJECTED','REVOKED');
CREATE TYPE job_status AS ENUM ('DRAFT','PENDING_REVIEW','PUBLISHED','PAUSED','CLOSED','REJECTED','EXPIRED');
CREATE TYPE application_method AS ENUM ('INTERNAL','EXTERNAL');
CREATE TYPE job_application_status AS ENUM ('SUBMITTED','VIEWED','SHORTLISTED','REJECTED','WITHDRAWN','HIRED');
CREATE TYPE spare_bag_listing_type AS ENUM ('SENDER_REQUEST','PASSENGER_OFFER');
CREATE TYPE spare_bag_listing_status AS ENUM ('DRAFT','PENDING_REVIEW','PUBLISHED','PAUSED','MATCHED','CLOSED','EXPIRED','REMOVED');
CREATE TYPE spare_bag_price_unit AS ENUM ('PER_KG','PER_PARCEL');
CREATE TYPE spare_bag_contact_status AS ENUM ('PENDING','ACCEPTED','DECLINED','CANCELLED','EXPIRED','CLOSED');
CREATE TYPE address_visibility AS ENUM ('PUBLIC','PRIVATE','AUTHORISED_USERS');
CREATE TYPE matchmaking_profile_status AS ENUM ('DRAFT','ACTIVE','PAUSED','SUSPENDED','DELETED');
CREATE TYPE matchmaking_field_visibility AS ENUM ('VISIBLE','BLURRED','HIDDEN');
CREATE TYPE matchmaking_verification_status AS ENUM ('NOT_VERIFIED','PENDING','VERIFIED','REJECTED','REVOKED');
CREATE TYPE matchmaking_swipe_action AS ENUM ('LIKE','PASS');
CREATE TYPE matchmaking_swipe_status AS ENUM ('ACTIVE','WITHDRAWN','REWOUND');
CREATE TYPE matchmaking_swipe_history_event_type AS ENUM ('SWIPE','LIKE_CANCELLED','REWOUND');
CREATE TYPE matchmaking_match_status AS ENUM ('MATCHED','UNMATCHED','CLOSED','BLOCKED');
CREATE TYPE job_employment_type AS ENUM ('PERMANENT','FIXED_TERM','CONTRACT','TEMPORARY','CASUAL','ZERO_HOURS','SEASONAL','APPRENTICESHIP','INTERNSHIP','VOLUNTEER','FREELANCE','COMMISSION','SELF_EMPLOYED','OTHER','UNSPECIFIED');
CREATE TYPE job_listing_source_type AS ENUM ('EMPLOYER_DIRECT','RECRUITER','COMMUNITY_SHARED','COMMUNITY_ORGANIZATION','EXTERNAL_AGGREGATOR','PLATFORM_EDITOR');
CREATE TYPE report_status AS ENUM ('OPEN','TRIAGED','IN_REVIEW','ACTIONED','DISMISSED');
CREATE TYPE dm_status AS ENUM ('REQUESTED','ACCEPTED','DECLINED','CLOSED');
CREATE TYPE notification_type AS ENUM ('COMMENT','REPLY','REACTION','FOLLOW','DM_REQUEST','DM_MESSAGE','ROOM_INVITE','ROOM_EVENT','EVENT_REMINDER','EVENT_UPDATE','JOB_UPDATE','MATCHMAKING_LIKE','MATCHMAKING_MATCH','SPARE_BAG_CONTACT_REQUEST','SPARE_BAG_LISTING_UPDATE','MODERATION','ACCOUNT_SECURITY','SYSTEM');
CREATE TYPE report_target_type AS ENUM ('USER','FEED_POST','FEED_COMMENT','CHAT_MESSAGE','DIRECT_MESSAGE','VOICE_ROOM','VOICE_ROOM_MESSAGE','BUSINESS','BUSINESS_REVIEW','EVENT','JOB','MATCHMAKING_PROFILE','MATCHMAKING_MATCH','SPARE_BAG_LISTING','SPARE_BAG_CONTACT_REQUEST');
CREATE TYPE moderation_action_type AS ENUM ('WARN','MUTE','SUSPEND','BAN','REMOVE_CONTENT','HIDE_CONTENT','RESTORE_CONTENT','LOCK_ROOM','UNLOCK_ROOM','END_VOICE_SESSION','REVOKE_VERIFICATION','REJECT_LISTING','APPROVE_CONTENT');
CREATE TYPE outbox_destination AS ENUM ('ABLY','PUSH','MEDIA_PROCESSOR','INTERNAL');
CREATE TYPE content_reference_type AS ENUM ('FEED_POST','EVENT','JOB','PROPERTY','VEHICLE','BUSINESS','SPARE_BAG_LISTING');
CREATE TYPE featured_item_kind AS ENUM ('EDITORIAL','PAID_PROMOTION');
CREATE TYPE featured_item_status AS ENUM ('DRAFT','SCHEDULED','ACTIVE','PAUSED','ENDED','CANCELLED');

-- 1. Country, account identity, authentication and profile domain
CREATE TABLE countries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    iso2 char(2) NOT NULL UNIQUE,
    iso3 char(3) UNIQUE,
    demonym text,
    flag_emoji text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- A Diasporum account exists independently of a completed public profile.
-- Email is the account's one primary login/contact address. Normalize by trimming and
-- lower-casing only; do not apply provider-specific dot/plus alias transformations.
CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL CHECK(length(trim(email)) BETWEEN 3 AND 320 AND position('@' IN email) > 1),
    email_normalized text GENERATED ALWAYS AS (lower(btrim(email))) STORED,
    email_verified_at timestamptz,
    account_status account_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
CREATE UNIQUE INDEX ux_users_email_normalized ON users(email_normalized) WHERE deleted_at IS NULL;
CREATE INDEX ix_users_account_status ON users(account_status,created_at DESC);

-- Profile is an optional one-to-one extension of the account. Its ID is the same
-- UUID as users.id; profile-facing domain fields remain here, while account lifecycle
-- and authentication data belong to users.
CREATE TABLE profiles (
    id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    username text,
    display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
    bio text CHECK (bio IS NULL OR length(bio) <= 800),
    origin_country_id uuid NOT NULL REFERENCES countries(id),
    current_country_id uuid NOT NULL REFERENCES countries(id),
    city text CHECK (city IS NULL OR length(city) <= 120),
    date_of_birth date,
    age_eligibility_confirmed_at timestamptz,
    trust_score integer NOT NULL DEFAULT 0 CHECK (trust_score >= 0),
    profile_completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_profiles_username_ci ON profiles (lower(username)) WHERE username IS NOT NULL;
CREATE INDEX ix_profiles_origin_current ON profiles(origin_country_id,current_country_id);
CREATE INDEX ix_profiles_current_city ON profiles(current_country_id,city) WHERE city IS NOT NULL;

-- Local password authentication is optional: Google/Apple-only accounts have no row.
-- The PHC-encoded Argon2id hash carries its algorithm parameters and salt.
CREATE TABLE user_credentials (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash text NOT NULL,
    password_changed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_type text NOT NULL CHECK(client_type IN ('IOS','ANDROID','WEB','OTHER')),
    authentication_method text NOT NULL CHECK(authentication_method IN ('PASSWORD','GOOGLE','APPLE','KEYCLOAK')),
    device_id text,
    device_name text CHECK(device_name IS NULL OR length(device_name) <= 160),
    ip_address inet,
    user_agent text CHECK(user_agent IS NULL OR length(user_agent) <= 1000),
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now(),
    absolute_expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    revocation_reason text,
    CHECK(absolute_expires_at > created_at),
    CHECK(revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX ix_user_sessions_user_active ON user_sessions(user_id,last_used_at DESC)
    WHERE revoked_at IS NULL;
CREATE INDEX ix_user_sessions_expiry ON user_sessions(absolute_expires_at)
    WHERE revoked_at IS NULL;

-- Refresh tokens are high-entropy opaque values. Store SHA-256 digests only;
-- retain consumed rows so rotation replay can revoke the complete token family/session.
CREATE TABLE user_refresh_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
    token_family_id uuid NOT NULL,
    token_hash bytea NOT NULL UNIQUE CHECK(octet_length(token_hash)=32),
    issued_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    revoked_at timestamptz,
    replaced_by_token_id uuid REFERENCES user_refresh_tokens(id) ON DELETE SET NULL,
    CHECK(expires_at > issued_at),
    CHECK(consumed_at IS NULL OR consumed_at >= issued_at),
    CHECK(revoked_at IS NULL OR revoked_at >= issued_at)
);
CREATE INDEX ix_user_refresh_tokens_session ON user_refresh_tokens(session_id,issued_at DESC);
CREATE INDEX ix_user_refresh_tokens_family ON user_refresh_tokens(token_family_id,issued_at DESC);
CREATE UNIQUE INDEX ux_user_refresh_tokens_one_active_per_family
    ON user_refresh_tokens(token_family_id)
    WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE email_verification_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose text NOT NULL CHECK(purpose IN ('INITIAL_REGISTRATION','EMAIL_CHANGE')),
    email_to_verify text NOT NULL CHECK(length(trim(email_to_verify)) BETWEEN 3 AND 320),
    token_hash bytea NOT NULL UNIQUE CHECK(octet_length(token_hash)=32),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    revoked_at timestamptz,
    CHECK(expires_at > created_at),
    CHECK(consumed_at IS NULL OR consumed_at >= created_at),
    CHECK(revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX ix_email_verification_tokens_user ON email_verification_tokens(user_id,created_at DESC);
CREATE INDEX ix_email_verification_tokens_pending ON email_verification_tokens(expires_at)
    WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE password_reset_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE CHECK(octet_length(token_hash)=32),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    revoked_at timestamptz,
    CHECK(expires_at > created_at),
    CHECK(consumed_at IS NULL OR consumed_at >= created_at),
    CHECK(revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX ix_password_reset_tokens_user ON password_reset_tokens(user_id,created_at DESC);
CREATE INDEX ix_password_reset_tokens_pending ON password_reset_tokens(expires_at)
    WHERE consumed_at IS NULL AND revoked_at IS NULL;

-- Account suspension/deletion is authoritative and immediately revokes all refresh sessions.
CREATE OR REPLACE FUNCTION revoke_user_sessions_on_account_restriction()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.account_status IN ('SUSPENDED','DELETION_PENDING','DELETED')
       OR NEW.deleted_at IS NOT NULL THEN
        UPDATE user_sessions
           SET revoked_at=COALESCE(revoked_at,now()),
               revocation_reason=COALESCE(revocation_reason,'ACCOUNT_RESTRICTED')
         WHERE user_id=NEW.id AND revoked_at IS NULL;
        UPDATE user_refresh_tokens t
           SET revoked_at=COALESCE(t.revoked_at,now())
          FROM user_sessions s
         WHERE t.session_id=s.id AND s.user_id=NEW.id AND t.revoked_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_revoke_sessions_on_account_restriction
AFTER UPDATE OF account_status,deleted_at ON users
FOR EACH ROW EXECUTE FUNCTION revoke_user_sessions_on_account_restriction();


-- Shared structured addresses. APIs must apply addresses.visibility and entity-level authorization;
-- never expose PRIVATE/AUTHORISED_USERS addresses merely because a caller knows an address UUID.
CREATE TABLE addresses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id uuid NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
    address_line_1 text CHECK(address_line_1 IS NULL OR length(address_line_1) <= 240),
    address_line_2 text CHECK(address_line_2 IS NULL OR length(address_line_2) <= 240),
    city text CHECK(city IS NULL OR length(city) <= 120),
    region text CHECK(region IS NULL OR length(region) <= 120),
    postal_code text CHECK(postal_code IS NULL OR length(postal_code) <= 40),
    formatted_address text CHECK(formatted_address IS NULL OR length(formatted_address) <= 1000),
    latitude numeric(9,6),
    longitude numeric(9,6),
    -- Exact point is derived from numeric coordinates and must never be serialized to ordinary discovery clients.
    location geography(Point,4326),
    -- Separate approximate/public point used for spatial discovery; may be null when an entity has no discoverable point.
    discovery_location geography(Point,4326),
    visibility address_visibility NOT NULL DEFAULT 'PRIVATE',
    owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(latitude IS NULL OR latitude BETWEEN -90 AND 90),
    CHECK(longitude IS NULL OR longitude BETWEEN -180 AND 180),
    CHECK((latitude IS NULL) = (longitude IS NULL)),
    CHECK(address_line_1 IS NOT NULL OR city IS NOT NULL OR formatted_address IS NOT NULL)
);
CREATE INDEX ix_addresses_country_city ON addresses(country_id,city) WHERE city IS NOT NULL;
CREATE INDEX ix_addresses_coordinates ON addresses(country_id,latitude,longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX ix_addresses_discovery_location_gist ON addresses USING gist(discovery_location) WHERE discovery_location IS NOT NULL;
-- Internal index for authenticated Nearby Reels distance/radius queries. Never expose this exact point.
CREATE INDEX ix_addresses_location_gist ON addresses USING gist(location) WHERE location IS NOT NULL;

-- The current address is a profile-level reference, not a Reel/filming location.
-- Keep nullable so users without a configured current address can still use other feeds.
ALTER TABLE profiles
    ADD COLUMN current_address_id uuid REFERENCES addresses(id) ON DELETE RESTRICT;
CREATE INDEX ix_profiles_current_address
    ON profiles(current_address_id) WHERE current_address_id IS NOT NULL;

-- Keep the exact geography derived from validated longitude/latitude columns. General public spatial discovery uses discovery_location; Nearby Reels is a narrowly scoped authenticated server-side address-to-address ranking use of location and never returns exact points or distance.
CREATE OR REPLACE FUNCTION sync_coordinate_geography()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.latitude IS NULL OR NEW.longitude IS NULL THEN
        NEW.location := NULL;
    ELSE
        NEW.location := ST_SetSRID(
            ST_MakePoint(NEW.longitude::double precision, NEW.latitude::double precision), 4326
        )::geography;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_address_geography ON addresses;
CREATE TRIGGER trg_sync_address_geography
BEFORE INSERT OR UPDATE OF latitude,longitude,location ON addresses
FOR EACH ROW EXECUTE FUNCTION sync_coordinate_geography();

-- A separate, opt-in approximate point for people discovery. This deliberately does not reuse a home address.
-- Delete the row when the user opts out of all location-based discovery, which removes the stored discovery coordinates.
CREATE TABLE user_discovery_locations (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    location geography(Point,4326) NOT NULL,
    location_source text NOT NULL CHECK(location_source IN ('DEVICE_APPROXIMATE','USER_SELECTED','CITY_CENTRE')),
    precision_radius_m integer NOT NULL DEFAULT 1000 CHECK(precision_radius_m BETWEEN 100 AND 100000),
    consented_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_user_discovery_locations_gist ON user_discovery_locations USING gist(location);
COMMENT ON TABLE user_discovery_locations IS 'Approximate location consented for one or more location-based discovery uses. Retain only while a use is enabled; delete when the user opts out of all location-based discovery. Never expose the raw point.';

-- Store the external provider issuer + stable subject mapping here; Diasporum owns application accounts and sessions.
CREATE TABLE external_identities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issuer text NOT NULL,
    subject text NOT NULL,
    email_at_link_time text,
    email_verified boolean NOT NULL DEFAULT false,
    linked_at timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz,
    UNIQUE (issuer,subject)
);
CREATE INDEX ix_external_identities_user ON external_identities(user_id);

-- Provider credentials are not used to authenticate Diasporum API requests.
-- Store only credentials required for provider lifecycle operations (initially Apple
-- refresh tokens for Sign in with Apple revocation), encrypted using an application/KMS key.
CREATE TABLE external_identity_credentials (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    external_identity_id uuid NOT NULL REFERENCES external_identities(id) ON DELETE CASCADE,
    credential_type text NOT NULL CHECK(credential_type IN ('APPLE_REFRESH_TOKEN')),
    encrypted_credential bytea NOT NULL,
    encryption_key_version integer NOT NULL CHECK(encryption_key_version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    UNIQUE(external_identity_id,credential_type)
);


CREATE TABLE communities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    slug text NOT NULL UNIQUE,
    origin_country_id uuid NOT NULL REFERENCES countries(id),
    destination_country_id uuid NOT NULL REFERENCES countries(id),
    description text,
    is_active boolean NOT NULL DEFAULT true,
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (origin_country_id,destination_country_id)
);
CREATE INDEX ix_communities_destination_active ON communities(destination_country_id,is_active);

CREATE TABLE community_memberships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role community_role NOT NULL DEFAULT 'MEMBER',
    status membership_status NOT NULL DEFAULT 'ACTIVE',
    joined_at timestamptz NOT NULL DEFAULT now(),
    left_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (community_id,user_id)
);
CREATE INDEX ix_memberships_user_status ON community_memberships(user_id,status);
CREATE INDEX ix_memberships_community_status ON community_memberships(community_id,status,role);

CREATE OR REPLACE FUNCTION validate_membership_origin()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_user_origin uuid; v_community_origin uuid;
BEGIN
    SELECT origin_country_id INTO v_user_origin FROM profiles WHERE id=NEW.user_id;
    SELECT origin_country_id INTO v_community_origin FROM communities WHERE id=NEW.community_id AND is_active=true;
    IF v_user_origin IS NULL OR v_community_origin IS NULL OR v_user_origin <> v_community_origin THEN
        RAISE EXCEPTION 'Community membership requires an active community matching the user origin country' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_membership_origin_country ON community_memberships;
CREATE TRIGGER trg_membership_origin_country BEFORE INSERT OR UPDATE OF user_id,community_id ON community_memberships
FOR EACH ROW EXECUTE FUNCTION validate_membership_origin();

CREATE TABLE user_settings (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    default_community_id uuid REFERENCES communities(id) ON DELETE SET NULL,
    active_community_id uuid REFERENCES communities(id) ON DELETE SET NULL,
    preferred_language_code text NOT NULL DEFAULT 'en',
    theme text NOT NULL DEFAULT 'SYSTEM' CHECK(theme IN ('LIGHT','DARK','SYSTEM')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_privacy_settings (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    profile_discoverable boolean NOT NULL DEFAULT true,
    show_profile_to_community boolean NOT NULL DEFAULT true,
    show_city boolean NOT NULL DEFAULT false,
    show_online_status boolean NOT NULL DEFAULT false,
    allow_followers boolean NOT NULL DEFAULT true,
    allow_message_requests boolean NOT NULL DEFAULT true,
    dm_permission text NOT NULL DEFAULT 'INTERACTED_USERS' CHECK(dm_permission IN ('NONE','MUTUAL_FOLLOWERS','COMMUNITY_MEMBERS','INTERACTED_USERS','EVERYONE')),
    allow_people_suggestions boolean NOT NULL DEFAULT true,
    allow_matchmaking_discovery boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- User data rights and account-deletion workflow. The request row can remain after
-- the profile is deleted; user_id becomes NULL after the deletion transaction.
CREATE TABLE privacy_data_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    request_type privacy_request_type NOT NULL,
    status privacy_request_status NOT NULL DEFAULT 'REQUESTED',
    request_channel text NOT NULL DEFAULT 'MOBILE' CHECK(request_channel IN ('MOBILE','WEB','SUPPORT')),
    requested_at timestamptz NOT NULL DEFAULT now(),
    confirmed_at timestamptz,
    scheduled_for timestamptz,
    processing_started_at timestamptz,
    completed_at timestamptz,
    cancelled_at timestamptz,
    failure_code text,
    failure_details text CHECK(failure_details IS NULL OR length(failure_details) <= 2000),
    cleanup_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key text,
    CHECK(completed_at IS NULL OR processing_started_at IS NOT NULL),
    CHECK(cancelled_at IS NULL OR status='CANCELLED')
);
CREATE UNIQUE INDEX ux_privacy_request_active_user_type
  ON privacy_data_requests(user_id,request_type)
  WHERE user_id IS NOT NULL AND status IN ('REQUESTED','CONFIRMED','PROCESSING');
CREATE UNIQUE INDEX ux_privacy_request_idempotency
  ON privacy_data_requests(user_id,idempotency_key)
  WHERE user_id IS NOT NULL AND idempotency_key IS NOT NULL;
CREATE INDEX ix_privacy_requests_processing
  ON privacy_data_requests(status,scheduled_for,requested_at)
  WHERE status IN ('CONFIRMED','PROCESSING');

CREATE TABLE global_user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_key text NOT NULL CHECK(role_key IN ('PLATFORM_ADMIN','PLATFORM_MODERATOR','SUPPORT_AGENT','CONTENT_EDITOR')),
    scope_type text NOT NULL DEFAULT 'GLOBAL' CHECK(scope_type IN ('GLOBAL','COUNTRY','COMMUNITY')),
    country_id uuid REFERENCES countries(id) ON DELETE CASCADE,
    community_id uuid REFERENCES communities(id) ON DELETE CASCADE,
    assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    CHECK(
       (scope_type='GLOBAL' AND country_id IS NULL AND community_id IS NULL)
       OR (scope_type='COUNTRY' AND country_id IS NOT NULL AND community_id IS NULL)
       OR (scope_type='COMMUNITY' AND country_id IS NULL AND community_id IS NOT NULL)
    ),
    CHECK(role_key<>'PLATFORM_ADMIN' OR scope_type='GLOBAL')
);
CREATE UNIQUE INDEX ux_global_user_role_active_global
    ON global_user_roles(user_id,role_key)
    WHERE revoked_at IS NULL AND scope_type='GLOBAL';
CREATE UNIQUE INDEX ux_global_user_role_active_country
    ON global_user_roles(user_id,role_key,country_id)
    WHERE revoked_at IS NULL AND scope_type='COUNTRY';
CREATE UNIQUE INDEX ux_global_user_role_active_community
    ON global_user_roles(user_id,role_key,community_id)
    WHERE revoked_at IS NULL AND scope_type='COMMUNITY';
CREATE INDEX ix_global_user_roles_user ON global_user_roles(user_id,assigned_at DESC);
CREATE INDEX ix_global_user_roles_scope ON global_user_roles(scope_type,country_id,community_id,role_key)
    WHERE revoked_at IS NULL;
COMMENT ON TABLE global_user_roles IS 'Platform staff roles with explicit global, country or community assignment scope. PLATFORM_ADMIN is global only; role assignment/revocation must be performed by authorised backend administration and written to audit_logs.';

-- Versioned policy acceptance (community rules, privacy terms and Spare Bag conditions).
CREATE TABLE policy_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_key text NOT NULL CHECK(length(trim(policy_key)) BETWEEN 1 AND 80),
    version text NOT NULL CHECK(length(trim(version)) BETWEEN 1 AND 40),
    title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
    document_url text,
    content_sha256 text,
    status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','RETIRED')),
    effective_at timestamptz,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(policy_key,version),
    CHECK(content_sha256 IS NULL OR content_sha256 ~ '^[A-Fa-f0-9]{64}$')
);
CREATE INDEX ix_policy_documents_current ON policy_documents(policy_key,status,effective_at DESC);

CREATE TABLE policy_acceptances (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    policy_document_id uuid NOT NULL REFERENCES policy_documents(id) ON DELETE RESTRICT,
    accepted_at timestamptz NOT NULL DEFAULT now(),
    acceptance_source text NOT NULL DEFAULT 'MOBILE' CHECK(acceptance_source IN ('MOBILE','WEB','ADMIN','SYSTEM')),
    ip_address inet,
    user_agent text CHECK(user_agent IS NULL OR length(user_agent) <= 1000),
    UNIQUE(user_id,policy_document_id)
);
CREATE INDEX ix_policy_acceptances_user_time ON policy_acceptances(user_id,accepted_at DESC);

-- 2. Destination-country taxonomy. The same category can be mapped to multiple modules.
CREATE TABLE country_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
    name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
    slug text NOT NULL,
    description text,
    color_token text NOT NULL DEFAULT 'slate' CHECK(color_token IN ('slate','blue','green','amber','rose','violet','teal','orange','indigo','pink','cyan','lime','red','purple')),
    icon_key text,
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(country_id,slug)
);
CREATE INDEX ix_country_categories_active ON country_categories(country_id,is_active,sort_order);

CREATE TABLE country_category_modules (
    category_id uuid NOT NULL REFERENCES country_categories(id) ON DELETE CASCADE,
    module_key category_module NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(category_id,module_key)
);

-- Controlled taxonomies avoid duplicate keys such as Football/football and arbitrary aliases.
CREATE TABLE interests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    interest_key text NOT NULL UNIQUE CHECK(interest_key=lower(trim(interest_key)) AND length(interest_key) BETWEEN 1 AND 80),
    display_name text NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 100),
    category_key text,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_interests (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    interest_id uuid NOT NULL REFERENCES interests(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,interest_id)
);
CREATE INDEX ix_user_interests_interest ON user_interests(interest_id,user_id);

CREATE TABLE languages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    language_code text NOT NULL UNIQUE CHECK(language_code=lower(trim(language_code)) AND length(language_code) BETWEEN 2 AND 20),
    display_name text NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 100),
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_languages (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    language_id uuid NOT NULL REFERENCES languages(id) ON DELETE RESTRICT,
    proficiency text CHECK(proficiency IN ('BASIC','CONVERSATIONAL','FLUENT','NATIVE')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,language_id)
);
CREATE INDEX ix_user_languages_language ON user_languages(language_id,user_id);

-- 3. Social graph and safety blocks
CREATE TABLE user_follows (
    follower_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followed_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(follower_user_id,followed_user_id),
    CHECK(follower_user_id <> followed_user_id)
);
CREATE INDEX ix_user_follows_followed ON user_follows(followed_user_id,follower_user_id);

-- Mutual connections are derived from reciprocal directional follows. No duplicate friendship edge is stored.
CREATE VIEW user_mutual_connections AS
SELECT a.follower_user_id AS user_a_id, a.followed_user_id AS user_b_id,
       GREATEST(a.created_at,b.created_at) AS mutual_since
FROM user_follows a
JOIN user_follows b ON b.follower_user_id=a.followed_user_id AND b.followed_user_id=a.follower_user_id
WHERE a.follower_user_id < a.followed_user_id;

CREATE OR REPLACE FUNCTION validate_user_follow()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_follower_status account_status; v_followed_status account_status; v_allowed boolean;
BEGIN
    IF NEW.follower_user_id=NEW.followed_user_id THEN
        RAISE EXCEPTION 'A user cannot follow themselves' USING ERRCODE='23514';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(least(NEW.follower_user_id::text,NEW.followed_user_id::text)||':'||greatest(NEW.follower_user_id::text,NEW.followed_user_id::text),0));
    SELECT account_status INTO v_follower_status FROM users u JOIN profiles p ON p.id=u.id WHERE u.id=NEW.follower_user_id;
    SELECT account_status INTO v_followed_status FROM users u JOIN profiles p ON p.id=u.id WHERE u.id=NEW.followed_user_id;
    IF v_follower_status IS DISTINCT FROM 'ACTIVE' OR v_followed_status IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION 'Both profiles must be active to create a follow' USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM user_blocks b WHERE
       (b.blocker_user_id=NEW.follower_user_id AND b.blocked_user_id=NEW.followed_user_id) OR
       (b.blocker_user_id=NEW.followed_user_id AND b.blocked_user_id=NEW.follower_user_id)) THEN
        RAISE EXCEPTION 'Blocked users cannot follow one another' USING ERRCODE='23514';
    END IF;
    SELECT COALESCE(allow_followers,true) INTO v_allowed FROM user_privacy_settings WHERE user_id=NEW.followed_user_id;
    IF NOT FOUND THEN v_allowed:=true; END IF;
    IF NOT v_allowed THEN
        RAISE EXCEPTION 'Recipient does not currently allow followers' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_user_follow_policy BEFORE INSERT OR UPDATE OF follower_user_id,followed_user_id ON user_follows
FOR EACH ROW EXECUTE FUNCTION validate_user_follow();

CREATE TABLE user_blocks (
    blocker_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(blocker_user_id,blocked_user_id),
    CHECK(blocker_user_id <> blocked_user_id)
);
CREATE INDEX ix_user_blocks_blocked ON user_blocks(blocked_user_id,blocker_user_id);

CREATE TABLE user_mutes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    muted_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    community_id uuid REFERENCES communities(id) ON DELETE CASCADE,
    room_id uuid,
    scope text NOT NULL CHECK(scope IN ('POSTING','CHAT','DIRECT_MESSAGES','VOICE','ALL')),
    action_type text NOT NULL DEFAULT 'MUTE' CHECK(action_type IN ('MUTE','BAN')),
    reason text NOT NULL,
    starts_at timestamptz NOT NULL DEFAULT now(),
    ends_at timestamptz,
    revoked_at timestamptz,
    revoked_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK(ends_at IS NULL OR ends_at > starts_at),
    CHECK(room_id IS NULL OR scope='CHAT'),
    CHECK(room_id IS NULL OR community_id IS NULL),
    CHECK(revoked_at IS NULL OR revoked_at>=starts_at)
);
CREATE INDEX ix_user_mutes_active ON user_mutes(user_id,scope,ends_at) WHERE revoked_at IS NULL;
CREATE INDEX ix_user_mutes_community_active ON user_mutes(community_id,user_id,scope,ends_at) WHERE revoked_at IS NULL;
CREATE INDEX ix_user_mutes_room_active ON user_mutes(room_id,user_id,ends_at) WHERE room_id IS NOT NULL AND revoked_at IS NULL;
CREATE OR REPLACE FUNCTION validate_user_mute_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_target_community uuid; v_actor_role community_role; v_actor_status account_status;
BEGIN
    IF NEW.room_id IS NOT NULL THEN
        SELECT community_id INTO v_target_community FROM chat_rooms WHERE id=NEW.room_id AND is_active=true;
        IF v_target_community IS NULL THEN RAISE EXCEPTION 'Room-specific restriction requires an active chat room' USING ERRCODE='23514'; END IF;
    ELSE v_target_community:=NEW.community_id; END IF;
    IF NEW.action_type='BAN' AND NEW.scope<>'CHAT' THEN
        RAISE EXCEPTION 'BAN is only supported for chat scope in this model' USING ERRCODE='23514';
    END IF;
    IF v_target_community IS NOT NULL THEN
        SELECT role INTO v_actor_role FROM community_memberships WHERE community_id=v_target_community AND user_id=NEW.muted_by AND status='ACTIVE';
        IF v_actor_role IS NULL OR v_actor_role NOT IN ('MODERATOR','COMMUNITY_ADMIN') THEN
            RAISE EXCEPTION 'Only an active community moderator/admin may issue scoped chat restrictions' USING ERRCODE='23514';
        END IF;
    ELSIF COALESCE(current_setting('app.platform_moderator',true),'false')<>'true' THEN
        RAISE EXCEPTION 'Global restrictions require an explicitly authorised platform-moderation transaction' USING ERRCODE='23514';
    END IF;
    IF NEW.user_id=NEW.muted_by THEN RAISE EXCEPTION 'Moderators cannot mute or ban themselves through this action' USING ERRCODE='23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_user_mute_scope_integrity BEFORE INSERT OR UPDATE OF user_id,muted_by,community_id,room_id,scope,action_type ON user_mutes
FOR EACH ROW EXECUTE FUNCTION validate_user_mute_scope();


-- 4. Cloudflare R2 object metadata. Object keys are not public URLs.
CREATE TABLE media_objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    bucket_name text NOT NULL,
    object_key text NOT NULL,
    purpose text NOT NULL CHECK(purpose IN ('AVATAR','FEED_IMAGE','FEED_VIDEO','BUSINESS','EVENT','JOB','MATCHMAKING_PROFILE_PHOTO','MATCHMAKING_PROFILE_BLURRED','CHAT_ATTACHMENT','SPARE_BAG_LISTING','DOCUMENT','OTHER')),
    access_scope media_access_scope NOT NULL DEFAULT 'AUTHENTICATED',
    status media_status NOT NULL DEFAULT 'PENDING_UPLOAD',
    mime_type text NOT NULL,
    size_bytes bigint CHECK(size_bytes IS NULL OR size_bytes >= 0),
    checksum_sha256 text,
    width_px integer CHECK(width_px IS NULL OR width_px > 0),
    height_px integer CHECK(height_px IS NULL OR height_px > 0),
    duration_ms integer CHECK(duration_ms IS NULL OR duration_ms >= 0),
    detected_mime_type text,
    rejection_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    uploaded_at timestamptz,
    processed_at timestamptz,
    deleted_at timestamptz,
    UNIQUE(bucket_name,object_key)
);
CREATE INDEX ix_media_objects_owner ON media_objects(owner_user_id,status,created_at DESC);
CREATE INDEX ix_media_objects_status ON media_objects(status,created_at);

CREATE TABLE profile_media (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE RESTRICT,
    variant text NOT NULL CHECK(variant IN ('AVATAR','COVER')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,variant)
);

-- 5. Feed, category badges and engagement
CREATE TABLE feed_posts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id uuid NOT NULL REFERENCES countries(id),
    community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    visibility_scope visibility_scope NOT NULL DEFAULT 'COMMUNITY',
    author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id uuid NOT NULL REFERENCES country_categories(id),
    post_type text NOT NULL DEFAULT 'GENERAL' CHECK(post_type IN ('GENERAL','ANNOUNCEMENT','RECOMMENDATION','RESOURCE','WARNING','OPPORTUNITY','EVENT_NOTICE','POLL','REEL','COMMUNITY_HELP')),
    title text CHECK(title IS NULL OR length(title) <= 200),
    -- REEL captions may be empty; Community Help and other textual post types require non-empty body text.
    body text NOT NULL CHECK((post_type='REEL' AND length(body) <= 20000) OR (post_type<>'REEL' AND length(trim(body)) BETWEEN 1 AND 20000)),
    link_url text,
    status content_status NOT NULL DEFAULT 'PUBLISHED',
    is_pinned boolean NOT NULL DEFAULT false,
    is_sponsored boolean NOT NULL DEFAULT false,
    comments_enabled boolean NOT NULL DEFAULT true,
    comment_count integer NOT NULL DEFAULT 0 CHECK(comment_count >= 0),
    reaction_count integer NOT NULL DEFAULT 0 CHECK(reaction_count >= 0),
    share_count integer NOT NULL DEFAULT 0 CHECK(share_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CHECK(visibility_scope IN ('COMMUNITY','COUNTRY'))
);
CREATE INDEX ix_feed_posts_community_created ON feed_posts(community_id,status,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_feed_posts_country_created ON feed_posts(country_id,status,created_at DESC,id DESC) WHERE visibility_scope='COUNTRY' AND deleted_at IS NULL;
CREATE INDEX ix_feed_posts_category ON feed_posts(category_id,status,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_feed_posts_search ON feed_posts USING gin(to_tsvector('english',coalesce(title,'') || ' ' || body));
CREATE INDEX ix_feed_posts_reel_community_published ON feed_posts(community_id,published_at DESC,id DESC)
    WHERE post_type='REEL' AND status='PUBLISHED' AND deleted_at IS NULL;
CREATE INDEX ix_feed_posts_reel_author_published ON feed_posts(author_id,published_at DESC,id DESC)
    WHERE post_type='REEL' AND status='PUBLISHED' AND deleted_at IS NULL;

-- v10.11 Community Help & Offers: one lifecycle row per structured help feed post.
-- The parent feed_posts row remains the source of truth for author, community,
-- country/audience, text, media, comments, reactions, publication and moderation.
CREATE TABLE community_help_posts (
    post_id uuid PRIMARY KEY REFERENCES feed_posts(id) ON DELETE CASCADE,
    help_kind text NOT NULL CHECK(help_kind IN ('REQUEST','OFFER')),
    help_status text NOT NULL DEFAULT 'OPEN'
        CHECK(help_status IN ('OPEN','PAUSED','RESOLVED','CLOSED','EXPIRED')),
    expires_at timestamptz,
    resolved_at timestamptz,
    closed_at timestamptz,
    expired_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(expires_at IS NULL OR expires_at > created_at),
    CHECK((help_status='RESOLVED') = (resolved_at IS NOT NULL)),
    CHECK((help_status='CLOSED') = (closed_at IS NOT NULL)),
    CHECK((help_status='EXPIRED') = (expired_at IS NOT NULL)),
    CHECK(num_nonnulls(resolved_at,closed_at,expired_at) <= 1)
);
CREATE INDEX ix_community_help_open_kind_expiry
    ON community_help_posts(help_kind,expires_at,post_id)
    WHERE help_status='OPEN';
CREATE INDEX ix_community_help_status_expiry
    ON community_help_posts(help_status,expires_at,post_id);

CREATE TABLE feed_post_media (
    post_id uuid NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE RESTRICT,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(post_id,media_id),
    UNIQUE(post_id,sort_order)
);

CREATE TABLE feed_post_comments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id uuid NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
    author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_comment_id uuid REFERENCES feed_post_comments(id) ON DELETE CASCADE,
    body text NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 5000),
    status content_status NOT NULL DEFAULT 'PUBLISHED',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
CREATE INDEX ix_feed_comments_post_created ON feed_post_comments(post_id,created_at,id) WHERE deleted_at IS NULL;
CREATE INDEX ix_feed_comments_author ON feed_post_comments(author_id,created_at DESC);

CREATE TABLE feed_post_reactions (
    post_id uuid NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reaction_key text NOT NULL DEFAULT 'LIKE' CHECK(reaction_key IN ('LIKE','LOVE','HELPFUL','SUPPORT','THANKS')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(post_id,user_id)
);
CREATE INDEX ix_feed_reactions_user ON feed_post_reactions(user_id,created_at DESC);

CREATE TABLE post_saves (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id uuid NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,post_id)
);
CREATE TABLE post_shares (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id uuid NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    share_target text CHECK(share_target IS NULL OR share_target IN ('COPY_LINK','IN_APP','SYSTEM_SHARE')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_post_shares_post ON post_shares(post_id,created_at DESC);

CREATE TABLE feed_polls (
    post_id uuid PRIMARY KEY REFERENCES feed_posts(id) ON DELETE CASCADE,
    closes_at timestamptz,
    closed_at timestamptz,
    closed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    allow_multiple boolean NOT NULL DEFAULT false,
    allow_vote_change boolean NOT NULL DEFAULT false,
    allow_vote_withdraw boolean NOT NULL DEFAULT false,
    anonymous_voting boolean NOT NULL DEFAULT false,
    results_visibility text NOT NULL DEFAULT 'AFTER_VOTING' CHECK(results_visibility IN ('IMMEDIATE','AFTER_VOTING','AFTER_CLOSE')),
    max_options smallint NOT NULL DEFAULT 10 CHECK(max_options BETWEEN 2 AND 20),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK(closes_at IS NULL OR closes_at > created_at),
    CHECK(closed_at IS NULL OR closed_at >= created_at)
);
CREATE TABLE feed_poll_options (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id uuid NOT NULL REFERENCES feed_polls(post_id) ON DELETE CASCADE,
    option_text text NOT NULL CHECK(length(trim(option_text)) BETWEEN 1 AND 250),
    sort_order integer NOT NULL DEFAULT 0,
    UNIQUE(post_id,sort_order)
);
CREATE TABLE feed_poll_votes (
    option_id uuid NOT NULL REFERENCES feed_poll_options(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(option_id,user_id)
);
CREATE INDEX ix_poll_votes_user ON feed_poll_votes(user_id,created_at DESC);

-- Feed view tracking and featured placements (v10.3).
-- `content_type` + `content_id` is a typed polymorphic reference, not a cross-table FK.
-- The service must validate target existence, publication state, visibility and type.
-- When target content is removed, cancel/end its featured placements and retain or
-- delete view records according to the content/privacy retention policy.
CREATE TABLE user_content_views (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_type content_reference_type NOT NULL,
    content_id uuid NOT NULL,
    first_viewed_at timestamptz NOT NULL DEFAULT now(),
    last_viewed_at timestamptz NOT NULL DEFAULT now(),
    view_count integer NOT NULL DEFAULT 1 CHECK(view_count >= 1),
    PRIMARY KEY(user_id,content_type,content_id),
    CHECK(last_viewed_at >= first_viewed_at)
);
CREATE INDEX ix_user_content_views_user_recent ON user_content_views(user_id,last_viewed_at DESC);
CREATE INDEX ix_user_content_views_content ON user_content_views(content_type,content_id);

CREATE TABLE featured_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    content_type content_reference_type NOT NULL,
    content_id uuid NOT NULL,
    feature_kind featured_item_kind NOT NULL DEFAULT 'EDITORIAL',
    placement_key text NOT NULL DEFAULT 'MAIN_FEED'
        CHECK(placement_key=upper(trim(placement_key)) AND placement_key ~ '^[A-Z][A-Z0-9_]*$'),
    priority integer NOT NULL DEFAULT 0 CHECK(priority BETWEEN -1000 AND 1000),
    status featured_item_status NOT NULL DEFAULT 'DRAFT',
    starts_at timestamptz NOT NULL DEFAULT now(),
    ends_at timestamptz,
    campaign_key text,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(ends_at IS NULL OR ends_at > starts_at),
    CHECK(campaign_key IS NULL OR length(trim(campaign_key)) BETWEEN 1 AND 120)
);
CREATE INDEX ix_featured_items_placement_priority
    ON featured_items(placement_key,priority DESC,starts_at DESC,id)
    WHERE status IN ('SCHEDULED','ACTIVE');
CREATE INDEX ix_featured_items_content
    ON featured_items(content_type,content_id,status);
CREATE INDEX ix_featured_items_creator_status
    ON featured_items(created_by_user_id,status,created_at DESC)
    WHERE created_by_user_id IS NOT NULL;
-- Explicit allow-list of content type -> placement combinations. The API chooses a valid placement
-- from package/entitlement and platform policy; client payloads cannot grant placements. Create one featured_items row per placement.
CREATE TABLE featured_placement_rules (
    content_type content_reference_type NOT NULL,
    placement_key text NOT NULL CHECK(placement_key=upper(trim(placement_key)) AND placement_key ~ '^[A-Z][A-Z0-9_]*$'),
    is_enabled boolean NOT NULL DEFAULT true,
    rule_config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(rule_config)='object'),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(content_type,placement_key)
);
INSERT INTO featured_placement_rules(content_type,placement_key) VALUES
 ('FEED_POST','MAIN_FEED'),
 ('EVENT','MAIN_FEED'),('EVENT','EVENTS'),
 ('JOB','MAIN_FEED'),('JOB','JOBS'),
 ('PROPERTY','MAIN_FEED'),('PROPERTY','PROPERTY_LISTINGS'),
 ('VEHICLE','MAIN_FEED'),('VEHICLE','VEHICLE_LISTINGS'),
 ('BUSINESS','MAIN_FEED'),('BUSINESS','BUSINESS_DIRECTORY'),
 ('SPARE_BAG_LISTING','MAIN_FEED'),('SPARE_BAG_LISTING','SPARE_BAG')
ON CONFLICT(content_type,placement_key) DO NOTHING;
CREATE OR REPLACE FUNCTION validate_featured_item_placement()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM featured_placement_rules r WHERE r.content_type=NEW.content_type AND r.placement_key=NEW.placement_key AND r.is_enabled) THEN
        RAISE EXCEPTION 'Placement is not enabled for this content type; placement is backend-controlled' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_featured_item_placement_integrity BEFORE INSERT OR UPDATE OF content_type,placement_key ON featured_items
FOR EACH ROW EXECUTE FUNCTION validate_featured_item_placement();
COMMENT ON TABLE featured_placement_rules IS 'Backend-controlled allow-list of content types and placement surfaces. The user cannot directly select arbitrary placement; validate promotion product, entitlement, payment, publication state, audience and moderation separately.';


-- Optional, higher-volume measurement table. Record a qualified visible impression,
-- not every API fetch or off-screen card render. Define retention/partitioning based
-- on measured volume before production; the idempotency key protects client retries.
CREATE TABLE featured_item_impressions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    impression_key uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    featured_item_id uuid NOT NULL REFERENCES featured_items(id) ON DELETE CASCADE,
    viewer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    placement_key text NOT NULL
        CHECK(placement_key=upper(trim(placement_key)) AND placement_key ~ '^[A-Z][A-Z0-9_]*$'),
    feed_position integer NOT NULL CHECK(feed_position > 0),
    session_id uuid,
    impressed_at timestamptz NOT NULL DEFAULT now(),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ix_featured_impressions_item_time
    ON featured_item_impressions(featured_item_id,impressed_at DESC);
CREATE INDEX ix_featured_impressions_viewer_time
    ON featured_item_impressions(viewer_user_id,impressed_at DESC)
    WHERE viewer_user_id IS NOT NULL;


-- 6. General text chat and private messaging. No permanent General Voice Room exists.
CREATE TABLE chat_rooms (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    name text NOT NULL DEFAULT 'General Chat',
    room_type text NOT NULL DEFAULT 'GENERAL' CHECK(room_type IN ('GENERAL','ANNOUNCEMENTS')),
    description text,
    is_active boolean NOT NULL DEFAULT true,
    last_message_seq bigint NOT NULL DEFAULT 0 CHECK(last_message_seq >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(community_id,name)
);
CREATE UNIQUE INDEX ux_one_general_chat_per_community ON chat_rooms(community_id) WHERE room_type='GENERAL';
ALTER TABLE user_mutes ADD CONSTRAINT fk_user_mutes_chat_room FOREIGN KEY(room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE;

CREATE TABLE chat_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id uuid NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_message_id text,
    sequence_no bigint NOT NULL CHECK(sequence_no > 0),
    body text CHECK(body IS NULL OR length(body) <= 10000),
    message_type text NOT NULL DEFAULT 'TEXT' CHECK(message_type IN ('TEXT','SYSTEM','MEDIA')),
    status content_status NOT NULL DEFAULT 'PUBLISHED',
    reply_to_message_id uuid REFERENCES chat_messages(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    edited_at timestamptz,
    deleted_at timestamptz,
    CHECK(body IS NOT NULL OR message_type IN ('SYSTEM','MEDIA')),
    UNIQUE(room_id,sequence_no)
);
CREATE UNIQUE INDEX ux_chat_client_message ON chat_messages(sender_id,client_message_id) WHERE client_message_id IS NOT NULL;
CREATE INDEX ix_chat_messages_room_created ON chat_messages(room_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE OR REPLACE FUNCTION enforce_chat_message_restriction()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_community uuid;
BEGIN
    SELECT community_id INTO v_community FROM chat_rooms WHERE id=NEW.room_id AND is_active=true;
    IF v_community IS NULL THEN RAISE EXCEPTION 'Chat room is missing or inactive' USING ERRCODE='23514'; END IF;
    IF EXISTS (
        SELECT 1 FROM user_mutes m
        WHERE m.user_id=NEW.sender_id AND m.scope IN ('CHAT','ALL')
          AND m.starts_at<=now() AND (m.ends_at IS NULL OR m.ends_at>now()) AND m.revoked_at IS NULL
          AND (m.room_id IS NULL OR m.room_id=NEW.room_id)
          AND (m.community_id IS NULL OR m.community_id=v_community)
    ) THEN
        RAISE EXCEPTION 'This user is currently muted or banned from the chat scope' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_enforce_chat_message_restriction BEFORE INSERT ON chat_messages
FOR EACH ROW EXECUTE FUNCTION enforce_chat_message_restriction();
-- Per-user General Chat read cursor and mention edges support unread counts without
-- requiring clients to write directly to the database.
CREATE TABLE chat_room_user_state (
    room_id uuid NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_seq bigint NOT NULL DEFAULT 0 CHECK(last_read_seq >= 0),
    last_read_at timestamptz,
    notifications_muted_until timestamptz,
    joined_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(room_id,user_id)
);
CREATE INDEX ix_chat_room_user_state_user ON chat_room_user_state(user_id,room_id);

CREATE TABLE chat_message_mentions (
    message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    mentioned_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(message_id,mentioned_user_id)
);
CREATE INDEX ix_chat_mentions_user_time ON chat_message_mentions(mentioned_user_id,created_at DESC);

CREATE TABLE chat_message_media (
    message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE RESTRICT,
    sort_order integer NOT NULL DEFAULT 0,
    PRIMARY KEY(message_id,media_id),
    UNIQUE(message_id,sort_order)
);

CREATE TABLE direct_conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- participant_*_id is the canonical profile identity for a personal participant, or the
    -- stable creator/representative profile for a business participant. The nullable business
    -- account column defines the actual participant identity when the side is a business.
    participant_a_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    participant_b_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    participant_a_business_account_id uuid,
    participant_b_business_account_id uuid,
    context_type text NOT NULL DEFAULT 'GENERAL' CHECK(context_type IN
       ('GENERAL','PROPERTY_LISTING','VEHICLE_LISTING','BUSINESS_PROFILE','EVENT','JOB_LISTING','SPARE_BAG_CONTACT','SERVICE_REQUEST','COMMUNITY_HELP_POST')),
    context_id uuid,
    status dm_status NOT NULL DEFAULT 'REQUESTED',
    created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_message_seq bigint NOT NULL DEFAULT 0 CHECK(last_message_seq >= 0),
    matchmaking_match_id uuid UNIQUE,
    last_message_at timestamptz,
    last_message_preview text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK((context_type='GENERAL' AND context_id IS NULL) OR (context_type<>'GENERAL' AND context_id IS NOT NULL)),
    CHECK(COALESCE('B:'||participant_a_business_account_id::text,'U:'||participant_a_id::text)
          < COALESCE('B:'||participant_b_business_account_id::text,'U:'||participant_b_id::text)),
    CONSTRAINT uq_direct_conversations_pair_context UNIQUE NULLS NOT DISTINCT
       (participant_a_id,participant_b_id,participant_a_business_account_id,participant_b_business_account_id,context_type,context_id)
);
CREATE INDEX ix_direct_conversations_recent ON direct_conversations(last_message_at DESC NULLS LAST);
CREATE INDEX ix_direct_conversations_context ON direct_conversations(context_type,context_id,last_message_at DESC);
CREATE INDEX ix_direct_conversations_participant_a ON direct_conversations(participant_a_id,participant_a_business_account_id,status,last_message_at DESC);
CREATE INDEX ix_direct_conversations_participant_b ON direct_conversations(participant_b_id,participant_b_business_account_id,status,last_message_at DESC);

CREATE TABLE direct_conversation_participants (
    conversation_id uuid NOT NULL REFERENCES direct_conversations(id) ON DELETE CASCADE,
    side char(1) NOT NULL CHECK(side IN ('A','B')),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at timestamptz NOT NULL DEFAULT now(),
    last_read_seq bigint NOT NULL DEFAULT 0 CHECK(last_read_seq >= 0),
    last_read_at timestamptz,
    archived_at timestamptz,
    muted_until timestamptz,
    PRIMARY KEY(conversation_id,side,user_id)
);
CREATE INDEX ix_conversation_participants_user ON direct_conversation_participants(user_id,conversation_id);
CREATE INDEX ix_conversation_participants_inbox ON direct_conversation_participants(user_id,archived_at,conversation_id);

CREATE OR REPLACE FUNCTION validate_direct_conversation_participant()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_business uuid; v_personal uuid;
BEGIN
    IF NEW.side='A' THEN
        SELECT participant_a_id,participant_a_business_account_id INTO v_personal,v_business
          FROM direct_conversations WHERE id=NEW.conversation_id;
    ELSE
        SELECT participant_b_id,participant_b_business_account_id INTO v_personal,v_business
          FROM direct_conversations WHERE id=NEW.conversation_id;
    END IF;
    IF v_personal IS NULL THEN
        RAISE EXCEPTION 'Direct conversation side does not exist' USING ERRCODE='23503';
    END IF;
    IF v_business IS NULL THEN
        IF NEW.user_id IS DISTINCT FROM v_personal THEN
            RAISE EXCEPTION 'Personal conversation participant must be the endpoint user' USING ERRCODE='23514';
        END IF;
    ELSE
        IF NOT EXISTS (SELECT 1 FROM business_account_members m
            WHERE m.business_account_id=v_business AND m.user_id=NEW.user_id
              AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL) THEN
            RAISE EXCEPTION 'Business conversation participant must be an active accepted business member' USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_direct_conversation_pair_member BEFORE INSERT OR UPDATE OF conversation_id,side,user_id
ON direct_conversation_participants FOR EACH ROW EXECUTE FUNCTION validate_direct_conversation_participant();

CREATE OR REPLACE FUNCTION prevent_direct_conversation_pair_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.participant_a_id IS DISTINCT FROM OLD.participant_a_id
       OR NEW.participant_b_id IS DISTINCT FROM OLD.participant_b_id
       OR NEW.participant_a_business_account_id IS DISTINCT FROM OLD.participant_a_business_account_id
       OR NEW.participant_b_business_account_id IS DISTINCT FROM OLD.participant_b_business_account_id
       OR NEW.context_type IS DISTINCT FROM OLD.context_type
       OR NEW.context_id IS DISTINCT FROM OLD.context_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'Conversation identities, context and creator are immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_direct_conversation_pair_immutable BEFORE UPDATE OF
 participant_a_id,participant_b_id,participant_a_business_account_id,participant_b_business_account_id,context_type,context_id,created_by
ON direct_conversations FOR EACH ROW EXECUTE FUNCTION prevent_direct_conversation_pair_change();

CREATE OR REPLACE FUNCTION seed_direct_conversation_participants()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.participant_a_business_account_id IS NULL THEN
        INSERT INTO direct_conversation_participants(conversation_id,side,user_id) VALUES(NEW.id,'A',NEW.participant_a_id)
        ON CONFLICT DO NOTHING;
    ELSE
        INSERT INTO direct_conversation_participants(conversation_id,side,user_id)
        SELECT NEW.id,'A',m.user_id FROM business_account_members m
        WHERE m.business_account_id=NEW.participant_a_business_account_id AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL
        ON CONFLICT DO NOTHING;
    END IF;
    IF NEW.participant_b_business_account_id IS NULL THEN
        INSERT INTO direct_conversation_participants(conversation_id,side,user_id) VALUES(NEW.id,'B',NEW.participant_b_id)
        ON CONFLICT DO NOTHING;
    ELSE
        INSERT INTO direct_conversation_participants(conversation_id,side,user_id)
        SELECT NEW.id,'B',m.user_id FROM business_account_members m
        WHERE m.business_account_id=NEW.participant_b_business_account_id AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_seed_direct_conversation_participants AFTER INSERT ON direct_conversations
FOR EACH ROW EXECUTE FUNCTION seed_direct_conversation_participants();

CREATE TABLE direct_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES direct_conversations(id) ON DELETE CASCADE,
    sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_business_account_id uuid,
    message_request_id uuid,
    client_message_id text,
    sequence_no bigint NOT NULL CHECK(sequence_no > 0),
    body text CHECK(body IS NULL OR length(body) <= 10000),
    message_type text NOT NULL DEFAULT 'TEXT' CHECK(message_type IN ('TEXT','SYSTEM','MEDIA')),
    status content_status NOT NULL DEFAULT 'PUBLISHED',
    reply_to_message_id uuid REFERENCES direct_messages(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    edited_at timestamptz,
    deleted_at timestamptz,
    CHECK(body IS NOT NULL OR message_type IN ('SYSTEM','MEDIA')),
    UNIQUE(conversation_id,sequence_no)
);
CREATE UNIQUE INDEX ux_direct_message_client_id ON direct_messages(sender_id,client_message_id) WHERE client_message_id IS NOT NULL;
CREATE INDEX ix_direct_messages_conversation ON direct_messages(conversation_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_direct_messages_sender_business ON direct_messages(sender_business_account_id,created_at DESC) WHERE sender_business_account_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_direct_message_sender()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_match boolean := false;
BEGIN
    SELECT EXISTS (
       SELECT 1 FROM direct_conversations dc
       WHERE dc.id=NEW.conversation_id AND (
          (NEW.sender_business_account_id IS NULL AND dc.participant_a_business_account_id IS NULL AND dc.participant_a_id=NEW.sender_id)
          OR (NEW.sender_business_account_id IS NULL AND dc.participant_b_business_account_id IS NULL AND dc.participant_b_id=NEW.sender_id)
          OR (NEW.sender_business_account_id IS NOT NULL AND dc.participant_a_business_account_id=NEW.sender_business_account_id
              AND EXISTS (SELECT 1 FROM business_account_members m WHERE m.business_account_id=NEW.sender_business_account_id
                AND m.user_id=NEW.sender_id AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL))
          OR (NEW.sender_business_account_id IS NOT NULL AND dc.participant_b_business_account_id=NEW.sender_business_account_id
              AND EXISTS (SELECT 1 FROM business_account_members m WHERE m.business_account_id=NEW.sender_business_account_id
                AND m.user_id=NEW.sender_id AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL))
       )) INTO v_match;
    IF NOT v_match THEN
        RAISE EXCEPTION 'Message sender must be a valid active participant identity for this conversation' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_direct_message_sender_pair BEFORE INSERT OR UPDATE OF conversation_id,sender_id,sender_business_account_id
ON direct_messages FOR EACH ROW EXECUTE FUNCTION validate_direct_message_sender();

CREATE TABLE direct_message_media (
    message_id uuid NOT NULL REFERENCES direct_messages(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE RESTRICT,
    sort_order integer NOT NULL DEFAULT 0,
    PRIMARY KEY(message_id,media_id),
    UNIQUE(message_id,sort_order)
);

CREATE TABLE message_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES direct_conversations(id) ON DELETE CASCADE,
    sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_business_account_id uuid,
    recipient_business_account_id uuid,
    status dm_status NOT NULL DEFAULT 'REQUESTED',
    created_at timestamptz NOT NULL DEFAULT now(),
    responded_at timestamptz,
    expires_at timestamptz,
    CHECK(COALESCE('B:'||sender_business_account_id::text,'U:'||sender_id::text)
          <> COALESCE('B:'||recipient_business_account_id::text,'U:'||recipient_id::text))
);
CREATE UNIQUE INDEX ux_pending_message_request_context
 ON message_requests(conversation_id,
   LEAST(COALESCE('B:'||sender_business_account_id::text,'U:'||sender_id::text),COALESCE('B:'||recipient_business_account_id::text,'U:'||recipient_id::text)),
   GREATEST(COALESCE('B:'||sender_business_account_id::text,'U:'||sender_id::text),COALESCE('B:'||recipient_business_account_id::text,'U:'||recipient_id::text)))
 WHERE status='REQUESTED';
CREATE INDEX ix_message_requests_recipient ON message_requests(recipient_id,status,created_at DESC);
CREATE INDEX ix_message_requests_business_recipient ON message_requests(recipient_business_account_id,status,created_at DESC)
 WHERE recipient_business_account_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_message_request_conversation_pair()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_a uuid; v_b uuid; v_abiz uuid; v_bbiz uuid; v_context text; v_conv_status dm_status; v_sender_a boolean; v_sender_b boolean; v_recipient_a boolean; v_recipient_b boolean;
BEGIN
    SELECT participant_a_id,participant_b_id,participant_a_business_account_id,participant_b_business_account_id,context_type,status
      INTO v_a,v_b,v_abiz,v_bbiz,v_context,v_conv_status FROM direct_conversations WHERE id=NEW.conversation_id;
    IF v_a IS NULL THEN RAISE EXCEPTION 'Message request conversation does not exist' USING ERRCODE='23503'; END IF;
    IF v_context<>'GENERAL' THEN
        RAISE EXCEPTION 'Context-based conversations do not use message-request acceptance; validate context contact permissions instead' USING ERRCODE='23514';
    END IF;
    IF v_conv_status IS DISTINCT FROM 'REQUESTED' THEN
        RAISE EXCEPTION 'Message requests may only be created for a conversation awaiting first-contact acceptance' USING ERRCODE='23514';
    END IF;
    v_sender_a := (NEW.sender_business_account_id IS NULL AND v_abiz IS NULL AND NEW.sender_id=v_a)
       OR (NEW.sender_business_account_id IS NOT NULL AND NEW.sender_business_account_id=v_abiz AND EXISTS (
         SELECT 1 FROM business_account_members m WHERE m.business_account_id=v_abiz AND m.user_id=NEW.sender_id AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL));
    v_sender_b := (NEW.sender_business_account_id IS NULL AND v_bbiz IS NULL AND NEW.sender_id=v_b)
       OR (NEW.sender_business_account_id IS NOT NULL AND NEW.sender_business_account_id=v_bbiz AND EXISTS (
         SELECT 1 FROM business_account_members m WHERE m.business_account_id=v_bbiz AND m.user_id=NEW.sender_id AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL));
    v_recipient_a := (NEW.recipient_business_account_id IS NULL AND v_abiz IS NULL AND NEW.recipient_id=v_a)
       OR (NEW.recipient_business_account_id IS NOT NULL AND NEW.recipient_business_account_id=v_abiz AND EXISTS (
         SELECT 1 FROM business_account_members m WHERE m.business_account_id=v_abiz AND m.user_id=NEW.recipient_id AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL));
    v_recipient_b := (NEW.recipient_business_account_id IS NULL AND v_bbiz IS NULL AND NEW.recipient_id=v_b)
       OR (NEW.recipient_business_account_id IS NOT NULL AND NEW.recipient_business_account_id=v_bbiz AND EXISTS (
         SELECT 1 FROM business_account_members m WHERE m.business_account_id=v_bbiz AND m.user_id=NEW.recipient_id AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL));
    IF NOT ((v_sender_a AND v_recipient_b) OR (v_sender_b AND v_recipient_a)) OR
       (NEW.sender_business_account_id IS NOT NULL AND NEW.sender_business_account_id=NEW.recipient_business_account_id) OR
       (NEW.sender_business_account_id IS NULL AND NEW.recipient_business_account_id IS NULL AND NEW.sender_id=NEW.recipient_id) THEN
        RAISE EXCEPTION 'Message request sender and recipient must be opposite valid conversation identities' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_message_request_pair BEFORE INSERT OR UPDATE OF conversation_id,sender_id,recipient_id,sender_business_account_id,recipient_business_account_id
ON message_requests FOR EACH ROW EXECUTE FUNCTION validate_message_request_conversation_pair();

CREATE OR REPLACE FUNCTION activate_conversation_after_request_acceptance()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status='ACCEPTED' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'ACCEPTED') THEN
        UPDATE direct_conversations SET status='ACCEPTED',updated_at=now() WHERE id=NEW.conversation_id AND status<>'CLOSED';
    ELSIF NEW.status='CLOSED' THEN
        UPDATE direct_conversations SET status='CLOSED',updated_at=now() WHERE id=NEW.conversation_id;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_activate_conversation_after_request AFTER INSERT OR UPDATE OF status ON message_requests
FOR EACH ROW EXECUTE FUNCTION activate_conversation_after_request_acceptance();

ALTER TABLE direct_messages ADD CONSTRAINT fk_direct_message_request
  FOREIGN KEY(message_request_id) REFERENCES message_requests(id) ON DELETE RESTRICT;


-- Voice-room topics have their own taxonomy; do not reuse country practical-life categories.
CREATE TABLE voice_room_categories (
    category_key text PRIMARY KEY CHECK(category_key=upper(trim(category_key)) AND length(category_key) BETWEEN 1 AND 60),
    display_name text NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 100),
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0
);
INSERT INTO voice_room_categories(category_key,display_name,sort_order) VALUES
 ('SOCIAL','Social',10),('NEW_TO_COUNTRY','New to the country',20),('JOBS_CAREERS','Jobs and careers',30),
 ('EDUCATION','Education',40),('CULTURE_LANGUAGE','Culture and language',50),('HELP_ADVICE','Help and advice',60),('OTHER','Other',90)
ON CONFLICT(category_key) DO NOTHING;

-- 7. Persistent user-created voice-room definitions. There is intentionally no GENERAL room type; live sessions are separate and disposable.
CREATE TABLE voice_rooms (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id uuid NOT NULL REFERENCES countries(id),
    community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 100),
    description text CHECK(description IS NULL OR length(description) <= 700),
    category_key text NOT NULL DEFAULT 'SOCIAL' REFERENCES voice_room_categories(category_key) ON DELETE RESTRICT,
    visibility room_visibility NOT NULL DEFAULT 'PUBLIC',
    status voice_room_status NOT NULL DEFAULT 'ACTIVE',
    is_discoverable boolean NOT NULL DEFAULT true,
    max_participants integer NOT NULL DEFAULT 100 CHECK(max_participants BETWEEN 2 AND 1000),
    max_speakers smallint NOT NULL DEFAULT 8 CHECK(max_speakers BETWEEN 1 AND 30),
    CHECK(max_participants > max_speakers),
    inactivity_timeout_minutes smallint NOT NULL DEFAULT 30 CHECK(inactivity_timeout_minutes BETWEEN 1 AND 1440),
    last_activity_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,
    archived_by uuid REFERENCES users(id) ON DELETE SET NULL,
    archive_reason text,
    suspended_at timestamptz,
    suspended_by uuid REFERENCES users(id) ON DELETE SET NULL,
    suspension_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_voice_rooms_discovery ON voice_rooms(country_id,community_id,visibility,status,is_discoverable,created_at DESC);
CREATE OR REPLACE FUNCTION validate_voice_room_country() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_destination uuid;
BEGIN
    SELECT destination_country_id INTO v_destination FROM communities WHERE id=NEW.community_id AND is_active=true;
    IF v_destination IS NULL OR v_destination <> NEW.country_id THEN
        RAISE EXCEPTION 'voice room country must equal an active community destination country';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_voice_room_country ON voice_rooms;
CREATE TRIGGER trg_voice_room_country BEFORE INSERT OR UPDATE OF country_id,community_id ON voice_rooms
FOR EACH ROW EXECUTE FUNCTION validate_voice_room_country();
CREATE INDEX ix_voice_rooms_owner ON voice_rooms(owner_user_id,status,updated_at DESC);
CREATE INDEX ix_voice_rooms_recent_activity ON voice_rooms(last_activity_at DESC) WHERE status IN ('ACTIVE','LOCKED');

CREATE OR REPLACE FUNCTION validate_voice_room_owner()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.owner_user_id IS NULL THEN RAISE EXCEPTION 'Persistent voice room requires an owner' USING ERRCODE='23502'; END IF;
    IF NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.owner_user_id AND account_status='ACTIVE' AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Voice room owner must have an active profile' USING ERRCODE='23514';
    END IF;
    IF TG_OP='INSERT' AND NEW.created_by IS NULL THEN NEW.created_by:=NEW.owner_user_id; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_voice_room_owner_integrity BEFORE INSERT OR UPDATE OF owner_user_id ON voice_rooms
FOR EACH ROW EXECUTE FUNCTION validate_voice_room_owner();

CREATE TABLE voice_room_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id uuid NOT NULL REFERENCES voice_rooms(id) ON DELETE CASCADE,
    status voice_session_status NOT NULL DEFAULT 'ACTIVE',
    rtc_provider rtc_provider NOT NULL,
    provider_room_reference text,
    started_by uuid REFERENCES users(id) ON DELETE SET NULL,
    host_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    host_left_at timestamptz,
    hostless_expires_at timestamptz,
    inactive_since timestamptz,
    grace_expires_at timestamptz,
    ended_at timestamptz,
    end_reason text,
    provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_one_live_or_grace_session_per_room ON voice_room_sessions(room_id) WHERE status IN ('ACTIVE','INACTIVE');
CREATE OR REPLACE FUNCTION validate_voice_session_start()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_room_status voice_room_status;
BEGIN
    SELECT status INTO v_room_status FROM voice_rooms WHERE id=NEW.room_id FOR UPDATE;
    IF v_room_status IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION 'A live session can start only for an ACTIVE persistent room' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_voice_session_start BEFORE INSERT OR UPDATE OF room_id ON voice_room_sessions
FOR EACH ROW EXECUTE FUNCTION validate_voice_session_start();

CREATE INDEX ix_voice_sessions_grace ON voice_room_sessions(grace_expires_at) WHERE status='INACTIVE';
CREATE INDEX ix_voice_sessions_hostless ON voice_room_sessions(hostless_expires_at) WHERE status='ACTIVE' AND hostless_expires_at IS NOT NULL;

CREATE TABLE voice_room_participants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES voice_room_sessions(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role participant_role NOT NULL DEFAULT 'LISTENER',
    joined_at timestamptz NOT NULL DEFAULT now(),
    left_at timestamptz,
    connection_state text NOT NULL DEFAULT 'CONNECTED' CHECK(connection_state IN ('CONNECTED','RECONNECTING','DISCONNECTED')),
    last_presence_at timestamptz NOT NULL DEFAULT now(),
    removed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    role_changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    role_changed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_active_voice_participant ON voice_room_participants(session_id,user_id) WHERE left_at IS NULL;
CREATE UNIQUE INDEX ux_active_session_host ON voice_room_participants(session_id) WHERE left_at IS NULL AND role='HOST';
CREATE INDEX ix_voice_participants_presence ON voice_room_participants(session_id,left_at,last_presence_at);
CREATE INDEX ix_voice_participants_user ON voice_room_participants(user_id,joined_at DESC);

-- Optional fixed speaker-stage slots for a Litmatch-style voice-room UI.
CREATE TABLE voice_room_seats (
    session_id uuid NOT NULL REFERENCES voice_room_sessions(id) ON DELETE CASCADE,
    seat_number smallint NOT NULL CHECK(seat_number BETWEEN 1 AND 30),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN ('AVAILABLE','OCCUPIED','LOCKED')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(session_id,seat_number),
    CHECK((status='OCCUPIED' AND user_id IS NOT NULL) OR (status<>'OCCUPIED' AND user_id IS NULL))
);
CREATE UNIQUE INDEX ux_voice_room_seat_user ON voice_room_seats(session_id,user_id) WHERE user_id IS NOT NULL;
CREATE OR REPLACE FUNCTION validate_voice_room_seat()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_max_speakers integer;
BEGIN
    SELECT vr.max_speakers INTO v_max_speakers
      FROM voice_room_sessions s JOIN voice_rooms vr ON vr.id=s.room_id
      WHERE s.id=NEW.session_id;
    IF v_max_speakers IS NULL OR NEW.seat_number > v_max_speakers THEN
        RAISE EXCEPTION 'Seat number exceeds the session room speaker limit' USING ERRCODE='23514';
    END IF;
    IF NEW.status='OCCUPIED' AND NOT EXISTS (
        SELECT 1 FROM voice_room_participants p
        WHERE p.session_id=NEW.session_id AND p.user_id=NEW.user_id
          AND p.left_at IS NULL AND p.role IN ('SPEAKER','HOST')
    ) THEN
        RAISE EXCEPTION 'Only an active speaker or host can occupy a voice-room seat' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_voice_room_seat_integrity ON voice_room_seats;
CREATE TRIGGER trg_voice_room_seat_integrity
BEFORE INSERT OR UPDATE OF session_id,seat_number,user_id,status ON voice_room_seats
FOR EACH ROW EXECUTE FUNCTION validate_voice_room_seat();

CREATE OR REPLACE FUNCTION release_voice_room_seat_on_participant_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_session uuid; v_user uuid;
BEGIN
    IF TG_OP='DELETE' THEN
        v_session:=OLD.session_id; v_user:=OLD.user_id;
    ELSE
        IF NEW.left_at IS NULL AND NEW.role IN ('SPEAKER','HOST') THEN RETURN NEW; END IF;
        v_session:=NEW.session_id; v_user:=NEW.user_id;
    END IF;
    UPDATE voice_room_seats SET user_id=NULL,status='AVAILABLE',updated_at=now()
      WHERE session_id=v_session AND user_id=v_user;
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
DROP TRIGGER IF EXISTS trg_release_voice_room_seat ON voice_room_participants;
CREATE TRIGGER trg_release_voice_room_seat
AFTER UPDATE OF left_at,role OR DELETE ON voice_room_participants
FOR EACH ROW EXECUTE FUNCTION release_voice_room_seat_on_participant_change();


-- Every live session receives exactly max_speakers numbered stage slots. The host occupies a slot.
CREATE OR REPLACE FUNCTION seed_voice_room_seats()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_slots integer;
BEGIN
    SELECT max_speakers INTO v_slots FROM voice_rooms WHERE id=NEW.room_id;
    IF v_slots IS NULL THEN RAISE EXCEPTION 'Voice room does not exist' USING ERRCODE='23503'; END IF;
    INSERT INTO voice_room_seats(session_id,seat_number,status)
    SELECT NEW.id, gs, 'AVAILABLE' FROM generate_series(1,v_slots) AS gs
    ON CONFLICT(session_id,seat_number) DO NOTHING;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_seed_voice_room_seats ON voice_room_sessions;
CREATE TRIGGER trg_seed_voice_room_seats AFTER INSERT ON voice_room_sessions
FOR EACH ROW EXECUTE FUNCTION seed_voice_room_seats();

-- Serialize admission/promotion on the session row so concurrent joins/promotions cannot
-- exceed max_participants or max_speakers. Only the backend may assign HOST/MODERATOR roles.
CREATE OR REPLACE FUNCTION validate_voice_room_participant_capacity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_session_status voice_session_status;
    v_persistent_room_status voice_room_status;
    v_host uuid;
    v_max_participants integer;
    v_max_speakers integer;
    v_active_count integer;
    v_speaker_count integer;
    v_exclude_id uuid;
    v_actor_role participant_role;
BEGIN
    IF TG_OP='UPDATE' AND (
        NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
    ) THEN
        RAISE EXCEPTION 'Participant identity and session are immutable; leave and rejoin to create a new participation record' USING ERRCODE='23514';
    END IF;

    SELECT s.status,s.host_user_id,r.max_participants,r.max_speakers,r.status
      INTO v_session_status,v_host,v_max_participants,v_max_speakers,v_persistent_room_status
      FROM voice_room_sessions s JOIN voice_rooms r ON r.id=s.room_id
      WHERE s.id=NEW.session_id FOR UPDATE OF s;
    IF v_session_status IS NULL THEN
        RAISE EXCEPTION 'Voice session does not exist' USING ERRCODE='23503';
    END IF;

    IF TG_OP='INSERT' THEN
        IF v_persistent_room_status IS DISTINCT FROM 'ACTIVE' THEN
            RAISE EXCEPTION 'New participants can join only an ACTIVE persistent voice room' USING ERRCODE='23514';
        END IF;
        IF NEW.role='SPEAKER' THEN
            RAISE EXCEPTION 'A participant must join as listener and be promoted through the speaker workflow' USING ERRCODE='23514';
        ELSIF NEW.role='HOST' AND NEW.user_id IS DISTINCT FROM v_host THEN
            RAISE EXCEPTION 'Only the configured session host may join with the HOST role' USING ERRCODE='23514';
        ELSIF NEW.role='MODERATOR' THEN
            IF NEW.role_changed_by IS NULL OR NEW.role_changed_by=NEW.user_id THEN
                RAISE EXCEPTION 'A room moderator must be appointed by the active host' USING ERRCODE='23514';
            END IF;
            SELECT role INTO v_actor_role FROM voice_room_participants
              WHERE session_id=NEW.session_id AND user_id=NEW.role_changed_by AND left_at IS NULL;
            IF v_actor_role IS DISTINCT FROM 'HOST' THEN
                RAISE EXCEPTION 'Only the active host may appoint a room moderator' USING ERRCODE='23514';
            END IF;
            NEW.role_changed_at:=COALESCE(NEW.role_changed_at,now());
        END IF;
    ELSE
        IF NEW.role IS DISTINCT FROM OLD.role THEN
            IF NOT (
                (OLD.role='LISTENER' AND NEW.role='SPEAKER') OR
                (OLD.role='SPEAKER' AND NEW.role='LISTENER') OR
                (OLD.role='LISTENER' AND NEW.role='MODERATOR') OR
                (OLD.role='MODERATOR' AND NEW.role='LISTENER') OR
                (OLD.role='HOST' AND NEW.role='MODERATOR') OR
                (OLD.role='MODERATOR' AND NEW.role='HOST')
            ) THEN
                RAISE EXCEPTION 'Unsupported voice participant role transition' USING ERRCODE='23514';
            END IF;
            IF NEW.role_changed_by IS NULL THEN
                RAISE EXCEPTION 'Voice participant role changes require an actor' USING ERRCODE='23514';
            END IF;
            -- A speaker may lower their own hand. Host transfer must first change session.host_user_id,
            -- then demote the former host and promote the designated new host in the same transaction.
            IF OLD.role='SPEAKER' AND NEW.role='LISTENER' AND NEW.role_changed_by=NEW.user_id THEN
                NULL;
            ELSIF OLD.role='HOST' AND NEW.role='MODERATOR'
                  AND NEW.role_changed_by=NEW.user_id AND v_host IS DISTINCT FROM NEW.user_id THEN
                NULL;
            ELSE
                IF NEW.role_changed_by=NEW.user_id THEN
                    RAISE EXCEPTION 'Users cannot promote themselves or appoint themselves as moderator' USING ERRCODE='23514';
                END IF;
                SELECT role INTO v_actor_role FROM voice_room_participants
                  WHERE session_id=NEW.session_id AND user_id=NEW.role_changed_by AND left_at IS NULL;
                IF v_actor_role IS NULL OR v_actor_role NOT IN ('HOST','MODERATOR') THEN
                    RAISE EXCEPTION 'Role changes require an active host or room moderator' USING ERRCODE='23514';
                END IF;
                IF NEW.role='MODERATOR' AND v_actor_role IS DISTINCT FROM 'HOST' THEN
                    RAISE EXCEPTION 'Only the host may appoint a room moderator' USING ERRCODE='23514';
                END IF;
                IF OLD.role='MODERATOR' AND NEW.role='LISTENER' AND v_actor_role IS DISTINCT FROM 'HOST' THEN
                    RAISE EXCEPTION 'Only the host may remove a room moderator' USING ERRCODE='23514';
                END IF;
                IF NEW.role='HOST' AND NEW.user_id IS DISTINCT FROM v_host THEN
                    RAISE EXCEPTION 'Only the designated successor may become host' USING ERRCODE='23514';
                END IF;
            END IF;
            NEW.role_changed_at:=now();
        END IF;
    END IF;

    IF NEW.left_at IS NOT NULL THEN RETURN NEW; END IF;
    IF v_session_status IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION 'Participants can only join or be promoted in an active voice session' USING ERRCODE='23514';
    END IF;

    IF TG_OP='UPDATE' THEN v_exclude_id:=OLD.id; ELSE v_exclude_id:=NULL; END IF;
    SELECT count(*) INTO v_active_count FROM voice_room_participants p
      WHERE p.session_id=NEW.session_id AND p.left_at IS NULL
        AND (v_exclude_id IS NULL OR p.id<>v_exclude_id);
    IF TG_OP='INSERT' THEN
        IF v_active_count >= v_max_participants THEN
            RAISE EXCEPTION 'Voice room has reached max_participants' USING ERRCODE='23514';
        END IF;
    ELSIF OLD.left_at IS NOT NULL THEN
        IF v_active_count >= v_max_participants THEN
            RAISE EXCEPTION 'Voice room has reached max_participants' USING ERRCODE='23514';
        END IF;
    END IF;

    IF NEW.role IN ('HOST','SPEAKER') THEN
        SELECT count(*) INTO v_speaker_count FROM voice_room_participants p
          WHERE p.session_id=NEW.session_id AND p.left_at IS NULL AND p.role IN ('HOST','SPEAKER')
            AND (v_exclude_id IS NULL OR p.id<>v_exclude_id);
        IF v_speaker_count >= v_max_speakers THEN
            RAISE EXCEPTION 'Voice room has reached max_speakers (including the host)' USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_voice_participant_capacity ON voice_room_participants;
CREATE TRIGGER trg_voice_participant_capacity
BEFORE INSERT OR UPDATE OF session_id,user_id,role,left_at ON voice_room_participants
FOR EACH ROW EXECUTE FUNCTION validate_voice_room_participant_capacity();

-- Transfer the host role in one transaction. The application must call this function rather
-- than attempting to change host_user_id/participant roles in separate requests.
CREATE OR REPLACE FUNCTION transfer_voice_room_host(p_session_id uuid,p_current_host_id uuid,p_new_host_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_room_status voice_session_status; v_session_host uuid; v_target_role participant_role;
BEGIN
    SELECT status,host_user_id INTO v_room_status,v_session_host
      FROM voice_room_sessions WHERE id=p_session_id FOR UPDATE;
    IF v_session_host IS DISTINCT FROM p_current_host_id OR v_room_status IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION 'Only the current host may transfer an active voice session' USING ERRCODE='23514';
    END IF;
    IF p_current_host_id=p_new_host_id THEN
        RAISE EXCEPTION 'New host must be a different participant' USING ERRCODE='23514';
    END IF;
    SELECT role INTO v_target_role FROM voice_room_participants
      WHERE session_id=p_session_id AND user_id=p_new_host_id AND left_at IS NULL FOR UPDATE;
    IF v_target_role IS NULL OR v_target_role NOT IN ('LISTENER','SPEAKER','MODERATOR') THEN
        RAISE EXCEPTION 'New host must be an active listener, speaker, or moderator' USING ERRCODE='23514';
    END IF;
    UPDATE voice_room_sessions SET host_user_id=p_new_host_id,updated_at=now() WHERE id=p_session_id;
    UPDATE voice_room_participants SET role='MODERATOR',role_changed_by=p_current_host_id,role_changed_at=now()
      WHERE session_id=p_session_id AND user_id=p_current_host_id AND left_at IS NULL AND role='HOST';
    IF NOT FOUND THEN RAISE EXCEPTION 'Current host participation is missing' USING ERRCODE='23514'; END IF;
    UPDATE voice_room_participants SET role='HOST',role_changed_by=p_current_host_id,role_changed_at=now()
      WHERE session_id=p_session_id AND user_id=p_new_host_id AND left_at IS NULL AND role=v_target_role;
    IF NOT FOUND THEN RAISE EXCEPTION 'New host promotion failed' USING ERRCODE='23514'; END IF;
    INSERT INTO voice_room_moderation_actions(session_id,room_id,actor_id,target_user_id,action_type,metadata)
      SELECT p_session_id,s.room_id,p_current_host_id,p_new_host_id,'TRANSFER_HOST',jsonb_build_object('previousHostId',p_current_host_id,'newHostId',p_new_host_id)
      FROM voice_room_sessions s WHERE s.id=p_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION assign_voice_room_seat_to_speaker()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_seat smallint;
BEGIN
    IF NEW.left_at IS NULL AND NEW.role IN ('HOST','SPEAKER') THEN
        IF EXISTS (SELECT 1 FROM voice_room_seats WHERE session_id=NEW.session_id AND user_id=NEW.user_id AND status='OCCUPIED') THEN
            RETURN NEW;
        END IF;
        SELECT seat_number INTO v_seat FROM voice_room_seats
          WHERE session_id=NEW.session_id AND status='AVAILABLE'
          ORDER BY seat_number LIMIT 1 FOR UPDATE SKIP LOCKED;
        IF v_seat IS NULL THEN
            RAISE EXCEPTION 'No available speaker seat; cannot assign speaker role' USING ERRCODE='23514';
        END IF;
        UPDATE voice_room_seats SET user_id=NEW.user_id,status='OCCUPIED',updated_at=now()
          WHERE session_id=NEW.session_id AND seat_number=v_seat AND status='AVAILABLE';
        IF NOT FOUND THEN RAISE EXCEPTION 'Speaker seat was concurrently taken' USING ERRCODE='23514'; END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_assign_voice_room_seat ON voice_room_participants;
CREATE TRIGGER trg_assign_voice_room_seat AFTER INSERT OR UPDATE OF role,left_at ON voice_room_participants
FOR EACH ROW EXECUTE FUNCTION assign_voice_room_seat_to_speaker();

CREATE OR REPLACE FUNCTION validate_voice_room_speaker_limit_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.max_speakers IS DISTINCT FROM OLD.max_speakers AND EXISTS (
        SELECT 1 FROM voice_room_sessions s WHERE s.room_id=OLD.id AND s.status IN ('ACTIVE','INACTIVE')
    ) THEN
        RAISE EXCEPTION 'Speaker capacity is fixed for the lifetime of a live/grace session' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_voice_room_speaker_limit_immutable_live ON voice_rooms;
CREATE TRIGGER trg_voice_room_speaker_limit_immutable_live BEFORE UPDATE OF max_speakers ON voice_rooms
FOR EACH ROW EXECUTE FUNCTION validate_voice_room_speaker_limit_change();

CREATE TABLE voice_room_speaker_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES voice_room_sessions(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','DECLINED','CANCELLED')),
    requested_at timestamptz NOT NULL DEFAULT now(),
    responded_at timestamptz,
    responded_by uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX ux_pending_speaker_request ON voice_room_speaker_requests(session_id,user_id) WHERE status='PENDING';
CREATE INDEX ix_speaker_requests_session ON voice_room_speaker_requests(session_id,status,requested_at);

CREATE OR REPLACE FUNCTION log_voice_room_role_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_room uuid; v_action text;
BEGIN
    IF NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NEW; END IF;
    IF OLD.role='LISTENER' AND NEW.role IN ('SPEAKER','HOST') THEN v_action:='PROMOTE_SPEAKER';
    ELSIF OLD.role IN ('SPEAKER','HOST') AND NEW.role='LISTENER' THEN v_action:='DEMOTE_SPEAKER';
    ELSE RETURN NEW;
    END IF;
    SELECT room_id INTO v_room FROM voice_room_sessions WHERE id=NEW.session_id;
    INSERT INTO voice_room_moderation_actions(session_id,room_id,actor_id,target_user_id,action_type,metadata)
    VALUES(NEW.session_id,v_room,NEW.role_changed_by,NEW.user_id,v_action,jsonb_build_object('oldRole',OLD.role,'newRole',NEW.role));
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_log_voice_room_role_change ON voice_room_participants;
CREATE TRIGGER trg_log_voice_room_role_change AFTER UPDATE OF role ON voice_room_participants
FOR EACH ROW EXECUTE FUNCTION log_voice_room_role_change();

CREATE OR REPLACE FUNCTION validate_voice_room_speaker_request()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_requester_role participant_role; v_actor_role participant_role; v_session_status voice_session_status;
BEGIN
    IF TG_OP='UPDATE' AND OLD.status IN ('APPROVED','DECLINED','CANCELLED') AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'A terminal speaker request cannot be reopened or changed' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND OLD.status='PENDING' AND NEW.status NOT IN ('PENDING','APPROVED','DECLINED','CANCELLED') THEN
        RAISE EXCEPTION 'Invalid speaker request state transition' USING ERRCODE='23514';
    END IF;
    SELECT status INTO v_session_status FROM voice_room_sessions WHERE id=NEW.session_id;
    IF v_session_status IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION 'Speaker requests require an active voice session' USING ERRCODE='23514';
    END IF;
    SELECT role INTO v_requester_role FROM voice_room_participants
      WHERE session_id=NEW.session_id AND user_id=NEW.user_id AND left_at IS NULL;
    IF v_requester_role IS NULL THEN
        RAISE EXCEPTION 'Speaker requester must be an active participant' USING ERRCODE='23514';
    END IF;
    IF NEW.status='PENDING' AND v_requester_role<>'LISTENER' THEN
        RAISE EXCEPTION 'Only a listener can have a pending request to speak' USING ERRCODE='23514';
    END IF;
    IF NEW.status IN ('APPROVED','DECLINED') THEN
        SELECT role INTO v_actor_role FROM voice_room_participants
          WHERE session_id=NEW.session_id AND user_id=NEW.responded_by AND left_at IS NULL;
        IF NEW.responded_by IS NULL OR v_actor_role IS NULL OR v_actor_role NOT IN ('HOST','MODERATOR') THEN
            RAISE EXCEPTION 'Only an active host or room moderator may approve or decline a speaker request' USING ERRCODE='23514';
        END IF;
        IF NEW.responded_at IS NULL THEN NEW.responded_at:=now(); END IF;
    END IF;
    IF NEW.status='CANCELLED' AND NEW.responded_at IS NULL THEN NEW.responded_at:=now(); END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_voice_speaker_request_integrity ON voice_room_speaker_requests;
CREATE TRIGGER trg_voice_speaker_request_integrity BEFORE INSERT OR UPDATE OF status,responded_by,responded_at,session_id,user_id
ON voice_room_speaker_requests FOR EACH ROW EXECUTE FUNCTION validate_voice_room_speaker_request();

CREATE OR REPLACE FUNCTION apply_voice_room_speaker_approval()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status='APPROVED' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'APPROVED') THEN
        UPDATE voice_room_participants SET role='SPEAKER',role_changed_by=NEW.responded_by,role_changed_at=now()
          WHERE session_id=NEW.session_id AND user_id=NEW.user_id AND left_at IS NULL AND role='LISTENER';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Approved requester must still be an active listener' USING ERRCODE='23514';
        END IF;
        INSERT INTO voice_room_moderation_actions(session_id,room_id,actor_id,target_user_id,action_type,metadata)
          SELECT NEW.session_id,s.room_id,NEW.responded_by,NEW.user_id,'APPROVE_SPEAKER_REQUEST',jsonb_build_object('requestId',NEW.id)
          FROM voice_room_sessions s WHERE s.id=NEW.session_id;
    ELSIF NEW.status='DECLINED' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'DECLINED') THEN
        INSERT INTO voice_room_moderation_actions(session_id,room_id,actor_id,target_user_id,action_type,metadata)
          SELECT NEW.session_id,s.room_id,NEW.responded_by,NEW.user_id,'DECLINE_SPEAKER_REQUEST',jsonb_build_object('requestId',NEW.id)
          FROM voice_room_sessions s WHERE s.id=NEW.session_id;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_voice_speaker_request_apply ON voice_room_speaker_requests;
CREATE TRIGGER trg_voice_speaker_request_apply AFTER INSERT OR UPDATE OF status ON voice_room_speaker_requests
FOR EACH ROW EXECUTE FUNCTION apply_voice_room_speaker_approval();

CREATE TABLE voice_room_invites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id uuid NOT NULL REFERENCES voice_rooms(id) ON DELETE CASCADE,
    inviter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','DECLINED','REVOKED','EXPIRED')),
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
    created_at timestamptz NOT NULL DEFAULT now(),
    responded_at timestamptz,
    CHECK(inviter_id <> invitee_id)
);
CREATE INDEX ix_voice_invites_invitee ON voice_room_invites(invitee_id,status,created_at DESC);

CREATE TABLE voice_room_moderation_actions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid REFERENCES voice_room_sessions(id) ON DELETE SET NULL,
    room_id uuid NOT NULL REFERENCES voice_rooms(id) ON DELETE CASCADE,
    actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
    target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    action_type text NOT NULL CHECK(action_type IN ('MUTE','UNMUTE','REMOVE','LOCK','UNLOCK','END_SESSION','TRANSFER_HOST','HIDE','SHOW','PROMOTE_SPEAKER','DEMOTE_SPEAKER','APPROVE_SPEAKER_REQUEST','DECLINE_SPEAKER_REQUEST','TRANSFER_OWNERSHIP','ARCHIVE_ROOM','RESTORE_ROOM','SUSPEND_ROOM','UNSUSPEND_ROOM','MUTE_ALL','LOCK_SEATS','UNLOCK_SEATS','BAN_PARTICIPANT')),
    reason text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_voice_moderation_room ON voice_room_moderation_actions(room_id,created_at DESC);

CREATE OR REPLACE FUNCTION transfer_voice_room_ownership(p_room_id uuid,p_current_owner_id uuid,p_new_owner_id uuid,p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_room_status voice_room_status;
BEGIN
    SELECT status INTO v_room_status FROM voice_rooms WHERE id=p_room_id AND owner_user_id=p_current_owner_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Only the current persistent room owner may transfer ownership' USING ERRCODE='23514'; END IF;
    IF p_new_owner_id=p_current_owner_id OR NOT EXISTS (SELECT 1 FROM users WHERE id=p_new_owner_id AND account_status='ACTIVE' AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'New room owner must be a different active profile' USING ERRCODE='23514';
    END IF;
    UPDATE voice_rooms SET owner_user_id=p_new_owner_id,updated_by_user_id=p_current_owner_id,updated_at=now() WHERE id=p_room_id;
    INSERT INTO voice_room_moderation_actions(room_id,actor_id,target_user_id,action_type,reason,metadata)
    VALUES(p_room_id,p_current_owner_id,p_new_owner_id,'TRANSFER_OWNERSHIP',p_reason,
           jsonb_build_object('previousOwnerId',p_current_owner_id,'newOwnerId',p_new_owner_id));
END;
$$;

CREATE TABLE voice_room_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES voice_room_sessions(id) ON DELETE CASCADE,
    sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body text NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 3000),
    status content_status NOT NULL DEFAULT 'PUBLISHED',
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
CREATE INDEX ix_voice_room_messages_session ON voice_room_messages(session_id,created_at,id) WHERE deleted_at IS NULL;

-- 8. Business directory. Business categories are separate from country topic categories.
CREATE TABLE business_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id uuid REFERENCES countries(id) ON DELETE CASCADE,
    name text NOT NULL,
    slug text NOT NULL,
    icon_key text,
    is_active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX ux_business_category_country_slug ON business_categories(country_id,slug) WHERE country_id IS NOT NULL;
CREATE UNIQUE INDEX ux_business_category_global_slug ON business_categories(slug) WHERE country_id IS NULL;

CREATE TABLE business_listings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id uuid NOT NULL REFERENCES countries(id),
    owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    category_id uuid REFERENCES business_categories(id) ON DELETE SET NULL,
    name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 180),
    slug text NOT NULL,
    description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 8000),
    phone text,
    email text,
    website_url text,
    verification_status business_verification_status NOT NULL DEFAULT 'UNVERIFIED',
    status content_status NOT NULL DEFAULT 'PENDING_REVIEW',
    is_sponsored boolean NOT NULL DEFAULT false,
    average_rating numeric(3,2) CHECK(average_rating IS NULL OR average_rating BETWEEN 1 AND 5),
    review_count integer NOT NULL DEFAULT 0 CHECK(review_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE(country_id,slug)
);
CREATE INDEX ix_business_country_status ON business_listings(country_id,status,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_business_category ON business_listings(category_id,status);
CREATE INDEX ix_business_search ON business_listings USING gin(to_tsvector('english',name || ' ' || description));
CREATE TABLE business_locations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES business_listings(id) ON DELETE CASCADE,
    address_id uuid NOT NULL REFERENCES addresses(id) ON DELETE RESTRICT,
    location_name text,
    phone text,
    is_primary boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(business_id,address_id)
);
CREATE UNIQUE INDEX ux_business_one_primary_location ON business_locations(business_id) WHERE is_primary=true;
CREATE INDEX ix_business_locations_address ON business_locations(address_id);

CREATE TABLE business_hours (
    business_location_id uuid NOT NULL REFERENCES business_locations(id) ON DELETE CASCADE,
    day_of_week smallint NOT NULL CHECK(day_of_week BETWEEN 1 AND 7),
    open_time time,
    close_time time,
    is_closed boolean NOT NULL DEFAULT false,
    PRIMARY KEY(business_location_id,day_of_week),
    CHECK(is_closed OR (open_time IS NOT NULL AND close_time IS NOT NULL))
);
CREATE TABLE business_media (
    business_id uuid NOT NULL REFERENCES business_listings(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE RESTRICT,
    sort_order integer NOT NULL DEFAULT 0,
    is_cover boolean NOT NULL DEFAULT false,
    PRIMARY KEY(business_id,media_id),
    UNIQUE(business_id,sort_order)
);
CREATE UNIQUE INDEX ux_business_single_cover ON business_media(business_id) WHERE is_cover=true;

CREATE TABLE business_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES business_listings(id) ON DELETE CASCADE,
    reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating smallint NOT NULL CHECK(rating BETWEEN 1 AND 5),
    body text CHECK(body IS NULL OR length(body) <= 4000),
    status content_status NOT NULL DEFAULT 'PUBLISHED',
    owner_response text CHECK(owner_response IS NULL OR length(owner_response) <= 4000),
    owner_responded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(business_id,reviewer_user_id)
);
CREATE INDEX ix_business_reviews_public ON business_reviews(business_id,status,created_at DESC);
CREATE TABLE business_saves (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_id uuid NOT NULL REFERENCES business_listings(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,business_id)
);

-- 9. Events with an explicit online mode and optional link to a persistent voice room.
-- Events use an event-specific taxonomy; a practical-life country topic is optional.
CREATE TABLE event_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id uuid REFERENCES countries(id) ON DELETE CASCADE,
    category_key text NOT NULL CHECK(category_key=upper(trim(category_key)) AND length(category_key) BETWEEN 1 AND 60),
    display_name text NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 100),
    description text,
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX ux_event_category_global_key ON event_categories(category_key) WHERE country_id IS NULL;
CREATE UNIQUE INDEX ux_event_category_country_key ON event_categories(country_id,category_key) WHERE country_id IS NOT NULL;
INSERT INTO event_categories(country_id,category_key,display_name,sort_order) VALUES
 (NULL,'WORKSHOP','Workshop',10),(NULL,'CULTURAL','Cultural event',20),(NULL,'SOCIAL_GATHERING','Social gathering',30),
 (NULL,'NETWORKING','Networking',40),(NULL,'EDUCATION','Education',50),(NULL,'FAMILY','Family',60),(NULL,'SPORTS','Sports',70),(NULL,'OTHER','Other',90)
ON CONFLICT DO NOTHING;

CREATE TABLE events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id uuid NOT NULL REFERENCES countries(id),
    community_id uuid REFERENCES communities(id) ON DELETE CASCADE,
    visibility_scope visibility_scope NOT NULL DEFAULT 'COMMUNITY',
    organizer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    event_category_id uuid NOT NULL REFERENCES event_categories(id) ON DELETE RESTRICT,
    country_topic_category_id uuid REFERENCES country_categories(id) ON DELETE SET NULL,
    title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
    description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 12000),
    event_mode event_mode NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz,
    timezone text NOT NULL,
    location_name text,
    address_id uuid REFERENCES addresses(id) ON DELETE RESTRICT,
    external_url text,
    linked_voice_room_id uuid REFERENCES voice_rooms(id) ON DELETE SET NULL,
    capacity integer CHECK(capacity IS NULL OR capacity > 0),
    status content_status NOT NULL DEFAULT 'PENDING_REVIEW',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(ends_at IS NULL OR ends_at >= starts_at),
    CHECK((visibility_scope='COMMUNITY' AND community_id IS NOT NULL) OR visibility_scope='COUNTRY'),
    CHECK((event_mode='IN_PERSON' AND (location_name IS NOT NULL OR address_id IS NOT NULL)) OR event_mode <> 'IN_PERSON'),
    CHECK((event_mode='ONLINE_EXTERNAL' AND external_url IS NOT NULL AND external_url ~* '^https?://') OR event_mode <> 'ONLINE_EXTERNAL'),
    CHECK((event_mode='ONLINE_VOICE' AND linked_voice_room_id IS NOT NULL) OR event_mode <> 'ONLINE_VOICE')
);
CREATE INDEX ix_events_country_start ON events(country_id,status,starts_at);
CREATE INDEX ix_events_community_start ON events(community_id,status,starts_at) WHERE community_id IS NOT NULL;
CREATE INDEX ix_events_category ON events(event_category_id,status,starts_at);
CREATE INDEX ix_events_country_topic ON events(country_topic_category_id,status,starts_at) WHERE country_topic_category_id IS NOT NULL;
CREATE TABLE event_rsvps (
    event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status rsvp_status NOT NULL DEFAULT 'GOING',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(event_id,user_id)
);
CREATE INDEX ix_event_rsvps_user ON event_rsvps(user_id,status,updated_at DESC);
CREATE TABLE event_saves (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,event_id)
);
CREATE TABLE event_media (
    event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE RESTRICT,
    sort_order integer NOT NULL DEFAULT 0,
    is_cover boolean NOT NULL DEFAULT false,
    PRIMARY KEY(event_id,media_id),
    UNIQUE(event_id,sort_order)
);

CREATE UNIQUE INDEX ux_event_single_cover ON event_media(event_id) WHERE is_cover=true;

-- Jobs have an independent industry/occupation taxonomy; country practical topics are not job categories.
CREATE TABLE job_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id uuid REFERENCES countries(id) ON DELETE CASCADE,
    parent_id uuid REFERENCES job_categories(id) ON DELETE SET NULL,
    category_key text NOT NULL CHECK(category_key=upper(trim(category_key)) AND length(category_key) BETWEEN 1 AND 80),
    category_type text NOT NULL CHECK(category_type IN ('INDUSTRY','OCCUPATION','ROLE')),
    display_name text NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 120),
    description text,
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_job_category_global_key ON job_categories(category_key,category_type) WHERE country_id IS NULL;
CREATE UNIQUE INDEX ux_job_category_country_key ON job_categories(country_id,category_key,category_type) WHERE country_id IS NOT NULL;
CREATE INDEX ix_job_categories_active ON job_categories(country_id,category_type,is_active,sort_order);
INSERT INTO job_categories(country_id,category_key,category_type,display_name,sort_order) VALUES
 (NULL,'WAREHOUSING_LOGISTICS','INDUSTRY','Warehousing and logistics',10),
 (NULL,'CONSTRUCTION','INDUSTRY','Construction',20), (NULL,'HEALTHCARE','INDUSTRY','Healthcare',30),
 (NULL,'SOCIAL_CARE','INDUSTRY','Social care',40), (NULL,'INFORMATION_TECHNOLOGY','INDUSTRY','Information technology',50),
 (NULL,'HOSPITALITY','INDUSTRY','Hospitality',60), (NULL,'RETAIL','INDUSTRY','Retail',70),
 (NULL,'DRIVING_DELIVERY','INDUSTRY','Driving and delivery',80), (NULL,'EDUCATION','INDUSTRY','Education',90),
 (NULL,'CLEANING_FACILITIES','INDUSTRY','Cleaning and facilities',100), (NULL,'MANUFACTURING','INDUSTRY','Manufacturing',110),
 (NULL,'AGRICULTURE','INDUSTRY','Agriculture',120), (NULL,'ADMIN_OFFICE','INDUSTRY','Administration and office',130),
 (NULL,'COMMUNITY_VOLUNTEERING','INDUSTRY','Community and volunteering',140), (NULL,'OTHER_INDUSTRY','INDUSTRY','Other industry',900),
 (NULL,'WAREHOUSE_OPERATIVE','OCCUPATION','Warehouse operative',10), (NULL,'LABOURER','OCCUPATION','Labourer',20),
 (NULL,'DELIVERY_DRIVER','OCCUPATION','Delivery driver',30), (NULL,'CLEANER','OCCUPATION','Cleaner',40),
 (NULL,'CARE_ASSISTANT','OCCUPATION','Care assistant',50), (NULL,'SOFTWARE_DEVELOPER','OCCUPATION','Software developer',60),
 (NULL,'RETAIL_ASSISTANT','OCCUPATION','Retail assistant',70), (NULL,'KITCHEN_ASSISTANT','OCCUPATION','Kitchen assistant',80),
 (NULL,'TEACHING_ASSISTANT','OCCUPATION','Teaching assistant',90), (NULL,'COMMUNITY_WORKER','OCCUPATION','Community worker',100),
 (NULL,'OTHER_OCCUPATION','OCCUPATION','Other occupation',900)
ON CONFLICT DO NOTHING;

-- 11. Jobs support employer-direct, recruiter, community-shared and aggregated external listings.
-- listing_source_type is distinct from application_method (internal application vs external redirect).
CREATE TABLE job_listings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id uuid NOT NULL REFERENCES countries(id),
    community_id uuid REFERENCES communities(id) ON DELETE CASCADE,
    visibility_scope visibility_scope NOT NULL DEFAULT 'COMMUNITY',
    employer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    posted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    business_id uuid REFERENCES business_listings(id) ON DELETE SET NULL,
    source_type job_listing_source_type NOT NULL DEFAULT 'EMPLOYER_DIRECT',
    source_name text CHECK(source_name IS NULL OR length(source_name) <= 180),
    source_url text CHECK(source_url IS NULL OR source_url ~* '^https?://'),
    employer_name text NOT NULL CHECK(length(trim(employer_name)) BETWEEN 1 AND 180),
    title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 220),
    description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 20000),
    employment_type job_employment_type NOT NULL DEFAULT 'UNSPECIFIED',
    work_hours_type text NOT NULL DEFAULT 'UNSPECIFIED' CHECK(work_hours_type IN ('FULL_TIME','PART_TIME','VARIABLE','SHIFT_BASED','FLEXIBLE','UNSPECIFIED')),
    work_schedule text CHECK(work_schedule IS NULL OR work_schedule IN ('DAY','NIGHT','ROTATING','WEEKENDS','MIXED','OTHER')),
    workplace_type text NOT NULL DEFAULT 'ONSITE' CHECK(workplace_type IN ('ONSITE','HYBRID','REMOTE','MULTIPLE_LOCATIONS','FIELD_BASED')),
    workplace_address_id uuid REFERENCES addresses(id) ON DELETE RESTRICT,
    salary_min numeric(12,2),
    salary_max numeric(12,2),
    salary_currency char(3),
    application_method application_method NOT NULL DEFAULT 'EXTERNAL',
    application_url text,
    closes_at timestamptz,
    status job_status NOT NULL DEFAULT 'DRAFT',
    is_verified_employer boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    CHECK(salary_min IS NULL OR salary_min >= 0),
    CHECK(salary_max IS NULL OR salary_max >= 0),
    CHECK(salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min),
    CHECK((application_method='EXTERNAL' AND application_url IS NOT NULL AND application_url ~* '^https?://') OR (application_method='INTERNAL' AND application_url IS NULL)),
    CHECK((source_type='EXTERNAL_AGGREGATOR' AND source_url IS NOT NULL) OR source_type<>'EXTERNAL_AGGREGATOR'),
    CHECK((visibility_scope='COMMUNITY' AND community_id IS NOT NULL) OR visibility_scope='COUNTRY')
);
CREATE INDEX ix_jobs_country_status ON job_listings(country_id,status,created_at DESC);
CREATE INDEX ix_jobs_source_type_status ON job_listings(source_type,status,created_at DESC);
CREATE INDEX ix_jobs_closing ON job_listings(closes_at) WHERE status='PUBLISHED' AND closes_at IS NOT NULL;
CREATE INDEX ix_jobs_workplace_address ON job_listings(workplace_address_id,status) WHERE workplace_address_id IS NOT NULL AND status='PUBLISHED';
CREATE INDEX ix_jobs_search ON job_listings USING gin(to_tsvector('english',title || ' ' || employer_name || ' ' || description));
CREATE TABLE job_listing_categories (
    job_id uuid NOT NULL REFERENCES job_listings(id) ON DELETE CASCADE,
    category_id uuid NOT NULL REFERENCES job_categories(id) ON DELETE RESTRICT,
    is_primary boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(job_id,category_id),
    UNIQUE(job_id,sort_order)
);
CREATE UNIQUE INDEX ux_job_listing_primary_category ON job_listing_categories(job_id) WHERE is_primary=true;
CREATE INDEX ix_job_listing_categories_category ON job_listing_categories(category_id,job_id);

CREATE TABLE job_media (
    job_id uuid NOT NULL REFERENCES job_listings(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE RESTRICT,
    sort_order integer NOT NULL DEFAULT 0,
    PRIMARY KEY(job_id,media_id),
    UNIQUE(job_id,sort_order)
);
CREATE TABLE job_saves (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_id uuid NOT NULL REFERENCES job_listings(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,job_id)
);
CREATE TABLE job_applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL REFERENCES job_listings(id) ON DELETE CASCADE,
    applicant_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resume_media_id uuid REFERENCES media_objects(id) ON DELETE SET NULL,
    cover_letter text CHECK(cover_letter IS NULL OR length(cover_letter) <= 12000),
    status job_application_status NOT NULL DEFAULT 'SUBMITTED',
    submitted_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(job_id,applicant_id)
);
CREATE INDEX ix_job_applications_employer_view ON job_applications(job_id,status,submitted_at DESC);

-- 12. Spare Bag: parcel sender requests and passenger spare-capacity offers.
-- The audience market country is the country of the departure/origin airport.
-- This is a listing/contact feature, not a regulated carrier, escrow or payment service.
CREATE TABLE airports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id uuid NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
    iata_code char(3) NOT NULL UNIQUE CHECK (iata_code ~ '^[A-Z]{3}$'),
    icao_code char(4) UNIQUE CHECK (icao_code IS NULL OR icao_code ~ '^[A-Z]{4}$'),
    name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 180),
    city text NOT NULL CHECK (length(trim(city)) BETWEEN 1 AND 120),
    region text,
    timezone text,
    latitude numeric(9,6) CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    longitude numeric(9,6) CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    location geography(Point,4326),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_airports_country_city ON airports(country_id,city,is_active);
CREATE INDEX ix_airports_location_gist ON airports USING gist(location) WHERE location IS NOT NULL;
DROP TRIGGER IF EXISTS trg_sync_airport_geography ON airports;
CREATE TRIGGER trg_sync_airport_geography
BEFORE INSERT OR UPDATE OF latitude,longitude,location ON airports
FOR EACH ROW EXECUTE FUNCTION sync_coordinate_geography();
CREATE INDEX ix_airports_name_search ON airports USING gin(to_tsvector('english',name || ' ' || city || ' ' || coalesce(region,'')));

-- Parcel categories are module-specific; they are not country practical-life topics.
CREATE TABLE spare_bag_categories (
    category_key text PRIMARY KEY CHECK(category_key=upper(trim(category_key)) AND length(category_key) BETWEEN 1 AND 60),
    display_name text NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 100),
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0
);
INSERT INTO spare_bag_categories(category_key,display_name,sort_order) VALUES
 ('DOCUMENTS','Documents',10),('CLOTHING','Clothing',20),('GIFTS','Gifts',30),
 ('BOOKS','Books',40),('HOUSEHOLD_ITEMS','Household items',50),('OTHER','Other',90)
ON CONFLICT(category_key) DO NOTHING;

CREATE TABLE spare_bag_listings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_type spare_bag_listing_type NOT NULL,
    community_id uuid REFERENCES communities(id) ON DELETE RESTRICT,
    visibility_scope visibility_scope NOT NULL DEFAULT 'COMMUNITY',
    origin_airport_id uuid NOT NULL REFERENCES airports(id) ON DELETE RESTRICT,
    destination_airport_id uuid NOT NULL REFERENCES airports(id) ON DELETE RESTRICT,
    title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 180),
    description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 10000),
    travel_date_start date NOT NULL,
    travel_date_end date,
    requested_weight_kg numeric(8,2) CHECK (requested_weight_kg IS NULL OR requested_weight_kg > 0),
    requested_parcel_count integer CHECK (requested_parcel_count IS NULL OR requested_parcel_count BETWEEN 1 AND 100),
    available_capacity_kg numeric(8,2) CHECK (available_capacity_kg IS NULL OR available_capacity_kg > 0),
    available_parcel_count integer CHECK (available_parcel_count IS NULL OR available_parcel_count BETWEEN 1 AND 100),
    max_single_parcel_kg numeric(8,2) CHECK (max_single_parcel_kg IS NULL OR max_single_parcel_kg > 0),
    price_amount numeric(12,2) NOT NULL CHECK (price_amount >= 0),
    price_unit spare_bag_price_unit NOT NULL,
    price_currency char(3) NOT NULL CHECK (price_currency ~ '^[A-Z]{3}$'),
    collection_place text CHECK (collection_place IS NULL OR length(collection_place) <= 500),
    collection_address_id uuid REFERENCES addresses(id) ON DELETE RESTRICT,
    handover_place text CHECK (handover_place IS NULL OR length(handover_place) <= 500),
    handover_address_id uuid REFERENCES addresses(id) ON DELETE RESTRICT,
    handover_notes text CHECK (handover_notes IS NULL OR length(handover_notes) <= 3000),
    status spare_bag_listing_status NOT NULL DEFAULT 'DRAFT',
    published_at timestamptz,
    closes_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CHECK (origin_airport_id <> destination_airport_id),
    CHECK (travel_date_end IS NULL OR travel_date_end >= travel_date_start),
    CHECK (collection_place IS NOT NULL OR collection_address_id IS NOT NULL OR handover_place IS NOT NULL OR handover_address_id IS NOT NULL),
    CHECK (
      (listing_type='SENDER_REQUEST' AND available_capacity_kg IS NULL AND available_parcel_count IS NULL AND max_single_parcel_kg IS NULL
        AND (requested_weight_kg IS NOT NULL OR requested_parcel_count IS NOT NULL))
      OR
      (listing_type='PASSENGER_OFFER' AND available_capacity_kg IS NOT NULL AND requested_weight_kg IS NULL AND requested_parcel_count IS NULL)
    ),
    CHECK (max_single_parcel_kg IS NULL OR available_capacity_kg IS NULL OR max_single_parcel_kg <= available_capacity_kg),
    CHECK (
      (listing_type='SENDER_REQUEST' AND ((price_unit='PER_KG' AND requested_weight_kg IS NOT NULL) OR (price_unit='PER_PARCEL' AND requested_parcel_count IS NOT NULL)))
      OR
      (listing_type='PASSENGER_OFFER' AND ((price_unit='PER_KG' AND available_capacity_kg IS NOT NULL) OR (price_unit='PER_PARCEL' AND available_parcel_count IS NOT NULL)))
    ),
    CHECK ((visibility_scope='COMMUNITY' AND community_id IS NOT NULL) OR (visibility_scope='COUNTRY' AND community_id IS NULL)),
    CHECK (closes_at IS NULL OR closes_at > created_at)
);
CREATE INDEX ix_spare_bag_route_dates ON spare_bag_listings(origin_airport_id,destination_airport_id,travel_date_start,status) WHERE deleted_at IS NULL;
CREATE INDEX ix_spare_bag_community_scope ON spare_bag_listings(community_id,visibility_scope,status,travel_date_start) WHERE deleted_at IS NULL;
CREATE INDEX ix_spare_bag_community_scope_active ON spare_bag_listings(community_id,status,travel_date_start) WHERE visibility_scope='COMMUNITY' AND deleted_at IS NULL;
CREATE INDEX ix_spare_bag_owner ON spare_bag_listings(owner_user_id,status,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_spare_bag_search ON spare_bag_listings USING gin(to_tsvector('english',title || ' ' || description));

CREATE OR REPLACE FUNCTION validate_spare_bag_listing()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_origin_country uuid;
    v_destination_country uuid;
    v_community_country uuid;
BEGIN
    SELECT country_id INTO v_origin_country FROM airports WHERE id=NEW.origin_airport_id AND is_active=true;
    SELECT country_id INTO v_destination_country FROM airports WHERE id=NEW.destination_airport_id AND is_active=true;
    IF v_origin_country IS NULL OR v_destination_country IS NULL THEN
        RAISE EXCEPTION 'Both airports must exist and be active' USING ERRCODE='23514';
    END IF;
    IF NEW.community_id IS NOT NULL THEN
        SELECT destination_country_id INTO v_community_country FROM communities WHERE id=NEW.community_id AND is_active=true;
        IF v_community_country IS NULL OR v_community_country <> v_origin_country THEN
            RAISE EXCEPTION 'listing community must be an active community in the origin-airport country' USING ERRCODE='23514';
        END IF;
    END IF;
    IF NEW.visibility_scope='COMMUNITY' AND NEW.community_id IS NULL THEN
        RAISE EXCEPTION 'community_id is required when visibility_scope is COMMUNITY' USING ERRCODE='23502';
    END IF;
    IF NEW.status='PUBLISHED' AND COALESCE(NEW.travel_date_end,NEW.travel_date_start) < CURRENT_DATE THEN
        RAISE EXCEPTION 'Past travel dates cannot be published' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_spare_bag_listing_integrity ON spare_bag_listings;
CREATE TRIGGER trg_spare_bag_listing_integrity
BEFORE INSERT OR UPDATE OF community_id,visibility_scope,origin_airport_id,destination_airport_id
ON spare_bag_listings FOR EACH ROW EXECUTE FUNCTION validate_spare_bag_listing();

CREATE TABLE spare_bag_listing_categories (
    listing_id uuid NOT NULL REFERENCES spare_bag_listings(id) ON DELETE CASCADE,
    category_key text NOT NULL REFERENCES spare_bag_categories(category_key) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(listing_id,category_key)
);
CREATE INDEX ix_spare_bag_listing_categories_category ON spare_bag_listing_categories(category_key,listing_id);

CREATE TABLE spare_bag_listing_media (
    listing_id uuid NOT NULL REFERENCES spare_bag_listings(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE RESTRICT,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(listing_id,media_id),
    UNIQUE(listing_id,sort_order)
);
CREATE TABLE spare_bag_listing_saves (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id uuid NOT NULL REFERENCES spare_bag_listings(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,listing_id)
);

-- Contact requests pair one sender request with one passenger offer. This is not payment,
-- escrow, customs clearance or a guarantee that either party is a licensed carrier.
CREATE TABLE spare_bag_contact_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_listing_id uuid NOT NULL REFERENCES spare_bag_listings(id) ON DELETE CASCADE,
    passenger_listing_id uuid NOT NULL REFERENCES spare_bag_listings(id) ON DELETE CASCADE,
    requested_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    responded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    direct_conversation_id uuid REFERENCES direct_conversations(id) ON DELETE SET NULL,
    status spare_bag_contact_status NOT NULL DEFAULT 'PENDING',
    parcel_weight_kg numeric(8,2) CHECK (parcel_weight_kg IS NULL OR parcel_weight_kg > 0),
    proposed_price_amount numeric(12,2) CHECK (proposed_price_amount IS NULL OR proposed_price_amount >= 0),
    proposed_price_unit spare_bag_price_unit,
    price_currency char(3) CHECK (price_currency IS NULL OR price_currency ~ '^[A-Z]{3}$'),
    message text CHECK (message IS NULL OR length(message) <= 3000),
    response_note text CHECK (response_note IS NULL OR length(response_note) <= 3000),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    responded_at timestamptz,
    expires_at timestamptz,
    CHECK (sender_listing_id <> passenger_listing_id),
    CHECK ((proposed_price_amount IS NULL AND proposed_price_unit IS NULL AND price_currency IS NULL)
       OR (proposed_price_amount IS NOT NULL AND proposed_price_unit IS NOT NULL AND price_currency IS NOT NULL)),
    CHECK (proposed_price_unit <> 'PER_KG' OR parcel_weight_kg IS NOT NULL)
);
CREATE UNIQUE INDEX ux_spare_bag_pending_contact_pair ON spare_bag_contact_requests(sender_listing_id,passenger_listing_id) WHERE status='PENDING';
CREATE INDEX ix_spare_bag_contact_inbox ON spare_bag_contact_requests(requested_by_user_id,status,created_at DESC);
CREATE INDEX ix_spare_bag_contact_sender ON spare_bag_contact_requests(sender_listing_id,status,created_at DESC);
CREATE INDEX ix_spare_bag_contact_passenger ON spare_bag_contact_requests(passenger_listing_id,status,created_at DESC);

CREATE OR REPLACE FUNCTION validate_spare_bag_contact_request()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_sender_owner uuid; v_sender_type spare_bag_listing_type; v_sender_origin uuid; v_sender_destination uuid;
    v_sender_start date; v_sender_end date; v_sender_status spare_bag_listing_status; v_sender_closes timestamptz; v_sender_deleted timestamptz;
    v_passenger_owner uuid; v_passenger_type spare_bag_listing_type; v_passenger_origin uuid; v_passenger_destination uuid;
    v_passenger_start date; v_passenger_end date; v_passenger_status spare_bag_listing_status; v_passenger_closes timestamptz; v_passenger_deleted timestamptz;
    v_conv_a uuid; v_conv_b uuid; v_validate_listing_pair boolean := true;
BEGIN
    IF TG_OP='UPDATE' THEN
        v_validate_listing_pair := NEW.sender_listing_id IS DISTINCT FROM OLD.sender_listing_id
            OR NEW.passenger_listing_id IS DISTINCT FROM OLD.passenger_listing_id
            OR (NEW.status='ACCEPTED' AND OLD.status IS DISTINCT FROM 'ACCEPTED');
    END IF;
    SELECT owner_user_id,listing_type,origin_airport_id,destination_airport_id,travel_date_start,COALESCE(travel_date_end,travel_date_start),status,closes_at,deleted_at
      INTO v_sender_owner,v_sender_type,v_sender_origin,v_sender_destination,v_sender_start,v_sender_end,v_sender_status,v_sender_closes,v_sender_deleted
      FROM spare_bag_listings WHERE id=NEW.sender_listing_id;
    SELECT owner_user_id,listing_type,origin_airport_id,destination_airport_id,travel_date_start,COALESCE(travel_date_end,travel_date_start),status,closes_at,deleted_at
      INTO v_passenger_owner,v_passenger_type,v_passenger_origin,v_passenger_destination,v_passenger_start,v_passenger_end,v_passenger_status,v_passenger_closes,v_passenger_deleted
      FROM spare_bag_listings WHERE id=NEW.passenger_listing_id;
    IF v_sender_owner IS NULL OR v_passenger_owner IS NULL THEN
        RAISE EXCEPTION 'Both Spare Bag listings must exist' USING ERRCODE='23503';
    END IF;
    IF v_sender_owner = v_passenger_owner THEN
        RAISE EXCEPTION 'A user cannot create a contact request between their own listings' USING ERRCODE='23514';
    END IF;
    IF v_sender_type <> 'SENDER_REQUEST' OR v_passenger_type <> 'PASSENGER_OFFER' THEN
        RAISE EXCEPTION 'Contact request must pair a sender request with a passenger offer' USING ERRCODE='23514';
    END IF;
    IF v_validate_listing_pair THEN
        IF v_sender_status <> 'PUBLISHED' OR v_passenger_status <> 'PUBLISHED'
           OR v_sender_deleted IS NOT NULL OR v_passenger_deleted IS NOT NULL
           OR (v_sender_closes IS NOT NULL AND v_sender_closes <= now())
           OR (v_passenger_closes IS NOT NULL AND v_passenger_closes <= now())
           OR v_sender_end < CURRENT_DATE OR v_passenger_end < CURRENT_DATE THEN
            RAISE EXCEPTION 'Both Spare Bag listings must be published and unexpired' USING ERRCODE='23514';
        END IF;
        IF v_sender_origin <> v_passenger_origin OR v_sender_destination <> v_passenger_destination THEN
            RAISE EXCEPTION 'Listings must use the same origin and destination airports' USING ERRCODE='23514';
        END IF;
        IF GREATEST(v_sender_start,v_passenger_start) > LEAST(v_sender_end,v_passenger_end) THEN
            RAISE EXCEPTION 'Listings must have overlapping travel dates' USING ERRCODE='23514';
        END IF;
    END IF;
    IF NEW.requested_by_user_id NOT IN (v_sender_owner,v_passenger_owner) THEN
        RAISE EXCEPTION 'Requester must own one of the paired listings' USING ERRCODE='23514';
    END IF;
    IF NEW.responded_by_user_id IS NOT NULL THEN
        IF NEW.responded_by_user_id NOT IN (v_sender_owner,v_passenger_owner) THEN
            RAISE EXCEPTION 'Responder must own one of the paired listings' USING ERRCODE='23514';
        END IF;
        IF NEW.responded_by_user_id=NEW.requested_by_user_id THEN
            RAISE EXCEPTION 'The requester cannot respond to their own contact request' USING ERRCODE='23514';
        END IF;
    END IF;
    IF NEW.status IN ('ACCEPTED','DECLINED') AND (NEW.responded_by_user_id IS NULL OR NEW.responded_at IS NULL) THEN
        RAISE EXCEPTION 'Accepted/declined contact requests must record who responded and when' USING ERRCODE='23514';
    END IF;
    IF NEW.direct_conversation_id IS NOT NULL THEN
        SELECT participant_a_id,participant_b_id INTO v_conv_a,v_conv_b FROM direct_conversations WHERE id=NEW.direct_conversation_id
          AND participant_a_business_account_id IS NULL AND participant_b_business_account_id IS NULL
          AND context_type='SPARE_BAG_CONTACT' AND context_id=NEW.id;
        IF NOT ((v_conv_a=v_sender_owner AND v_conv_b=v_passenger_owner) OR (v_conv_a=v_passenger_owner AND v_conv_b=v_sender_owner)) THEN
            RAISE EXCEPTION 'Linked conversation must contain the two Spare Bag listing owners' USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_spare_bag_contact_pair ON spare_bag_contact_requests;
CREATE TRIGGER trg_spare_bag_contact_pair BEFORE INSERT OR UPDATE OF sender_listing_id,passenger_listing_id,requested_by_user_id,responded_by_user_id,direct_conversation_id,status
ON spare_bag_contact_requests FOR EACH ROW EXECUTE FUNCTION validate_spare_bag_contact_request();

-- 13. Profile-based matchmaking. Matchmaking uses reciprocal preferences and mutual LIKEs.
-- Age is derived from profiles.date_of_birth; never store a denormalized age that becomes stale.
CREATE TABLE matchmaking_genders (
    gender_key text PRIMARY KEY CHECK(gender_key=upper(trim(gender_key)) AND length(gender_key) BETWEEN 1 AND 40),
    display_name text NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 80),
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0
);
INSERT INTO matchmaking_genders(gender_key,display_name,sort_order) VALUES
 ('WOMAN','Woman',10),('MAN','Man',20),('NON_BINARY','Non-binary',30),('OTHER','Other',40),('PREFER_NOT_TO_SAY','Prefer not to say',90)
ON CONFLICT(gender_key) DO NOTHING;

CREATE TABLE matchmaking_religions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    religion_key text NOT NULL UNIQUE CHECK(religion_key=upper(trim(religion_key)) AND length(religion_key) BETWEEN 1 AND 60),
    display_name text NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 100),
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0
);
INSERT INTO matchmaking_religions(religion_key,display_name,sort_order) VALUES
 ('CHRISTIAN','Christian',10),('MUSLIM','Muslim',20),('JEWISH','Jewish',30),('HINDU','Hindu',40),
 ('BUDDHIST','Buddhist',50),('SIKH','Sikh',60),('NONE','No religion',80),('OTHER','Other',90),('PREFER_NOT_TO_SAY','Prefer not to say',100)
ON CONFLICT(religion_key) DO NOTHING;

CREATE TABLE matchmaking_profiles (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    gender_key text NOT NULL REFERENCES matchmaking_genders(gender_key) ON DELETE RESTRICT,
    address_id uuid REFERENCES addresses(id) ON DELETE RESTRICT,
    nationality_country_id uuid REFERENCES countries(id) ON DELETE SET NULL,
    religion_id uuid REFERENCES matchmaking_religions(id) ON DELETE SET NULL,
    education_level text CHECK(education_level IS NULL OR education_level IN ('SECONDARY','VOCATIONAL','UNDERGRADUATE','POSTGRADUATE','DOCTORATE','OTHER','PREFER_NOT_TO_SAY')),
    occupation text CHECK(occupation IS NULL OR length(occupation) <= 160),
    relationship_intention text CHECK(relationship_intention IS NULL OR relationship_intention IN ('MARRIAGE','SERIOUS_RELATIONSHIP','LONG_TERM_DATING','NOT_SURE_YET')),
    marital_status text CHECK(marital_status IS NULL OR marital_status IN ('NEVER_MARRIED','MARRIED','SEPARATED','DIVORCED','WIDOWED','OTHER','PREFER_NOT_TO_SAY')),
    has_children boolean,
    wants_children text CHECK(wants_children IS NULL OR wants_children IN ('YES','NO','UNSURE','PREFER_NOT_TO_SAY')),
    smoking text CHECK(smoking IS NULL OR smoking IN ('NO','OCCASIONALLY','YES','PREFER_NOT_TO_SAY')),
    drinking text CHECK(drinking IS NULL OR drinking IN ('NO','OCCASIONALLY','YES','PREFER_NOT_TO_SAY')),
    activity_level text CHECK(activity_level IS NULL OR activity_level IN ('LOW','MODERATE','HIGH','VERY_HIGH','PREFER_NOT_TO_SAY')),
    height_cm smallint CHECK(height_cm IS NULL OR height_cm BETWEEN 80 AND 250),
    marriage_timeline text CHECK(marriage_timeline IS NULL OR marriage_timeline IN ('ASAP','WITHIN_1_YEAR','1_2_YEARS','2_PLUS_YEARS','UNSURE','NOT_APPLICABLE')),
    long_distance_relationship boolean,
    religion_importance text CHECK(religion_importance IS NULL OR religion_importance IN ('DEAL_BREAKER','VERY_IMPORTANT','SOMEWHAT_IMPORTANT','NOT_IMPORTANT')),
    willing_to_relocate boolean,
    photo_media_id uuid REFERENCES media_objects(id) ON DELETE SET NULL,
    blurred_photo_media_id uuid REFERENCES media_objects(id) ON DELETE SET NULL,
    name_visibility matchmaking_field_visibility NOT NULL DEFAULT 'BLURRED',
    photo_visibility matchmaking_field_visibility NOT NULL DEFAULT 'BLURRED',
    anonymous_alias text NOT NULL DEFAULT 'Diasporum member' CHECK(length(trim(anonymous_alias)) BETWEEN 1 AND 80),
    verification_status matchmaking_verification_status NOT NULL DEFAULT 'NOT_VERIFIED',
    status matchmaking_profile_status NOT NULL DEFAULT 'DRAFT',
    activated_at timestamptz,
    last_active_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(photo_media_id IS NULL OR blurred_photo_media_id IS NULL OR photo_media_id <> blurred_photo_media_id)
);
CREATE INDEX ix_matchmaking_profiles_active ON matchmaking_profiles(status,gender_key,verification_status,updated_at DESC) WHERE status='ACTIVE';
CREATE INDEX ix_matchmaking_profiles_religion ON matchmaking_profiles(religion_id,status) WHERE status='ACTIVE';
CREATE INDEX ix_matchmaking_profiles_location ON matchmaking_profiles(address_id) WHERE status='ACTIVE' AND address_id IS NOT NULL;

CREATE TABLE matchmaking_preferences (
    user_id uuid PRIMARY KEY REFERENCES matchmaking_profiles(user_id) ON DELETE CASCADE,
    min_age smallint NOT NULL DEFAULT 18 CHECK(min_age BETWEEN 18 AND 110),
    max_age smallint NOT NULL DEFAULT 110 CHECK(max_age BETWEEN 18 AND 110),
    max_distance_km integer CHECK(max_distance_km IS NULL OR max_distance_km BETWEEN 1 AND 20000),
    show_verified_only boolean NOT NULL DEFAULT false,
    has_children_preference text NOT NULL DEFAULT 'ANY' CHECK(has_children_preference IN ('ANY','YES','NO')),
    wants_children_preference text NOT NULL DEFAULT 'ANY' CHECK(wants_children_preference IN ('ANY','YES','NO','UNSURE')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(max_age >= min_age)
);
CREATE TABLE matchmaking_preference_genders (
    user_id uuid NOT NULL REFERENCES matchmaking_preferences(user_id) ON DELETE CASCADE,
    gender_key text NOT NULL REFERENCES matchmaking_genders(gender_key) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,gender_key)
);
CREATE TABLE matchmaking_preference_religions (
    user_id uuid NOT NULL REFERENCES matchmaking_preferences(user_id) ON DELETE CASCADE,
    religion_id uuid NOT NULL REFERENCES matchmaking_religions(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,religion_id)
);
CREATE TABLE matchmaking_preference_languages (
    user_id uuid NOT NULL REFERENCES matchmaking_preferences(user_id) ON DELETE CASCADE,
    language_id uuid NOT NULL REFERENCES languages(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,language_id)
);
CREATE INDEX ix_matchmaking_pref_religions ON matchmaking_preference_religions(religion_id,user_id);
CREATE INDEX ix_matchmaking_pref_languages ON matchmaking_preference_languages(language_id,user_id);

-- Current decision per actor/target pair. History is append-only; reverse actions must
-- be executed transactionally by the backend and recorded in matchmaking_swipe_history.
CREATE TABLE matchmaking_swipes (
    swiper_user_id uuid NOT NULL REFERENCES matchmaking_profiles(user_id) ON DELETE CASCADE,
    target_user_id uuid NOT NULL REFERENCES matchmaking_profiles(user_id) ON DELETE CASCADE,
    action matchmaking_swipe_action NOT NULL,
    status matchmaking_swipe_status NOT NULL DEFAULT 'ACTIVE',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(swiper_user_id,target_user_id),
    CHECK(swiper_user_id <> target_user_id)
);
CREATE INDEX ix_matchmaking_swipes_target_action ON matchmaking_swipes(target_user_id,action,created_at DESC) WHERE status='ACTIVE';
CREATE INDEX ix_matchmaking_swipes_actor_recent ON matchmaking_swipes(swiper_user_id,created_at DESC);

CREATE TABLE matchmaking_swipe_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    swiper_user_id uuid NOT NULL REFERENCES matchmaking_profiles(user_id) ON DELETE CASCADE,
    target_user_id uuid NOT NULL REFERENCES matchmaking_profiles(user_id) ON DELETE CASCADE,
    event_type matchmaking_swipe_history_event_type NOT NULL,
    action matchmaking_swipe_action,
    reverses_event_id uuid REFERENCES matchmaking_swipe_history(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK(swiper_user_id <> target_user_id),
    CHECK(
      (event_type='SWIPE' AND action IS NOT NULL AND reverses_event_id IS NULL)
      OR (event_type IN ('LIKE_CANCELLED','REWOUND') AND action IS NULL AND reverses_event_id IS NOT NULL)
    )
);
CREATE INDEX ix_matchmaking_swipe_history_actor_recent ON matchmaking_swipe_history(swiper_user_id,created_at DESC);
CREATE INDEX ix_matchmaking_swipe_history_pair_recent ON matchmaking_swipe_history(swiper_user_id,target_user_id,created_at DESC);
CREATE UNIQUE INDEX ux_matchmaking_swipe_history_single_reversal
    ON matchmaking_swipe_history(reverses_event_id) WHERE reverses_event_id IS NOT NULL;
COMMENT ON TABLE matchmaking_swipe_history IS 'Append-only action log for LIKE/PASS, like withdrawal and rewind. The backend must only reverse the actor latest eligible unreversed SWIPE and must write current-state/history changes in one transaction.';

CREATE TABLE matchmaking_matches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status matchmaking_match_status NOT NULL DEFAULT 'MATCHED',
    matched_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz,
    closed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    close_reason text CHECK(close_reason IS NULL OR length(close_reason) <= 500),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(user_a_id < user_b_id),
    UNIQUE(user_a_id,user_b_id),
    CHECK((status='MATCHED' AND closed_at IS NULL) OR (status<>'MATCHED' AND closed_at IS NOT NULL))
);
CREATE INDEX ix_matchmaking_matches_user_a ON matchmaking_matches(user_a_id,status,matched_at DESC);
CREATE INDEX ix_matchmaking_matches_user_b ON matchmaking_matches(user_b_id,status,matched_at DESC);
ALTER TABLE direct_conversations ADD CONSTRAINT fk_direct_conversation_match
    FOREIGN KEY(matchmaking_match_id) REFERENCES matchmaking_matches(id) ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION matchmaking_account_is_adult(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM profiles p
        JOIN users u ON u.id=p.id
        JOIN user_privacy_settings ups ON ups.user_id=p.id
        WHERE p.id=p_user_id AND u.account_status='ACTIVE' AND u.deleted_at IS NULL
          AND p.date_of_birth IS NOT NULL
          AND p.date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')::date
          AND p.age_eligibility_confirmed_at IS NOT NULL
    );
$$;
CREATE OR REPLACE FUNCTION matchmaking_user_is_eligible(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT matchmaking_account_is_adult(p_user_id)
       AND EXISTS (SELECT 1 FROM user_privacy_settings ups WHERE ups.user_id=p_user_id AND ups.allow_matchmaking_discovery=true)
       AND EXISTS (SELECT 1 FROM matchmaking_profiles mp WHERE mp.user_id=p_user_id AND mp.status='ACTIVE');
$$;

-- Distances use PostGIS geography so results are measured in metres on the Earth model, not planar degrees.
CREATE OR REPLACE FUNCTION address_distance_km(p_address_a uuid,p_address_b uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT (ST_Distance(a.discovery_location,b.discovery_location) / 1000.0)::numeric
    FROM addresses a CROSS JOIN addresses b
    WHERE a.id=p_address_a AND b.id=p_address_b
      AND a.discovery_location IS NOT NULL AND b.discovery_location IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION user_discovery_distance_km(p_user_a uuid,p_user_b uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT (ST_Distance(a.location,b.location) / 1000.0)::numeric
    FROM user_discovery_locations a CROSS JOIN user_discovery_locations b
    WHERE a.user_id=p_user_a AND b.user_id=p_user_b;
$$;

-- Enforce all discovery preferences bilaterally. Empty multi-select preferences mean "any".
CREATE OR REPLACE FUNCTION matchmaking_users_compatible(p_user_a uuid,p_user_b uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
WITH pair AS (
 SELECT a.user_id AS a_id,b.user_id AS b_id,a.gender_key AS a_gender,b.gender_key AS b_gender,
        a.religion_id AS a_religion,b.religion_id AS b_religion,a.has_children AS a_children,b.has_children AS b_children,
        a.wants_children AS a_wants,b.wants_children AS b_wants,
        a.verification_status AS a_verified,b.verification_status AS b_verified,
        pa.min_age AS a_min,pa.max_age AS a_max,pa.max_distance_km AS a_distance,pa.show_verified_only AS a_verified_only,
        pa.has_children_preference AS a_children_pref,pa.wants_children_preference AS a_wants_pref,
        pb.min_age AS b_min,pb.max_age AS b_max,pb.max_distance_km AS b_distance,pb.show_verified_only AS b_verified_only,
        pb.has_children_preference AS b_children_pref,pb.wants_children_preference AS b_wants_pref,
        extract(year from age(current_date, p_a.date_of_birth))::integer AS a_age,
        extract(year from age(current_date, p_b.date_of_birth))::integer AS b_age
 FROM matchmaking_profiles a JOIN matchmaking_profiles b ON b.user_id=p_user_b
 JOIN matchmaking_preferences pa ON pa.user_id=a.user_id JOIN matchmaking_preferences pb ON pb.user_id=b.user_id
 JOIN profiles p_a ON p_a.id=a.user_id JOIN profiles p_b ON p_b.id=b.user_id
 WHERE a.user_id=p_user_a
), distances AS (
 SELECT pair.*, user_discovery_distance_km(a_id,b_id) AS distance_km FROM pair
)
SELECT EXISTS (
 SELECT 1 FROM distances d
 WHERE d.a_id<>d.b_id
   AND matchmaking_user_is_eligible(d.a_id) AND matchmaking_user_is_eligible(d.b_id)
   AND (NOT EXISTS(SELECT 1 FROM matchmaking_preference_genders g WHERE g.user_id=d.a_id)
        OR EXISTS(SELECT 1 FROM matchmaking_preference_genders g WHERE g.user_id=d.a_id AND g.gender_key=d.b_gender))
   AND (NOT EXISTS(SELECT 1 FROM matchmaking_preference_genders g WHERE g.user_id=d.b_id)
        OR EXISTS(SELECT 1 FROM matchmaking_preference_genders g WHERE g.user_id=d.b_id AND g.gender_key=d.a_gender))
   AND d.b_age BETWEEN d.a_min AND d.a_max AND d.a_age BETWEEN d.b_min AND d.b_max
   AND (d.a_children_pref='ANY' OR (d.a_children_pref='YES' AND d.b_children IS TRUE) OR (d.a_children_pref='NO' AND d.b_children IS FALSE))
   AND (d.b_children_pref='ANY' OR (d.b_children_pref='YES' AND d.a_children IS TRUE) OR (d.b_children_pref='NO' AND d.a_children IS FALSE))
   AND (d.a_wants_pref='ANY' OR d.a_wants_pref=d.b_wants)
   AND (d.b_wants_pref='ANY' OR d.b_wants_pref=d.a_wants)
   AND (NOT EXISTS(SELECT 1 FROM matchmaking_preference_religions r WHERE r.user_id=d.a_id)
        OR EXISTS(SELECT 1 FROM matchmaking_preference_religions r WHERE r.user_id=d.a_id AND r.religion_id=d.b_religion))
   AND (NOT EXISTS(SELECT 1 FROM matchmaking_preference_religions r WHERE r.user_id=d.b_id)
        OR EXISTS(SELECT 1 FROM matchmaking_preference_religions r WHERE r.user_id=d.b_id AND r.religion_id=d.a_religion))
   AND (NOT EXISTS(SELECT 1 FROM matchmaking_preference_languages l WHERE l.user_id=d.a_id)
        OR EXISTS(SELECT 1 FROM matchmaking_preference_languages l JOIN user_languages ul ON ul.language_id=l.language_id WHERE l.user_id=d.a_id AND ul.user_id=d.b_id))
   AND (NOT EXISTS(SELECT 1 FROM matchmaking_preference_languages l WHERE l.user_id=d.b_id)
        OR EXISTS(SELECT 1 FROM matchmaking_preference_languages l JOIN user_languages ul ON ul.language_id=l.language_id WHERE l.user_id=d.b_id AND ul.user_id=d.a_id))
   AND (NOT d.a_verified_only OR d.b_verified='VERIFIED')
   AND (NOT d.b_verified_only OR d.a_verified='VERIFIED')
   AND (d.a_distance IS NULL OR (d.distance_km IS NOT NULL AND d.distance_km <= d.a_distance))
   AND (d.b_distance IS NULL OR (d.distance_km IS NOT NULL AND d.distance_km <= d.b_distance))
);
$$;

CREATE OR REPLACE FUNCTION validate_matchmaking_profile()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_owner uuid; v_purpose text; v_media_status media_status; v_address_visibility address_visibility;
BEGIN
    IF NEW.status='ACTIVE' AND NOT matchmaking_account_is_adult(NEW.user_id) THEN
        RAISE EXCEPTION 'Matchmaking requires an active account, confirmed date of birth and age 18+' USING ERRCODE='23514';
    END IF;
    IF NEW.status='ACTIVE' AND NOT EXISTS (SELECT 1 FROM matchmaking_preferences pref WHERE pref.user_id=NEW.user_id) THEN
        RAISE EXCEPTION 'Matchmaking preferences must be configured before profile activation' USING ERRCODE='23514';
    END IF;
    IF NEW.address_id IS NOT NULL THEN
        SELECT visibility,owner_user_id INTO v_address_visibility,v_owner FROM addresses WHERE id=NEW.address_id;
        IF v_address_visibility IS DISTINCT FROM 'PRIVATE' OR v_owner IS DISTINCT FROM NEW.user_id THEN
            RAISE EXCEPTION 'Matchmaking location must be a private address owned by this user' USING ERRCODE='23514';
        END IF;
    END IF;
    IF EXISTS (
        SELECT 1 FROM matchmaking_preferences pref
        JOIN user_privacy_settings ups ON ups.user_id=pref.user_id
        WHERE pref.user_id=NEW.user_id AND pref.max_distance_km IS NOT NULL
          AND ups.allow_matchmaking_discovery=true
    ) AND NOT EXISTS (SELECT 1 FROM user_discovery_locations dl WHERE dl.user_id=NEW.user_id) THEN
        RAISE EXCEPTION 'A profile using distance-based matchmaking requires an opted-in approximate discovery location' USING ERRCODE='23514';
    END IF;
    IF NEW.photo_media_id IS NOT NULL THEN
        SELECT owner_user_id,purpose,status INTO v_owner,v_purpose,v_media_status FROM media_objects WHERE id=NEW.photo_media_id;
        IF v_owner IS DISTINCT FROM NEW.user_id OR v_purpose <> 'MATCHMAKING_PROFILE_PHOTO' THEN
            RAISE EXCEPTION 'Matchmaking profile photo must be owned by the user and use MATCHMAKING_PROFILE_PHOTO purpose' USING ERRCODE='23514';
        END IF;
        IF NEW.status='ACTIVE' AND NEW.photo_visibility='VISIBLE' AND v_media_status<>'READY' THEN
            RAISE EXCEPTION 'Visible matchmaking photo must be READY' USING ERRCODE='23514';
        END IF;
    END IF;
    IF NEW.blurred_photo_media_id IS NOT NULL THEN
        SELECT owner_user_id,purpose,status INTO v_owner,v_purpose,v_media_status FROM media_objects WHERE id=NEW.blurred_photo_media_id;
        IF v_owner IS DISTINCT FROM NEW.user_id OR v_purpose <> 'MATCHMAKING_PROFILE_BLURRED' THEN
            RAISE EXCEPTION 'Blurred rendition must be owned by the user and use MATCHMAKING_PROFILE_BLURRED purpose' USING ERRCODE='23514';
        END IF;
        IF NEW.status='ACTIVE' AND NEW.photo_visibility='BLURRED' AND v_media_status<>'READY' THEN
            RAISE EXCEPTION 'Blurred matchmaking photo must be READY' USING ERRCODE='23514';
        END IF;
    END IF;
    IF NEW.status='ACTIVE' AND NEW.photo_visibility='BLURRED' AND NEW.blurred_photo_media_id IS NULL THEN
        RAISE EXCEPTION 'BLURRED photo visibility requires a server-generated blurred rendition' USING ERRCODE='23514';
    END IF;
    IF NEW.status='ACTIVE' AND NEW.photo_visibility='VISIBLE' AND NEW.photo_media_id IS NULL THEN
        RAISE EXCEPTION 'VISIBLE photo visibility requires a profile photo' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_matchmaking_profile_integrity ON matchmaking_profiles;
CREATE TRIGGER trg_matchmaking_profile_integrity BEFORE INSERT OR UPDATE ON matchmaking_profiles
FOR EACH ROW EXECUTE FUNCTION validate_matchmaking_profile();

CREATE OR REPLACE FUNCTION validate_matchmaking_preferences()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.max_distance_km IS NOT NULL
       AND EXISTS (SELECT 1 FROM user_privacy_settings ups WHERE ups.user_id=NEW.user_id AND ups.allow_matchmaking_discovery=true)
       AND NOT EXISTS (SELECT 1 FROM user_discovery_locations dl WHERE dl.user_id=NEW.user_id) THEN
        RAISE EXCEPTION 'Distance-based matchmaking preferences require an opted-in approximate discovery location' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_matchmaking_preferences_integrity ON matchmaking_preferences;
CREATE TRIGGER trg_matchmaking_preferences_integrity BEFORE INSERT OR UPDATE OF min_age,max_age,max_distance_km,show_verified_only,has_children_preference,wants_children_preference
ON matchmaking_preferences FOR EACH ROW EXECUTE FUNCTION validate_matchmaking_preferences();

-- Keep opt-in location storage consistent with privacy settings. If both people discovery and
-- matchmaking discovery are disabled, remove the stored approximate location. Enabling distance-
-- limited matchmaking is rejected unless the user has an opted-in discovery point.
CREATE OR REPLACE FUNCTION validate_matchmaking_location_privacy_toggle()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_max_distance integer;
BEGIN
    IF NEW.allow_matchmaking_discovery THEN
        SELECT max_distance_km INTO v_max_distance
        FROM matchmaking_preferences WHERE user_id=NEW.user_id;
        IF v_max_distance IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM user_discovery_locations dl WHERE dl.user_id=NEW.user_id) THEN
            RAISE EXCEPTION 'Distance-based matchmaking requires an opted-in approximate discovery location' USING ERRCODE='23514';
        END IF;
    END IF;
    IF NOT NEW.allow_matchmaking_discovery AND NOT NEW.allow_people_suggestions THEN
        DELETE FROM user_discovery_locations WHERE user_id=NEW.user_id;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_matchmaking_location_privacy_toggle ON user_privacy_settings;
CREATE TRIGGER trg_matchmaking_location_privacy_toggle
AFTER INSERT OR UPDATE OF allow_matchmaking_discovery,allow_people_suggestions ON user_privacy_settings
FOR EACH ROW EXECUTE FUNCTION validate_matchmaking_location_privacy_toggle();

CREATE OR REPLACE FUNCTION validate_matchmaking_swipe()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_lock_key bigint;
BEGIN
    v_lock_key := hashtextextended(least(NEW.swiper_user_id::text,NEW.target_user_id::text)||':'||greatest(NEW.swiper_user_id::text,NEW.target_user_id::text),0);
    PERFORM pg_advisory_xact_lock(v_lock_key);
    IF NOT matchmaking_user_is_eligible(NEW.swiper_user_id) OR NOT matchmaking_user_is_eligible(NEW.target_user_id) THEN
        RAISE EXCEPTION 'Only eligible adults with active matchmaking profiles can swipe' USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM user_blocks b WHERE
        (b.blocker_user_id=NEW.swiper_user_id AND b.blocked_user_id=NEW.target_user_id) OR
        (b.blocker_user_id=NEW.target_user_id AND b.blocked_user_id=NEW.swiper_user_id)) THEN
        RAISE EXCEPTION 'Blocked users cannot interact in matchmaking' USING ERRCODE='23514';
    END IF;
    IF NOT matchmaking_users_compatible(NEW.swiper_user_id,NEW.target_user_id) THEN
        RAISE EXCEPTION 'These profiles do not satisfy reciprocal matchmaking preferences' USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM matchmaking_matches m WHERE m.user_a_id=least(NEW.swiper_user_id,NEW.target_user_id) AND m.user_b_id=greatest(NEW.swiper_user_id,NEW.target_user_id)) THEN
        RAISE EXCEPTION 'These users already have a matchmaking match record' USING ERRCODE='23505';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_matchmaking_swipe_integrity ON matchmaking_swipes;
CREATE TRIGGER trg_matchmaking_swipe_integrity BEFORE INSERT ON matchmaking_swipes
FOR EACH ROW EXECUTE FUNCTION validate_matchmaking_swipe();
CREATE OR REPLACE FUNCTION prevent_matchmaking_swipe_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Swipe decisions are immutable; use a separately authorised undo workflow if introduced' USING ERRCODE='23514'; END;
$$;
DROP TRIGGER IF EXISTS trg_matchmaking_swipe_immutable ON matchmaking_swipes;
CREATE TRIGGER trg_matchmaking_swipe_immutable BEFORE UPDATE ON matchmaking_swipes
FOR EACH ROW EXECUTE FUNCTION prevent_matchmaking_swipe_update();

CREATE OR REPLACE FUNCTION validate_matchmaking_match()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM matchmaking_swipes a JOIN matchmaking_swipes b
        ON a.swiper_user_id=b.target_user_id AND a.target_user_id=b.swiper_user_id
        WHERE a.swiper_user_id=NEW.user_a_id AND a.target_user_id=NEW.user_b_id
          AND a.action='LIKE' AND b.action='LIKE') THEN
        RAISE EXCEPTION 'A match requires reciprocal LIKE decisions' USING ERRCODE='23514';
    END IF;
    IF NOT matchmaking_users_compatible(NEW.user_a_id,NEW.user_b_id) THEN
        RAISE EXCEPTION 'A match requires reciprocal preference compatibility and adult eligibility' USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM user_blocks b WHERE
        (b.blocker_user_id=NEW.user_a_id AND b.blocked_user_id=NEW.user_b_id) OR
        (b.blocker_user_id=NEW.user_b_id AND b.blocked_user_id=NEW.user_a_id)) THEN
        RAISE EXCEPTION 'Blocked users cannot be matched' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_matchmaking_match_integrity ON matchmaking_matches;
CREATE TRIGGER trg_matchmaking_match_integrity BEFORE INSERT ON matchmaking_matches
FOR EACH ROW EXECUTE FUNCTION validate_matchmaking_match();

CREATE OR REPLACE FUNCTION create_conversation_for_match()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    -- Matchmaking uses the ordinary GENERAL conversation; the UI derives the Matched badge
    -- from matchmaking_matches.status='MATCHED'. Existing general chat is reused.
    INSERT INTO direct_conversations(participant_a_id,participant_b_id,status,created_by,matchmaking_match_id,context_type,context_id)
    VALUES(NEW.user_a_id,NEW.user_b_id,'ACCEPTED',NEW.user_a_id,NEW.id,'GENERAL',NULL)
    ON CONFLICT ON CONSTRAINT uq_direct_conversations_pair_context DO UPDATE
       SET status='ACCEPTED',matchmaking_match_id=EXCLUDED.matchmaking_match_id,updated_at=now();
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_create_conversation_for_match ON matchmaking_matches;
CREATE TRIGGER trg_create_conversation_for_match AFTER INSERT ON matchmaking_matches
FOR EACH ROW EXECUTE FUNCTION create_conversation_for_match();

CREATE OR REPLACE FUNCTION create_match_after_mutual_like()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.action='LIKE' AND EXISTS (
        SELECT 1 FROM matchmaking_swipes s WHERE s.swiper_user_id=NEW.target_user_id
          AND s.target_user_id=NEW.swiper_user_id AND s.action='LIKE'
    ) THEN
        INSERT INTO matchmaking_matches(user_a_id,user_b_id,status)
        VALUES(least(NEW.swiper_user_id,NEW.target_user_id),greatest(NEW.swiper_user_id,NEW.target_user_id),'MATCHED')
        ON CONFLICT(user_a_id,user_b_id) DO NOTHING;
        INSERT INTO notifications(recipient_user_id,type,title,body,target_type,target_id,dedupe_key)
        VALUES (NEW.swiper_user_id,'MATCHMAKING_MATCH','It is a match','You have a new mutual match','MATCHMAKING_MATCH',
                (SELECT id FROM matchmaking_matches WHERE user_a_id=least(NEW.swiper_user_id,NEW.target_user_id) AND user_b_id=greatest(NEW.swiper_user_id,NEW.target_user_id)),
                'match:'||least(NEW.swiper_user_id::text,NEW.target_user_id::text)||':'||greatest(NEW.swiper_user_id::text,NEW.target_user_id::text)||':'||NEW.swiper_user_id::text),
               (NEW.target_user_id,'MATCHMAKING_MATCH','It is a match','You have a new mutual match','MATCHMAKING_MATCH',
                (SELECT id FROM matchmaking_matches WHERE user_a_id=least(NEW.swiper_user_id,NEW.target_user_id) AND user_b_id=greatest(NEW.swiper_user_id,NEW.target_user_id)),
                'match:'||least(NEW.swiper_user_id::text,NEW.target_user_id::text)||':'||greatest(NEW.swiper_user_id::text,NEW.target_user_id::text)||':'||NEW.target_user_id::text)
        ON CONFLICT(recipient_user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_matchmaking_mutual_like ON matchmaking_swipes;
CREATE TRIGGER trg_matchmaking_mutual_like AFTER INSERT ON matchmaking_swipes
FOR EACH ROW EXECUTE FUNCTION create_match_after_mutual_like();

CREATE OR REPLACE FUNCTION suspend_ineligible_matchmaking_profile()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.date_of_birth IS NULL OR NEW.date_of_birth > (CURRENT_DATE - INTERVAL '18 years')::date
       OR NEW.age_eligibility_confirmed_at IS NULL THEN
        UPDATE matchmaking_profiles SET status='SUSPENDED',updated_at=now()
          WHERE user_id=NEW.id AND status='ACTIVE';
        UPDATE matchmaking_matches SET status='CLOSED',closed_at=now(),closed_by=NEW.id,
               close_reason='Profile eligibility changed',updated_at=now()
          WHERE status='MATCHED' AND (user_a_id=NEW.id OR user_b_id=NEW.id);
        UPDATE direct_conversations SET status='CLOSED',updated_at=now()
          WHERE matchmaking_match_id IN (SELECT id FROM matchmaking_matches WHERE user_a_id=NEW.id OR user_b_id=NEW.id);
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_profile_matchmaking_eligibility ON profiles;
CREATE TRIGGER trg_profile_matchmaking_eligibility AFTER UPDATE OF date_of_birth,age_eligibility_confirmed_at ON profiles
FOR EACH ROW EXECUTE FUNCTION suspend_ineligible_matchmaking_profile();

CREATE OR REPLACE FUNCTION suspend_matchmaking_for_inactive_account()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.account_status<>'ACTIVE' OR NEW.deleted_at IS NOT NULL THEN
        UPDATE matchmaking_profiles SET status='SUSPENDED',updated_at=now()
          WHERE user_id=NEW.id AND status='ACTIVE';
        UPDATE matchmaking_matches SET status='CLOSED',closed_at=now(),closed_by=NEW.id,
               close_reason='Account status changed',updated_at=now()
          WHERE status='MATCHED' AND (user_a_id=NEW.id OR user_b_id=NEW.id);
        UPDATE direct_conversations SET status='CLOSED',updated_at=now()
          WHERE matchmaking_match_id IN (SELECT id FROM matchmaking_matches WHERE user_a_id=NEW.id OR user_b_id=NEW.id);
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_user_account_matchmaking_eligibility
AFTER UPDATE OF account_status,deleted_at ON users
FOR EACH ROW EXECUTE FUNCTION suspend_matchmaking_for_inactive_account();

-- Report/block are shared trust features; the backend must enforce them on every matchmaking read/write.
-- Name/photo visibility is applied in the server DTO: for BLURRED/HIDDEN never return the original name/photo URL.

-- 14. Notifications, push devices, reports and audit.
CREATE TABLE notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    country_id uuid REFERENCES countries(id) ON DELETE SET NULL,
    community_id uuid REFERENCES communities(id) ON DELETE SET NULL,
    type notification_type NOT NULL,
    title text NOT NULL CHECK(length(title) <= 180),
    body text CHECK(body IS NULL OR length(body) <= 1500),
    target_type text,
    target_id uuid,
    dedupe_key text,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz
);
CREATE UNIQUE INDEX ux_notifications_dedupe ON notifications(recipient_user_id,dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX ix_notifications_inbox ON notifications(recipient_user_id,is_read,created_at DESC);
CREATE TABLE notification_preferences (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_key text NOT NULL,
    in_app_enabled boolean NOT NULL DEFAULT true,
    push_enabled boolean NOT NULL DEFAULT true,
    email_enabled boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,category_key)
);
CREATE TABLE device_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK(provider IN ('EXPO','APNS','FCM')),
    token text NOT NULL UNIQUE,
    platform text NOT NULL CHECK(platform IN ('IOS','ANDROID','WEB')),
    device_id text,
    app_version text,
    is_active boolean NOT NULL DEFAULT true,
    registered_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    invalidated_at timestamptz,
    invalidation_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK((is_active AND invalidated_at IS NULL) OR (NOT is_active))
);
CREATE INDEX ix_device_tokens_user ON device_tokens(user_id,is_active);
CREATE INDEX ix_device_tokens_active_provider ON device_tokens(provider,platform,updated_at DESC) WHERE is_active;

CREATE TABLE notification_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    device_token_id uuid NOT NULL REFERENCES device_tokens(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK(provider IN ('EXPO','APNS','FCM')),
    status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','SENT','DELIVERED','FAILED','CANCELLED')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_attempt_at timestamptz,
    sent_at timestamptz,
    provider_receipt_id text,
    receipt_checked_at timestamptz,
    last_error_code text,
    last_error_message text CHECK(last_error_message IS NULL OR length(last_error_message)<=2000),
    idempotency_key text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(notification_id,device_token_id)
);
CREATE INDEX ix_notification_deliveries_due ON notification_deliveries(status,next_attempt_at,created_at) WHERE status IN ('PENDING','FAILED');
CREATE INDEX ix_notification_deliveries_receipt ON notification_deliveries(provider,provider_receipt_id) WHERE provider_receipt_id IS NOT NULL;
COMMENT ON TABLE notification_deliveries IS 'Durable delivery/retry/receipt ledger. Spring Boot creates idempotent rows and sends via Expo Push Service or an explicitly configured provider, observes receipts, deactivates invalid tokens and retries retryable failures.';

CREATE TABLE reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    country_id uuid REFERENCES countries(id) ON DELETE SET NULL,
    community_id uuid REFERENCES communities(id) ON DELETE SET NULL,
    target_type report_target_type NOT NULL,
    target_id uuid NOT NULL,
    reason text NOT NULL CHECK(reason IN ('SPAM','SCAM','HARASSMENT','HATE','SEXUAL_MISCONDUCT','MISINFORMATION','IMPERSONATION','PRIVACY','OTHER')),
    details text CHECK(details IS NULL OR length(details) <= 4000),
    status report_status NOT NULL DEFAULT 'OPEN',
    assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz
);
CREATE INDEX ix_reports_queue ON reports(status,created_at);
CREATE INDEX ix_reports_target ON reports(target_type,target_id,created_at DESC);

CREATE TABLE moderation_actions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    moderator_id uuid REFERENCES users(id) ON DELETE SET NULL,
    target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    country_id uuid REFERENCES countries(id) ON DELETE SET NULL,
    community_id uuid REFERENCES communities(id) ON DELETE SET NULL,
    target_type report_target_type,
    target_id uuid,
    action_type moderation_action_type NOT NULL,
    reason text NOT NULL,
    starts_at timestamptz,
    ends_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX ix_moderation_actions_user ON moderation_actions(target_user_id,created_at DESC);
CREATE INDEX ix_moderation_actions_target ON moderation_actions(target_type,target_id,created_at DESC);

CREATE TABLE audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    actor_type text NOT NULL DEFAULT 'USER' CHECK(actor_type IN ('USER','ADMIN','SYSTEM','WORKER')),
    action_key text NOT NULL,
    target_type text,
    target_id uuid,
    request_id text,
    ip_address inet,
    user_agent text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_logs_actor ON audit_logs(actor_user_id,created_at DESC);
CREATE INDEX ix_audit_logs_action ON audit_logs(action_key,created_at DESC);
CREATE OR REPLACE FUNCTION audit_user_mute_action()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_action text; v_before jsonb:='{}'::jsonb; v_after jsonb:='{}'::jsonb;
BEGIN
    IF TG_OP='INSERT' THEN v_action:=CASE WHEN NEW.action_type='BAN' THEN 'CHAT_BAN_ISSUED' ELSE 'CHAT_MUTE_ISSUED' END; v_after:=to_jsonb(NEW);
    ELSIF TG_OP='UPDATE' AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN v_action:='CHAT_RESTRICTION_REVOKED'; v_before:=to_jsonb(OLD); v_after:=to_jsonb(NEW);
    ELSE RETURN NEW; END IF;
    INSERT INTO audit_logs(actor_user_id,actor_type,action_key,target_type,target_id,metadata)
    VALUES(COALESCE(NEW.revoked_by,NEW.muted_by),'USER',v_action,'USER',NEW.user_id,jsonb_build_object('scope',NEW.scope,'communityId',NEW.community_id,'roomId',NEW.room_id,'reason',NEW.reason,'startsAt',NEW.starts_at,'endsAt',NEW.ends_at,'before',v_before,'after',v_after));
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_audit_user_mute_action AFTER INSERT OR UPDATE ON user_mutes
FOR EACH ROW EXECUTE FUNCTION audit_user_mute_action();


-- Blocking removes social edges and terminates pending relationship requests. The API must
-- still check both block directions on every read/write; this trigger prevents stale relationships.
CREATE OR REPLACE FUNCTION cleanup_relationships_on_block()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_a uuid; v_b uuid; v_lock_key bigint;
BEGIN
    v_lock_key := hashtextextended(least(NEW.blocker_user_id::text,NEW.blocked_user_id::text)||':'||greatest(NEW.blocker_user_id::text,NEW.blocked_user_id::text),0);
    PERFORM pg_advisory_xact_lock(v_lock_key);
    DELETE FROM user_follows WHERE (follower_user_id=NEW.blocker_user_id AND followed_user_id=NEW.blocked_user_id)
       OR (follower_user_id=NEW.blocked_user_id AND followed_user_id=NEW.blocker_user_id);
    UPDATE message_requests SET status='CLOSED'
      WHERE status='REQUESTED' AND ((sender_id=NEW.blocker_user_id AND recipient_id=NEW.blocked_user_id)
        OR (sender_id=NEW.blocked_user_id AND recipient_id=NEW.blocker_user_id));
    UPDATE direct_conversations SET status='CLOSED',updated_at=now()
      WHERE participant_a_business_account_id IS NULL AND participant_b_business_account_id IS NULL
        AND participant_a_id=LEAST(NEW.blocker_user_id,NEW.blocked_user_id)
        AND participant_b_id=GREATEST(NEW.blocker_user_id,NEW.blocked_user_id)
        AND status <> 'CLOSED';
    UPDATE matchmaking_matches SET status='BLOCKED',closed_at=COALESCE(closed_at,now()),closed_by=NEW.blocker_user_id,
        close_reason='User block',updated_at=now()
      WHERE (user_a_id=LEAST(NEW.blocker_user_id,NEW.blocked_user_id) AND user_b_id=GREATEST(NEW.blocker_user_id,NEW.blocked_user_id))
        AND status<>'BLOCKED';
    DELETE FROM matchmaking_swipes WHERE (swiper_user_id=NEW.blocker_user_id AND target_user_id=NEW.blocked_user_id)
        OR (swiper_user_id=NEW.blocked_user_id AND target_user_id=NEW.blocker_user_id);
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_cleanup_relationships_on_block ON user_blocks;
CREATE TRIGGER trg_cleanup_relationships_on_block AFTER INSERT ON user_blocks
FOR EACH ROW EXECUTE FUNCTION cleanup_relationships_on_block();

-- 15. Configuration, idempotency, transactional outbox and media jobs.
CREATE TABLE feature_flags (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_key text NOT NULL,
    country_id uuid REFERENCES countries(id) ON DELETE CASCADE,
    community_id uuid REFERENCES communities(id) ON DELETE CASCADE,
    is_enabled boolean NOT NULL DEFAULT true,
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(country_id IS NULL OR community_id IS NULL),
    UNIQUE(flag_key,country_id,community_id)
);
CREATE UNIQUE INDEX ux_feature_flag_global ON feature_flags(flag_key) WHERE country_id IS NULL AND community_id IS NULL;
CREATE UNIQUE INDEX ux_feature_flag_country ON feature_flags(flag_key,country_id) WHERE country_id IS NOT NULL AND community_id IS NULL;
CREATE UNIQUE INDEX ux_feature_flag_community ON feature_flags(flag_key,community_id) WHERE community_id IS NOT NULL;

-- Feature access policy is separate from feature_flags: flags control rollout, while
-- these rows control FREE/PREMIUM/ROLE access and optional usage quotas. Scope precedence
-- (community, then country, then global) and subscription/role resolution are backend rules.
CREATE TABLE feature_access_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_key text NOT NULL CHECK(feature_key=upper(trim(feature_key)) AND feature_key ~ '^[A-Z0-9_]+$'),
    access_type text NOT NULL CHECK(access_type IN ('FREE','PREMIUM','ROLE')),
    role_key text CHECK(role_key IS NULL OR (role_key=upper(trim(role_key)) AND role_key ~ '^[A-Z][A-Z0-9_]*$')),
    country_id uuid REFERENCES countries(id) ON DELETE CASCADE,
    community_id uuid REFERENCES communities(id) ON DELETE CASCADE,
    is_enabled boolean NOT NULL DEFAULT true,
    usage_limit integer CHECK(usage_limit IS NULL OR usage_limit >= 0),
    reset_period text CHECK(reset_period IS NULL OR reset_period IN ('DAY','WEEK','MONTH','YEAR','SUBSCRIPTION_PERIOD','NEVER')),
    config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(config)='object'),
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(country_id IS NULL OR community_id IS NULL),
    CHECK((access_type='ROLE' AND role_key IS NOT NULL) OR (access_type IN ('FREE','PREMIUM') AND role_key IS NULL)),
    CHECK((usage_limit IS NULL AND reset_period IS NULL) OR (usage_limit IS NOT NULL AND reset_period IS NOT NULL))
);
CREATE UNIQUE INDEX ux_feature_access_rule_global ON feature_access_rules(feature_key,access_type,coalesce(role_key,''))
    WHERE country_id IS NULL AND community_id IS NULL;
CREATE UNIQUE INDEX ux_feature_access_rule_country ON feature_access_rules(feature_key,country_id,access_type,coalesce(role_key,''))
    WHERE country_id IS NOT NULL AND community_id IS NULL;
CREATE UNIQUE INDEX ux_feature_access_rule_community ON feature_access_rules(feature_key,community_id,access_type,coalesce(role_key,''))
    WHERE community_id IS NOT NULL;
CREATE INDEX ix_feature_access_rules_scope ON feature_access_rules(feature_key,country_id,community_id,is_enabled);
COMMENT ON TABLE feature_flags IS 'Feature rollout switches only; access eligibility and usage quotas are defined in feature_access_rules and billing entitlements.';
COMMENT ON TABLE feature_access_rules IS 'Scoped FREE/PREMIUM/ROLE access policies. The backend resolves scope precedence, subscription entitlements, roles and usage limits on every protected request.';
CREATE TABLE app_settings (
    setting_key text PRIMARY KEY,
    setting_value jsonb NOT NULL,
    description text,
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE idempotency_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    operation_key text NOT NULL,
    request_hash text NOT NULL,
    response_status integer,
    response_body jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    UNIQUE(user_id,operation_key)
);
CREATE INDEX ix_idempotency_expiry ON idempotency_keys(expires_at);

CREATE TABLE outbox_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    event_type text NOT NULL,
    destination outbox_destination NOT NULL DEFAULT 'ABLY',
    destination_key text,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    available_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
    last_error text,
    locked_at timestamptz,
    event_dedupe_key text NOT NULL UNIQUE
);
CREATE INDEX ix_outbox_due ON outbox_events(available_at,created_at) WHERE published_at IS NULL;
CREATE OR REPLACE FUNCTION enqueue_notification_push_work()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,destination,destination_key,payload,event_dedupe_key)
    VALUES('NOTIFICATION',NEW.id,'NOTIFICATION_CREATED','PUSH','user:'||NEW.recipient_user_id::text,
           jsonb_build_object('notificationId',NEW.id,'recipientUserId',NEW.recipient_user_id,'type',NEW.type),
           'notification-created:'||NEW.id::text)
    ON CONFLICT(event_dedupe_key) DO NOTHING;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_enqueue_notification_push_work AFTER INSERT ON notifications
FOR EACH ROW EXECUTE FUNCTION enqueue_notification_push_work();


CREATE TABLE media_processing_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
    operation_key text NOT NULL CHECK(operation_key IN ('VALIDATE','THUMBNAIL','BLUR_IMAGE','TRANSCODE_VIDEO','STRIP_EXIF','SCAN_FILE','DELETE_OBJECT')),
    status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
    attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
    available_at timestamptz NOT NULL DEFAULT now(),
    locked_at timestamptz,
    last_error text,
    result_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(media_id,operation_key)
);
CREATE INDEX ix_media_jobs_due ON media_processing_jobs(available_at,created_at) WHERE status IN ('PENDING','FAILED');

CREATE TABLE analytics_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    event_key text NOT NULL,
    country_id uuid REFERENCES countries(id) ON DELETE SET NULL,
    community_id uuid REFERENCES communities(id) ON DELETE SET NULL,
    target_type text,
    target_id uuid,
    properties jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_analytics_event_key_time ON analytics_events(event_key,occurred_at DESC);

-- 16. Country-category consistency guards. This protects data even if an API path
-- accidentally skips category validation. Authorization/membership still belongs
-- in the Spring Boot service; these triggers enforce taxonomy and country integrity.
CREATE OR REPLACE FUNCTION assert_country_category(p_category_id uuid, p_country_id uuid, p_module category_module)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_category_id IS NULL THEN
        RAISE EXCEPTION 'category_id is required for module %', p_module USING ERRCODE='23502';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM country_categories cc
        JOIN country_category_modules ccm ON ccm.category_id=cc.id
        WHERE cc.id=p_category_id AND cc.country_id=p_country_id
          AND cc.is_active=true AND ccm.module_key=p_module
    ) THEN
        RAISE EXCEPTION 'category % is not active for country % and module %', p_category_id, p_country_id, p_module
          USING ERRCODE='23514';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION validate_feed_post_country_category()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_destination uuid;
BEGIN
    SELECT destination_country_id INTO v_destination FROM communities WHERE id=NEW.community_id AND is_active=true;
    IF v_destination IS NULL THEN
        RAISE EXCEPTION 'community missing or inactive';
    END IF;
    IF v_destination <> NEW.country_id THEN
        RAISE EXCEPTION 'feed post country must equal community destination country';
    END IF;
    IF NEW.post_type='COMMUNITY_HELP' THEN
        PERFORM assert_country_category(NEW.category_id,NEW.country_id,'COMMUNITY_HELP');
    ELSE
        PERFORM assert_country_category(NEW.category_id,NEW.country_id,'FEED');
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_feed_post_country_category ON feed_posts;
CREATE TRIGGER trg_feed_post_country_category BEFORE INSERT OR UPDATE OF country_id,community_id,category_id,post_type ON feed_posts
FOR EACH ROW EXECUTE FUNCTION validate_feed_post_country_category();

-- Keep feed_posts and community_help_posts consistent. Create a help post as DRAFT,
-- insert its lifecycle row in the same transaction, then publish it. Published help
-- posts cannot be orphaned from their lifecycle metadata or reclassified as other posts.
CREATE OR REPLACE FUNCTION guard_community_help_parent_post()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_has_help_metadata boolean;
BEGIN
    IF TG_OP='UPDATE' AND OLD.post_type='COMMUNITY_HELP'
       AND NEW.author_id IS DISTINCT FROM OLD.author_id THEN
        RAISE EXCEPTION 'Community Help author identity is immutable' USING ERRCODE='23514';
    END IF;
    SELECT EXISTS(SELECT 1 FROM community_help_posts ch WHERE ch.post_id=NEW.id)
      INTO v_has_help_metadata;
    IF NEW.post_type='COMMUNITY_HELP' THEN
        IF NEW.status='PUBLISHED' AND NOT v_has_help_metadata THEN
            RAISE EXCEPTION 'Community Help post must have community_help_posts metadata before publication' USING ERRCODE='23514';
        END IF;
    ELSIF v_has_help_metadata THEN
        RAISE EXCEPTION 'A post with Community Help metadata must keep post_type COMMUNITY_HELP' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_guard_community_help_parent_post
BEFORE INSERT OR UPDATE OF post_type,status,author_id ON feed_posts
FOR EACH ROW EXECUTE FUNCTION guard_community_help_parent_post();

CREATE OR REPLACE FUNCTION validate_community_help_post()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_post_type text;
BEGIN
    IF TG_OP='INSERT' THEN
        SELECT post_type INTO v_post_type FROM feed_posts WHERE id=NEW.post_id;
        IF v_post_type IS DISTINCT FROM 'COMMUNITY_HELP' THEN
            RAISE EXCEPTION 'Community Help metadata must reference a feed_posts row with post_type COMMUNITY_HELP' USING ERRCODE='23514';
        END IF;
        IF NEW.help_status <> 'OPEN' THEN
            RAISE EXCEPTION 'A new Community Help post must start OPEN' USING ERRCODE='23514';
        END IF;
        NEW.resolved_at := NULL; NEW.closed_at := NULL; NEW.expired_at := NULL;
        RETURN NEW;
    END IF;

    IF NEW.post_id IS DISTINCT FROM OLD.post_id THEN
        RAISE EXCEPTION 'Community Help post_id is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.help_kind IS DISTINCT FROM OLD.help_kind THEN
        RAISE EXCEPTION 'Community Help kind is immutable; create a new post to change REQUEST/OFFER' USING ERRCODE='23514';
    END IF;

    IF OLD.help_status IN ('RESOLVED','CLOSED','EXPIRED')
       AND NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
        RAISE EXCEPTION 'Expiry cannot be changed after a Community Help post reaches a terminal state' USING ERRCODE='23514';
    END IF;
    IF NEW.help_status IS DISTINCT FROM OLD.help_status THEN
        IF OLD.help_status NOT IN ('OPEN','PAUSED') THEN
            RAISE EXCEPTION 'RESOLVED, CLOSED and EXPIRED Community Help posts are terminal' USING ERRCODE='23514';
        END IF;
        IF NEW.help_status NOT IN ('OPEN','PAUSED','RESOLVED','CLOSED','EXPIRED') THEN
            RAISE EXCEPTION 'Unsupported Community Help status' USING ERRCODE='23514';
        END IF;
        IF NEW.help_status='EXPIRED' AND (NEW.expires_at IS NULL OR NEW.expires_at > now()) THEN
            RAISE EXCEPTION 'A Community Help post can expire only after expires_at' USING ERRCODE='23514';
        END IF;
        NEW.resolved_at := NULL; NEW.closed_at := NULL; NEW.expired_at := NULL;
        IF NEW.help_status='RESOLVED' THEN NEW.resolved_at := now(); END IF;
        IF NEW.help_status='CLOSED' THEN NEW.closed_at := now(); END IF;
        IF NEW.help_status='EXPIRED' THEN NEW.expired_at := now(); END IF;
    ELSE
        -- State timestamps are database-managed; clients cannot rewrite the audit time.
        NEW.resolved_at := OLD.resolved_at;
        NEW.closed_at := OLD.closed_at;
        NEW.expired_at := OLD.expired_at;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_community_help_post
BEFORE INSERT OR UPDATE ON community_help_posts
FOR EACH ROW EXECUTE FUNCTION validate_community_help_post();

CREATE OR REPLACE FUNCTION prevent_published_community_help_metadata_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM feed_posts fp WHERE fp.id=OLD.post_id
               AND fp.post_type='COMMUNITY_HELP' AND fp.status='PUBLISHED' AND fp.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Cannot delete lifecycle metadata for a published Community Help post' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
END;
$$;
CREATE TRIGGER trg_prevent_published_community_help_metadata_delete
BEFORE DELETE ON community_help_posts
FOR EACH ROW EXECUTE FUNCTION prevent_published_community_help_metadata_delete();

CREATE OR REPLACE FUNCTION validate_event_taxonomy_and_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_category_country uuid; v_active boolean;
BEGIN
    IF NEW.community_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM communities c WHERE c.id=NEW.community_id AND c.destination_country_id=NEW.country_id AND c.is_active=true
    ) THEN RAISE EXCEPTION 'Event country must equal active community destination country' USING ERRCODE='23514'; END IF;
    SELECT country_id,is_active INTO v_category_country,v_active FROM event_categories WHERE id=NEW.event_category_id;
    IF v_active IS DISTINCT FROM true OR (v_category_country IS NOT NULL AND v_category_country IS DISTINCT FROM NEW.country_id) THEN
        RAISE EXCEPTION 'Event category must be active and global or scoped to the event country' USING ERRCODE='23514';
    END IF;
    IF NEW.country_topic_category_id IS NOT NULL THEN PERFORM assert_country_category(NEW.country_topic_category_id,NEW.country_id,'EVENT'); END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_events_taxonomy_scope ON events;
CREATE TRIGGER trg_events_taxonomy_scope BEFORE INSERT OR UPDATE OF country_id,community_id,event_category_id,country_topic_category_id ON events
FOR EACH ROW EXECUTE FUNCTION validate_event_taxonomy_and_scope();

CREATE OR REPLACE FUNCTION validate_job_category_country()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_job_country uuid; v_category_country uuid; v_active boolean;
BEGIN
    SELECT country_id INTO v_job_country FROM job_listings WHERE id=NEW.job_id;
    SELECT country_id,is_active INTO v_category_country,v_active FROM job_categories WHERE id=NEW.category_id;
    IF v_job_country IS NULL OR v_active IS DISTINCT FROM true OR (v_category_country IS NOT NULL AND v_category_country IS DISTINCT FROM v_job_country) THEN
        RAISE EXCEPTION 'Job category must be active and global or scoped to the listing country' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_job_category_country ON job_listing_categories;
CREATE TRIGGER trg_job_category_country BEFORE INSERT OR UPDATE OF job_id,category_id ON job_listing_categories
FOR EACH ROW EXECUTE FUNCTION validate_job_category_country();

CREATE OR REPLACE FUNCTION prevent_published_job_category_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_job_id uuid; v_job_status job_status;
BEGIN
    IF TG_OP='DELETE' THEN v_job_id:=OLD.job_id; ELSE v_job_id:=NEW.job_id; END IF;
    SELECT status INTO v_job_status FROM job_listings WHERE id=v_job_id FOR UPDATE;
    IF v_job_status='PUBLISHED' THEN
        RAISE EXCEPTION 'Unpublish or pause a job before changing its categories' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND NEW.job_id IS DISTINCT FROM OLD.job_id THEN
        SELECT status INTO v_job_status FROM job_listings WHERE id=OLD.job_id FOR UPDATE;
        IF v_job_status='PUBLISHED' THEN RAISE EXCEPTION 'Cannot move a category assignment from a published job' USING ERRCODE='23514'; END IF;
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
DROP TRIGGER IF EXISTS trg_published_job_category_immutable ON job_listing_categories;
CREATE TRIGGER trg_published_job_category_immutable BEFORE INSERT OR UPDATE OR DELETE ON job_listing_categories
FOR EACH ROW EXECUTE FUNCTION prevent_published_job_category_mutation();

CREATE OR REPLACE FUNCTION validate_job_listing()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_destination uuid;
BEGIN
    IF NEW.community_id IS NOT NULL THEN
        SELECT destination_country_id INTO v_destination FROM communities WHERE id=NEW.community_id AND is_active=true;
        IF v_destination IS DISTINCT FROM NEW.country_id THEN RAISE EXCEPTION 'Job country must equal active community destination country' USING ERRCODE='23514'; END IF;
    END IF;
    IF NEW.business_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM business_listings b WHERE b.id=NEW.business_id AND b.country_id=NEW.country_id AND b.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Linked employer business must belong to the job country' USING ERRCODE='23514';
    END IF;
    IF EXISTS (
        SELECT 1 FROM job_listing_categories jc JOIN job_categories cat ON cat.id=jc.category_id
        WHERE jc.job_id=NEW.id AND (cat.is_active=false OR (cat.country_id IS NOT NULL AND cat.country_id IS DISTINCT FROM NEW.country_id))
    ) THEN
        RAISE EXCEPTION 'Every assigned job category must be active and global or match the listing country' USING ERRCODE='23514';
    END IF;
    IF NEW.status='PUBLISHED' THEN
        IF NEW.posted_by_user_id IS NULL THEN
            RAISE EXCEPTION 'Published jobs require an auditable posting user' USING ERRCODE='23514';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM job_listing_categories jc WHERE jc.job_id=NEW.id AND jc.is_primary=true) THEN
            RAISE EXCEPTION 'A published job requires a primary job-specific category' USING ERRCODE='23514';
        END IF;
        IF NEW.source_type='COMMUNITY_SHARED' AND NEW.posted_by_user_id IS NULL THEN
            RAISE EXCEPTION 'Community-shared jobs require a posting member' USING ERRCODE='23514';
        END IF;
        IF NEW.source_type='EXTERNAL_AGGREGATOR' AND (NEW.source_url IS NULL OR NEW.source_name IS NULL) THEN
            RAISE EXCEPTION 'Aggregated external jobs require source name and source URL' USING ERRCODE='23514';
        END IF;
        IF NEW.source_type='COMMUNITY_ORGANIZATION' AND NEW.posted_by_user_id IS NULL AND NEW.employer_user_id IS NULL AND NEW.business_id IS NULL AND NEW.owner_user_id IS NULL AND NEW.business_account_id IS NULL THEN
            RAISE EXCEPTION 'Community-organisation jobs require an accountable poster or employer' USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
-- The job trigger is created after v10.4 ownership columns are added below.

CREATE OR REPLACE FUNCTION validate_business_location_address()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_business_country uuid; v_address_country uuid; v_visibility address_visibility;
BEGIN
    SELECT country_id INTO v_business_country FROM business_listings WHERE id=NEW.business_id;
    SELECT country_id,visibility INTO v_address_country,v_visibility FROM addresses WHERE id=NEW.address_id;
    IF v_business_country IS DISTINCT FROM v_address_country THEN RAISE EXCEPTION 'Business location address must belong to business country' USING ERRCODE='23514'; END IF;
    IF v_visibility IS DISTINCT FROM 'PUBLIC' THEN RAISE EXCEPTION 'Directory business location addresses must be PUBLIC' USING ERRCODE='23514'; END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_business_location_address ON business_locations;
CREATE TRIGGER trg_business_location_address BEFORE INSERT OR UPDATE OF business_id,address_id ON business_locations
FOR EACH ROW EXECUTE FUNCTION validate_business_location_address();

CREATE OR REPLACE FUNCTION validate_spare_bag_private_addresses()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_country uuid; v_visibility address_visibility; v_address_owner uuid;
BEGIN
    IF NEW.collection_address_id IS NOT NULL THEN
        SELECT country_id,visibility,owner_user_id INTO v_country,v_visibility,v_address_owner FROM addresses WHERE id=NEW.collection_address_id;
        IF v_country IS DISTINCT FROM (SELECT country_id FROM airports WHERE id=NEW.origin_airport_id)
           OR v_visibility='PUBLIC' OR v_address_owner IS DISTINCT FROM NEW.owner_user_id THEN
            RAISE EXCEPTION 'Spare Bag collection address must be non-public, owned by the listing owner, and in the origin airport country' USING ERRCODE='23514';
        END IF;
    END IF;
    IF NEW.handover_address_id IS NOT NULL THEN
        SELECT country_id,visibility,owner_user_id INTO v_country,v_visibility,v_address_owner FROM addresses WHERE id=NEW.handover_address_id;
        IF v_country IS DISTINCT FROM (SELECT country_id FROM airports WHERE id=NEW.destination_airport_id)
           OR v_visibility='PUBLIC' OR v_address_owner IS DISTINCT FROM NEW.owner_user_id THEN
            RAISE EXCEPTION 'Spare Bag handover address must be non-public, owned by the listing owner, and in the destination airport country' USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_spare_bag_address_privacy ON spare_bag_listings;
CREATE TRIGGER trg_spare_bag_address_privacy BEFORE INSERT OR UPDATE OF origin_airport_id,destination_airport_id,collection_address_id,handover_address_id ON spare_bag_listings
FOR EACH ROW EXECUTE FUNCTION validate_spare_bag_private_addresses();

-- Cross-entity data-integrity guards for shared addresses and editorial relationships.
CREATE OR REPLACE FUNCTION validate_event_address_country()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_address_country uuid;
BEGIN
    IF NEW.address_id IS NOT NULL THEN
        SELECT country_id INTO v_address_country FROM addresses WHERE id=NEW.address_id;
        IF v_address_country IS DISTINCT FROM NEW.country_id THEN RAISE EXCEPTION 'Event address must belong to event country' USING ERRCODE='23514'; END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_event_address_country ON events;
CREATE TRIGGER trg_event_address_country BEFORE INSERT OR UPDATE OF address_id,country_id ON events
FOR EACH ROW EXECUTE FUNCTION validate_event_address_country();

CREATE OR REPLACE FUNCTION validate_job_workplace_address_country()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_address_country uuid;
BEGIN
    IF NEW.workplace_address_id IS NOT NULL THEN
        SELECT country_id INTO v_address_country FROM addresses WHERE id=NEW.workplace_address_id;
        IF v_address_country IS DISTINCT FROM NEW.country_id THEN RAISE EXCEPTION 'Workplace address must belong to job country' USING ERRCODE='23514'; END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_job_workplace_address_country ON job_listings;
CREATE TRIGGER trg_job_workplace_address_country BEFORE INSERT OR UPDATE OF workplace_address_id,country_id ON job_listings
FOR EACH ROW EXECUTE FUNCTION validate_job_workplace_address_country();

-- 17. Additional integrity guards identified in the v7 schema audit.

-- Replies must remain within their parent post/room/conversation; limit feed replies to one nested level.
CREATE OR REPLACE FUNCTION validate_feed_comment_parent()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_parent_post uuid; v_parent_parent uuid;
BEGIN
    IF NEW.parent_comment_id IS NULL THEN RETURN NEW; END IF;
    SELECT post_id,parent_comment_id INTO v_parent_post,v_parent_parent FROM feed_post_comments WHERE id=NEW.parent_comment_id;
    IF v_parent_post IS DISTINCT FROM NEW.post_id THEN
        RAISE EXCEPTION 'Parent comment must belong to the same feed post' USING ERRCODE='23514';
    END IF;
    IF v_parent_parent IS NOT NULL THEN
        RAISE EXCEPTION 'Feed comments support one reply level in the initial release' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_feed_comment_parent_integrity ON feed_post_comments;
CREATE TRIGGER trg_feed_comment_parent_integrity BEFORE INSERT OR UPDATE OF post_id,parent_comment_id ON feed_post_comments
FOR EACH ROW EXECUTE FUNCTION validate_feed_comment_parent();

CREATE OR REPLACE FUNCTION validate_chat_message_reply_target()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.reply_to_message_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM chat_messages parent WHERE parent.id=NEW.reply_to_message_id AND parent.room_id=NEW.room_id
    ) THEN RAISE EXCEPTION 'Replied-to message must be in the same chat room' USING ERRCODE='23514'; END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_chat_message_reply_integrity ON chat_messages;
CREATE TRIGGER trg_chat_message_reply_integrity BEFORE INSERT OR UPDATE OF room_id,reply_to_message_id ON chat_messages
FOR EACH ROW EXECUTE FUNCTION validate_chat_message_reply_target();

CREATE OR REPLACE FUNCTION validate_direct_message_reply_target()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.reply_to_message_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM direct_messages parent WHERE parent.id=NEW.reply_to_message_id AND parent.conversation_id=NEW.conversation_id
    ) THEN RAISE EXCEPTION 'Replied-to direct message must be in the same conversation' USING ERRCODE='23514'; END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_direct_message_reply_integrity ON direct_messages;
CREATE TRIGGER trg_direct_message_reply_integrity BEFORE INSERT OR UPDATE OF conversation_id,reply_to_message_id ON direct_messages
FOR EACH ROW EXECUTE FUNCTION validate_direct_message_reply_target();

-- Category ownership should not be moved between countries after it has been created;
-- create a new category and migrate content if the taxonomy genuinely changes.
CREATE OR REPLACE FUNCTION prevent_country_category_reassignment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.country_id IS DISTINCT FROM OLD.country_id THEN
        RAISE EXCEPTION 'Category country_id is immutable; create a new category instead' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_country_category_country_immutable ON country_categories;
CREATE TRIGGER trg_country_category_country_immutable BEFORE UPDATE OF country_id ON country_categories
FOR EACH ROW EXECUTE FUNCTION prevent_country_category_reassignment();
DROP TRIGGER IF EXISTS trg_business_category_country_immutable ON business_categories;
CREATE TRIGGER trg_business_category_country_immutable BEFORE UPDATE OF country_id ON business_categories
FOR EACH ROW EXECUTE FUNCTION prevent_country_category_reassignment();

-- Validate business category country against the listing market; global categories
-- (country_id IS NULL) may be reused in any country.
CREATE OR REPLACE FUNCTION validate_business_listing_category()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_category_country uuid; v_category_active boolean;
BEGIN
    IF NEW.category_id IS NULL THEN RETURN NEW; END IF;
    SELECT country_id,is_active INTO v_category_country,v_category_active
      FROM business_categories WHERE id=NEW.category_id;
    IF v_category_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Business category is missing or inactive' USING ERRCODE='23514';
    END IF;
    IF v_category_country IS NOT NULL AND v_category_country <> NEW.country_id THEN
        RAISE EXCEPTION 'Business category country must match listing country' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_business_listing_category_country ON business_listings;
CREATE TRIGGER trg_business_listing_category_country BEFORE INSERT OR UPDATE OF country_id,category_id ON business_listings
FOR EACH ROW EXECUTE FUNCTION validate_business_listing_category();

-- A listing owner cannot rate their own business. Rating aggregates are maintained
-- transactionally so stored summary columns do not drift from published reviews.
CREATE OR REPLACE FUNCTION reject_business_self_review()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_owner uuid;
BEGIN
    SELECT owner_user_id INTO v_owner FROM business_listings WHERE id=NEW.business_id;
    IF v_owner IS NOT NULL AND v_owner=NEW.reviewer_user_id THEN
        RAISE EXCEPTION 'Business owners cannot review their own listing' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_business_review_not_self ON business_reviews;
CREATE TRIGGER trg_business_review_not_self BEFORE INSERT OR UPDATE OF business_id,reviewer_user_id ON business_reviews
FOR EACH ROW EXECUTE FUNCTION reject_business_self_review();

CREATE OR REPLACE FUNCTION refresh_business_rating_summary()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_old_business uuid; v_new_business uuid;
BEGIN
    IF TG_OP <> 'INSERT' THEN v_old_business := OLD.business_id; END IF;
    IF TG_OP <> 'DELETE' THEN v_new_business := NEW.business_id; END IF;
    IF v_old_business IS NOT NULL THEN
        UPDATE business_listings bl SET
          review_count = (SELECT count(*)::integer FROM business_reviews br WHERE br.business_id=v_old_business AND br.status='PUBLISHED'),
          average_rating = (SELECT round(avg(br.rating)::numeric,2) FROM business_reviews br WHERE br.business_id=v_old_business AND br.status='PUBLISHED')
        WHERE bl.id=v_old_business;
    END IF;
    IF v_new_business IS NOT NULL AND v_new_business IS DISTINCT FROM v_old_business THEN
        UPDATE business_listings bl SET
          review_count = (SELECT count(*)::integer FROM business_reviews br WHERE br.business_id=v_new_business AND br.status='PUBLISHED'),
          average_rating = (SELECT round(avg(br.rating)::numeric,2) FROM business_reviews br WHERE br.business_id=v_new_business AND br.status='PUBLISHED')
        WHERE bl.id=v_new_business;
    ELSIF v_new_business IS NOT NULL AND v_old_business IS NULL THEN
        UPDATE business_listings bl SET
          review_count = (SELECT count(*)::integer FROM business_reviews br WHERE br.business_id=v_new_business AND br.status='PUBLISHED'),
          average_rating = (SELECT round(avg(br.rating)::numeric,2) FROM business_reviews br WHERE br.business_id=v_new_business AND br.status='PUBLISHED')
        WHERE bl.id=v_new_business;
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_business_review_rating_summary ON business_reviews;
CREATE TRIGGER trg_business_review_rating_summary AFTER INSERT OR UPDATE OR DELETE ON business_reviews
FOR EACH ROW EXECUTE FUNCTION refresh_business_rating_summary();

-- Matchmaking integrity functions are defined with the new profile-based model above.

CREATE OR REPLACE FUNCTION validate_event_voice_room_country()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_room_country uuid;
BEGIN
    IF NEW.linked_voice_room_id IS NULL THEN RETURN NEW; END IF;
    SELECT country_id INTO v_room_country FROM voice_rooms WHERE id=NEW.linked_voice_room_id;
    IF v_room_country IS DISTINCT FROM NEW.country_id THEN
        RAISE EXCEPTION 'Event voice room must belong to the event country' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_event_voice_room_country ON events;
CREATE TRIGGER trg_event_voice_room_country BEFORE INSERT OR UPDATE OF country_id,linked_voice_room_id ON events
FOR EACH ROW EXECUTE FUNCTION validate_event_voice_room_country();

-- Internal applications are only valid for published INTERNAL jobs; do not store
-- applications for external redirect-only listings.
CREATE OR REPLACE FUNCTION validate_internal_job_application()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_method application_method; v_status job_status; v_employer uuid; v_business_owner uuid;
BEGIN
    SELECT j.application_method,j.status,j.employer_user_id,b.owner_user_id
      INTO v_method,v_status,v_employer,v_business_owner
      FROM job_listings j LEFT JOIN business_listings b ON b.id=j.business_id WHERE j.id=NEW.job_id;
    IF v_method IS DISTINCT FROM 'INTERNAL' OR v_status IS DISTINCT FROM 'PUBLISHED' THEN
        RAISE EXCEPTION 'Applications are accepted only for published internal-application jobs' USING ERRCODE='23514';
    END IF;
    IF NEW.applicant_id=v_employer OR (v_business_owner IS NOT NULL AND NEW.applicant_id=v_business_owner) THEN
        RAISE EXCEPTION 'Employers cannot apply to their own job listing' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_internal_job_application_integrity ON job_applications;
CREATE TRIGGER trg_internal_job_application_integrity BEFORE INSERT OR UPDATE OF job_id,applicant_id ON job_applications
FOR EACH ROW EXECUTE FUNCTION validate_internal_job_application();

-- Keep denormalised feed counters consistent under concurrent inserts/deletes.
CREATE OR REPLACE FUNCTION maintain_feed_comment_count()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_old_visible boolean := false; v_new_visible boolean := false; v_old_post uuid; v_new_post uuid; v_delta integer;
BEGIN
    IF TG_OP <> 'INSERT' THEN v_old_post:=OLD.post_id; v_old_visible:=(OLD.status='PUBLISHED' AND OLD.deleted_at IS NULL); END IF;
    IF TG_OP <> 'DELETE' THEN v_new_post:=NEW.post_id; v_new_visible:=(NEW.status='PUBLISHED' AND NEW.deleted_at IS NULL); END IF;
    IF v_old_post IS NOT DISTINCT FROM v_new_post THEN
        v_delta := (CASE WHEN v_new_visible THEN 1 ELSE 0 END) - (CASE WHEN v_old_visible THEN 1 ELSE 0 END);
        IF v_delta <> 0 AND v_new_post IS NOT NULL THEN UPDATE feed_posts SET comment_count=GREATEST(0,comment_count+v_delta) WHERE id=v_new_post; END IF;
    ELSE
        IF v_old_visible THEN UPDATE feed_posts SET comment_count=GREATEST(0,comment_count-1) WHERE id=v_old_post; END IF;
        IF v_new_visible THEN UPDATE feed_posts SET comment_count=comment_count+1 WHERE id=v_new_post; END IF;
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
DROP TRIGGER IF EXISTS trg_feed_comment_count ON feed_post_comments;
CREATE TRIGGER trg_feed_comment_count AFTER INSERT OR UPDATE OR DELETE ON feed_post_comments
FOR EACH ROW EXECUTE FUNCTION maintain_feed_comment_count();

CREATE OR REPLACE FUNCTION maintain_feed_reaction_count()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_old_post uuid; v_new_post uuid;
BEGIN
    IF TG_OP <> 'INSERT' THEN v_old_post:=OLD.post_id; END IF;
    IF TG_OP <> 'DELETE' THEN v_new_post:=NEW.post_id; END IF;
    IF v_old_post IS NOT DISTINCT FROM v_new_post THEN
        IF TG_OP='INSERT' THEN UPDATE feed_posts SET reaction_count=reaction_count+1 WHERE id=v_new_post;
        ELSIF TG_OP='DELETE' THEN UPDATE feed_posts SET reaction_count=GREATEST(0,reaction_count-1) WHERE id=v_old_post; END IF;
    ELSE
        IF v_old_post IS NOT NULL THEN UPDATE feed_posts SET reaction_count=GREATEST(0,reaction_count-1) WHERE id=v_old_post; END IF;
        IF v_new_post IS NOT NULL THEN UPDATE feed_posts SET reaction_count=reaction_count+1 WHERE id=v_new_post; END IF;
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
DROP TRIGGER IF EXISTS trg_feed_reaction_count ON feed_post_reactions;
CREATE TRIGGER trg_feed_reaction_count AFTER INSERT OR UPDATE OR DELETE ON feed_post_reactions
FOR EACH ROW EXECUTE FUNCTION maintain_feed_reaction_count();

CREATE OR REPLACE FUNCTION maintain_feed_share_count()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_old_post uuid; v_new_post uuid;
BEGIN
    IF TG_OP <> 'INSERT' THEN v_old_post:=OLD.post_id; END IF;
    IF TG_OP <> 'DELETE' THEN v_new_post:=NEW.post_id; END IF;
    IF v_old_post IS NOT DISTINCT FROM v_new_post THEN
        IF TG_OP='INSERT' THEN UPDATE feed_posts SET share_count=share_count+1 WHERE id=v_new_post;
        ELSIF TG_OP='DELETE' THEN UPDATE feed_posts SET share_count=GREATEST(0,share_count-1) WHERE id=v_old_post; END IF;
    ELSE
        IF v_old_post IS NOT NULL THEN UPDATE feed_posts SET share_count=GREATEST(0,share_count-1) WHERE id=v_old_post; END IF;
        IF v_new_post IS NOT NULL THEN UPDATE feed_posts SET share_count=share_count+1 WHERE id=v_new_post; END IF;
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
DROP TRIGGER IF EXISTS trg_feed_share_count ON post_shares;
CREATE TRIGGER trg_feed_share_count AFTER INSERT OR UPDATE OR DELETE ON post_shares
FOR EACH ROW EXECUTE FUNCTION maintain_feed_share_count();

-- Poll option count and immutability rules. The first two options are checked at the point of voting/closing
-- so poll creation can insert its options in one transaction. The API must create at least two options before publish.
CREATE OR REPLACE FUNCTION validate_feed_poll_option()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_post uuid; v_max smallint; v_voted boolean; v_count integer;
BEGIN
    IF TG_OP='DELETE' THEN v_post:=OLD.post_id; ELSE v_post:=NEW.post_id; END IF;
    SELECT fp.post_id,fp.max_options INTO v_post,v_max FROM feed_polls fp WHERE fp.post_id=v_post FOR UPDATE;
    IF NOT FOUND THEN
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RAISE EXCEPTION 'Poll must exist before options are created' USING ERRCODE='23503';
    END IF;
    IF TG_OP='INSERT' THEN
        IF EXISTS (SELECT 1 FROM feed_poll_votes v JOIN feed_poll_options o ON o.id=v.option_id WHERE o.post_id=NEW.post_id) THEN
            RAISE EXCEPTION 'Poll options cannot be added after voting starts' USING ERRCODE='23514';
        END IF;
        SELECT count(*) INTO v_count FROM feed_poll_options WHERE post_id=NEW.post_id;
        IF v_count >= v_max THEN RAISE EXCEPTION 'Poll has reached max_options' USING ERRCODE='23514'; END IF;
    ELSIF TG_OP='UPDATE' THEN
        IF NEW.post_id IS DISTINCT FROM OLD.post_id THEN
            RAISE EXCEPTION 'Poll options cannot be moved between polls' USING ERRCODE='23514';
        END IF;
        SELECT EXISTS(SELECT 1 FROM feed_poll_votes v JOIN feed_poll_options o ON o.id=v.option_id WHERE o.post_id=OLD.post_id) INTO v_voted;
        IF v_voted AND (NEW.option_text IS DISTINCT FROM OLD.option_text OR NEW.sort_order IS DISTINCT FROM OLD.sort_order) THEN
            RAISE EXCEPTION 'Poll options cannot be edited or reordered after voting starts' USING ERRCODE='23514';
        END IF;
    ELSIF TG_OP='DELETE' THEN
        -- Permit cascaded cleanup when the parent poll/post is being deleted.
        IF pg_trigger_depth()>1 THEN RETURN OLD; END IF;
        SELECT EXISTS(SELECT 1 FROM feed_poll_votes v JOIN feed_poll_options o ON o.id=v.option_id WHERE o.post_id=OLD.post_id) INTO v_voted;
        IF v_voted THEN RAISE EXCEPTION 'Poll options cannot be deleted after voting starts; retain the complete option set' USING ERRCODE='23514'; END IF;
        SELECT count(*) INTO v_count FROM feed_poll_options WHERE post_id=OLD.post_id;
        IF v_count<=2 THEN RAISE EXCEPTION 'A poll must retain at least two options' USING ERRCODE='23514'; END IF;
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER trg_feed_poll_option_integrity BEFORE INSERT OR UPDATE OR DELETE ON feed_poll_options
FOR EACH ROW EXECUTE FUNCTION validate_feed_poll_option();

-- Enforce single/multiple choice, option count, explicit close state, and vote-change/withdraw policies.
CREATE OR REPLACE FUNCTION validate_feed_poll_vote()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_post_id uuid; v_old_post_id uuid; v_allow_multiple boolean; v_closes_at timestamptz; v_closed_at timestamptz;
    v_allow_change boolean; v_allow_withdraw boolean; v_option_count integer; v_old_option_id uuid; v_old_user_id uuid;
BEGIN
    IF TG_OP='DELETE' THEN
        -- Cascaded cleanup on poll/option deletion bypasses user-facing withdrawal policy.
        IF pg_trigger_depth()>1 THEN RETURN OLD; END IF;
        SELECT o.post_id,p.allow_vote_withdraw,p.closed_at,p.closes_at
          INTO v_post_id,v_allow_withdraw,v_closed_at,v_closes_at
          FROM feed_poll_options o JOIN feed_polls p ON p.post_id=o.post_id WHERE o.id=OLD.option_id FOR UPDATE OF p;
        IF v_post_id IS NULL THEN RETURN OLD; END IF;
        IF v_closed_at IS NOT NULL OR (v_closes_at IS NOT NULL AND v_closes_at<=now()) THEN RAISE EXCEPTION 'Poll is closed' USING ERRCODE='23514'; END IF;
        IF NOT v_allow_withdraw THEN RAISE EXCEPTION 'Vote withdrawal is disabled for this poll' USING ERRCODE='23514'; END IF;
        RETURN OLD;
    END IF;
    IF TG_OP='UPDATE' THEN
        v_old_option_id:=OLD.option_id; v_old_user_id:=OLD.user_id;
        SELECT post_id INTO v_old_post_id FROM feed_poll_options WHERE id=OLD.option_id;
        IF v_old_post_id IS DISTINCT FROM (SELECT post_id FROM feed_poll_options WHERE id=NEW.option_id) THEN
            RAISE EXCEPTION 'A vote cannot be moved between polls' USING ERRCODE='23514';
        END IF;
        IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN RAISE EXCEPTION 'A vote cannot be reassigned to another user' USING ERRCODE='23514'; END IF;
    END IF;
    SELECT o.post_id,p.allow_multiple,p.closes_at,p.closed_at,p.allow_vote_change,p.allow_vote_withdraw
      INTO v_post_id,v_allow_multiple,v_closes_at,v_closed_at,v_allow_change,v_allow_withdraw
      FROM feed_poll_options o JOIN feed_polls p ON p.post_id=o.post_id WHERE o.id=NEW.option_id FOR UPDATE OF p;
    IF v_post_id IS NULL THEN RAISE EXCEPTION 'Poll option does not exist' USING ERRCODE='23503'; END IF;
    IF v_closed_at IS NOT NULL OR (v_closes_at IS NOT NULL AND v_closes_at<=now()) THEN RAISE EXCEPTION 'Poll is closed' USING ERRCODE='23514'; END IF;
    SELECT count(*) INTO v_option_count FROM feed_poll_options WHERE post_id=v_post_id;
    IF v_option_count<2 THEN RAISE EXCEPTION 'A poll must have at least two options before voting' USING ERRCODE='23514'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_post_id::text || ':' || NEW.user_id::text,0));
    IF TG_OP='UPDATE' AND NEW.option_id IS DISTINCT FROM OLD.option_id AND NOT v_allow_change THEN
        RAISE EXCEPTION 'Vote changes are disabled for this poll' USING ERRCODE='23514';
    END IF;
    IF NOT v_allow_multiple AND EXISTS (
        SELECT 1 FROM feed_poll_votes v JOIN feed_poll_options o ON o.id=v.option_id
        WHERE o.post_id=v_post_id AND v.user_id=NEW.user_id AND NOT (TG_OP='UPDATE' AND v.option_id=v_old_option_id AND v.user_id=v_old_user_id)
    ) THEN RAISE EXCEPTION 'This poll allows one option per user' USING ERRCODE='23505'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_feed_poll_vote_integrity BEFORE INSERT OR UPDATE OR DELETE ON feed_poll_votes
FOR EACH ROW EXECUTE FUNCTION validate_feed_poll_vote();

CREATE OR REPLACE FUNCTION validate_feed_poll_configuration()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_has_votes boolean; v_option_count integer;
BEGIN
    SELECT count(*) INTO v_option_count FROM feed_poll_options WHERE post_id=NEW.post_id;
    IF v_option_count>NEW.max_options THEN
        RAISE EXCEPTION 'max_options cannot be lower than the current option count' USING ERRCODE='23514';
    END IF;
    IF ROW(NEW.allow_multiple,NEW.allow_vote_change,NEW.allow_vote_withdraw,NEW.anonymous_voting,NEW.results_visibility,NEW.max_options)
       IS DISTINCT FROM ROW(OLD.allow_multiple,OLD.allow_vote_change,OLD.allow_vote_withdraw,OLD.anonymous_voting,OLD.results_visibility,OLD.max_options) THEN
        SELECT EXISTS(SELECT 1 FROM feed_poll_votes v JOIN feed_poll_options o ON o.id=v.option_id WHERE o.post_id=NEW.post_id) INTO v_has_votes;
        IF v_has_votes THEN
            RAISE EXCEPTION 'Poll voting/privacy policy cannot change after the first vote' USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_feed_poll_configuration_integrity BEFORE UPDATE OF allow_multiple,allow_vote_change,allow_vote_withdraw,anonymous_voting,results_visibility,max_options ON feed_polls
FOR EACH ROW EXECUTE FUNCTION validate_feed_poll_configuration();

CREATE OR REPLACE FUNCTION prevent_poll_close_reopen()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.closed_at IS NOT NULL AND NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
        RAISE EXCEPTION 'A closed poll cannot be reopened or have its closure timestamp changed' USING ERRCODE='23514';
    END IF;
    IF OLD.closed_at IS NULL AND OLD.closes_at IS NOT NULL AND OLD.closes_at<=now()
       AND NEW.closes_at IS DISTINCT FROM OLD.closes_at AND NEW.closes_at>now() THEN
        RAISE EXCEPTION 'An elapsed poll cannot be reopened by extending closes_at' USING ERRCODE='23514';
    END IF;
    IF NEW.closed_at IS NOT NULL AND OLD.closed_at IS NULL THEN
        IF (SELECT count(*) FROM feed_poll_options WHERE post_id=NEW.post_id)<2 THEN
            RAISE EXCEPTION 'A poll must have at least two options before it can close' USING ERRCODE='23514';
        END IF;
        NEW.closed_at:=COALESCE(NEW.closed_at,now());
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_feed_poll_close_integrity BEFORE UPDATE OF closed_at,closes_at ON feed_polls
FOR EACH ROW EXECUTE FUNCTION prevent_poll_close_reopen();
CREATE OR REPLACE FUNCTION ensure_published_poll_has_options()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.post_type='POLL' AND NEW.status='PUBLISHED' THEN
        IF NOT EXISTS (SELECT 1 FROM feed_polls p WHERE p.post_id=NEW.id)
           OR (SELECT count(*) FROM feed_poll_options o WHERE o.post_id=NEW.id)<2 THEN
            RAISE EXCEPTION 'A poll post must have a poll and at least two options before publication' USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_published_poll_has_options BEFORE INSERT OR UPDATE OF post_type,status ON feed_posts
FOR EACH ROW EXECUTE FUNCTION ensure_published_poll_has_options();


-- Allocate per-room/per-conversation sequences under an atomic parent-row update.
CREATE OR REPLACE FUNCTION assign_chat_message_sequence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE chat_rooms SET last_message_seq=last_message_seq+1
      WHERE id=NEW.room_id AND is_active=true RETURNING last_message_seq INTO NEW.sequence_no;
    IF NOT FOUND THEN RAISE EXCEPTION 'Chat room is missing or inactive' USING ERRCODE='23514'; END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_assign_chat_message_sequence ON chat_messages;
CREATE TRIGGER trg_assign_chat_message_sequence BEFORE INSERT ON chat_messages
FOR EACH ROW EXECUTE FUNCTION assign_chat_message_sequence();

CREATE OR REPLACE FUNCTION assign_direct_message_sequence()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status dm_status; v_context text; v_request_sender uuid; v_request_business uuid; v_request_status dm_status;
BEGIN
    SELECT status,context_type INTO v_status,v_context FROM direct_conversations WHERE id=NEW.conversation_id FOR UPDATE;
    IF v_status='ACCEPTED' THEN
        UPDATE direct_conversations SET last_message_seq=last_message_seq+1 WHERE id=NEW.conversation_id
          RETURNING last_message_seq INTO NEW.sequence_no;
    ELSIF v_status='REQUESTED' AND v_context='GENERAL' AND NEW.message_request_id IS NOT NULL THEN
        SELECT sender_id,sender_business_account_id,status INTO v_request_sender,v_request_business,v_request_status
          FROM message_requests WHERE id=NEW.message_request_id AND conversation_id=NEW.conversation_id FOR SHARE;
        IF v_request_status IS DISTINCT FROM 'REQUESTED'
           OR v_request_sender IS DISTINCT FROM NEW.sender_id
           OR v_request_business IS DISTINCT FROM NEW.sender_business_account_id
           OR EXISTS (SELECT 1 FROM direct_messages WHERE message_request_id=NEW.message_request_id) THEN
            RAISE EXCEPTION 'Only one initial message may be sent for a pending message request' USING ERRCODE='23514';
        END IF;
        UPDATE direct_conversations SET last_message_seq=last_message_seq+1 WHERE id=NEW.conversation_id
          RETURNING last_message_seq INTO NEW.sequence_no;
    ELSE
        RAISE EXCEPTION 'Only accepted conversations or a pending request initial message can send messages' USING ERRCODE='23514';
    END IF;
    IF NEW.sequence_no IS NULL THEN RAISE EXCEPTION 'Direct conversation is missing' USING ERRCODE='23514'; END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_assign_direct_message_sequence ON direct_messages;
CREATE TRIGGER trg_assign_direct_message_sequence BEFORE INSERT ON direct_messages
FOR EACH ROW EXECUTE FUNCTION assign_direct_message_sequence();

-- Keep direct-message inbox activity/preview in sync with durable message rows.
-- The server remains responsible for adding the transactional outbox event in the same transaction.
CREATE OR REPLACE FUNCTION refresh_direct_conversation_activity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_last_seq bigint; v_preview text;
BEGIN
    SELECT last_message_seq INTO v_last_seq FROM direct_conversations WHERE id=NEW.conversation_id FOR UPDATE;
    IF TG_OP='INSERT' THEN
        v_preview := CASE
            WHEN NEW.deleted_at IS NOT NULL THEN '[Message removed]'
            WHEN NEW.message_type='MEDIA' THEN '[Media]'
            WHEN NEW.message_type='SYSTEM' THEN COALESCE(NULLIF(trim(NEW.body),''),'[System message]')
            ELSE left(regexp_replace(COALESCE(NEW.body,''), E'[\r\n\t]+', ' ', 'g'), 180)
        END;
        UPDATE direct_conversations
           SET last_message_at=now(), last_message_preview=v_preview, updated_at=now()
         WHERE id=NEW.conversation_id AND NEW.sequence_no=v_last_seq;
    ELSIF NEW.sequence_no=v_last_seq AND (
        NEW.body IS DISTINCT FROM OLD.body OR NEW.message_type IS DISTINCT FROM OLD.message_type
        OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
    ) THEN
        v_preview := CASE
            WHEN NEW.deleted_at IS NOT NULL THEN '[Message removed]'
            WHEN NEW.message_type='MEDIA' THEN '[Media]'
            WHEN NEW.message_type='SYSTEM' THEN COALESCE(NULLIF(trim(NEW.body),''),'[System message]')
            ELSE left(regexp_replace(COALESCE(NEW.body,''), E'[\r\n\t]+', ' ', 'g'), 180)
        END;
        UPDATE direct_conversations SET last_message_preview=v_preview,updated_at=now()
         WHERE id=NEW.conversation_id;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_direct_conversation_activity ON direct_messages;
CREATE TRIGGER trg_direct_conversation_activity
AFTER INSERT OR UPDATE OF body,message_type,deleted_at ON direct_messages
FOR EACH ROW EXECUTE FUNCTION refresh_direct_conversation_activity();

-- Read cursors are monotonic and cannot advance beyond the durable last-assigned sequence.
CREATE OR REPLACE FUNCTION validate_chat_room_read_cursor()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_max_seq bigint;
BEGIN
    SELECT last_message_seq INTO v_max_seq FROM chat_rooms WHERE id=NEW.room_id FOR UPDATE;
    IF v_max_seq IS NULL OR NEW.last_read_seq > v_max_seq THEN
        RAISE EXCEPTION 'Read cursor cannot exceed this room last message sequence' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND NEW.last_read_seq < OLD.last_read_seq THEN
        RAISE EXCEPTION 'Chat read cursor cannot move backwards' USING ERRCODE='23514';
    END IF;
    IF TG_OP='INSERT' THEN
        NEW.last_read_at:=COALESCE(NEW.last_read_at,now());
    ELSIF NEW.last_read_seq > OLD.last_read_seq THEN
        NEW.last_read_at:=now();
    ELSE
        NEW.last_read_at:=OLD.last_read_at;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_chat_room_read_cursor ON chat_room_user_state;
CREATE TRIGGER trg_chat_room_read_cursor BEFORE INSERT OR UPDATE OF room_id,last_read_seq ON chat_room_user_state
FOR EACH ROW EXECUTE FUNCTION validate_chat_room_read_cursor();

CREATE OR REPLACE FUNCTION validate_direct_conversation_read_cursor()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_max_seq bigint;
BEGIN
    SELECT last_message_seq INTO v_max_seq FROM direct_conversations WHERE id=NEW.conversation_id FOR UPDATE;
    IF v_max_seq IS NULL OR NEW.last_read_seq > v_max_seq THEN
        RAISE EXCEPTION 'Direct-message read cursor cannot exceed this conversation last message sequence' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND NEW.last_read_seq < OLD.last_read_seq THEN
        RAISE EXCEPTION 'Direct-message read cursor cannot move backwards' USING ERRCODE='23514';
    END IF;
    IF TG_OP='INSERT' THEN
        NEW.last_read_at:=COALESCE(NEW.last_read_at,now());
    ELSIF NEW.last_read_seq > OLD.last_read_seq THEN
        NEW.last_read_at:=now();
    ELSE
        NEW.last_read_at:=OLD.last_read_at;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_direct_conversation_read_cursor ON direct_conversation_participants;
CREATE TRIGGER trg_direct_conversation_read_cursor BEFORE INSERT OR UPDATE OF conversation_id,last_read_seq ON direct_conversation_participants
FOR EACH ROW EXECUTE FUNCTION validate_direct_conversation_read_cursor();

-- Standard updated_at trigger helper; attach only to mutable primary entities.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at=now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON profiles;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_communities_updated_at ON communities;
CREATE TRIGGER trg_communities_updated_at BEFORE UPDATE ON communities FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_country_categories_updated_at ON country_categories;
CREATE TRIGGER trg_country_categories_updated_at BEFORE UPDATE ON country_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_feed_posts_updated_at ON feed_posts;
CREATE TRIGGER trg_feed_posts_updated_at BEFORE UPDATE ON feed_posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_community_help_posts_updated_at ON community_help_posts;
CREATE TRIGGER trg_community_help_posts_updated_at BEFORE UPDATE ON community_help_posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_featured_items_updated_at ON featured_items;
CREATE TRIGGER trg_featured_items_updated_at BEFORE UPDATE ON featured_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_voice_rooms_updated_at ON voice_rooms;
CREATE TRIGGER trg_voice_rooms_updated_at BEFORE UPDATE ON voice_rooms FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_voice_room_sessions_updated_at ON voice_room_sessions;
CREATE TRIGGER trg_voice_room_sessions_updated_at BEFORE UPDATE ON voice_room_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_addresses_updated_at ON addresses;
CREATE TRIGGER trg_addresses_updated_at BEFORE UPDATE ON addresses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_interests_updated_at ON interests;
CREATE TRIGGER trg_interests_updated_at BEFORE UPDATE ON interests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_languages_updated_at ON languages;
CREATE TRIGGER trg_languages_updated_at BEFORE UPDATE ON languages FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_business_listings_updated_at ON business_listings;
CREATE TRIGGER trg_business_listings_updated_at BEFORE UPDATE ON business_listings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_business_locations_updated_at ON business_locations;
CREATE TRIGGER trg_business_locations_updated_at BEFORE UPDATE ON business_locations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_events_updated_at ON events;
CREATE TRIGGER trg_events_updated_at BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_job_listings_updated_at ON job_listings;
CREATE TRIGGER trg_job_listings_updated_at BEFORE UPDATE ON job_listings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_airports_updated_at ON airports;
CREATE TRIGGER trg_airports_updated_at BEFORE UPDATE ON airports FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_spare_bag_listings_updated_at ON spare_bag_listings;
CREATE TRIGGER trg_spare_bag_listings_updated_at BEFORE UPDATE ON spare_bag_listings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_spare_bag_contact_requests_updated_at ON spare_bag_contact_requests;
CREATE TRIGGER trg_spare_bag_contact_requests_updated_at BEFORE UPDATE ON spare_bag_contact_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_matchmaking_profiles_updated_at ON matchmaking_profiles;
CREATE TRIGGER trg_matchmaking_profiles_updated_at BEFORE UPDATE ON matchmaking_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_matchmaking_swipes_updated_at ON matchmaking_swipes;
CREATE TRIGGER trg_matchmaking_swipes_updated_at BEFORE UPDATE ON matchmaking_swipes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_matchmaking_preferences_updated_at ON matchmaking_preferences;
CREATE TRIGGER trg_matchmaking_preferences_updated_at BEFORE UPDATE ON matchmaking_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_matchmaking_matches_updated_at ON matchmaking_matches;
CREATE TRIGGER trg_matchmaking_matches_updated_at BEFORE UPDATE ON matchmaking_matches FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_job_categories_updated_at ON job_categories;
CREATE TRIGGER trg_job_categories_updated_at BEFORE UPDATE ON job_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_user_settings_updated_at ON user_settings;
CREATE TRIGGER trg_user_settings_updated_at BEFORE UPDATE ON user_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_memberships_updated_at ON community_memberships;
CREATE TRIGGER trg_memberships_updated_at BEFORE UPDATE ON community_memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_user_privacy_settings_updated_at ON user_privacy_settings;
CREATE TRIGGER trg_user_privacy_settings_updated_at BEFORE UPDATE ON user_privacy_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_chat_rooms_updated_at ON chat_rooms;
CREATE TRIGGER trg_chat_rooms_updated_at BEFORE UPDATE ON chat_rooms FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_chat_room_user_state_updated_at ON chat_room_user_state;
CREATE TRIGGER trg_chat_room_user_state_updated_at BEFORE UPDATE ON chat_room_user_state FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_direct_conversations_updated_at ON direct_conversations;
CREATE TRIGGER trg_direct_conversations_updated_at BEFORE UPDATE ON direct_conversations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_business_reviews_updated_at ON business_reviews;
CREATE TRIGGER trg_business_reviews_updated_at BEFORE UPDATE ON business_reviews FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_event_rsvps_updated_at ON event_rsvps;
CREATE TRIGGER trg_event_rsvps_updated_at BEFORE UPDATE ON event_rsvps FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_job_applications_updated_at ON job_applications;
CREATE TRIGGER trg_job_applications_updated_at BEFORE UPDATE ON job_applications FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_notification_preferences_updated_at ON notification_preferences;
CREATE TRIGGER trg_notification_preferences_updated_at BEFORE UPDATE ON notification_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_media_processing_jobs_updated_at ON media_processing_jobs;
CREATE TRIGGER trg_media_processing_jobs_updated_at BEFORE UPDATE ON media_processing_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_feed_post_comments_updated_at ON feed_post_comments;
CREATE TRIGGER trg_feed_post_comments_updated_at BEFORE UPDATE ON feed_post_comments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_feature_flags_updated_at ON feature_flags;
CREATE TRIGGER trg_feature_flags_updated_at BEFORE UPDATE ON feature_flags FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_feature_access_rules_updated_at ON feature_access_rules;
CREATE TRIGGER trg_feature_access_rules_updated_at BEFORE UPDATE ON feature_access_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON app_settings;
CREATE TRIGGER trg_app_settings_updated_at BEFORE UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_policy_documents_updated_at ON policy_documents;
CREATE TRIGGER trg_policy_documents_updated_at BEFORE UPDATE ON policy_documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_featured_placement_rules_updated_at BEFORE UPDATE ON featured_placement_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_device_tokens_updated_at BEFORE UPDATE ON device_tokens FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_notification_deliveries_updated_at BEFORE UPDATE ON notification_deliveries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Create baseline preferences/settings for every profile and ensure a selected community
-- is one the user actively belongs to. Onboarding adds membership before selecting it.
CREATE OR REPLACE FUNCTION bootstrap_profile_settings()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO user_settings(user_id) VALUES (NEW.id) ON CONFLICT(user_id) DO NOTHING;
    INSERT INTO user_privacy_settings(user_id) VALUES (NEW.id) ON CONFLICT(user_id) DO NOTHING;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_bootstrap_profile_settings ON profiles;
CREATE TRIGGER trg_bootstrap_profile_settings
AFTER INSERT ON profiles
FOR EACH ROW EXECUTE FUNCTION bootstrap_profile_settings();

CREATE OR REPLACE FUNCTION validate_user_settings_community_membership()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.default_community_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM community_memberships cm JOIN communities c ON c.id=cm.community_id
        WHERE cm.user_id=NEW.user_id AND cm.community_id=NEW.default_community_id
          AND cm.status='ACTIVE' AND c.is_active=true
    ) THEN
        RAISE EXCEPTION 'Default community must be an active membership' USING ERRCODE='23514';
    END IF;
    IF NEW.active_community_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM community_memberships cm JOIN communities c ON c.id=cm.community_id
        WHERE cm.user_id=NEW.user_id AND cm.community_id=NEW.active_community_id
          AND cm.status='ACTIVE' AND c.is_active=true
    ) THEN
        RAISE EXCEPTION 'Active community must be an active membership' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_user_settings_membership_integrity ON user_settings;
CREATE TRIGGER trg_user_settings_membership_integrity
BEFORE INSERT OR UPDATE OF user_id,default_community_id,active_community_id ON user_settings
FOR EACH ROW EXECUTE FUNCTION validate_user_settings_community_membership();

CREATE OR REPLACE FUNCTION clear_settings_when_membership_ends()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status <> 'ACTIVE' THEN
        UPDATE user_settings SET
            default_community_id=CASE WHEN default_community_id=NEW.community_id THEN NULL ELSE default_community_id END,
            active_community_id=CASE WHEN active_community_id=NEW.community_id THEN NULL ELSE active_community_id END,
            updated_at=now()
        WHERE user_id=NEW.user_id
          AND (default_community_id=NEW.community_id OR active_community_id=NEW.community_id);
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_clear_settings_on_membership_end ON community_memberships;
CREATE TRIGGER trg_clear_settings_on_membership_end
AFTER UPDATE OF status ON community_memberships
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION clear_settings_when_membership_ends();


-- =============================================================================
-- Required application/service invariants not expressible as simple FKs:
-- * Map Diasporum authentication identity by exact (issuer, subject); never trust a user id supplied by the client. Profiles and app roles live in the application DB, not in the IdP.
-- * On onboarding, resolve origin+destination community, create active membership and set user_settings defaults.
-- * Exactly one permanent General Chat per community; there is no permanent General Voice Room.
-- * Chat message sequence numbers are allocated by atomic parent-row counter updates. `last_read_seq` is a monotonic per-user cursor;
--   calculate unread messages using sequence_no > last_read_seq and exclude the viewer's own messages if product semantics require it.
-- * Ably delivers committed outbox events only. PostgreSQL and REST remain the durable source of truth for messages and reconnect recovery.
-- * country_categories are practical-life topics used by FEED and optional event topic links only when mapped; jobs, event types,
--   business categories, voice-room topics and Spare Bag parcel categories use their own taxonomies.
-- * Job listing source (employer/recruiter/community/aggregator) is independent of the application route (internal/external). A published job
--   requires a primary job-specific category. Validate all external URLs in Spring Boot and permit only http/https schemes.
-- * `addresses.visibility` is enforced in API/service authorization. Business directory addresses must be public; matchmaking location
--   addresses must remain private; Spare Bag collection/handover addresses are non-public and disclosed only to authorised parties.
-- * `profiles.date_of_birth` is the source for age, never a stored `matchmaking_profiles.age`. Discovery/swipes/match creation require an adult
--   account, age confirmation, active matchmaking profile and discovery permission. Matched-chat access requires both matched participants to remain
--   adults and the match to remain active, but pausing discovery does not by itself terminate existing matched conversations.
--   For stronger assurance, age-confirmation must be backed by an appropriate verification process. SQL triggers block ineligible writes but do not
--   replace backend authorization on SELECT/API routes.
-- * Matching uses all preferences bilaterally. A swipe is unique and immutable; a mutual LIKE creates one normalized pair match and an ACCEPTED
--   direct conversation. Names/photos for BLURRED/HIDDEN settings must never return original values/URLs in discovery DTOs; private media remains
--   protected by signed, short-lived authorization. Verification means matchmaking profile verification, not mere email verification.
-- * A block closes affected matchmaking matches/conversations, removes swipes, and is checked in both directions on every read/write. Reports
--   use the shared moderation queue; don't expose the reporter to the reported user.
-- * Voice-room host counts toward max_speakers. Active participant admission and promotions serialize on the voice-session row; each live session
--   has exactly max_speakers stage slots; only active host/room moderators may approve speaker requests. Role changes require a backend permission
--   check and audit event. A participant leaves by setting left_at, and rejoining creates a new participation row.
-- * Spare Bag: listing market country is derived from origin_airport_id -> airports.country_id; public discovery must never disclose private address IDs/details; contact requests
--   must pair published sender/passenger listings with compatible routes and dates, different owners and appropriate visibility. No escrow/payment service implied.
-- * Visibility scope defaults to COMMUNITY for community content; COUNTRY must be explicitly selected. Scope and classification remain separate.
-- * Database access is private to application services. Add and test row-level security before ever allowing direct client database access.
-- =============================================================================


-- ============================================================================
-- V10.0 ADDITIVE DESIGN UPDATE (clean-install candidate; based on v9.0)
-- Includes property/vehicle marketplaces, audience scopes, business workspaces,
-- configurable billing/entitlements and scoped marketplace listings.
-- Not an in-place migration. Review and execute against clean PostgreSQL staging.
-- ============================================================================

-- 1. Extend the common audience scope. Country is always the maximum boundary.

-- Property types: global canonical types with country-specific availability/labels.
CREATE TABLE property_types (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type_key text NOT NULL UNIQUE CHECK(type_key=upper(trim(type_key)) AND type_key ~ '^[A-Z0-9_]+$'),
    default_name text NOT NULL CHECK(length(trim(default_name)) BETWEEN 1 AND 120),
    parent_type_id uuid REFERENCES property_types(id) ON DELETE RESTRICT,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(parent_type_id IS NULL OR parent_type_id <> id)
);
CREATE TABLE country_property_types (
    country_id uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
    property_type_id uuid NOT NULL REFERENCES property_types(id) ON DELETE RESTRICT,
    local_name text NOT NULL CHECK(length(trim(local_name)) BETWEEN 1 AND 120),
    description text,
    is_enabled boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(country_id,property_type_id),
    UNIQUE(country_id,local_name)
);
CREATE INDEX ix_country_property_types_enabled ON country_property_types(country_id,sort_order) WHERE is_enabled;

-- Business workspace: one account can manage multiple public business profiles.
CREATE TABLE business_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_name text NOT NULL CHECK(length(trim(account_name)) BETWEEN 1 AND 180),
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED','CLOSED')),
    updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    closure_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz,
    CHECK((status='CLOSED') = (closed_at IS NOT NULL))
);
CREATE OR REPLACE FUNCTION normalize_business_account_lifecycle_fields()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status='CLOSED' THEN NEW.closed_at:=COALESCE(NEW.closed_at,now()); ELSE NEW.closed_at:=NULL; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_normalize_business_account_lifecycle BEFORE INSERT OR UPDATE OF status,closed_at ON business_accounts
FOR EACH ROW EXECUTE FUNCTION normalize_business_account_lifecycle_fields();
CREATE TABLE business_account_members (
    business_account_id uuid NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_key text NOT NULL CHECK(role_key IN ('OWNER','ADMINISTRATOR','EDITOR','LISTING_MANAGER','BILLING_MANAGER')),
    invited_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    accepted_at timestamptz,
    invitation_expires_at timestamptz,
    revoked_at timestamptz,
    revoked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    revocation_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(business_account_id,user_id),
    CHECK(invitation_expires_at IS NULL OR invitation_expires_at > created_at),
    CHECK(revoked_at IS NULL OR accepted_at IS NULL OR revoked_at >= accepted_at)
);
CREATE UNIQUE INDEX ux_business_account_active_owner
    ON business_account_members(business_account_id)
    WHERE role_key='OWNER' AND accepted_at IS NOT NULL AND revoked_at IS NULL;
CREATE INDEX ix_business_account_members_user
    ON business_account_members(user_id,business_account_id)
    WHERE accepted_at IS NOT NULL AND revoked_at IS NULL;
CREATE TRIGGER trg_business_accounts_updated_at BEFORE UPDATE ON business_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_business_account_members_updated_at BEFORE UPDATE ON business_account_members FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Business role capabilities are fixed application policies in the businessaccounts module.
-- No database-driven permissions matrix is maintained.

CREATE TABLE business_account_audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_account_id uuid REFERENCES business_accounts(id) ON DELETE SET NULL,
    account_name_snapshot text NOT NULL,
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    action_key text NOT NULL,
    reason text,
    before_state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(before_state)='object'),
    after_state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(after_state)='object'),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_business_account_audit_recent ON business_account_audit_events(business_account_id,created_at DESC);
CREATE OR REPLACE FUNCTION audit_business_account_membership()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_account uuid; v_user uuid; v_actor uuid; v_name text; v_action text; v_old jsonb:='{}'::jsonb; v_new jsonb:='{}'::jsonb;
BEGIN
    IF TG_OP='DELETE' THEN
        v_account:=OLD.business_account_id; v_user:=OLD.user_id;
        v_actor:=COALESCE(OLD.updated_by_user_id,OLD.revoked_by_user_id,OLD.invited_by_user_id);
        v_old:=to_jsonb(OLD); v_action:='MEMBER_ROW_DELETED';
    ELSE
        v_account:=NEW.business_account_id; v_user:=NEW.user_id;
        v_actor:=COALESCE(NEW.updated_by_user_id,NEW.revoked_by_user_id,NEW.invited_by_user_id);
        v_new:=to_jsonb(NEW);
        IF TG_OP='INSERT' THEN
            v_action:=CASE WHEN NEW.role_key='OWNER' THEN 'INITIAL_OWNER_ASSIGNED' WHEN NEW.accepted_at IS NULL THEN 'MEMBER_INVITED' ELSE 'MEMBER_ADDED' END;
            v_old:='{}'::jsonb;
        ELSE
            IF OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL THEN v_action:='INVITATION_ACCEPTED';
            ELSIF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN v_action:='MEMBER_REVOKED';
            ELSIF OLD.role_key IS DISTINCT FROM NEW.role_key THEN v_action:='MEMBER_ROLE_CHANGED';
            ELSE v_action:='MEMBERSHIP_UPDATED'; END IF;
            v_old:=to_jsonb(OLD);
        END IF;
    END IF;
    SELECT account_name INTO v_name FROM business_accounts WHERE id=v_account;
    INSERT INTO business_account_audit_events(business_account_id,account_name_snapshot,actor_user_id,target_user_id,action_key,before_state,after_state)
    VALUES(v_account,COALESCE(v_name,'Deleted Business Account'),v_actor,v_user,v_action,v_old,v_new);
    RETURN NULL;
END;
$$;
CREATE TRIGGER trg_audit_business_account_membership AFTER INSERT OR UPDATE OR DELETE ON business_account_members
FOR EACH ROW EXECUTE FUNCTION audit_business_account_membership();

CREATE OR REPLACE FUNCTION audit_business_account_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_action text;
BEGIN
    IF TG_OP='INSERT' THEN
       INSERT INTO business_account_audit_events(business_account_id,account_name_snapshot,actor_user_id,action_key,after_state)
       VALUES(NEW.id,NEW.account_name,NEW.created_by_user_id,'ACCOUNT_CREATED',to_jsonb(NEW));
       RETURN NEW;
    END IF;
    IF OLD.status IS DISTINCT FROM NEW.status THEN v_action:='ACCOUNT_STATUS_CHANGED'; ELSIF OLD.account_name IS DISTINCT FROM NEW.account_name THEN v_action:='ACCOUNT_NAME_CHANGED'; ELSE v_action:='ACCOUNT_UPDATED'; END IF;
    INSERT INTO business_account_audit_events(business_account_id,account_name_snapshot,actor_user_id,action_key,reason,before_state,after_state)
    VALUES(NEW.id,NEW.account_name,COALESCE(NEW.updated_by_user_id,NEW.created_by_user_id),v_action,NEW.closure_reason,to_jsonb(OLD),to_jsonb(NEW));
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_audit_business_account_lifecycle AFTER INSERT OR UPDATE ON business_accounts
FOR EACH ROW EXECUTE FUNCTION audit_business_account_lifecycle();
CREATE OR REPLACE FUNCTION revoke_business_members_on_close()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status='CLOSED' AND OLD.status IS DISTINCT FROM 'CLOSED' THEN
        UPDATE business_account_members SET revoked_at=COALESCE(revoked_at,now()),
            revoked_by_user_id=COALESCE(revoked_by_user_id,NEW.updated_by_user_id),
            revocation_reason=COALESCE(revocation_reason,NEW.closure_reason,'Business Account closed'),
            updated_by_user_id=NEW.updated_by_user_id,updated_at=now()
        WHERE business_account_id=NEW.id AND revoked_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_revoke_business_members_on_close AFTER UPDATE OF status ON business_accounts
FOR EACH ROW EXECUTE FUNCTION revoke_business_members_on_close();



-- Business-side inbox/read-state rows are per active business member. Membership is checked on every API request too.
CREATE OR REPLACE FUNCTION sync_business_conversation_membership()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_account uuid; v_user uuid; v_active boolean;
BEGIN
    IF TG_OP='DELETE' THEN v_account:=OLD.business_account_id; v_user:=OLD.user_id; v_active:=false;
    ELSE v_account:=NEW.business_account_id; v_user:=NEW.user_id; v_active:=(NEW.accepted_at IS NOT NULL AND NEW.revoked_at IS NULL); END IF;
    IF v_active THEN
        INSERT INTO direct_conversation_participants(conversation_id,side,user_id)
        SELECT dc.id,'A',v_user FROM direct_conversations dc WHERE dc.participant_a_business_account_id=v_account
        ON CONFLICT(conversation_id,side,user_id) DO UPDATE SET archived_at=NULL;
        INSERT INTO direct_conversation_participants(conversation_id,side,user_id)
        SELECT dc.id,'B',v_user FROM direct_conversations dc WHERE dc.participant_b_business_account_id=v_account
        ON CONFLICT(conversation_id,side,user_id) DO UPDATE SET archived_at=NULL;
    ELSE
        UPDATE direct_conversation_participants SET archived_at=COALESCE(archived_at,now())
        WHERE user_id=v_user AND ((side='A' AND conversation_id IN (SELECT id FROM direct_conversations WHERE participant_a_business_account_id=v_account))
          OR (side='B' AND conversation_id IN (SELECT id FROM direct_conversations WHERE participant_b_business_account_id=v_account)));
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER trg_sync_business_conversation_membership
AFTER INSERT OR UPDATE OR DELETE ON business_account_members
FOR EACH ROW EXECUTE FUNCTION sync_business_conversation_membership();

ALTER TABLE direct_conversations ADD CONSTRAINT fk_direct_conversation_business_a
  FOREIGN KEY(participant_a_business_account_id) REFERENCES business_accounts(id) ON DELETE RESTRICT;
ALTER TABLE direct_conversations ADD CONSTRAINT fk_direct_conversation_business_b
  FOREIGN KEY(participant_b_business_account_id) REFERENCES business_accounts(id) ON DELETE RESTRICT;
ALTER TABLE direct_messages ADD CONSTRAINT fk_direct_message_sender_business
  FOREIGN KEY(sender_business_account_id) REFERENCES business_accounts(id) ON DELETE RESTRICT;
ALTER TABLE message_requests ADD CONSTRAINT fk_message_request_sender_business
  FOREIGN KEY(sender_business_account_id) REFERENCES business_accounts(id) ON DELETE RESTRICT;
ALTER TABLE message_requests ADD CONSTRAINT fk_message_request_recipient_business
  FOREIGN KEY(recipient_business_account_id) REFERENCES business_accounts(id) ON DELETE RESTRICT;


-- A Business Account is a workspace, not a separate login. Its creator becomes its first owner.
CREATE OR REPLACE FUNCTION require_business_account_creator()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.created_by_user_id IS NULL THEN
        RAISE EXCEPTION 'A Business Account must be created by an authenticated profile'
          USING ERRCODE='23502';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_business_account_creator_required
BEFORE INSERT ON business_accounts FOR EACH ROW
EXECUTE FUNCTION require_business_account_creator();

CREATE OR REPLACE FUNCTION bootstrap_business_account_owner()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO business_account_members(business_account_id,user_id,role_key,invited_by_user_id,updated_by_user_id,accepted_at)
    VALUES(NEW.id,NEW.created_by_user_id,'OWNER',NEW.created_by_user_id,NEW.created_by_user_id,now());
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_business_account_initial_owner
AFTER INSERT ON business_accounts FOR EACH ROW
EXECUTE FUNCTION bootstrap_business_account_owner();

-- The account/user pair is an immutable membership identity. Re-invite/rejoin by reactivating
-- the row so role history and the composite primary key remain stable.
CREATE OR REPLACE FUNCTION prevent_business_membership_identity_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.business_account_id IS DISTINCT FROM OLD.business_account_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'Business membership identity cannot be changed; revoke and create a new membership instead'
          USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_business_membership_identity_immutable
BEFORE UPDATE OF business_account_id,user_id ON business_account_members
FOR EACH ROW EXECUTE FUNCTION prevent_business_membership_identity_change();
CREATE OR REPLACE FUNCTION validate_business_membership_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_account_status text;
BEGIN
    SELECT status INTO v_account_status FROM business_accounts WHERE id=NEW.business_account_id FOR UPDATE;
    IF v_account_status IS NULL OR (v_account_status='CLOSED' AND NOT (TG_OP='UPDATE' AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)) THEN
        RAISE EXCEPTION 'Cannot add or change membership for a closed Business Account except to revoke access during closure' USING ERRCODE='23514';
    END IF;
    IF NEW.accepted_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
        -- Revoking a pending invitation is valid and remains auditable.
        NULL;
    ELSIF NEW.accepted_at IS NULL AND NEW.invitation_expires_at IS NOT NULL AND NEW.invitation_expires_at<=now() THEN
        RAISE EXCEPTION 'Expired Business Account invitations cannot be accepted' USING ERRCODE='23514';
    END IF;
    IF NEW.role_key='OWNER' AND NEW.accepted_at IS NULL THEN
        RAISE EXCEPTION 'An OWNER membership must be accepted' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_business_membership_lifecycle BEFORE INSERT OR UPDATE OF role_key,accepted_at,revoked_at,invitation_expires_at,business_account_id ON business_account_members
FOR EACH ROW EXECUTE FUNCTION validate_business_membership_lifecycle();


-- Require at least one accepted, unrevoked OWNER for every non-closed workspace.
-- Deferred checks allow an owner transfer to demote/revoke the old owner and promote
-- the new one in a single transaction, without a transient ownerless account at commit.
CREATE OR REPLACE FUNCTION assert_business_account_has_owner_from_member()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_account_id uuid; v_status text;
BEGIN
    IF TG_OP='DELETE' THEN v_account_id := OLD.business_account_id;
    ELSE v_account_id := NEW.business_account_id;
    END IF;
    SELECT status INTO v_status FROM business_accounts WHERE id=v_account_id;
    IF v_status IN ('ACTIVE','SUSPENDED') AND NOT EXISTS (
        SELECT 1 FROM business_account_members m
        WHERE m.business_account_id=v_account_id AND m.role_key='OWNER'
          AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL
    ) THEN
        RAISE EXCEPTION 'An ACTIVE or SUSPENDED Business Account must have an accepted active OWNER'
          USING ERRCODE='23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_business_account_owner_member_check
AFTER INSERT OR UPDATE OR DELETE ON business_account_members
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION assert_business_account_has_owner_from_member();

CREATE OR REPLACE FUNCTION assert_business_account_has_owner_from_account()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status IN ('ACTIVE','SUSPENDED') AND NOT EXISTS (
        SELECT 1 FROM business_account_members m
        WHERE m.business_account_id=NEW.id AND m.role_key='OWNER'
          AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL
    ) THEN
        RAISE EXCEPTION 'An ACTIVE or SUSPENDED Business Account must have an accepted active OWNER'
          USING ERRCODE='23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_business_account_owner_status_check
AFTER INSERT OR UPDATE ON business_accounts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION assert_business_account_has_owner_from_account();

-- A public business profile belongs to exactly one ownership context. Address/location
-- details are stored in business_locations -> addresses; do not duplicate city/postcode here.
ALTER TABLE business_listings ADD COLUMN business_account_id uuid REFERENCES business_accounts(id) ON DELETE RESTRICT;
ALTER TABLE business_listings ADD COLUMN visibility_scope visibility_scope NOT NULL DEFAULT 'COUNTRY';
ALTER TABLE business_listings ADD COLUMN community_id uuid REFERENCES communities(id) ON DELETE RESTRICT;
ALTER TABLE business_listings ADD COLUMN created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE business_listings ADD CONSTRAINT ck_business_listing_owner_context
CHECK (((owner_user_id IS NOT NULL)::int + (business_account_id IS NOT NULL)::int) = 1);
CREATE INDEX ix_business_listings_account ON business_listings(business_account_id,status,created_at DESC)
    WHERE business_account_id IS NOT NULL AND deleted_at IS NULL;
ALTER TABLE business_listings ADD CONSTRAINT ck_business_listing_visibility_v10 CHECK (
 (visibility_scope='COMMUNITY' AND community_id IS NOT NULL) OR
 (visibility_scope IN ('COUNTRY','SELECTED_COMMUNITIES') AND community_id IS NULL));
CREATE TABLE business_listing_communities (
    business_listing_id uuid NOT NULL REFERENCES business_listings(id) ON DELETE CASCADE,
    community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(business_listing_id,community_id)
);
CREATE INDEX ix_business_listing_communities_community ON business_listing_communities(community_id,business_listing_id);

-- Event and job ownership must point directly to the account workspace, not only to a
-- particular public business profile. The creator/poster remains separately auditable.
ALTER TABLE events ADD COLUMN owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE events ADD COLUMN business_account_id uuid REFERENCES business_accounts(id) ON DELETE RESTRICT;
ALTER TABLE events ADD COLUMN created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE events ADD CONSTRAINT ck_event_owner_context
CHECK (((owner_user_id IS NOT NULL)::int + (business_account_id IS NOT NULL)::int) = 1);
CREATE INDEX ix_events_business_account ON events(business_account_id,status,starts_at DESC)
    WHERE business_account_id IS NOT NULL;

ALTER TABLE job_listings ADD COLUMN owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE job_listings ADD COLUMN business_account_id uuid REFERENCES business_accounts(id) ON DELETE RESTRICT;
ALTER TABLE job_listings ADD CONSTRAINT ck_job_owner_context CHECK (
    (source_type IN ('EXTERNAL_AGGREGATOR','PLATFORM_EDITOR')
      AND ((owner_user_id IS NOT NULL)::int + (business_account_id IS NOT NULL)::int) <= 1)
    OR
    (source_type NOT IN ('EXTERNAL_AGGREGATOR','PLATFORM_EDITOR')
      AND ((owner_user_id IS NOT NULL)::int + (business_account_id IS NOT NULL)::int) = 1)
);
CREATE INDEX ix_jobs_business_account ON job_listings(business_account_id,status,created_at DESC)
    WHERE business_account_id IS NOT NULL;

-- 10.7 Service marketplace: lead generation and contact only; no booking, escrow, on-platform service payment or scheduling.
CREATE TABLE service_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id uuid REFERENCES service_categories(id) ON DELETE SET NULL,
    category_key text NOT NULL UNIQUE CHECK(category_key=upper(trim(category_key)) AND category_key ~ '^[A-Z0-9_]+$'),
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_service_categories_active ON service_categories(is_active,sort_order);
CREATE TABLE service_category_translations (
    service_category_id uuid NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
    language_id uuid NOT NULL REFERENCES languages(id) ON DELETE RESTRICT,
    display_name text NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 140),
    description text CHECK(description IS NULL OR length(description)<=2000),
    PRIMARY KEY(service_category_id,language_id)
);

-- A provider is owned by exactly one personal profile OR one Business Account and has one base point + editable radius.
CREATE TABLE service_providers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    business_account_id uuid REFERENCES business_accounts(id) ON DELETE CASCADE,
    display_name text NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 180),
    description text CHECK(description IS NULL OR length(description)<=6000),
    base_location geography(Point,4326) NOT NULL,
    radius_km numeric(7,2) NOT NULL DEFAULT 25 CHECK(radius_km BETWEEN 1 AND 300),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','PAUSED','SUSPENDED','CLOSED')),
    verification_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK(verification_status IN ('UNVERIFIED','PENDING','VERIFIED','REJECTED','REVOKED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK((owner_user_id IS NOT NULL)::int + (business_account_id IS NOT NULL)::int = 1)
);
CREATE UNIQUE INDEX ux_service_provider_personal_owner ON service_providers(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE UNIQUE INDEX ux_service_provider_business_owner ON service_providers(business_account_id) WHERE business_account_id IS NOT NULL;
CREATE INDEX ix_service_provider_location ON service_providers USING gist(base_location);
CREATE INDEX ix_service_provider_status ON service_providers(status,verification_status,created_at DESC);
CREATE TABLE service_provider_services (
    service_provider_id uuid NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
    service_category_id uuid NOT NULL REFERENCES service_categories(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(service_provider_id,service_category_id)
);
CREATE INDEX ix_service_provider_services_category ON service_provider_services(service_category_id,service_provider_id);

CREATE TABLE service_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_category_id uuid NOT NULL REFERENCES service_categories(id) ON DELETE RESTRICT,
    country_id uuid NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
    address_id uuid REFERENCES addresses(id) ON DELETE RESTRICT,
    -- Store an approximate/service area point here; never expose exact private address data before access is granted.
    location geography(Point,4326) NOT NULL,
    title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 220),
    description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 12000),
    budget_min numeric(12,2) CHECK(budget_min IS NULL OR budget_min>=0),
    budget_max numeric(12,2) CHECK(budget_max IS NULL OR budget_max>=0),
    currency_code char(3) CHECK(currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
    preferred_date date,
    status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','OPEN','PAUSED','CANCELLED','CLOSED','EXPIRED','REMOVED')),
    expires_at timestamptz,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CHECK(budget_min IS NULL OR budget_max IS NULL OR budget_max>=budget_min),
    CHECK((budget_min IS NULL AND budget_max IS NULL AND currency_code IS NULL) OR currency_code IS NOT NULL),
    CHECK(expires_at IS NULL OR expires_at>created_at)
);
CREATE INDEX ix_service_request_discovery ON service_requests(status,country_id,service_category_id,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_service_request_location ON service_requests USING gist(location) WHERE status='OPEN' AND deleted_at IS NULL;
CREATE INDEX ix_service_request_budget ON service_requests(currency_code,budget_min,budget_max,status) WHERE status='OPEN' AND deleted_at IS NULL;
CREATE INDEX ix_service_request_customer ON service_requests(customer_user_id,status,created_at DESC) WHERE deleted_at IS NULL;
CREATE TABLE service_request_media (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_request_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE RESTRICT,
    sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order>=0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(service_request_id,media_id), UNIQUE(service_request_id,sort_order)
);

CREATE TABLE service_request_responses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_request_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    service_provider_id uuid NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
    responded_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    response_type text NOT NULL CHECK(response_type IN ('INTEREST','QUOTE','CONTACT')),
    message text CHECK(message IS NULL OR length(message)<=6000),
    quoted_amount numeric(12,2) CHECK(quoted_amount IS NULL OR quoted_amount>=0),
    currency_code char(3) CHECK(currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
    status text NOT NULL DEFAULT 'SENT' CHECK(status IN ('SENT','WITHDRAWN','ACCEPTED','DECLINED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK((quoted_amount IS NULL AND currency_code IS NULL) OR (quoted_amount IS NOT NULL AND currency_code IS NOT NULL)),
    UNIQUE(service_request_id,service_provider_id)
);
CREATE INDEX ix_service_responses_request ON service_request_responses(service_request_id,status,created_at DESC);
CREATE INDEX ix_service_responses_provider ON service_request_responses(service_provider_id,status,created_at DESC);

-- One provider/job lead access row only. Chat and contact-detail grants can both be enabled later without a second charge.
CREATE TABLE service_lead_access (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_request_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    service_provider_id uuid NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
    chat_enabled boolean NOT NULL DEFAULT false,
    contact_details_unlocked boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED')),
    billing_usage_record_id uuid NOT NULL UNIQUE,
    granted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    accessed_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    UNIQUE(service_request_id,service_provider_id),
    CHECK(chat_enabled OR contact_details_unlocked OR status='REVOKED'),
    CHECK((status='REVOKED' AND revoked_at IS NOT NULL) OR (status='ACTIVE' AND revoked_at IS NULL))
);
CREATE INDEX ix_service_lead_access_provider ON service_lead_access(service_provider_id,status,accessed_at DESC);

CREATE TABLE service_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_request_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_provider_id uuid NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
    rating smallint NOT NULL CHECK(rating BETWEEN 1 AND 5),
    review_text text CHECK(review_text IS NULL OR length(review_text)<=6000),
    status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PUBLISHED','HIDDEN','REJECTED')),
    provider_response text CHECK(provider_response IS NULL OR length(provider_response)<=4000),
    provider_response_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    provider_responded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(service_request_id,reviewer_user_id,service_provider_id)
);
CREATE INDEX ix_service_reviews_provider ON service_reviews(service_provider_id,status,created_at DESC);
CREATE INDEX ix_service_reviews_request ON service_reviews(service_request_id,status,created_at DESC);

CREATE TABLE service_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type text NOT NULL CHECK(target_type IN ('SERVICE_REQUEST','SERVICE_PROVIDER','SERVICE_REVIEW')),
    target_id uuid NOT NULL,
    reason_code text NOT NULL CHECK(reason_code IN ('SPAM','SCAM','HARASSMENT','MISLEADING','UNSAFE','OTHER')),
    description text CHECK(description IS NULL OR length(description)<=5000),
    status report_status NOT NULL DEFAULT 'OPEN',
    assigned_admin_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
    resolution_note text CHECK(resolution_note IS NULL OR length(resolution_note)<=4000)
);
CREATE INDEX ix_service_reports_review_queue ON service_reports(status,created_at DESC);
CREATE INDEX ix_service_reports_target ON service_reports(target_type,target_id,created_at DESC);
CREATE TABLE service_moderation_actions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id uuid REFERENCES service_reports(id) ON DELETE SET NULL,
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    target_type text NOT NULL CHECK(target_type IN ('SERVICE_REQUEST','SERVICE_PROVIDER','SERVICE_REVIEW')),
    target_id uuid NOT NULL,
    action_key text NOT NULL CHECK(action_key IN ('REVIEWED','HIDE','RESTORE','REMOVE','WARN','SUSPEND_PROVIDER','DISMISS_REPORT')),
    reason text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object'),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_service_moderation_target ON service_moderation_actions(target_type,target_id,created_at DESC);

CREATE OR REPLACE FUNCTION validate_service_request_response()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text; v_customer uuid; v_provider_status text; v_owner_user uuid; v_owner_business uuid;
BEGIN
    SELECT status,customer_user_id INTO v_status,v_customer FROM service_requests WHERE id=NEW.service_request_id;
    SELECT status,owner_user_id,business_account_id INTO v_provider_status,v_owner_user,v_owner_business FROM service_providers WHERE id=NEW.service_provider_id;
    IF v_status IS NULL OR v_provider_status IS NULL THEN RAISE EXCEPTION 'Service request and provider must exist' USING ERRCODE='23503'; END IF;
    IF v_status<>'OPEN' AND NOT (TG_OP='UPDATE' AND OLD.service_request_id=NEW.service_request_id AND OLD.service_provider_id=NEW.service_provider_id) THEN
       RAISE EXCEPTION 'A new provider response requires an open service request' USING ERRCODE='23514';
    END IF;
    IF v_provider_status<>'ACTIVE' THEN RAISE EXCEPTION 'Only active service providers may respond' USING ERRCODE='23514'; END IF;
    IF v_owner_user=v_customer OR (v_owner_business IS NOT NULL AND EXISTS (SELECT 1 FROM business_account_members m WHERE m.business_account_id=v_owner_business AND m.user_id=v_customer AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL)) THEN
       RAISE EXCEPTION 'A customer or member of their business cannot respond to their own service request' USING ERRCODE='23514';
    END IF;
    IF (v_owner_user IS NOT NULL AND NEW.responded_by_user_id<>v_owner_user) OR
       (v_owner_business IS NOT NULL AND NOT EXISTS (SELECT 1 FROM business_account_members m WHERE m.business_account_id=v_owner_business AND m.user_id=NEW.responded_by_user_id AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL)) THEN
       RAISE EXCEPTION 'Response actor must own the personal provider profile or be an active member of the provider Business Account' USING ERRCODE='23514';
    END IF;
    IF NEW.response_type='QUOTE' AND NEW.quoted_amount IS NULL THEN
       RAISE EXCEPTION 'A quote response requires a quoted amount and currency' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_service_request_response BEFORE INSERT OR UPDATE OF service_request_id,service_provider_id,responded_by_user_id,response_type,quoted_amount,currency_code,status
ON service_request_responses FOR EACH ROW EXECUTE FUNCTION validate_service_request_response();

CREATE OR REPLACE FUNCTION validate_service_lead_access()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text; v_customer uuid; v_provider_status text; v_owner_user uuid;
BEGIN
    SELECT status,customer_user_id INTO v_status,v_customer FROM service_requests WHERE id=NEW.service_request_id;
    SELECT status,owner_user_id INTO v_provider_status,v_owner_user FROM service_providers WHERE id=NEW.service_provider_id;
    IF v_status IS NULL OR v_provider_status IS NULL THEN RAISE EXCEPTION 'Service request and provider must exist' USING ERRCODE='23503'; END IF;
    IF TG_OP='UPDATE' AND NEW.billing_usage_record_id IS DISTINCT FROM OLD.billing_usage_record_id THEN
       RAISE EXCEPTION 'A service lead access cannot be reassigned to a different billing usage record; reuse its original charge/idempotency record' USING ERRCODE='23514';
    END IF;
    IF NEW.status='ACTIVE' AND (v_status NOT IN ('OPEN','PAUSED') OR v_provider_status<>'ACTIVE') THEN
       RAISE EXCEPTION 'Granting lead access requires an active provider and an open or paused request' USING ERRCODE='23514';
    END IF;
    IF v_owner_user=v_customer OR EXISTS (SELECT 1 FROM service_providers p JOIN business_account_members m ON m.business_account_id=p.business_account_id WHERE p.id=NEW.service_provider_id AND m.user_id=v_customer AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL) THEN
       RAISE EXCEPTION 'A customer or member of their business cannot access their own lead' USING ERRCODE='23514';
    END IF;
    IF NEW.status='ACTIVE' AND NEW.granted_by_user_id IS NOT NULL AND ((v_owner_user IS NOT NULL AND NEW.granted_by_user_id<>v_owner_user) OR
       (v_provider_status IS NOT NULL AND EXISTS (SELECT 1 FROM service_providers p WHERE p.id=NEW.service_provider_id AND p.business_account_id IS NOT NULL) AND
        NOT EXISTS (SELECT 1 FROM service_providers p JOIN business_account_members m ON m.business_account_id=p.business_account_id WHERE p.id=NEW.service_provider_id AND m.user_id=NEW.granted_by_user_id AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL))) THEN
       RAISE EXCEPTION 'Lead access actor must be the provider owner or an active business member' USING ERRCODE='23514';
    END IF;
    IF NEW.status='ACTIVE' AND NOT (NEW.chat_enabled OR NEW.contact_details_unlocked) THEN
       RAISE EXCEPTION 'Active lead access must grant chat or contact details' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_service_lead_access BEFORE INSERT OR UPDATE OF service_request_id,service_provider_id,chat_enabled,contact_details_unlocked,status,billing_usage_record_id
ON service_lead_access FOR EACH ROW EXECUTE FUNCTION validate_service_lead_access();

CREATE OR REPLACE FUNCTION validate_service_review()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_customer uuid;
BEGIN
    SELECT customer_user_id INTO v_customer FROM service_requests WHERE id=NEW.service_request_id;
    IF v_customer IS NULL THEN RAISE EXCEPTION 'Review service request must exist' USING ERRCODE='23503'; END IF;
    IF NEW.reviewer_user_id<>v_customer THEN RAISE EXCEPTION 'Only the customer who posted this service request may review a provider' USING ERRCODE='23514'; END IF;
    IF NOT EXISTS (SELECT 1 FROM service_lead_access a WHERE a.service_request_id=NEW.service_request_id
        AND a.service_provider_id=NEW.service_provider_id AND a.status='ACTIVE')
       AND NOT EXISTS (SELECT 1 FROM service_request_responses r WHERE r.service_request_id=NEW.service_request_id
        AND r.service_provider_id=NEW.service_provider_id AND r.status IN ('SENT','ACCEPTED')) THEN
       RAISE EXCEPTION 'A review requires a recorded interaction with the provider' USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM service_providers p WHERE p.id=NEW.service_provider_id AND (p.owner_user_id=NEW.reviewer_user_id OR (p.business_account_id IS NOT NULL AND EXISTS (SELECT 1 FROM business_account_members m WHERE m.business_account_id=p.business_account_id AND m.user_id=NEW.reviewer_user_id AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL)))) THEN
       RAISE EXCEPTION 'A provider owner or active business member cannot review their own provider profile' USING ERRCODE='23514';
    END IF;
    IF NEW.provider_response IS NOT NULL AND NEW.provider_response_by_user_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM service_providers p WHERE p.id=NEW.service_provider_id AND
         ((p.owner_user_id=NEW.provider_response_by_user_id) OR
          (p.business_account_id IS NOT NULL AND EXISTS (SELECT 1 FROM business_account_members m WHERE m.business_account_id=p.business_account_id AND m.user_id=NEW.provider_response_by_user_id AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL)))) THEN
       RAISE EXCEPTION 'Provider response must be authored by the provider owner or an active business member' USING ERRCODE='23514';
    END IF;
    IF NEW.provider_response IS NOT NULL AND NEW.provider_response_by_user_id IS NULL THEN
       RAISE EXCEPTION 'Provider response requires an author' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_service_review BEFORE INSERT OR UPDATE ON service_reviews
 FOR EACH ROW EXECUTE FUNCTION validate_service_review();

CREATE OR REPLACE FUNCTION validate_service_report_target()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.target_type='SERVICE_REQUEST' AND NOT EXISTS(SELECT 1 FROM service_requests WHERE id=NEW.target_id))
       OR (NEW.target_type='SERVICE_PROVIDER' AND NOT EXISTS(SELECT 1 FROM service_providers WHERE id=NEW.target_id))
       OR (NEW.target_type='SERVICE_REVIEW' AND NOT EXISTS(SELECT 1 FROM service_reviews WHERE id=NEW.target_id)) THEN
       RAISE EXCEPTION 'Service report target does not exist for the given target_type' USING ERRCODE='23503';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_service_report_target BEFORE INSERT OR UPDATE OF target_type,target_id
ON service_reports FOR EACH ROW EXECUTE FUNCTION validate_service_report_target();
CREATE TRIGGER trg_validate_service_moderation_target BEFORE INSERT OR UPDATE OF target_type,target_id
ON service_moderation_actions FOR EACH ROW EXECUTE FUNCTION validate_service_report_target();

CREATE OR REPLACE FUNCTION enqueue_service_response_notification()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_customer_user_id uuid;
BEGIN
    IF TG_OP='INSERT' AND NEW.status='SENT' THEN
        SELECT customer_user_id INTO v_customer_user_id FROM service_requests WHERE id=NEW.service_request_id;
        IF v_customer_user_id IS NULL THEN RAISE EXCEPTION 'Service response request does not exist' USING ERRCODE='23503'; END IF;
        INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,destination,destination_key,payload,event_dedupe_key)
        VALUES('SERVICE_REQUEST_RESPONSE',NEW.id,'SERVICE_RESPONSE_CREATED','ABLY',
          'user:'||v_customer_user_id::text||':notifications',
          jsonb_build_object('responseId',NEW.id,'serviceRequestId',NEW.service_request_id,
            'serviceProviderId',NEW.service_provider_id,'responseType',NEW.response_type,'createdAt',NEW.created_at),
          'service-response-created:'||NEW.id::text)
        ON CONFLICT(event_dedupe_key) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_enqueue_service_response_notification AFTER INSERT ON service_request_responses
FOR EACH ROW EXECUTE FUNCTION enqueue_service_response_notification();

DROP TRIGGER IF EXISTS trg_job_listing_integrity ON job_listings;
CREATE TRIGGER trg_job_listing_integrity BEFORE INSERT OR UPDATE ON job_listings
FOR EACH ROW EXECUTE FUNCTION validate_job_listing();

-- Vehicle catalogues: make/model are relational. Fuel/transmission/body remain controlled fields.
CREATE TABLE vehicle_makes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    make_key text NOT NULL UNIQUE CHECK(make_key=upper(trim(make_key)) AND make_key ~ '^[A-Z0-9_]+$'),
    display_name text NOT NULL UNIQUE CHECK(length(trim(display_name)) BETWEEN 1 AND 100),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vehicle_models (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    make_id uuid NOT NULL REFERENCES vehicle_makes(id) ON DELETE RESTRICT,
    model_key text NOT NULL CHECK(model_key=upper(trim(model_key)) AND model_key ~ '^[A-Z0-9_]+$'),
    display_name text NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 120),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(make_id,model_key), UNIQUE(make_id,display_name), UNIQUE(id,make_id)
);
CREATE INDEX ix_vehicle_models_make_active ON vehicle_models(make_id,display_name) WHERE is_active;
CREATE TABLE vehicle_variants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id uuid NOT NULL REFERENCES vehicle_models(id) ON DELETE RESTRICT,
    variant_key text NOT NULL CHECK(variant_key=upper(trim(variant_key)) AND variant_key ~ '^[A-Z0-9_]+$'),
    display_name text NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 120),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(model_id,variant_key), UNIQUE(model_id,display_name)
);
CREATE TABLE vehicle_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    category_key text NOT NULL UNIQUE CHECK(category_key=upper(trim(category_key)) AND category_key ~ '^[A-Z0-9_]+$'),
    display_name text NOT NULL UNIQUE,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0
);
CREATE TABLE vehicle_features (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_key text NOT NULL UNIQUE CHECK(feature_key=upper(trim(feature_key)) AND feature_key ~ '^[A-Z0-9_]+$'),
    display_name text NOT NULL UNIQUE,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0
);

-- Property and vehicle classified listings. No booking, checkout or transaction processing.
-- Additional attributes are object-shaped JSONB, but category-specific keys and value types
-- must be validated in the backend. Core searchable fields (price, bedrooms, mileage,
-- model_year, registration_year) stay in dedicated columns; the GIN indexes support suitable
-- containment filters over additional_attributes without requiring one SQL column per feature.
CREATE TABLE property_listings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id uuid NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
    community_id uuid REFERENCES communities(id) ON DELETE RESTRICT,
    owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    business_account_id uuid REFERENCES business_accounts(id) ON DELETE RESTRICT,
    business_listing_id uuid REFERENCES business_listings(id) ON DELETE SET NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    property_type_id uuid NOT NULL,
    visibility_scope visibility_scope NOT NULL DEFAULT 'COMMUNITY',
    listing_purpose text NOT NULL CHECK(listing_purpose IN ('SALE','RENT')),
    title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 220),
    description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 20000),
    -- Flexible category-specific attributes; backend validates keys/types against the selected property type.
    additional_attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(additional_attributes)='object'),
    price_amount numeric(14,2) NOT NULL CHECK(price_amount >= 0),
    currency_code char(3) NOT NULL CHECK(currency_code ~ '^[A-Z]{3}$'),
    price_period text CHECK(price_period IS NULL OR price_period IN ('WEEK','MONTH','YEAR','TOTAL')),
    address_id uuid REFERENCES addresses(id) ON DELETE RESTRICT,
    bedrooms smallint CHECK(bedrooms IS NULL OR bedrooms >= 0),
    bathrooms smallint CHECK(bathrooms IS NULL OR bathrooms >= 0),
    reception_rooms smallint CHECK(reception_rooms IS NULL OR reception_rooms >= 0),
    floor_area numeric(10,2) CHECK(floor_area IS NULL OR floor_area >= 0),
    floor_area_unit text CHECK(floor_area_unit IS NULL OR floor_area_unit IN ('SQM','SQFT')),
    furnished_status text CHECK(furnished_status IS NULL OR furnished_status IN ('FURNISHED','PART_FURNISHED','UNFURNISHED','UNSPECIFIED')),
    rental_deposit numeric(14,2) CHECK(rental_deposit IS NULL OR rental_deposit >= 0),
    bills_included boolean,
    minimum_tenancy_months smallint CHECK(minimum_tenancy_months IS NULL OR minimum_tenancy_months > 0),
    availability_date date,
    tenure text,
    condition_key text CHECK(condition_key IS NULL OR condition_key IN ('NEW','EXCELLENT','GOOD','FAIR','NEEDS_RENOVATION','UNSPECIFIED')),
    status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING_REVIEW','PUBLISHED','PAUSED','SOLD','RENTED','EXPIRED','REJECTED','REMOVED')),
    expires_at timestamptz,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK((owner_user_id IS NOT NULL)::int + (business_account_id IS NOT NULL)::int = 1),
    CHECK((visibility_scope='COMMUNITY' AND community_id IS NOT NULL) OR (visibility_scope IN ('COUNTRY','SELECTED_COMMUNITIES') AND community_id IS NULL)),
    CHECK((listing_purpose='RENT' AND (price_period IS NULL OR price_period IN ('WEEK','MONTH','YEAR'))) OR (listing_purpose='SALE' AND (price_period IS NULL OR price_period='TOTAL'))),
    FOREIGN KEY(country_id,property_type_id) REFERENCES country_property_types(country_id,property_type_id) ON DELETE RESTRICT
);
CREATE INDEX ix_property_search ON property_listings(country_id,status,listing_purpose,price_amount,created_at DESC) WHERE status='PUBLISHED';
CREATE INDEX ix_property_listing_additional_attributes ON property_listings USING gin(additional_attributes jsonb_path_ops);
CREATE INDEX ix_property_type ON property_listings(country_id,property_type_id,status) WHERE status='PUBLISHED';
CREATE INDEX ix_property_address ON property_listings(address_id,status) WHERE address_id IS NOT NULL AND status='PUBLISHED';
CREATE TABLE property_listing_communities (
    property_listing_id uuid NOT NULL REFERENCES property_listings(id) ON DELETE CASCADE,
    community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(property_listing_id,community_id)
);
CREATE TABLE property_listing_media (
    property_listing_id uuid NOT NULL REFERENCES property_listings(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE RESTRICT,
    sort_order integer NOT NULL DEFAULT 0,
    is_cover boolean NOT NULL DEFAULT false,
    PRIMARY KEY(property_listing_id,media_id), UNIQUE(property_listing_id,sort_order)
);
CREATE UNIQUE INDEX ux_property_single_cover ON property_listing_media(property_listing_id) WHERE is_cover;
CREATE TABLE property_amenities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    amenity_key text NOT NULL UNIQUE CHECK(amenity_key=upper(trim(amenity_key)) AND amenity_key ~ '^[A-Z0-9_]+$'),
    display_name text NOT NULL UNIQUE,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0
);
CREATE TABLE property_listing_amenities (
    property_listing_id uuid NOT NULL REFERENCES property_listings(id) ON DELETE CASCADE,
    amenity_id uuid NOT NULL REFERENCES property_amenities(id) ON DELETE RESTRICT,
    custom_value text,
    PRIMARY KEY(property_listing_id,amenity_id)
);
CREATE TABLE property_listing_saves (
    property_listing_id uuid NOT NULL REFERENCES property_listings(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(property_listing_id,user_id)
);
CREATE TABLE property_listing_contacts (
    property_listing_id uuid PRIMARY KEY REFERENCES property_listings(id) ON DELETE CASCADE,
    phone text, whatsapp text, email text,
    preferred_method text CHECK(preferred_method IS NULL OR preferred_method IN ('PHONE','WHATSAPP','EMAIL')),
    show_phone boolean NOT NULL DEFAULT false,
    show_whatsapp boolean NOT NULL DEFAULT false,
    show_email boolean NOT NULL DEFAULT false,
    CHECK(phone IS NOT NULL OR whatsapp IS NOT NULL OR email IS NOT NULL)
);

CREATE TABLE vehicle_listings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id uuid NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
    community_id uuid REFERENCES communities(id) ON DELETE RESTRICT,
    owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    business_account_id uuid REFERENCES business_accounts(id) ON DELETE RESTRICT,
    business_listing_id uuid REFERENCES business_listings(id) ON DELETE SET NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    visibility_scope visibility_scope NOT NULL DEFAULT 'COMMUNITY',
    listing_purpose text NOT NULL CHECK(listing_purpose IN ('SALE','RENT')),
    vehicle_category_id uuid NOT NULL REFERENCES vehicle_categories(id) ON DELETE RESTRICT,
    make_id uuid NOT NULL REFERENCES vehicle_makes(id) ON DELETE RESTRICT,
    model_id uuid NOT NULL,
    variant_id uuid REFERENCES vehicle_variants(id) ON DELETE SET NULL,
    title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 220),
    description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 20000),
    model_year smallint CHECK(model_year IS NULL OR model_year BETWEEN 1886 AND 2200),
    mileage integer CHECK(mileage IS NULL OR mileage >= 0),
    mileage_unit text NOT NULL DEFAULT 'MILES' CHECK(mileage_unit IN ('MILES','KM')),
    fuel_type text NOT NULL DEFAULT 'UNKNOWN' CHECK(fuel_type IN ('PETROL','DIESEL','ELECTRIC','HYBRID','PLUG_IN_HYBRID','HYDROGEN','OTHER','UNKNOWN')),
    transmission text NOT NULL DEFAULT 'UNKNOWN' CHECK(transmission IN ('MANUAL','AUTOMATIC','SEMI_AUTOMATIC','OTHER','UNKNOWN')),
    drive_type text NOT NULL DEFAULT 'UNKNOWN' CHECK(drive_type IN ('FWD','RWD','AWD','FOUR_WD','OTHER','UNKNOWN')),
    body_type text NOT NULL DEFAULT 'UNKNOWN' CHECK(body_type IN ('HATCHBACK','SALOON','ESTATE','SUV','COUPE','CONVERTIBLE','MPV','VAN','PICKUP','MOTORCYCLE','MOTORHOME','TRUCK','OTHER','UNKNOWN')),
    engine_size_cc integer CHECK(engine_size_cc IS NULL OR engine_size_cc >= 0),
    colour text,
    doors smallint CHECK(doors IS NULL OR doors > 0),
    seats smallint CHECK(seats IS NULL OR seats > 0),
    condition_key text CHECK(condition_key IS NULL OR condition_key IN ('NEW','EXCELLENT','GOOD','FAIR','POOR','UNSPECIFIED')),
    registration_year smallint CHECK(registration_year IS NULL OR registration_year BETWEEN 1886 AND 2200),
    previous_owners smallint CHECK(previous_owners IS NULL OR previous_owners >= 0),
    -- Keep `model_year` and `registration_year` distinct: model designation year is not first registration.
    -- Flexible category-specific attributes are validated by the backend before persistence.
    additional_attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(additional_attributes)='object'),
    mot_expiry date,
    service_history text CHECK(service_history IS NULL OR service_history IN ('FULL','PARTIAL','NONE','UNKNOWN')),
    price_amount numeric(14,2) NOT NULL CHECK(price_amount >= 0),
    currency_code char(3) NOT NULL CHECK(currency_code ~ '^[A-Z]{3}$'),
    price_period text CHECK(price_period IS NULL OR price_period IN ('DAY','WEEK','MONTH','TOTAL')),
    rental_deposit numeric(14,2) CHECK(rental_deposit IS NULL OR rental_deposit >= 0),
    mileage_allowance integer CHECK(mileage_allowance IS NULL OR mileage_allowance >= 0),
    rental_conditions text,
    address_id uuid REFERENCES addresses(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING_REVIEW','PUBLISHED','PAUSED','SOLD','RENTED','EXPIRED','REJECTED','REMOVED')),
    expires_at timestamptz,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK((owner_user_id IS NOT NULL)::int + (business_account_id IS NOT NULL)::int = 1),
    CHECK((visibility_scope='COMMUNITY' AND community_id IS NOT NULL) OR (visibility_scope IN ('COUNTRY','SELECTED_COMMUNITIES') AND community_id IS NULL)),
    CHECK((listing_purpose='RENT' AND (price_period IS NULL OR price_period IN ('DAY','WEEK','MONTH'))) OR (listing_purpose='SALE' AND (price_period IS NULL OR price_period='TOTAL'))),
    FOREIGN KEY(model_id,make_id) REFERENCES vehicle_models(id,make_id) ON DELETE RESTRICT
);
CREATE INDEX ix_vehicle_search ON vehicle_listings(country_id,status,listing_purpose,price_amount,created_at DESC) WHERE status='PUBLISHED';
CREATE INDEX ix_vehicle_listing_additional_attributes ON vehicle_listings USING gin(additional_attributes jsonb_path_ops);
CREATE INDEX ix_vehicle_make_model ON vehicle_listings(make_id,model_id,status) WHERE status='PUBLISHED';
CREATE INDEX ix_vehicle_address ON vehicle_listings(address_id,status) WHERE address_id IS NOT NULL AND status='PUBLISHED';
CREATE INDEX ix_vehicle_model_year_mileage ON vehicle_listings(model_year,mileage) WHERE status='PUBLISHED';
CREATE TABLE vehicle_listing_communities (
    vehicle_listing_id uuid NOT NULL REFERENCES vehicle_listings(id) ON DELETE CASCADE,
    community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(vehicle_listing_id,community_id)
);
CREATE TABLE vehicle_listing_media (
    vehicle_listing_id uuid NOT NULL REFERENCES vehicle_listings(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE RESTRICT,
    sort_order integer NOT NULL DEFAULT 0,
    is_cover boolean NOT NULL DEFAULT false,
    PRIMARY KEY(vehicle_listing_id,media_id), UNIQUE(vehicle_listing_id,sort_order)
);
CREATE UNIQUE INDEX ux_vehicle_single_cover ON vehicle_listing_media(vehicle_listing_id) WHERE is_cover;
CREATE TABLE vehicle_listing_features (
    vehicle_listing_id uuid NOT NULL REFERENCES vehicle_listings(id) ON DELETE CASCADE,
    feature_id uuid NOT NULL REFERENCES vehicle_features(id) ON DELETE RESTRICT,
    PRIMARY KEY(vehicle_listing_id,feature_id)
);
CREATE TABLE vehicle_listing_saves (
    vehicle_listing_id uuid NOT NULL REFERENCES vehicle_listings(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(vehicle_listing_id,user_id)
);
CREATE TABLE vehicle_listing_contacts (
    vehicle_listing_id uuid PRIMARY KEY REFERENCES vehicle_listings(id) ON DELETE CASCADE,
    phone text, whatsapp text, email text,
    preferred_method text CHECK(preferred_method IS NULL OR preferred_method IN ('PHONE','WHATSAPP','EMAIL')),
    show_phone boolean NOT NULL DEFAULT false,
    show_whatsapp boolean NOT NULL DEFAULT false,
    show_email boolean NOT NULL DEFAULT false,
    CHECK(phone IS NOT NULL OR whatsapp IS NOT NULL OR email IS NOT NULL)
);

-- Explicit feed-post audience mapping for SELECTED_COMMUNITIES visibility.
CREATE TABLE feed_post_communities (
    post_id uuid NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
    community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(post_id,community_id)
);
CREATE INDEX ix_feed_post_communities_community
    ON feed_post_communities(community_id,post_id);

-- Reusable selected-community audience mappings for existing modules.
CREATE TABLE event_listing_communities (
    event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(event_id,community_id)
);
CREATE TABLE job_listing_communities (
    job_id uuid NOT NULL REFERENCES job_listings(id) ON DELETE CASCADE,
    community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(job_id,community_id)
);
-- Matchmaking scope applies to the profile. Country boundary is profiles.current_country_id.
ALTER TABLE matchmaking_profiles ADD COLUMN visibility_scope visibility_scope NOT NULL DEFAULT 'COUNTRY';
ALTER TABLE matchmaking_profiles ADD COLUMN community_id uuid REFERENCES communities(id) ON DELETE RESTRICT;
ALTER TABLE matchmaking_profiles ADD CONSTRAINT ck_matchmaking_visibility_scope_v10 CHECK (
    (visibility_scope='COMMUNITY' AND community_id IS NOT NULL)
    OR (visibility_scope IN ('COUNTRY','SELECTED_COMMUNITIES') AND community_id IS NULL)
);
CREATE TABLE matchmaking_profile_communities (
    user_id uuid NOT NULL REFERENCES matchmaking_profiles(user_id) ON DELETE CASCADE,
    community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,community_id)
);

-- Scope support on existing event/job/feed records. Selected community maps are explicit.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid='events'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) ILIKE '%visibility_scope%'
  LOOP EXECUTE format('ALTER TABLE events DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;
ALTER TABLE events ADD CONSTRAINT ck_events_visibility_v10 CHECK (
 (visibility_scope='COMMUNITY' AND community_id IS NOT NULL) OR
 visibility_scope IN ('COUNTRY','SELECTED_COMMUNITIES'));
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid='job_listings'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) ILIKE '%visibility_scope%'
  LOOP EXECUTE format('ALTER TABLE job_listings DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;
ALTER TABLE job_listings ADD CONSTRAINT ck_jobs_visibility_v10 CHECK (
 (visibility_scope='COMMUNITY' AND community_id IS NOT NULL) OR
 visibility_scope IN ('COUNTRY','SELECTED_COMMUNITIES'));
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid='feed_posts'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) ILIKE '%visibility_scope%'
  LOOP EXECUTE format('ALTER TABLE feed_posts DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;
ALTER TABLE feed_posts ADD CONSTRAINT ck_feed_posts_visibility_v10 CHECK (
 (visibility_scope='COMMUNITY' AND community_id IS NOT NULL) OR
 visibility_scope IN ('COUNTRY','SELECTED_COMMUNITIES'));

-- Billing catalogues: subscriptions grant entitlements; one-off products grant specific benefits.
-- Provider-neutral integration contract: REVENUECAT may use billing_provider_products
-- for App Store / Play Store products, billing_webhook_events for idempotent events,
-- and billing_subscriptions/billing_payments for local state. Verify provider webhooks
-- in the service before accepting them; do not treat client SDK state as authority.
-- RevenueCat remains under evaluation; no provider is selected by this schema.
CREATE TABLE billing_plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_key text NOT NULL UNIQUE CHECK(plan_key=upper(trim(plan_key)) AND plan_key ~ '^[A-Z0-9_]+$'),
    display_name text NOT NULL,
    account_type text NOT NULL CHECK(account_type IN ('PERSONAL','BUSINESS')),
    description text,
    is_free boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE billing_plan_prices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid NOT NULL REFERENCES billing_plans(id) ON DELETE CASCADE,
    currency_code char(3) NOT NULL CHECK(currency_code ~ '^[A-Z]{3}$'),
    amount numeric(12,2) NOT NULL CHECK(amount >= 0),
    billing_interval text NOT NULL CHECK(billing_interval IN ('NONE','MONTH','YEAR')),
    provider_key text,
    provider_price_id text,
    is_active boolean NOT NULL DEFAULT true,
    effective_from timestamptz NOT NULL DEFAULT now(), effective_until timestamptz,
    UNIQUE(plan_id,currency_code,billing_interval,effective_from),
    CHECK(effective_until IS NULL OR effective_until > effective_from)
);
CREATE TABLE billing_features (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_key text NOT NULL UNIQUE CHECK(feature_key=upper(trim(feature_key)) AND feature_key ~ '^[A-Z0-9_]+$'),
    display_name text NOT NULL,
    description text,
    feature_kind text NOT NULL CHECK(feature_kind IN ('BOOLEAN','QUOTA','LIMIT','CAPABILITY')),
    reset_period text CHECK(reset_period IS NULL OR reset_period IN ('DAY','WEEK','MONTH','YEAR','SUBSCRIPTION_PERIOD','NEVER')),
    quota_scope text NOT NULL DEFAULT 'ACCOUNT' CHECK(quota_scope IN ('ACCOUNT','PER_TARGET','PER_RECIPIENT')),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE billing_plan_entitlements (
    plan_id uuid NOT NULL REFERENCES billing_plans(id) ON DELETE CASCADE,
    feature_id uuid NOT NULL REFERENCES billing_features(id) ON DELETE CASCADE,
    enabled boolean NOT NULL DEFAULT true,
    quantity_limit bigint CHECK(quantity_limit IS NULL OR quantity_limit >= 0),
    reset_period text CHECK(reset_period IS NULL OR reset_period IN ('DAY','WEEK','MONTH','YEAR','SUBSCRIPTION_PERIOD','NEVER')),
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT ck_billing_plan_entitlement_limit_requires_period
        CHECK (quantity_limit IS NULL OR reset_period IS NOT NULL),
    PRIMARY KEY(plan_id,feature_id)
);
CREATE TABLE billing_products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_key text NOT NULL UNIQUE CHECK(product_key=upper(trim(product_key)) AND product_key ~ '^[A-Z0-9_]+$'),
    display_name text NOT NULL,
    product_kind text NOT NULL CHECK(product_kind IN ('ACTION_CREDIT','LISTING_PUBLICATION','PROMOTION','ADD_ON')),
    target_type text NOT NULL CHECK(target_type IN ('PROPERTY','VEHICLE','EVENT','JOB','BUSINESS','FEED_POST','VOICE_ROOM','OTHER')),
    quantity_granted integer NOT NULL DEFAULT 1 CHECK(quantity_granted > 0),
    validity_days integer CHECK(validity_days IS NULL OR validity_days > 0),
    is_active boolean NOT NULL DEFAULT true,
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE billing_product_prices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES billing_products(id) ON DELETE CASCADE,
    currency_code char(3) NOT NULL CHECK(currency_code ~ '^[A-Z]{3}$'),
    amount numeric(12,2) NOT NULL CHECK(amount >= 0),
    provider_key text,
    provider_product_id text,
    is_active boolean NOT NULL DEFAULT true,
    effective_from timestamptz NOT NULL DEFAULT now(), effective_until timestamptz,
    UNIQUE(product_id,currency_code,effective_from),
    CHECK(effective_until IS NULL OR effective_until > effective_from)
);
CREATE TABLE billing_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid NOT NULL REFERENCES billing_plans(id) ON DELETE RESTRICT,
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    business_account_id uuid REFERENCES business_accounts(id) ON DELETE CASCADE,
    status text NOT NULL CHECK(status IN ('INCOMPLETE','TRIALING','ACTIVE','PAST_DUE','PAUSED','CANCELED','EXPIRED')),
    provider_key text,
    provider_customer_id text,
    provider_subscription_id text,
    current_period_start timestamptz,
    current_period_end timestamptz,
    cancel_at_period_end boolean NOT NULL DEFAULT false,
    canceled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK((user_id IS NOT NULL)::int + (business_account_id IS NOT NULL)::int = 1),
    CHECK(current_period_end IS NULL OR current_period_start IS NULL OR current_period_end > current_period_start)
);
CREATE UNIQUE INDEX ux_billing_active_user_subscription ON billing_subscriptions(user_id) WHERE user_id IS NOT NULL AND status IN ('TRIALING','ACTIVE','PAST_DUE','PAUSED');
CREATE UNIQUE INDEX ux_billing_active_business_subscription ON billing_subscriptions(business_account_id) WHERE business_account_id IS NOT NULL AND status IN ('TRIALING','ACTIVE','PAST_DUE','PAUSED');
CREATE UNIQUE INDEX ux_billing_provider_subscription ON billing_subscriptions(provider_key,provider_subscription_id) WHERE provider_subscription_id IS NOT NULL;

-- A personal user may only subscribe to PERSONAL plans; a Business Account may
-- only subscribe to BUSINESS plans. This cross-table rule cannot be a CHECK constraint.
CREATE OR REPLACE FUNCTION validate_billing_subscription_account_type()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_plan_account_type text;
BEGIN
    SELECT account_type INTO v_plan_account_type FROM billing_plans WHERE id=NEW.plan_id;
    IF v_plan_account_type IS NULL THEN
        RAISE EXCEPTION 'Billing plan does not exist' USING ERRCODE='23503';
    END IF;
    IF NEW.user_id IS NOT NULL AND v_plan_account_type <> 'PERSONAL' THEN
        RAISE EXCEPTION 'Personal subscriptions require a PERSONAL billing plan' USING ERRCODE='23514';
    END IF;
    IF NEW.business_account_id IS NOT NULL AND v_plan_account_type <> 'BUSINESS' THEN
        RAISE EXCEPTION 'Business Account subscriptions require a BUSINESS billing plan' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_billing_subscription_account_type
BEFORE INSERT OR UPDATE OF plan_id,user_id,business_account_id ON billing_subscriptions
FOR EACH ROW EXECUTE FUNCTION validate_billing_subscription_account_type();

CREATE TABLE billing_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    business_account_id uuid REFERENCES business_accounts(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','REQUIRES_ACTION','PAID','FAILED','CANCELED','PARTIALLY_REFUNDED','REFUNDED')),
    currency_code char(3) NOT NULL CHECK(currency_code ~ '^[A-Z]{3}$'),
    subtotal_amount numeric(12,2) NOT NULL CHECK(subtotal_amount >= 0),
    tax_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK(tax_amount >= 0),
    total_amount numeric(12,2) NOT NULL CHECK(total_amount >= 0),
    provider_key text,
    provider_payment_intent_id text,
    idempotency_key text,
    created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz,
    CHECK((user_id IS NOT NULL)::int + (business_account_id IS NOT NULL)::int = 1),
    UNIQUE(user_id,idempotency_key), UNIQUE(business_account_id,idempotency_key)
);
CREATE TABLE billing_order_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES billing_orders(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES billing_products(id) ON DELETE RESTRICT,
    quantity integer NOT NULL CHECK(quantity > 0),
    unit_amount numeric(12,2) NOT NULL CHECK(unit_amount >= 0),
    total_amount numeric(12,2) NOT NULL CHECK(total_amount >= 0),
    target_type text, target_id uuid,
    benefit_config jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE billing_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid REFERENCES billing_orders(id) ON DELETE SET NULL,
    subscription_id uuid REFERENCES billing_subscriptions(id) ON DELETE SET NULL,
    provider_key text NOT NULL,
    provider_payment_id text,
    status text NOT NULL CHECK(status IN ('PENDING','SUCCEEDED','FAILED','CANCELED','PARTIALLY_REFUNDED','REFUNDED')),
    amount numeric(12,2) NOT NULL CHECK(amount >= 0),
    currency_code char(3) NOT NULL CHECK(currency_code ~ '^[A-Z]{3}$'),
    failure_code text, failure_message text,
    created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz,
    UNIQUE(provider_key,provider_payment_id)
);
CREATE TABLE billing_refunds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id uuid NOT NULL REFERENCES billing_payments(id) ON DELETE RESTRICT,
    provider_refund_id text,
    amount numeric(12,2) NOT NULL CHECK(amount > 0),
    currency_code char(3) NOT NULL CHECK(currency_code ~ '^[A-Z]{3}$'),
    status text NOT NULL CHECK(status IN ('PENDING','SUCCEEDED','FAILED','CANCELED')),
    reason text,
    created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
    UNIQUE(payment_id,provider_refund_id)
);
CREATE TABLE billing_entitlement_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_id uuid NOT NULL REFERENCES billing_features(id) ON DELETE RESTRICT,
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    business_account_id uuid REFERENCES business_accounts(id) ON DELETE CASCADE,
    source_type text NOT NULL CHECK(source_type IN ('SUBSCRIPTION','PURCHASE','ADMIN_GRANT','PROMOTION','TRIAL')),
    subscription_id uuid REFERENCES billing_subscriptions(id) ON DELETE SET NULL,
    order_item_id uuid REFERENCES billing_order_items(id) ON DELETE SET NULL,
    quantity_granted bigint CHECK(quantity_granted IS NULL OR quantity_granted >= 0),
    quantity_used bigint NOT NULL DEFAULT 0 CHECK(quantity_used >= 0),
    starts_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz,
    status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','EXHAUSTED','EXPIRED','REVOKED')),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK((user_id IS NOT NULL)::int + (business_account_id IS NOT NULL)::int = 1),
    CHECK(quantity_granted IS NULL OR quantity_used <= quantity_granted),
    CHECK(expires_at IS NULL OR expires_at > starts_at)
);
CREATE INDEX ix_entitlement_grants_user ON billing_entitlement_grants(user_id,feature_id,status,expires_at) WHERE user_id IS NOT NULL;
CREATE INDEX ix_entitlement_grants_business ON billing_entitlement_grants(business_account_id,feature_id,status,expires_at) WHERE business_account_id IS NOT NULL;
CREATE TABLE billing_usage_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_id uuid NOT NULL REFERENCES billing_features(id) ON DELETE RESTRICT,
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    business_account_id uuid REFERENCES business_accounts(id) ON DELETE CASCADE,
    quantity bigint NOT NULL DEFAULT 1 CHECK(quantity > 0),
    target_type text, target_id uuid,
    idempotency_key text,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    CHECK((user_id IS NOT NULL)::int + (business_account_id IS NOT NULL)::int = 1),
    UNIQUE(user_id,idempotency_key), UNIQUE(business_account_id,idempotency_key)
);
CREATE INDEX ix_billing_usage_user_feature_time ON billing_usage_records(user_id,feature_id,occurred_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX ix_billing_usage_user_feature_recipient_time ON billing_usage_records(user_id,feature_id,target_type,target_id,occurred_at DESC) WHERE user_id IS NOT NULL AND target_type='USER' AND target_id IS NOT NULL;
CREATE INDEX ix_billing_usage_business_feature_time ON billing_usage_records(business_account_id,feature_id,occurred_at DESC) WHERE business_account_id IS NOT NULL;
CREATE TABLE billing_webhook_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_key text NOT NULL,
    provider_event_id text NOT NULL,
    event_type text NOT NULL,
    status text NOT NULL DEFAULT 'RECEIVED' CHECK(status IN ('RECEIVED','PROCESSING','PROCESSED','FAILED','IGNORED')),
    payload jsonb NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count >= 0), last_error text,
    UNIQUE(provider_key,provider_event_id)
);
CREATE TABLE billing_audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    business_account_id uuid REFERENCES business_accounts(id) ON DELETE SET NULL,
    action_key text NOT NULL,
    target_type text,
    target_id uuid,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_billing_audit_business_time ON billing_audit_events(business_account_id,created_at DESC);


-- External store product mapping. Supports distinct Apple App Store / Google Play
-- identifiers for the same plan, and mapping one-off store products to products.
-- RevenueCat is one candidate provider; provider_key/store_key remain configurable.
CREATE TABLE billing_provider_products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_key text NOT NULL CHECK(provider_key=upper(trim(provider_key)) AND provider_key ~ '^[A-Z0-9_]+$'),
    store_key text NOT NULL CHECK(store_key=upper(trim(store_key)) AND store_key ~ '^[A-Z0-9_]+$'),
    provider_product_id text NOT NULL,
    plan_id uuid REFERENCES billing_plans(id) ON DELETE CASCADE,
    product_id uuid REFERENCES billing_products(id) ON DELETE CASCADE,
    is_active boolean NOT NULL DEFAULT true,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK((plan_id IS NOT NULL)::int + (product_id IS NOT NULL)::int = 1),
    UNIQUE(provider_key,store_key,provider_product_id)
);
CREATE INDEX ix_billing_provider_products_plan ON billing_provider_products(plan_id,provider_key,store_key) WHERE plan_id IS NOT NULL AND is_active;
CREATE INDEX ix_billing_provider_products_product ON billing_provider_products(product_id,provider_key,store_key) WHERE product_id IS NOT NULL AND is_active;

-- Starter plan catalogue; prices are examples and must be reviewed before production.
INSERT INTO billing_plans(plan_key,display_name,account_type,description,is_free,sort_order) VALUES
 ('FREE','Free','PERSONAL','Free personal access with configurable usage limits',true,10),
 ('SILVER','Silver','PERSONAL','Paid personal community membership',false,20),
 ('GOLD','Gold','PERSONAL','Higher personal feature allowances',false,30),
 ('BUSINESS_FREE','Business Free','BUSINESS','Basic business workspace and one public profile',true,10),
 ('BUSINESS_SILVER','Business Silver','BUSINESS','Business workspace with enhanced limits',false,20),
 ('BUSINESS_GOLD','Business Gold','BUSINESS','Business workspace with higher profile and team limits',false,30)
ON CONFLICT(plan_key) DO NOTHING;
INSERT INTO billing_plan_prices(plan_id,currency_code,amount,billing_interval)
SELECT id,'GBP',0,'NONE' FROM billing_plans WHERE is_free ON CONFLICT DO NOTHING;
-- Initial feature catalogue; plan entitlement values/quotas are intentionally configurable in admin.
INSERT INTO billing_features(feature_key,display_name,description,feature_kind,reset_period) VALUES
 ('POST_CREATE','Create posts','Publish feed posts','QUOTA','MONTH'),
 ('COMMENT_CREATE','Create comments','Comment and reply','QUOTA','MONTH'),
 ('DIRECT_MESSAGE_SEND','Send direct messages','Counts successfully sent direct messages per recipient. Configure quantity_limit and reset_period on each plan entitlement; NULL quantity_limit means unlimited when enabled.','QUOTA',NULL),
 ('MATCHMAKING_INTERACT','Matchmaking interaction','Like/pass and other permitted matchmaking actions','QUOTA','MONTH'),
 ('VOICE_ROOM_JOIN','Join voice rooms','Join eligible public voice rooms','LIMIT','DAY'),
 ('VOICE_ROOM_HOST','Host voice rooms','Create/host persistent voice rooms','QUOTA','MONTH'),
 ('EVENT_CREATE','Create events','Publish eligible events','QUOTA','YEAR'),
 ('PROPERTY_LISTING_PUBLISH','Publish property','Publish one eligible property listing','QUOTA','YEAR'),
 ('VEHICLE_LISTING_PUBLISH','Publish vehicle','Publish one eligible vehicle listing','QUOTA','YEAR'),
 ('JOB_LISTING_PUBLISH','Publish job','Publish one eligible job listing','QUOTA','YEAR'),
 ('BUSINESS_PROFILE_CREATE','Business profile limit','Maximum number of active public business profiles owned by a Business Account','LIMIT','NEVER'),
 ('BUSINESS_LOCATION_CREATE','Business location limit','Maximum number of active business locations owned by a Business Account','LIMIT','NEVER'),
 ('LISTING_PROMOTE','Promote listing','Buy/activate featured placement','QUOTA','MONTH'),
 ('BUSINESS_ANALYTICS','Business analytics','Access business analytics','BOOLEAN',NULL),
 ('BUSINESS_TEAM_SEATS','Business team seats','Maximum number of active members in a Business Account allowed by its plan. Enforce when invitations are accepted or members are activated/changed.','LIMIT','NEVER'),
 ('SPARE_BAG_LISTING_PUBLISH','Publish Spare Bag listing','Allowance for publishing eligible Spare Bag sender requests or passenger offers. Configure the reset period and quota per plan before enabling.','QUOTA',NULL),
 ('SERVICE_JOB_POST','Post service job','Controls the customer price and usage limit for publishing service requests. Set the actual plan entitlement and price in admin configuration.','QUOTA',NULL),
 ('SERVICE_LEAD_ACCESS','Access service lead','Controls usage/price for a provider to unlock contact details or start chat for a service request. One access grant per provider/request; later unlock modes do not charge again.','QUOTA',NULL),
 ('SERVICE_QUOTE_SEND','Send service quote','Optional configurable future-compatible control for sending separate quotes. Disabled until launch policy is configured.','QUOTA',NULL)
ON CONFLICT(feature_key) DO NOTHING;

-- Direct-message quota is counted per sender-recipient pair, not per conversation start.
UPDATE billing_features
SET quota_scope='PER_RECIPIENT', reset_period=NULL,
    description='Counts each successfully accepted outgoing direct message to a recipient. The sender-recipient pair is the quota scope. Configure quantity_limit and reset_period on each billing_plan_entitlements row; NULL quantity_limit means unlimited when enabled.'
WHERE feature_key='DIRECT_MESSAGE_SEND';

COMMENT ON COLUMN billing_plan_entitlements.quantity_limit IS
  'When the entitlement is enabled, NULL means unlimited, 0 means no usage is allowed, and a positive value is the maximum usage for the configured reset_period and quota_scope. enabled=false denies the feature regardless of quantity_limit.';
COMMENT ON COLUMN billing_plan_entitlements.reset_period IS
  'Per-plan configurable quota window: DAY, WEEK, MONTH, YEAR, SUBSCRIPTION_PERIOD or NEVER. Any non-NULL quantity_limit requires a non-NULL reset_period. Do not hard-code the period in application code; resolve it from the effective entitlement.';
COMMENT ON COLUMN billing_features.quota_scope IS
  'Quota counting scope. PER_RECIPIENT means the authenticated sender is counted separately for each recipient; usage records use target_type=USER and target_id=recipient profile id.';
COMMENT ON TABLE billing_usage_records IS
  'Append-only usage ledger for successfully accepted actions. For DIRECT_MESSAGE_SEND, write one idempotent unit for each outgoing message only after the message is accepted, with user_id=sender, target_type=USER and target_id=recipient profile id.';

-- Seed account-level business profile/location limits. Business Free explicitly promises
-- one public profile; other plan limits remain disabled until an administrator configures them.
INSERT INTO billing_plan_entitlements(plan_id,feature_id,enabled,quantity_limit,reset_period,config)
SELECT p.id,f.id,
       (p.plan_key='BUSINESS_FREE' AND f.feature_key='BUSINESS_PROFILE_CREATE'),
       CASE WHEN p.plan_key='BUSINESS_FREE' AND f.feature_key='BUSINESS_PROFILE_CREATE' THEN 1 ELSE NULL END,
       'NEVER',
       jsonb_build_object('requires_admin_configuration', NOT (p.plan_key='BUSINESS_FREE' AND f.feature_key='BUSINESS_PROFILE_CREATE'),
                          'note','Configure and test the active-count limit before changing plan entitlements.')
FROM billing_plans p CROSS JOIN billing_features f
WHERE p.account_type='BUSINESS' AND f.feature_key IN ('BUSINESS_PROFILE_CREATE','BUSINESS_LOCATION_CREATE')
ON CONFLICT(plan_id,feature_id) DO NOTHING;

-- Seed disabled entitlement placeholders for the new features. This deliberately
-- avoids inventing launch quotas: an administrator must set numeric limits and
-- enable each feature only after the allowance policy is approved.
INSERT INTO billing_plan_entitlements(plan_id,feature_id,enabled,quantity_limit,reset_period,config)
SELECT p.id, f.id, false, NULL, 'NEVER',
       jsonb_build_object('requires_admin_configuration',true,
                          'note','Set a numeric active-member cap before enabling BUSINESS_TEAM_SEATS.')
FROM billing_plans p CROSS JOIN billing_features f
WHERE p.account_type='BUSINESS' AND f.feature_key='BUSINESS_TEAM_SEATS'
ON CONFLICT(plan_id,feature_id) DO NOTHING;

INSERT INTO billing_plan_entitlements(plan_id,feature_id,enabled,quantity_limit,reset_period,config)
SELECT p.id, f.id, false, NULL, NULL,
       jsonb_build_object('requires_admin_configuration',true,
                          'note','Set quantity_limit and reset_period for this plan before enabling Spare Bag publication.')
FROM billing_plans p CROSS JOIN billing_features f
WHERE p.account_type='PERSONAL' AND f.feature_key='SPARE_BAG_LISTING_PUBLISH'
ON CONFLICT(plan_id,feature_id) DO NOTHING;

-- Service marketplace billing uses the shared entitlement engine. Limits and prices are deliberately not invented;
-- administrators configure each plan. SERVICE_PROVIDER_REGISTER is intentionally not a billable feature.
INSERT INTO billing_plan_entitlements(plan_id,feature_id,enabled,quantity_limit,reset_period,config)
SELECT p.id,f.id,false,NULL,NULL,
       jsonb_build_object('requires_admin_configuration',true,
         'note',CASE f.feature_key
            WHEN 'SERVICE_JOB_POST' THEN 'Configure the customer publication price, quantity_limit and reset_period before enabling.'
            WHEN 'SERVICE_LEAD_ACCESS' THEN 'Configure provider lead-access price, quantity_limit and reset_period before enabling; access is idempotent per provider/job.'
            ELSE 'Optional quote control; leave disabled until launch policy and pricing are approved.' END)
FROM billing_plans p CROSS JOIN billing_features f
WHERE f.feature_key IN ('SERVICE_JOB_POST','SERVICE_LEAD_ACCESS','SERVICE_QUOTE_SEND')
ON CONFLICT(plan_id,feature_id) DO NOTHING;

-- Matchmaking action contract (backend transactional invariant):
-- * A mutual match is created only when both current swipe rows are ACTIVE LIKE.
-- * Cancel-like is allowed only for an ACTIVE outgoing LIKE before a current mutual match exists;
--   mark the current row WITHDRAWN and append LIKE_CANCELLED history atomically.
-- * Rewind is allowed only for the actor's latest eligible unreversed SWIPE event; mark the current
--   row REWOUND and append a REWOUND event atomically. No arbitrary historical swipe can be restored.
-- * Unmatch changes an active match to UNMATCHED and records closed_at/closed_by/close_reason. Keep the GENERAL
--   conversation and history; never create or delete Follow edges as a side effect. The Matched badge is derived only from status='MATCHED'.
-- * Block/report checks override all like, match, rewind, and conversation operations.
--
-- JSONB category attribute contract (backend invariant):
-- * additional_attributes must be a JSON object with allow-listed keys and validated types per listing category.
-- * Do not trust client-supplied attributes; enforce payload size, numeric/range rules and category compatibility.
-- * Dedicated columns remain canonical for price, property bedrooms, vehicle mileage, model_year and registration_year.
-- * Expose only category-approved attributes, and filter JSONB keys only where the category schema marks them filterable.
--
-- Country and community matching for selected scopes is a backend invariant:
-- every selected community's destination_country_id must equal the content country.
-- Enforce this in transactional service validation (or dedicated triggers) on every write;
-- read/search endpoints must always apply the same audience predicate.
-- A payment never broadens audience scope, bypasses moderation, or grants verification.


-- Enforce service billing consistency after the usage ledger has been declared.
ALTER TABLE service_lead_access ADD CONSTRAINT fk_service_lead_access_usage
  FOREIGN KEY(billing_usage_record_id) REFERENCES billing_usage_records(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION normalize_and_validate_direct_conversation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_owner_a uuid; v_owner_b uuid; v_actor_allowed boolean; v_ctx_owner_user uuid; v_ctx_owner_business uuid; v_ctx_status text; v_ctx_help_status text;
BEGIN
    IF NEW.participant_a_business_account_id IS NOT NULL THEN
        SELECT created_by_user_id INTO v_owner_a FROM business_accounts WHERE id=NEW.participant_a_business_account_id AND status='ACTIVE';
        IF v_owner_a IS NULL THEN RAISE EXCEPTION 'Business participant A must be an active Business Account' USING ERRCODE='23514'; END IF;
        NEW.participant_a_id:=v_owner_a;
    END IF;
    IF NEW.participant_b_business_account_id IS NOT NULL THEN
        SELECT created_by_user_id INTO v_owner_b FROM business_accounts WHERE id=NEW.participant_b_business_account_id AND status='ACTIVE';
        IF v_owner_b IS NULL THEN RAISE EXCEPTION 'Business participant B must be an active Business Account' USING ERRCODE='23514'; END IF;
        NEW.participant_b_id:=v_owner_b;
    END IF;
    IF COALESCE('B:'||NEW.participant_a_business_account_id::text,'U:'||NEW.participant_a_id::text)
       = COALESCE('B:'||NEW.participant_b_business_account_id::text,'U:'||NEW.participant_b_id::text) THEN
       RAISE EXCEPTION 'A direct conversation must have two different participant identities' USING ERRCODE='23514';
    END IF;
    IF COALESCE('B:'||NEW.participant_a_business_account_id::text,'U:'||NEW.participant_a_id::text)
       > COALESCE('B:'||NEW.participant_b_business_account_id::text,'U:'||NEW.participant_b_id::text) THEN
       v_owner_a:=NEW.participant_a_id; NEW.participant_a_id:=NEW.participant_b_id; NEW.participant_b_id:=v_owner_a;
       v_owner_a:=NEW.participant_a_business_account_id; NEW.participant_a_business_account_id:=NEW.participant_b_business_account_id; NEW.participant_b_business_account_id:=v_owner_a;
    END IF;
    IF NEW.context_type='GENERAL' THEN
       IF NEW.context_id IS NOT NULL THEN RAISE EXCEPTION 'GENERAL conversations cannot have a context_id' USING ERRCODE='23514'; END IF;
    ELSE
       IF NEW.context_id IS NULL THEN RAISE EXCEPTION 'Context conversations require context_id' USING ERRCODE='23514'; END IF;
       NEW.status:='ACCEPTED';
    END IF;
    -- The creating actor must be the personal participant or an active member of one of the two business sides.
    SELECT ((NEW.participant_a_business_account_id IS NULL AND NEW.created_by=NEW.participant_a_id)
       OR (NEW.participant_b_business_account_id IS NULL AND NEW.created_by=NEW.participant_b_id)
       OR (NEW.participant_a_business_account_id IS NOT NULL AND EXISTS(SELECT 1 FROM business_account_members m
           WHERE m.business_account_id=NEW.participant_a_business_account_id AND m.user_id=NEW.created_by AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL))
       OR (NEW.participant_b_business_account_id IS NOT NULL AND EXISTS(SELECT 1 FROM business_account_members m
           WHERE m.business_account_id=NEW.participant_b_business_account_id AND m.user_id=NEW.created_by AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL)))
       INTO v_actor_allowed;
    IF NOT COALESCE(v_actor_allowed,false) THEN RAISE EXCEPTION 'Conversation creator is not authorised to act for either participant' USING ERRCODE='23514'; END IF;

    -- Resource existence and ownership checks. Backend still enforces privacy, access rules, blocks and lead billing.
    IF NEW.context_type='PROPERTY_LISTING' THEN
       SELECT owner_user_id,business_account_id,status INTO v_ctx_owner_user,v_ctx_owner_business,v_ctx_status FROM property_listings WHERE id=NEW.context_id;
    ELSIF NEW.context_type='VEHICLE_LISTING' THEN
       SELECT owner_user_id,business_account_id,status INTO v_ctx_owner_user,v_ctx_owner_business,v_ctx_status FROM vehicle_listings WHERE id=NEW.context_id;
    ELSIF NEW.context_type='BUSINESS_PROFILE' THEN
       SELECT owner_user_id,business_account_id,status::text INTO v_ctx_owner_user,v_ctx_owner_business,v_ctx_status FROM business_listings WHERE id=NEW.context_id AND deleted_at IS NULL;
    ELSIF NEW.context_type='EVENT' THEN
       SELECT organizer_id,business_account_id,status::text INTO v_ctx_owner_user,v_ctx_owner_business,v_ctx_status FROM events WHERE id=NEW.context_id;
    ELSIF NEW.context_type='JOB_LISTING' THEN
       SELECT employer_user_id,business_account_id,status::text INTO v_ctx_owner_user,v_ctx_owner_business,v_ctx_status FROM job_listings WHERE id=NEW.context_id;
    ELSIF NEW.context_type='SPARE_BAG_CONTACT' THEN
       IF NOT EXISTS (SELECT 1 FROM spare_bag_contact_requests sr
          JOIN spare_bag_listings sl ON sl.id=sr.sender_listing_id
          JOIN spare_bag_listings pl ON pl.id=sr.passenger_listing_id
          WHERE sr.id=NEW.context_id AND NEW.participant_a_business_account_id IS NULL AND NEW.participant_b_business_account_id IS NULL
            AND ((NEW.participant_a_id=sl.owner_user_id AND NEW.participant_b_id=pl.owner_user_id)
              OR (NEW.participant_a_id=pl.owner_user_id AND NEW.participant_b_id=sl.owner_user_id))) THEN
          RAISE EXCEPTION 'Spare Bag contact conversation must match its contact request participants' USING ERRCODE='23514';
       END IF;
    ELSIF NEW.context_type='SERVICE_REQUEST' THEN
       IF NOT EXISTS (
         SELECT 1 FROM service_requests sr
         JOIN service_providers sp ON true
         JOIN service_lead_access la ON la.service_request_id=sr.id AND la.service_provider_id=sp.id AND la.status='ACTIVE' AND la.chat_enabled=true
         WHERE sr.id=NEW.context_id AND sr.status IN ('OPEN','PAUSED')
           AND ((NEW.participant_a_business_account_id IS NULL AND NEW.participant_a_id=sr.customer_user_id)
             OR (NEW.participant_b_business_account_id IS NULL AND NEW.participant_b_id=sr.customer_user_id))
           AND ((NEW.participant_a_business_account_id IS NOT NULL AND NEW.participant_a_business_account_id=sp.business_account_id)
             OR (NEW.participant_a_business_account_id IS NULL AND NEW.participant_a_id=sp.owner_user_id)
             OR (NEW.participant_b_business_account_id IS NOT NULL AND NEW.participant_b_business_account_id=sp.business_account_id)
             OR (NEW.participant_b_business_account_id IS NULL AND NEW.participant_b_id=sp.owner_user_id))) THEN
          RAISE EXCEPTION 'Service request conversation requires matching customer/provider identities and active chat lead access' USING ERRCODE='23514';
       END IF;
    ELSIF NEW.context_type='COMMUNITY_HELP_POST' THEN
       SELECT fp.author_id, NULL::uuid, fp.status::text, ch.help_status
         INTO v_ctx_owner_user,v_ctx_owner_business,v_ctx_status,v_ctx_help_status
       FROM feed_posts fp
       JOIN community_help_posts ch ON ch.post_id=fp.id
       WHERE fp.id=NEW.context_id AND fp.post_type='COMMUNITY_HELP' AND fp.deleted_at IS NULL;
       IF v_ctx_status IS NULL THEN
          RAISE EXCEPTION 'Community Help conversation target does not exist' USING ERRCODE='23503';
       END IF;
       IF v_ctx_status <> 'PUBLISHED' THEN
          RAISE EXCEPTION 'Community Help conversation requires a published post' USING ERRCODE='23514';
       END IF;
       IF v_ctx_help_status <> 'OPEN' THEN
          RAISE EXCEPTION 'New responses are available only while Community Help post is OPEN' USING ERRCODE='23514';
       END IF;
    END IF;
    IF NEW.context_type IN ('PROPERTY_LISTING','VEHICLE_LISTING','BUSINESS_PROFILE','EVENT','JOB_LISTING','COMMUNITY_HELP_POST') THEN
       IF v_ctx_status IS NULL THEN RAISE EXCEPTION 'Conversation context target does not exist' USING ERRCODE='23503'; END IF;
       IF NEW.context_type='PROPERTY_LISTING' AND v_ctx_status<>'PUBLISHED' THEN RAISE EXCEPTION 'Property enquiry requires a published listing' USING ERRCODE='23514'; END IF;
       IF NEW.context_type='VEHICLE_LISTING' AND v_ctx_status<>'PUBLISHED' THEN RAISE EXCEPTION 'Vehicle enquiry requires a published listing' USING ERRCODE='23514'; END IF;
       IF NEW.context_type='BUSINESS_PROFILE' AND v_ctx_status<>'PUBLISHED' THEN RAISE EXCEPTION 'Business-profile conversation requires a published business listing' USING ERRCODE='23514'; END IF;
       IF NEW.context_type='EVENT' AND v_ctx_status<>'PUBLISHED' THEN RAISE EXCEPTION 'Event conversation requires a published event' USING ERRCODE='23514'; END IF;
       IF NEW.context_type='JOB_LISTING' AND v_ctx_status<>'PUBLISHED' THEN RAISE EXCEPTION 'Job conversation requires a published job listing' USING ERRCODE='23514'; END IF;
       IF v_ctx_owner_business IS NOT NULL AND NOT (NEW.participant_a_business_account_id=v_ctx_owner_business OR NEW.participant_b_business_account_id=v_ctx_owner_business) THEN
          RAISE EXCEPTION 'Context business owner must be a conversation participant' USING ERRCODE='23514';
       ELSIF v_ctx_owner_business IS NULL AND v_ctx_owner_user IS NOT NULL AND NOT (
          (NEW.participant_a_business_account_id IS NULL AND NEW.participant_a_id=v_ctx_owner_user)
          OR (NEW.participant_b_business_account_id IS NULL AND NEW.participant_b_id=v_ctx_owner_user)) THEN
          RAISE EXCEPTION 'Context personal owner must be a conversation participant' USING ERRCODE='23514';
       END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_normalize_validate_direct_conversation BEFORE INSERT ON direct_conversations
FOR EACH ROW EXECUTE FUNCTION normalize_and_validate_direct_conversation();

-- The context-specific uniqueness is enforced by uq_direct_conversations_pair_context. The same user/business pair
-- can have separate chats about two different listings or service requests, but repeated opens reuse the same thread.
COMMENT ON COLUMN direct_conversations.context_type IS 'GENERAL, PROPERTY_LISTING, VEHICLE_LISTING, BUSINESS_PROFILE, EVENT, JOB_LISTING, SPARE_BAG_CONTACT, SERVICE_REQUEST or COMMUNITY_HELP_POST. Matchmaking uses GENERAL.';
COMMENT ON COLUMN direct_conversations.context_id IS 'Resource ID for context-specific chat. This is a checked polymorphic reference validated by the insert trigger and backend; GENERAL requires NULL.';
COMMENT ON COLUMN direct_conversations.participant_a_business_account_id IS 'When non-NULL, side A speaks as this Business Account; participant_a_id stores its stable creator/representative profile for compatibility and audit.';
COMMENT ON COLUMN direct_conversations.participant_b_business_account_id IS 'When non-NULL, side B speaks as this Business Account; participant_b_id stores its stable creator/representative profile for compatibility and audit.';

-- A room comment is durable only while its voice session is active or in the recoverable grace state.
CREATE OR REPLACE FUNCTION enqueue_voice_room_comment_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_room_id uuid;
BEGIN
    SELECT room_id INTO v_room_id FROM voice_room_sessions WHERE id=NEW.session_id;
    IF v_room_id IS NULL THEN RAISE EXCEPTION 'Voice comment session does not exist' USING ERRCODE='23503'; END IF;
    INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,destination,destination_key,payload,event_dedupe_key)
    VALUES('VOICE_ROOM_MESSAGE',NEW.id,'VOICE_ROOM_COMMENT_CREATED','ABLY',
      'voice-room:'||v_room_id::text||':session:'||NEW.session_id::text,
      jsonb_build_object('messageId',NEW.id,'roomId',v_room_id,'sessionId',NEW.session_id,'senderId',NEW.sender_id,'body',NEW.body,'createdAt',NEW.created_at),
      'voice-room-comment-created:'||NEW.id::text)
    ON CONFLICT(event_dedupe_key) DO NOTHING;
    RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION validate_voice_room_comment_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_session_status voice_session_status;
BEGIN
    -- Lock the session row so a concurrent terminal close cannot race a new comment past cleanup.
    SELECT status INTO v_session_status FROM voice_room_sessions WHERE id=NEW.session_id FOR UPDATE;
    IF v_session_status IS DISTINCT FROM 'ACTIVE' THEN
       RAISE EXCEPTION 'Voice-room comments require an active session' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM voice_room_participants p
       WHERE p.session_id=NEW.session_id AND p.user_id=NEW.sender_id AND p.left_at IS NULL) THEN
       RAISE EXCEPTION 'Voice-room comments require an active session participant' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_voice_room_comment_insert BEFORE INSERT ON voice_room_messages
FOR EACH ROW EXECUTE FUNCTION validate_voice_room_comment_insert();
CREATE TRIGGER trg_enqueue_voice_room_comment AFTER INSERT ON voice_room_messages
FOR EACH ROW EXECUTE FUNCTION enqueue_voice_room_comment_event();

CREATE OR REPLACE FUNCTION purge_voice_room_comments_on_session_end()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_room_id uuid;
BEGIN
    IF NEW.status IN ('ENDED','EXPIRED') AND OLD.status IS DISTINCT FROM NEW.status THEN
       SELECT room_id INTO v_room_id FROM voice_room_sessions WHERE id=NEW.id;
       DELETE FROM voice_room_messages WHERE session_id=NEW.id;
       -- Discard comment events that have not yet been delivered; clients clear any cached feed on the clear event.
       DELETE FROM outbox_events WHERE aggregate_type='VOICE_ROOM_MESSAGE' AND published_at IS NULL
         AND payload->>'sessionId'=NEW.id::text;
       INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,destination,destination_key,payload,event_dedupe_key)
       VALUES('VOICE_ROOM_SESSION',NEW.id,'VOICE_ROOM_COMMENTS_CLEARED','ABLY',
         'voice-room:'||v_room_id::text||':session:'||NEW.id::text,
         jsonb_build_object('roomId',v_room_id,'sessionId',NEW.id,'cleared',true,'endedAt',COALESCE(NEW.ended_at,now())),
         'voice-room-comments-cleared:'||NEW.id::text)
       ON CONFLICT(event_dedupe_key) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_purge_voice_room_comments_on_session_end AFTER UPDATE OF status ON voice_room_sessions
FOR EACH ROW EXECUTE FUNCTION purge_voice_room_comments_on_session_end();

CREATE OR REPLACE FUNCTION end_voice_session_when_room_archived_or_suspended()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status IN ('ARCHIVED','SUSPENDED') AND OLD.status IS DISTINCT FROM NEW.status THEN
       UPDATE voice_room_sessions SET status='ENDED',ended_at=COALESCE(ended_at,now()),
         end_reason=COALESCE(end_reason,CASE WHEN NEW.status='ARCHIVED' THEN 'Room archived' ELSE 'Room suspended' END),updated_at=now()
       WHERE room_id=NEW.id AND status IN ('ACTIVE','INACTIVE');
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_end_voice_session_when_room_archived_or_suspended AFTER UPDATE OF status ON voice_rooms
FOR EACH ROW EXECUTE FUNCTION end_voice_session_when_room_archived_or_suspended();

COMMENT ON TABLE voice_rooms IS 'Persistent voice-room definition. Ending or expiring a live session does not end, expire or delete this room; archive/suspension are explicit room lifecycle actions.';
COMMENT ON COLUMN voice_rooms.inactivity_timeout_minutes IS 'Session inactivity/recovery policy only; never a room-expiration lifetime. The default product grace window is 30 minutes.';
COMMENT ON TABLE voice_room_messages IS 'Ephemeral comments scoped to one voice_room_sessions row. Comments are broadcast through the transactional outbox and physically purged when the session reaches ENDED or EXPIRED; temporary INACTIVE/grace state retains them.';
COMMENT ON FUNCTION purge_voice_room_comments_on_session_end() IS 'Deletes session comments when the voice session definitively ends or expires, discards queued comment-created outbox events, and publishes a clear event so connected clients clear in-memory feeds. A later session starts empty.';

-- v10.11 Community Help & Offers extension:
-- * feed_posts supports COMMUNITY_HELP and retains shared community/audience/moderation/social behavior.
-- * category_module includes COMMUNITY_HELP so help categories can be configured per country.
-- * community_help_posts stores REQUEST/OFFER type and OPEN/PAUSED/RESOLVED/CLOSED/EXPIRED lifecycle.
-- * Direct responses reuse context-specific direct_conversations with context_type COMMUNITY_HELP_POST;
--   there is no separate response table or chat system.
-- * Create the parent feed post as DRAFT, create its lifecycle row, then publish. Expiry transitions are
--   driven by a scheduled Spring Boot/Quartz task; backend authorization remains authoritative.
COMMENT ON TABLE community_help_posts IS 'Community Help & Offers lifecycle row for a feed_posts record whose post_type is COMMUNITY_HELP. Responses reuse context-specific direct conversations; no separate response table exists.';
COMMENT ON COLUMN community_help_posts.help_kind IS 'REQUEST means the author needs assistance; OFFER means the author is offering informal, unpaid assistance or donations. Paid professional work belongs in the Service Marketplace.';
COMMENT ON COLUMN community_help_posts.help_status IS 'Workflow state distinct from feed_posts.status: publication/moderation is handled by the parent feed post; OPEN/PAUSED/RESOLVED/CLOSED/EXPIRED governs help availability.';

-- Static audit note: v10.12 is a greenfield clean-install candidate, not an in-place DB migration.
-- Run PostgreSQL staging execution, query-plan, JSONB category validation, retention, privacy,
-- matchmaking reversal/idempotency and concurrency/security tests before production.
-- Direct-message quota contract: the sender-recipient pair is the quota scope; messages in multiple
-- conversations with the same recipient share the same allowance. Incoming replies do not consume the
-- sender's quota. Log only successfully accepted outgoing messages and deduplicate retries idempotently.
-- If the configured limit is exhausted, return a clear paywall/entitlement response; do not silently charge.
-- Any purchase must be explicitly confirmed and then validated through the trusted billing flow.

-- v10.2 billing change: BUSINESS_TEAM_SEATS and SPARE_BAG_LISTING_PUBLISH are seeded;
-- associated plan entitlements start disabled until administrators configure limits.
-- v10.3 added user_content_views, featured_items and optional featured_item_impressions.
-- v10.4 corrected schema-level implementation blockers found during static review. Featured targets use
-- content_reference_type + content_id; dynamic target existence/type, moderation, audience scope and lifecycle
-- must be validated by the backend service. v10.9 adds persistent voice-room definitions with independently expiring live sessions, Follow-derived mutual connections, chat restrictions, stronger polls, controlled featured placements, business-account permissions/audit, notification delivery retries and Spare Bag country normalization. It retains the v10.8 PostGIS foundation; v10.10 adds Reels using the existing feed/media model, current-address Nearby ranking and publication/media integrity triggers; v10.12 adds structured Community Help & Offers with a distinct lifecycle and contextual responses. This is a clean-install baseline, not an in-place migration.

-- Transaction is managed by Flyway.

-- Carried-forward v10.9 design invariants:
-- * Social: user_follows is directional; user_mutual_connections is derived from reciprocal edges. Matchmaking matches never create/delete follows.
-- * Voice: voice_rooms are persistent. Sessions are disposable; comments are purged only when a session definitively ends/expires, with a clear event.
-- * Chat restrictions: scope/action/revocation are durable; APIs enforce active MUTE/BAN restrictions on send/join/read according to policy.
-- * Poll anonymity is presentation/privacy policy: anonymous means identity is hidden from poll viewers/creators, not that the platform database cannot link a vote to its account.
-- * Featured placement is an allow-listed server decision; every placement is a separate featured_items row and is validated against featured_placement_rules.
-- * Business Account membership roles and lifecycle changes remain audited. v10.12 moves role capability decisions into fixed Java policies and removes the database permission matrix. Closing revokes member access; reactivation requires an explicit owner-recovery transaction. Billing and verification remain separate.
-- * Expo Push delivery is asynchronous, idempotent and receipt-aware; invalid tokens must be deactivated. Ably is still the realtime transport.
-- * Spare Bag listing country is derived from origin_airport_id -> airports.country_id; community_id controls audience and is independently validated.

-- =============================================================================
-- v10.10 Reels extension (carried forward): current-address integrity, publication timestamp,
-- one-ready-video contract, and nearby-feed query support.
-- No reel_details table is needed: feed_posts + feed_post_media + media_objects
-- already represent the Reel, its caption, and its video asset. No per-Reel or
-- global Nearby opt-in setting is added. Address coordinates are server-internal.
-- =============================================================================

CREATE OR REPLACE FUNCTION validate_profile_current_address()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_owner uuid; v_country uuid; v_location geography;
BEGIN
    IF NEW.current_address_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT owner_user_id,country_id,location
      INTO v_owner,v_country,v_location
      FROM addresses WHERE id=NEW.current_address_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Current address does not exist' USING ERRCODE='23503';
    END IF;
    IF v_owner IS DISTINCT FROM NEW.id THEN
        RAISE EXCEPTION 'Current address must belong to the profile' USING ERRCODE='23514';
    END IF;
    IF v_country IS DISTINCT FROM NEW.current_country_id THEN
        RAISE EXCEPTION 'Current address country must match profile current_country_id' USING ERRCODE='23514';
    END IF;
    IF v_location IS NULL THEN
        RAISE EXCEPTION 'Current address must have usable coordinates for Nearby Reels' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_profile_current_address
BEFORE INSERT OR UPDATE OF current_address_id,current_country_id ON profiles
FOR EACH ROW EXECUTE FUNCTION validate_profile_current_address();

CREATE OR REPLACE FUNCTION validate_address_current_profile_link()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.current_address_id=OLD.id
          AND (NEW.owner_user_id IS DISTINCT FROM p.id
               OR NEW.country_id IS DISTINCT FROM p.current_country_id
               OR NEW.latitude IS NULL OR NEW.longitude IS NULL)
    ) THEN
        RAISE EXCEPTION 'An address referenced as a profile current address must retain its owner, country and coordinates; create/select a new address when moving' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_address_current_profile_link
BEFORE UPDATE OF owner_user_id,country_id,latitude,longitude ON addresses
FOR EACH ROW EXECUTE FUNCTION validate_address_current_profile_link();

CREATE OR REPLACE FUNCTION set_feed_post_publication_timestamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='INSERT' THEN
        IF NEW.status='PUBLISHED' THEN
            NEW.published_at:=now();
        ELSE
            NEW.published_at:=NULL;
        END IF;
    ELSE
        IF OLD.published_at IS NOT NULL THEN
            -- Preserve the first publication timestamp across edits, hiding and restoration.
            NEW.published_at:=OLD.published_at;
        ELSIF NEW.status='PUBLISHED' THEN
            NEW.published_at:=now();
        ELSE
            NEW.published_at:=NULL;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_feed_post_publication_timestamp
BEFORE INSERT OR UPDATE OF status,published_at ON feed_posts
FOR EACH ROW EXECUTE FUNCTION set_feed_post_publication_timestamp();

CREATE OR REPLACE FUNCTION validate_published_reel_integrity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_attachment_count integer; v_valid_video_count integer;
BEGIN
    IF TG_OP='UPDATE' THEN
        IF OLD.status='PUBLISHED' AND OLD.post_type='REEL'
           AND NEW.post_type IS DISTINCT FROM OLD.post_type THEN
            RAISE EXCEPTION 'A published Reel cannot be converted to a different post type' USING ERRCODE='23514';
        END IF;
    END IF;
    IF NEW.post_type='REEL' THEN
        SELECT count(*), count(*) FILTER (
            WHERE mo.purpose='FEED_VIDEO'
              AND mo.status='READY'
              AND mo.deleted_at IS NULL
              AND mo.owner_user_id=NEW.author_id
        )
          INTO v_attachment_count,v_valid_video_count
          FROM feed_post_media fpm
          JOIN media_objects mo ON mo.id=fpm.media_id
         WHERE fpm.post_id=NEW.id;
        IF v_attachment_count > 1 THEN
            RAISE EXCEPTION 'A Reel must have exactly one video attachment and no extra media' USING ERRCODE='23514';
        END IF;
        IF v_attachment_count=1 AND v_valid_video_count<>1 THEN
            RAISE EXCEPTION 'A Reel attachment must be the creator-owned FEED_VIDEO asset' USING ERRCODE='23514';
        END IF;
        IF NEW.status='PUBLISHED' AND (v_attachment_count<>1 OR v_valid_video_count<>1) THEN
            RAISE EXCEPTION 'A Reel can be published only when exactly one creator-owned FEED_VIDEO asset is READY' USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_published_reel_integrity
BEFORE INSERT OR UPDATE OF post_type,status,author_id ON feed_posts
FOR EACH ROW EXECUTE FUNCTION validate_published_reel_integrity();

CREATE OR REPLACE FUNCTION validate_reel_media_attachment()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_post_type text; v_author uuid; v_post_status content_status;
        v_media_purpose text; v_media_status media_status; v_media_owner uuid; v_media_deleted timestamptz;
        v_existing_count integer;
BEGIN
    IF TG_OP='UPDATE' THEN
        IF (NEW.post_id IS DISTINCT FROM OLD.post_id OR NEW.media_id IS DISTINCT FROM OLD.media_id)
           AND EXISTS (SELECT 1 FROM feed_posts fp WHERE fp.id=OLD.post_id AND fp.post_type='REEL' AND fp.status='PUBLISHED') THEN
            RAISE EXCEPTION 'A published Reel video cannot be replaced or moved; hide the Reel before changing its media' USING ERRCODE='23514';
        END IF;
    END IF;
    SELECT post_type,author_id,status INTO v_post_type,v_author,v_post_status
      FROM feed_posts WHERE id=NEW.post_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Feed post does not exist' USING ERRCODE='23503';
    END IF;
    IF v_post_type='REEL' THEN
        SELECT purpose,status,owner_user_id,deleted_at INTO v_media_purpose,v_media_status,v_media_owner,v_media_deleted
          FROM media_objects WHERE id=NEW.media_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Reel video asset does not exist' USING ERRCODE='23503';
        END IF;
        IF v_media_purpose<>'FEED_VIDEO' OR v_media_owner IS DISTINCT FROM v_author OR v_media_deleted IS NOT NULL THEN
            RAISE EXCEPTION 'Reel media must be a non-deleted FEED_VIDEO owned by the Reel creator' USING ERRCODE='23514';
        END IF;
        IF v_post_status='PUBLISHED' AND v_media_status<>'READY' THEN
            RAISE EXCEPTION 'Published Reel video must be READY' USING ERRCODE='23514';
        END IF;
        IF TG_OP='UPDATE' THEN
            SELECT count(*) INTO v_existing_count FROM feed_post_media fpm
             WHERE fpm.post_id=NEW.post_id
               AND NOT (fpm.post_id=OLD.post_id AND fpm.media_id=OLD.media_id);
        ELSE
            SELECT count(*) INTO v_existing_count FROM feed_post_media fpm
             WHERE fpm.post_id=NEW.post_id;
        END IF;
        IF v_existing_count>0 THEN
            RAISE EXCEPTION 'A Reel can have only one video attachment' USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_reel_media_attachment
BEFORE INSERT OR UPDATE ON feed_post_media
FOR EACH ROW EXECUTE FUNCTION validate_reel_media_attachment();

CREATE OR REPLACE FUNCTION prevent_published_reel_media_detach()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM feed_posts fp
        WHERE fp.id=OLD.post_id AND fp.post_type='REEL' AND fp.status='PUBLISHED'
    ) THEN
        RAISE EXCEPTION 'Cannot detach the video from a published Reel; hide the Reel first' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
END;
$$;
CREATE TRIGGER trg_prevent_published_reel_media_detach
BEFORE DELETE ON feed_post_media
FOR EACH ROW EXECUTE FUNCTION prevent_published_reel_media_detach();

CREATE OR REPLACE FUNCTION validate_reel_media_object_updates()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM feed_post_media fpm
        JOIN feed_posts fp ON fp.id=fpm.post_id
        WHERE fpm.media_id=OLD.id
          AND fp.post_type='REEL'
          AND fp.status='PUBLISHED'
          AND (NEW.purpose<>'FEED_VIDEO'
               OR NEW.status<>'READY'
               OR NEW.deleted_at IS NOT NULL
               OR NEW.owner_user_id IS DISTINCT FROM fp.author_id)
    ) THEN
        RAISE EXCEPTION 'A published Reel must retain its creator-owned READY FEED_VIDEO asset; hide the Reel before changing that asset' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_reel_media_object_updates
BEFORE UPDATE OF purpose,status,deleted_at,owner_user_id ON media_objects
FOR EACH ROW EXECUTE FUNCTION validate_reel_media_object_updates();

COMMENT ON COLUMN profiles.current_address_id IS 'User-selected current address used internally for Nearby Reels distance ranking. Never serialize the address or exact point in feed responses.';
COMMENT ON COLUMN feed_posts.published_at IS 'First publication timestamp, set by trigger and preserved across ordinary edits or restoration; used for stable feed ordering.';
COMMENT ON TABLE feed_post_media IS 'Shared post media relationship. For post_type=REEL, triggers enforce exactly one creator-owned FEED_VIDEO asset and require READY status before publication.';

-- v10.11 Community Help uses feed_posts, country_categories module mappings, and community_help_posts.
-- No community_help_responses table is needed: responses are context-specific direct conversations.

