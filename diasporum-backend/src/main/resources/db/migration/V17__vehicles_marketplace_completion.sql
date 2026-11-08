-- V17: Vehicle Marketplace completion — enquiry notification type and an
-- index supporting the expiry sweep and the expires_at discovery predicate.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'VEHICLE_ENQUIRY';

CREATE INDEX IF NOT EXISTS ix_vehicle_expiry
    ON vehicle_listings(expires_at)
    WHERE status='PUBLISHED' AND expires_at IS NOT NULL;
