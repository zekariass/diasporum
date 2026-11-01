# Diasporum — Community Module Report
**Date:** 2026-10-30 — no new migrations (V3/V4 still pending on `diasporum_dev`). No commits.

## Schema (reused — no new tables)
`community_memberships(id,community_id,user_id,role,status,joined_at,left_at)` — UNIQUE(community_id,user_id); `community_role` enum: MEMBER/TRUSTED_HELPER/MODERATOR/COMMUNITY_ADMIN; `membership_status`: ACTIVE/SUSPENDED/LEFT. DB trigger `trg_membership_origin_country` enforces **origin-country eligibility + active community** at DB level. `user_settings.active_community_id` stays Identity-owned — Community writes it only via the new `IdentityApi` contract.

## `CommunityApi` (root)
`isActiveMember`, `membershipOf`, `membershipsOf`, `activeMemberCount`, `activeCommunityId`, `setActiveCommunity` (membership-validated), `canAccess` (member + community active), `hasRole`, `isModeratorOrAbove`, `isCommunityAdmin`. Records: `MembershipView`.

## Public-API additions to other modules (boundary-respecting)
- `IdentityApi`: `activeCommunityId`/`setActiveCommunity` (user_settings is Identity-owned); `ProfileSummary` gained `originCountryId`/`currentCountryId`
- `TaxonomyApi.communitiesForOriginCountry` — eligible-community listing
- `SocialApi.blockedWith` — batch either-direction block check for member-list filtering

## REST (`/api/v1`)
`GET /me/communities`, `GET /me/communities/available`, `GET /me/communities/{id}`, `GET/PUT /me/active-community`, `POST /communities/{id}/join`, `GET|DELETE /communities/{id}/membership`, `GET /communities/{id}/members` (member-only, block-filtered, profileSummaries batch), `GET /communities/{id}/members/{id}`, `DELETE /communities/{id}/members/{id}` (admin), `POST /communities/{id}/members/{id}/role` (admin, LAST_ADMIN protected).

## Behaviour
- **Join**: origin-country match required (app check + DB trigger safety net); idempotent on duplicate; `LEFT` rejoins restore ACTIVE; `SUSPENDED` rejected; inactive community → 400; non-ACTIVE account → 403
- **Leave**: idempotent; auto-clears persisted active community if it was selected
- **Active community**: only selectable when ACTIVE member; null clears; survives sessions via `user_settings`
- **Members**: ACTIVE-only, viewer must be member, block-filtered via `SocialApi.blockedWith` + batch `IdentityApi.profileSummaries` (no N+1)
- **Roles**: COMMUNITY_ADMIN can change roles/remove members; last COMMUNITY_ADMIN protected

## Tests — 83/83 BUILD SUCCESS (Community suite 7/7)
join idempotency, wrong-origin/inactive rejection, leave+rejoin+active-clear, active-requires-membership, member-list access control, role changes + last-admin, full HTTP coverage. Architecture tests green — zero cross-module internal imports.

## Issues fixed mid-run
- `activeCommunityId` NPE on nullable column → `filter(nonNull)`
- Stale `ProfileService` class after brace repair → `mvn clean`

## Deferred / needs approval
1. `TRUSTED_HELPER` role semantics — enum exists, privileges undefined
2. Membership `SUSPENDED` admin action (schema field exists; only remove/role-change exposed — suspend endpoint deferred)
3. `default_community_id` not yet used (schema column exists; not part of active-community flow)
