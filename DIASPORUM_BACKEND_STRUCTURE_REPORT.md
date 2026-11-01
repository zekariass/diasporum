# Diasporum — Backend Structure Report

**Date:** 2026-10-29
**Scope:** Foundational package structure for `diasporum-backend` only. No product features, no Keycloak integration, no migrations, no dependency changes. Mobile and web untouched. No commit created.

---

## 1. Existing vs. proposed structure

### Before
```text
com.diasporum.backend
└── DiasporumBackendApplication.java        (only class)
src/main/resources/
├── application.yaml                        (app name only)
├── db/migration/                           (empty)
├── static/  templates/                     (empty Initializr leftovers — left in place)
```

### After (this phase)
```text
com.diasporum.backend
├── DiasporumBackendApplication.java        (unchanged)
├── platform/                               ← technical capabilities module
│   ├── package-info.java
│   └── api/error/
│       ├── ApiError.java                   standard REST error envelope (record)
│       └── ApiExceptionHandler.java        @RestControllerAdvice → ApiError
├── security/
│   └── package-info.java                   JWT validation + authority mapping (docs only)
└── identity/
    ├── package-info.java                   profiles, external_identities, privacy
    └── internal/package-info.java          establishes public/internal boundary

src/main/resources/
├── application.yaml                        (unchanged)
├── application-local.yml                   (NEW — env-var driven datasource/Flyway/OIDC)
├── db/migration/README.md                  (NEW — baseline strategy pending, no migrations)
├── static/  templates/                     (unchanged — removal deferred)
└── .env.example (backend root)             (NEW — env template, no secrets)

src/test/
├── java/com/diasporum/backend/
│   ├── architecture/package-info.java      (NEW — Modulith/ArchUnit gate pending)
│   ├── platform/api/error/ApiErrorTest.java(NEW — 2 unit tests, passing)
│   └── DiasporumBackendApplicationTests.java (unchanged — still fails, see §4)
└── resources/application-test.yml          (NEW — placeholder for Testcontainers config)
```

## 2. Files created / changed

| File | Action |
|---|---|
| `platform/package-info.java` | created |
| `platform/api/error/ApiError.java` | created — `{status, code, message, path, timestamp, fieldErrors}` envelope |
| `platform/api/error/ApiExceptionHandler.java` | created — 400 validation (with field map), 400 malformed body, status-preserving `ErrorResponseException` (keeps 404s as 404), 500 fallback that logs server-side and never leaks internals |
| `security/package-info.java` | created — module contract only, no config classes |
| `identity/package-info.java`, `identity/internal/package-info.java` | created — module + boundary docs |
| `application-local.yml` | created — `${ENV_VAR}` datasource, `ddl-auto: validate`, `open-in-view: false`, Flyway location, OIDC `issuer-uri`/`audiences` placeholders |
| `src/test/resources/application-test.yml` | created — placeholder documenting Testcontainers intent |
| `db/migration/README.md` | created — records that `db/migration/` stays empty until schema validation + baseline strategy approval |
| `.env.example` | created — `DIASPORUM_DB_*`, `KEYCLOAK_ISSUER_URI`, `KEYCLOAK_AUDIENCE` placeholders |
| `architecture/package-info.java` (test) | created — reserves the package for boundary tests |
| `platform/api/error/ApiErrorTest.java` | created — verifies envelope construction |

No existing file was modified, moved or deleted.

## 3. Architectural reasoning and deviations from the approved reference

Followed `Diasporum_Spring_Boot_REST_API_Folder_Structure_v10_11.md`:

- **Module set reduced to immediate need.** The doc defines ~24 modules; only `platform`, `security`, `identity` were established (matching this task's scope and the next milestone). The remaining modules (`taxonomy`, `community`, `social`, `feed`, `messaging`, …) are deferred to their phases — creating 21 empty package trees now would violate "no empty structure for its own sake".
- **Shared error package placement:** doc §5 allows "a small shared REST/API support package … if it remains technical". Placed at `platform.api.error` since `platform` owns technical capabilities per doc §3.
- **`internal/` convention** demonstrated on `identity` (the first real feature module); other modules adopt it as they land.
- **package-info.java docs** used as module-boundary documentation, per the doc's `package-info.java` convention (also future Modulith metadata hooks).

**Deviations (documented, intentional):**

1. Root package `com.diasporum.backend` kept (doc's `com.yourcompany.diasporum` is a placeholder; task instructs to keep it).
2. **Modulith/ArchUnit dependency not added** — doc §6 rule 8 requires architecture tests, but the choice (Modulith vs ArchUnit) and Boot 4.1.2-compatible version need verification; package reserved, dependency decision deferred rather than guessing.
3. No top-level `config/` package — per the doc, configuration lives in each module's `internal/config`; global beans (e.g. `SecurityFilterChain`) will live in `security/` when implemented.
4. `static/`/`templates/` Initializr leftovers left in place (empty dirs; removal is trivial but outside "create structure" scope — flagged for the config milestone).
5. `docs/`, `Dockerfile`, `compose.yaml`, `.github/` from the doc's repository-level layout not created yet — deferred to the environment/tooling milestone.

## 4. Build and test results

| Command | Result |
|---|---|
| `./mvnw -DskipTests compile` | **PASS** |
| `./mvnw test` | **BUILD FAILURE — expected, unchanged cause** |
| ↳ `ApiErrorTest` | **2/2 PASS** |
| ↳ `DiasporumBackendApplicationTests.contextLoads` | **1 ERROR** — `Failed to load ApplicationContext`: no datasource configured (`Failed to determine a suitable driver class`). Same pre-existing limitation as the Phase-0 assessment; cannot pass until datasource/test config exists. Not weakened or hidden. |

Note: `application-local.yml` only applies under the `local` profile, so it does not change the default-profile test failure.

## 5. Remaining prerequisites before the secured-backend milestone

1. Disposable PostgreSQL/PostGIS validation (strict clean install + smoke tests) — plan in `DIASPORUM_PHASE_1_SETUP_REPORT.md` §5, awaiting approval.
2. Flyway baseline strategy decision → first `V1__baseline` migration.
3. Keycloak dev realm + `security` module implementation (`SecurityFilterChain`, JWT validation, `(issuer, subject)` → `external_identities` → `profiles.id` mapping).
4. Testcontainers PostgreSQL/PostGIS test configuration so `contextLoads` and integration tests pass without a permanent DB.
5. Redis dependency removal decision (recommended in Phase-1 report; still pending).
6. Modulith vs ArchUnit selection + dependency for `architecture/` tests.
7. Error-format conventions doc (`docs/api/error-format.md`) once endpoint work begins; correlation-ID filter when observability lands.

## 6. Commands run

```
./mvnw -DskipTests compile          # PASS
./mvnw test                          # FAIL (contextLoads: no datasource; ApiErrorTest 2/2 pass)
```

No commits, pushes, database operations, dependency changes, or mobile/web modifications.
