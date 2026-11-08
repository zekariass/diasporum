-- Business Account creation idempotency.
-- A client-generated key lets POST /api/v1/business-accounts be retried safely:
-- a replayed key returns the originally created account instead of creating a
-- duplicate workspace after ambiguous network failures or double submissions.
CREATE TABLE business_account_creation_requests (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key text NOT NULL CHECK(length(trim(idempotency_key)) BETWEEN 1 AND 120),
    business_account_id uuid NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, idempotency_key)
);
CREATE INDEX ix_business_creation_requests_account
    ON business_account_creation_requests(business_account_id);
