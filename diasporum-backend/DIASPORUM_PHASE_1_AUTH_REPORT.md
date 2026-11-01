# Diasporum Backend — Phase 1 First-Party Authentication Report

**Date:** 2026-10-31 (validation updated; implementation originally 2026-01-19)
**Scope:** Remove Keycloak, implement v10.12 first-party auth
**Status:** VALIDATED — full test suite green (129 tests, 0 failures); live HTTP verification passed

---

## Summary

Keycloak removed from runtime authentication. First-party auth implemented per v10.12: `users` (permanent identity), `profiles` (optional 1:0..1 extension sharing `users.id`), `user_credentials` (Argon2id), `user_sessions`, `user_refresh_tokens` (opaque + rotation), `email_verification_tokens`, `password_reset_tokens`, `external_identities`, `external_identity_credentials`. Diasporum-issued RS256 JWTs + JWKS endpoint.

Phase 1 validation was then executed: the backend was started against `diasporum_dev_v10_12`, 27 new auth integration tests were written against real PostgreSQL (Testcontainers) plus a controlled provider-JWKS fixture, the full suite was repaired and made green (**129 tests, 0 failures, 0 errors**), and the HTTP contract was verified live. A formal endpoint specification was produced at `docs/auth-api-v1.yaml`.

## Database

- **New DB:** `diasporum_dev_v10_12` — 172 tables, smoke test passed (BEGIN, DO, ROLLBACK)
- **New migration:** `V1__baseline_v10_12.sql` — consolidated baseline replacing V1–V4
- **Old DB:** `diasporum_dev` — preserved for reference, not connected
- **Old migrations:** Archived to `src/main/resources/db/migration-archive/` (moved out of `db/migration/` — Flyway scans classpath locations recursively, and `archive/V1__baseline.sql` collided with the new baseline as a duplicate version 1)
- **Flyway startup:** `spring.flyway.baseline-on-migrate: true` added to `application-local.yml` — required because the DB was pre-provisioned via `psql` and had no `flyway_schema_history`. Backend then baselined at version 1 and Hibernate `ddl-auto: validate` passed.

## Keycloak Removed

| Item | Status |
|---|---|
| `spring-boot-starter-security-oauth2-resource-server` | Removed |
| `spring-boot-starter-security-oauth2-resource-server-test` | Removed |
| `KEYCLOAK_ISSUER_URI` / `KEYCLOAK_AUDIENCE` env | Removed from `application.yaml` |
| Keycloak Docker service | Commented out in `compose.yaml` |
| `@AuthenticationPrincipal Jwt` | Replaced with `DiasporumUserPrincipal` in all controllers |
| `IdentityProvisioningService` | Deleted (dead code) |

## Validation Results — Actually Executed

### Test suite

| Command | Result |
|---|---|
| `./mvnw compile` / `test-compile` | 0 errors |
| `./mvnw test` (full suite) | **129 tests, 0 failures, 0 errors — BUILD SUCCESS** |

New tests written and executed for this validation (27):

- `AuthFlowIntegrationTest` (16 tests) — real PostgreSQL via Testcontainers, recording `EmailService` fixture: register → verify → login → refresh rotation → logout/logout-all revocation → forgot/reset/change password → auth-only user without profile → suspended account blocked.
- `ExternalIdentityIntegrationTest` (11 tests) — controlled JWKS fixture: a local HTTP server serving test RSA keys, configured via the provider JWKS URL override added to `ExternalIdentityService`. Covers valid Google + Apple tokens, wrong signature/issuer/audience, expired token, unverified provider email, `email_verified` as boolean and string, same-verified-email account linking, different-email account creation, existing-identity repeat login, suspended linked account, and Apple private-relay email.
- `JwtClaimValidationTest` — RS256 `JwtService` unit tests (issuance, signature, wrong issuer/audience, foreign key, `kid`).
- `MeControllerSecurityTest` — authenticated principal vs. revoked session vs. unauthenticated.

### Live HTTP verification (backend on :8080, `diasporum_dev_v10_12`)

| Check | Result |
|---|---|
| `/actuator/health` | UP |
| Flyway + `ddl-auto: validate` | Baselined v1, schema valid |
| `POST /auth/register` | 201; duplicate → 409 `EMAIL_TAKEN` |
| `POST /auth/verify-email` (token from local email log) | 204 |
| `POST /auth/login` | 200 — access + refresh tokens issued |
| Bad login | 401 `INVALID_CREDENTIALS` |
| `GET /.well-known/jwks.json` | 200 — `keys[0]` is a JWK object (`kty: RSA`) |
| `GET /auth/me` + `GET /auth/sessions` (Bearer) | 200 |
| Unauthenticated `/auth/me`, `/auth/sessions` | 401 `UNAUTHENTICATED` |
| `POST /auth/refresh` | 200 — rotation issues new pair |
| Refresh replay (consumed token re-presented) | 401 + token family revoked |
| Chained rotation (new refresh token works) | 200 |
| `POST /auth/logout-all` then old access token | 401 — session revocation verified |

