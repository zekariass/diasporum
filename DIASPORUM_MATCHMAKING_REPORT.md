# Diasporum — Matchmaking Module Implementation Report

Status: **Implemented and verified** — the full-stack Matchmaking slice is complete, including backend services, database migration, mobile flows, cross-module integrations, and focused regression verification.

- Branch: `feature/matchmaking`
- Backend: **79 affected integration tests, 0 failures, 0 errors, BUILD SUCCESS** across Matchmaking, migration, Social, and Messaging suites.
- Mobile: **5 test suites / 44 tests passed** across Matchmaking and Messaging.
- TypeScript: `tsc --noEmit` passed.
- Mobile lint: **0 errors**; 11 existing warnings remain outside the new Matchmaking implementation.
- Repository validation: `git diff --check` passed.
- Verification scope: the backend result is the affected integration-suite run, not a claim that every repository test suite was executed.

---

## 1. Scope and architecture

The Matchmaking implementation adds an end-to-end relationship-discovery workflow to the existing Diasporum modular monolith and Expo mobile application.

Implemented capabilities:

- Owner-managed Matchmaking profiles and preferences.
- Adult eligibility and discovery opt-in enforcement.
- Reciprocal preference-compatible candidate discovery.
- Privacy-safe candidate and match projections.
- LIKE/PASS swipes, received likes, like cancellation, and latest-swipe rewind.
- Atomic mutual-match creation with concurrency protection.
- Durable friendship creation through the Social public API.
- Accepted GENERAL conversation creation/reuse through the Messaging public API.
- Match listing, match detail, reporting, and unmatching.
- Friendship, conversation, and message-history preservation after unmatch.
- Billing quota enforcement and idempotent usage accounting.
- Durable notifications and transactional-outbox realtime invalidation.
- Mobile onboarding, profile editing, discovery, likes, matches, reporting, blocking, and chat navigation.

The backend follows the existing module-boundary rule: other modules consume only root public APIs such as `SocialApi`, `MessagingApi`, `BillingApi`, `NotificationsApi`, and `MediaApi`; Matchmaking implementation details remain under `matchmaking.internal.*`.

---

## 2. Backend implementation

### 2.1 Profile lifecycle

`MatchmakingProfileService` implements owner-only profile reads, creation, editing, pausing, activation, and deletion.

Supported user-editable statuses:

- `DRAFT`
- `ACTIVE`
- `PAUSED`

System-managed states such as `SUSPENDED` and `DELETED` are not editable through the normal profile-save operation.

Activation requires:

- An adult user.
- Matchmaking discovery opt-in.
- A saved preference record.
- Valid taxonomy and owner-owned reference data.
- Valid, owned, purpose-correct media.
- A `READY` visible or blurred photo when the corresponding photo-visibility mode is selected.

Profile deletion closes the user's active matches and marks the profile deleted rather than exposing it for further discovery.

Paused profiles are removed from active discovery but retain access to their existing matches and can unmatch them.

### 2.2 Preferences and reciprocal discovery

`PreferenceService` atomically replaces and validates:

- Minimum and maximum age.
- Maximum distance.
- Verified-only filtering.
- Existing-children and desired-children preferences.
- Gender, religion, and language selections.

Reference selections are validated against active taxonomy data and normalized to remove duplicates.

`DiscoveryService` provides:

- Cursor-paginated candidate discovery.
- Cursor-paginated received likes.
- Privacy-safe candidate details.
- Reciprocal compatibility checks, so both users must satisfy the applicable discovery requirements.
- Block and prior-interaction exclusions.

Discovery and received-likes reads require an eligible active actor. Existing-match reads deliberately do not require active discovery eligibility, allowing paused users to manage their current matches.

### 2.3 Swipe lifecycle

`RecordSwipeService` accepts `LIKE` and `PASS` decisions and rejects self-swipes, unsupported actions, duplicate decisions, and pair conflicts.

For each swipe, the service:

1. Verifies actor eligibility.
2. Takes a transaction-scoped pair lock.
3. Verifies target discoverability and block rules.
4. Verifies reciprocal compatibility.
5. Writes the swipe and its history event.
6. Consumes the `MATCHMAKING_INTERACT` billing feature using the history-event ID as the idempotency key.
7. Creates a durable like notification for a LIKE.
8. Checks for a reciprocal active LIKE.
9. Creates the mutual match and all required side effects when appropriate.

