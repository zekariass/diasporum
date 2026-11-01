# Diasporum — Initial Repository Assessment

**Date:** 2026-10-29
**Baseline reviewed:** Diasporum System Design & PostgreSQL schema v10.11
**Scope:** Read-only assessment. No application code, schema, dependencies, `.env` files or Git state were modified. No product features implemented.

---

## 1. Workspace inventory (actual)

```text
C:\PROJECT\DIASPORUM\
├── Diasporum_v10.11\                     # Documentation + SQL package (NOT a git repo)
│   ├── Diasporum_Project_Context_Updated.md
│   ├── README_v10_11.md
│   ├── Diasporum_System_Design_v10_11.docx / .pdf
│   ├── Diasporum_PostgreSQL_Schema_v10_11.sql      (361 KB canonical schema)
│   ├── Diasporum_v10_11_strict_clean_install.sql   (361 KB, same body in BEGIN/COMMIT)
│   ├── Diasporum_v10_11_Smoke_Test.sql             (catalog assertions + test plan)
│   ├── Diasporum_v10_11_Change_and_Audit_Report.md
│   └── Diasporum_Spring_Boot_REST_API_Folder_Structure_v10_11.md
│
├── diasporum-backend\                    # Spring Initializr skeleton — NOT under git
│   ├── pom.xml                           # Spring Boot 4.1.2, Java 21, Maven
│   ├── mvnw / mvnw.cmd / .mvn/           # Maven wrapper 3.3.4 → Maven 3.10.0
│   ├── HELP.md, .gitignore, .gitattributes
│   └── src\
│       ├── main\java\com\diasporum\backend\DiasporumBackendApplication.java
│       ├── main\resources\application.yaml        (app name only — no datasource/security config)
│       ├── main\resources\db\migration\           (EMPTY — no Flyway migrations)
│       ├── main\resources\static\, templates\     (empty Initializr leftovers)
│       └── test\...\DiasporumBackendApplicationTests.java  (contextLoads only — currently FAILS)
│
├── diasporum-mobile\                     # Expo app — own git repo, clean, 1 commit
│   ├── package.json                      # expo ~58.0.21 (SDK 58), RN 0.88.1, React 19.3.0
│   ├── app.json                          # expo-router + splash plugins; typedRoutes, reactCompiler
│   ├── tsconfig.json                     # strict, extends expo/tsconfig.base, @/* → src/*
│   ├── src\app\{_layout,index,explore}.tsx         # untouched template screens
│   ├── src\components\, hooks\, constants\         # template components/theme only
│   ├── scripts\reset-project.js, assets\, AGENTS.md
│   └── .vscode\, .claude\settings.json
│
├── diasporum-web\                        # Next.js app — own git repo, clean, 1 commit
│   ├── package.json                      # next 16.4.3, React 19.3.0, Tailwind v4, TS ^5
│   ├── next.config.ts                    # cacheComponents, partialPrefetching, agentFeedback
│   ├── app\{layout,page}.tsx, globals.css          # untouched create-next-app template
│   ├── eslint.config.mjs, tsconfig.json
│   └── AGENTS.md (Next.js agent rules)
│
├── DIASPORUM_INITIAL_REPOSITORY_ASSESSMENT.md      (this report)
└── DIASPORUM_IMPLEMENTATION_PLAN.md
```

Notes:

- `C:\PROJECT\DIASPORUM` itself is **not a git repository**. `diasporum-mobile` and `diasporum-web` each have their own repo (single initial commit, clean tree). `diasporum-backend` and `Diasporum_v10.11` have **no version control at all**.
- A separate `QALIYE` project exists at `C:\PROJECT\QALIYE` — sibling directory, not inspected or touched, per project rules.
- No standalone architecture-diagram file exists; diagrams are embedded in the system-design PDF/DOCX.
- No `.env`, `.env.example`, Dockerfile, compose file or CI workflow exists anywhere yet.

## 2. Confirmed technologies and versions

