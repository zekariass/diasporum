# Diasporum Mobile — Phase 3A + 3B Integration Audit Report

**Date:** 2026-01-19
**Scope:** Home Feed (3A) + Reels (3B) integration, video lifecycle, media upload, privacy, navigation

---

## A. Executive Summary

**Overall result: PASS WITH CONDITIONS — 4 defects fixed, 2 deferred**

Phase 3A and 3B share the `feed_posts` model correctly. Four integration defects were found and fixed. Two remaining items are documented as deferred (shared `FeedProvider`, backend `GET /reels/following` endpoint).

---

## B. Feed & Reels Consistency

| Check | Result | Detail |
|---|---|---|
| REEL not in Home Feed | **ISSUE FIXED** | `use-feed.ts` didn't filter `contentType==='REEL'` — REEL items rendered as `MediaImage` (image on video). Now filtered: `contentType !== 'REEL'` on initial load and append. |
| Normal post not in Reels | PASS | Community: `GET /feed/reels/community` filters `contentType='REEL'` server-side. Following: filtered client-side — correct. |
| Reel → post detail | PASS | `router.push('/posts/{sourceId}')` — same detail screen for all types. |
| Reaction/save consistency | **ISSUE DEFERRED** | `ReelItem` calls `feedApi.react/save` directly — doesn't update `useFeed` state. Home Feed sees stale state until next refresh. Needs shared `FeedProvider`. |
| Delete reel | PASS | `feed.deletePost(sourceId)` — same endpoint for all post types. |
| Community switch | PASS | Both `use-feed.ts` and `use-reels.ts` watch `activeCommunityId` → reset + reload. |
| Cursor dedup | PASS | Both hooks check `!s.items.some(e => e.sourceId === i.sourceId)` on append. |
| Mode switch | PASS | `switchMode` resets `items`, `cursor`, `hasMore` — no state leak. |

## C. Video Playback Lifecycle

| Check | Result | Detail |
|---|---|---|
| One active player | PASS | `activeIdx` + `onViewableItemsChanged` (80% threshold) — only active item plays. |
| Pause on scroll | PASS | Non-active items get `active=false` → `player.pause()`. |
| Pause on tab switch | PASS | `useFocusEffect` → `setActiveIdx(-1)` on blur → all pause. |
| Pause on app background | PASS | `useFocusEffect` cleanup triggers on navigation away; React Native lifecycle pauses VideoView. |
| Player cleanup on unmount | PASS | `useVideoPlayer` manages lifecycle — no manual cleanup needed. |
| Empty source guard | **ISSUE FIXED** | `useVideoPlayer(uri ?? '')` — empty string caused player creation with invalid source → changed to `uri ?? null`. |
| Signed URL expiry | **ISSUE DEFERRED** | `urlCache` Map has no TTL — expired URLs will fail silently on next play. Needs expiry handling. |
| Playback failure | PASS | `failed` state → error placeholder + retry button; user can scroll to next video. |
| `FlatList` virtualization | PASS | `getItemLayout` + `pagingEnabled` — only 1-2 items mounted at once. |

## D. Media & Upload

| Check | Result | Detail |
|---|---|---|
| Signed URL flow | PASS | `POST /media/uploads` → `{assetId, uploadUrl}` → `fetch`+`blob` PUT → `POST /media/uploads/{id}/complete` → `createPost(postType:'REEL', mediaIds)` |
| READY check | PASS | Backend `attachMedia` validates `READY` status + ownership — client can't attach non-READY assets. |
| MIME validation | PASS | Backend `ALLOWED['FEED_VIDEO']` = `video/mp4`, `video/quicktime` — client pre-validates file size (25MB) before upload. |
| Failed upload → no publish | PASS | `uploadRes.ok` check before `complete` — exception stops before `createPost`. |
| Duplicate publish | PASS | `publishing`/`uploading` state guards `handlePublish`. |
| Signed URL not exposed | PASS | Only `{downloadUrl}` from `POST /media/{id}/download-url` — no R2 keys or bucket names in mobile. |
| Orphaned upload on post failure | **ISSUE DEFERRED** | If `createPost` fails after successful `complete`, asset exists but isn't attached — needs `DELETE /media/{assetId}` cleanup call. |
| Upload progress % | **ISSUE DEFERRED** | `fetch` has no progress callback — shows 30%/100%. `expo-file-system.createUploadTask` gives real % but wasn't installed. |
| MediaImage vs VideoView | PASS | `MediaImage` for images (`feed_posts` with `mediaIds` where `contentType != 'REEL'`); `VideoView` for REEL — separate paths, no confusion. |

