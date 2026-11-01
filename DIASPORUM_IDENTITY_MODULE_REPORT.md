# Diasporum — Identity Module Completion Report
**Date:** 2026-10-30 — first fully implemented business module. No schema/migration/env/Keycloak changes; no commits.

## Public API (module root — the only legal import for other modules)
`identity/IdentityApi.java` + `internal/application/IdentityApiImpl.java`:
- `findByExternalId(issuer, subject)` → `Optional<IdentityView(profileId,issuer,subject)>` — **lookup-only, never provisions**
- `profileSummary(profileId)` → `Optional<ProfileSummary(id,username,displayName,accountStatus,profileCompleted)>` — public-safe, no email/DOB/privacy data
No entities/repos/services leak across the boundary; architecture tests confirm.

## New endpoints (all authenticated, own-user only via JWT→resolve)
| Endpoint | Behaviour |
|---|---|
| `GET /api/v1/me/settings` | `{defaultCommunityId, activeCommunityId, preferredLanguageCode, theme}` |
| `PATCH /api/v1/me/settings` | sparse; `theme` enum + `preferredLanguageCode` BCP-47-ish regex; community IDs validated `is_active` → 400 `INVALID_COMMUNITY` |
| `GET /api/v1/me/privacy-settings` | all 9 `user_privacy_settings` fields |
| `PATCH /api/v1/me/privacy-settings` | sparse; `dmPermission` enum-validated; same whitelist+Validator pattern as profile PATCH |

Settings rows are trigger-created at provisioning (`trg_bootstrap_profile_settings`); `NOT_FOUND` if the row is anomalously absent.

## Already in place from prior milestones (preserved, not reimplemented)
Keycloak JWT auth, `(issuer,subject)`→profile resolution, first-login provisioning (single TX + constraint race), `GET /me`, profile GET/PATCH/completion, username rules + CI-unique claims, `/usernames/availability`, `/countries`, `ApiError` envelope.

## Files created/modified
- NEW: `IdentityApi.java`, `internal/application/IdentityApiImpl.java`, `internal/application/SettingsService.java`, `internal/api/rest/{SettingsController, SettingsResponse, UpdateSettingsRequest, PrivacySettingsResponse, UpdatePrivacySettingsRequest}`, test `IdentityApiAndSettingsTest.java`
- None deleted; existing classes untouched.

## Schema gaps found — none blocking
- Username update cadence (e.g., "change every N days") has no `username_changed_at` column → not implemented; reported, not patched.
- `countries`/`communities` still empty → `INVALID_COUNTRY`/`INVALID_COMMUNITY` validation is code-ready; needs the reference-data seeding decision.

## Tests — 61/61 BUILD SUCCESS
`IdentityApiAndSettingsTest` (5): API lookup-no-provision, public-safe summary, settings round-trip + invalid community, privacy round-trip, HTTP enum/protected-field/401 checks. All 26 architecture + provisioning + profile + JWT tests green.

## Remaining decisions
1. Country/community reference-data seeding (blocks completion of onboarding fields)
2. Username-change rate-limit policy (needs schema or app-level tracking — approval required)
3. Whether `dmPermission`/`allowFollowers` enforcement lands in `social`/`messaging` when those modules are implemented (identity only stores the preference)
