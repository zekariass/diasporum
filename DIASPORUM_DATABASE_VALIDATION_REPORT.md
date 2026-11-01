# Diasporum — Database Validation & Migration Readiness Report

**Date:** 2026-10-29
**Scope:** Inspection + validation plan + migration strategy + `contextLoads` analysis. **No database or Docker operations were performed** — the plan in §4 awaits approval (and requires the Docker engine to be started).

---

## 1. Inspection results

### Git state
- One repository at `C:\PROJECT\DIASPORUM\.git`, branch `main`, **0 commits, no remotes**.
- 90 files staged from Phase 1. New files from the backend-structure phase are **untracked** (`??`): `DIASPORUM_BACKEND_STRUCTURE_REPORT.md`, `diasporum-backend/.env.example`, `platform/`, `security/`, `identity/` packages, `application-local.yml`, `db/migration/README.md`, test resources — they will be included in the next `git add` before the (still pending) initial commit.

### SQL consistency
- Canonical schema vs strict clean-install: **8 differing lines — strict header comment + `BEGIN;`/`COMMIT;` wrapper only.** Bodies identical (re-verified by `diff`).
- Smoke test: `BEGIN;` → executable `DO $$` catalog assertions → `ROLLBACK;` (line 85) → 32 commented integration scenarios (test plan, not self-executing).

### Prerequisites (documented in schema)
- PostgreSQL **15+** (self-hosted per design §6.1), `CREATE EXTENSION IF NOT EXISTS postgis;` at line 52.
- No other extensions are created by the script; roles/grants/backup config are out of scope (ops concern noted in schema header).

### Flyway state
- `spring-boot-starter-flyway` + `flyway-database-postgresql` in POM.
- `application-local.yml` sets `flyway.enabled: true`, `locations: classpath:db/migration` (local profile only).
- `db/migration/` contains only `README.md` (records that the dir stays empty until validation + strategy approval). No migrations exist; none created.

### Docker availability — **BLOCKER**
- Docker CLI 28.0.4 installed; **engine is stopped** — `docker version`, `docker ps -a`, `docker volume ls`, `docker images` all fail with `//./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`.
- Existing containers/volumes/images **cannot be inventoried** until the engine runs. No existing database was touched or inspected.
- Local `psql` 17.3 (OSGeo4W) exists as a client fallback.

## 2. Known execution risks for validation

- 149 triggers + 114 PL/pgSQL functions have never been parsed by a live server — a syntax/ordering error on first run is plausible and is precisely what validation is for.
- `CREATE EXTENSION postgis` requires the connecting role to have privilege to create it (superuser or rds_superuser equivalent) — inside the disposable container `POSTGRES_USER` is superuser, so fine.
- `postgis/postgis` image bundles PostGIS 3.5 with matching PostgreSQL; version pinning below.

## 3. Proposed validation commands — **awaiting approval**

All operations target a **brand-new ephemeral container** with **no volume** (container removal destroys all data). Nothing touches an existing, shared, staging or production database.

### Step 0 — Start the Docker engine (prerequisite, ~1–2 min)
```powershell
# PowerShell (starts Docker Desktop, then poll until engine responds)
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
```
```bash
# poll (bash) — wait until this returns Server section
until docker info >/dev/null 2>&1; do sleep 5; done
```

### Step 1 — Create the disposable instance
```bash
docker run -d --name diasporum-pg-validate \
  -e POSTGRES_USER=diasporum_admin \
  -e POSTGRES_PASSWORD=localdev-only \
  -e POSTGRES_DB=diasporum_validate \
  -p 127.0.0.1:55432:5432 \
  postgis/postgis:17-3.5
```
- Image: `postgis/postgis:17-3.5` (PostgreSQL 17 + PostGIS 3.5; satisfies the "15+" requirement and matches local psql 17.3). Conservative alternative: `postgis/postgis:15-3.5` to validate the documented minimum — recommend testing both if time permits.
- **Creation ops:** one image pull + one container. No volumes, no host mounts, localhost-only port `55432`.

### Step 2 — Wait for readiness
```bash
until docker exec diasporum-pg-validate pg_isready -U diasporum_admin -d diasporum_validate -q; do sleep 2; done
```

### Step 3 — Execute the strict clean install (single transaction)
```bash
docker exec -i diasporum-pg-validate \
  psql -U diasporum_admin -d diasporum_validate -v ON_ERROR_STOP=1 -e -f - \
  < Diasporum_v10.11/Diasporum_v10_11_strict_clean_install.sql 2>&1 | tee /tmp/diasporum_install.log
```
Success = exit 0 and `COMMIT` reached; any failure rolls the whole install back (empty DB guaranteed).

