# Diasporum — DB Baseline Review & Actuator Health Investigation

**Date:** 2026-10-30
**Scope:** Investigation only. No canonical SQL, schema, Flyway, database state, Keycloak, or auth changes were made. No commits.

---

## Part A — Schema defect review

**Files inspected:**
- `Diasporum_v10.11/Diasporum_PostgreSQL_Schema_v10_11.sql` (canonical)
- `Diasporum_v10.11/Diasporum_v10_11_strict_clean_install.sql` (identical body + `BEGIN;`/`COMMIT;` wrapper, +7 line offset — re-verified at defect sites)
- `DIASPORUM_DATABASE_VALIDATION_REPORT.md` (prior scratch-validation findings)

**Defect 1 — still present.** `validate_direct_message_sender()`, canonical line 1045 (strict 1052):
`SELECT EXISTS (` opens at ~1036 and the `AND (` condition group opens at ~1037. The last OR-branch ends `))` closing its own parens, then line 1045 has only `) INTO v_match;` — one `)` short; `EXISTS (` remains unclosed → `unexpected end of function definition` at install.
**Correction:** `) INTO v_match;` → `)) INTO v_match;` (single character). No semantic change — it just closes the `EXISTS` predicate already intended.

**Defect 2 — still present.** Canonical lines 3872–3873 (strict 3879–3880) create:
- `trg_business_accounts_updated_at` → table `business_accounts` created at line 4007
- `trg_business_account_members_updated_at` → table `business_account_members` created at line 4028

Both `CREATE TRIGGER` statements precede their tables by ~135 lines → `relation "business_accounts" does not exist` at install.
**Correction:** relocate exactly these two `CREATE TRIGGER` statements to immediately after `business_account_members` (line ~4040). Trigger/function/text unchanged — pure ordering fix.

Both fixes were previously proven in a scratch copy: full strict install committed, smoke-test catalog assertions passed (166 tables, 152 triggers). No other defects found then.

## Part B — Actuator `DOWN` root cause (verified live)

Ran the app with `MANAGEMENT_ENDPOINT_HEALTH_SHOW_DETAILS=always` (env override only, no config change). Component breakdown:

| Indicator | Status |
|---|---|
| db (PostgreSQL) | UP — `isValid()` |
| diskSpace, livenessState, readinessState, ping, ssl | UP |
| **redis** | **DOWN — `RedisConnectionFailureException: Unable to connect to Redis`** |

**Cause:** `spring-boot-starter-data-redis` + `spring-boot-starter-data-redis-test` in `pom.xml` (lines 43, 97) — a dependency with **zero usages in the codebase** and no Redis server running. Auto-configuration registers `RedisHealthIndicator` → connection refused → overall DOWN. Not a service problem, not a config defect in the health system — it's an *unapproved/unused infrastructure dependency* (removal already recommended in the Phase-1 report).

**Smallest justified correction:** remove both Redis artifacts from `pom.xml`. This eliminates the indicator entirely (correct, since the architecture has no Redis), not just its reporting. Inferior alternative — `management.health.redis.enabled=false` — hides the symptom while keeping dead infrastructure; not recommended. Removal awaits your approval.

## Recommendations

**Clean install:** apply the two minimal corrections above to *both* canonical and strict files (they must stay in sync), re-run disposable-container validation, then re-verify the smoke assertions verbatim.

**Flyway baseline:** after corrected schema is validated, generate `V1__baseline.sql` from the canonical body (no `BEGIN/COMMIT` — Flyway wraps it). Distinction: `V1__baseline.sql` is a *versioned migration* run on fresh DBs; `flyway baseline` is a *marking command* for adopting pre-populated DBs — for `diasporum_dev` (currently empty apart from Flyway history) the versioned-migration path is correct. Later DBs (staging/prod) already holding schema use `baseline()`.

## Confirmation

No canonical SQL file was modified. No migration generated/applied. No DB data, users, passwords, or volumes touched. Backend process stopped after diagnosis. Awaiting approval for: (a) the two SQL corrections, (b) Redis dependency removal, (c) `V1__baseline.sql` generation.
