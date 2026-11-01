# Proposal — Nearby Feed Migration (AWAITING APPROVAL — do not apply)
**File:** proposed `V6__feed_posts_location.sql` — NOT placed in `db/migration`, not applied to `diasporum_dev`.

## Why `feed_posts.location` (recommended)
Alternatives evaluated: (a) reuse `profiles.discovery_location` — wrong ownership, posts shouldn't depend on mutable user location and would leak author coordinates; (b) join via community centroid — not per-post, no real "nearby"; (c) `feed_posts.location geography(Point,4326) NULL` — correct: post-owned, privacy-safe (only the poster chooses to geo-tag), PostGIS-native. **Chose (c), null by default.**

## SQL
```sql
-- Nearby feed: optional per-post geo-tag. Privacy-safe — never exposed raw.
ALTER TABLE feed_posts
    ADD COLUMN location geography(Point,4326);
-- Partial GiST — only rows that opted in are indexed.
CREATE INDEX ix_feed_posts_location
    ON feed_posts USING gist(location)
    WHERE location IS NOT NULL AND status='PUBLISHED' AND deleted_at IS NULL;
```
Backward compatible: nullable, default null → all existing posts unaffected. Supply: client sends lat/lon at create-time only; `ST_SetSRID(ST_MakePoint(lon,lat),4326)` validated server-side; **never returned** in responses.

## Query strategy
`WHERE ST_DWithin(location, ST_MakePoint(?,?)::geography, ?)` + same visibility/block/mute/membership filters + keyset cursor. **Privacy:** no raw geometry, no numeric distance, no coordinates in payloads or logs — only membership in the radius (and optionally a bucketed area label like the community/city name). `ST_DWithin` uses the GiST index.

## Privacy implications
Opt-in per post only; never exposes author home or another user's position; radius-bucketed results only; respects COMMUNITY/COUNTRY scope + SocialApi block/mute.

## Rollback
`DROP INDEX ix_feed_posts_location; ALTER TABLE feed_posts DROP COLUMN location;` — safe (column is new, nothing depends on it).

## Test plan
PostGIS Testcontainers: insert geo-tagged + untagged posts; `ST_DWithin` inside/outside radius; verify no `location`/`distance` fields in JSON; cursor stability; block/mute exclusion.