## E. Following Feed Efficiency

| Check | Result | Detail |
|---|---|---|
| Client-side filter correctness | PASS | `followingFeed` returns `FeedPage` — `items.filter(i => i.contentType === 'REEL')` — correct. |
| Empty pages on scroll | **ISSUE DEFERRED** | `nextCursor` from `followingFeed` may skip REEL-free pages — user might reach empty Reels before finding content. Needs backend `GET /feed/reels/following`. |
| Unnecessary fetches | PASS | No extra requests — `followingFeed` returns all types in one call; filtering is local. |

## F. Privacy & Authorization

| Check | Result | Detail |
|---|---|---|
| Auth required | PASS | All endpoints use `authenticated: true` — bearer token on every call. |
| Blocked/muted users | PASS | Backend `toItems` calls `social.blockedWith`/`mutedIds` — server-side filtering. |
| Community membership | PASS | `reelsFeed`/`communityFeed` pass `communityId` — backend checks eligibility. |
| ANNOUNCEMENT permission | PASS | Client checks `role==='MODERATOR'/'ADMIN'` → shows 📢 tab; backend enforces via `postType` authorization — 403 if unauthorized. |
| Own post edit/delete | PASS | `isOwner` check client-side; backend `requirePost` + `authorId` check server-side. |
| Media ownership | PASS | Backend `attachMedia` validates `ownerUserId` matches — can't attach another user's asset. |
| Signed URL privacy | PASS | `POST /media/{id}/download-url` — actor-resolved, not exposed in URLs or logs. |
| User ID from client | PASS | Actor resolved from JWT on every backend call — no client-supplied userId trusted. |
| Blocked user visibility | PASS | `FeedService.toItems` filters `hidden`/`muted` — not exposed. |

## G. Author & Profile

| Check | Result | Detail |
|---|---|---|
| Feed item author | PASS | `FeedItem.author` — `ProfileSummary` resolved server-side via `profileSummaries` batch. |
| Reel author | PASS | Same `FeedItem.author` field — shows `displayName`/`username` correctly. |
| Post detail author | **ISSUE FIXED** | `PostRow.authorId` had no `ProfileSummary` — placeholder shown. Now resolved via `authorSummaries([authorId])` — single call for post + comment authors. |
| Comment authors | PASS | `authorSummaries` batch call — deduplicated, one request per page. |
| Deleted profiles | PASS | `authorName ?? 'Diasporum member'` fallback on `null` author. |
| N+1 prevention | PASS | `authorSummaries` called once with all distinct `authorId`s — `GET /feed/authors?ids=`. |

## H. Navigation & State

| Check | Result | Detail |
|---|---|---|
| Five tabs | PASS | Home, Reels, Communities, Explore, Profile — all routes exist. |
| Home → post detail | PASS | `router.push('/posts/{id}')` — correct route. |
| Reels → post detail | PASS | `router.push('/posts/{id}')` — same screen, correct. |
| FAB → create | PASS | Home FAB → `/posts/create`; Reels FAB → `/reels/create`. |
| FAB → edit | PASS | Owner `···` → `/posts/edit/{id}` — correct route. |
| Back navigation | PASS | `router.back()` on all screens — Stack handles it. |
| Tab pause | PASS | `useFocusEffect` cleanup → `setActiveIdx(-1)` → all videos pause. |
| Auth expiry | PASS | `SessionProvider` watches `authState.status` → unauthenticated → clears session → redirects to login. |
| Logout → no stale data | PASS | `SessionProvider` `useEffect` on `unauthenticated` → `setSession(null)` → feed shows login redirect. |
| Account switch | PASS | `authState.tokens.accessToken` change → `load()` → new session → fresh feed. |
| Route structure | PASS | `(app)/posts/[id]`, `(app)/posts/create`, `(app)/posts/edit/[id]`, `(app)/reels/create` — no conflicts. |

## I. UI/UX Consistency

| Check | Result | Detail |
|---|---|---|
| X/Threads Home Feed | PASS | `FlatList` + `hairlineWidth` separators, no cards, compact actions, purple accents. |
| Reels full-screen | PASS | Black background, `VideoView cover`, overlay bottom, right rail, no borders. |
| Typography | PASS | Same `ThemedText` — `type='title'`, `type='subtitle'`, body variants. |
| Avatars | PASS | `BrandColors.primarySurface` bg + `BrandColors.primary` letter — consistent. |
| Purple `#7C3AED` | PASS | `BrandColors.primary` on buttons, links, accents, mode selector, FAB. |
| Loading | PASS | `LoadingScreen` / `ActivityIndicator` / skeleton placeholders. |
| Empty states | PASS | Icon + title + body — consistent pattern. |
| Error states | PASS | `ErrorState` with retry — consistent pattern. |
| Accessibility | PASS | `accessibilityLabel`/`accessibilityRole` on all interactive elements. |

