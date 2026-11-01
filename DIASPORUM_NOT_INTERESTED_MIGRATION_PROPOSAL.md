# Proposal — Not Interested Migration (AWAITING APPROVAL — do not apply)
**File:** proposed `V7__user_feed_preferences.sql` — NOT in `db/migration`, not applied to `diasporum_dev`.

## Concept separation (per spec — stays distinct)
**Save** = retain (`post_saves` — exists). **Mute** = hide a *user* (`personal_mutes` — Social). **Block** = forbid interaction (`user_blocks` — Social). **Not Interested** = hide a *content item or category* — Feed-owned, none of the above.

## SQL — one table
```sql
CREATE TABLE user_feed_preferences (
    user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK(kind IN ('ITEM','CATEGORY')),
    content_type content_reference_type NOT NULL,
    content_id uuid,                -- NULL for CATEGORY rows
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK((kind='ITEM') = (content_id IS NOT NULL))
);
CREATE UNIQUE INDEX ux_ufp_item ON user_feed_preferences(user_id,content_type,content_id)
    WHERE kind='ITEM';
CREATE UNIQUE INDEX ux_ufp_cat  ON user_feed_preferences(user_id,content_type)
    WHERE kind='CATEGORY';
```
Undo = `DELETE` — permanent until undone; add `expires_at` later only if product wants temporary suppression.

## Behaviour
Feed queries exclude `kind='ITEM'` rows matching `(user_id,content_type,content_id)` and any post whose category/post_type matches a `kind='CATEGORY'` row. Works across Community/Following/Nearby and external `content_reference_type` values (EVENT/JOB/…) without duplicating domain records.

## Rollback / test plan
`DROP TABLE user_feed_preferences`. Tests: item hidden in all feeds; category hidden; undo restores; no cross-user effect; concurrent hide idempotent.
