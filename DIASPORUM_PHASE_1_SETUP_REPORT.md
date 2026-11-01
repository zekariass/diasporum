# Diasporum — Phase 1 Setup Report

**Date:** 2026-10-29
**Scope:** Unified Git repository, backend dependency review, database-readiness review, environment-configuration gaps. No product features, no database operations, no remote/push, **no commit created**.

---

## 1. Workspace structure (actual)

```text
C:\PROJECT\DIASPORUM\            ← sole Git repository root (new)
├── .git/                        ← created in this phase (branch: main, no commits)
├── .gitignore                   ← created in this phase
├── DIASPORUM_INITIAL_REPOSITORY_ASSESSMENT.md
├── DIASPORUM_IMPLEMENTATION_PLAN.md
├── DIASPORUM_PHASE_1_SETUP_REPORT.md   (this file — staged, will exist post-commit)
├── Diasporum_v10.11\            ← approved docs + SQL package (9 files)
├── diasporum-backend\           ← Spring Boot 4.1.2 / Java 21 Initializr skeleton
├── diasporum-mobile\            ← Expo SDK 58 / RN 0.88.1 / TS ~6.0.3
└── diasporum-web\               ← Next.js 16.4.3 / Tailwind v4 / TS ^5
```

## 2. Git consolidation