`CancelLikeService` permits cancellation only of the actor's current outgoing active LIKE before a match exists. It appends a `LIKE_CANCELLED` history event and moves the swipe to `WITHDRAWN`.

`RewindSwipeService` rewinds only the latest eligible unreversed swipe selected by the server. Clients cannot choose an arbitrary target. Matched or otherwise ineligible swipes cannot be rewound.

### 2.4 Mutual-match transaction

A reciprocal active LIKE triggers one transactional application-owned workflow:

1. Insert the canonical match pair.
2. Establish a durable friendship through `SocialApi`.
3. Create or reuse an accepted GENERAL conversation through `MessagingApi`.
4. Link the conversation to the Matchmaking match.
5. Create durable match notifications for both users.
6. Enqueue `MATCHMAKING_MATCHED` outbox events for both users.
7. Return the match and conversation identifiers to the caller.

The former automatic database triggers for mutual-match and conversation creation are removed by the V12 migration, preventing duplicate side effects. PostgreSQL advisory transaction locks serialize pair mutations, including concurrent opposite LIKE requests.

If any required side effect fails, the transaction rolls back rather than leaving a partial match, friendship, conversation, billing record, or notification set.

### 2.5 Matches, reporting, and unmatching

`MatchService` provides cursor-paginated match listings, participant-safe match details, conversation identifiers, and match reporting.

Reports use the shared moderation-report queue, validate supported reasons, limit details to 4000 characters, and reject duplicate reports.

`UnmatchService`:

- Restricts the operation to match participants.
- Locks the match before changing its state.
- Marks an active match `UNMATCHED` and records closure metadata.
- Emits deduplicated `MATCHMAKING_UNMATCHED` outbox events for both participants.
- Returns the updated match detail.
- Treats repeated unmatch requests as idempotent reads of the closed state.

Unmatching changes only match state. It preserves the durable friendship, accepted conversation, and message history.

---

## 3. REST API

All endpoints are under `/api/v1/matchmaking` and use the authenticated `DiasporumUserPrincipal` as the only actor source.

| Method | Path | Purpose |
|---|---|---|
| GET | `/reference-data` | Gender, religion, country, language, and owner-private-address options |
| GET | `/profile` | Read the authenticated user's Matchmaking profile |
| PUT | `/profile` | Create or replace the authenticated user's profile |
| DELETE | `/profile` | Delete the profile and close active matches |
| GET | `/preferences` | Read the authenticated user's preferences |
| PUT | `/preferences` | Replace and validate preferences |
| GET | `/discover` | Cursor-paginated compatible candidates |
| GET | `/profiles/{targetUserId}` | Privacy-safe candidate detail |
| POST | `/swipes` | Record a LIKE or PASS |
| DELETE | `/likes/{targetUserId}` | Cancel an outgoing active LIKE before matching |
| POST | `/rewind` | Rewind the latest eligible unreversed swipe |
| GET | `/likes/received` | Cursor-paginated active incoming likes |
| GET | `/matches` | Cursor-paginated active matches |
| GET | `/matches/{matchId}` | Participant-safe match detail |
| POST | `/matches/{matchId}/report` | Submit a moderation report |
| POST | `/matches/{matchId}/unmatch` | Close a match while preserving friendship and chat history |

Request validation includes adult age bounds, height bounds, occupation and reason lengths, required collections, supported enum-like values, and valid UUID/reference selections.

---

## 4. Database migration

`V12__matchmaking_module.sql` adds the forward-only persistence changes required by the implementation.

### Durable friendships

- Creates the canonical `friendships` table with normalized pair ordering.
- Adds a supporting reverse-user index.
- Backfills durable friendships from `user_mutual_connections`.
- Keeps friendships independent from directional `user_follows` rows and Matchmaking match state.

### Block cleanup

The block trigger now:

- Removes directional follows in both directions.
- Removes the durable friendship.
- Closes pending message requests and direct conversations.
- Marks the Matchmaking match `BLOCKED` with closure metadata.
- Removes active swipe rows for the blocked pair.
- Uses a pair advisory transaction lock to serialize cleanup.

### Application-owned match orchestration

- Drops the old automatic mutual-LIKE and match-conversation triggers and their functions.
- Prevents duplicate database and application side effects.
- Leaves match creation, Social, Messaging, Billing, Notifications, and outbox orchestration in the transactional backend service.

### Swipe integrity and history

