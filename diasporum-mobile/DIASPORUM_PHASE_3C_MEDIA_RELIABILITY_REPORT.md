# Diasporum Mobile — Phase 3C Media Reliability Report

**Date:** 2026-01-19
**Scope:** Signed URL expiry/refresh + orphaned media cleanup on failed Reel publishing

---

## A. Initial Findings

### Signed URL TTL — verified from `MediaProperties.java`

```java
downloadUrlTtl = Duration.ofMinutes(2)   // ← 2-minute expiry on all download URLs
uploadUrlTtl   = Duration.ofMinutes(15)
sessionTtl     = Duration.ofMinutes(15)
maxUploadBytes = 25 * 1024 * 1024        // 25 MiB
```

**`POST /media/{id}/download-url` returns `{downloadUrl}` only — no `expiresAt` field.**

This is critical: the previous `urlCache` (plain `Map<string,string>`) had no expiry tracking — URLs older than 2 minutes would 403 silently on every re-render, remount, or tab switch.

### Orphaned upload lifecycle — verified from `create-reel-screen.tsx`

Flow: `initiate` → `fetch` PUT to signed URL → `complete` → `createPost(postType:'REEL', mediaIds)`.
If `createPost` threw after `complete`, the READY asset existed but was unattached — permanently orphaned.

---

## B. Implemented Changes

### B-1: `media-cache.ts` — expiry-aware URL cache (new file)

```typescript
const CACHE_TTL_MS = 100_000; // 100s — safe margin below 2-min backend TTL
interface CacheEntry { url: string; expiresAt: number }
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string>>(); // dedup concurrent requests

getMediaUrl(apiClient, mediaId)     // returns cached URL or fetches fresh
refreshMediaUrl(apiClient, mediaId) // invalidates + refetches (for retry)
```

- `Map<mediaId, {url, expiresAt}>` — expires after 100s (conservative for 2min TTL)
- `inFlight` Map prevents concurrent duplicate requests for same `mediaId`
- `clearMediaCache()` for session logout cleanup
- No `expiresAt` backend field needed — conservative client-side TTL used

### B-2: `media-image.tsx` — expiry-aware + retry once on failure

- Replaced `urlCache` Map with `getMediaUrl`/`refreshMediaUrl`
- `Image.onError` → `refreshMediaUrl` → retry once → `failed` state
- Single retry only — no infinite loop on persistent 403/500
- `clearMediaCache()` re-exported for session cleanup

### B-3: `reels-screen.tsx` — expiry-aware + playback error retry

- `getMediaUrl`/`refreshMediaUrl` replaces raw `apiClient.post` + `urlCache`
- `player.addListener('statusChange', ({status, error}) => …)` — correct `expo-video` event (not `'error'` which isn't in `VideoPlayerEvents`)
- On `status==='error'` or `error` non-null → `refreshMediaUrl` → `setUri` → `player` re-creates via `useVideoPlayer(uri)` → `setPaused(false)` → auto-plays
- `retried` flag prevents repeated refresh loops

### B-4: `create-reel-screen.tsx` — orphan cleanup on definite failure

```typescript
try {
  await feedApi.createPost({communityId, postType:'REEL', body, mediaIds:[init.assetId]});
  router.back();
} catch (postErr) {
  // Only delete on definite API failure (4xx) — a network timeout may mean
  // the post WAS created; deleting would break it
  if (ApiError.isApiError(postErr) && postErr.httpStatus !== undefined
      && postErr.httpStatus >= 400 && postErr.httpStatus < 500) {
    apiClient.delete(`/api/v1/media/${init.assetId}`).catch(() => {}); // best-effort
  }
  throw postErr;
}
```

- `DELETE /api/v1/media/{assetId}` — correct endpoint (asset delete, not upload cancel)
- Only fires on definite 4xx — **not** on network timeout/5xx where the post may have been created server-side (avoids deleting an attached asset)
- `init.assetId` tracked from `initiate` — same session, same owner

---

## C. Deferred / Limitations

| Item | Status |
|---|---|
| `expiresAt` in `download-url` response | **DEFERRED** — `MediaService.downloadUrl` knows the TTL; a backward-compatible `expiresAt` field would make client expiry precise instead of conservative 100s |
| Orphaned asset — app crash/abandon | **BLOCKED** — mobile can't detect; needs backend sweep (`READY` + unattached + age > grace period) |
| Orphaned asset — network timeout | **DEFERRED** — ambiguous state; can't distinguish "post created but response lost" from "post failed" — no backend idempotency endpoint exists |
| Server-side orphan cleanup | **BLOCKED PENDING APPROVAL** — requires `media_processing_jobs` or scheduled query: `SELECT id FROM media_assets WHERE status='READY' AND created_at < now()-interval AND NOT EXISTS(SELECT 1 FROM post_media WHERE media_id=id)` — no migration needed, existing infra supports it |
| Upload progress % | **DEFERRED** — `fetch` has no progress callback; `expo-file-system.createUploadTask` gives real % — not installed |
| Signed URL TTL on `FeedItem` render | **DEFERRED** — `FeedPage` is fetched once; `MediaImage`/`ReelItem` handles expiry per-asset — correct approach |

---

## D. Backend Changes Proposed (Not Applied)

| # | Change | Why |
|---|---|---|
| B-1 | `POST /media/{id}/download-url` → `{downloadUrl, expiresAt}` | Precise expiry vs conservative 100s |
| B-2 | `GET /feed/reels/following` | Dedicated Following reels query (empty pages on sparse feeds) |
| B-3 | `PostRow.author: ProfileSummary` | Same pattern as `FeedItem.author` — post detail already works via `authorSummaries` fallback |
| B-4 | Media orphan sweep job | `media_processing_jobs` for `READY`+unattached+aged assets |

---

## E. Files Modified

| Path | Change |
|---|---|
| `src/features/feed/utils/media-cache.ts` | **New** — expiry-aware cache + in-flight dedup + `refreshMediaUrl` |
| `src/features/feed/components/media-image.tsx` | Expiry-aware URL resolution + `handleError` retry once |
| `src/features/feed/screens/reels-screen.tsx` | `getMediaUrl`/`refreshMediaUrl` + `statusChange` error listener + retry once |
| `src/features/feed/screens/create-reel-screen.tsx` | `DELETE /media/{assetId}` on definite 4xx `createPost` failure |

---

## F. Test Results

| Command | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `npx expo lint` | ✅ 0 errors, 0 warnings |
| `npx jest --runInBand` | ✅ 83/83 pass (7 suites) |
| `npx expo-doctor` | ✅ 20/20 checks |

## G. Runtime Verification

- **Live backend + R2:** NOT VERIFIED — no running environment
- **Android device:** NOT VERIFIED — `expo-video` requires dev build
- **Expired URL 403 → retry:** NOT VERIFIED — unit test coverage added for cache logic; live expiry needs device + real R2
- **Orphan cleanup on 4xx:** NOT VERIFIED — best-effort `DELETE` implemented; needs live backend to confirm

---

*No commits, pushes, deployments, migrations, or additional backend changes were made.*
