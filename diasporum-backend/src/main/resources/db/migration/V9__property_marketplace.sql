-- V9: Property Marketplace additive lifecycle, media/moderation integration
-- and reference data, following Messaging M4, Jobs and Business Directory.

ALTER TABLE property_listings
    DROP CONSTRAINT property_listings_status_check,
    ADD CONSTRAINT property_listings_status_check CHECK(status IN
        ('DRAFT','PENDING_REVIEW','PUBLISHED','PAUSED','SOLD','RENTED',
         'EXPIRED','REJECTED','REMOVED','CLOSED')),
    ADD COLUMN closed_at timestamptz,
    ADD CONSTRAINT ck_property_listing_closed_at
        CHECK((status='CLOSED') = (closed_at IS NOT NULL));

ALTER TABLE media_objects DROP CONSTRAINT media_objects_purpose_check;
ALTER TABLE media_objects ADD CONSTRAINT media_objects_purpose_check
    CHECK(purpose IN ('AVATAR','FEED_IMAGE','FEED_VIDEO','BUSINESS','EVENT','JOB',
        'PROPERTY','MATCHMAKING_PROFILE_PHOTO','MATCHMAKING_PROFILE_BLURRED',
        'CHAT_ATTACHMENT','SPARE_BAG_LISTING','DOCUMENT','OTHER','MESSAGE_AUDIO',
        'MESSAGE_IMAGE','MESSAGE_DOCUMENT'));

ALTER TYPE report_target_type ADD VALUE IF NOT EXISTS 'PROPERTY_LISTING';

CREATE INDEX IF NOT EXISTS ix_property_owner_user_management
    ON property_listings(owner_user_id,status,updated_at DESC,id DESC)
    WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_property_owner_business_management
    ON property_listings(business_account_id,status,updated_at DESC,id DESC)
    WHERE business_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_property_discovery_cursor
    ON property_listings(country_id,created_at DESC,id DESC)
    WHERE status='PUBLISHED';
CREATE INDEX IF NOT EXISTS ix_property_bedrooms_price
    ON property_listings(country_id,bedrooms,bathrooms,price_amount)
    WHERE status='PUBLISHED';
CREATE UNIQUE INDEX IF NOT EXISTS ux_reports_open_reporter_target
    ON reports(reporter_id,target_type,target_id) WHERE status='OPEN';

INSERT INTO property_types(type_key,default_name,sort_order) VALUES
    ('APARTMENT','Apartment',10),
    ('HOUSE','House',20),
    ('TOWNHOUSE','Townhouse',30),
    ('VILLA','Villa',40),
    ('STUDIO','Studio',50),
    ('ROOM','Room',60),
    ('LAND','Land',70),
    ('COMMERCIAL','Commercial property',80),
    ('OTHER','Other property',90)
ON CONFLICT(type_key) DO NOTHING;

INSERT INTO country_property_types(country_id,property_type_id,local_name,sort_order)
SELECT c.id,t.id,t.default_name,t.sort_order
FROM countries c CROSS JOIN property_types t
ON CONFLICT(country_id,property_type_id) DO NOTHING;

INSERT INTO property_amenities(amenity_key,display_name,sort_order) VALUES
    ('PARKING','Parking',10),
    ('GARDEN','Garden',20),
    ('BALCONY','Balcony',30),
    ('ELEVATOR','Elevator',40),
    ('AIR_CONDITIONING','Air conditioning',50),
    ('HEATING','Heating',60),
    ('INTERNET','Internet',70),
    ('LAUNDRY','Laundry',80),
    ('STORAGE','Storage',90),
    ('ACCESSIBLE','Wheelchair accessible',100),
    ('PETS_ALLOWED','Pets allowed',110),
    ('SECURITY','Security',120)
ON CONFLICT(amenity_key) DO NOTHING;

COMMENT ON COLUMN property_listings.closed_at IS
    'Terminal owner closure timestamp; CLOSED listings cannot be reopened.';
