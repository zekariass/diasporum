# Diasporum — Identity Persistence & Flyway Adoption Design (review only)

**Date:** 2026-10-30 — no database, migration, or code changes made.

## Phase 1 — `diasporum_dev` vs V1 (verified live)

| Check | Result |
|---|---|
| Tables in `diasporum_dev` | 4 = empty `flyway_schema_history` + PostGIS objects (`spatial_ref_sys`, `geometry_columns`, `geography_columns`) |
| Migration history | **0 rows** — Flyway-managed but unmigrated |
| Extension conflict | None — V1 uses `CREATE EXTENSION IF NOT EXISTS postgis` |
| Conflicting objects/data | None — PostGIS objects are extension-owned |

**Adoption procedure (recommended):** just start the app — Flyway sees an existing (empty) history table on a fresh schema and applies `V1__baseline` normally. **`flyway baseline` is NOT needed** — that mechanism is for pre-*populated* DBs. Documented alternative reserved for staging/prod clones: `flyway baseline -baselineVersion=1`.

## Phase 2 — Identity model already exists in V1 (no new tables needed)

| Table | Key columns | Fit |
|---|---|---|
| `profiles` | `id` uuid PK, `username` (CI-unique, nullable), `display_name` NOT NULL, `origin_country_id`+`current_country_id` NOT NULL FK→`countries`, `account_status` enum, `profile_completed_at`, `deleted_at` | Internal Diasporum user — PK is the internal ID, distinct from Keycloak `sub` |
| `external_identities` | `profile_id` FK CASCADE, **`UNIQUE(issuer,subject)`**, `email_at_link_time`, `email_verified`, `linked_at`, `last_login_at` | Exactly the approved `(issuer,subject)` mapping; multiple identities per profile supported natively |
| `user_settings` / `user_privacy_settings` | `user_id` PK→profiles | Auto-created by `trg_bootstrap_profile_settings` AFTER INSERT on profiles (`ON CONFLICT DO NOTHING`) |
| `account_status` enum | `ACTIVE,SUSPENDED,DELETION_PENDING,DELETED` | Lifecycle present; no `ONBOARDING` value |

**No duplicate concepts created; no schema additions needed for the mapping itself.**

## The one real gap — required fields absent at first login

`profiles` requires `display_name`, `origin_country_id`, `current_country_id` (NOT NULL + FK). A Keycloak login supplies none of these (no `countries` seed rows exist either — table is empty post-V1). And `external_identities.profile_id` is NOT NULL, so the link cannot be recorded without a profile row.

**Options (needs your decision):**
- **A (recommended): V2 seeds a sentinel country** — e.g. `('Unspecified','XX', is_active=false)` — provisional profiles reference it for origin+current; onboarding later replaces them and sets `profile_completed_at`. Keeps NOT NULL integrity, sentinel invisible to pickers via `is_active=false`.
- B: V2 makes the two country columns nullable — weaker integrity, contradicts design intent that every profile has a country context.
- C: add `ONBOARDING` to `account_status` — combinable with A but adds an enum migration; `profile_completed_at IS NULL` already signals "incomplete", so probably unnecessary.

Also needed: a `display_name` source at provisioning — `preferred_username` claim (fall back to `sub` prefix) — decision required.

## Phase 3 — First-login provisioning (idempotent, race-safe)

```
GET /api/v1/me  (authenticated JWT)
  1. extract validated (iss, sub)           — never trust client IDs/emails
  2. SELECT p.* FROM profiles p
       JOIN external_identities e ON e.profile_id=p.id
      WHERE e.issuer=:iss AND e.subject=:sub
  3. found → UPDATE last_login_at → return profile
  4. not found → TX BEGIN
       INSERT profiles(display_name=<claim>, origin_country_id=<sentinel>,
                       current_country_id=<sentinel>)
         → trigger auto-creates user_settings + user_privacy_settings
       INSERT external_identities(issuer,subject,email_at_link_time=<email claim>)
       TX COMMIT → return profile
  5. on unique_violation(issuer,subject) → competitor won the race
       → re-SELECT at step 2 → return winner's profile
```
Uniqueness is enforced by `UNIQUE(issuer,subject)`; the retry handles concurrent first-logins — no advisory locks needed. Email is stored only as a link-time snapshot, never used for merging.

## Phase 4 — `/api/v1/me` response (proposed)

```json
{ "id": "<profiles.id>", "displayName": "…", "username": null,
  "accountStatus": "ACTIVE", "profileCompleted": false }
```
`issuer`/`subject` drop out of the response (they were milestone-probe fields); `profileCompleted` = `profile_completed_at IS NULL` → clients route to onboarding. No Keycloak admin data or claims.

## Phase 5 — Proposed V2 (structure, unexecuted)

```sql
-- V2__identity_onboarding_seed.sql
INSERT INTO countries(name, iso2, is_active) VALUES ('Unspecified','XX', false)
   ON CONFLICT (iso2) DO NOTHING;
```
(Optionally `ALTER TYPE account_status ADD VALUE 'ONBOARDING'` if option C is chosen — defer.)
Validation path: disposable DB → V1 → V2 → assert sentinel row + insert provisional profile end-to-end.

## Decisions requiring approval

1. `diasporum_dev` adoption via normal V1 apply on next boot (no `baseline` command needed).
2. Sentinel-country approach (A) vs nullable countries (B) vs +`ONBOARDING` status (C).
3. Provisional `display_name` source (`preferred_username` vs generic placeholder).
4. `/me` response shape change (drop iss/sub, add internal profile fields).
5. V2 file naming/content (seed-only vs +enum).

---

## Implemented (2026-10-30)

**V1 adoption:** applied to `diasporum_dev` via normal Flyway boot — `1:true` (fresh-DB path, no `baseline` needed). **V2** `V2__identity_profile_provisioning.sql`: `DROP NOT NULL` on `profiles.display_name`/`origin_country_id`/`current_country_id` — `2:true`. No sentinel country, no enum changes, no seeds.

**Provisioning** (`identity/internal/service/IdentityProvisioningService`, JdbcTemplate + `TransactionTemplate`): lookup by `(issuer,subject)` → found: `last_login_at` update + return; missing: single-TX `profiles` insert (null onboarding fields) → trigger creates `user_settings`/`user_privacy_settings` → `external_identities` insert (email claim stored as link-time snapshot only). Constraint-violation → re-query winner; non-race violations rethrown.

**`GET /api/v1/me`** now returns `{id, displayName, accountStatus, profileCompleted}` — verified live: `{"id":"c5bee322-…","displayName":null,"accountStatus":"ACTIVE","profileCompleted":false}`; second call same id, `last_login_at` touched.

**Tests: 20/20 PASS** — `IdentityProvisioningIntegrationTest` (7: first-login provisioning + triggers, reuse+touch, `(iss,sub)` constraint, distinct issuers, no email-merge, 6-way concurrent single-profile, no-orphan-on-failure); `MeControllerSecurityTest` updated; existing suite green.
