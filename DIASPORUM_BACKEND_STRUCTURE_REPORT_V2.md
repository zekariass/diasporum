# Diasporum — Backend Folder Structure Report (full scaffold)

**Date:** 2026-10-30 — spec: `Diasporum_Spring_Boot_REST_API_Folder_Structure_v10_11.md` (read in full). Structural scaffolding only; no business features, no DB/Flyway/env/Keycloak changes, no commits.

## Structure created

- **25 top-level modules** under `com.diasporum.backend`, exactly per spec: identity, social, community, taxonomy, media, feed, communitychat, messaging, voice, businessaccounts, businessdirectory, events, jobs, propertylistings, vehiclelistings, sparebag, matchmaking, servicemarketplace, billing, notifications, moderation, administration, appconfiguration, security, platform. **No separate `profiles` module** (owned by identity per spec); no generic `modules/`/`integration/` roots.
- **Standard internal layout** per module — `internal/api/rest`, `internal/application`, `internal/domain`, `internal/infrastructure/persistence` — with spec-justified additions:
  - `messaging` + `internal/infrastructure/realtime`
  - `voice` + `realtime` + `rtc`
  - `media`, `feed`, `matchmaking`, `servicemarketplace`, `billing`, `notifications` + `internal/infrastructure/integration`
  - `administration`: **no persistence** (orchestrates public APIs, owns no data)
- **`platform/geospatial`** per spec §8 (primitives only).
- **135 `package-info.java`** (main) + 6 (test: messaging, matchmaking, servicemarketplace, voice, integration, architecture) — each states ownership (spec §3 table), layer responsibility, and the `internal.*` encapsulation/boundary rule.
- **Module-root public APIs:** `MessagingApi`, `ServiceMarketplaceApi` (the two root interfaces the spec shows). Other modules get their API interfaces when real use cases land — creating 25 empty interfaces would be meaningless.

## Existing files moved/modified

| Change | Reason |
|---|---|
| `identity/internal/service/{IdentityProvisioningService,ProfileService,ResolvedProfile}` → `identity/internal/application/` | Spec's use-case layer is `internal/application`; `internal/service` was a pre-spec deviation. Behaviour/tests preserved — package declaration + 8 import refs updated. |
| `identity`, `security`, `platform` root `package-info` | rewritten to spec ownership text + boundary rule |

No deletions. JWT auth, provisioning, `/me`, profile endpoints, Flyway config untouched.

## Latest-decision reconciliation (in module docs, no schema changes)

- matchmaking package-info documents: mutual like → match **AND** `friendships` record via social public API + accepted `GENERAL` conversation via messaging API; unmatch removes only the match-created friendship, preserves messaging.
- feed package-info documents `COMMUNITY_HELP` context + `community_help_posts` subdomain inside `feed`.
- social package-info documents follow-only model (mutual follows derive connections; no friend_requests assumptions).

## Validation — actual results

- `./mvnw test` → **BUILD SUCCESS, 30/30 pass** (all pre-existing suites incl. provisioning/profile ITs green after relocation).
- Tree: 215 source dirs; root level = 25 modules + `DiasporumBackendApplication`.
- Flyway migrations, `application*.yml`, compose, `.env*`, Keycloak: untouched (verified — no file changes there).

## Spec parts not directly implementable in Java

- `docs/`, `Dockerfile`, `.github/workflows/ci.yml`, `src/test/resources/fixtures/` — repo-scaffolding paths; the workspace has its own top-level docs/CI layout already. Left for review rather than duplicating.
- Spring Modulith/ArchUnit dependency for boundary enforcement — spec §6.8; adding a dependency needs your approval (deferred since Phase 1; recommend `spring-modulith` in the next milestone).
- Public module *events* (e.g. `ConversationCreated`) — deferred until producing code exists.
- REST conventions like HATEOAS — noted, not applied yet (no dependency added).

---

## Architecture boundary tests (added 2026-10-30)

**Framework: ArchUnit** (`com.tngtech.archunit:archunit-junit5:1.4.1`, test scope — pinned, 1.4.x supports Java 21). Chosen over Spring Modulith: pure class-file analysis — deterministic, zero Spring-context cost, framework-agnostic, no Boot-4 version coupling. Modulith's runtime module/event verification is still a candidate when module events exist; not needed to enforce `internal/*` encapsulation.

**`architecture/ModuleBoundaryTest`** (26 tests, `DO_NOT_INCLUDE_TESTS` import scope):
- `moduleInternalsAreEncapsulated` — parameterized ×25 modules: `noClasses outside module M may dependOnClassesThat reside in M.internal..`
- `noCyclicModuleDependencies` — `slices().matching("com.diasporum.backend.(*)..").beFreeOfCycles()`
- Public-API bypass is implied: only module-root types survive the encapsulation rule; persistence cross-access is covered since persistence lives under `internal/`.

**Violations found:** none — all same-module imports verified. **Negative test:** a planted `feed→identity.internal` probe was correctly caught (1 violation), then removed.

**Results:** `ModuleBoundaryTest` 26/26 PASS; full suite **56/56 BUILD SUCCESS**.
