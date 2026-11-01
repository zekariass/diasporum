# Diasporum — Local Keycloak Setup

Local OIDC identity provider for backend development. Runs in **development mode (`start-dev`) — never use these settings in production.**

| Component | Value |
|---|---|
| Image | `quay.io/keycloak/keycloak:26.2.4` (pinned, locally verified) |
| Container | `diasporum-keycloak` (restart `unless-stopped`) |
| Admin console | http://localhost:8081 (publishes `127.0.0.1:8081` → container `8080`) |
| Realm | `diasporum` |
| OIDC issuer | `http://localhost:8081/realms/diasporum` |
| Discovery | `http://localhost:8081/realms/diasporum/.well-known/openid-configuration` |
| Health | management port 9000, `/health/ready` (healthcheck) |

## Environment files

| File | Git? | Contents |
|---|---|---|
| `keycloak/.env` | ignored | `KC_BOOTSTRAP_ADMIN_USERNAME`, `KC_BOOTSTRAP_ADMIN_PASSWORD`, `KC_DB`, `KC_DB_URL`, `KC_DB_USERNAME`, `KC_DB_PASSWORD`, `KC_HOSTNAME`, `KC_HEALTH_ENABLED`, `KC_METRICS_ENABLED` |
| `keycloak/.env.example` | committed | same names, `change-me-locally` placeholders |

Injected via the service's `env_file:` — **only** these variables reach the container. The Diasporum DB password never enters this file. Setup on a new machine: `copy keycloak\.env.example keycloak\.env` and set local passwords.

## Database isolation

Keycloak uses the **`keycloak` database** (88 tables auto-created) on the shared `diasporum-postgres` container, reached internally at `postgres:5432` — **never** `diasporum_dev`. Dedicated user `keycloak` owns that DB and has no grants on `diasporum_dev`. Created once via:

```sql
CREATE USER keycloak WITH PASSWORD '<KC_DB_PASSWORD>';   -- from keycloak/.env
CREATE DATABASE keycloak OWNER keycloak;
-- run on the "postgres" maintenance DB:
-- docker exec diasporum-postgres psql -U diasporum -d postgres -c "..." -c "..."
```

Re-running this is unnecessary — it persists in the `diasporum-postgres-data` volume.

## Commands (PowerShell, workspace root)

```powershell
docker compose --env-file .\diasporum-backend\.env up -d        # postgres + keycloak
docker compose --env-file .\diasporum-backend\.env up -d keycloak   # keycloak only
docker compose --env-file .\diasporum-backend\.env logs -f keycloak
docker compose --env-file .\diasporum-backend\.env stop             # data preserved
docker inspect -f "{{.State.Health.Status}}" diasporum-keycloak     # healthy?
```

`depends_on: service_healthy` starts Keycloak only after Postgres is ready. Keycloak takes ~30–60s (schema init on first boot, `start_period: 60s`).

## Realm bootstrap (repeatable)

The `diasporum` realm was created via `kcadm` — no unreviewed realm import:

```powershell
# Git Bash note: export MSYS_NO_PATHCONV=1 to keep container paths intact
$env:MSYS_NO_PATHCONV=1   # PowerShell equivalent prefixing
docker exec diasporum-keycloak /opt/keycloak/bin/kcadm.sh config credentials `
  --server http://localhost:8080 --realm master --user admin --password <KC_BOOTSTRAP_ADMIN_PASSWORD>
docker exec diasporum-keycloak /opt/keycloak/bin/kcadm.sh create realms -s realm=diasporum -s enabled=true
```

## Reset / recreate

- **Reset the realm only:** `kcadm.sh delete realms/diasporum`, then re-run the create command. Keycloak data lives in the `keycloak` DB inside `diasporum-postgres-data` — deleting it does **not** touch `diasporum_dev` tables.
- **Full Keycloak reset:** `docker compose --env-file .\diasporum-backend\.env rm -sf keycloak`, then drop/recreate the `keycloak` database (`DROP DATABASE keycloak; CREATE DATABASE keycloak OWNER keycloak;`) and `up -d` again. `diasporum_dev` data is unaffected. **Never** `down -v` — that deletes the shared `diasporum-postgres-data` volume including `diasporum_dev`.

## Realm clients (configured 2026-10-29)

| Client | Type | Flow | Redirect URIs | Notes |
|---|---|---|---|---|
| `diasporum-mobile` | **public** — no secret | Auth Code + **PKCE S256** (enforced via `pkce.code.challenge.method` attribute) | `diasporumobile://*` | implicit/direct-grants/service-account all off |
| `diasporum-web` | **confidential** — secret server-side only | Auth Code | `http://localhost:3000/api/auth/callback/*`, `http://localhost:3000/` | webOrigins `http://localhost:3000`; postLogout `http://localhost:3000/` |

**Audience:** client scope `diasporum-api` (default on both clients) carries an `oidc-audience-mapper` with `included.custom.audience=diasporum-api` — access tokens contain `aud: ["diasporum-api","account"]`. Verified via token introspection/decode.

**Web secret:** stored in `diasporum-web/.env.local` (`KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`) — gitignored, server-side only.

**Reproducible export:** `keycloak/realm-diasporum.json` — reviewed export, all secrets (client secret + realm signing keys) masked. Re-import explicitly if ever needed — never silently over an existing realm.

**Dev test user:** `diasporum-test` — enabled, password in `keycloak/.env.test` (gitignored). Login verified via Auth Code + PKCE S256 on `diasporum-web`. Recreate: `kcadm.sh create users -r diasporum -s username=diasporum-test -s enabled=true -s emailVerified=true -s email=diasporum-test@dev.local -s firstName=Dev -s lastName=User 'requiredActions=[]'` then `kcadm.sh set-password -r diasporum --username diasporum-test --new-password <pw> --temporary=false` (email/names must be set or `VERIFY_PROFILE` blocks first login).

**Backend wiring:** `application.yaml` reads `KEYCLOAK_ISSUER_URI`/`KEYCLOAK_AUDIENCE` → `spring.security.oauth2.resourceserver.jwt.{issuer-uri,audiences}`. All endpoints require a `diasporum-api`-audience bearer token except `/actuator/health` and `/error`. `GET /api/v1/me` returns `{issuer, subject}`.

Pending: exact production/Expo-Go redirect URIs, mobile auth wiring, profile persistence.

## Backend wiring (later milestone — not yet implemented)

`application-local.yml` reads `KEYCLOAK_ISSUER_URI` / `KEYCLOAK_AUDIENCE` from `diasporum-backend/.env`:
```
KEYCLOAK_ISSUER_URI=http://localhost:8081/realms/diasporum
KEYCLOAK_AUDIENCE=diasporum-api
```
The `diasporum` realm still needs a **public client** for the mobile PKCE flow and a **confidential client** for the web admin BFF, plus audience configuration — created during the authentication milestone via documented `kcadm` steps or a reviewed realm import.

## Dev vs. production

`start-dev` enables HTTP, relaxed hostname checks and bootstrap admin vars. Production requires `start` (built image), HTTPS, a proper hostname policy, externally managed secrets, no `KC_BOOTSTRAP_ADMIN_*` in the environment, and a real realm export/review process — none of which is covered by this local setup.
