# Diasporum — Implementation Status Report

**Date:** 2026-11-01
**Scope:** What is actually implemented in `diasporum-backend` (Spring Boot) and `diasporum-mobile` (Expo/React Native), plus the untouched `diasporum-web`. Verified against the codebase, not prior reports.
**Baseline docs:** `Diasporum_v10.12`, `DIASPORUM_IMPLEMENTATION_PLAN.md`

---

## 1. Snapshot

| Layer | State |
|---|---|
| Backend | Modular monolith scaffolded (~24 modules). **9 modules implemented**, 15 are package shells. ~200 Java files, ~100 REST endpoints, 3 Flyway migrations, 27 test classes (Testcontainers + ArchUnit). |
| Mobile | Real product app: full auth, onboarding, home/explore/reels feed, post CRUD, business accounts, profile, settings. Messages and Rooms tabs are honest placeholders. 9 test files (jest-expo). |
| Web | Untouched `create-next-app` template — nothing built. |
| Database | PostgreSQL 17 + PostGIS via `compose.yaml`; V1 baseline v10.12 applied through Flyway; seed SQLs at root. |
| Git | **Root repo has zero commits** — everything is staged/uncommitted. Highest-priority hygiene item. |

---

## 2. Backend — implemented modules

Architecture: `com.diasporum.backend.<module>.internal/{api/rest, application, domain, infrastructure}` with ArchUnit module-boundary enforcement (`ModuleBoundaryTest`).

### 2.1 `security` + `platform` (cross-cutting, done)
- First-party auth: Diasporum issues/validates its own **RS256 JWTs** (access 15m, refresh 30d, absolute session 90d). Keycloak was dropped (V2 migration) — Google/Apple are token-verification providers only.
- Config-driven JWT keys; ephemeral keys allowed only in local/test profiles.
- CORS whitelist config, `ApiExceptionHandler` shared error format, geospatial helpers.
- Config: `application.yaml` + `application-local.yml`, all secrets via env; `.env`/`.env.example` present.

