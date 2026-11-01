# Diasporum Mobile — Phase 4 Explore Report

**Date:** 2026-01-19
**Scope:** Explore & People Discovery — People, Communities, Posts, Reels

---

## Executive Summary

**Status: COMPLETE WITH CONDITIONS** — functional Explore hub implemented using only confirmed existing backend endpoints. No backend search/discovery endpoints exist — client-side filtering is used as the MVP approach. Server-side search is documented as a required backend enhancement.

---

## Implemented Features

| Feature | Status | Detail |
|---|---|---|
| Explore screen | ✅ IMPLEMENTED | `explore-screen.tsx` — search bar + 4-category tabs + FlatList |
| People discovery | ✅ IMPLEMENTED | `GET /communities/{id}/members` → `profileSummaries` — community members, deduplicated, self excluded |
| Follow/unfollow | ✅ IMPLEMENTED | `POST/DELETE /social/follows/{t}` — optimistic update + rollback, `blockedBy` checked |
| Relationship state | ✅ IMPLEMENTED | `GET /social/relationship/{id}` — batch for first 20 members |
| Community discovery | ✅ IMPLEMENTED | `GET /me/communities/available` + `GET /me/communities` — join/status |
| Community name | ✅ IMPLEMENTED | `GET /me/communities/{id}` → `CommunityView.name` — header label |
| Post discovery | ✅ IMPLEMENTED | `GET /feed/community` — `PostItem` reused, reactions/saves wired |
| Reel discovery | ✅ IMPLEMENTED | `GET /feed/reels/community` — `MediaImage` thumbnail + navigate to post detail |
| Search | ✅ IMPLEMENTED | Client-side filter over fetched lists — `displayName`/`username`/`name`/`description`/`title`/`body` |
| Category tabs | ✅ IMPLEMENTED | People / Communities / Posts / Reels — X/Threads underline style |
| Active community | ✅ IMPLEMENTED | Header shows `CommunityView.name` fetched via `GET /me/communities/{id}` |
| Pull-to-refresh | ✅ IMPLEMENTED | `RefreshControl` on FlatList |
| Loading/empty/error | ✅ IMPLEMENTED | `LoadingScreen`, empty icon+title+body, `ApiError.userMessage` |

## Confirmed Backend Endpoints Used

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/v1/communities/{id}/members` | GET | `{items: ProfileSummary[]}` — community member list |
| `/api/v1/me/communities/available` | GET | `{items: CommunitySummary[]}` — eligible communities |
| `/api/v1/me/communities/{id}` | GET | `CommunityView` — name for header |
| `/api/v1/social/relationship/{t}` | GET | `{following, followedBy, blockedBy}` |
| `/api/v1/social/follows/{t}` | POST/DELETE | Follow/unfollow |
| `/api/v1/feed/community` | GET | `FeedPage` — community posts |
| `/api/v1/feed/reels/community` | GET | `FeedPage` — community reels |
| `/api/v1/feed/authors` | GET | `ProfileSummary[]` — batch author resolution |

## Missing Backend APIs (documented, not implemented)

| Capability | Gap | Recommended |
|---|---|---|
| Profile search | `GET /profiles/search?q=` | `ILIKE` on username/displayName |
| Community search | `GET /communities/search?q=` | `ILIKE` on name/description |
| Post search | `GET /feed/posts/search?q=` | `ILIKE` on title/body + visibility rules |
| Reels discovery | `GET /feed/reels/discover` | Broader than community feed |
| Suggested people | `GET /social/suggested` | Same-origin + same-destination + mutual follows |
| `CommunityView.memberCount` | Not in record | Add `int memberCount` to `CommunityView` |

## Files Created / Modified

| Path | Change |
|---|---|
| `src/features/feed/services/explore-api.ts` | **New** — all explore API calls |
| `src/features/feed/screens/explore-screen.tsx` | **New** — search + 4 tabs + person/community/reel cards |
| `src/features/feed/types/feed-types.ts` | Added `CommunitySummary` (matches `TaxonomyApi.CommunityView`) |
| `src/app/(app)/(tabs)/explore.tsx` | Updated — was placeholder, now exports `ExploreScreen` |

## Privacy & Authorization

| Check | Result |
|---|---|
| Self-follow prevention | ✅ `person.id === myId` → no follow button |
| Blocked users | ✅ `rel.blockedBy` → no follow button; `FeedService.toItems` filters server-side |
| `profileSummaries` fields | ✅ `username`, `displayName`, `avatarMediaId` only — no private data |
| Community visibility | ✅ `availableCommunities` returns only eligible communities |
| Post/Reel visibility | ✅ `FeedService` filters hidden/muted/blocked — server-side |
| Join permission | ✅ `POST /communities/{id}/join` — backend enforces eligibility |

## Deferred

| Item | Status |
|---|---|
| Server-side profile/community/post search | **BLOCKED PENDING APPROVAL** — no backend endpoints exist |
| `GET /social/suggested` | **BLOCKED PENDING APPROVAL** — needs mutual-follow + same-country query |
| `GET /feed/reels/discover` | **BLOCKED PENDING APPROVAL** — needs broader visibility query |
| `CommunityView.memberCount` | **DEFERRED** — not in backend record |
| Pagination in Explore | **DEFERRED** — all lists limited to 50 items; cursor pagination for posts/reels exists but not wired in Explore UI |
| `FeedProvider` shared state | **DEFERRED** — same as Phase 3A audit finding |
| Video playback in Reels tab | **NOT VERIFIED** — `MediaImage` thumbnail only; `expo-video` requires dev build |
| Android runtime | **NOT VERIFIED** |

## Test Results

| Command | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `npx expo lint` | ✅ 0 errors, 0 warnings |
| `npx jest --runInBand` | ✅ 83/83 pass (7 suites) |
| `npx expo-doctor` | ✅ 20/20 checks |

## Remaining Limitations

- Search is client-side only — fetches up to 50 items then filters locally; no server-side search exists
- `relationship` calls are N+1 for the first 20 members — no batch relationship endpoint exists
- `CommunityView.memberCount` not available — no member counts displayed
- Reels tab shows `MediaImage` thumbnail — tapping navigates to post detail, not full-screen player
- `PostItem` in Explore doesn't pass `isOwner`/`onEdit`/`onDelete` — owner actions not shown in Explore (intentional — same as Following feed)

---

*No commits, pushes, deployments, migrations, or backend changes were made.*
