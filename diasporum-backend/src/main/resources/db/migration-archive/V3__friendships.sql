-- V3: friendships table — required by the approved post-schema decision that
-- every mutual matchmaking match also creates a friendship record.
-- Ordered pair (user_a < user_b enforced in app) → one row per pair.
-- `origin` distinguishes match-created friendships from direct adds so that
-- unmatching can remove ONLY the match-created record (approved rule).
CREATE TABLE friendships (
    user_a uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    user_b uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    origin text NOT NULL CHECK(origin IN ('MATCHMAKING','DIRECT')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(user_a,user_b),
    CHECK(user_a < user_b)
);
-- Friend-list pagination: WHERE user_a=? OR user_b=? ORDER BY created_at DESC
CREATE INDEX ix_friendships_a_created ON friendships(user_a, created_at DESC);
CREATE INDEX ix_friendships_b_created ON friendships(user_b, created_at DESC);
