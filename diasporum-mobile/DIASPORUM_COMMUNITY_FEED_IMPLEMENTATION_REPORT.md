# Diasporum — Community Feed Screen Implementation Report

Date: 2026-10-31
Scope: Redesign of the home feed to the approved Threads/X-style layout
(`screen-designs/Diasporum Community Feed UI.png`) plus the new 5-position
bottom navigation.

## 1. Assessment

**Reused unchanged:** `communityFeed` view-aware ordering (= the spec's
"For You": unseen first, newest first), posts/reactions/saves/comments/polls/
help/views APIs, `PostItem` skeleton, `useFeed` pagination, view tracking,
`MediaImage`, create-post + post-detail screens, session/active-community
plumbing, `country_categories` + `country_category_modules` tables,
`activeMemberCount`.

**Backend gaps closed (minimal, documented):**
- `GET /api/v1/feed/community` — added `mode` (`FOR_YOU` default | `LATEST`
  strict-chronological) and `categoryId` params; `LATEST` reuses the same
  keyset cursor with the view flag pinned to 0.
- `FeedItem.payload` — now carries `categoryId` + `categoryName` (batch
  resolved, one query per page) so posts can render the category badge.
- `GET /api/v1/taxonomy/categories?module=FEED&countryId=` — the documented
  categories contract; returns `country_category_modules`-mapped categories
  for the destination country. Nothing hardcoded per country.
- `PostRow`/`POST_COLS` gained `category_id` (previously unselected).

**No backend change needed:** member count (via `/communities/{id}/members`
`total`), community name (via `/taxonomy/communities/{id}`).

## 2. Component structure

| Component | Role |
|---|---|
| `FeedHeader` | Logo+wordmark, search (→ Discover), bell (→ Messages), avatar (→ Profile) |
| `CommunitySelector` | Community name + live member count + "Your community" chip + switch (→ Communities) |
| `FeatureNav` | Scrollable Feed/People/Events/Jobs/Property/Vehicles/Business/Spare Bag strip |
| `ComposerBar` | Avatar + "What's on your mind?" + photo/video/poll actions |
| `CategoryFilter` | Scrollable pills from `GET /taxonomy/categories?module=FEED` |
| `ModeTabs` | For You / Latest underline tabs |
| `FeedSkeleton` / `FeedEmpty` | Loading placeholders + empty state with create/clear CTA |
| `PostItem` | Restyled: category pill, ♥ 💬 ↗ share 🔖 action row, "View N replies", overflow menu (owner edit/delete, save) |

`feed-controls.tsx` and `feed-states.tsx` group the smaller controls.

## 3. Navigation

Bottom bar now: **Home · Discover · ➕Create · Messages · Profile** per the
reference — central raised purple `+` button routes to `/posts/create`.
Reels and Communities stay routable (`href: null`) but are no longer tab
items; CommunitySelector's switch opens the Communities screen. `messages`
is an honest placeholder (messaging module not yet built).

Feature-nav destinations: Feed (this screen), People → Discover/Explore.
Events/Jobs/Property/Vehicles/Business/Spare Bag → "Coming soon" notice —
no fake screens, pending module implementation.

## 4. Behaviour

- Categories fetch from the active community's `destinationCountryId`
  (`module=FEED`); `All` clears the filter; selection refetches page 1.
- For You = view-aware ordering (existing); Latest = strict chronological.
  Both preserve the category filter and use cursor pagination.
- Pull-to-refresh, skeleton on first load, dedupe on append, REEL items
  filtered from the timeline, 50%-visibility view tracking (unchanged).
- Optimistic react/save with revert on failure (unchanged behaviour).
- Post header shows name · time · category pill · overflow; no verification
  badge rendered (backend exposes none — spec-compliant).

## 5. Files

**Created (mobile):** `feed-header.tsx`, `community-selector.tsx`,
`feature-nav.tsx`, `composer-bar.tsx`, `feed-controls.tsx`, `feed-states.tsx`,
`(tabs)/create.tsx`, `(tabs)/messages.tsx`, this report.
**Changed (mobile):** `home-feed-screen.tsx`, `post-item.tsx`, `use-feed.ts`,
`feed-api.ts`, `feed-types.ts`, `(tabs)/_layout.tsx`, `feed-api.test.ts`,
`use-reels.ts` (`ReelsMode` type).
**Changed (backend):** `FeedController`, `FeedService`, `TaxonomyController`,
`TaxonomyService`.

## 6. Verified

| Check | Result |
|---|---|
| backend `mvnw compile` | clean |
| `npx tsc --noEmit` | 0 errors |
| `npx expo lint` | 0 errors (pre-existing warnings only) |
| `npx jest` | 76/76, 7 suites |

## 7. Limitations

- Poll voting UI in the timeline: polls render with the Poll label; full
  option-voting UI lives on the post-detail screen (unchanged).
- Featured/event/job interleaved cards: no backend placement exists yet —
  no fake cards inserted (spec-compliant).
- Country-scope visibility: composer posts COMMUNITY; COUNTRY scope is
  backend-enforced on publish.
- Repost/quote: share uses the OS share sheet (no repost endpoint).
- On-device screenshots not captured in this pass.
