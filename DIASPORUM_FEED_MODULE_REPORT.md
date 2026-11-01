# Diasporum — Feed Module Report
**Date:** 2026-10-30 — no new migrations; V3/V4 still pending on `diasporum_dev`. No commits.

## Content Ownership Matrix (all 11 categories)

| Content type | Source | Status |
|---|---|---|
| GENERAL | `feed_posts` | ✅ implemented |
| ANNOUNCEMENT | `feed_posts` (post_type='ANNOUNCEMENT') | ✅ MODERATOR/COMMUNITY_ADMIN gated |
| GUIDE | Guides module | ⏸ module doesn't exist — pending |
| POLL | `feed_posts` + `feed_polls`/`_options`/`_votes` | ✅ implemented (Feed-owned) |
| EVENT | Events module | ⏸ module doesn't exist — pending |
| JOB | Jobs module | ⏸ module doesn't exist — pending |
| PROPERTY | Property module | ⏸ module doesn't exist — pending |
| VEHICLE | Vehicles module | ⏸ module doesn't exist — pending |
| BUSINESS | Business module | ⏸ module doesn't exist — pending |
| REEL | `feed_posts` (post_type='REEL') | ✅ implemented (FEED_VIDEO media required) |
| COMMUNITY_HELP | `feed_posts` + `community_help_posts` | ✅ REQUEST/OFFER + lifecycle |

5/11 fully integrated. The 4 remaining source modules (Guides, Events, Jobs, Property/Vehicles/Business) don't exist — their `content_reference_type` values already work in `user_content_views`, and Feed's opaque `TYPE:uuid` item ids reserve the slots.

## Schema (reused — zero new tables)
`feed_posts` (all post_type values), `feed_post_media`, `feed_post_comments` (+parent replies), `feed_post_reactions`, `post_saves`, `post_shares`, `community_help_posts`, `feed_polls`/`_options`/`_votes`, `user_content_views`. Comment/reaction counts maintained by DB triggers.

## `FeedApi` (root)
`post`, `posts` batch, `canView`, `commentCount`, `reactionCount`. `PostView` record — no internals.

## REST (`/api/v1/feed`)
Posts: `POST|GET|PATCH|DELETE /posts(/ {id})`. Feeds: `GET /community`, `GET /following`, `GET /reels/community`. Engagement: `PUT|DELETE /posts/{id}/reaction`, `PUT|DELETE /posts/{id}/save`, `POST /views`. Comments: `POST|GET /posts/{id}/comments`, `PATCH|DELETE /comments/{id}`. Community Help: `POST /community-help`, `PATCH /community-help/{id}/status`. Polls: `POST /polls`, `GET /polls/{id}`, `POST /polls/options/{id}/vote`.

## Behaviours
- **Post types** — all 10 enum values supported; `ANNOUNCEMENT` requires `community.isModeratorOrAbove`; `REEL` requires `FEED_VIDEO` media via `MediaApi.validateForAttach`; `POLL`/`COMMUNITY_HELP` insert as `DRAFT` → child rows → publish (trigger requires children before PUBLISHED)
- **Unified feed item** — `FEED_POST:{uuid}` opaque id, type-specific `payload` map, author summary via `IdentityApi.profileSummaries` batch
- **Eligibility** — published + `canInteract` + `mutedIds` (new `SocialApi` batch) + COMMUNITY-scope→membership / COUNTRY-scope→open
- **Ranking** — `user_content_views` LEFT JOIN: unviewed first, then `published_at DESC, id DESC`; opaque base64 cursor `(flag|ts|id)` — deterministic across types
- **Views** — `POST /views` upserts `user_content_views` (existence-checked); feed GET does NOT count as a view
- **Help** — OPEN→PAUSED/RESOLVED/CLOSED; PAUSED→OPEN/RESOLVED/CLOSED; terminal locked; author+moderator only; `expires_at` + consistency CHECKs respected
- **Polls** — 2-20 options, `allow_multiple`/`allow_vote_change`/`allow_vote_withdraw`/`closes_at`/`closed_at`/`results_visibility` enforced
- **Comments** — replies via `parent_comment_id`, own-edit/own-delete (or moderator), `comments_enabled` gate
- **Reactions** — LIKE/LOVE/HELPFUL/SUPPORT/THANKS, upsert (change), unreact; counts by trigger

## Feed modes
- **Community** — `community_id` = active community (membership gate); unviewed-first ranked; cursor
- **Following** — authors from `SocialApi.followingIds`; chronological; cursor
- **Nearby** — ⏸ **schema gap**: `feed_posts` has no `location geography` column — PostGIS filtering impossible. Documented; needs `feed_posts.location` migration + privacy-safe distance-free output. Not implemented rather than faked.

## Public-API additions
- `SocialApi`: `mutedIds(viewer,candidates)` batch, `followingIds(viewer)`
- `TaxonomyApi`: `findCategory`, `isCategoryActiveInCountry(id,countryId,module)` (module-scoped via `country_category_modules`)

## Tests — Feed suite 11/11 (full backend 104/104 BUILD SUCCESS)
create/read, announcement-mod-gate, author-only edit/delete, reactions+saves, comments+counts+permissions, help lifecycle+transitions+auth, poll create+vote+results+closed-gate, unviewed-first ranking, following-feed block filter, membership gate, full HTTP. All architecture tests green — zero cross-module internal imports.

## Deferred / needs approval
1. `feed_posts.location geography` migration → enables Nearby feed
2. `user_feed_preferences` (Not Interested) table — no schema support; Save exists via `post_saves`
3. Guides/Events/Jobs/Property/Vehicles/Business source modules + their APIs
4. `feed_comment_reactions` — not in schema; comment reactions unsupported
5. Resurfacing trigger — no approved threshold defined; view-ranking implemented instead
6. `post_shares` insert endpoint (table exists, no REST yet)