| Layer | Confirmed | Evidence |
|---|---|---|
| Backend | Java 21.0.7, Spring Boot **4.1.2**, Maven wrapper → Maven 3.10.0 | `pom.xml`, `java -version` |
| Backend deps | webmvc, security, oauth2-resource-server, data-jpa, flyway (+postgresql module), quartz, data-redis, validation, actuator | `pom.xml` |
| Mobile | Expo **SDK 58** (`expo ~58.0.21`), expo-router ~58.0.28, RN 0.88.1, React 19.3.0, TypeScript ~6.0.3 | `package.json` |
| Web | Next.js **16.4.3**, React 19.3.0, Tailwind CSS v4, TypeScript ^5, ESLint 9 | `package.json` |
| Database | PostgreSQL 15+ with PostGIS required; schema is a clean-install baseline | schema header, `CREATE EXTENSION postgis` |
| Identity | Keycloak (approved baseline; design lists Authentik as alternative — task instruction pins Keycloak) | design §6.1 |
| Realtime / storage / push | Ably / Cloudflare R2 / Expo Push | design §6.1 |
| Voice | LiveKit or Cloudflare Realtime SFU, one per session (design says "evaluate before locking"; instruction selects LiveKit first) | design §15 |
| Payments | Stripe for web; RevenueCat explicitly "under evaluation, not selected" | schema header, design App. D/E |
| Video | Cloudflare Stream remains a candidate only — not approved | design, context §3 |

## 3. Backend state

**Exists but is an unmodified Spring Initializr skeleton.**

- Compiles: `./mvnw -DskipTests compile` → **PASS** (Java 21, all dependencies resolve).
- `./mvnw test` → **FAIL**: `contextLoads` cannot start the context — `Failed to determine a suitable driver class` (JPA + Flyway on classpath, no datasource configured). Expected for a skeleton; the test can never pass until datasource/test config exists.
- `application.yaml` contains only `spring.application.name`. No datasource, Flyway, OIDC/Keycloak, Redis, Quartz, logging or actuator configuration.
- `db/migration/` is empty — **no Flyway baseline exists**; the v10.11 SQL has not been converted to migrations (correctly pending an agreed strategy).
- Package `com.diasporum.backend` contains only the application class — **no modular-monolith package structure yet**. The approved structure defines ~24 modules under a root package with `internal/` layering; the suggested root package in the doc is `com.yourcompany.diasporum` — actual code uses `com.diasporum.backend`. Decide whether to keep `com.diasporum.backend` as root or rebase to the doc's naming before scaffolding modules (see §7).
- No SecurityConfig, no OIDC resource-server wiring, no REST controllers, no global error handling, no DTOs, no OpenAPI, no `docs/`, `.env.example`, Dockerfile or CI.
- `spring-boot-starter-data-redis` is present in the POM (Initializr-selected). Redis is **not** in the approved architecture baseline; flag for review — either justify (e.g., cache/rate-limit) or remove in the first config milestone.
- `src/main/resources/templates/` exists (empty) — should be removed; REST-only API per design.
- **Not under git.** This is the biggest immediate risk — unversioned code.

## 4. Mobile state

**Correctly initialized Expo SDK 58 project; untouched template; not yet Diasporum-configured.**

- `npx expo install --fix` → up to date; `npx expo-doctor` → 20/20 checks pass (run by user before this assessment).
- `npx tsc --noEmit` → **FAILS with 3 errors in the starter template**:
  - `src/constants/theme.ts(6,8)` — TS2882 side-effect import of `@/global.css`
  - `src/components/animated-icon.web.tsx(5,21)` — missing `./animated-icon.module.css` declaration
  - `src/components/app-tabs.web.tsx(38,6)` — web `Link`/`Pressable` ref type mismatch
  Root cause: the generated `expo-env.d.ts` (gitignored, created on first `expo start`) plus a CSS-module declaration are missing; one is a genuine web-only template typing issue. Fix is trivial but is an implementation task.
