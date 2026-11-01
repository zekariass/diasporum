-- V4: personal mutes (viewer-side content preference).
-- user_mutes is a platform-moderation restriction table (DB-enforced), not
-- usable for self-service muting → additive personal_mutes, same shape as
-- user_blocks.
CREATE TABLE personal_mutes (
    muter_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    muted_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(muter_user_id,muted_user_id),
    CHECK(muter_user_id <> muted_user_id)
);
-- Muted-list pagination: WHERE muter_user_id=? ORDER BY created_at DESC
CREATE INDEX ix_personal_mutes_muter_created ON personal_mutes(muter_user_id, created_at DESC);
