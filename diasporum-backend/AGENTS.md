# Diasporum Backend

Spring Boot 4.1.2, Java 21, Maven. Modular monolith with strict module boundaries.
All persistence is `JdbcTemplate` — **no JPA entities exist and none should be created**.

## Build & run

```bash
./mvnw spring-boot:run -Dspring-boot.run.profiles=local   # run with local profile
./mvnw verify                                              # compile + test + ArchUnit
./mvnw test                                                # unit + integration tests
./mvnw spring-boot:run                                     # run with default profile
```

## Module structure (enforced by ArchUnit)

```
com.diasporum.backend.{module}/
  {Module}Api.java          ← public contract; other modules inject this
  package-info.java         ← "Access to internal.* is forbidden" doc
  internal/
    api/rest/               ← @RestController classes
    application/            ← @Service classes (business logic)
    domain/                 ← Java records (domain models — NOT entities)
    infrastructure/
      persistence/          ← @Repository (JdbcTemplate + row mappers)
      integration/          ← external service adapters
      realtime/             ← realtime handlers (Ably, etc.)
      config/               ← @Configuration beans scoped to this module
```

**26 modules:** administration, appconfiguration, billing, businessaccounts,
businessdirectory, community, communitychat, events, feed, identity, jobs,
matchmaking, media, messaging, moderation, notifications, platform,
propertylistings, security, servicemarketplace, shopmarketplace, social,
sparebag, taxonomy, vehiclelistings, voice.

Some modules are shell packages (only `package-info.java`) — they're being
implemented incrementally. Check `ModuleBoundaryTest.MODULES` for the
current list.

### Adding a new module

1. Create `com.diasporum.backend.{name}.package-info.java` with the boundary doc
2. Create `{Name}Api.java` interface at the module root
3. Add the module name to `ModuleBoundaryTest.MODULES` list
4. Implement `internal/` packages following the pattern above

## Persistence pattern — JdbcTemplate, NOT JPA

- `@Repository` classes use `JdbcTemplate` injected via constructor
- SQL is defined as `private static final String` constants at the top of the class
- Row mappers are `private` methods returning domain records
- Domain models are Java records — defined in `internal.domain.*Models.java` or as inner records on the service
- PostGIS queries use `ST_Y(...)` / `ST_X(...)` for lat/lng extraction
- No `@Entity`, `JpaRepository`, or `CrudRepository` anywhere in the codebase

## Service pattern

- `@Service` classes in `internal.application`
- `@Transactional` on mutating methods; `@Transactional(readOnly = true)` on read paths
- `ResponseStatusException(HttpStatus, "MACHINE_CODE")` for business errors — reason = client-facing code
- `ApplicationEventPublisher` for domain events (synchronous, same-transaction)
- `IdentityApi`, `CommunityApi`, `BillingApi`, `TaxonomyApi` injected for cross-module calls

## Controller pattern

- `@RestController` + `@RequestMapping("/api/v1")` — thin, HTTP-only concerns
- `@AuthenticationPrincipal DiasporumUserPrincipal` for the authenticated user
- `principal.userId()` is the internal profile UUID — path ids are targets, not the actor
- `Map.of()` for simple response bodies; DTO records for complex payloads
- `@Valid` on `@RequestBody` for bean validation
- `ResponseStatusException` for error responses (translated by `ApiExceptionHandler`)

## Error handling

- `platform.api.error.ApiError` record: `{status, code, message, path, timestamp, fieldErrors}`
- `platform.api.error.ApiExceptionHandler` — `@RestControllerAdvice` global translator
- Domain errors: `throw new ResponseStatusException(HttpStatus.NOT_FOUND, "THING_NOT_FOUND")`
- The `reason` string becomes the `code` field — keep it `UPPER_SNAKE_CASE`
- Never expose internals, SQL, stack traces, or secrets in `message` or `fieldErrors`

## Security

- `SecurityConfig` — single `SecurityFilterChain`, stateless, CSRF disabled
- `JwtAuthenticationFilter` — validates `Authorization: Bearer` tokens
- `DiasporumUserPrincipal` — `userId` (users.id) + `sessionId` (user_sessions.id)
- `Argon2PasswordEncoder` for password hashing
- Public endpoints: only auth endpoints + `/actuator/health` + `/.well-known/jwks.json`
- Provider webhooks: signature-verified, not JWT (`/api/v1/shop/webhooks/**`)

## Database & migrations

- Flyway migrations: `src/main/resources/db/migration/V{n}__{description}.sql`
- `flyway.baseline-on-migrate: true` + `baseline-version: 1` — dev DB was provisioned from V1 baseline
- `flyway.out-of-order: true` — feature branches may merge migrations out of order
- `db/migration-archive/` holds superseded drafts — do not add files there
- `ddl-auto: validate` — safety check only; no entities to validate
- `open-in-view: false` — no lazy-loading; design queries to be complete in one call

## Testing

- `@SpringBootTest` integration tests use Testcontainers PostgreSQL
- Tests live in `src/test/java/com/diasporum/backend/{module}/`
- `ModuleBoundaryTest` enforces `internal.*` encapsulation + no cyclic deps
- `@Testcontainers` + `@Container` for database-backed tests
- Test profile: `application-test.yml` or `@ActiveProfiles("test")`

## Configuration

- `application.yaml` — all defaults, env var resolution (`${VAR:default}`)
- `application-local.yml` — local dev overrides
- `.env` + `.env.example` — secrets/config template
- Never commit `.env` — the example file IS committed

## External services

| Service | Config | Disabled by default |
|---|---|---|
| Cloudflare R2 (media) | `R2_ENABLED`, `CLOUDFLARE_R2_*` | Yes |
| Ably (realtime) | `ABLY_ENABLED`, `ABLY_API_KEY` | Yes |
| SMTP (mail) | `DIASPORUM_MAIL_PROVIDER`, `DIASPORUM_SMTP_*` | `local` = log-only |
| Google OAuth | `DIASPORUM_GOOGLE_CLIENT_IDS` | — |
| Apple OAuth | `DIASPORUM_APPLE_CLIENT_ID` | — |

## Code conventions

- Constructor injection (no `@Autowired` on fields)
- `final` fields for injected dependencies
- Java records for DTOs and domain models
- `var` for local variables where the type is obvious
- `Optional` for nullable return values (not method parameters)
- Constants: `private static final` for SQL strings and compile-time values
- No Lombok — plain Java