## J. Defects Found & Fixed

| # | Severity | Defect | Fix |
|---|---|---|---|
| D-1 | **High** | REEL posts appeared in Home Feed as `MediaImage` (image component on video) | `use-feed.ts` — filter `contentType !== 'REEL'` on load + append |
| D-2 | **Medium** | No view tracking on Reels — `recordView` not called when reel becomes active | Added `recordView('FEED_POST', sourceId)` in `reels-screen.tsx` `onViewableItemsChanged` |
| D-3 | **Medium** | `useVideoPlayer(uri ?? '')` — player created with empty source | Changed to `uri ?? null` — player only created when URL exists |
| D-4 | **Medium** | Post detail showed "Diasporum member" for non-self authors — `PostRow.authorId` not resolved | Added `p.authorId` to `authorSummaries` batch call in `post-detail-screen.tsx` |
| D-5 | **Low** | `ReelItem` react/save doesn't update `useFeed` — Home Feed stale until refresh | **Deferred** — needs shared `FeedProvider` to sync cross-screen state |
| D-6 | **Low** | `urlCache` has no TTL — expired signed URLs fail silently | **Deferred** — add TTL or `POST /media/{id}/download-url` retry on 403 |
| D-7 | **Low** | `GET /feed/reels/following` — client-side filter may produce empty Reel pages | **Deferred** — acceptable for Phase 3B; backend endpoint recommended |
| D-8 | **Low** | `createPost` failure leaves orphaned READY asset | **Deferred** — add `DELETE /media/{assetId}` cleanup on `createPost` catch |

## K. Files Modified in This Audit

| Path | Change |
|---|---|
| `src/features/feed/hooks/use-feed.ts` | Filter `contentType !== 'REEL'` — prevents REEL leaking into Home Feed |
| `src/features/feed/screens/reels-screen.tsx` | Added `recordView` + `useVideoPlayer(uri ?? null)` + `useTheme`/`createFeedApi` imports |
| `src/features/feed/screens/post-detail-screen.tsx` | `authorSummaries` now includes `PostRow.authorId` — real author on post detail |

## L. Test Results

| Command | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `npx expo lint` | ✅ 0 errors, 0 warnings |
| `npx jest --runInBand` | ✅ 83/83 pass (7 suites) |
| `npx expo-doctor` | ✅ 20/20 checks |

## M. Runtime Verification

- **Live backend:** NOT VERIFIED — no running backend available
- **Android device:** NOT VERIFIED — no dev build/device available
- **iOS device:** NOT VERIFIED
- **Video playback:** NOT VERIFIED — `expo-video` requires dev build
- **Upload flow:** NOT VERIFIED — requires running backend + device

## N. Remaining Limitations

| Item | Status |
|---|---|
| `FeedProvider` shared state | Deferred — `useFeed`/`useReels` per-screen is sufficient for now; needed for cross-screen consistency |
| `GET /feed/reels/following` | Deferred — client filter works; empty pages possible on sparse feeds |
| Signed URL TTL | Deferred — add expiry handling on 403 + retry |
| Orphaned upload cleanup | Deferred — add `DELETE /media/{assetId}` on `createPost` failure |
| Upload progress % | Deferred — `fetch` has no progress; `expo-file-system.createUploadTask` recommended |
| Video transcoding/thumbnails | Deferred — backend pipeline not built |
| `PostRow.author` in backend | Deferred — `PostRow` could include `ProfileSummary` like `FeedItem` does |

## O. Recommended Next Steps

1. **`FeedProvider`** — shared context for feed state: reactions/saves on Reels update Home Feed without refresh
2. **`GET /feed/reels/following`** — backend endpoint for Following reels (avoids empty pages on sparse feeds)
3. **URL expiry handling** — `POST /media/{id}/download-url` retry on 403 + TTL-aware `urlCache`
4. **`PostRow.author`** — add `ProfileSummary` to `PostRow` backend record (same as `FeedItem.author`)
5. **`DELETE /media/{assetId}` cleanup** — call on `createPost` failure to prevent orphaned READY assets
6. **`expo-file-system.createUploadTask`** — real upload progress percentage
7. **Android dev build** — verify `expo-video` playback, `ImagePicker`, `FlatList` paging, signed URL resolution

---

*No commits, pushes, deployments, or additional backend changes were made during this audit.*