- Replaces overly restrictive swipe-update handling with guarded transitions.
- Keeps actor, target, action, and creation timestamp immutable.
- Allows only active LIKE withdrawal or active LIKE/PASS rewind.
- Adds an actor/time index for efficient latest-swipe rewind lookup.

### Match integrity

The database match validator continues to require reciprocal active LIKEs, reciprocal compatibility and adult eligibility, and no block in either direction.

---

## 5. Cross-module integrations

### Social

`SocialApi.establishMatchmakingFriendship` creates an idempotent, race-safe durable friendship without creating reciprocal follows.

`SocialApi.isFriend` now represents durable friendship only. Code that requires mutual-follow semantics explicitly checks both `isFollowing(a, b)` and `isFollowing(b, a)`.

Blocking remains authoritative and closes the relationship and match state through the shared cleanup path.

### Messaging

`MessagingApi.ensureAcceptedGeneralConversation` creates or reuses the canonical GENERAL conversation and forces it to `ACCEPTED` because mutual Matchmaking consent has already been established.

`MatchConversationService` links the conversation to the match and rejects conflicting match links.

Unmatching removes the active-match projection but does not close or delete the conversation. Participants can continue chatting and sending messages.

Messaging privacy remains semantically correct after the friendship change:

- `MUTUAL_FOLLOWERS` requires reciprocal follows.
- `INTERACTED_USERS` accepts reciprocal follows, durable friendship, or a prior accepted conversation.

### Billing

Every recorded swipe consumes the personal `MATCHMAKING_INTERACT` feature. The swipe-history event ID provides idempotency, preventing duplicate consumption for the same history event.

Quota denial aborts the transaction and does not leave a persisted swipe.

### Notifications

LIKE and mutual-match notifications are durable and deduplicated. Mutual matches notify both participants, while a one-way LIKE notifies its recipient.

Notification failure participates in the same transaction and therefore prevents partial match completion.

### Media

Matchmaking uses the existing media upload flow with two dedicated purposes:

- `MATCHMAKING_PROFILE_PHOTO`
- `MATCHMAKING_PROFILE_BLURRED`

The backend validates ownership, purpose, and `READY` status before profile attachment. Public projections join only media that is actually `READY`.

### Realtime and outbox

`MATCHMAKING_MATCHED` and `MATCHMAKING_UNMATCHED` events use the transactional outbox and per-user channels.

Realtime is an invalidation mechanism only. PostgreSQL and the REST API remain the durable source of truth; clients reconcile after events or reconnect recovery.

---

## 6. Privacy, security, and authorization

- Every endpoint derives the actor from the authenticated principal; client-supplied actor IDs are not trusted.
- Activation requires adulthood and explicit discovery opt-in.
- Discovery enforces reciprocal compatibility and excludes blocked or otherwise ineligible users.
- Candidate and match details are participant-safe and return not-found responses where appropriate to avoid resource disclosure.
- Public profiles expose only visibility-approved display names and photos.
- Hidden names use the profile's anonymous alias.
- Hidden photos are omitted; blurred mode uses only the designated blurred asset.
- Private address coordinates and raw owner photo-media identifiers are not exposed in public DTOs.
- Reference-data address choices are restricted to addresses owned by the authenticated user.
- Match report and unmatch operations require match participation.
- Blocking overrides discovery and interaction eligibility.
- Billing, notifications, match writes, friendship creation, conversation linking, and outbox writes share transactional consistency.

---

## 7. Mobile implementation

The Expo/React Native feature lives under `src/features/matchmaking`, with thin expo-router wrappers under `src/app/(app)/matchmaking`.

### Routes and screens

| Route | Implementation | Purpose |
|---|---|---|
| `/matchmaking` | `matchmaking-entry-screen.tsx` | Resolve profile state and route to setup, discovery, or the appropriate entry flow |
| `/matchmaking/setup` | `setup-screen.tsx` | Adult gate, privacy opt-in, initial profile/preferences setup |
| `/matchmaking/profile` | `own-profile-screen.tsx` | Edit profile, visibility, photos, pause/activate, and delete |
| `/matchmaking/preferences` | `preferences-screen.tsx` | Edit discovery preferences |
| `/matchmaking/profile/{userId}` | `candidate-profile-screen.tsx` | Candidate details and actions |
| `/matchmaking/matches` | `matches-screen.tsx` | Cursor-paginated active matches |
| `/matchmaking/matches/{matchId}` | `match-detail-screen.tsx` | Match detail, chat, report, block, and unmatch actions |

