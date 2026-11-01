# Diasporum — Social Module Report
**Date:** 2026-10-30 — V3+V4 additive migrations created (apply on next dev boot — your approval governs `diasporum_dev`). No commits.

## Schema reality vs. implementation
| Existing | Used for |
|---|---|
| `user_follows(follower,followed)` PK-pair + self-CHECK | follows (v10.11 follow-only model) |
| `user_blocks(blocker,blocked)` PK-pair + self-CHECK | blocks |
| `user_mutes` — **moderator-only, DB-trigger-enforced** ("platform-moderation transaction") | NOT usable for personal mutes → **gap** |
| `friendships` — absent in v10.11 | **gap** → `V3__friendships.sql` created (ordered pair + `origin` MATCHMAKING/DIRECT — enables unmatch-removes-only-match-friendship rule) |
| Personal mute preference — absent | **gap** → `V4__personal_mutes.sql` created (user_blocks shape) |

## `SocialApi` (root)
`canInteract` (block either way), `isFollowing/isFriend/isMuted/isBlockedEitherWay`, `relationship(viewer,target)` (never leaks blocked-BY direction), `friendIds/followerIds/followingIds/blockedIds/mutedIds`, and matchmaking contract: `establishMatchmakingFriendship` (idempotent, race-safe via PK dup-catch, origin-marked) + `dissolveMatchmakingFriendship` (origin-scoped delete — direct friendships and messages preserved).

## REST `/api/v1/social` (authenticated; actor = JWT→`IdentityApi.findByExternalId`)
`POST|DELETE /follows/{id}`, `GET /followers`, `GET /following`, `POST|DELETE /friends/{id}`, `GET /friends`, `POST|DELETE /blocks/{id}`, `GET /blocks`, `POST|DELETE /mutes/{id}`, `GET /mutes`, `GET /relationship/{id}` — paginated, 400 self-op, 403 blocked/`FOLLOW_NOT_ALLOWED`, 404 unknown target.

## Behaviour
- Follow: duplicate-safe, self-reject, **blocked-either-way rejects**, target `allow_followers` enforced; mutual follow ≠ friendship
- Friendship: direct add (no request lifecycle in schema — documented gap) + matchmaking-marked; unordered ordered-pair storage
- **Block**: severs both follow directions immediately; friendship history preserved; canInteract fails
- Mute: pure preference — does NOT restrict interaction (mute ≠ block)
- Unmatch dissolves only MATCHMAKING-origin friendship

## Tests — 7/7 PASS (full suite 72/72)
follow lifecycle/dup/self, mutual+relationship view, block+`allow_followers` privacy, direct+matchmaking friendship (idempotent, origin, dissolve-preserves), block history + unblock, mute≠block, pagination+404. All 26 boundary tests green.

## Deferred / needs approval
1. **V3+V4 applied on next dev boot** — testcontainers-validated; `diasporum_dev` application is yours to authorize
2. `friend_requests` lifecycle — not in v10.11 schema; direct-add only for now
3. Moderation `user_mutes`/`user_bans` — owned by `moderation` module, untouched
4. Notifications events — integration point documented; no framework invented

---

## Review fixes (2026-10-30)
- **API change:** `SocialApi.isBlockedEitherWay` removed (a `true` result revealed that the *other* user had blocked the caller). Replaced by `isBlockedByMe(viewer,target)`; enforcement uses `canInteract`. `relationship()` likewise only reports `blockedByMe`.
- `POST /api/v1/social/follows/{id}` path-variable mismatch fixed (was always 400); HTTP test added.
- Relationship checks use `SELECT EXISTS` instead of `count(*)`.
- Missing `user_privacy_settings` row now falls back to the schema default (`allow_followers DEFAULT true`) instead of blocking follows.
- V3: `(user_a, created_at DESC)` / `(user_b, created_at DESC)` indexes for friend-list pagination; V4: `(muter_user_id, created_at DESC)`. Both migrations are still unapplied to `diasporum_dev`, so editing them is safe.
- Tests no longer import `identity.internal.*`; they use the identity-owned `IdentityTestSupport` fixture.

## Open decisions (not changed — need product input)
1. **Direct friend add needs no consent from the target** (only block is checked). Options: gate on a privacy flag, or add a request/accept lifecycle (requires a `friend_requests` table that is not in v10.11).
2. `user_follows` follower/following pagination sorts on `created_at`, which V1 does not index. Adding an index means a V5 change to an approved V1 table, so it's deferred until you approve it or profiling shows a need.

---

## Spec completion pass (2026-10-30, second pass)
- **Counts:** `followerCount`/`followingCount`/`friendCount` added to `SocialApi` + returned as `total` in `GET /followers`, `/following`, `/friends`.
- **Profile summaries:** the three relationship list endpoints now return `ProfileSummary` objects (not bare UUIDs) via the new **batch** `IdentityApi.profileSummaries(Collection)` — one IN-clause query, no N+1.
- **Concurrency:** new test proves 4 concurrent `establishMatchmakingFriendship` calls converge to exactly 1 row.
- `GET /followers` HTTP test asserts `total` + `items[].accountStatus` shape.
- New tests: `countsAndFollowerListSummaries`, `concurrentMatchmakingFriendshipConvergesToOneRow` → Social suite now **11/11**, full backend **76/76 BUILD SUCCESS**.

## Still deferred (needs approval)
1. `friend_requests` lifecycle (no schema table — direct add only)
2. `POST /friends/{id}` consent gate (documented open decision)
3. V1 `user_follows.created_at` index (V5 proposal, not yet applied)
4. Notification domain events (integration point documented, no framework)
