-- =============================================================================
-- COUNTRY BILLING SEEDS
--
-- Registry + country policy + provider x country capability examples. All
-- INSERTs are ON CONFLICT DO NOTHING and all country-keyed rows select from
-- countries by iso2, so a missing country seeds 0 rows and raises a NOTICE
-- rather than failing the migration (V32 pattern).
--
-- IMPORTANT — capability rows are configuration, not evidence of a working
-- integration. payment_providers.is_active is the kill switch that reflects
-- implementation reality: only BANK_TRANSFER has an adapter
-- (ManualPaymentProvider), so every other provider is seeded is_active=false.
-- Shipping an adapter is then a config change (flip is_active), never a
-- schema change.
--
-- No billing_plan_prices rows are seeded: prices are commercial decisions and
-- are configured by a platform admin per country, currency and arrangement.
-- =============================================================================

-- =====================================================================
-- 1. PROVIDER REGISTRY
-- =====================================================================

INSERT INTO payment_providers(provider_key, display_name, integration_type, is_active, config) VALUES
 ('BANK_TRANSFER','Bank Transfer','MANUAL',true,
  '{"adapter":"ManualPaymentProvider","instructions":"Configure bank account details per country in config.accounts before use.","accounts":{}}'::jsonb),
 ('STRIPE','Stripe','API',false,
  '{"adapter":null,"note":"No adapter implemented. Enable once API credentials and the webhook endpoint exist."}'::jsonb),
 ('APPLE_IAP','Apple In-App Purchase','SDK_RECEIPT',false,
  '{"adapter":null,"note":"No adapter implemented. Receipt validation required. Store country is provider data and is not the billing country."}'::jsonb),
 ('GOOGLE_PLAY','Google Play Billing','SDK_RECEIPT',false,
  '{"adapter":null,"note":"No adapter implemented. Purchase-token validation required. Store country is provider data and is not the billing country."}'::jsonb),
 ('TELEBIRR','Telebirr','API',false,
  '{"adapter":null,"note":"No adapter implemented. Until one exists, Ethiopian Telebirr payments are confirmed by staff verifying the customer transaction code."}'::jsonb),
 ('CHAPA','Chapa','API',false,
  '{"adapter":null,"note":"No adapter implemented. Until one exists, Chapa payments are confirmed by staff verifying the customer transaction reference."}'::jsonb),
 ('ARIFPAY','ArifPay','API',false,
  '{"adapter":null,"note":"No adapter implemented."}'::jsonb)
ON CONFLICT(provider_key) DO NOTHING;

-- =====================================================================
-- 2. COUNTRY BILLING POLICY EXAMPLES
-- =====================================================================

DO $$
DECLARE
    v_expected text[] := ARRAY['GB','US','ET'];
    v_found text[];
BEGIN
    SELECT array_agg(iso2) INTO v_found
      FROM countries WHERE iso2 = ANY(v_expected);
    IF array_length(v_expected,1) <> COALESCE(array_length(v_found,1),0) THEN
        RAISE NOTICE 'Missing countries for country billing settings: %',
            (SELECT array_agg(e) FROM unnest(v_expected) e
             WHERE e <> ALL(COALESCE(v_found,'{}')));
    END IF;
END $$;

-- GB: card-based auto-renewing subscriptions.
INSERT INTO country_billing_settings(country_id, billing_enabled, subscriptions_enabled,
        default_currency, supported_currencies, recurring_billing_enabled,
        manual_verification_enabled, prepaid_terms_enabled, notes)
SELECT c.id, true, true, 'GBP', ARRAY['GBP']::text[], true, false, true,
    'Recurring card billing plus the mobile stores. Prepaid terms remain available.'
FROM countries c WHERE c.iso2 = 'GB'
ON CONFLICT(country_id) DO NOTHING;

-- US: card-based auto-renewing subscriptions.
INSERT INTO country_billing_settings(country_id, billing_enabled, subscriptions_enabled,
        default_currency, supported_currencies, recurring_billing_enabled,
        manual_verification_enabled, prepaid_terms_enabled, notes)
SELECT c.id, true, true, 'USD', ARRAY['USD']::text[], true, false, true,
    'Recurring card billing plus the mobile stores. Prepaid terms remain available.'
FROM countries c WHERE c.iso2 = 'US'
ON CONFLICT(country_id) DO NOTHING;

-- ET: prepaid fixed terms only, paid out of band and verified by staff.
-- recurring_billing_enabled=false: no mandate/auto-debit rail is integrated.
INSERT INTO country_billing_settings(country_id, billing_enabled, subscriptions_enabled,
        default_currency, supported_currencies, recurring_billing_enabled,
        manual_verification_enabled, prepaid_terms_enabled, notes)
SELECT c.id, true, true, 'ETB', ARRAY['ETB']::text[], false, true, true,
    'Prepaid fixed-term subscriptions only. Payments are made by mobile money or bank transfer and confirmed by staff verifying a payment proof.'