### Step 4 — Collect versions and verify catalog assumptions
```bash
docker exec -i diasporum-pg-validate psql -U diasporum_admin -d diasporum_validate -c \
  "SELECT version(); SELECT extname, extversion FROM pg_extension;
   SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='public') AS tables,   -- expect ~162
          (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal) AS triggers,                      -- expect ~149
          (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public') AS functions,                                                 -- expect ~114
          (SELECT count(*) FROM pg_indexes WHERE schemaname='public') AS indexes,
          (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
             WHERE n.nspname='public' AND t.typtype='e') AS enums;                                    -- expect ~44"
```

### Step 5 — Run the smoke test (assertions, self-rolling-back)
```bash
docker exec -i diasporum-pg-validate \
  psql -U diasporum_admin -d diasporum_validate -v ON_ERROR_STOP=1 -e -f - \
  < Diasporum_v10.11/Diasporum_v10_11_Smoke_Test.sql 2>&1 | tee /tmp/diasporum_smoke.log
```
Success = exit 0; every failed assertion raises `EXCEPTION` and aborts with the named message.

### Step 6 — Optional deeper checks (same disposable DB)
- FK/constraint spot checks: `information_schema.table_constraints` counts per type; verify named triggers from the audit report exist (`trg_validate_published_reel_integrity`, `trg_cleanup_relationships_on_block`, …).
- `EXPLAIN` (not `ANALYZE` — empty tables) on the Reels Nearby `ST_Distance`/`ST_DWithin` shape to confirm GiST index usage intent.

### Step 7 — Cleanup (destruction of the disposable environment)
```bash
docker rm -f diasporum-pg-validate
```
- **Removal ops:** the one container. No volume was created → nothing else persists. Image `postgis/postgis:17-3.5` remains cached locally (harmless; `docker rmi` optional).

## 4. Flyway strategy proposal (for approval — nothing generated)

**Recommended: `V1__baseline.sql` produced from the canonical schema body.**

- `V1__baseline.sql` = an ordinary versioned migration containing the schema DDL **without** `BEGIN;`/`COMMIT;` — Flyway wraps each PostgreSQL migration in its own transaction. Source of the body: `Diasporum_PostgreSQL_Schema_v10_11.sql` (the canonical file has no transaction wrapper — the strict file adds it only for standalone `psql` runs). Add a header comment stating provenance and validation date.
- **`V1__baseline.sql` vs `flyway.baseline` are different mechanisms:**
  - `V1__baseline.sql` builds the schema in **empty** databases (all Diasporum environments today — greenfield).
  - `spring.flyway.baseline-on-migrate` / `flyway baseline` exists for databases that **already contain objects** — it inserts a marker row at a chosen baseline version without re-running DDL. Only relevant if a pre-existing populated DB ever joins the project; not needed now.
- **Future changes:** forward-only `V2__…`, `V3__…` migrations; never edit an applied migration. Any schema change requires an approved design change first (per project rules).
- **Caveats to honor:**
  - `CREATE EXTENSION postgis` inside `V1` requires the Flyway role to have extension privilege — fine in dev/Testcontainers; on managed Postgres it may need a DBA pre-step or `rds_superuser`. Document when deployment targets are chosen.
  - `spring.flyway.enabled` should stay `true` for `local`/`test` profiles; production migrations run via the same migrations at deploy time.
  - Testcontainers + `@ServiceConnection` (or `DynamicPropertySource`) will let Flyway apply `V1` in tests — giving free per-test-run migration validation on PostGIS.
- Nothing was generated or executed.

## 5. `contextLoads` failure — analysis and smallest safe correction

**Root cause:** `@SpringBootTest` boots the full context under the **default** profile, which defines no `spring.datasource.*`. `DataSourceAutoConfiguration` then fails with `Failed to determine a suitable driver class` (JPA/Flyway on classpath, no URL). This is an **environment gap**, not an application bug — the app correctly refuses to guess a database.

**Where the fix belongs:** test configuration — not `application.yaml` (a default-profile datasource would mask missing config and still fail at connection time), and not schema work.

**Two options:**

| Option | What it does | Trade-off |
|---|---|---|
| **A. Exclude datasource autoconfigs for tests** (smallest correction) | `src/test/resources/application.yml` sets `spring.autoconfigure.exclude` for the verified Boot 4.1.2 FQCNs: `jdbc.autoconfigure.DataSourceAutoConfiguration`, `…DataSourceTransactionManagerAutoConfiguration`, `…DataSourceInitializationAutoConfiguration`, `hibernate.autoconfigure.HibernateJpaAutoConfiguration`, `data.jpa.autoconfigure.DataJpaRepositoriesAutoConfiguration`, `flyway.autoconfigure.FlywayAutoConfiguration` (Quartz exclusion likely also needed — verify when applied). Context then boots web/security/platform beans without a DB. | Narrows what `contextLoads` covers (no persistence beans). Interim only — remove when B lands. |
| **B. Testcontainers PostGIS (real fix)** | `testcontainers` + `spring-boot-testcontainers` deps, `@ServiceConnection`/`DynamicPropertySource`; Flyway applies `V1__baseline` per test run. Matches design ("H2 alone is not sufficient"). | Needs Docker engine + 2 test-scoped deps. Scheduled for the secured-foundation milestone. |