- `npx expo lint` → **not runnable without modifying the project**: no ESLint config or `eslint` dependency exists; `expo lint` would scaffold them. Skipped per assessment rules.
- No test framework (no Jest/test script).
- Navigation: Expo Router present with tab template; no app-specific routes.
- Missing foundations: app identity (`ios.bundleIdentifier`/`android.package` unset; scheme is generic `diasporummobile`), API client, env config, auth (no `expo-secure-store`, `expo-auth-session`), push (`expo-notifications`), Ably client. All expected at this stage.
- `.gitignore` covers `.env*.local` and `expo-env.d.ts`; plain `.env` is committable by design (Expo convention) — document the secret-handling convention when env files are introduced.

## 5. Web state

**Correctly initialized Next.js 16 project; untouched template; scope-compatible.**

- `npm run lint` → **PASS**; `npx tsc --noEmit` → **PASS**; `npm run build` → **PASS** (static prerender of `/` and `/_not-found`).
- Notable config: `cacheComponents: true`, `partialPrefetching: true`, `experimental.agentFeedback` — verify these are intended to keep (Next 16 defaults from `create-next-app`).
- No routing beyond `/`, no API client, no auth, no admin/informational structure yet — consistent with the limited web scope. Do not build consumer features here.

## 6. Database readiness

- `Diasporum_PostgreSQL_Schema_v10_11.sql` and the strict clean-install body are **byte-identical except the `BEGIN;`/`COMMIT;` wrapper and header** (verified by diff — 8 differing lines, all wrapper). One canonical schema; consistent.
- Schema requires `CREATE EXTENSION postgis` (line 52); PostgreSQL 15+ and PostGIS are documented prerequisites.
- Static inventory matches the audit report: 162 tables, 44 types, 114 functions, 149 triggers, ~209 explicit indexes.
- Smoke test = executable catalog assertions inside a rolled-back transaction + a documented 32-scenario integration test plan (scenarios are comments, not self-executing).
- **Not validated against a live server** — stated by the docs themselves and confirmed here (no PostgreSQL/PostGIS instance is running; Docker Desktop is installed but the engine is stopped; local `psql` 17.3 exists via OSGeo4W).
- Clean-install script is explicitly for a new empty DB only; it was **not** executed (correct per safety rules).
- **No Flyway baseline strategy agreed yet** — the schema says "Flyway-managed transaction" but `db/migration/` is empty. This is a required decision before any migration work (e.g., `V1__baseline.sql` wrapping the canonical schema vs. `flyway baseline` on a provisioned DB).
- Static-review observations (not defects, flagged for live validation): heavy trigger-based integrity (149 triggers) needs concurrency testing; smoke test itself notes PL/pgSQL syntax is unproven until executed; PostGIS GiST index usage and query plans unverified.

## 7. Backend structure vs. approved folder structure

Current: `com.diasporum.backend` with a single application class. Approved doc: modular monolith with ~24 feature modules (`identity`, `social`, `community`, `taxonomy`, `media`, `feed`, `communitychat`, `messaging`, `voice`, `businessaccounts`, `businessdirectory`, `events`, `jobs`, `propertylistings`, `vehiclelistings`, `sparebag`, `matchmaking`, `servicemarketplace`, `billing`, `notifications`, `moderation`, `administration`, `appconfiguration`, `security`, `platform`), each with public API + `internal/{api/rest, application, domain, infrastructure, config}`.

Gaps to close (in order):

