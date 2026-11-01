# Diasporum Backend — Phase 1.2 Authentication Production-Readiness Report

**Date:** 2026-10-31
**Scope:** Close the remaining production-readiness gaps in first-party auth
without redesigning the existing architecture (v10.12).
**Status:** IMPLEMENTED — full suite green (141 tests), live HTTP verified

---

## 1. Files Changed

### Modified

| File | Change |
|---|---|
| `security/JwtService.java` | Persistent-key handling: both-or-neither validation, startup keypair-match check (probe sign+verify), `allow-ephemeral-keys` gate — prod fails without configured keys |
| `identity/internal/application/EmailService.java` | `LocalEmailService` now `@ConditionalOnProperty(diasporum.mail.provider=local)`; imports cleaned |
| `security/internal/config/SecurityConfig.java` | Wildcard CORS → env allowlist (`diasporum.cors.allowed-origins`); added `X-Device-Name` header; wildcard+credentials guard |
| `identity/internal/application/ExternalIdentityService.java` | Google audience check now accepts **any** configured client ID (previously only `clientIds[0]` — Android/iOS/web multi-client tokens would have been rejected) |
| `src/main/resources/application.yaml` | `spring.mail.*`, `diasporum.mail.*`, `diasporum.cors.allowed-origins`, `diasporum.auth.jwt.allow-ephemeral-keys` env wiring |
| `src/main/resources/application-local.yml` | `allow-ephemeral-keys: true`, `mail.provider: local`, local CORS origins (`localhost:3000/8081/19006`) |
| `pom.xml` | Added `spring-boot-starter-mail` |
| `.env.example` | Removed stale `KEYCLOAK_*` vars and old DB name; documented all new variables |
| `src/test/.../AuthFlowIntegrationTest.java`, `JwtClaimValidationTest.java` | Updated `JwtService` constructor calls for new `allowEphemeral` parameter |

### Created

| File | Purpose |
|---|---|
| `identity/internal/application/SmtpEmailService.java` | Production SMTP adapter (`provider=smtp`); fails startup without SMTP host; tokens only in email body, never logs |
| `db/migration/V2__drop_keycloak_authentication_method.sql` | Follow-up migration removing `KEYCLOAK` from the `user_sessions.authentication_method` CHECK |
| `docs/authentication-operations.md` | Full ops guide: env vars, keygen/rotation, SMTP, CORS, provider config, startup checklist |
| `docs/auth-api-v1.yaml` | OpenAPI 3.0 spec (written in Phase 1 validation session) |
| `security/JwtKeyConfigurationTest.java` | 5 tests — key rules (missing/partial/mismatched/valid/ephemeral) |
| `identity/internal/application/SmtpEmailServiceTest.java` | 3 tests — delivery content + missing-host failure |
| `security/CorsConfigurationTest.java` | 4 tests — allowed/rejected origins, no wildcard |

## 2. Database Changes

**`V2__drop_keycloak_authentication_method.sql`** — a follow-up migration, not a baseline rewrite. Decision basis: `flyway_schema_history` in `diasporum_dev_v10_12` contains a `<< Flyway Baseline >>` marker at v1 (the DB was provisioned via `psql`, not by running V1), while fresh databases (Testcontainers, any new install) apply V1 for real — a follow-up V2 is correct for both paths and never rewrites applied history.

```sql
ALTER TABLE user_sessions DROP CONSTRAINT user_sessions_authentication_method_check;
ALTER TABLE user_sessions ADD CONSTRAINT user_sessions_authentication_method_check
    CHECK (authentication_method IN ('PASSWORD','GOOGLE','APPLE'));
```

**Verified live:** Flyway applied V2 to `diasporum_dev_v10_12` (history shows v2 `drop keycloak authentication method`, success); the constraint now reads `IN ('PASSWORD','GOOGLE','APPLE')` and an actual `INSERT ... 'KEYCLOAK'` is rejected: `violates check constraint "user_sessions_authentication_method_check"`. Testcontainers runs also applied V2 (`Migrating schema "public" to version "2"`).

## 3. Environment Variables