FROM countries c WHERE c.iso2 = 'ET'
ON CONFLICT(country_id) DO NOTHING;

-- =====================================================================
-- 3. PROVIDER x COUNTRY CAPABILITY EXAMPLES
-- =====================================================================

-- GB: Stripe cards (one-time and recurring) plus both mobile stores.
INSERT INTO payment_provider_country_capabilities(provider_key, country_id, is_enabled,
        supports_one_time, supports_recurring, supports_refund,
        requires_manual_verification, supported_currencies, supported_methods, notes)
SELECT 'STRIPE', c.id, true, true, true, true, false,
    ARRAY['GBP']::text[], ARRAY['CARD']::text[],
    'Configuration only — the Stripe adapter is not implemented, so payment_providers.is_active is false.'
FROM countries c WHERE c.iso2 = 'GB'
ON CONFLICT(provider_key, country_id) DO NOTHING;

INSERT INTO payment_provider_country_capabilities(provider_key, country_id, is_enabled,
        supports_one_time, supports_recurring, supports_refund,
        requires_manual_verification, supported_currencies, supported_methods, notes)
SELECT 'APPLE_IAP', c.id, true, true, true, false, false,
    ARRAY['GBP']::text[], ARRAY['APPLE_IAP']::text[],
    'Configuration only — no receipt-validation adapter is implemented. Refunds are issued by Apple, not by the platform.'
FROM countries c WHERE c.iso2 = 'GB'
ON CONFLICT(provider_key, country_id) DO NOTHING;

INSERT INTO payment_provider_country_capabilities(provider_key, country_id, is_enabled,
        supports_one_time, supports_recurring, supports_refund,
        requires_manual_verification, supported_currencies, supported_methods, notes)
SELECT 'GOOGLE_PLAY', c.id, true, true, true, false, false,
    ARRAY['GBP']::text[], ARRAY['GOOGLE_PLAY']::text[],
    'Configuration only — no purchase-token-validation adapter is implemented. Refunds are issued by Google, not by the platform.'
FROM countries c WHERE c.iso2 = 'GB'
ON CONFLICT(provider_key, country_id) DO NOTHING;

-- US: Stripe cards.
INSERT INTO payment_provider_country_capabilities(provider_key, country_id, is_enabled,
        supports_one_time, supports_recurring, supports_refund,
        requires_manual_verification, supported_currencies, supported_methods, notes)
SELECT 'STRIPE', c.id, true, true, true, true, false,
    ARRAY['USD']::text[], ARRAY['CARD']::text[],
    'Configuration only — the Stripe adapter is not implemented, so payment_providers.is_active is false.'
FROM countries c WHERE c.iso2 = 'US'
ON CONFLICT(provider_key, country_id) DO NOTHING;

-- ET: bank transfer is the one rail with a working adapter today.
INSERT INTO payment_provider_country_capabilities(provider_key, country_id, is_enabled,
        supports_one_time, supports_recurring, supports_refund,
        requires_manual_verification, supported_currencies, supported_methods, notes)
SELECT 'BANK_TRANSFER', c.id, true, true, false, false, true,
    ARRAY['ETB']::text[], ARRAY['BANK_TRANSFER']::text[],
    'Customer transfers to a platform account and submits the reference; staff verify the proof. Refunds are handled out of band.'
FROM countries c WHERE c.iso2 = 'ET'
ON CONFLICT(provider_key, country_id) DO NOTHING;

-- ET mobile money: one-time prepaid terms, confirmed by staff verifying the
-- customer transaction code until an API adapter exists. supports_recurring is
-- false because no auto-debit mandate rail is integrated.
INSERT INTO payment_provider_country_capabilities(provider_key, country_id, is_enabled,
        supports_one_time, supports_recurring, supports_refund,
        requires_manual_verification, supported_currencies, supported_methods, notes)
SELECT 'TELEBIRR', c.id, true, true, false, false, true,
    ARRAY['ETB']::text[], ARRAY['MOBILE_MONEY']::text[],
    'Configuration only — no Telebirr API adapter is implemented, so payment_providers.is_active is false. Interim operation is manual verification of the transaction code.'
FROM countries c WHERE c.iso2 = 'ET'
ON CONFLICT(provider_key, country_id) DO NOTHING;

INSERT INTO payment_provider_country_capabilities(provider_key, country_id, is_enabled,
        supports_one_time, supports_recurring, supports_refund,
        requires_manual_verification, supported_currencies, supported_methods, notes)
SELECT 'CHAPA', c.id, true, true, false, false, true,
    ARRAY['ETB']::text[], ARRAY['MOBILE_MONEY','CARD']::text[],
    'Configuration only — no Chapa API adapter is implemented, so payment_providers.is_active is false. Interim operation is manual verification of the transaction reference.'
FROM countries c WHERE c.iso2 = 'ET'
ON CONFLICT(provider_key, country_id) DO NOTHING;
