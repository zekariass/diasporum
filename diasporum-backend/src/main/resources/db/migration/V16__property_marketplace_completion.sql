-- V16: Property Marketplace completion — enquiry notification type and an
-- index supporting the expiry sweep and the expires_at discovery predicate.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'PROPERTY_ENQUIRY';

CREATE INDEX IF NOT EXISTS ix_property_expiry
    ON property_listings(expires_at)
    WHERE status='PUBLISHED' AND expires_at IS NOT NULL;
