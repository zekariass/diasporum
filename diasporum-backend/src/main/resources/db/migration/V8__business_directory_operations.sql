-- Operational directory fields not present in the v10.12 clean baseline.
ALTER TABLE business_locations
    ADD COLUMN is_active boolean NOT NULL DEFAULT true;
ALTER TABLE business_locations
    ADD COLUMN timezone text NOT NULL DEFAULT 'UTC';

ALTER TABLE business_media
    ADD COLUMN is_logo boolean NOT NULL DEFAULT false;
ALTER TABLE business_media
    ADD CONSTRAINT ck_business_media_single_role
    CHECK (NOT (is_cover AND is_logo));
CREATE UNIQUE INDEX ux_business_single_logo
    ON business_media(business_id) WHERE is_logo=true;

CREATE INDEX ix_business_locations_active_address
    ON business_locations(business_id,address_id) WHERE is_active=true;
CREATE INDEX ix_business_saves_user_cursor
    ON business_saves(user_id,created_at DESC,business_id DESC);
CREATE INDEX ix_business_listing_communities_listing
    ON business_listing_communities(business_listing_id,community_id);
