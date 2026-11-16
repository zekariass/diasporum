-- =============================================================================
-- COUNTRY-BASED BILLING AND SUBSCRIPTION ARCHITECTURE
--
-- Additive only. Adds the configuration layer that lets a country gain a
-- payment capability by configuration rather than by schema change:
--   * payment_providers                        — provider registry
--   * payment_provider_country_capabilities    — provider x country matrix
--   * country_billing_settings                 — per-country billing policy
--   * billing_payment_proofs                  — manual-verification evidence
-- and the columns that let one plan be sold as either a provider-renewed
-- (RECURRING) or a fixed-term prepaid (PREPAID) arrangement.
--
-- Entitlements stay provider-neutral: the existing resolver reads
-- billing_subscriptions/billing_plan_entitlements and is untouched, so SILVER
-- grants the same entitlements whether it was bought through Stripe, Apple,
-- Google, Telebirr, Chapa or a verified bank transfer.
-- =============================================================================

-- =====================================================================
-- 0. NOTIFICATION TYPE FOR PREPAID RENEWAL REMINDERS
-- =====================================================================

-- Added here and only used at runtime by the reminder job, so the
-- "cannot use a new enum value in the same transaction" rule does not apply
-- and this migration stays transactional.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'BILLING_RENEWAL_REMINDER';

-- =====================================================================
-- 1. PAYMENT PROVIDER REGISTRY
-- =====================================================================

-- integration_type drives how a payment reaches SUCCEEDED:
--   API           — server-to-server call plus webhook confirmation
--   SDK_RECEIPT   — client-side purchase, receipt validated server-side
--   MANUAL        — customer pays out of band; staff verify a payment proof
CREATE TABLE payment_providers (
    provider_key text PRIMARY KEY
        CHECK(provider_key = upper(trim(provider_key)) AND provider_key ~ '^[A-Z][A-Z0-9_]*$'),
    display_name text NOT NULL,
    integration_type text NOT NULL CHECK(integration_type IN ('API','SDK_RECEIPT','MANUAL')),
    is_active boolean NOT NULL DEFAULT true,
    config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(config)='object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- A country gains (or loses) a payment capability by inserting/updating a row
-- here. supported_methods and supported_currencies are deliberately NOT
-- constrained to a fixed vocabulary: a new method must not require a migration.
-- Known methods: CARD, MOBILE_MONEY, BANK_TRANSFER, APPLE_IAP, GOOGLE_PLAY.
CREATE TABLE payment_provider_country_capabilities (
    provider_key text NOT NULL REFERENCES payment_providers(provider_key) ON DELETE CASCADE,
    country_id uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
    is_enabled boolean NOT NULL DEFAULT true,
    supports_one_time boolean NOT NULL DEFAULT false,
    supports_recurring boolean NOT NULL DEFAULT false,
    supports_refund boolean NOT NULL DEFAULT false,
    requires_manual_verification boolean NOT NULL DEFAULT false,
    supported_currencies text[] NOT NULL DEFAULT ARRAY[]::text[],
    supported_methods text[] NOT NULL DEFAULT ARRAY[]::text[],
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider_key, country_id)
);
CREATE INDEX ix_payment_provider_capabilities_country
    ON payment_provider_country_capabilities(country_id, is_enabled);

-- =====================================================================
-- 2. COUNTRY BILLING POLICY
-- =====================================================================

-- Per-country billing policy, following the marketplace_country_settings /
-- ticket_fee_configurations precedent. recurring_billing_enabled gates
-- auto-renewing subscriptions; prepaid_terms_enabled gates fixed-term ones.
-- A country turning recurring_billing_enabled on never converts existing
-- prepaid subscriptions — see billing_subscriptions.billing_arrangement.
--
-- ON DELETE CASCADE matches the codebase's existing one-row-per-country
-- config tables (spare_bag_country_config, country_verification_config):
-- deleting a country's row is expected to take its config with it. RESTRICT
-- would also make this table's rows outlive the country they configure in a
-- disposable test database, which breaks the "DELETE FROM countries" cleanup
-- pattern every other module's integration test already relies on.
CREATE TABLE country_billing_settings (
    country_id uuid PRIMARY KEY REFERENCES countries(id) ON DELETE CASCADE,
    billing_enabled boolean NOT NULL DEFAULT false,
    subscriptions_enabled boolean NOT NULL DEFAULT false,
    default_currency char(3) NOT NULL CHECK(default_currency ~ '^[A-Z]{3}$'),
    supported_currencies text[] NOT NULL DEFAULT ARRAY[]::text[],
    recurring_billing_enabled boolean NOT NULL DEFAULT false,
    manual_verification_enabled boolean NOT NULL DEFAULT false,
    prepaid_terms_enabled boolean NOT NULL DEFAULT true,
    is_active boolean NOT NULL DEFAULT true,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(default_currency = ANY(supported_currencies))
);

