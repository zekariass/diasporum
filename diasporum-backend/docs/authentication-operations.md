# Diasporum Authentication — Operations Guide

Phase 1.2 production-readiness configuration for the first-party
authentication stack. Audience: developers and deployers of the backend.

---

## 1. Environment Variables

### Required in every environment

| Variable | Purpose | Notes |
|---|---|---|
| `DIASPORUM_DB_URL` | JDBC URL | e.g. `jdbc:postgresql://host:5432/diasporum` |
| `DIASPORUM_DB_USERNAME` / `DIASPORUM_DB_PASSWORD` | DB credentials | |
| `DIASPORUM_JWT_ISSUER` | `iss` claim on access tokens | Public API base, e.g. `https://api.diasporum.com` |
| `DIASPORUM_JWT_AUDIENCE` | `aud` claim | e.g. `diasporum-api` |
| `DIASPORUM_JWT_PRIVATE_KEY` | RSA private key (PKCS#8 PEM) | **Secret — never commit.** Multiline value; store in the secrets manager |
| `DIASPORUM_JWT_PUBLIC_KEY` | RSA public key (X.509 PEM) | Published via JWKS — not secret |
| `DIASPORUM_JWT_KID` | `kid` key id | Bump on rotation |
| `DIASPORUM_MAIL_PROVIDER` | `local` or `smtp` | Empty/missing → **startup fails** |
| `DIASPORUM_MAIL_FROM` | Sender address | |
| `DIASPORUM_APP_BASE_URL` | Public app base URL | Builds `/verify-email?token=` and `/reset-password?token=` links |
| `DIASPORUM_CORS_ALLOWED_ORIGINS` | Comma-separated browser origins | Empty → no cross-origin browser access |

### SMTP (required when `DIASPORUM_MAIL_PROVIDER=smtp`)

| Variable | Purpose |
|---|---|
| `DIASPORUM_SMTP_HOST` | SMTP relay host — missing → startup fails |
| `DIASPORUM_SMTP_PORT` | Default `587` |
| `DIASPORUM_SMTP_USERNAME` / `DIASPORUM_SMTP_PASSWORD` | Credentials |
| `DIASPORUM_SMTP_AUTH` | Default `true` |
| `DIASPORUM_SMTP_STARTTLS` / `DIASPORUM_SMTP_STARTTLS_REQUIRED` | Default `true`/`true` |
| `DIASPORUM_SMTP_SSL` | `true` only for implicit-SSL (port 465) |

### External identity providers

| Variable | Purpose |
|---|---|
| `DIASPORUM_GOOGLE_CLIENT_IDS` | Comma-separated OAuth 2.0 client IDs (Android, iOS, web) |
| `DIASPORUM_APPLE_CLIENT_ID` | Apple Services ID / client identifier (token `aud`) |

### Optional tuning

| Variable | Default |
|---|---|
| `DIASPORUM_ACCESS_TOKEN_TTL` | `PT15M` |
| `DIASPORUM_REFRESH_TOKEN_TTL` | `P30D` |
| `DIASPORUM_SESSION_TTL` | `P90D` (absolute) |
| `DIASPORUM_JWT_ALLOW_EPHEMERAL_KEYS` | `false` — local profile overrides to `true` |

---

## 2. Local Development

Profile `local` is the default (`spring.profiles.default: local`).

- **JWT:** no keys needed — `application-local.yml` sets
  `allow-ephemeral-keys=true` and the backend generates a per-boot RSA-2048
  pair. All sessions die on restart. To test stable keys locally, set
  `DIASPORUM_JWT_PRIVATE_KEY`/`DIASPORUM_JWT_PUBLIC_KEY` in `.env`.
- **Email:** `DIASPORUM_MAIL_PROVIDER=local` → `LocalEmailService` logs links.
- **CORS:** `localhost:3000`, `localhost:8081` (Expo), `localhost:19006`.
- Copy `.env.example` → `.env`, fill in DB password only.

## 3. Staging / Production

Set `SPRING_PROFILES_ACTIVE=staging` (or `prod`). The following fail fast at
startup if misconfigured — there is no silent degradation:

| Check | Failure mode |
|---|---|
| `DIASPORUM_JWT_PRIVATE_KEY`/`PUBLIC_KEY` missing | `IllegalStateException` — ephemeral not allowed |
| Only one key set | `IllegalStateException` — must be configured together |
| Private/public mismatch | `IllegalStateException` — probe signature fails |
| `DIASPORUM_MAIL_PROVIDER` missing/unknown | No `EmailService` bean → context fails |
| `provider=smtp` + no `DIASPORUM_SMTP_HOST` | `IllegalStateException` |

Multiple backend instances **must share the same key pair** — any instance
can then verify tokens issued by any other (JWKS also stays consistent).
Sessions are database-backed, so there is no per-instance state.

## 4. JWT Key Generation and Rotation

```bash
# Generate a 4096-bit RSA pair (PKCS#8 private + X.509 public PEM)
openssl genrsa -out jwt-private.pem 4096
openssl rsa -in jwt-private.pem -pubout -out jwt-public.pem
```

- Store `jwt-private.pem` in the secrets manager as
  `DIASPORUM_JWT_PRIVATE_KEY` (multiline PEM; most managers accept it raw or
  base64-encoded — the loader strips whitespace, so either form works).
- **Never** commit the private key. `jwt-public.pem` is safe to distribute —
  it is published at `/.well-known/jwks.json`.

**Rotation procedure** (zero-downtime, sessions survive — refresh tokens are
opaque DB rows, not JWTs):

1. Generate a new pair, bump `DIASPORUM_JWT_KID`.
2. Deploy with the new pair. Existing access tokens (≤15 min TTL) become
   invalid; clients refresh via `/api/v1/auth/refresh` and receive tokens
   signed with the new key.
3. To force immediate re-authentication everywhere, no extra step is needed
   beyond the key change — every old-signature token is rejected.

## 5. SMTP Email Delivery

`SmtpEmailService` activates only on `DIASPORUM_MAIL_PROVIDER=smtp`.

- Verification link: `{DIASPORUM_APP_BASE_URL}/verify-email?token=…`
- Reset link: `{DIASPORUM_APP_BASE_URL}/reset-password?token=…`
- Tokens appear **only** in the email body — never in logs (send failures log
  recipient + subject only).
- Delivery failure throws — the caller sees the API error; nothing is silently
  swallowed.
- STARTTLS required by default; set `DIASPORUM_SMTP_SSL=true` + port `465`
  only for implicit-SSL relays.

## 6. Google and Apple Configuration

Both providers are **verification only** — they never issue Diasporum tokens.

| Provider | Required config | Verified in token |
|---|---|---|
| Google | `DIASPORUM_GOOGLE_CLIENT_IDS` — all OAuth client IDs for the project (Android + iOS + web). Any one may be the token `aud` | `iss=https://accounts.google.com`, `aud` ∈ configured IDs, `exp`, RS256 signature via Google JWKS, `email_verified` (JSON boolean) |
| Apple | `DIASPORUM_APPLE_CLIENT_ID` — Services ID used when creating the Sign in with Apple credential | `iss=https://appleid.apple.com`, `aud` = configured ID, `exp`, signature via Apple JWKS, `email_verified` (string `"true"`) |

- Provider `sub` is stored in `external_identities.subject` — stable per
  provider+client project; linking keys on `(issuer, subject)`, not email.
- Apple private-relay emails (`*@privaterelay.appleid.com`) are accepted.
- **Nonce:** the client may send `nonce` in the Apple/Google authorization
  request; the backend does not currently bind/verify a nonce claim on the
  presented ID token (single-request login flow). If CSRF on the login call
  itself is a concern for a given client, add nonce binding to
  `POST /api/v1/auth/{google,apple}` later — schema supports storing
  provider credential material in `external_identity_credentials`.
- JWKS URLs are configurable (`diasporum.auth.google.jwks-url`,
  `diasporum.auth.apple.jwks-url`) and default to the real providers.

**Real-provider smoke test (manual, required before release):**

1. Set `DIASPORUM_GOOGLE_CLIENT_IDS` / `DIASPORUM_APPLE_CLIENT_ID` to real
   client IDs on a staging instance.
2. Sign in on a real client (Expo app or Google token playground /
   `appleid.apple.com` test) to obtain a provider ID token.
3. `POST /api/v1/auth/google` (or `/apple`) with `{ "idToken": "<token>" }` →
   expect `200` with a Diasporum token pair.
4. Negative checks: expired token → 401; token for a different client ID →
   401; tampered signature → 401.
5. The automated suite covers all of this against a controlled JWKS fixture
   (`ExternalIdentityIntegrationTest`) — real-provider execution is a manual
   deployment step and must be recorded when performed.

## 7. CORS

- `DIASPORUM_CORS_ALLOWED_ORIGINS` — comma-separated exact origins
  (`https://app.diasporum.com,https://admin.diasporum.com`).
- No wildcard is ever emitted; `Access-Control-Allow-Credentials` is `false`
  (auth is Bearer-header, not cookie), so wildcard+credentials is impossible.
- Native mobile (Expo/React Native) requests are unaffected — CORS is only
  enforced on browser-originated requests.
- Preflight for unlisted origins → `403`, no `Access-Control-Allow-Origin`.

## 8. Deployment Startup Checklist

A deployment is healthy when **all** are true:

- [ ] Flyway migrated to ≥ V2 (`flyway_schema_history` shows
      `drop keycloak authentication method`)
- [ ] `JwtService` logged `JWT signing key loaded from configuration` — **not**
      the ephemeral warning
- [ ] `EmailService` resolved: `provider=smtp` + `DIASPORUM_SMTP_HOST` set
      (send a test `forgot-password` request and confirm delivery)
- [ ] `/.well-known/jwks.json` returns the configured public key (`kid`
      matches `DIASPORUM_JWT_KID`)
- [ ] `DIASPORUM_CORS_ALLOWED_ORIGINS` lists the real web origins
- [ ] `DIASPORUM_GOOGLE_CLIENT_IDS` / `DIASPORUM_APPLE_CLIENT_ID` set if social
      sign-in is enabled for this deployment
