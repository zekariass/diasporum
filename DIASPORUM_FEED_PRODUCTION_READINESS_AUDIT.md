# Diasporum — Feed Module Production-Readiness Audit
**Date:** 2026-10-30 — audit against v10.11 schema + live code. No migrations applied; no commits.

## Executive summary
The audit found **9 real defects** — several security-relevant — all fixed within the existing schema and verified by tests. After fixes: Feed suite **15/15**, full backend **108/108 BUILD SUCCESS**, ArchUnit green. The module is **not yet production-ready**: Nearby (no geo column), Not Interested (no table), comment reactions (no table), and 6 source-module integrations remain blocked on schema/approval — documented below.

## Defects found & FIXED (verified)

| # | Severity | Defect | Fix |
|---|---|---|---|
| 1 | **HIGH (IDOR)** | `GET /feed/posts/{id}` ran no authorization — any authenticated user could read any post | `getPost(viewer,id)` now runs `requireViewable` |
| 2 | **HIGH** | `requireViewable` let non-PUBLISHED posts (DRAFT/REJECTED) be read by anyone | Non-PUBLISHED restricted to author + community moderator |
| 3 | **MED** | `recordView` checked existence only — could log views on inaccessible posts | Now enforces `requireViewable` |
| 4 | **MED** | `poll()` ignored `results_visibility` — leaked counts before voting/close; also had no viewer check | `resultsVisible` gating (IMMEDIATE/AFTER_VOTING/AFTER_CLOSE) + `requireViewable` |
| 5 | **MED** | community-feed cursor used tuple `>` for mixed ASC/DESC ordering — page 2 skipped/duplicated items | Proper `(flag,ts,id)` keyset predicate matching the sort |
| 6 | **MED** | cursor `encode` hardcoded flag=0 and built from the **lookahead** row — page 2 was empty | flag selected per row; cursor from last *displayed* row; ISO-Instant precision (ms truncation caused row loss) |
| 7 | **LOW-MED** | `vote()` with `allowVoteChange` on non-multiple polls left two votes | Deletes user's old vote(s) before insert; racing duplicate mapped to 409 by controller |
| 8 | **LOW** | `FeedApiImpl.posts` N+1; `canView` never checked authorization | `apiPosts` batch query; `canView` uses real `requireViewable` |
| 9 | **LOW** | `attachMedia` rejected `FEED_VIDEO` on non-REEL posts; `helpStatus` never transitioned to EXPIRED | FEED_VIDEO allowed on normal posts; lazy EXPIRED on read (no scheduler needed) |

## Audit verdicts by area
- **Post/community access** — FIXED (defects 1,2). Community feed: membership gate ✓; publish-into-community: `isActiveMember` ✓; announcements: `isModeratorOrAbove` ✓; help status: author-or-moderator ✓.
- **Social restrictions** — VERIFIED. `blockedWith`/`mutedIds` batch filters on authors; block enforced on direct lookup; mute≠block; blocker identity never exposed.
- **Media security** — VERIFIED (+defect 9). READY-only, owner-only, purpose-checked, keys never exposed; removing an attachment never deletes the media object.
- **Polls** — VERIFIED + FIXED (4,7). Creation: question/2-20 options/category/membership/transactional draft→publish; voting: PK + `one-option-per-user` trigger (concurrency-safe — exactly one winner proven), `closes_at`/`closed_at`/viewer-check; results: per-option subquery counts + viewer state; **expiry has no scheduler — votes close via `closes_at` check, but `closed_at` is never auto-set** (documented gap, no infra added).
- **Identifiers** — VERIFIED. `FEED_POST:uuid` opaque ids, strict decode → `INVALID_CURSOR`/400 on malformed input.
- **Pagination** — FIXED (5,6). Verified: page 2 returns the exact remaining row, no dupes/skips.
- **View tracking** — FIXED (3). GET feed ≠ view; upsert on `user_content_views` PK; correct user; FEED_POST validated; unviewed-first uses the same rows.
- **Comments** — VERIFIED. Reply via `parent_comment_id` (trigger-enforced same-post), own-edit/delete or moderator, `comments_enabled` gate, `requireViewable`, trigger-maintained counts.
- **Saves** — VERIFIED. `post_saves` upsert/idempotent-unsave, `requireViewable`, saved-flag on feed items.
- **Performance** — VERIFIED. Keyset (no OFFSET), batch author summaries, batch block/mute, aggregate counts by trigger/subquery, per-request membership cache.
- **Security/privacy** — no coordinates/distances anywhere (Nearby deferred); R2 keys never leave Media; actor always JWT-resolved.

## Outstanding (not fixable without approval)
- **Nearby** — `feed_posts` has no `location`; proposal doc prepared.
- **Not Interested** — `user_feed_preferences` doesn't exist; proposal doc prepared.
- **Comment reactions** — `feed_comment_reactions` not in schema; documented, not built.
- **Poll `closed_at` auto-close** — no scheduler; votes blocked by `closes_at` anyway.
- **GUIDE/EVENT/JOB/PROPERTY/VEHICLE/BUSINESS** — 6 source modules absent; `TYPE:uuid` ids + `content_reference_type` view tracking already compatible.

## Tests — 15/15 Feed, 108/108 backend, BUILD SUCCESS
Regression tests added: `directLookupCannotBypassVisibility`, `draftsHiddenFromOthers`, `cursorPaginationIsStable`, `concurrentVoteIsIdempotent` (exactly-one-winner). All prior module suites green.

**Not called production-ready** — passing tests ≠ ready; deferred items above stand.
