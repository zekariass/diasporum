# Diasporum — Profile Management & Onboarding Report
**Date:** 2026-10-30 — no migrations beyond planned V2, no commits, no seeds.

## Schema reused (no new tables/columns — no V3 needed)
`profiles` (username, display_name, bio, city, date_of_birth, origin/current_country_id, account_status, profile_completed_at), `external_identities`, `ux_profiles_username_ci` (existing partial CI-unique index → race-safe username claims), `profile_media` (AVATAR variant → `avatarMediaId`, read-only until R2 milestone), `countries` (active flag), `user_settings`/`user_privacy_settings` (trigger).

## Endpoints (all authenticated; profile id from JWT-resolved identity only)
| Endpoint | Behaviour |
|---|---|
| `GET /api/v1/me/profile` | full self-view incl. own `dateOfBirth` |
| `PATCH /api/v1/me/profile` | sparse update, whitelist-only |
| `GET /api/v1/me/profile/completion` | `{complete, missing[]}` |
| `GET /api/v1/usernames/availability?username=` | `{username, available, reason}` — no account data |
| `GET /api/v1/countries` | active countries, name-sorted (currently `[]` — see below) |

## Rules
- **Username:** `^[a-z0-9_]{3,20}$`, lowercased on write + lookup, 22-value reserved list → 409 `USERNAME_RESERVED`/`USERNAME_TAKEN`/`INVALID_USERNAME`; DB unique index catches races.
- **Completion:** complete iff `display_name`,`username`,`origin_country_id`,`current_country_id` all set → `profile_completed_at` stamped once, never reset; separate from `account_status` (no enum change).
- **PATCH safety:** unknown/protected keys → 400 `PROTECTED_OR_UNKNOWN_FIELD` (Boot tolerates unknown JSON props — the check is explicit in code); Bean-Validation via programmatic `Validator`; invalid/inactive country → 400 `INVALID_COUNTRY`; all writes in one TX (verified: failed TX leaves no partial updates).

## Verified live (real PKCE token, `diasporum-test`)
`GET /me/profile` → full provisional profile; `completion` → `missing:[4]`; PATCH `displayName+username` → applied + normalized; availability → `TAKEN`/`RESERVED`; `countries` → `[]`; `{"accountStatus":"X"}` → **400**.

## Tests — 30/30 PASS
New `ProfileManagementIntegrationTest` (10): retrieval, patch+completion-once, missing-fields, invalid country, username rules+CI-taken, concurrent claim 409, TX rollback, 401s, protected-field 400, active-only countries. All existing suites green.

## Outstanding decisions
- **`countries` is EMPTY** — reference-data seeding task needed (curated country list — data decision, not invented here). Until seeded, `originCountryId`/`currentCountryId` can't be satisfied → profiles stay incomplete.
- Reserved-username list is code-defined; move to table when admin tooling exists.
- Avatar: `avatarMediaId` read-only until R2 upload flow.