## Defects Found and Fixed During Validation

| # | Defect | Fix |
|---|---|---|
| 1 | `POST /auth/refresh` always 500 — `replaced_by_token_id` was set before the successor row existed (self-FK) | `TokenService.rotate` inserts the successor first, then links the consumed token |
| 2 | Refresh then 409 — `ux_user_refresh_tokens_one_active_per_family` allows one active token per family | Rotation order corrected: consume old → insert successor → link |
| 3 | JWKS `keys` double-nested `[[{...}]]` | Return flat JWK list |
| 4 | `/api/v1/auth/**` global `permitAll` let protected endpoints run with null principals → 500 | Explicit public-endpoint allowlist; everything else authenticated |
| 5 | `IllegalArgumentException` from auth failures → 500 | `AuthExceptionHandler` maps expected domain errors: invalid credentials 401, email taken 409, invalid token 401, suspended 403 |
| 6 | `me()` always returned `emailVerifiedAt: null` | Response mapping now loads it |
| 7 | External login on already-linked identity did not check `account_status` — suspended users could regain access | Status enforced on all external-login paths |
| 8 | External login matching a `PENDING_VERIFICATION` email → `INSERT users` → unique-email constraint 500 | Pending accounts now link the identity instead of inserting |
| 9 | Password reset on OAuth-only (credential-less) account → UPDATE 0 rows, silent success | Reset now inserts a credential when none exists |
| 10 | `verifyEmail` could flip `SUSPENDED`/`DELETED` back to `ACTIVE` | Status transition restricted to `PENDING_VERIFICATION` |
| 11 | Concurrent refresh check-then-act race → multiple descendants possible | Rotation made atomic within the transaction |
| 12 | `ExternalIdentityService.verify()` called `getStringClaim`/`getBooleanClaim` — a real boolean `email_verified` (Google/Apple) crashed → `INVALID_EXTERNAL_TOKEN` instead of `EMAIL_NOT_VERIFIED` | Type-agnostic claim handling accepts JSON boolean and string forms |
| 13 | `SocialService`/`SocialApi` referenced `friendships` and `personal_mutes` — neither exists in v10.12 (replaced by the `user_mutual_connections` view; `user_mutes` is moderator-scoped only) | Friends now derived from reciprocal `user_follows`; personal-mute surface removed; matchmaking establish/dissolve = reciprocal follow edges |
| 14 | `SocialService.blockedWith` operator-precedence bug (`A OR B AND C`) returned all of the viewer's blocks regardless of candidates | Parenthesized correctly |
| 15 | `INSERT ... catch(DuplicateKeyException)` poisoned the PostgreSQL transaction (25P02) on idempotent follow/block insert | `ON CONFLICT DO NOTHING` |

## v10.12 Semantic Changes Applied to Existing Modules

- **Social:** `friendships` removed → friends = `user_mutual_connections` (derived view over reciprocal follows). `addFriend` = follow (connection forms when reciprocal); `removeFriend` = unfollow; `friendCount`/`friendIds`/`isFriend` query mutual state. `establishMatchmakingFriendship` inserts both follow edges (idempotent, race-safe via the follow-policy trigger); `dissolveMatchmakingFriendship` removes both edges.
- **Personal mutes:** no v10.12 table exists (`user_mutes` is moderator-scoped, `reason` NOT NULL, global inserts require `app.platform_moderator`). The personal-mute feature surface was removed from `SocialService`, `SocialApi`, `SocialApiImpl`, `SocialController` (`/mutes` endpoints), `RelationshipView.mutedByMe`, and the `FeedService` mute filter. If the product still wants viewer-side mutes, a schema addition is required — do not model it through `user_mutes`.
- **Module boundaries:** `JwtService`, `PemKeyLoader`, `DiasporumUserPrincipal` moved to public `com.diasporum.backend.security`; new `SessionValidator` interface (implemented by `SessionService`) breaks the identity↔security cycle. `ModuleBoundaryTest` 26/26 green.

## Test-Infrastructure Repairs