### Prior state
- `C:\PROJECT\DIASPORUM\` — not a repository.
- `diasporum-backend\` — no `.git`.
- `diasporum-mobile\.git` — starter repo, 1 commit ("Initial commit").
- `diasporum-web\.git` — starter repo, 1 commit ("Initial commit from Create Next App").
- No `.git` files (worktree pointers) or other nested repositories outside `node_modules`.

### Actions completed
1. Removed `diasporum-mobile\.git` and `diasporum-web\.git` (histories discarded — explicitly approved; no source/config/manifest/lockfile touched).
2. Created root `.gitignore` (secrets/env, dependencies, Java/Maven, build outputs, logs, IDE, OS artifacts).
3. `git init` at workspace root → branch `main` (global `init.defaultBranch=main`).
4. `git add -A` → **89 files staged**. **No commit created.**

### Verification results
| Check | Result |
|---|---|
| `git rev-parse --show-toplevel` | `C:/PROJECT/DIASPORUM` ✓ |
| All 4 dirs inside repo | ✓ (9 backend, 51 mobile, 17 web, 9 docs files staged) |
| Nested `.git` remaining | None (`find` confirms only `./.git`) ✓ |
| Secrets/env files staged | None — scan for `.env*`, `*.pem`, `*.key`, `*.p8/.p12/.jks`, `*secret*` empty ✓ |
| Generated output staged | None — 0 matches for `node_modules`, `.next/`, `target/`, `.expo`, `dist/` ✓ |
| Lockfiles/manifests staged | `pom.xml`, both `package.json` + `package-lock.json`, `app.json`, `tsconfig`s, `next.config.ts`, `mvnw*` ✓ |
| Source intact | Manifests, all `src/`, docs — verified post-`.git` removal ✓ |
| Warnings | LF→CRLF notices only (normal on Windows, `core.autocrlf`); no embedded-repo warnings |

### `.gitignore` review and findings
- Root `.gitignore` covers: `.env`, `.env.*` (with `!.env.example`, `!.env.*.example` exceptions), key/cert materials, `node_modules/`, `target/`, `.next/`, `dist/`, `build/`, `web-build/`, `.expo/`, `coverage/`, generated typings (`expo-env.d.ts`, `next-env.d.ts`, `*.tsbuildinfo`), logs, `.idea/`, `.vscode/`, `.claude/`, OS files, `.vercel`.
- Per-project `.gitignore` files kept — still apply inside their directories.
- **Findings:**
  - Mobile `.vscode/` and `.claude/` directories exist on disk but are excluded from staging (IDE/agent-specific). Files were not deleted.
  - `diasporum-web/.gitignore` contains `.env*` with **no** `!.env.example` exception — a future `.env.example` inside `diasporum-web/` would be ignored (deeper `.gitignore` wins over root negation). Flagged for amendment when env files are introduced.
  - `diasporum-mobile/.gitignore` covers only `.env*.local` — a plain `.env` there is now caught by the root `.gitignore`. Its stray `example` pattern (template artifact) ignores any file/dir literally named `example`; harmless today.
  - `diasporum-backend/.gitignore` had no env coverage — now covered at root.
- Backend `HELP.md` (Initializr-generated) is gitignored by its own `.gitignore` — excluded.

## 3. Proposed initial commit (staged, NOT created)

**89 files** across: root docs (3 `.md`), `Diasporum_v10.11/` (9 files incl. PDF/DOCX/SQL), `diasporum-backend/` (9 files), `diasporum-mobile/` (51 files incl. ~30 image assets), `diasporum-web/` (17 files), root `.gitignore`.

Suggested message (for when approved): `chore: initial unified repository — backend, mobile, web and v10.11 design docs`. Git identity is configured globally (`user.name`/`user.email` present) — commit will succeed when approved.

## 4. Backend dependency review

**Confirmed:** Java 21, Spring Boot **4.1.2** parent, package `com.diasporum.backend` (kept per instruction).

**Unused dependency — recommend removal:**
- `spring-boot-starter-data-redis` (line 43) and `spring-boot-starter-data-redis-test` (line 97): zero references in `src/` (only 2 Java files exist), Redis is not in the approved v10.11 architecture. **Impact of removal:** none on code; removes an unneeded auto-configuration (and a latent failure mode — Redis auto-config expects a broker); transitively drops lettuce-core and test slices. If a cache/rate-limit store is ever approved later, re-adding is a one-line change. **Not changed — awaiting approval.**

**Present and consistent with approved architecture:** `webmvc`, `security`, `security-oauth2-resource-server` (Keycloak resource server), `data-jpa`, `flyway` + `flyway-database-postgresql`, `quartz`, `validation`, `actuator`, `postgresql`, `devtools` (runtime/optional), plus Boot 4 `*-test` slice starters. No Kafka/microservice infrastructure present. No version changes made or recommended.

## 5. Database readiness

- **SQL equivalence re-verified:** canonical schema vs strict clean-install differ in **8 lines only** — the strict file's header comment, `BEGIN;` and trailing `COMMIT;`. Bodies are identical. ✓
- Smoke test structure: `BEGIN;` → executable `DO $$` catalog assertions → `ROLLBACK;` (line 85) → 32 commented integration scenarios (a test plan, not self-executing).
- Prerequisites documented: PostgreSQL **15+**, `CREATE EXTENSION postgis` (line 52 of schema; `postgis` extension asserted first in smoke test).
- Execution risks (to be proven by validation): 149 triggers + 114 PL/pgSQL functions unverified by a live server; trigger ordering under concurrency untested; GiST index plans unexamined.
- **Docker status:** CLI 28.0.4 installed; **engine is stopped** (`docker info`/`docker version` return client only). Local `psql` 17.3 (OSGeo4W) available as client.

### Proposed disposable validation environment (NOT executed — awaiting approval)

- **Image:** `postgis/postgis:17-3.5` (PostgreSQL 17 + PostGIS 3.5; satisfies "15+", matches local psql 17.3). Conservative alternative: `postgis/postgis:15-3.5` to test the documented minimum.
- **Config:** ephemeral container, no volume (removal wipes data), localhost-only port, throwaway credentials.

```bash
# 1. Start disposable instance (requires Docker Desktop engine running)
docker run -d --name diasporum-pg-validate \
  -e POSTGRES_USER=diasporum_admin \
  -e POSTGRES_PASSWORD=localdev-only \
  -e POSTGRES_DB=diasporum_validate \
  -p 127.0.0.1:55432:5432 \
  postgis/postgis:17-3.5

# 2. Wait for readiness
until docker exec diasporum-pg-validate pg_isready -U diasporum_admin -d diasporum_validate; do sleep 2; done

# 3. Run strict clean install (single transaction; ON_ERROR_STOP surfaces first failure)
docker exec -i diasporum-pg-validate \
  psql -U diasporum_admin -d diasporum_validate -v ON_ERROR_STOP=1 -f - \
  < Diasporum_v10.11/Diasporum_v10_11_strict_clean_install.sql

