# Diasporum — Events Module Implementation Report

Status: **Complete** — backend, database and mobile implementations finished, followed by a final product-gap review (visibility switching, waitlist promotion on capacity increase, native date/time pickers, participant browsing, ONLINE_VOICE integration boundary) — all verified by the full automated test suites.

- Backend: `mvnw test` — **171 tests, 0 failures, 0 errors, BUILD SUCCESS** (Testcontainers PostgreSQL 17 / PostGIS).
- Mobile: `tsc --noEmit` clean · events sources pass ESLint · Jest **12 suites / 131 tests, all passing** (46 of them events-specific).

Scope: Events module only, plus the minimal integration points required by it (media purpose, business-account read API, navigation/Create Sheet entries, and pre-existing test repairs needed to make the suites runnable). No messaging, Voice Rooms/LiveKit, push notifications, billing or ticketing work was performed, per the milestone scope restrictions.

---

## 1. Backend functionality

Implemented in the existing modular-monolith layout under `com.diasporum.backend.events`:

| File                                                                                            | Responsibility                                                          |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `events/internal/api/rest/EventController.java`                                                 | All REST endpoints, request DTOs + validation, HTTP status codes        |
| `events/internal/application/EventService.java`                                                 | Lifecycle, discovery, RSVP, saves, reports, participants (JdbcTemplate) |
| `events/internal/application/EventAuthorization.java`                                           | Ownership / management / membership / visibility policy                 |
| `businessaccounts/BusinessAccountsApi.java` (+ `internal/application/BusinessAccountsApiImpl.java`) | Public read API consumed by the events module — after the Messaging merge, the events-introduced workspace membership views (`membership`/`membershipsOf` + `AccountMembershipView`) were consolidated into the single `BusinessAccountsApi`; the duplicate singular `BusinessAccountApi` was removed |
| `media/internal/application/MediaService.java`                                                  | `EVENT` media purpose added to the upload allowlist (1 line)            |

Feature coverage:

- **Creation** — title, description, category (taxonomy), community or country scope, location, timezone-aware start/end, capacity, visibility (`COMMUNITY`/`COUNTRY`), mode (`IN_PERSON`/`ONLINE_EXTERNAL`), optional online link and cover media. Draft or published on create.
- **Editing** — whitelist PATCH with partial updates; visibility can be switched between `COMMUNITY` and `COUNTRY` (see §4); capacity increases are allowed (and promote the waitlist) even after the event has started; other edits are blocked after start (409) and after cancellation.
- **Cancellation** — explicit `cancelled_at` + reason; the event stays visible to participants as cancelled; RSVP/edit/publish are blocked afterwards.
- **Deletion** — soft delete (`status = 'DELETED'`), organizer-only, permitted before start.
- **Details** — full event, my RSVP, participant counts, saved flag, organizer identity, manager flag.
- **Discovery** — cursor pagination over published, non-cancelled, upcoming events; filters: scope, mode, category, free-text search. Ordered by start time.
- **Community listings** — `GET /communities/{id}/events` with the same visibility rules.
- **Categories** — taxonomy `EVENT_CATEGORY` reference list.
- **Cover images** — attach via the existing media module (`EVENT` purpose); signed download URL endpoint performs the event visibility check server-side so any permitted viewer can load the cover.
- **Saves/bookmarks** — save/unsave + `GET /me/events/saved`.
- **My events** — `GET /me/events` with `role=organized|participating`.
- **Reporting** — `POST /events/{id}/report` with reason, reporter resolved from the principal.

## 2. REST endpoints

All under `/api/v1`, bearer-token authenticated (except where noted), consistent with the existing controller conventions:

| Method & path                                    | Purpose                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `GET /events/categories`                         | Event categories (taxonomy)                                           |
| `POST /events`                                   | Create event (201; validation errors 400)                             |
| `GET /events/{eventId}`                          | Event detail                                                          |
| `PATCH /events/{eventId}`                        | Partial update (whitelist keys)                                       |
| `POST /events/{eventId}/publish`                 | Publish a draft                                                       |
| `POST /events/{eventId}/cancel`                  | Cancel with optional reason                                           |
| `DELETE /events/{eventId}`                       | Soft delete                                                           |
| `GET /events/{eventId}/cover/download-url`       | Signed cover URL (visibility-checked)                                 |
| `GET /events`                                    | Discovery: `scope`, `mode`, `categoryId`, `search`, `cursor`, `limit` |
| `GET /communities/{communityId}/events`          | Community event listing                                               |
| `PUT /events/{eventId}/rsvp`                     | Set RSVP status                                                       |
| `DELETE /events/{eventId}/rsvp`                  | Remove RSVP                                                           |
| `GET /events/{eventId}/participants`             | Participant page (visibility-filtered)                                |
| `PUT /events/{eventId}/save` / `DELETE .../save` | Save / unsave                                                         |
| `GET /me/events/saved`                           | Saved events listing                                                  |
| `GET /me/events?role=organized\|participating`   | My events                                                             |
| `POST /events/{eventId}/report`                  | Report event                                                          |

