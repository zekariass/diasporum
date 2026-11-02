-- Jobs module ownership, lifecycle and discovery support (forward-only).
-- Business ownership and its contextual-messaging FK already exist in the v10.12 baseline.
ALTER TABLE job_listings ADD COLUMN deleted_at timestamptz;

CREATE INDEX ix_job_listings_business_account
    ON job_listings(business_account_id, created_at DESC, id DESC)
    WHERE business_account_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_job_listings_employer
    ON job_listings(employer_user_id, created_at DESC, id DESC)
    WHERE employer_user_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_job_listings_discovery
    ON job_listings(published_at DESC, id DESC)
    WHERE status = 'PUBLISHED' AND deleted_at IS NULL;
CREATE INDEX ix_job_listings_closing_discovery
    ON job_listings(closes_at, id)
    WHERE status = 'PUBLISHED' AND deleted_at IS NULL AND closes_at IS NOT NULL;
CREATE INDEX ix_job_saves_cursor
    ON job_saves(user_id, created_at DESC, job_id DESC);
CREATE INDEX ix_job_applications_applicant_cursor
    ON job_applications(applicant_id, submitted_at DESC, id DESC);

-- One open Jobs report per reporter and listing. Resolved reports do not block
-- a later, separate report. The insert path also maps races to HTTP 409.
CREATE UNIQUE INDEX ux_job_reports_open_reporter_target
    ON reports(reporter_id, target_id)
    WHERE status = 'OPEN' AND target_type = 'JOB';

COMMENT ON COLUMN job_listings.business_account_id IS
    'Business Account owner; accepted active membership and Jobs role policy are rechecked by the backend.';
COMMENT ON COLUMN job_listings.deleted_at IS
    'Soft-deletion timestamp; the approved job_status remains unchanged for lifecycle/audit history.';