-- =====================================================================
-- 3. MANUAL VERIFICATION EVIDENCE
-- =====================================================================

-- Evidence a customer submits for a MANUAL provider payment (bank transfer
-- reference, mobile-money transaction code, optional receipt image). Staff
-- verification of a proof — never a webhook — drives the payment to SUCCEEDED.
CREATE TABLE billing_payment_proofs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id uuid NOT NULL REFERENCES billing_payments(id) ON DELETE RESTRICT,
    submitted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    proof_reference text,
    media_object_id uuid REFERENCES media_objects(id) ON DELETE SET NULL,
    notes text,
    status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','VERIFIED','REJECTED')),
    verified_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    verified_at timestamptz,
    rejection_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK(status <> 'VERIFIED' OR verified_at IS NOT NULL),
    CHECK(status <> 'VERIFIED' OR verified_by_user_id IS NOT NULL)
);
CREATE INDEX ix_billing_payment_proofs_payment ON billing_payment_proofs(payment_id);
-- Admin verification queue
CREATE INDEX ix_billing_payment_proofs_queue ON billing_payment_proofs(status, created_at);
CREATE INDEX ix_billing_payment_proofs_submitted_by
    ON billing_payment_proofs(submitted_by_user_id) WHERE submitted_by_user_id IS NOT NULL;
CREATE INDEX ix_billing_payment_proofs_verified_by
    ON billing_payment_proofs(verified_by_user_id) WHERE verified_by_user_id IS NOT NULL;
CREATE INDEX ix_billing_payment_proofs_media
    ON billing_payment_proofs(media_object_id) WHERE media_object_id IS NOT NULL;

-- =====================================================================
-- 4. PRICE OPTIONS: COUNTRY, TERM LENGTH AND ARRANGEMENT
-- =====================================================================

-- country_id NULL = currency-level default, used when no country-specific row
-- exists. interval_count x billing_interval is the term length (e.g. 3 MONTH).
-- billing_arrangement separates provider-renewed prices from prepaid terms so
-- the same plan can be offered both ways in different countries.
ALTER TABLE billing_plan_prices
    ADD COLUMN country_id uuid REFERENCES countries(id) ON DELETE CASCADE,
    ADD COLUMN interval_count integer NOT NULL DEFAULT 1 CHECK(interval_count > 0),
    ADD COLUMN billing_arrangement text NOT NULL DEFAULT 'RECURRING'
        CHECK(billing_arrangement IN ('RECURRING','PREPAID'));

-- The baseline UNIQUE(plan_id,currency_code,billing_interval,effective_from) no
-- longer distinguishes a price option. Drop it by discovery: the inline table
-- constraint has a generated name that PostgreSQL truncates to 63 characters.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'billing_plan_prices'::regclass AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%plan_id%'
      AND pg_get_constraintdef(oid) LIKE '%effective_from%'
      AND pg_get_constraintdef(oid) NOT LIKE '%billing_arrangement%'
  LOOP EXECUTE format('ALTER TABLE billing_plan_prices DROP CONSTRAINT %I', c.conname); END LOOP;
END $$;

-- NULLS NOT DISTINCT (PG15+) so currency-level defaults (country_id IS NULL)
-- are still held unique instead of permitting unlimited duplicate rows.
CREATE UNIQUE INDEX ux_billing_plan_price_option
    ON billing_plan_prices(plan_id, country_id, currency_code, billing_interval,
        interval_count, billing_arrangement, effective_from)
    NULLS NOT DISTINCT;

