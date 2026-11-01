# Diasporum Mobile — Phase 3B Technical Assessment

## Existing Backend Capabilities

| Capability | Status | Detail |
|---|---|---|
| `post_type = 'REEL'` | ✅ Exists | `FeedService.POST_TYPES` includes `REEL`; `createPost` validates `mediaIds` non-empty for REEL |
| Community reels feed | ✅ Exists | `GET /api/v1/feed/reels/community?communityId=&cursor=&size=` → `FeedPage` — filters `contentType='REEL'` server-side |
| Following reels feed | ⚠️ Partial | No `/reels/following` endpoint — filter `followingFeed` items client-side by `contentType === 'REEL'` |
| Video upload | ✅ Exists | `FEED_VIDEO` purpose: `video/mp4`, `video/quicktime` — `POST /media/uploads` → `{assetId, uploadUrl}` → `POST /media/uploads/{id}/complete` → `AssetView` READY |
| Video download URL | ✅ Exists | `POST /media/{id}/download-url` → `{downloadUrl}` — signed R2 URL, actor-resolved from JWT |
| Author info | ✅ Exists | `FeedItem.author: ProfileSummary` — resolved server-side |
| Reactions/comments/saves/views | ✅ Exists | All existing feed endpoints work — reels are `feed_posts` records |
| Video metadata (duration, dimensions) | ❌ Missing | `AssetView` returns `mimeType`, `sizeBytes`, `status` — no duration/dimensions |
| Video transcoding | ❌ Missing | No processing job infrastructure |
| Thumbnail generation | ❌ Missing | No thumbnail pipeline |
| Adaptive streaming (HLS/DASH) | ❌ Missing | Direct R2 download only |
| Range request support | ⚠️ Unknown | R2 presigned URLs support range headers — depends on player implementation |

## Missing Mobile Capabilities

| Capability | Status | Solution |
|---|---|---|
| Video playback | ❌ Missing | `expo-video` — Expo SDK 54+ official player, supports RN 0.88 |
| Video picker | ❌ Missing | `expo-image-picker` — supports `MediaTypeOptions.Videos` |
| Vertical pager | ❌ Missing | `FlatList` with `pagingEnabled` + `snapToInterval` — no external lib needed |

## Video Storage & Delivery

- Direct R2 signed URL playback — player fetches `{downloadUrl}` from `POST /media/{id}/download-url`
- No HLS/DASH — progressive download only
- Signed URL TTL from `props.uploadUrlTtl()` — likely short-lived; `MediaImage` pattern applies (fetch URL on demand, cache in Map)
- 25 MiB upload limit — sufficient for short reels (~15-60s at typical mobile bitrates); document limitation

## Recommended Approach

- **Playback:** `expo-video` (`VideoView` + `useVideoPlayer`) — official Expo SDK player, actively maintained, supports focus/blur pause, mute control
- **Picker:** `expo-image-picker` — `launchImageLibraryAsync` with `MediaTypeOptions.Videos`
- **Pager:** `FlatList` `pagingEnabled` + `getItemLayout` — one video per screen, `onViewableItemsChanged` pauses non-visible items
- **Feed:** Reuse `FeedPage`/`FeedItem` — Community mode calls `reelsFeed` endpoint; Following mode filters `followingFeed` client-side

## Required Changes

- `npx expo install expo-video expo-image-picker` — two new packages
- No backend changes required
- No database migrations required
- `GET /reels/following` endpoint optional — client-side filter is sufficient for Phase 3B

## Performance & Cost

- Signed URLs fetched on-demand per video, cached in Map — no repeat requests on re-render
- One active `useVideoPlayer` at a time — pause on `onViewableItemsChanged` blur
- Preload: current + next item only via `player.replaceAsync` or mount-ahead — conservative
- Upload: direct-to-R2 via signed PUT URL — no proxy through Spring server

## Staged Plan

1. `expo-video` + `expo-image-picker` install
2. `use-reels.ts` — cursor pagination, mode switching, view tracking
3. `reels-screen.tsx` — `FlatList` vertical pager + `VideoView` + overlay UI
4. `create-reel-screen.tsx` — picker + signed upload + `createPost(postType:'REEL')`
5. Tests + report
