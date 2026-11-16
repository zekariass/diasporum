-- v10.14 matchmaking photo, privacy and gender correction.
--
-- Replaces the single-photo matchmaking profile (photo_media_id +
-- blurred_photo_media_id + name/photo visibility enums) with:
--   * matchmaking_profile_photos — an ordered gallery with one primary photo.
--   * blur_photos_until_match / hide_name_until_match booleans.
--   * a MALE/FEMALE-only gender catalogue with automatic opposite-gender
--     compatibility (the selectable matchmaking_preference_genders table is
--     retired).
-- Blurred renditions remain generic media_objects rows produced through the
-- shared media-derivative pipeline; the photo collection references originals
-- only.

-- ---------------------------------------------------------------------------
-- 1. Ordered multi-photo collection with a single primary photo per profile.
-- ---------------------------------------------------------------------------
CREATE TABLE matchmaking_profile_photos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES matchmaking_profiles(user_id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE RESTRICT,
    sort_order integer NOT NULL DEFAULT 0,
    is_primary boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_matchmaking_profile_photos_media UNIQUE(user_id, media_id)
);
-- At most one primary photo per profile.
CREATE UNIQUE INDEX ux_matchmaking_profile_photos_primary
    ON matchmaking_profile_photos(user_id) WHERE is_primary;
-- Deterministic ordering positions within a profile.
CREATE UNIQUE INDEX ux_matchmaking_profile_photos_order
    ON matchmaking_profile_photos(user_id, sort_order);
CREATE INDEX ix_matchmaking_profile_photos_media ON matchmaking_profile_photos(media_id);
CREATE TRIGGER trg_matchmaking_profile_photos_updated_at BEFORE UPDATE ON matchmaking_profile_photos
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE matchmaking_profile_photos IS
    'Ordered matchmaking profile photo collection. media_id references the original image only; blurred renditions are generic media derivatives resolved server-side by viewer relationship.';

-- Photo media must be the owner's own MATCHMAKING_PROFILE_PHOTO asset.
CREATE OR REPLACE FUNCTION validate_matchmaking_profile_photo()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_owner uuid; v_purpose text;
BEGIN
    SELECT owner_user_id,purpose INTO v_owner,v_purpose FROM media_objects WHERE id=NEW.media_id;
    IF v_owner IS DISTINCT FROM NEW.user_id OR v_purpose <> 'MATCHMAKING_PROFILE_PHOTO' THEN
        RAISE EXCEPTION 'Matchmaking profile photo must be owned by the user and use MATCHMAKING_PROFILE_PHOTO purpose' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_matchmaking_profile_photo_integrity BEFORE INSERT OR UPDATE ON matchmaking_profile_photos
FOR EACH ROW EXECUTE FUNCTION validate_matchmaking_profile_photo();

-- Deleting the primary photo promotes the next photo in deterministic order so
-- a profile can never be left with zero primary photos while photos remain.
CREATE OR REPLACE FUNCTION matchmaking_photo_promote_primary()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.is_primary THEN
        UPDATE matchmaking_profile_photos SET is_primary=true
        WHERE id = (SELECT id FROM matchmaking_profile_photos
                    WHERE user_id=OLD.user_id ORDER BY sort_order, created_at LIMIT 1);
    END IF;
    RETURN OLD;
END;
$$;
CREATE TRIGGER trg_matchmaking_photo_promote_primary AFTER DELETE ON matchmaking_profile_photos
FOR EACH ROW EXECUTE FUNCTION matchmaking_photo_promote_primary();

-- ---------------------------------------------------------------------------
-- 2. New privacy booleans, migrated from the visibility enums.
-- ---------------------------------------------------------------------------
ALTER TABLE matchmaking_profiles
    ADD COLUMN blur_photos_until_match boolean NOT NULL DEFAULT true,
    ADD COLUMN hide_name_until_match boolean NOT NULL DEFAULT true;
-- VISIBLE mapped to "revealed"; BLURRED and HIDDEN mapped to "protected until
-- match". There is no longer a state that hides photos entirely.
UPDATE matchmaking_profiles SET blur_photos_until_match = (photo_visibility <> 'VISIBLE');
UPDATE matchmaking_profiles SET hide_name_until_match = (name_visibility <> 'VISIBLE');

-- ---------------------------------------------------------------------------
-- 3. Retire manually selectable gender preferences (automatic opposite-gender
--    discovery replaces them) and restrict the catalogue to MALE/FEMALE.
-- ---------------------------------------------------------------------------
DROP TABLE matchmaking_preference_genders;

