# Diasporum

A community-based social platform for diaspora communities. Users are auto-assigned
to a community based on their origin country and current country of residence.
Features include social feed, messaging, marketplace (properties, vehicles, jobs,
services, shop), events, matchmaking, spare-bag travel logistics, and business tools.

## Repository structure

Monorepo with three applications and shared infrastructure:

| Directory | Application | Stack |
|---|---|---|
| `diasporum-backend/` | REST API | Spring Boot 4.1, Java 21, Maven, PostgreSQL 17 + PostGIS |
| `diasporum-mobile/` | Mobile app (iOS/Android) | Expo ~58, React Native 0.88, Expo Router |
| `diasporum-web/` | Web frontend | Next.js 16, React 19, Tailwind CSS 4 |
| `Diasporum_v10.14/` | Schema SQL + design docs | PostgreSQL DDL, design update docs |
| `keycloak/` | Realm config (deprecated) | Keycloak removed per v10.12 — first-party auth |
| `compose.yaml` | Local dev infrastructure | PostGIS only (no other services) |
| `seed_*.sql` | Reference data seeds | communities, service marketplace categories |
| `*.md` (root) | Implementation reports | ~30 dated status/design reports |
| `screen-designs/` | UI design assets | |

## Architecture: modular monolith backend + thin clients

The backend is a single Spring Boot application organized as a modular monolith.
Each feature is a module under `com.diasporum.backend.{module}` with strict
boundaries enforced by ArchUnit tests.

**Critical:** Modules expose a public `{Module}Api` interface at their root
package. All other classes live under `{module}.internal.*` and are private —
cross-module access to `internal.*` is forbidden and fails the build.

```
com.diasporum.backend.{module}/
  {Module}Api.java            ← public interface other modules inject
  package-info.java           ← module boundary documentation
  internal/
    api/rest/                 ← @RestController endpoints
    application/              ← @Service business logic
    domain/                   ← Java records (domain models, NOT JPA entities)
    infrastructure/
      persistence/            ← @Repository (JdbcTemplate, NOT JPA)
      integration/            ← external service adapters (R2, Ably, etc.)
      realtime/               ← WebSocket/realtime handlers
      config/                 ← module-scoped @Configuration
```

## Database

- PostgreSQL 17 + PostGIS via `compose.yaml` (`docker compose --env-file diasporum-backend/.env up -d`)
- Flyway owns the schema — migrations in `diasporum-backend/src/main/resources/db/migration/` (V1–V38)
- `ddl-auto: validate` — JPA is on the classpath but **no `@Entity` classes exist**; all persistence is `JdbcTemplate`
- Never create JPA entities or `JpaRepository` interfaces — use `@Repository` + `JdbcTemplate` + row mappers
- Domain models are Java records in `internal.domain.*Models.java` or inner records on services
- `db/migration/README.md` documents migration rules — never modify applied migrations, never enable `spring.flyway.group` (enum splits V31/V33 depend on per-migration transactions)
- Canonical schema baseline: `Diasporum_v10.14/Diasporum_v10_14_strict_clean_install.sql` (v10.14 delta is separate)

## Authentication

First-party auth — Diasporum issues and validates its own RS256 JWTs.
Keycloak was removed (V2 migration). Google/Apple are identity-verification
providers only, not session authorities.

- `DiasporumUserPrincipal` — `userId` (users.id UUID) + `sessionId`
- `JwtAuthenticationFilter` validates Bearer tokens; `SecurityConfig` is the single chain
- Public endpoints: `/api/v1/auth/{register,login,google,apple,refresh,verify-email,resend-verification,forgot-password,reset-password}`
- `@AuthenticationPrincipal DiasporumUserPrincipal` on controller methods
- JWT keys via env (`DIASPORUM_JWT_PRIVATE_KEY` / `DIASPORUM_JWT_PUBLIC_KEY`); ephemeral keys allowed only in `local` profile

## API conventions

- All endpoints under `/api/v1/`
- Controllers are thin — delegate to `@Service` classes, use `Map.of()` for simple responses
- Errors: `ResponseStatusException(HttpStatus, "MACHINE_CODE")` — the reason string is the machine-readable error code
- Global error envelope (`ApiError` record): `{status, code, message, path, timestamp, fieldErrors}`
- `ApiExceptionHandler` in `platform.api.error` translates exceptions — never include internals in `message`
- Pagination: cursor-based (opaque string cursor, `size` param)
- IDs: UUID everywhere
- Timestamps: `Instant`
- Money: `BigDecimal` amounts + `char(3)` currency codes

## Cross-cutting services

| Service | Purpose | Key interface |
|---|---|---|
| `IdentityApi` | Profile lookup, community selection persistence | `identity.IdentityApi` |
| `CommunityApi` | Membership, active community, authorization | `community.CommunityApi` |
| `BillingApi` | Entitlement/quota consumption, idempotent usage | `billing.BillingApi` |
| `TaxonomyApi` | Countries, languages, categories, communities | `taxonomy.TaxonomyApi` |

## Business rules

- Every user has a **DEFAULT community** (auto-assigned from origin+current country) — free features
- Users can join **EXTENDED communities** — premium features consume `BillingApi` entitlements
- `BillingApi.consume*()` enforces quota/entitlement — call `preview*()` for non-mutating eligibility checks
- Content visibility is community-scoped; cross-community requires the appropriate entitlement
- `ApplicationEventPublisher` for domain events (e.g., `CountriesChangedEvent` triggers community reconciliation)
- Transactional outbox pattern for messaging events (Ably realtime via `outbox_events` table)

## Environment config

- `diasporum-backend/.env` — secrets (gitignored), `.env.example` is the committed template
- `application.yaml` — defaults + env var resolution
- `application-local.yml` — local dev overrides (ephemeral JWT keys, log-only mail, AUTO_APPROVE shop moderation)
- Media storage: Cloudflare R2 (S3-compatible) — disabled unless `R2_ENABLED=true`
- Realtime: Ably — disabled unless `ABLY_ENABLED=true`
- Mail: `DIASPORUM_MAIL_PROVIDER=local` (log-only) or `smtp` — missing → startup fails

## Testing

- Backend: Testcontainers PostgreSQL for integration tests, ArchUnit for module boundaries
- Mobile: Jest + jest-expo (`jest-expo` preset, tests in `src/__tests__/`)
- Web: no tests configured yet
- Run before declaring done: `./mvnw verify` (backend), `npx expo lint && npx tsc --noEmit` (mobile), `npx next lint` (web)

## Do NOT

- **No JPA entities** — use `JdbcTemplate` + records
- **No direct cross-module `internal.*` imports** — use `{Module}Api` interfaces
- **No committed secrets** — `.env` is gitignored, `.env.example` is the template
- **No Flyway edits on applied migrations** — always create a new V{n} file
- **No `docker compose down -v`** — destroys the named volume `diasporum-postgres-data`
- **No new dependencies without checking** — backend uses only what pom.xml declares; mobile uses `npx expo install`
- **No business rules in controllers** — delegate to services; controllers handle HTTP only
- **No wildcard CORS** — origins are an explicit allowlist from env

## App-specific instructions

- `diasporum-backend/AGENTS.md` — Spring Modulith structure, JdbcTemplate patterns, testing
- `diasporum-mobile/AGENTS.md` — Expo Router, feature structure, API client, testing
- `diasporum-web/AGENTS.md` — Next.js structure, current state
