# Diasporum — Authentication Milestone Report

**Date:** 2026-10-29
**Scope:** Dev test user + Spring Boot JWT resource-server auth + `GET /api/v1/me`. No profile persistence, no mobile/web auth wiring, no schema changes, no commits.

---

## Checks and results (actual, run)

| Item | Result |
|---|---|
| Infra health | postgres + keycloak `healthy`; issuer = `http://localhost:8081/realms/diasporum` |
| Test user `diasporum-test` | **created** (id `0289fe7c-…`), `enabled:true`, email/names set, password in gitignored `keycloak/.env.test` |
| Interactive end-user login | **YES — real Auth Code + PKCE S256 via curl** (login form POST → auth code → token exchange on `diasporum-web`) → `aud:["diasporum-api","account"]`, `iss` correct, `preferred_username: diasporum-test` |
| `./mvnw test` | **BUILD SUCCESS — 13/13 pass** |

## Implementation

- **`security/internal/config/SecurityConfig.java`** — stateless `SecurityFilterChain`: CSRF off (bearer-only REST), `/actuator/health` + `/error` public, everything else authenticated; `oauth2ResourceServer` JWT with ApiError-shaped `401 UNAUTHENTICATED` / `403 FORBIDDEN` handlers (no stack traces, no tokens in responses).
- **`application.yaml`** — `spring.security.oauth2.resourceserver.jwt.{issuer-uri,audiences}` env-driven (`KEYCLOAK_ISSUER_URI`, `KEYCLOAK_AUDIENCE`, local defaults). Boot's `JwtDecoder` handles signature (JWKS), issuer, expiry and `diasporum-api` audience — no custom crypto. `application-local.yml` deduplicated.
- **`identity/internal/api/rest/{MeController,MeResponse}.java`** — `GET /api/v1/me` → `{issuer, subject}` from `@AuthenticationPrincipal Jwt`. Returns the `(issuer, subject)` external-identity key only; no fabricated profile (persistence deferred — schema has `external_identities` but no Flyway baseline yet).

## Tests (all passing)

| Test | Covers |
|---|---|
| `JwtClaimValidationTest` (5) | accept valid; reject wrong issuer, wrong audience, missing audience, expired — deterministic `OAuth2TokenValidator` chain, no Keycloak/network |
| `MeControllerSecurityTest` (5) | 401 no token, 401 malformed, 401 expired, 200 valid (mocked `JwtDecoder`), 200 via `jwt()` post-processor — `@WebMvcTest` slice, `@MockitoBean` |
| `ApiErrorTest` (2), `contextLoads` (1) | unchanged, still green (Testcontainers PostGIS) |

## Incidents resolved during the run

1. `VERIFY_PROFILE` required action blocked first login → set test-user email/names.
2. `com.fasterxml.jackson` absent in Boot 4 (Jackson 3 → `tools.jackson`) → entry points serialize `ApiError` manually.
3. `JwtTimestampValidator` default **60s clock skew** → expired-token test must use >60s-past expiry; `Jwt.Builder` also enforces `exp > iat`.

## Not verified / limitations

- No `/api/v1/me` call against the *running* app with a real token (app not started in this phase — covered by MockMvc + real token already obtained from Keycloak).
- `diasporum-mobile` redirect is scheme-wildcard `diasporumobile://*` — tighten when the auth route exists.
- Persistent profile provisioning (`external_identities` → `profiles.id`) deferred — needs Flyway baseline.
- No role/business authorization yet — authentication only, by design.

## Commands (sanitized)

```
kcadm create users … username=diasporum-test enabled=true
kcadm update users/<id> … email/firstName/lastName     # clear VERIFY_PROFILE
kcadm set-password … --temporary=false               # value from keycloak/.env.test
curl …/auth?client_id=diasporum-web&code_challenge=…&code_challenge_method=S256  → login form
curl -X POST <form-action> username=diasporum-test   → 302 ?code=…
curl -X POST …/token grant_type=authorization_code …&code_verifier=…             → access_token (aud OK)
./mvnw test                                                                          → 13/13 PASS
```

**Pending approvals:** initial commit, Redis removal, canonical-SQL fixes, `V1__baseline` Flyway migration, mobile auth wiring.