- `IdentityTestSupport.provision` — SQL fixture creating `users` + `profiles` + `external_identities`; reuses a surviving `users` row (unique-email index) and resets profile/identity state.
- Spring Security 7 change: the 2-arg `UsernamePasswordAuthenticationToken` constructor sets `authenticated=false` → all migrated tests now use the 3-arg form with authorities.
- Test cleanups extended for v10.12 (`user_follows`, `user_blocks`, `user_privacy_settings`) since provisioned user UUIDs are reused across test methods.
- `ProfileManagementIntegrationTest` assertions updated: v10.12 `display_name`/country columns are NOT NULL, so provisional all-null profiles no longer exist.

## Verified API Contract

Full request/response contract: **`docs/auth-api-v1.yaml`** (OpenAPI 3.0). Summary:

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/v1/auth/register` | POST | Public | Email + password (≥15 chars) → 201; duplicate → 409 |
| `/api/v1/auth/login` | POST | Public | → 200 token pair + session; bad credentials → 401; suspended → 403 |
| `/api/v1/auth/google` `/api/v1/auth/apple` | POST | Public | `{idToken}` → provider JWKS verify → link-or-create → token pair |
| `/api/v1/auth/refresh` | POST | Public | Single-use rotation → new pair; replay → 401 + family revoked |
| `/api/v1/auth/verify-email` | POST | Public | Consume token → 204; invalid → 400 |
| `/api/v1/auth/resend-verification` | POST | Public | Always 204 (no existence leak) |
| `/api/v1/auth/forgot-password` | POST | Public | Always 204 (no existence leak) |
| `/api/v1/auth/reset-password` | POST | Public | Consume token → 204; revokes all sessions |
| `/api/v1/auth/me` | GET | Bearer | Account row (no profile required) → 200 |
| `/api/v1/auth/sessions` | GET | Bearer | Active session list |
| `/api/v1/auth/sessions/{id}` | DELETE | Bearer | Revoke own session → 204 |
| `/api/v1/auth/logout` `/api/v1/auth/logout-all` | POST | Bearer | Session/all-session revocation → 204 |
| `/api/v1/auth/change-password` | POST | Bearer | 204; revokes all sessions; wrong current → 401 |
| `/api/v1/auth/link/google` `/api/v1/auth/link/apple` | POST | Bearer | Link provider identity → 204; already-linked-elsewhere → 409 |
| `/api/v1/auth/link/{id}` | DELETE | Bearer | Unlink → 204; last-sign-in-method guard → 409 |
| `/.well-known/jwks.json` | GET | Public | `{keys: [JWK]}` |

Error envelope: `{status, code, message, path, timestamp, fieldErrors}`.

## Security Model (verified)

- **JWT:** RS256, `kid` header, `sub` = `users.id`, `sid` = `user_sessions.id`, 15-min TTL. Issuer/audience/expiry/signature validated; revoked sessions rejected even with a valid signature.
- **Refresh:** opaque 32-byte random, SHA-256 digest at rest, single-use rotation, replay → family revocation, concurrent refresh converges.
- **Sessions:** device-scoped, 30-day refresh TTL, 90-day absolute expiry. DB trigger `trg_revoke_sessions_on_account_restriction` revokes sessions + tokens on suspension/deletion.
- **Passwords:** Argon2id, ≥15 chars.
- **Account status:** enforced on password login, external login, and session validation; email verification cannot reactivate a suspended/deleted account.
- **Auth-only users** (no profile) can use all auth endpoints; `/api/v1/me` returns 404 → onboarding (correct per v10.12).

## Not Verified / Outstanding

- **Real Google/Apple credentials** — provider verification tested only via the controlled JWKS fixture; a real-token smoke test is still needed before release.
- **Email delivery** — `LocalEmailService` logs links only; no SMTP provider configured.
- **Ephemeral JWT keys** — local dev generates an ephemeral RSA keypair per boot (all sessions invalidate on restart). `DIASPORUM_JWT_PRIVATE_KEY`/`DIASPORUM_JWT_PUBLIC_KEY` must be configured for any shared environment.
- **CORS** — `allowedOrigins: *` (credentials disabled). Acceptable for the mobile API but should be tightened for any browser-facing surface.
- **Refresh token plaintext** is returned only in the login/refresh response body; transport security (TLS) is assumed and not enforced by the app in local dev.
- `user_sessions.authentication_method` retains `'KEYCLOAK'` in its check constraint for historical reference only — never set.

---

*Phase 1 validation is complete. The suite result (129/0/0) and live checks above reflect actually-executed runs on 2026-10-31.*
