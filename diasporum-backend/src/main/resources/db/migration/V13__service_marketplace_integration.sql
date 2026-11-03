-- Service Marketplace integration and deterministic discovery support.
-- Core Service Marketplace tables are owned by the v10.12 baseline.

ALTER TABLE media_objects
    DROP CONSTRAINT IF EXISTS media_objects_purpose_check;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
            WHERE conname = 'media_objects_purpose_check') THEN
        ALTER TABLE media_objects
            ADD CONSTRAINT media_objects_purpose_check
            CHECK (purpose IN (
                'AVATAR', 'FEED_IMAGE', 'FEED_VIDEO', 'BUSINESS', 'EVENT', 'JOB',
                'PROPERTY', 'MATCHMAKING_PROFILE_PHOTO',
                'MATCHMAKING_PROFILE_BLURRED', 'CHAT_ATTACHMENT',
                'SPARE_BAG_LISTING', 'DOCUMENT', 'OTHER', 'MESSAGE_AUDIO',
                'MESSAGE_IMAGE', 'MESSAGE_DOCUMENT', 'VEHICLE', 'SERVICE_REQUEST'
            ));
    END IF;
END $$;

-- The companion configuration disables the surrounding transaction so the
-- committed labels can be used by subsequent statements in the same script.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'SERVICE_RESPONSE';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'SERVICE_REQUEST_UPDATE';

CREATE INDEX IF NOT EXISTS ix_service_providers_active_cursor
    ON service_providers(created_at DESC, id DESC)
    WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS ix_service_provider_services_category_provider
    ON service_provider_services(service_category_id, service_provider_id);
CREATE INDEX IF NOT EXISTS ix_service_requests_open_cursor
    ON service_requests(published_at DESC, id DESC)
    WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS ix_service_requests_open_country_cursor
    ON service_requests(country_id, published_at DESC, id DESC)
    WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS ix_service_requests_open_price_asc
    ON service_requests(currency_code, budget_min ASC, budget_max ASC, id ASC)
    WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS ix_service_requests_open_price_desc
    ON service_requests(currency_code, budget_min DESC, budget_max DESC, id DESC)
    WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS ix_service_responses_request_cursor
    ON service_request_responses(service_request_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_service_responses_provider_cursor
    ON service_request_responses(service_provider_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_service_reports_queue_cursor
    ON service_reports(status, created_at DESC, id DESC);
