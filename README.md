# Diasporum

A community-based social platform for diaspora communities. Users are
auto-assigned to a community from their origin country and country of
residence. Features include a social feed, messaging, marketplaces
(properties, vehicles, jobs, services, shop), events with ticketing,
matchmaking, spare-bag travel logistics, advertising, and business tools.

## Applications

| Directory | Application | Stack |
|---|---|---|
| `diasporum-backend/` | REST API — modular monolith | Spring Boot 4.1, Java 21, Maven, PostgreSQL 17 + PostGIS |
| `diasporum-mobile/` | iOS/Android app | Expo ~58, React Native 0.88, Expo Router |
| `diasporum-web/` | Web frontend (early stage) | Next.js 16, React 19, Tailwind CSS 4 |
| `Diasporum_v10.14/` | Canonical schema + design docs | PostgreSQL DDL |
| `compose.yaml` | Local infrastructure | PostGIS only |

## Quick start

```bash
docker compose --env-file diasporum-backend/.env up -d   # PostGIS on :5433
cd diasporum-backend && ./mvnw spring-boot:run -Dspring-boot.run.profiles=local
cd diasporum-mobile && npx expo start
cd diasporum-web && npm run dev
```

`diasporum-backend/.env.example` is the committed template for secrets/config.

## Verify

```bash
cd diasporum-backend && ./mvnw verify        # tests + ArchUnit module boundaries
cd diasporum-mobile && npx expo lint && npx tsc --noEmit
cd diasporum-web && npx next lint
```

## For AI agents and contributors

See `AGENTS.md` (root) plus per-app `AGENTS.md` — architecture, database,
auth, API conventions, business rules, and hard constraints (no JPA entities,
no cross-module `internal.*` imports, Flyway migration rules).
