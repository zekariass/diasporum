# Diasporum Mobile — Phase 3A Implementation Report

**Phase:** Home Feed  
**Status:** COMPLETE WITH CONDITIONS  
**Date:** 2026-01-19  
**Repo:** `C:\PROJECT\DIASPORUM\diasporum-mobile`

---

## A. Executive Summary

Phase 3A delivers an X/Threads-style Home Feed: a compact text-first vertical timeline with Community and Following modes, real author names resolved server-side, reactions, saves, view tracking, post detail with comments/replies, and a multi-mode composer supporting GENERAL, POLL and COMMUNITY_HELP posts.

**Key finding during implementation:** `FeedItem` already contains `author: ProfileSummary` — the backend resolves all post authors in `toItems()` via `identity.profileSummaries(authorIds)` with a single batch query. No backend change was needed; the mobile type definition was wrong. The author resolution requirement is satisfied server-side and the mobile simply reads `item.author.displayName`/`item.author.username`.

**Status: COMPLETE WITH CONDITIONS** — all core features implemented and statically verified. Live backend E2E and Android device testing remain unverified. Media rendering not implemented (`mediaIds` present in `FeedItem` but Media API URL resolution not wired). Announcement posting not exposed (role check exists but creates GENERAL post — `postType: 'ANNOUNCEMENT'` not passed).

---

## B. UI and Design

The feed follows X/Threads design principles:

- **Timeline**: `FlatList` with `hairlineWidth` bottom borders — no card containers, no shadows, no large wrappers
- **Post layout**: avatar left, name + `@username · time` header, title, body, action row — compact and text-first
- **Type labels**: small uppercase purple text (`ANNOUNCEMENT`, `Community Help`, `Poll`) above post body
- **Help kinds**: `Requesting help` / `Offering help` suffix on the type label
- **Mode selector**: text tabs with a 2px underline for the active mode — no pill buttons
- **Header**: `Diasporum` wordmark + `Community` label for active community context
- **Composer FAB**: circular purple `+` button floating bottom-right
- **Post detail**: compact back-navigation header, original post block, flat comment list with single-level reply indentation, keyboard-aware comment composer
- **Create post**: mode tabs (Post / Poll / Help), author row, autofocused `TextInput`, poll option list, help kind toggle — no cards or large containers

## C. Implemented Features

| Feature | Status | Notes |
|---|---|---|
| Community feed | ✅ | `GET /feed/community?communityId=` — cursor pagination |
| Following feed | ✅ | `GET /feed/following` — cursor pagination |
| Cursor pagination | ✅ | `nextCursor` + dedup on append; `hasMore` detection |
| Pull-to-refresh | ✅ | `RefreshControl` resets cursor |
| Author display | ✅ | `item.author.displayName`/`item.author.username` — resolved server-side |
| Relative timestamps | ✅ | `timeAgo()` — `now`/`5m`/`2h`/`3d`/`Jan 5` |
| Post type labels | ✅ | `ANNOUNCEMENT`/`COMMUNITY_HELP`/`POLL`/`REEL` shown as small uppercase label |
| Help kind/status | ✅ | `payload.helpKind` + `payload.helpStatus` shown when non-OPEN |
| Reactions | ✅ | `PUT /feed/posts/{id}/reaction` — toggle or switch reaction, optimistic + rollback |
| Save/unsave | ✅ | `PUT/DELETE /feed/posts/{id}/save` — optimistic + rollback |
| View tracking | ✅ | `onViewableItemsChanged` ≥60% visible → `POST /feed/views` — dedup via `viewedRef` |
| Post detail | ✅ | `GET /feed/posts/{id}` — full post + comment list |
| Comments + replies | ✅ | `GET/POST /feed/posts/{id}/comments` — offset pagination, 1-level replies |
| Comment composer | ✅ | Keyboard-aware, dup-submit guard, reply-to banner |
| GENERAL post creation | ✅ | `POST /feed/posts` `{communityId, postType, body}` |
| POLL creation | ✅ | `POST /feed/polls` `{communityId, question, options[]}` — up to 10 options |
| COMMUNITY_HELP creation | ✅ | `POST /feed/community-help` `{helpKind: REQUEST|OFFER}` |
| ANNOUNCEMENT permission | ⚠️ | `canAnnounce` role check exists but no UI exposes `postType: 'ANNOUNCEMENT'` |
| Post edit/delete | ❌ | `PATCH`/`DELETE /feed/posts/{id}` in API service but no UI (more-actions menu not built) |
| Media rendering | ❌ | `mediaIds` in `FeedItem` but Media API URL resolution not wired |
| Media upload | ❌ | Not implemented — `expo-image-picker` not installed |