# 4. Verify catalog state (expect ~162 tables, 44 types, 149 triggers)
docker exec -i diasporum-pg-validate psql -U diasporum_admin -d diasporum_validate -c \
  "SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='public') AS tables,
          (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
            WHERE n.nspname='public' AND t.typtype='e') AS enums,
          (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal) AS triggers;"

# 5. Run smoke-test catalog assertions (self-rolling-back; raises EXCEPTION on failure)
docker exec -i diasporum-pg-validate \
  psql -U diasporum_admin -d diasporum_validate -v ON_ERROR_STOP=1 -f - \
  < Diasporum_v10_11/Diasporum_v10_11_Smoke_Test.sql

# 6. Cleanup — destroys container and all data
docker rm -f diasporum-pg-validate
```

- **Success criteria:** step 3 exits 0 (COMMIT reached); step 5 exits 0 (all `RAISE EXCEPTION` assertions pass, block ends in ROLLBACK); object counts match audit report.
- **Risks:** first run may surface PL/pgSQL errors — that *is* the validation; port 55432 collision check needed; PostGIS extension is bundled in the image; no named volume → cleanup is single `docker rm -f`.
- **Safety:** brand-new empty DB only; nothing connects to any existing/shared/staging/production database.

## 6. Environment configuration gaps

| Area | State |
|---|---|
| `.env.example` files | **None exist** in any project (also no `.env` files anywhere — verified by `find`) |
| Backend datasource | No `spring.datasource.*`, Flyway, JPA config — `application.yaml` has app name only |
| Backend Keycloak/OIDC | No issuer/client/audience config; no `SecurityFilterChain` code exists yet |
| Backend Redis config | None — moot if dependency removed (§4) |
| Mobile API endpoint | No API base URL; `app.json` has no `extra` config; scheme still generic `diasporummobile` |
| Web API endpoint | No API config; no `.env.local` convention documented |
| Secret management | No documented guidance for any project |
| Dev setup docs | No root README; mobile/web READMEs are starter templates; backend `HELP.md` is gitignored Initializr boilerplate |
| Build/test instructions | Not documented for the unified workspace |

**Recommended (future phase, not done now):** one `.env.example` per project, root `README.md` with dev prerequisites + per-project commands, backend `application-local.yml` template, Keycloak dev-realm config once provisioned, mobile `app.json extra`/typed env, web server-side env for admin BFF.

## 7. Commands executed

```
find . -name ".git" -not -path "*/node_modules/*"          # located nested repos
cat diasporum-mobile/.gitignore diasporum-web/.gitignore  # ignore review
git config --global user.name/user.email/init.defaultBranch
rm -rf diasporum-mobile/.git diasporum-web/.git           # approved consolidation
git init && git add -A                                    # repo create + staging (no commit)
git rev-parse --show-toplevel                             # → C:/PROJECT/DIASPORUM
git diff --cached --name-only                             # staged-file audit + secret scan
grep -rn -i "redis" diasporum-backend/src/                # → unused
diff (canonical vs strict SQL)                            # → 8 wrapper lines only
grep -n ROLLBACK|COMMIT (smoke test)                      # → BEGIN/DO/ROLLBACK confirmed
docker info / docker version                              # → engine stopped
find . -name ".env*"                                      # → none exist
```

No file was deleted except the two `.git` metadata directories. No commit, remote, push, database operation, dependency change or feature implemented.

## 8. Remaining risks and decisions awaiting approval

1. **Initial commit** — staged and reviewed; awaiting your approval to create it.
2. **Redis removal** — recommendation pending (§4); POM unchanged.
3. **Database validation** — proposed commands pending (§5); requires Docker engine start + approval.
4. **`diasporum-web/.gitignore`** — `.env*` lacks an `!.env.example` exception; amend when env files arrive.
5. **Mobile `.gitignore` `example` pattern** — template artifact; harmless, noted.
6. **Env/docs scaffolding** — `.env.example` files, root README, dev-setup docs recommended next phase.
7. **CRLF/LF** — Git normalizes line endings on this Windows workspace; consider `.gitattributes` hygiene later if cross-platform issues appear (backend already carries one).
8. **Staging is disposable** — the staged set reflects the tree at run time; any new files before the commit need a re-`git add`.