The discovery screen provides:

- Discover and Likes Received tabs.
- LIKE/PASS actions and duplicate-action prevention.
- Cancel-like and rewind actions.
- Mutual-match confirmation and direct chat navigation.
- Pull-to-refresh and cursor pagination.
- Loading, empty, and error states.

### Profile media

Mobile photo upload uses the existing authenticated media API:

1. Request photo-library permission and select a square-edited image.
2. Accept JPEG, PNG, or WebP.
3. Initialize an upload with the appropriate Matchmaking purpose.
4. PUT bytes to the signed storage URL.
5. Complete the upload and require `READY` status.
6. Best-effort cleanup of the initialized asset if upload or completion fails.

### Pagination and request consistency

`use-paged-matchmaking.ts` serializes refresh and pagination work, tracks opaque cursors, and deduplicates overlapping page items.

Changing callbacks are held in refs so inline `getId` or fallback callbacks do not retrigger initial loads on every render. The active fetcher remains a query-change signal, ensuring Discover/Likes Received tab changes still reload from the correct endpoint.

### Realtime

`use-matchmaking-realtime.ts` subscribes to match/unmatch events, debounces invalidation by 250 ms, and reconciles after recovered connections. No realtime payload replaces authoritative REST state.

---

## 8. Regression fixes completed during final verification

### Paused-user match access

The matches-list use case previously required active discovery eligibility. This prevented paused users from viewing or unmatching existing matches. The guard was removed only from match listing; discovery and received-likes eligibility remain enforced.

Regression coverage now pauses a matched user, verifies the existing match remains listed, and completes an unmatch while preserving friendship and chat continuity.

### Match-list SQL projection

The matches query returned public-profile columns but used a mapper that also required match columns. The public SQL projection was separated into reusable column and FROM/JOIN components, and the matches query now selects all required match identifiers, status, timestamps, closure actor, and closure reason.

### Mobile pagination reload loop

Inline callback identities repeatedly retriggered the pagination hook, causing overlapping requests and unstable test/runtime behavior. Callback refs stabilized the loading operation without disabling endpoint changes on tab switches.

A regression test verifies that switching from Discover to Likes Received calls `/likes/received`, and pagination coverage verifies opaque-cursor use and duplicate-item suppression.

### Mutual-follower messaging regression

Narrowing `SocialApi.isFriend` to durable friendship caused mutual followers to receive `REQUESTED` rather than `ACCEPTED` conversations. Messaging now checks reciprocal follows explicitly for `MUTUAL_FOLLOWERS`, while `INTERACTED_USERS` supports both relationship forms.

### Jest and lint corrections

- Corrected a Jest mock-factory out-of-scope variable.
- Added the repository-standard targeted effect lint suppressions to the new asynchronous screen loaders.
- Removed unused imports and corrected an array-type warning.
- Stabilized the community drawer's animated value initialization, clearing its pre-existing render-time ref lint errors.

### Lifecycle documentation

The Matchmaking package documentation now states that unmatching preserves friendship, conversation, and message history, matching the implementation and tests.

---

## 9. Verification results

### Backend

Final command scope: Matchmaking, Matchmaking migration, Social, and all affected Messaging integration suites using Testcontainers PostgreSQL/PostGIS.

| Test class | Tests | Result | Main coverage |
|---|---:|---|---|
| `MatchmakingModuleIntegrationTest` | 9 | Passed | Activation, discovery, privacy, swipes, cancellation, rewind, match lifecycle, concurrency, quotas, reporting, REST, paused-user access |
| `MatchmakingMigrationIntegrationTest` | 1 | Passed | V12 upgrade, friendship backfill, trigger and lifecycle integrity |
| `SocialModuleIntegrationTest` | 10 | Passed | Follow independence, durable friendship, blocking, relationship projections |
| `MessagingModuleIntegrationTest` | 22 | Passed | Conversation reuse, requests, privacy, mutual followers, continuity, authorization |
| `MessagingPolicyIntegrationTest` | 9 | Passed | Messaging quotas, request policy, cooldowns, contextual authorization |
| `MessagingRealtimeIntegrationTest` | 14 | Passed | Outbox durability, retry/dedupe, token/channel security, fan-out |
| `MessagingDailyQuotaIntegrationTest` | 1 | Passed | Independent daily quota enforcement |
| `MessagingAttachmentIntegrationTest` | 13 | Passed | Existing attachment behavior after messaging integration changes |
| **Total** | **79** | **0 failures, 0 errors** | **BUILD SUCCESS** |