ALTER TABLE matchmaking_profiles DROP CONSTRAINT matchmaking_profiles_gender_key_fkey;
UPDATE matchmaking_genders SET gender_key='FEMALE' WHERE gender_key='WOMAN';
UPDATE matchmaking_genders SET gender_key='MALE' WHERE gender_key='MAN';
UPDATE matchmaking_profiles SET gender_key='FEMALE' WHERE gender_key='WOMAN';
UPDATE matchmaking_profiles SET gender_key='MALE' WHERE gender_key='MAN';
-- Legacy non-binary/other values stay in the catalogue for referential
-- integrity of historical rows but are deactivated and rejected by the
-- application for new or activated profiles.
UPDATE matchmaking_genders SET is_active=false WHERE gender_key NOT IN ('MALE','FEMALE');
ALTER TABLE matchmaking_profiles ADD CONSTRAINT matchmaking_profiles_gender_key_fkey
    FOREIGN KEY (gender_key) REFERENCES matchmaking_genders(gender_key) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- 4. Backfill the legacy single photo into the collection as the primary.
-- ---------------------------------------------------------------------------
INSERT INTO matchmaking_profile_photos(user_id, media_id, sort_order, is_primary)
SELECT mp.user_id, mp.photo_media_id, 0, true
FROM matchmaking_profiles mp
WHERE mp.photo_media_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM media_objects m WHERE m.id=mp.photo_media_id
              AND m.owner_user_id=mp.user_id AND m.purpose='MATCHMAKING_PROFILE_PHOTO'
              AND m.status<>'DELETED')
ON CONFLICT ON CONSTRAINT uq_matchmaking_profile_photos_media DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Drop the superseded profile-level photo columns and visibility enums.
-- ---------------------------------------------------------------------------
ALTER TABLE matchmaking_profiles
    DROP COLUMN photo_media_id,
    DROP COLUMN blurred_photo_media_id,
    DROP COLUMN photo_visibility,
    DROP COLUMN name_visibility;
DROP TYPE matchmaking_field_visibility;

-- ---------------------------------------------------------------------------
-- 6. Profile integrity: activation requires a READY primary photo and a
--    supported gender; photo fields are no longer part of the profile row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_matchmaking_profile()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_owner uuid; v_address_visibility address_visibility;
BEGIN
    IF NEW.status='ACTIVE' AND NOT matchmaking_account_is_adult(NEW.user_id) THEN
        RAISE EXCEPTION 'Matchmaking requires an active account, confirmed date of birth and age 18+' USING ERRCODE='23514';
    END IF;
    IF NEW.status='ACTIVE' AND NEW.gender_key NOT IN ('MALE','FEMALE') THEN
        RAISE EXCEPTION 'Matchmaking gender must be MALE or FEMALE' USING ERRCODE='23514';
    END IF;
    IF NEW.status='ACTIVE' AND NOT EXISTS (SELECT 1 FROM matchmaking_preferences pref WHERE pref.user_id=NEW.user_id) THEN
        RAISE EXCEPTION 'Matchmaking preferences must be configured before profile activation' USING ERRCODE='23514';
    END IF;
    IF NEW.status='ACTIVE' AND NOT EXISTS (
        SELECT 1 FROM matchmaking_profile_photos pp JOIN media_objects m ON m.id=pp.media_id
        WHERE pp.user_id=NEW.user_id AND pp.is_primary AND m.status='READY') THEN
        RAISE EXCEPTION 'An active matchmaking profile requires a READY primary photo' USING ERRCODE='23514';
    END IF;
    IF NEW.address_id IS NOT NULL THEN
        SELECT visibility,owner_user_id INTO v_address_visibility,v_owner FROM addresses WHERE id=NEW.address_id;
        IF v_address_visibility IS DISTINCT FROM 'PRIVATE' OR v_owner IS DISTINCT FROM NEW.user_id THEN
            RAISE EXCEPTION 'Matchmaking location must be a private address owned by this user' USING ERRCODE='23514';
        END IF;
    END IF;
    IF EXISTS (
        SELECT 1 FROM matchmaking_preferences pref
        JOIN user_privacy_settings ups ON ups.user_id=pref.user_id
        WHERE pref.user_id=NEW.user_id AND pref.max_distance_km IS NOT NULL
          AND ups.allow_matchmaking_discovery=true
    ) AND NOT EXISTS (SELECT 1 FROM user_discovery_locations dl WHERE dl.user_id=NEW.user_id) THEN
        RAISE EXCEPTION 'A profile using distance-based matchmaking requires an opted-in approximate discovery location' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Mutual compatibility: automatic opposite-gender rule replaces the