| Variable | Status |
|---|---|
| `DIASPORUM_JWT_PRIVATE_KEY` / `DIASPORUM_JWT_PUBLIC_KEY` | Wired; pair validated at startup |
| `DIASPORUM_JWT_ALLOW_EPHEMERAL_KEYS` | New — `false` default; `true` only via local profile |
| `DIASPORUM_MAIL_PROVIDER` | New — `local`/`smtp`; missing → no bean → startup fails |
| `DIASPORUM_MAIL_FROM`, `DIASPORUM_APP_BASE_URL` | New |
| `DIASPORUM_SMTP_HOST/PORT/USERNAME/PASSWORD/AUTH/STARTTLS/STARTTLS_REQUIRED/SSL` | New — wired to `spring.mail.*` |
| `DIASPORUM_CORS_ALLOWED_ORIGINS` | New — replaces wildcard |
| `DIASPORUM_GOOGLE_CLIENT_IDS`, `DIASPORUM_APPLE_CLIENT_ID` | Pre-existing; unchanged |
| `KEYCLOAK_*` | Removed from `.env.example` (already unused in runtime config) |

## 4. Tests Executed — Actual Results

| Command | Result |
|---|---|
| `./mvnw test` (full suite) | **141 tests, 0 failures, 0 errors — BUILD SUCCESS** (4m28s) |
| `JwtKeyConfigurationTest` | 5/5 — missing keys rejected, single key rejected, mismatched pair rejected, configured pair issues/verifies, ephemeral works when allowed |
| `SmtpEmailServiceTest` | 3/3 — verification link in body, reset link in body, blank host → `IllegalStateException` |
| `CorsConfigurationTest` | 4/4 — two configured origins allowed, unconfigured origin 403, no wildcard emitted |
| `ExternalIdentityIntegrationTest` | 11/11 — controlled JWKS fixture (unchanged coverage) |
| `ModuleBoundaryTest` | 26/26 — no architecture violations introduced |

### Live HTTP (dev backend, `diasporum_dev_v10_12`)

| Check | Result |
|---|---|
| Preflight `Origin: http://localhost:3000` | 200 + `Access-Control-Allow-Origin: http://localhost:3000` |
| Preflight `Origin: https://evil.example` | 403 `Invalid CORS request`, no allow-origin header |
| `/.well-known/jwks.json` | 200 — unchanged JWK shape |
| `INSERT ... 'KEYCLOAK'` into `user_sessions` | Rejected by check constraint |

## 5. Items Verified Against Real External Providers

**None — real Google/Apple verification has NOT been executed.** It requires
real OAuth client IDs and a provider-issued ID token, which are not available
in this environment. What *is* verified: issuer/audience/expiry/signature/
`email_verified` handling and all linking scenarios against a controlled JWKS
fixture serving real RSA signatures (`ExternalIdentityIntegrationTest`, 11
tests). The manual real-provider smoke-test procedure is documented in
`docs/authentication-operations.md` §6 and must be recorded when executed.

## 6. Remaining Production Deployment Requirements

- **Secrets**: provision `DIASPORUM_JWT_PRIVATE_KEY`/`PUBLIC_KEY` (and bump
  `DIASPORUM_JWT_KID`) in the deployment secrets manager — see ops doc §4.
- **SMTP relay**: real `DIASPORUM_SMTP_*` credentials + `DIASPORUM_MAIL_PROVIDER=smtp`.
- **CORS**: real origin list for the web/admin front ends.
- **Provider IDs**: `DIASPORUM_GOOGLE_CLIENT_IDS`, `DIASPORUM_APPLE_CLIENT_ID`.
- **Real-provider smoke test**: manual, per ops doc §6 — not yet executed.
- **Multi-instance**: all replicas must share the same key pair (JWKS stays
  consistent; sessions are DB-backed, no per-instance state).

## 7. Security Concerns / Notes

- **Token-in-URL links**: verification/reset links carry the token in the query
  string (industry standard); tokens are single-use, expiring, and hashed at
  rest. SMTP failure logs never include the token.
- **Apple/Google `nonce`**: the backend does not bind an expected nonce on
  `/api/v1/auth/{google,apple}` — the ID token is presented directly after the
  client-side flow. Documented in ops doc §6; add nonce binding later if the
  login call itself needs replay protection.
- **Ephemeral-key guard**: production startup now fails rather than silently
  signing with disposable keys (the previous behavior). Also fails if only one
  key is set or the pair mismatches.
- **Email enumeration**: `forgot-password`/`resend-verification` remain
  always-204 regardless of account existence.
- **CORS credentials**: `allowCredentials=false` permanently — Bearer auth is
  header-based; wildcard+credentials is additionally guarded by a startup check.
- **Stale `.env`**: the local `.env` may still contain unused `KEYCLOAK_*`
  variables — harmless, but remove them locally for cleanliness (`.env` is
  gitignored and was not modified).

---

*All results above reflect actually-executed runs on 2026-10-31. Real-provider
verification is explicitly marked as not executed.*