Important verified scenarios include:

- Concurrent opposite LIKEs converge without duplicate matches or side effects.
- Notification failure rolls back the mutual-match transaction.
- Billing denial does not record a swipe.
- Public DTOs do not leak private coordinates or unapproved media.
- Unmatch preserves friendship, conversation, and message sending.
- Paused users can list and unmatch existing matches.
- Mutual followers still receive accepted direct conversations under the corresponding privacy setting.

### Mobile

Final focused Jest run:

- `matchmaking-ui.test.tsx`
- `matchmaking-realtime.test.tsx`
- `messaging-api.test.ts`
- `messaging-ui.test.tsx`
- `messaging-realtime.test.tsx`

Result: **5 suites passed, 44 tests passed, 0 failures**.

Matchmaking coverage includes adult gating, setup routing, duplicate-LIKE prevention, mutual-match chat navigation, tab endpoint reloads, cursor deduplication, unmatch confirmation, realtime invalidation, and friendship/chat continuity.

Additional quality checks:

- `npm run typecheck` — passed.
- `npm run lint` — completed with **0 errors and 11 existing warnings**.
- `git diff --check` — passed with no whitespace errors.

The remaining lint warnings are in existing environment configuration, security settings, provider sign-in, and messaging-thread code; none are errors in the new Matchmaking implementation.

---

## 10. Key implementation files

### Backend

- `matchmaking/internal/api/rest/MatchmakingController.java` — authenticated versioned REST surface.
- `matchmaking/internal/application/MatchmakingProfileService.java` — profile lifecycle and validation.
- `matchmaking/internal/application/PreferenceService.java` — preference validation and replacement.
- `matchmaking/internal/application/DiscoveryService.java` — candidate and received-like reads.
- `matchmaking/internal/application/RecordSwipeService.java` — swipe and mutual-match transaction.
- `matchmaking/internal/application/CancelLikeService.java` — active-like cancellation.
- `matchmaking/internal/application/RewindSwipeService.java` — latest-eligible-swipe rewind.
- `matchmaking/internal/application/MatchService.java` — matches, details, and reports.
- `matchmaking/internal/application/UnmatchService.java` — match closure with relationship continuity.
- `matchmaking/internal/infrastructure/persistence/MatchmakingRepository.java` — PostgreSQL/PostGIS persistence and safe projections.
- `messaging/internal/application/MatchConversationService.java` — accepted conversation reuse and match linking.
- `social/internal/application/SocialService.java` — durable friendship and follow independence.
- `billing/internal/application/BillingService.java` — entitlement, quota, and idempotent usage accounting.
- `notifications/internal/application/NotificationService.java` — durable deduplicated notifications.
- `db/migration/V12__matchmaking_module.sql` — durable friendship and lifecycle migration.

### Mobile

- `features/matchmaking/screens/` — setup, discovery, profiles, preferences, matches, and match details.
- `features/matchmaking/components/` — candidate, profile form, and shared Matchmaking UI.
- `features/matchmaking/hooks/use-paged-matchmaking.ts` — serialized cursor pagination.
- `features/matchmaking/hooks/use-matchmaking-realtime.ts` — realtime REST invalidation.
- `features/matchmaking/services/matchmaking-api.ts` — typed authenticated API wrappers.
- `features/matchmaking/services/matchmaking-media-api.ts` — existing-media-flow photo upload.
- `app/(app)/matchmaking/` — expo-router route wrappers.

### Tests

- `MatchmakingModuleIntegrationTest.java`
- `MatchmakingMigrationIntegrationTest.java`
- `SocialModuleIntegrationTest.java`
- Affected Messaging integration suites
- `matchmaking-ui.test.tsx`
- `matchmaking-realtime.test.tsx`
- Affected Messaging mobile suites

---

## 11. Delivery notes and remaining work

- The Matchmaking implementation and focused regression audit are complete.
- The final backend verification covers the affected integration suites; a separate full-repository backend test run was not performed for this report.
- No physical-device or manual end-to-end verification is claimed by the automated test results.
- Eleven non-blocking pre-existing mobile lint warnings remain for separate cleanup.
- No Git commit was created as part of this implementation or report.
