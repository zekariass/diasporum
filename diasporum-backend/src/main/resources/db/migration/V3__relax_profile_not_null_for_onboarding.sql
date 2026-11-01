-- Allow profiles to be built up progressively during onboarding.
-- Completion is tracked by profile_completed_at (set by application logic once all
-- required fields are present), not by NOT NULL column constraints.

ALTER TABLE profiles ALTER COLUMN display_name      DROP NOT NULL;
ALTER TABLE profiles ALTER COLUMN origin_country_id  DROP NOT NULL;
ALTER TABLE profiles ALTER COLUMN current_country_id DROP NOT NULL;

-- Relax the display_name CHECK to allow NULL (was: length BETWEEN 1 AND 80).
-- Non-null values still must be within bounds.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_display_name_check;
ALTER TABLE profiles ADD  CONSTRAINT profiles_display_name_check
    CHECK (display_name IS NULL OR length(trim(display_name)) BETWEEN 1 AND 80);
