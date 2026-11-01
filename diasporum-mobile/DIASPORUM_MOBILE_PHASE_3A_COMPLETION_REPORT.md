# Diasporum Mobile — Phase 3A Completion Report

**Phase:** Home Feed — Completion and Verification  
**Status:** COMPLETE WITH CONDITIONS  
**Date:** 2026-01-19  
**Repo:** `C:\PROJECT\DIASPORUM\diasporum-mobile`

---

## A. Executive Summary

Phase 3A is complete. All outstanding items from the previous report have been addressed: media rendering via authorized download URLs, ANNOUNCEMENT creation for eligible moderators, comment author resolution via a new backend batch endpoint, and post edit/delete via an owner-aware action menu.

**Status: COMPLETE WITH CONDITIONS** — all code is implemented and statically verified. Live backend E2E and Android device testing remain unverified.

---

## B. Initial Findings

| Finding | Status |
|---|---|
| `FeedItem.author` already contained `ProfileSummary` — resolved server-side via `identity.profileSummaries()` | ✅ Confirmed — no backend change needed for feed items |
| `CommentRow` had `authorId` but no author data | ✅ Fixed — added `GET /api/v1/feed/authors` to `FeedController` |
| `mediaIds` were UUIDs with no rendering | ✅ Fixed — `MediaImage` resolves `POST /media/{id}/download-url` |
| ANNOUNCEMENT `postType` not passed in composer | ✅ Fixed — wired `postType: 'ANNOUNCEMENT'` for eligible users |
| Post edit/delete UI missing | ✅ Fixed — `···` dropdown menu on own posts + `edit-post-screen.tsx` |
| `use-feed.ts` used `postId` field name | ✅ Fixed — corrected to `sourceId` matching `FeedItem` record |

---

## C. Backend Changes

**One additive change — `FeedController.java`:**

```java
@GetMapping("/authors")
public List<IdentityApi.ProfileSummary> authors(
    @AuthenticationPrincipal Jwt j, @RequestParam List<UUID> ids) {
    me(j); // authenticated check
    return identity.profileSummaries(ids);
}
```

- `GET /api/v1/feed/authors?ids=uuid1,uuid2,…` → `ProfileSummary[]`
- `IdentityApi` was already injected — `profileSummaries` is the public batch method
- No migration, no schema change, no new module dependency
- Used by `post-detail-screen.tsx` to resolve comment authors in one call

---

## D. Completed Items

### D-1: Media attachment rendering — `media-image.tsx`

- `POST /api/v1/media/{assetId}/download-url` → `{downloadUrl}` → `<Image source={{uri}}>`
- Module-level `Map<string,string>` URL cache — survives remounts, avoids repeat requests
- Loading placeholder (ActivityIndicator), failure placeholder (icon + background)
- `aspectRatio: 4/3` container — prevents layout jumps, `resizeMode="cover"`
- `clearMediaCache()` exported for session cleanup
- `PostItem` renders `item.mediaIds` mapped to `<MediaImage>` — images inline below body text

### D-2: ANNOUNCEMENT creation — `create-post-screen.tsx`

- `'announcement'` added to `ComposerMode`
- 📢 tab visible only when `session.memberships` has `MODERATOR|ADMIN` role for active community (client-side hint — backend still enforces via `ANNOUNCEMENT` `postType` authorization)
- Submit passes `postType: 'ANNOUNCEMENT'` when mode is `announcement`
- 403 response surfaces as `ApiError.userMessage`

### D-3: Comment author identity — `post-detail-screen.tsx`

- `authorMap: Map<authorId, displayName>` populated by one `authorSummaries()` call after comments load
- Distinct `authorId`s deduplicated before request — no N+1
- `CommentItem` shows `{authorName} · {timeAgo}` and `authorName[0]` avatar letter
- Graceful fallback: `'Diasporum member'` for unresolved/deleted profiles

### D-4: Post edit/delete — `post-item.tsx` + `edit-post-screen.tsx`

