# Diasporum Messaging Module — M1 Implementation Report

Milestone: **M1 — direct messaging foundation** (text-only DMs, all v10.12 conversation
contexts, message requests, business actors, read state, archive/mute, delete-own).
Branch: `feature/messaging`.

## 1. Implemented functionality

### Backend (Spring Boot modular monolith)

- **Create-or-retrieve conversation** — deterministic uniqueness per
  `(context_type, context_id, participant pair)` handled by the DB normalization
  trigger in `V1__baseline_v10_12.sql`; repeat calls return the existing row.
- **Conversation listing** — cursor-paginated inbox ordered by `last_message_at`,
  with participant views (personal + business sides resolved), unread counts,
  archive/mute state, and pending-request direction.
- **Conversation detail** — view + full participant list.
- **Send text messages** — idempotent via `client_message_id`; reply-to supported
  (`reply_to_message_id`); sequence numbers and preview/last-message fields are
  maintained by existing DB triggers.
- **Message history** — keyset pagination on `sequence_no` (`beforeSeq`, `size`).
- **Read state** — monotonic per-participant read cursor, clamped to
  `last_message_seq`; aggregate `unread-count` endpoint excludes messages sent by
  the viewer's own personal *or* controlled business identities.
- **Message requests** — GENERAL conversations become `REQUESTED` instead of
  `ACCEPTED` when recipient privacy requires it; recipient can accept (→ ACCEPTED)
  or decline (→ request `DECLINED`, conversation hidden).
- **Archive / mute** — per-participant `archived_at`, `muted_until`.
- **Delete own message** — soft-delete restricted to the original sender.
- **Business actors** — conversations and sends can act as a business account;
  `participant_*_id` stores the acting member, `participant_*_business_account_id`
  the business identity. Membership + account `ACTIVE` status re-validated on
  every operation.
- **Context conversations** — `GENERAL`, `PROPERTY_LISTING`, `VEHICLE_LISTING`,
  `BUSINESS_PROFILE`, `EVENT`, `JOB_LISTING`, `SPARE_BAG_CONTACT`,
  `SERVICE_REQUEST`, `COMMUNITY_HELP_POST`. Contextual conversations start
  `ACCEPTED` after context authorization; `COMMUNITY_HELP_POST` validates the post
  via the new `FeedApi.helpStatus` lookup; unsupported/missing resources produce
  clean 4xx errors (context FK + trigger validation also enforced at DB level).

### Mobile (Expo / React Native)

- **Messages tab** replaced with a real inbox: conversation list, unread badges,
  preview + relative timestamps, incoming message-request cards with
  accept/decline, pull-to-refresh, cursor pagination, loading/empty/error states,
  archive + mute row actions.
- **Thread screen** — inverted message list, own/other bubbles (business identity
  shown when applicable), cursor pagination of older messages, composer with
  optimistic send → sent/failed states, tap-to-retry reusing the same
  `clientMessageId`, automatic read marking, pending-request banner
  (outgoing: waiting state; incoming: accept/decline), back navigation.
- New feature module `src/features/messaging/` with `types/`, `services/`
  (API client wrappers), `hooks/` (`useConversations`, `useThread`), `screens/`,
  consistent with existing feed/social feature structure and theme system.

## 2. Backend endpoints

