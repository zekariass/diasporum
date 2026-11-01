# Diasporum — Local Database Setup

Local development database: PostgreSQL 17 + PostGIS 3.5, managed by Docker Compose from the workspace root. Validated on `postgis/postgis:17-3.5` (PostgreSQL 17.5, PostGIS 3.5.2).

## Requirements

| Tool | Verified version |
|---|---|
| Docker Desktop / Docker Engine | 28.0.4 (engine must be running) |
| `docker compose` plugin | bundled with Docker Desktop |
| Java | 21 (`java -version`) — backend only |
| psql client (optional) | 17.3 — for ad-hoc inspection only; not required |

## Environment files (per-project — no shared root `.env`)

| File | Git? | Consumed by | Variables |
|---|---|---|---|
| `diasporum-backend/.env` | ignored | `docker compose --env-file` interpolation **and** Spring Boot local profile | `DIASPORUM_DB_NAME`, `DIASPORUM_DB_USERNAME`, `DIASPORUM_DB_PASSWORD`, `DIASPORUM_DB_PORT`, `DIASPORUM_DB_URL`, `KEYCLOAK_ISSUER_URI`, `KEYCLOAK_AUDIENCE` |
| `diasporum-backend/.env.example` | committed | template for the above | same names, placeholder values |
| `diasporum-mobile/.env` | ignored | Expo bundle — **client-safe only** (`EXPO_PUBLIC_*` is extractable) | `EXPO_PUBLIC_API_BASE_URL` |
| `diasporum-mobile/.env.example` | committed | template | same |
| `diasporum-web/.env.local` | ignored | Next.js — `API_BASE_URL` server-side, `NEXT_PUBLIC_*` public | `API_BASE_URL`, `NEXT_PUBLIC_API_BASE_URL` |
| `diasporum-web/.env.example` | committed | template | same |

**Credential rules:** the DB password exists only in `diasporum-backend/.env`. The web and mobile apps never receive database credentials. `DIASPORUM_DB_URL` contains no password. To set up on a new machine: `copy diasporum-backend\.env.example diasporum-backend\.env` and choose a local password — it only needs to be consistent within that file.

### How compose.yaml reads backend env

`docker compose --env-file .\diasporum-backend\.env ...` makes those variables available for `${VAR}` **interpolation** in `compose.yaml`. The service maps only the three Postgres variables into the container (`POSTGRES_DB/USER/PASSWORD`); other backend vars (Keycloak etc.) never reach the container. The service does **not** use `env_file:` — that mechanism injects whole files into containers and would leak unrelated variables.

## Commands (PowerShell, from workspace root)

```powershell
docker compose --env-file .\diasporum-backend\.env up -d     # create + start
docker compose --env-file .\diasporum-backend\.env ps        # status (expect "healthy")
docker compose --env-file .\diasporum-backend\.env logs -f postgres
docker compose --env-file .\diasporum-backend\.env stop      # data preserved
docker compose --env-file .\diasporum-backend\.env start     # data preserved
```

**DANGER:** `docker compose down -v` deletes the named volume `diasporum-postgres-data` — all local data is destroyed. Never use `-v` for routine shutdown. Plain `down` removes the container/network but keeps the volume.

### Readiness check

```powershell
docker inspect -f "{{.State.Health.Status}}" diasporum-postgres   # expect: healthy
docker exec diasporum-postgres pg_isready -U diasporum -d diasporum_dev
```

## Connecting the backend

| Backend runs | JDBC URL |
|---|---|
| Directly on Windows (mvnw/IDE) | `jdbc:postgresql://localhost:5433/diasporum_dev` (`DIASPORUM_DB_URL` in `.env`) |
| Inside the Compose network | `jdbc:postgresql://postgres:5432/diasporum_dev` — service name, container port; **not** `localhost` |

Spring Boot (local profile) resolves `DIASPORUM_DB_URL/USERNAME/PASSWORD` from `application-local.yml`. Spring Boot does not auto-load `.env` files — export the vars (`Get-Content .env | % { ... }`, IDE env-file support, or `direnv`) or run through a profile that supplies them.

> **Note:** host port is `5433`, not 5432 — a native Windows PostgreSQL service already owns 5432 on this machine. Change `DIASPORUM_DB_PORT` (and `DIASPORUM_DB_URL`) in `.env` to relocate.

## Persistent data

Named volume `diasporum-postgres-data` → `/var/lib/postgresql/data`. Survives `stop`/`start`/`down`/container recreation. First boot auto-creates database `diasporum_dev` and enables PostGIS. The approved clean-install SQL is **not** auto-executed — schema lands via Flyway once the baseline migration is approved.

## Disposable validation environment (different thing — do not confuse)

Schema validation used a separate throwaway container — no volume, port `55432`, name `diasporum-pg-validate` — created per-run and removed with `docker rm -f`. It is gone after validation. The persistent Compose database was never touched by the validation scripts. See `DIASPORUM_DATABASE_VALIDATION_REPORT.md` for exact commands and results.

## Flyway baseline (added 2026-10-30)

`diasporum-backend/src/main/resources/db/migration/V1__baseline.sql` = the corrected v10.11 canonical schema (validated: clean install + smoke assertions + two fresh-DB Flyway runs). On first `spring-boot:run -Dspring-boot.run.profiles=local`, Flyway applies V1 to the empty `diasporum_dev`. Adopting a *pre-populated* DB instead: `flyway baseline -baselineVersion=1` (marks V1 applied without re-execution) — not needed locally.