- `PostItem` props: `isOwner`, `onEdit`, `onDelete`
- `home-feed-screen.tsx` computes `isOwner` from `item.author?.id === session?.me.id`
- `···` button opens inline dropdown: Edit post → `/posts/edit/{id}`; Delete post → inline confirm (not a system dialog — consistent with X/Threads design)
- `use-feed.ts`: `deletePost(postId)` — optimistic removal + silent catch; `updatePost(postId, updates)` for edit refresh
- `edit-post-screen.tsx`: loads `PostRow`, checks `authorId === session.me.id`, PATCHes `title`/`body`/`linkUrl`, confirms → back

---

## E. API Contract Summary

| Endpoint | Method | Used for |
|---|---|---|
| `/api/v1/feed/community` | GET | Community feed (cursor, size, communityId) |
| `/api/v1/feed/following` | GET | Following feed (cursor, size) |
| `/api/v1/feed/posts` | POST | Create GENERAL/ANNOUNCEMENT post |
| `/api/v1/feed/posts/{id}` | GET/PATCH/DELETE | Post detail, edit, delete |
| `/api/v1/feed/posts/{id}/reaction` | PUT/DELETE | React/unreact |
| `/api/v1/feed/posts/{id}/save` | PUT/DELETE | Save/unsave |
| `/api/v1/feed/views` | POST | View tracking |
| `/api/v1/feed/posts/{id}/comments` | GET/POST | Comments (page/size), create |
| `/api/v1/feed/comments/{id}` | PATCH/DELETE | Edit/delete comment |
| `/api/v1/feed/community-help` | POST | Create REQUEST/OFFER |
| `/api/v1/feed/community-help/{id}/status` | PATCH | Help lifecycle |
| `/api/v1/feed/polls` | POST | Create poll |
| `/api/v1/feed/polls/{id}` | GET | Poll detail |
| `/api/v1/feed/polls/options/{id}/vote` | POST | Vote `{withdraw}` |
| `/api/v1/feed/authors` | GET | Batch `ProfileSummary` (new) |
| `/api/v1/media/{id}/download-url` | POST | Signed media URL |

---

## F. Files Created / Modified

| Path | Change |
|---|---|
| `diasporum-backend/…/feed/internal/api/rest/FeedController.java` | Added `GET /api/v1/feed/authors` |
| `src/features/feed/services/feed-api.ts` | Added `authorSummaries` |
| `src/features/feed/components/media-image.tsx` | **New** — URL resolution + cache |
| `src/features/feed/components/post-item.tsx` | Media rendering, owner menu, delete confirm |
| `src/features/feed/hooks/use-feed.ts` | `deletePost`, `updatePost`, `sourceId` fix |
| `src/features/feed/screens/home-feed-screen.tsx` | `isOwner`/`onEdit`/`onDelete` wiring |
| `src/features/feed/screens/create-post-screen.tsx` | ANNOUNCEMENT mode |
| `src/features/feed/screens/post-detail-screen.tsx` | `authorMap` + `authorName` in comments |
| `src/features/feed/screens/edit-post-screen.tsx` | **New** |
| `src/app/(app)/posts/edit/[id].tsx` | **New** route |

---

## G. Verification Results

| Command | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `npx expo lint` | ✅ 0 errors, 0 warnings |
| `npx jest --runInBand` | ✅ **83/83 pass** (7 suites) |
| `npx expo-doctor` | ✅ 20/20 checks |

---

## H. Remaining Limitations

| Item | Status |
|---|---|
| `PostRow.authorId` has no `ProfileSummary` | Post detail shows current-user name or placeholder — backend could add `author` to `PostRow` |
| Media upload (`expo-image-picker`) | Not installed — `mediaIds` rendering works but upload flow not built |
| Video in feed | Not rendered — `REEL` type shown as label only; Phase 3B |
| `FeedProvider` global state | Not needed — `use-feed.ts` per screen is sufficient |
| Live backend E2E | NOT VERIFIED |
| Android device/deep-link | NOT VERIFIED |

---

## I. Readiness for Verification Audit

**READY** — Phase 3A is structurally complete. All checklist items are implemented. The audit can proceed to verify against a live backend + Android dev build.

---

*No commits, pushes, deployments, migrations, or additional backend changes were made.*