-- =====================================================================
-- V38 — Organiser payout account encryption at rest
-- =====================================================================
-- V31 §6d requires the application to encrypt account_number, iban,
-- bank_details and mobile_money_phone at rest. The plaintext-sized column
-- types (iban varchar(34), account_number varchar(64),
-- mobile_money_phone varchar(20)) cannot hold AES-GCM ciphertext, so they
-- are widened to text. Values are stored as "v1:" + base64(iv || ciphertext)
-- by the events ticketing PayoutDataCipher; bank_details / other_details keep
-- their jsonb type and hold {"enc":"v1:..."} envelopes.
--
-- Existing CHECKs (BANK_ACCOUNT needs iban/account_number/bank_details,
-- MOBILE_MONEY needs provider + phone, OTHER needs other_details) are
-- unaffected: ciphertext is never NULL and envelopes are never '{}'.
-- Idempotent: ALTER COLUMN ... TYPE text is a no-op on re-run.

ALTER TABLE event_organiser_payout_accounts
    ALTER COLUMN iban TYPE text,
    ALTER COLUMN account_number TYPE text,
    ALTER COLUMN mobile_money_phone TYPE text;

COMMENT ON COLUMN event_organiser_payout_accounts.iban IS
    'AES-GCM ciphertext ("v1:" + base64(iv||ct)); never returned unmasked except to platform admins';
COMMENT ON COLUMN event_organiser_payout_accounts.account_number IS
    'AES-GCM ciphertext ("v1:" + base64(iv||ct)); never returned unmasked except to platform admins';
COMMENT ON COLUMN event_organiser_payout_accounts.mobile_money_phone IS
    'AES-GCM ciphertext ("v1:" + base64(iv||ct)); never returned unmasked except to platform admins';
COMMENT ON COLUMN event_organiser_payout_accounts.bank_details IS
    'Encrypted envelope {"enc":"v1:..."} of the country-specific bank fields validated against payout_account_field_requirements';