Error handling follows the module conventions: `ApiError`-style problem responses, 401 unauthenticated, 403 forbidden, 404 not found/not visible, 409 lifecycle/state conflicts, 400 validation.

## 3. Database changes

- **`V4__events_lifecycle.sql`** (forward-only Flyway migration; no earlier migration was modified):
  - `events.published_at timestamptz`, `events.cancelled_at timestamptz`, `events.cancel_reason text` (length-checked ≤ 1000).
  - Partial index `ix_events_discovery (starts_at, id) WHERE status='PUBLISHED' AND cancelled_at IS NULL`.
  - Partial index `ix_events_owner_user (owner_user_id, starts_at) WHERE status <> 'DELETED' AND owner_user_id IS NOT NULL`.
- **`V5__events_voice_room_boundary.sql`** (forward-only; V4 was left untouched):
  - `events.voice_room_id uuid` + column comment — the prepared ONLINE_VOICE integration boundary. An event references a _Diasporum_ voice room by platform-owned ID only; provider credentials, room URLs and tokens are never stored on `events` (the future voice-rooms module owns all LiveKit specifics and mints short-lived join grants). No FK is declared because the voice-rooms table does not exist yet; it will be added with the Voice Rooms milestone.
- The v10.12 baseline already provides the core `events`, `event_participants`, `event_saves`, `event_reports`, `event_categories` (taxonomy) and location/capacity/visibility columns; V4 only adds the publish/cancel lifecycle the design requires.
- `MediaService` allowlist gains the `EVENT` purpose (image/jpeg, image/png, image/webp).

## 4. Authorization rules

- **Authentication**: every endpoint requires a valid Diasporum JWT with an active session (existing `JwtAuthenticationFilter`).
- **Community visibility**: `COMMUNITY`-scoped events are readable only by accepted members; discovery excludes them for outsiders. `COUNTRY`-scoped events are readable by users whose current country matches the event's country.
- **Ownership/management**: edit, cancel, delete, publish are restricted to the organizer (owner user) or an authorized manager of a business-account-owned event. `EventAuthorization` resolves manager permission through `BusinessAccountsApi` (accepted, active workspace membership; role capabilities defined by the events policy).
- **Business accounts**: events can be owned by a business account; managers manage them like the organizer. Tested by `businessAccountEventManagement`.
- **Lifecycle restrictions**: RSVP is blocked for drafts, cancelled and already-started events; editing is blocked after start and after cancellation (capacity _increases_ are the one deliberate exception — they only add seats and promote the waitlist); deletion is permitted only before start.
- **Visibility switching (COMMUNITY ↔ COUNTRY)**: organizer/manager only, before start only. Widening to `COUNTRY` exposes the event only to users whose current country matches the event's country (which is fixed by the community's destination country — no arbitrary country pick). Narrowing back to `COMMUNITY` requires the organizer to still be an active member of the event's community; otherwise 403. Drafts remain organizer-only regardless of scope, and non-members/non-country users continue to receive 404 (not 403) so existence is never disclosed. Tested by `visibilityChangeBetweenCommunityAndCountry` plus HTTP PATCH assertions (member → 403, organizer → 200 both directions).
- **Participant privacy**: participants are listed only to viewers who can already see the event; counts (going/interested/waitlisted) are exposed on the detail payload.

## 5. RSVP and capacity behaviour

- Statuses: `GOING`, `INTERESTED`, `NOT_GOING`, `WAITLISTED`.
- Re-RSVPing updates the existing row — duplicate participant records are impossible (upsert on the unique `(event_id, user_id)`).
- Capacity: when `capacity` is reached, a `GOING` request transitions the user to `WAITLISTED` instead of failing; `INTERESTED`/`NOT_GOING` bypass the limit.
- Cancellation/withdrawal promotes waitlisted participants in order while capacity allows.
- **Capacity increase promotes the waitlist automatically**: raising `capacity` on a full event promotes waitlisted participants in FIFO order in the same transaction as the capacity UPDATE. The update path locks the event row (`SELECT ... FOR UPDATE`) up front, so concurrent RSVP writers serialize against the promotion — capacity can never be oversold. Tested by `capacityIncreasePromotesWaitlistInFifoOrder` (partial and full promotion, promotion after start, decrease-after-start still 409) and `concurrentCapacityIncreaseAndRsvpNeverOversell` (a capacity raise racing four concurrent RSVPs always ends at exactly 5 GOING / 0 WAITLISTED).
- Concurrency: RSVP mutations run inside a transaction that locks the event row (`SELECT ... FOR UPDATE`) before counting going participants, so concurrent requests can never oversell capacity (`concurrentRsvpNeverOversellsCapacity` runs parallel requests and asserts the invariant).
- `DELETE /rsvp` removes the participation and returns refreshed counts.