CREATE INDEX ix_billing_plan_prices_country ON billing_plan_prices(country_id, is_active)
    WHERE country_id IS NOT NULL;
CREATE INDEX ix_billing_plan_prices_arrangement ON billing_plan_prices(billing_arrangement);

-- =====================================================================
-- 5. SUBSCRIPTION ARRANGEMENT, PROVENANCE AND COUNTRY SNAPSHOT
-- =====================================================================

-- Existing rows all assume provider-driven renewal, so DEFAULT 'RECURRING' is
-- correct and no backfill is required.
--
-- country_id/currency_code are purchase-time snapshots: an admin re-pricing a
-- plan, or a country later enabling recurring billing, must not retroactively
-- change the terms a subscriber already bought.
--
-- source_order_id points at the order that most recently paid for the current
-- term. For PREPAID subscriptions the billing_orders/billing_payments rows
-- carrying this subscription_id are the term history.
ALTER TABLE billing_subscriptions
    ADD COLUMN billing_arrangement text NOT NULL DEFAULT 'RECURRING'
        CHECK(billing_arrangement IN ('RECURRING','PREPAID')),
    ADD COLUMN source_type text NOT NULL DEFAULT 'PURCHASE'
        CHECK(source_type IN ('PURCHASE','ADMIN_GRANT','PROMOTION','TRIAL','MIGRATION')),
    ADD COLUMN country_id uuid REFERENCES countries(id) ON DELETE SET NULL,
    ADD COLUMN currency_code char(3) CHECK(currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
    ADD COLUMN source_order_id uuid REFERENCES billing_orders(id) ON DELETE SET NULL,
    ADD COLUMN provider_billing_id text,
    ADD COLUMN renewal_reminder_sent_at timestamptz;

-- Drives the prepaid expiry and renewal-reminder jobs.
CREATE INDEX ix_billing_subscriptions_arrangement_period
    ON billing_subscriptions(billing_arrangement, status, current_period_end);
CREATE INDEX ix_billing_subscriptions_country ON billing_subscriptions(country_id)
    WHERE country_id IS NOT NULL;
CREATE INDEX ix_billing_subscriptions_source_order ON billing_subscriptions(source_order_id)
    WHERE source_order_id IS NOT NULL;

-- =====================================================================
-- 6. ORDER SUBSCRIPTION AND COUNTRY LINKAGE
-- =====================================================================

-- subscription_id is set on renewal orders (and on the order that creates a
-- subscription once it exists), making each order one term in the history.
--
-- plan_price_id records exactly which price option was bought. Activation
-- happens later than checkout — for manual verification, days later — so the
-- purchased term length has to be recoverable from the order rather than
-- re-derived from current pricing. Pointing at the historical price row is
-- also what lets an admin re-price a plan without altering terms a subscriber
-- already bought: price rows are retired (is_active/effective_until), never
-- rewritten, so this reference keeps resolving to what was actually sold.
ALTER TABLE billing_orders
    ADD COLUMN subscription_id uuid REFERENCES billing_subscriptions(id) ON DELETE SET NULL,
    ADD COLUMN country_id uuid REFERENCES countries(id) ON DELETE SET NULL,
    ADD COLUMN plan_price_id uuid REFERENCES billing_plan_prices(id) ON DELETE SET NULL;

CREATE INDEX ix_billing_orders_subscription ON billing_orders(subscription_id)
    WHERE subscription_id IS NOT NULL;
CREATE INDEX ix_billing_orders_country ON billing_orders(country_id)
    WHERE country_id IS NOT NULL;
CREATE INDEX ix_billing_orders_plan_price ON billing_orders(plan_price_id)
    WHERE plan_price_id IS NOT NULL;

-- =====================================================================
-- 7. DEFERRED: provider_key REFERENTIAL INTEGRITY
-- =====================================================================

-- billing_subscriptions.provider_key, billing_orders.provider_key,
-- billing_payments.provider_key, billing_webhook_events.provider_key and
-- billing_provider_products.provider_key are pre-existing free-text columns
-- that may already hold values not present in payment_providers. Adding FK
-- constraints to payment_providers would fail or reject historical rows, so
-- provider validity is enforced in the service layer on write. Revisit once
-- the existing values have been reconciled with the registry.