## D. Backend Integration

| Endpoint | Method | Used for | Verified |
|---|---|---|---|
| `/api/v1/feed/community` | GET | Community feed — `communityId`, `cursor`, `size` | Source ✅ Live ❌ |
| `/api/v1/feed/following` | GET | Following feed — `cursor`, `size` | Source ✅ Live ❌ |
| `/api/v1/feed/posts` | POST | Create post (GENERAL/ANNOUNCEMENT) | Source ✅ Live ❌ |
| `/api/v1/feed/posts/{id}` | GET | Post detail | Source ✅ Live ❌ |
| `/api/v1/feed/posts/{id}` | PATCH | Edit post (title/body/linkUrl) | Source ✅ Live ❌ |
| `/api/v1/feed/posts/{id}` | DELETE | Delete post | Source ✅ Live ❌ |
| `/api/v1/feed/posts/{id}/reaction` | PUT | React (LIKE/LOVE/HELPFUL/INSIGHTFUL/THANKS) | Source ✅ Live ❌ |
| `/api/v1/feed/posts/{id}/reaction` | DELETE | Remove reaction | Source ✅ Live ❌ |
| `/api/v1/feed/posts/{id}/save` | PUT | Save post | Source ✅ Live ❌ |
| `/api/v1/feed/posts/{id}/save` | DELETE | Unsave post | Source ✅ Live ❌ |
| `/api/v1/feed/views` | POST | View tracking `{contentType, contentId}` | Source ✅ Live ❌ |
| `/api/v1/feed/posts/{id}/comments` | GET | Comments (page/size) | Source ✅ Live ❌ |
| `/api/v1/feed/posts/{id}/comments` | POST | Create comment/reply | Source ✅ Live ❌ |
| `/api/v1/feed/comments/{id}` | PATCH/DELETE | Edit/delete comment | Source ✅ Live ❌ |
| `/api/v1/feed/community-help` | POST | Create help post (REQUEST/OFFER) | Source ✅ Live ❌ |
| `/api/v1/feed/community-help/{id}/status` | PATCH | Help lifecycle | Source ✅ Live ❌ |
| `/api/v1/feed/polls` | POST | Create poll | Source ✅ Live ❌ |
| `/api/v1/feed/polls/{id}` | GET | Poll detail | Source ✅ Live ❌ |
| `/api/v1/feed/polls/options/{id}/vote` | POST | Vote `{withdraw}` | Source ✅ Live ❌ |

### Backend gap identified and resolved

`FeedItem.author` — the backend already resolves `ProfileSummary` for every post via `identity.profileSummaries(authorIds)` in `FeedService.toItems()`. The mobile `FeedItem` type was updated to include `author: ProfileSummary | null`, `sourceId`, `publishedAt`, `communityId`. **No backend change required.**

## E. Architecture

```
src/features/feed/
├── types/feed-types.ts           # FeedItem, PostRow, CommentRow, FeedPage, enums
├── services/feed-api.ts          # createFeedApi(client) — all endpoints
├── hooks/use-feed.ts             # Feed state: cursor pagination, mode/community switch, mutations
├── components/post-item.tsx      # X/Threads-style timeline post
├── utils/time-ago.ts             # Relative timestamps
└── screens/
    ├── home-feed-screen.tsx      # Feed list + header + mode selector + FAB
    ├── post-detail-screen.tsx    # Post + comments + reply composer
    └── create-post-screen.tsx    # GENERAL / POLL / COMMUNITY_HELP composer

src/app/(app)/
├── (tabs)/index.tsx              # Exports HomeFeedScreen
├── posts/[id].tsx                # Exports PostDetailScreen
└── posts/create.tsx              # Exports CreatePostScreen
```