1. Decide the root package (`com.diasporum.backend` vs doc's placeholder) — one-time decision, cheap now, expensive later.
2. Add Modulith/ArchUnit dependency and a `ModuleBoundaryTests` skeleton before module code lands (approved doc §6 rule 8).
3. Create only `platform`, `security`, `identity`, `taxonomy`, `community`, `social` shells first (per plan) — do **not** scaffold all 24 empty packages.
4. Add `application-{local,test}.yml`, `.env.example`, `docs/`, Dockerfile/compose and CI skeleton as the doc prescribes.
5. Remove empty `static/`/`templates/`; add shared REST error format + correlation ID support under a technical package.
6. Module-naming note: the folder doc uses `communitychat`, `businessaccounts`, etc. — keep package names exactly as documented for traceability.

## 8. Security and architectural review (assessment-stage)

- No secrets found in any project; nothing sensitive committed. `.gitignore` coverage is adequate in mobile/web; backend `.gitignore` does not list `.env` — add when env config lands.
- No code exists yet to leak data; the real risks are all ahead: `(issuer, subject)` → `external_identities` mapping, per-endpoint authorization, community-visibility checks on search/detail/media paths, DTO field hygiene (never serialize addresses/coordinates/distances), conversation participant isolation, backend entitlement enforcement, and outbox-before-publish ordering are all documented requirements the implementation must honor.
- Redis dependency present without an approved use — review before adopting.
- `expo-env.d.ts` / generated typings are gitignored (correct); ensure future secrets never enter `app.json`/client env.
- Root package is unversioned and there is no CI anywhere — code could be lost; there is no verification gate.

## 9. Documentation inconsistencies / open decisions

1. **Identity:** design says "Keycloak recommended; Authentik alternative"; task instruction pins **Keycloak only**. Treated as resolved in favor of Keycloak (explicit instruction wins).
2. **Voice provider:** design says "evaluate LiveKit and Cloudflare Realtime SFU before locking"; instruction selects **LiveKit as initial provider** with backend-controlled selection. Treated as resolved; adapter must still hide provider detail.
3. **RevenueCat:** explicitly "under evaluation, not selected" — do not integrate until decided.
4. **Cloudflare Stream:** candidate only — not approved.
5. **Package root:** `com.diasporum.backend` (code) vs `com.yourcompany.diasporum` (doc placeholder) — needs a one-line decision.
6. **Redis:** in POM, not in approved architecture — keep/remove decision needed.
7. **Flyway baseline representation:** clean-install SQL → `V1__baseline` vs `flyway.baseline` on provisioned DB — needs agreement before migrations.
8. **`web.output: "server"`** in mobile `app.json` — Expo web target is configured although web is a separate Next.js app; harmless but likely unintended long-term.
9. Live validation of the schema on disposable Postgres/PostGIS remains outstanding (blocked on Docker engine or approval for another disposable target).

## 10. Recommended next steps (no implementation performed)

1. **Put `diasporum-backend` under git** (and decide whether the three projects + docs should live in one repo/monorepo or stay separate) — before any code is written.
2. Agree the open decisions in §9 (package root, Redis, Flyway baseline strategy, Keycloak realm provisioning approach).
3. Stand up a disposable PostgreSQL 15+/PostGIS instance (Docker `postgis/postgis` once Docker Desktop is running) and execute the strict clean install + smoke catalog assertions — **requires approval** before running.
4. Milestone 1 (see `DIASPORUM_IMPLEMENTATION_PLAN.md`): backend configuration foundation — environment-based config, datasource, Flyway baseline, security skeleton, error format, health checks, and a passing test harness.

## 11. Commands actually run

| Command | Result |
|---|---|
| `ls -la`, `find` over workspace | Inventory as above |
| `git status`, `git log` (root, mobile, web) | root & backend: not repos; mobile/web: clean, 1 commit each |
| `diff` canonical vs strict SQL | identical except BEGIN/COMMIT wrapper |
| `pdftotext` on system design + `grep`/`sed` | design reviewed |
| `java -version`, `node -v`, `npm -v`, `psql --version`, `docker -v`/`docker ps` | JDK 21.0.7; Node 22.22.3; npm 10.9.8; psql 17.3; Docker 28.0.4 installed, engine stopped |
| `cd diasporum-backend && ./mvnw -DskipTests compile` | **PASS** |
| `cd diasporum-backend && ./mvnw test` | **FAIL** — no datasource (`contextLoads`) |
| `cd diasporum-mobile && npx tsc --noEmit` | **FAIL** — 3 template type errors (see §4) |
| `cd diasporum-web && npm run lint` | **PASS** |
| `cd diasporum-web && npx tsc --noEmit` | **PASS** |
| `cd diasporum-web && npm run build` | **PASS** |
| `npx expo lint` / `npx expo-doctor` | doctor 20/20 (user-run earlier); lint not run — would scaffold ESLint config (project change) |

**No destructive commands run. No database commands run. No dependencies installed or upgraded. No files modified or deleted.**
