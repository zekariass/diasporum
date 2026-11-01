# Diasporum — Proposed Implementation Plan

**Date:** 2026-10-29
**Baseline:** v10.11 system design, schema and folder-structure docs; findings in `DIASPORUM_INITIAL_REPOSITORY_ASSESSMENT.md`.
**Status:** Proposal only — nothing here has been implemented. Aligned with the "inspect → verify → plan → implement on approval" principle and the phased roadmap in `Diasporum_Project_Context_Updated.md` §9 and the folder-structure doc §10.

---

## 0. Gates before any feature work

| # | Decision / prerequisite | Owner |
|---|---|---|
| G1 | Put `diasporum-backend` (and `Diasporum_v10.11`) under git; decide one-repo vs. three-repo layout | User approval |
| G2 | Confirm Java root package (`com.diasporum.backend` vs. doc placeholder) | User decision |
| G3 | Keep or remove `spring-boot-starter-data-redis` (not in approved baseline) | User decision |
| G4 | Agree Flyway baseline strategy: `V1__baseline.sql` from canonical schema vs. `flyway.baseline` on provisioned DB | User decision |
| G5 | Provision disposable PostgreSQL 15+/PostGIS (e.g., Docker `postgis/postgis:15-3.x` — engine currently stopped) and run strict clean install + smoke assertions | User approval |
| G6 | Provision a development Keycloak realm (URL, realm, client IDs) or agree a local container | User approval |
| G7 | Confirm LiveKit as the initial RTC provider behind the voice adapter; keep Cloudflare Realtime SFU evaluation open | Documented — confirm |
| G8 | Decide where shared contracts/config live (e.g., API error format doc) before clients integrate | Team |

---

## Phase 1 — Backend platform foundation
**Goal:** a backend that builds, configures from the environment, runs migrations against disposable Postgres, and has a passing test harness.

Backend tasks:
- Environment-based config: `application.yml` + `application-local.yml` + `application-test.yml`, `.env.example`, externalized secrets (DB URL/credentials, Keycloak issuer).
- Remove Initializr leftovers (`templates/`, `static/`); wire actuator health; structured logging + correlation IDs.
- Global REST error format + validation handling (`@ControllerAdvice`), pagination conventions (per folder doc §5).
- Flyway baseline per G4; `db/migration/README.md`.
- Test harness: Testcontainers Postgres+PostGIS for integration tests; fix `contextLoads` to run against test config.
- Spring Modulith (or ArchUnit) + `ModuleBoundaryTests` skeleton.
- Package skeletons for `platform`, `security`, `identity`, `taxonomy`, `community`, `social` only.

Mobile tasks (parallel, backend-independent):
- Fix the 3 template `tsc` errors; add `expo-env.d.ts`/CSS-module declarations; run `npx expo lint` once to scaffold ESLint deliberately.
- App identity: name/slug/bundleIdentifier/package, scheme `diasporum`, splash/icon placeholders.
- Typed API-client foundation (fetch wrapper + env-driven base URL via `expo-constants`/`app.json` extra), folder conventions (`src/api`, `src/lib`), theme tokens.

Web tasks:
- Replace template landing with the informational public site skeleton (branding shell, static pages).
- Env convention (`.env.local`, server-only vars; `NEXT_PUBLIC_` discipline).

Acceptance: `mvnw verify` green on Testcontainers; mobile `tsc --noEmit` + `expo lint` + `expo-doctor` green; web `lint`/`tsc`/`build` green.
Risks: Flyway baseline semantics; Boot 4 starter-name drift; Expo SDK 58 typing quirks.
Gate: **G1–G5** done.

## Phase 2 — Identity & access foundation
**Goal:** OIDC-authenticated API with internal profile mapping; clients can sign in against dev Keycloak.

Backend:
- Resource-server security config (issuer, audience, JWT validation), authority/role mapping.
- `(issuer, subject)` → `external_identities` → `profiles.id` bootstrap (no auto-linking), onboarding profile creation, privacy defaults.
- Protected-endpoint authorization scaffold; `/api/v1/me` profile read/update.

Mobile:
- OIDC Authorization Code + PKCE via `expo-auth-session` + `expo-secure-store`; sign-in screen, token refresh, auth-gated routing, deep-link scheme.

Web:
- Informational site content stays public; admin console shell behind a BFF/session login (no client-held secrets) — read-only `/me` equivalent first.

Acceptance: end-to-end sign-in on mobile against dev Keycloak; unauthorized requests rejected (401/403 as appropriate); profile bootstrap idempotent; security tests for issuer/audience/expiry.
Gate: **G6**. Depends on Phase 1.

## Phase 3 — Taxonomy, communities & memberships
**Goal:** countries, communities, membership, active-community context, community-scoped visibility.

Backend: `taxonomy` + `community` + `social` (follows/blocks base) per schema; country categories + `country_category_modules`; membership lifecycle; community switching.
Mobile: onboarding country/community selection, community switcher, membership state.
Web (admin): community/category management read-only views first.
Acceptance: visibility checks enforced server-side on list **and** detail/search paths; membership required for community content; tests for switching and revocation.
Depends on Phase 2.

## Phase 4 — Media & feed core
**Goal:** durable media pipeline + posts/comments/reactions/polls; Reels later in phase.