### 2.2 `identity` (largest module, 30 files)
Endpoints under `/api/v1`:
- `POST /auth/register`, `/login`, `/google`, `/apple`, `/refresh`, `/logout`, `/logout-all`
- `GET /auth/me`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`
- `POST /auth/verify-email`, `/resend-verification`, `/forgot-password`, `/reset-password`, `/change-password`
- `POST /auth/link/google`, `/link/apple`, `DELETE /auth/link/{id}`
- `GET /me`, `GET|PATCH /me/profile`, `GET /me/profile/completion`, `GET /usernames/availability`, `GET /countries`
- `GET|PATCH /me/settings`, `GET|PATCH /me/privacy-settings`
- Email verification/reset via pluggable `EmailService` (local log-only or SMTP — `spring-boot-starter-mail`).

### 2.3 `taxonomy`
`GET /taxonomy/{countries,languages,communities,categories,interests}` + per-item lookups. Includes `TaxonomyReferenceSeeder`.

### 2.4 `community`
- `GET /me/communities`, `/me/communities/available`, `/me/communities/{id}`, `/me/community-preview`
- `GET|PUT /me/active-community`, `POST /me/onboarding/complete`
- Membership: `POST /communities/{id}/join`, `GET|DELETE /communities/{id}/membership`
- Members: list, detail, remove, role assignment.

### 2.5 `social`
Follows/unfollows, followers/following lists, friend request + friends list, block/unblock + blocks list, `GET /social/relationship/{target}`.

### 2.6 `feed`
- Posts: `POST /feed/posts`, `GET|PATCH|DELETE /feed/posts/{id}`
- Feeds: `GET /feed/community`, `/feed/following`, `/feed/reels/community`, `GET /feed/authors`
- Reactions, saves, views (`POST /feed/views`)
- Comments: create/list/edit/delete
- Community Help posts + status transitions
- Polls: create, read, vote

### 2.7 `media`
`POST /media/uploads` (presigned), `/uploads/{id}/complete`, `GET /media/{id}`, `POST /media/{id}/download-url`, deletes. Cloudflare R2 via AWS S3 SDK — **disabled unless `R2_ENABLED=true` + credentials**; upload/download URL TTLs configured.

### 2.8 `businessaccounts`
`GET|POST /api/v1/business-accounts`, `GET /{accountId}/workspace`. Authorization-tested.

### 2.9 Migrations (`db/migration`)
- `V1__baseline_v10_12.sql` — canonical schema baseline
- `V2__drop_keycloak_authentication_method.sql`
- `V3__relax_profile_not_null_for_onboarding.sql`
- `db/migration-archive/` holds the superseded V1–V4 draft series.

### 2.10 Backend tests (27 classes)
Integration tests per module (identity auth flow, external identities, profile mgmt, settings, community, social, feed, media, business accounts, taxonomy) running on **Testcontainers PostgreSQL**; ArchUnit boundary test; JWT/CORS/security config tests; SMTP service test; API error-format test.

---

## 3. Backend — shell modules (package-info only, no code)

`administration`, `appconfiguration`, `billing`, `businessdirectory`, `communitychat`, `events`, `jobs`, `matchmaking`, `messaging` (has `MessagingApi` stub interface), `moderation`, `notifications`, `propertylistings`, `servicemarketplace` (has `ServiceMarketplaceApi` interface), `sparebag`, `vehiclelistings`, `voice`.

---

## 4. Mobile — implemented

Stack: Expo SDK 58, expo-router, TS strict. Env config centralized in `core/config/env.ts` (`EXPO_PUBLIC_*`). API client with token refresh + stale-token handling; auth/session providers; SecureStore token persistence.

### 4.1 Auth (`(auth)` routes — real screens, wired to `/auth/*`)
Welcome, sign-up, login, register, verify-email, forgot-password, reset-password. Google + Apple native sign-in (`@react-native-google-signin`, `expo-apple-authentication`) exchanging provider tokens with the backend.

### 4.2 Onboarding (`(onboarding)` routes)
Multi-step: origin country → current country → profile details → community preview → complete. Uses taxonomy-api + community-api; calls `POST /me/onboarding/complete`.

### 4.3 Feed feature (most built-out feature)
- Home feed screen (tab `index`), Explore screen, Reels screen — all wired to feed-api/explore-api
- Post detail (comments), create-post, edit-post, create-reel screens
- Components: post-item, composer-bar, community-drawer, community-selector, feed header/controls/states, media-image with disk cache, avatar, time-ago utils
- Community Help composer mode (`/posts/create?mode=help`)

### 4.4 Business feature
Business accounts list, create-business, per-account workspace screen; `business-api` service + types. Entry points: profile card + create-sheet link.

### 4.5 Communities
Communities list screen (hidden tab, routable), community-api service; active-community switching via drawer/selector.

### 4.6 Profile & settings
Profile tab (identity, details, business card, actions), profile edit screen, account & security screen; `profile-api` service.

### 4.7 Shell/UX
- Bottom tab bar: labeled icons (Home, Rooms, Create, Messages, Profile), central Create button opening the animated `CreateSheet` with a Business Workspace link and 9 create options (Post, Reel live; Property, Vehicle, Spare Bag, Service Request, Event, Job marked "Soon")
- Shared: form/password inputs, primary button, searchable list, onboarding header/progress, error/loading states
- Theme system: light/dark `Colors`, `ThemedText`/`ThemedView`, `useTheme`

### 4.8 Mobile tests (9 files)
api-client, stale-token, auth-service, auth-storage, env config, session-resolver, business-api, business-ui, feed-api (jest-expo).

---

## 5. Mobile — placeholders / not wired

- **Messages tab** — explicit placeholder, no fake data (messaging backend is a shell)
- **Rooms tab** — placeholder screen describing upcoming text/voice room types
- Create-sheet options without backend: Property, Vehicle, Spare Bag, Service Request, Event, Job
- Empty feature dirs awaiting code: `authentication/{components,screens}`, `communities/{components,hooks}`, `explore/components`, `home/components`, `onboarding/{components,types}`, `profile/{components,hooks}`, `reels/components`
- No `expo-notifications`/push, no Ably/realtime client, no LiveKit — not installed yet
- Media upload relies on R2 being enabled backend-side (off by default)

---

## 6. Web

`diasporum-web` is still the stock Next.js 16 template (single `app/page.tsx`). Per the plan, web scope is limited (admin/informational) — do not build consumer features there.

---

## 7. Suggested next milestones

Priority follows existing momentum (each backend module pairs with a mobile surface):

1. **Commit the repo** — zero commits; everything staged. Protect the work before anything else.
2. **Messaging** — backend shell exists (`MessagingApi`), mobile Messages tab is a placeholder. Unblocks Rooms chat afterward (`communitychat`, `voice`/LiveKit).
3. **Listing modules** — the create sheet already advertises them: `propertylistings`, `vehiclelistings`, `sparebag`, `jobs`, `events`, `servicemarketplace`, `businessdirectory`. Each needs backend module → mobile create/detail screens.
4. **Notifications** — backend shell + mobile has no push infrastructure (`expo-notifications`, Ably).
5. **R2 media enablement** — wire real credentials in non-local envs; the whole upload path is code-complete but disabled.
6. **Moderation / administration / appconfiguration** — required before real users; no UI needed yet.
7. **Billing** — blocked on open decisions (Stripe for web yes; RevenueCat still unevaluated).
8. **Matchmaking** — last per dependency order; needs messaging/notifications first.
9. **Web app** — define the admin/informational scope, then scaffold.
10. **Mobile polish** — fill empty feature dirs as features land; add CI for `tsc`, `expo lint`, jest, `mvn test`.

## 8. Open decisions / risks carried forward

- Git history is empty — no baseline to diff or roll back to.
- `keycloak/` dir + Keycloak service in `compose.yaml` remain from the dropped Keycloak design — confirm they're legacy dev-only artifacts.
- Redis dependency was removed from the POM path seen earlier; verify nothing expects it.
- No CI anywhere; lint debt exists (`community-drawer.tsx` has 11 `react-hooks/refs` errors).
- RevenueCat/Cloudflare Stream remain unapproved candidates — do not integrate.
- Schema was validated (see `DIASPORUM_DATABASE_VALIDATION_REPORT.md`) but heavy trigger-based integrity still needs concurrency soak before launch.