**State design:** `use-feed.ts` is a screen-level hook (not a global provider). Each screen creates its own API service from `SessionContext.apiClient`. Feed mutations update local `items` array in-place — no separate provider needed for the current screen structure. `PostDetailScreen` and `CreatePostScreen` manage their own state locally.

## F. Tests

| Command | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `npx expo lint` | ✅ 0 errors, 0 warnings |
| `npx jest --runInBand` | ✅ **83/83 pass** (7 suites) |
| `npx expo-doctor` | ✅ 20/20 checks |

New test suite: `feed-api.test.ts` — 17 tests covering endpoint URLs, methods, payload shapes, cursor params, comment pagination, vote payload, and `recordView` silent failure.

## G. Files Created

| Path | Purpose |
|---|---|
| `src/features/feed/types/feed-types.ts` | All DTOs matching `FeedService` records |
| `src/features/feed/services/feed-api.ts` | API service (19 methods) |
| `src/features/feed/hooks/use-feed.ts` | Feed state hook |
| `src/features/feed/components/post-item.tsx` | Timeline post component |
| `src/features/feed/utils/time-ago.ts` | Timestamp utility |
| `src/features/feed/screens/home-feed-screen.tsx` | Main feed |
| `src/features/feed/screens/post-detail-screen.tsx` | Post + comments |
| `src/features/feed/screens/create-post-screen.tsx` | Composer |
| `src/app/(app)/posts/[id].tsx` | Post detail route |
| `src/app/(app)/posts/create.tsx` | Composer route |
| `src/__tests__/features/feed/feed-api.test.ts` | 17 API service tests |

## H. Deferred / Backend Dependencies

| Item | Status |
|---|---|
| `FeedItem.mediaIds` rendering | Deferred — needs Media API `GET /media/{id}/download-url` or similar; not inspected for authorized URL contract |
| ANNOUNCEMENT `postType` in composer | Role check exists; `postType: 'ANNOUNCEMENT'` not passed to `createPost` — needs UI toggle |
| Post edit/delete UI | API methods exist; more-actions menu not built |
| `FeedProvider` global state | Not needed — `use-feed.ts` per screen is sufficient; revisit if post updates need cross-screen sync |
| Comment `authorId` resolution | `CommentRow` has `authorId` but no `ProfileSummary` — comments show placeholder avatar |
| Live backend E2E | NOT VERIFIED — no running backend available |
| Android deep-link/E2E | NOT VERIFIED — no dev build available |

## I. Manual Android Checklist

| # | Test | Status |
|---|---|---|
| M-1 | Open app → Home tab → feed loads | NOT VERIFIED |
| M-2 | Author name/username shown on posts | NOT VERIFIED |
| M-3 | Community ↔ Following switch | NOT VERIFIED |
| M-4 | Scroll → load more posts | NOT VERIFIED |
| M-5 | Tap post → post detail opens | NOT VERIFIED |
| M-6 | Write comment → appears in list | NOT VERIFIED |
| M-7 | Reply to comment | NOT VERIFIED |
| M-8 | Create GENERAL post → appears in feed | NOT VERIFIED |
| M-9 | Create POLL → options visible | NOT VERIFIED |
| M-10 | Create COMMUNITY_HELP REQUEST/OFFER | NOT VERIFIED |
| M-11 | React to post → count updates | NOT VERIFIED |
| M-12 | Save/unsave post → state persists | NOT VERIFIED |
| M-13 | View tracking fires on scroll | NOT VERIFIED |
| M-14 | Switch community → feed resets | NOT VERIFIED |
| M-15 | Pull to refresh → new posts appear | NOT VERIFIED |

## J. Phase 3A Readiness

**READY FOR VERIFICATION WITH CONDITIONS**

Core feed infrastructure is complete and statically verified. Not ready for full acceptance until:
1. Media API URL resolution is wired for `mediaIds` (image display in posts)
2. ANNOUNCEMENT postType is wired through the composer for eligible users
3. Post detail uses `PostRow.authorId` → profile lookup (or backend adds author to PostRow)
4. Live backend E2E confirmed on a device/emulator

---

*No commits, pushes, deployments, backend changes, or migrations were made.*