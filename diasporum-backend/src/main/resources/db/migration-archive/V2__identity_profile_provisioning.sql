-- V2: allow provisional profiles created at first login.
-- The approved design keeps onboarding fields nullable until the user completes
-- onboarding. No sentinel country, no ONBOARDING status, no seeded rows.
ALTER TABLE profiles ALTER COLUMN display_name DROP NOT NULL;
ALTER TABLE profiles ALTER COLUMN origin_country_id DROP NOT NULL;
ALTER TABLE profiles ALTER COLUMN current_country_id DROP NOT NULL;
