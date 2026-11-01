# Diasporum Mobile — Phase 4 Technical Assessment

## Confirmed Backend Endpoints

| Module | Endpoint | Used for |
|---|---|---|
| Community | `GET /me/communities` | User's joined communities |
| Community | `GET /me/communities/available` | Eligible communities to join |
| Community | `GET /communities/{id}/members` | Community member list |
| Community | `GET /communities/{id}/membership` | Membership status |
| Community | `POST /communities/{id}/join` | Join community |
| Social | `GET /social/followers`, `GET /social/following` | Relationship lists |
| Social | `POST /social/follows/{t}`, `DELETE /social/follows/{t}` | Follow/unfollow |
| Social | `GET /social/relationship/{t}` | Relationship state |
| Feed | `GET /feed/community?communityId=` | Community posts |
| Feed | `GET /feed/reels/community?communityId=` | Community reels |
| Feed | `GET /feed/authors?ids=` | Batch ProfileSummary (Phase 3A) |
| Identity | `GET /me/profile` | Current user profile |

## Missing Backend APIs (no search/discovery endpoints exist)

| Capability | Gap | Recommended endpoint |
|---|---|---|
| Profile search | `GET /profiles/search?q=` missing | `ILIKE` on username/displayName + `profileSummaries` batch |
| Suggested people | `GET /social/suggested` missing | Same-origin country + same-current-country + community members |
| Community search | `GET /communities/search?q=` missing | `ILIKE` on name/description |
| Post search | `GET /feed/posts/search?q=` missing | `ILIKE` on title/body + existing visibility rules |
| Reels discovery | `GET /feed/reels/discover` missing | Community feed already exists; broader discovery needs new query |

## Explore Architecture (client-side, no backend changes for MVP)

- **People**: `GET /communities/{activeId}/members` → `profileSummaries` → `relationship/{id}` per member (batch where possible)
- **Communities**: `GET /me/communities/available` — already exposed
- **Posts**: `GET /feed/community?communityId={activeId}` — community discovery
- **Reels**: `GET /feed/reels/community?communityId={activeId}` — community discovery
- **Search**: Client-side filter over fetched lists (no backend search endpoints exist)
- **Follow**: `POST/DELETE /social/follows/{t}` — existing SocialApi

## Privacy Notes

- `profileSummaries` returns `username`, `displayName`, `avatarMediaId` only — safe
- `community.members` returns `ProfileSummary[]` — no private fields
- `relationship/{t}` tells client if blocked/following — backend enforces
- `FeedItem.author` already includes `ProfileSummary` — no extra lookups needed

## Implementation Plan

1. `explore-api.ts` — API service (communities, members, following, posts, reels)
2. `explore-screen.tsx` — search bar + 4-category tab + content sections
3. `person-card.tsx` — avatar + name + username + follow button
4. `community-card.tsx` — name + description + join/status
5. `use-explore.ts` — state hook (people/communities/posts/reels + search filter)
6. `(app)/(tabs)/explore.tsx` — update to real screen
7. Tests + report

## Deferred (requires backend approval)

- `GET /profiles/search` — server-side profile search
- `GET /communities/search` — server-side community search
- `GET /feed/posts/search` — server-side post search
- `GET /feed/reels/discover` — broader reels discovery
- `GET /social/suggested` — algorithmic people suggestions
