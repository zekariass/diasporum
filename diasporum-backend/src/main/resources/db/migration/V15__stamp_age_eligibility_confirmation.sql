-- Backfill age_eligibility_confirmed_at for profiles that already supplied a
-- date of birth. Supplying the birth date is the confirmation act (the 18+
-- check itself uses date_of_birth directly), so the stamp records when the
-- profile data was last saved. Under-18 accounts stay ineligible via the DOB
-- predicate regardless of this stamp.
UPDATE profiles
SET age_eligibility_confirmed_at = updated_at
WHERE date_of_birth IS NOT NULL
  AND age_eligibility_confirmed_at IS NULL;
