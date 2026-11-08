-- Optional Business Profile association lookups for property and vehicle
-- listings. business_listing_id already exists (nullable FK to
-- business_listings); these partial indexes back the new profile-scoped
-- queries without penalising the far more common NULL case.
CREATE INDEX ix_property_listings_business_profile
    ON property_listings(business_listing_id,status,created_at DESC)
    WHERE business_listing_id IS NOT NULL;

CREATE INDEX ix_vehicle_listings_business_profile
    ON vehicle_listings(business_listing_id,status,created_at DESC)
    WHERE business_listing_id IS NOT NULL;