**Recommendation:** apply A now (explicit, documented, honest — it narrows rather than hides; the suite already reports the failure) or defer both to the next milestone. **Not applied yet** — one-line preference needed.

## 6. Outstanding decisions

1. **Approve the §3 validation plan** (requires Docker Desktop start — I cannot start the engine without launching the GUI app; command provided).
2. Postgres target for validation: `17-3.5` (proposed) vs `15-3.5` (documented minimum) vs both.
3. Flyway strategy approval (§4) → then generate `V1__baseline.sql` from the canonical body.
4. `contextLoads` correction: Option A now, or wait for Option B in the secured-foundation milestone.
5. Pending from earlier reports: initial commit approval; Redis dependency removal.

## 7. Commands actually run

```
git status --short                                        # 90 staged + new untracked structure files
diff (canonical vs strict SQL)                            # 8 wrapper lines only
grep CREATE EXTENSION (schema)                            # postgis at line 52
ls db/migration; grep flyway application-local.yml        # README only; local-profile config
docker version / ps -a / volume ls / images               # engine stopped — no inventory possible
find/unzip -l on ~/.m2 Boot 4.1.2 jars                    # verified autoconfig FQCNs for §5
```

No file modified, deleted, committed, pushed; no Docker objects created; no SQL executed.

---

# UPDATE — Executed Validation (2026-10-29)

Sections 1–7 above are the pre-execution inspection and plan. This update records actual results. Docker engine 28.0.4 was running during execution.

## A. Persistent development database (Compose)

- `compose.yaml` created at workspace root — single `postgres` service, `postgis/postgis:17-3.5`, named volume `diasporum-postgres-data`, healthcheck, `unless-stopped` restart, no `env_file:` (interpolation only via `--env-file`).
- **Port conflict found:** native Windows PostgreSQL owns `0.0.0.0:5432` → host port defaults to **`127.0.0.1:5433`** (configurable via `DIASPORUM_DB_PORT`). The native service was not touched.
- `docker compose --env-file .\diasporum-backend\.env up -d` → **healthy**; `POSTGRES_DB=diasporum_dev`.
- Actual versions: **PostgreSQL 17.5** (Debian 17.5-1.pgdg110+1), **PostGIS 3.5.2** (GEOS 3.9.0, PROJ 7.2.1).
- Env files created: `diasporum-backend/.env` + refreshed `.env.example`; `diasporum-mobile/.env` + `.env.example` (`EXPO_PUBLIC_*` only); `diasporum-web/.env.local` + `.env.example` + `.gitignore` `!.env.example` fix. `git check-ignore` verified: real env files ignored, examples committed. DB password lives only in the backend `.env`.

## B. Disposable schema validation — RESULT: 2 real defects found

Environment: `docker run --name diasporum-pg-validate -p 127.0.0.1:55432:5432 postgis/postgis:17-3.5` — no volume, fresh empty `diasporum_validate`. Cleaned up afterward (`docker rm -f`).

### Approved file executed verbatim → FAILED
`psql ON_ERROR_STOP` on `Diasporum_v10_11_strict_clean_install.sql` aborted at statement ending **stdin line 1059**: `ERROR: unexpected end of function definition at end of input` (`$$`). Transaction rolled back; DB left empty.

### Defect 1 — unclosed `EXISTS (` in `validate_direct_message_sender()`
The function's `SELECT EXISTS ( SELECT 1 … AND ( … ) INTO v_match;` closes only the `AND (` group — `EXISTS (` stays open (paren depth +1). Minimal correction: `) INTO v_match;` → `)) INTO v_match;`. Sole unbalanced body of all 114 functions (verified by paren-balance scan).

### Defect 2 — trigger/table ordering
`trg_business_accounts_updated_at` and `trg_business_account_members_updated_at` (strict lines ~3879–3880) execute `CREATE TRIGGER … ON business_accounts` **before** `CREATE TABLE business_accounts` (~line 4014) and `business_account_members` (~4035). Correction: move those two trigger statements after the tables.

