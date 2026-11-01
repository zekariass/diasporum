# Diasporum — Keycloak Realm & Client Configuration Report

**Date:** 2026-10-29
**Scope:** Realm/client configuration only. No Spring Security, JWT validation, or API endpoints implemented. No commits.

---

## Files changed

| File | Change |
|---|---|
| `keycloak/.env` | (existing) user-edited passwords re-synced to live values — see incident note |
| `keycloak/realm-diasporum.json` | **new** — reviewed realm export, secrets masked |
| `diasporum-web/.env.local` | appended `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET` (gitignored) |
| `diasporum-web/.env.example` | appended same vars with placeholders |
| `LOCAL_KEYCLOAK_SETUP.md` | added realm-clients section |
| `DIASPORUM_KEYCLOAK_REALM_REPORT.md` | this report |

**Incident resolved during session:** `keycloak/.env` had been edited after provisioning — `KC_DB_PASSWORD` and `KC_BOOTSTRAP_ADMIN_PASSWORD` no longer matched live state, causing `password authentication failed for user "keycloak"` and admin login failure. Fixed by `ALTER USER keycloak WITH PASSWORD` and `kcadm set-password` to match `.env`. Keycloak healthy afterward. Documented caveat: `KC_BOOTSTRAP_ADMIN_*` only applies on first boot — later `.env` edits need `kcadm` sync.

## Realm configuration (verified live, `kcadm get`)

| Object | Configuration |
|---|---|
| Realm `diasporum` | enabled; issuer `http://localhost:8081/realms/diasporum` |
| Client scope `diasporum-api` | `oidc-audience-mapper`, `included.custom.audience=diasporum-api`, access-token claim only; **default scope on both clients** |
| `diasporum-mobile` | `publicClient=true`, standardFlow, `pkce.code.challenge.method=S256`, implicit=false, directAccessGrants=false, serviceAccounts=false; redirect `diasporumobile://*` |
| `diasporum-web` | `publicClient=false` (confidential), standardFlow, serviceAccounts=false; redirects `http://localhost:3000/api/auth/callback/*` + `http://localhost:3000/`; webOrigins `http://localhost:3000`; postLogout `http://localhost:3000/` |

## Verification — commands run and actual results

| Check | Method | Result |
|---|---|---|
| Realm exists | `kcadm get realms/diasporum` | `realm: diasporum, enabled: true` |
| Both clients exist | `kcadm get clients -r diasporum` | `diasporum-mobile`, `diasporum-web` (+ built-ins) |
| Mobile public + PKCE S256 | full client representation | `publicClient=true`, attribute `pkce.code.challenge.method=S256` |
| Web confidential | client representation | `publicClient=false`, secret generated |
| API audience in token | temp client_credentials client → POST `/token` → decode JWT | **`aud: ["diasporum-api","account"]`, `iss: http://localhost:8081/realms/diasporum`** — temp client deleted after check |
| Invalid redirect rejected | `GET /auth?client_id=diasporum-mobile&redirect_uri=https://evil.example.com/cb` | **HTTP 400 — "Invalid parameter: redirect_uri"** |
| Secrets in tracked files | scrubbed export scan | `realm-diasporum.json`: zero unmasked `secret`/`privateKey`/`password`; web secret only in gitignored `.env.local` |
| Healthcheck + postgres | `docker inspect` health / `docker ps` | both `healthy`; `diasporum_dev` untouched |

**Not verified (honest scope):** no end-to-end browser/mobile login was performed — no test users exist yet and no client app integrates auth. Audience was proven at the token level via the client-credentials flow.

## Remaining limitations / next steps

1. Dev test user(s) needed for real Auth-Code login testing — create in auth milestone.
2. Production/Expo-Go redirect URIs unknown — documented as pending (dev uses `diasporumobile://` scheme; Expo-Go `exp://` callbacks TBD).
3. `localhost:8081` is dev-only — devices/emulators/deployed envs need reachable issuer + `KC_HOSTNAME` updates.
4. Next: backend resource-server config validating `iss` + `aud: diasporum-api`, `(issuer,subject)` → `external_identities` mapping — awaiting approval.
5. Mobile client currently uses scheme-wildcard `diasporumobile://*` — tighten to exact callback path when the auth route is defined.