--    selectable preference_genders checks. All other bilateral preferences
--    are unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION matchmaking_users_compatible(p_user_a uuid,p_user_b uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
WITH pair AS (
 SELECT a.user_id AS a_id,b.user_id AS b_id,a.gender_key AS a_gender,b.gender_key AS b_gender,
        a.religion_id AS a_religion,b.religion_id AS b_religion,a.has_children AS a_children,b.has_children AS b_children,
        a.wants_children AS a_wants,b.wants_children AS b_wants,
        a.verification_status AS a_verified,b.verification_status AS b_verified,
        pa.min_age AS a_min,pa.max_age AS a_max,pa.max_distance_km AS a_distance,pa.show_verified_only AS a_verified_only,
        pa.has_children_preference AS a_children_pref,pa.wants_children_preference AS a_wants_pref,
        pb.min_age AS b_min,pb.max_age AS b_max,pb.max_distance_km AS b_distance,pb.show_verified_only AS b_verified_only,
        pb.has_children_preference AS b_children_pref,pb.wants_children_preference AS b_wants_pref,
        extract(year from age(current_date, p_a.date_of_birth))::integer AS a_age,
        extract(year from age(current_date, p_b.date_of_birth))::integer AS b_age
 FROM matchmaking_profiles a JOIN matchmaking_profiles b ON b.user_id=p_user_b
 JOIN matchmaking_preferences pa ON pa.user_id=a.user_id JOIN matchmaking_preferences pb ON pb.user_id=b.user_id
 JOIN profiles p_a ON p_a.id=a.user_id JOIN profiles p_b ON p_b.id=b.user_id
 WHERE a.user_id=p_user_a
), distances AS (
 SELECT pair.*, user_discovery_distance_km(a_id,b_id) AS distance_km FROM pair
)
SELECT EXISTS (
 SELECT 1 FROM distances d
 WHERE d.a_id<>d.b_id
   AND matchmaking_user_is_eligible(d.a_id) AND matchmaking_user_is_eligible(d.b_id)
   AND d.a_gender IN ('MALE','FEMALE') AND d.b_gender IN ('MALE','FEMALE') AND d.a_gender<>d.b_gender
   AND d.b_age BETWEEN d.a_min AND d.a_max AND d.a_age BETWEEN d.b_min AND d.b_max
   AND (d.a_children_pref='ANY' OR (d.a_children_pref='YES' AND d.b_children IS TRUE) OR (d.a_children_pref='NO' AND d.b_children IS FALSE))
   AND (d.b_children_pref='ANY' OR (d.b_children_pref='YES' AND d.a_children IS TRUE) OR (d.b_children_pref='NO' AND d.a_children IS FALSE))
   AND (d.a_wants_pref='ANY' OR d.a_wants_pref=d.b_wants)
   AND (d.b_wants_pref='ANY' OR d.b_wants_pref=d.a_wants)
   AND (NOT EXISTS(SELECT 1 FROM matchmaking_preference_religions r WHERE r.user_id=d.a_id)
        OR EXISTS(SELECT 1 FROM matchmaking_preference_religions r WHERE r.user_id=d.a_id AND r.religion_id=d.b_religion))
   AND (NOT EXISTS(SELECT 1 FROM matchmaking_preference_religions r WHERE r.user_id=d.b_id)
        OR EXISTS(SELECT 1 FROM matchmaking_preference_religions r WHERE r.user_id=d.b_id AND r.religion_id=d.a_religion))
   AND (NOT EXISTS(SELECT 1 FROM matchmaking_preference_languages l WHERE l.user_id=d.a_id)
        OR EXISTS(SELECT 1 FROM matchmaking_preference_languages l JOIN user_languages ul ON ul.language_id=l.language_id WHERE l.user_id=d.a_id AND ul.user_id=d.b_id))
   AND (NOT EXISTS(SELECT 1 FROM matchmaking_preference_languages l WHERE l.user_id=d.b_id)
        OR EXISTS(SELECT 1 FROM matchmaking_preference_languages l JOIN user_languages ul ON ul.language_id=l.language_id WHERE l.user_id=d.b_id AND ul.user_id=d.a_id))
   AND (NOT d.a_verified_only OR d.b_verified='VERIFIED')
   AND (NOT d.b_verified_only OR d.a_verified='VERIFIED')
   AND (d.a_distance IS NULL OR (d.distance_km IS NOT NULL AND d.distance_km <= d.a_distance))
   AND (d.b_distance IS NULL OR (d.distance_km IS NOT NULL AND d.distance_km <= d.b_distance))
);
$$;