## 6. Mobile implementation

All screens use the shared `apiClient` (bearer auth, host restriction, 401 retry), theme, `ThemedText/ThemedView`, `useSession` and the common loading/empty/error states. No mock or hardcoded event data.

Routes (`src/app/(app)/events/`): `index.tsx` (discovery), `[id].tsx` (detail), `create.tsx`, `edit/[id].tsx`, `participants/[id].tsx` (participant browser), `my.tsx`, `saved.tsx`.

Feature sources (`src/features/events/`):

| File                                                            | Purpose                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `screens/events-screen.tsx`                                     | Discovery hub: search (debounced), scope/mode/category filter chips, cursor pagination, pull-to-refresh                                                                                                                                                                                                                                                     |
| `screens/event-detail-screen.tsx`                               | Cover, dates in the event timezone, location/online link, counts, participant preview + "View all participants" link into the browser, RSVP controls, save toggle, manager actions (edit/cancel/delete/publish), report                                                                                                                                     |
| `screens/event-participants-screen.tsx`                         | Paginated participant browser: RSVP-status filter chips (All/Going/Interested/Waitlisted), page-based "Load more" pagination, pull-to-refresh. Every request goes through the authorized participants endpoint — the backend only returns data for events the viewer can access, so no participant information is exposed to users who cannot see the event |
| `screens/create-event-screen.tsx` + `components/event-form.tsx` | Validated create form: title/description/category, mode (incl. external online link), native date & time pickers + timezone, capacity, visibility, location, cover upload via media module. Submit-time lifecycle validation (start must be in the future for published events; end after start)                                                            |
| `screens/edit-event-screen.tsx`                                 | Reuses `EventForm` for partial PATCH updates (including visibility switching); submit-time lifecycle guard mirrors the backend (after start only title/description/cover/capacity-increases may change); blocked after cancellation                                                                                                                         |
| `screens/my-events-screen.tsx`                                  | Organized vs participating tabs                                                                                                                                                                                                                                                                                                                             |
| `screens/saved-events-screen.tsx`                               | Saved events listing                                                                                                                                                                                                                                                                                                                                        |
| `components/event-card.tsx`                                     | Discovery card (badge, date, community, counts)                                                                                                                                                                                                                                                                                                             |
| `components/event-cover.tsx`                                    | Cover via the visibility-checked download URL, one retry on expiry                                                                                                                                                                                                                                                                                          |
| `components/event-states.tsx`                                   | Loading skeleton, empty, error states                                                                                                                                                                                                                                                                                                                       |
| `services/event-api.ts`                                         | Typed wrappers for every endpoint                                                                                                                                                                                                                                                                                                                           |
| `types/event-types.ts`                                          | API DTO types                                                                                                                                                                                                                                                                                                                                               |
| `utils/event-time.ts`                                           | Timezone conversion (`zonedToUtc`, DST-safe), formatting, validation (rejects calendar overflow such as Feb 30)                                                                                                                                                                                                                                             |

Date/time UX details (gap review):

- Start/end date and time use the native `@react-native-community/datetimepicker` (date + time modes) instead of free-text inputs; date fields carry a midday carrier time to stay clear of DST midnight edges.
- The pickers render wall-clock values in the _device_ timezone while the form stores wall-clock strings interpreted in the _event's_ IANA timezone — the mapping goes through the device zone so the stored value always equals what the user actually saw and picked, and `zonedToUtc` interprets it in the event's timezone at submit time. A dedicated test asserts `18:30 Europe/Berlin` is submitted as `17:30Z`.
- Validation remains mirrored client-side: format, calendar overflow, end-after-start, and submit-time lifecycle checks (future start for publish; on edit, the started-event guard above).

Integration points:

- `feature-nav.tsx` — "event" quick action now routes to `/(app)/events`.
- `create-sheet.tsx` — the "Event" option routes to `/(app)/events/create`.

## 7. Tests executed and results

### Backend (`diasporum-backend`)

`.\mvnw.cmd test` — **171 tests, 0 failures, 0 errors, BUILD SUCCESS**. Per-class:

- `events.EventsModuleIntegrationTest` — 19 tests: creation+validation (incl. dedicated `ONLINE_VOICE_NOT_SUPPORTED` code), cover via media module, community visibility for non-members, country-scope visibility, manager-only edit/cancel/delete, visibility switching between COMMUNITY and COUNTRY (service + HTTP, authorization, membership re-check, after-start 409), cursor pagination + filters, outsider visibility, RSVP transitions (single record), capacity + waitlist + promotion, waitlist promotion on capacity increase (FIFO, after start, decrease blocked), concurrent capacity-raise-vs-RSVP (never oversells), participant visibility + counts, saves + my events, cancellation blocking RSVP/editing, business-account management.
- `architecture.ModuleBoundaryTest` (ArchUnit) — 26 tests, including the events module boundary (no reach-through into other modules' `internal.*`).
- Plus all pre-existing suites: auth/identity (39), community, feed, media, security, social, taxonomy, business accounts, platform.

### Mobile (`diasporum-mobile`)

- `npx tsc --noEmit` — **clean**.
- `npx eslint "src/features/events/**" "src/__tests__/features/events/**" "src/app/(app)/events/**"` — **0 problems**.
- `npx jest` — **12 suites, 131 tests, all passing**, of which events: `event-api.test.ts` (14), `event-time.test.ts` (18), `events-ui.test.tsx` (14) = **46 events tests** covering API service wiring, discovery render/navigation/empty/error, detail render + participant-browser navigation, RSVP interaction, save/unsave, create validation (title, online link), native-picker date/time submission in the event timezone (18:30 Europe/Berlin → 17:30Z), and participant-browser pagination + status filtering.
- Note: one jest run under heavy CPU contention (backend Maven build running in parallel) showed a single timing flake that does not reproduce in isolated or normal full runs.

### Pre-existing test repairs required to run the suites

The repository's test sources did not compile / failed before this milestone; these repairs were necessary to produce the evidence above and are behaviour-neutral:

- `FeedModuleIntegrationTest` / `TaxonomyIntegrationTest` — updated to current `communityFeed(...)` / `UpdateProfileRequest(...)` signatures (compile errors).
- `ProfileManagementIntegrationTest` — setup now deletes `community_memberships`/`communities` before `countries` (FK order; `TaxonomyStartupSeeder` seeds 55 dev communities).
- `AuthFlowIntegrationTest.registerVerifyLoginFullFlow` — stale assertion updated to the intentional "registration activates accounts directly" behaviour documented in `AuthService.register` (email verification deferred); the `email_verified_at` assertion was removed accordingly.
- `ExternalIdentityIntegrationTest.googleVerifiedEmailMatchingPendingAccountLinksAndActivates` — forces `PENDING_VERIFICATION` via SQL after registration so the link-and-activate path is still exercised.
- `IdentityApiAndSettingsTest.httpEndpointsServeOwnSettingsOnly` — the `UsernamePasswordAuthenticationToken` two-argument constructor produces an unauthenticated token (403); switched to the authenticated three-argument form used by the passing tests.

**Messaging-branch alignment:** the `feature/messaging` branch carries semantically identical fixes to the same shared test files. To keep both branches mergeable, this branch adopts the Messaging branch's exact versions of `FeedModuleIntegrationTest`, `AuthFlowIntegrationTest`, `ExternalIdentityIntegrationTest`, `IdentityApiAndSettingsTest`, `ProfileManagementIntegrationTest` and `TaxonomyIntegrationTest` — nothing was removed or diverged, so the future merge auto-resolves. The full suite above (171/171) was run with those exact versions in place, confirming they pass on this branch too (including `ProfileManagementIntegrationTest`, which relies on the taxonomy seeder's 195-country baseline).

## 8. Known limitations

- `ONLINE_VOICE` mode is rejected with a dedicated `ONLINE_VOICE_NOT_SUPPORTED` code — Voice Rooms/LiveKit are a separate milestone. The persistence boundary (`events.voice_room_id`, platform-owned room ID only, never provider credentials/room URLs/tokens) is prepared in V5; activation (mode acceptance + FK + join-grant flow) is deferred to that milestone.
- The end time can be set or changed but not cleared via PATCH.
- "Already started" checks use a `Date.now()` snapshot taken at screen mount.
- Cover retry is a single retry on URL expiry.
- The detail screen shows only a six-name participant preview; the full paginated list lives in the participant browser.
- Mobile test output contains repo-wide non-fatal `act(...)` environment console noise (present in all existing UI suites, does not affect results).
- Pre-existing ESLint debt outside the events feature (e.g. `community-drawer.tsx`, `env.test.ts`, `security.tsx`, `provider-signin.ts`) remains, untouched per scope restrictions.

## 9. Remaining work (out of this milestone)

- Event chat / direct messaging integration (Messaging milestone, owned separately).
- Voice Rooms / LiveKit online event mode — activate `ONLINE_VOICE`, add the voice-rooms FK and join-grant flow on top of the prepared `events.voice_room_id` boundary.
- Push notifications for RSVP changes, waitlist promotion, event reminders.
- Paid events, promotion and external ticketing/payment processing.
- Organizer check-in tooling on top of the participant browser.