### Diagnostic patched copy → **SUCCESS**
A scratch copy in `/tmp` (approved files untouched) with only the two corrections above was applied to the disposable DB: **reached `COMMIT`, exit 0.** Catalog on the patched schema: 166 public tables, 152 user triggers, 44 enum types, 452 indexes, 3 views, postgis ext 3.5.2 (catalog counts exceed the file's explicit `CREATE` counts due to PK/unique implicit indexes and PostGIS objects — expected).

### Smoke test → **ALL ASSERTIONS PASSED**
`Diasporum_v10_11_Smoke_Test.sql` ran against the validated (patched) schema: `DO` block completed with zero `EXCEPTION`s, `ROLLBACK` executed, exit 0. Caveat: assertions ran against the *diagnostic* schema; rerun required after the approved file is corrected.

### Required schema changes (pending approval — files NOT modified)
1. `Diasporum_PostgreSQL_Schema_v10_11.sql` + `Diasporum_v10_11_strict_clean_install.sql`: add one `)` in `validate_direct_message_sender()` → `)) INTO v_match;`.
2. Same files: relocate `trg_business_accounts_updated_at` and `trg_business_account_members_updated_at` to after the `business_accounts`/`business_account_members` table definitions.
3. Update `Diasporum_v10_11_Change_and_Audit_Report.md` status once corrected files are re-validated.

## C. `contextLoads` — fixed properly (Testcontainers)

The failure was an environment gap (no default-profile datasource), not an application bug. Rather than excluding autoconfiguration, the test now runs against a real disposable PostgreSQL/PostGIS:

- `pom.xml` (test scope): `spring-boot-testcontainers`, `org.testcontainers:testcontainers-postgresql`, `org.testcontainers:testcontainers-junit-jupiter` — versions managed by the Boot 4.1.2 BOM (Testcontainers 2.0.5). TC2 artifact/package names used (`testcontainers-postgresql`, `org.testcontainers.postgresql`, non-generic container).
- `DiasporumBackendApplicationTests` uses `@Container` + `@ServiceConnection` on `postgis/postgis:17-3.5` (`asCompatibleSubstituteFor("postgres")`).
- `./mvnw test` → **BUILD SUCCESS, Tests run: 3, Failures: 0, Errors: 0.** `contextLoads` boots the full context (datasource, Flyway on empty migration dir, JPA, Quartz RAMJobStore) against real PostgreSQL 17.5.

## D. Flyway recommendation (unchanged, awaiting approval)

`V1__baseline.sql` generated from the *corrected* canonical body (no `BEGIN`/`COMMIT` — Flyway wraps each migration). `spring.flyway.baseline-on-migrate` is only for adopting pre-existing populated databases — not needed for greenfield environments. Forward-only `V2__…` thereafter; never edit applied migrations; managed-Postgres deployments need `CREATE EXTENSION postgis` privileges pre-arranged.

## E. Remaining blockers / approvals

1. **Approve the two schema corrections** (canonical + strict files), then re-run the disposable validation to confirm a clean verbatim install.
2. Approve Flyway baseline strategy → generate `V1__baseline.sql`.
3. Pending: initial commit; Redis dependency removal; Keycloak realm.

---

## Executed corrections & V1 baseline (2026-10-30) — approved scope

**Corrections applied to BOTH canonical and strict files** (bodies re-verified identical modulo `BEGIN;`/`COMMIT;` wrapper):
1. `)) INTO v_match;` — closes the unclosed `EXISTS (` in `validate_direct_message_sender()` (canonical L1046, strict L1053).
2. `trg_business_accounts_updated_at` + `trg_business_account_members_updated_at` relocated after `business_account_members` (canonical L4050–4051). Ordering-only.

**Live validation (disposable DB `diasporum_v1_validate`, dropped after):**
- Strict install: committed end-to-end verbatim — no scratch copy needed.
- Smoke test: **exit 0, zero errors** (all catalog assertions).
- Counts: 166 tables, 232 triggers (info_schema), 890 routines (incl. ~800 PostGIS), 452 indexes; `validate_direct_message_sender` compiles; both moved triggers present on correct tables.

**Flyway V1 (`src/main/resources/db/migration/V1__baseline.sql` = corrected canonical body, no tx wrapper):**
- `contextLoads` Testcontainers: `Successfully applied 1 migration ... now at version v1`.
- Dedicated run vs disposable `diasporum_flyway_test`: applied v1; **second start: "up to date. No migration necessary"**; history `1:true`; 167 tables (166+history). DB dropped after.
- `diasporum_dev` was NOT touched — it remains empty and will adopt V1 on first `local`-profile run (fresh-DB path, no `flyway baseline` needed). For a *pre-populated* DB the adoption strategy is: `flyway baseline -baselineVersion=1 -baselineDescription=baseline` so V1 is marked applied without re-executing.

**Redis:** `spring-boot-starter-data-redis` + `-test` removed from `pom.xml` (zero usages confirmed in src). Result: `/actuator/health` now reports **UP** (was DOWN only due to the unconfigured RedisHealthIndicator).

**Tests:** `./mvnw test` → 13/13 PASS.