Backend: `media` module (R2 adapter, upload grants, scoped signed access, READY lifecycle); `feed` module (posts, categories, media attach, comments, reactions, polls lifecycle, featured-placement allow-list validation); Reels: `post_type='REEL'`, one creator-owned READY FEED_VIDEO, COMMUNITY/NEARBY/FOLLOWING modes; Nearby via PostGIS `ST_Distance` on current addresses — never serialize coordinates/distance.
Mobile: feed screens, composer, media upload flow, Reels player (Community/Nearby/Following).
Web: none (consumer scope stays mobile).
Acceptance: media access via scoped grants only; poll lifecycle rules (2+ options, immutable after first vote, close/withdraw semantics); Reels publication blocked until media READY; Nearby ordering verified with `EXPLAIN` + tests; no coordinate leakage in DTOs (contract tests).
Depends on Phase 3. Needs R2 credentials approval.

## Phase 5 — Messaging, social graph & notifications core
**Goal:** follows/blocks, message requests, contextual direct conversations, in-app notifications + Expo push.

Backend: `social` follow/block policy (`dm_permission` separate from follows; block removes both directions); `messaging` (context types incl. `COMMUNITY_HELP_POST`, pair/context uniqueness, participant authorization, sequence/cursors); `notifications` (durable notifications, preferences, device tokens, transactional outbox → Expo push with retries/receipts/invalid-token cleanup); `platform` outbox worker + Ably token issuance endpoint.
Mobile: conversation list/thread UI, message requests, push registration, Ably subscription for live updates.
Acceptance: context-contextual conversation reuse; blocked/privacy checks on every action; outbox publishes only post-commit; duplicate delivery idempotent; no Ably keys in clients.
Depends on Phase 4. Needs Ably + Expo push credentials approval.

## Phase 6 — Community Help & Offers (v10.11 headline feature)
**Goal:** structured help posts + lifecycle + contextual responses.

Backend: `feed` subdomain per doc §13 — `COMMUNITY_HELP` post type, `community_help_posts` lifecycle (`OPEN↔PAUSED`, →`RESOLVED`/`CLOSED`/`EXPIRED`, terminal immutability), `COMMUNITY_HELP` category-module validation, Quartz expiry job, respond → contextual conversation reuse.
Mobile: help browse (REQUEST/OFFER, categories), create/publish flow, status controls, respond-to-conversation.
Acceptance: all smoke-test scenarios 25–32 implemented as API tests; expiry job concurrency-safe; discovery shows only published+OPEN+unexpired.
Depends on Phase 5.

## Phase 7 — General Chat & voice rooms
**Goal:** persistent community chat + voice room/session lifecycle.

Backend: `communitychat` (one persistent GENERAL room per community, scoped MUTE/BAN restrictions); `voice` (persistent room vs disposable session, seats/speaker requests/host transfer, 30-min grace = recovery not expiry, ephemeral session comments purged on terminal close + `VOICE_ROOM_COMMENTS_CLEARED`); LiveKit adapter issuing short-lived credentials post-authorization; Ably for presence/control/comments only.
Mobile: chat room UI, voice join/listen/raise-hand; comments during session.
Acceptance: smoke scenarios for chat restrictions; serialized joins/seat capacity; session-end comment purge; heartbeat reconciliation under simulated disconnects; no audio over Ably.
Depends on Phase 5; needs LiveKit approval (G7).

## Phase 8 — Discovery, listings & marketplaces (incremental, order TBD per product priority)
Business accounts/directory → events/RSVPs → jobs → property/vehicle listings → Spare Bag → service marketplace (leads, radius_km, reviews) → matchmaking (adult eligibility, swipes, matches, rewind, unmatch preserving friendships).
Each: backend module + mobile flows; admin console gains corresponding moderation surfaces.
Acceptance: per-module rules from schema/design (e.g., service marketplace = lead-gen only, no booking/escrow; matchmaking ≠ friendships; Spare Bag country via origin airport; approximate discovery points only).
Depends on Phase 3–5 foundations; billing entitlements needed before gated features.

## Phase 9 — Billing, entitlements & quotas
Backend `billing`: plans, features, entitlements, usage records, `NULL`=unlimited semantics, per-recipient DM quota, lead-access charging, idempotent provider webhooks (Stripe web first; app-store billing + RevenueCat only after explicit selection — currently "under evaluation").
Acceptance: quota enforcement transactional; webhook idempotency; disabled placeholder features inert.
Gate: payment-provider decisions + credentials.

## Phase 10 — Admin console, moderation & operations
Web admin: role-protected console for reports/queues/restrictions/audit; backend `moderation`+`administration` enforcement (server-side, not route-hiding); retention, export, deletion workflows; observability (outbox lag, push failures, Ably token renewal), load tests per design targets (incl. 10k concurrent Ably clients scenario).
Gate: production-hardening review.

---

## Cross-cutting rules for every phase
- Server-side authorization on every endpoint and access path; DTOs never leak private fields.
- Persist before publishing realtime events (transactional outbox).
- Idempotency keys for create/send/payment-adjacent operations; jobs safe under duplicate execution.
- Testcontainers Postgres+PostGIS for integration tests — H2 is not sufficient (documented gate).
- No provider SDK/credentials before that phase is approved; no scope creep beyond approved design.
- Keep `DIASPORUM_INITIAL_REPOSITORY_ASSESSMENT.md` §9 decisions updated as they're resolved.

## Recommended first milestone
**Phase 1 + Phase 2 backend track** — "configured, secured skeleton": git versioning, env-based config, disposable Postgres+PostGIS with Flyway baseline + smoke assertions executed, Keycloak resource server, `/api/v1/me`, global error format, passing Testcontainers suite. It unblocks every subsequent module and directly retires the biggest current risks (unversioned code, unvalidated schema, no auth).