All under `/api/v1`, authenticated via existing `DiasporumUserPrincipal`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/conversations` | Create or retrieve eligible conversation |
| GET | `/conversations` | List inbox (cursor, size, includeArchived) |
| GET | `/conversations/unread-count` | Aggregate unread count |
| GET | `/conversations/{id}` | Conversation detail + participants |
| POST | `/conversations/{id}/read` | Mark read up to `lastReadSeq` |
| POST | `/conversations/{id}/archive` | Archive for viewer |
| DELETE | `/conversations/{id}/archive` | Unarchive |
| POST | `/conversations/{id}/mute` | Mute (duration or until) |
| DELETE | `/conversations/{id}/mute` | Unmute |
| GET | `/conversations/{id}/messages` | Message history (`beforeSeq`, `size`) |
| POST | `/conversations/{id}/messages` | Send text message (`body`, `clientMessageId`, `replyToMessageId`) |
| DELETE | `/conversations/{id}/messages/{messageId}` | Delete own message |
| GET | `/message-requests` | Incoming pending requests |
| POST | `/message-requests/{id}/accept` | Accept → conversation ACCEPTED |
| POST | `/message-requests/{id}/decline` | Decline |

### Cross-module surfaces added

- `messaging/MessagingApi` — public boundary for other modules.
- `businessaccounts/BusinessAccountsApi` (new) — `isActiveMember`,
  `activeAccountIdsOf`, `representativeUserId`, account summaries; used by
  messaging instead of touching business internals.
- `feed/FeedApi.helpStatus(...)` (additive) — help-post existence/status for
  `COMMUNITY_HELP_POST` context validation.

## 3. Database changes

**None.** All messaging tables (`direct_conversations`,
`direct_conversation_participants`, `direct_messages`, `direct_message_media`,
`message_requests`) and their triggers — canonical participant ordering, context
validation, sequence allocation, preview maintenance, business-member sender
validation — already existed in `V1__baseline_v10_12.sql` and are relied upon.
No new Flyway migration was required; the implementation was verified against the
V1–V3 migration chain via Testcontainers PostgreSQL on every test run.

## 4. Authorization and privacy rules enforced

- Participant membership checked on every endpoint (personal identity
  `users.id` vs business side resolved distinctly).
- Actor must be `ACTIVE`; suspended/deleted users rejected.
- Business sends/mutations require current accepted, non-revoked membership in an
  `ACTIVE` business account — re-checked live per request (revocation takes
  effect immediately, verified by test).
- Recipient `user_privacy_settings.dm_permission` evaluated for GENERAL
  conversations: `NONE` → rejected; `MUTUAL_FOLLOWERS` → requires mutual follow;
  `COMMUNITY_MEMBERS` → shared community; `INTERACTED_USERS` → mutual follow or
  prior accepted conversation; `EVERYONE` → allowed. One-way follows never
  implicitly grant access (per v10.12).
- `allow_message_requests=false` + ineligible sender → rejected; eligible
  but not auto-accepted → `REQUESTED` request conversation.
- `user_blocks` in either direction override everything — re-evaluated on
  conversation creation *and* every message send.
- `user_mutes` with scope `DIRECT_MESSAGES`/`ALL` (active window) block
  conversation creation and sending — moderation hook is enforced.
- Accept/decline restricted to the intended recipient side.
- Unread counts exclude the viewer's own sends (personal and business).
- Message deletion restricted to the original sender.
- Client-supplied participant/business IDs are never trusted — endpoints resolve
  authority from the authenticated principal.

### Per-context authorization matrix (verified against app + DB layers)

| Context | Resource existence/status | Owner bound to participant | Actor visibility | Privacy/blocks | Where enforced |
|---|---|---|---|---|---|
| `GENERAL` | n/a | n/a | n/a | `dm_permission`, requests, blocks, mutes | App |
| `COMMUNITY_HELP_POST` | Exists, `PUBLISHED`, `OPEN` | Counterparty = post author, derived server-side | `feed.canView` | Blocks, mutes | App + DB trigger |
| `PROPERTY_LISTING` | Exists, `PUBLISHED` | Owner user/business must be a participant | — | Blocks, mutes | DB trigger |
| `VEHICLE_LISTING` | Exists, `PUBLISHED` | Owner must be a participant | — | Blocks, mutes | DB trigger |
| `BUSINESS_PROFILE` | Exists, `PUBLISHED`, not deleted | Owner must be a participant | — | Blocks, mutes | DB trigger |
| `EVENT` | Exists, `PUBLISHED` | Organizer must be a participant | — | Blocks, mutes | DB trigger |
| `JOB_LISTING` | Exists, `PUBLISHED` | Employer must be a participant | — | Blocks, mutes | DB trigger |
| `SPARE_BAG_CONTACT` | Contact request exists | Both participants must match the contact-request pair | — | Blocks, mutes | DB trigger |
| `SERVICE_REQUEST` | `OPEN`/`PAUSED` | Customer + provider identities verified against active chat-enabled lead access | — | Blocks, mutes | DB trigger |

Complete authorization for all nine context types. Two soft gaps remain for M2:
the app layer does not pre-check actor *visibility* of listing/event/job/business
resources before insert (violations surface as a 400 `CONVERSATION_REJECTED`
from the trigger rather than a structured 403), and resource-owner recipients in
context conversations are reachable regardless of their `dm_permission` — that
is the intended v10.12 contextual-contact model (privacy governs GENERAL only),
but should be confirmed per module milestone.

### Abuse protection — current state and outstanding requirements

Enforced now: blocks on create+send, DM-scope moderation mutes, request
conversations accept only the requester's initial message, declined
conversations are permanently non-sendable (the unique pair key makes decline
final — a strong anti-harassment posture), idempotent `client_message_id`
dedupes retries, body length cap (`MAX_BODY`), and canonical pair uniqueness.

Outstanding for M2 (no rate limiting exists in M1):
- Rate limit conversation creation and message sends (per-actor and
  per-conversation token buckets).
- Re-request cooldown/quota after `DECLINED` — decline currently permanently
  locks the pair; policy should decide permanent block vs windowed retry.
- Daily cap on *new* conversations opened toward distinct recipients (spam
  vector: mass conversation creation is unthrottled).
- Request-spam limits — a user can open unlimited `REQUESTED` conversations.
- Structured 403 mapping for trigger-level context rejections.

## 5. Tests executed and results

### Backend — `./mvnw test` (Testcontainers PostgreSQL) — final run

- **Full suite: 174/174 tests pass — BUILD SUCCESS.**
- `MessagingModuleIntegrationTest` — **22/22 pass**: request/accept/decline
  lifecycle, uniqueness/reuse, privacy matrix, disabled requests, blocks,
  business acting side + revoked member, non-member rejection, help-post
  context, pagination, unread/read cursors, idempotent resend, archive/mute,
  delete-own, HTTP surface.
- `ModuleBoundaryTest` (ArchUnit) — **26/26 pass**, no module-boundary violations.
- Identity, business accounts, feed, social, taxonomy, security suites — all pass.

### Mobile — `npx jest`, `tsc`, `expo lint` — final run

- Full mobile suite — **111/111 pass**, 11 suites, no regressions (one
  intermittent timing flake in `messaging-ui` observed once during parallel
  suite execution; green on isolated and full reruns).
- `npx tsc --noEmit` — **clean**.
- `npx expo lint` — **0 problems in new messaging code**; 11 errors + 10 warnings
  remain, all pre-existing in unrelated files (`community-drawer.tsx`
  `react-hooks/refs` errors, `provider-signin.ts` require-import warnings, etc.).

### Identity test investigation — root causes and resolutions

All 13 previously-failing tests were stale relative to *deliberate* production
behavior in the initial commit — none were caused by the messaging diff, and
none required production changes:

- `AuthFlowIntegrationTest.registerVerifyLoginFullFlow` — production
  `AuthService.register` intentionally activates immediately ("Email
  verification deferred — accounts activate immediately"); the `verify()`
  helper was already updated for this but two status assertions were missed.
  Updated to assert `ACTIVE` at registration.
- `ExternalIdentityIntegrationTest.googleVerifiedEmailMatchingPendingAccount
  LinksAndActivates` — the pending-account link-and-activate path still exists
  in `ExternalIdentityService`; the test now *simulates* a legacy pending
  account via SQL (`SET account_status='PENDING_VERIFICATION'`) since
  registration no longer produces one, preserving the real coverage.
- `IdentityApiAndSettingsTest.httpEndpointsServeOwnSettingsOnly` — used the
  2-arg `UsernamePasswordAuthenticationToken`, which creates an
  *unauthenticated* token → 403. Switched to the 3-arg form `(principal, null,
  List.of())` used by every other MockMvc suite.
- `ProfileManagementIntegrationTest.setup` (×10) — `DELETE FROM countries`
  collided with `TaxonomyStartupSeeder`'s 55 dev communities
  (`communities.destination_country_id` FK). Replaced with `INSERT …
  ON CONFLICT (iso2) DO NOTHING` using non-assigned iso2 `ZZ`; the
  `countriesEndpointListsActiveOnly` test was also updated to assert
  active-filtering behavior (insert an inactive country, assert exclusion)
  rather than an exact count that assumed an empty table.
- Delivery is server-confirmed only — no push notifications, realtime (Ably),
  or presence (out of scope for M1).
- Media attachments table exists but is unused (text-only milestone).
- Trigger-level context rejections surface as `400 CONVERSATION_REJECTED` with
  the DB message rather than a structured 403 (see §4 matrix).
- Decline is permanent for the conversation pair — no re-request cooldown
  window yet (see §4 abuse-protection notes).
- No rate limiting on conversation creation, sends, or request volume (see §4).

## 7. Remaining work for M2+

- Realtime delivery (Ably wiring to `outbox_events`), push notifications.
- Media attachments (`direct_message_media`), message editing UI (`edited_at`
  already surfaced), reactions.
- Community General Chat, Voice Rooms/LiveKit (explicitly out of scope).
- Rate limiting and spam controls itemised in §4; re-request
  cooldown/decline-window policy.
- Actor-visibility pre-checks for listing/event/job/business context resources.
- Messaging observability (metrics on send latency, request accept rates).
