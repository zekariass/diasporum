-- =============================================================================
-- V37: feed post multi-community targeting support
-- V31 already added feed_posts.target_mode/cta_label/cta_url and the
-- feed_post_community_stats table; this migration adds what the application
-- layer still needs on top of that: a denormalized author-country snapshot
-- (so feed's own SQL can resolve ALL_SAME_ORIGIN/ALL_SAME_CURRENT_COUNTRY
-- audiences without joining identity's profiles table) and the missing
-- ALL_SAME_CURRENT_COUNTRY billing feature key.
-- =============================================================================

-- 1. Denormalized author country snapshot, populated once at post-creation
--    time from IdentityApi.profileSummary — the same "snapshot at publish
--    time, never resynced" pattern feed_posts.country_id already uses.
--    Deliberately NOT kept in sync with later profile country changes.
ALTER TABLE feed_posts
    ADD COLUMN IF NOT EXISTS author_origin_country_id uuid NULL
        REFERENCES countries(id),
    ADD COLUMN IF NOT EXISTS author_current_country_id uuid NULL
        REFERENCES countries(id);

COMMENT ON COLUMN feed_posts.author_origin_country_id IS
    'Snapshot of the author profile origin_country_id at post-creation time '
    '(via IdentityApi) — not resynced on later profile changes. Powers '
    'ALL_SAME_ORIGIN audience resolution without feed joining profiles.';
COMMENT ON COLUMN feed_posts.author_current_country_id IS
    'Snapshot of the author profile current_country_id at post-creation time '
    '(via IdentityApi) — not resynced on later profile changes. Powers '
    'ALL_SAME_CURRENT_COUNTRY audience resolution without feed joining profiles.';

-- Supports the communityFeed WHERE-clause branches for broadcast modes.
CREATE INDEX IF NOT EXISTS ix_feed_posts_target_origin
    ON feed_posts(target_mode, author_origin_country_id)
    WHERE target_mode = 'ALL_SAME_ORIGIN';
CREATE INDEX IF NOT EXISTS ix_feed_posts_target_current_country
    ON feed_posts(target_mode, author_current_country_id)
    WHERE target_mode = 'ALL_SAME_CURRENT_COUNTRY';

-- 2. New billing feature for ALL_SAME_CURRENT_COUNTRY targeting — mirrors
--    V32 section 3a's TARGET_ALL_SAME_ORIGIN_COMMUNITIES seeding exactly.
--    No feature_access_rules row: fail-closed by default (unlike
--    VIEW_SAME_ORIGIN_COMMUNITY_CONTENT's V34 free launch default), matching
--    TARGET_ALL_SAME_ORIGIN_COMMUNITIES's own precedent — an admin must
--    configure this entitlement before it can be used.
INSERT INTO billing_features(feature_key, display_name, description, feature_kind, reset_period) VALUES
 ('TARGET_ALL_SAME_CURRENT_COUNTRY_COMMUNITIES','Target all same-current-country communities','Allows user to create posts broadcast to all communities sharing their current (destination) country','BOOLEAN',NULL)
ON CONFLICT(feature_key) DO NOTHING;

INSERT INTO billing_plan_entitlements(plan_id, feature_id, enabled, quantity_limit, reset_period, config)
SELECT p.id, f.id, false, NULL, NULL,
       jsonb_build_object('requires_admin_configuration', true,
           'note', 'Configure cross-community entitlements before enabling.')
FROM billing_plans p
CROSS JOIN billing_features f
WHERE f.feature_key = 'TARGET_ALL_SAME_CURRENT_COUNTRY_COMMUNITIES'
ON CONFLICT(plan_id, feature_id) DO NOTHING;
