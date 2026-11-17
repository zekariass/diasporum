# Spare Bag v10.15 Redesign: Service Layer Implementation Report

Scope: **backend only** (`diasporum-backend`). `diasporum-mobile` is unchanged.

**What this adds.** V31 §7 created the new tables: traveller profiles, journeys, sender requests, items, media and per-country config. V32 seeded the measurement units. Until now no Java code used any of them. This change adds the full service layer for that model.

**What it leaves alone.** The legacy listing model is untouched: its tables, rows, `/api/v1/spare-bag/listings*` and `/contact-requests*` endpoints, services, `SpareBagExpiryWorker` and `SpareBagModuleIntegrationTest`.

## 1. Old and new models coexist

| | Legacy (unchanged) | v10.15 (new) |
|---|---|---|
| Tables | `spare_bag_listings`, `_listing_categories`, `_listing_media`, `_listing_saves`, `spare_bag_contact_requests` | `spare_bag_traveller_profiles`, `_traveller_journeys`, `_sender_requests`, `_sender_items`, `_sender_request_media`, `_country_config`, plus `spare_bag_match_requests` (V39) |
| REST | `/api/v1/spare-bag/listings*`, `/contact-requests*`, `/airports`, `/categories` | `/api/v1/spare-bag/v2/**`, `/api/v1/admin/spare-bag/**` |
| Worker | `SpareBagExpiryWorker` | `SpareBagPostingExpiryWorker` |
| Code | `sparebag/internal/{application,infrastructure/persistence}` | `sparebag/internal/application/v2`, `sparebag/internal/infrastructure/persistence/v2` |

- **No data is migrated.** V31 defers moving old rows into the new tables to a separate reviewed migration, so none was written here.
- The mobile app keeps working against the legacy API.
- The new endpoints sit under `/api/v1/spare-bag/**`, so the existing community `SPARE_BAG` module interceptor gates them in the same way as the legacy ones.

## 2. Findings that changed the brief

1. **Moderation content types.** The `moderation_queue` CHECK accepts `SPARE_BAG_SENDER_REQUEST` and `SPARE_BAG_TRAVELLER_JOURNEY`. The names `SPARE_BAG_REQUEST` and `SPARE_BAG_JOURNEY` exist only in the design doc. The CHECK names are the ones used.
2. **There is no moderation contract.**
   - No Java code reads or writes `moderation_queue`, and `ModerationApi` only handles reports.
   - This implementation follows the shop's gating precedent: a `moderation-mode` property, guarded `PENDING_REVIEW` UPDATEs, admin endpoints owned by the module, and `moderation_actions` plus `audit_logs` rows.
   - It also writes submissions to `moderation_queue` and resolves them there, so a future moderation console has data to work from.
3. **The new tables have no REJECTED status.** A moderator rejection returns the posting to DRAFT so the owner can edit and resubmit (this was the user's decision). The reason is kept in `moderation_actions` and the queue row, and the owner is notified. A separate admin **REMOVE** action sets REMOVED for takedowns.
4. **Messaging.**
   - `MessagingService.CONTEXT_TYPES` did not include `SPARE_BAG_SENDER_REQUEST`. The DB trigger also has no validation branch for it.
   - Adding it to the REST-reachable set would have let any user open an ACCEPTED thread with anyone by passing an invented context id.
   - It is therefore a **module-API-only** context type. `ensureContextConversation` accepts it; REST `POST /api/v1/conversations` still returns `INVALID_CONTEXT_TYPE`, and a test covers that.
5. **Media.** `MediaService.ALLOWED` did not include `SPARE_BAG_SENDER`, although the DB CHECK allows it. It has been added for image/jpeg, png and webp, the same as `SPARE_BAG_LISTING`.
6. **Visibility rule.** The §6.6 "home country" case needs no extra code. A home-country community (origin = destination = X) has destination X, so the main rule already matches every posting to or from X. A test covers it.
7. **Schema gaps the code works around.**
   - Journeys have no `owner_user_id`; ownership goes through `traveller_profile_id → user_id`.
   - The new tables have no `updated_at` triggers, so the services set `updated_at` themselves.
   - No `spare_bag_country_config` rows are seeded. A country with no row gets the column defaults: enabled, item disclosure required, nothing prohibited.

## 3. Decisions

- **Contact/matching uses a new table, `spare_bag_match_requests` (V39), rather than reusing `spare_bag_contact_requests`.**
  - The legacy table has `sender_listing_id` and `passenger_listing_id` NOT NULL.
  - Its BEFORE trigger `validate_spare_bag_contact_request` enforces legacy-listing rules on every write: airports, a SENDER_REQUEST/PASSENGER_OFFER pair, and overlapping dates.
  - The `SPARE_BAG_CONTACT` direct-conversation trigger checks participants against the legacy listings.
  - Reusing the table would have meant relaxing NOT NULLs and rewriting two V1 trigger functions on a path the mobile app uses live. A new table carries no risk to the legacy flow.
  - Its statuses copy the existing `spare_bag_contact_status` values, so no new vocabulary was introduced.
- **Expiry uses a parallel worker.** The legacy worker is `@Transactional` around the legacy updates, so extending it would tie the two models' failures together.
- **Traveller verification is a trust badge, not a publishing gate** (user's decision). Search has a `verifiedOnly` filter.
- **`requires_item_disclosure`** means at least one item, with a `category_key` on every item, before review or publication (user's decision). Photos are optional.
- **Module APIs used.** `IdentityApi`, `CommunityApi` (for visibility), `MessagingApi`, `MediaApi` and `NotificationsApi`. The module also uses three APIs sparebag already depended on: `TaxonomyApi` (country is active), `SocialApi` (blocks, as in the legacy flow) and `ModerationApi.report` (report endpoints). No new module edges were added, and `ModuleBoundaryTest` passes.

## 4. Migration: V39 `V39__spare_bag_match_requests.sql`

This was the only schema gap. The migration only adds objects; it does not alter or drop any legacy object.

**Table `spare_bag_match_requests`:**
- `sender_request_id` → `spare_bag_sender_requests`, CASCADE
- `journey_id` → `spare_bag_traveller_journeys`, CASCADE
- `requested_by_user_id`, `responded_by_user_id`
- `direct_conversation_id` → `direct_conversations`, SET NULL
- `status` CHECK `PENDING | ACCEPTED | DECLINED | CANCELLED | EXPIRED | CLOSED`
- `message` and `response_note`, each at most 3000 characters
- `responded_at`, `created_at`, `updated_at`
- CHECK: ACCEPTED or DECLINED requires `responded_at`

**Indexes:**
- `ux_spare_bag_match_open_pair`: UNIQUE `(sender_request_id, journey_id)` WHERE PENDING or ACCEPTED
- `ux_spare_bag_match_accepted_request`: UNIQUE `(sender_request_id)` WHERE ACCEPTED. This guarantees one matched traveller per request at the DB level.
- `ix_..._journey`, `ix_..._requester`, `ix_..._conversation`, `ix_..._responded_by`

`AGENTS.md` and `db/migration/README.md` now list the migration range as V1–V39.

## 5. Endpoints

### Reference data (authenticated)
- `GET /api/v1/spare-bag/v2/measurement-units` returns the 8 V32 units.
- `GET /api/v1/spare-bag/v2/categories` returns the active categories.
- `GET /api/v1/spare-bag/v2/country-config/{countryId}` returns `enabled`, `requiresItemDisclosure`, `prohibitedCategories`, the public `legalNotice` and `configured`.

### Traveller profile
- `GET` / `PUT /api/v1/spare-bag/v2/me/traveller-profile` (PUT is an upsert)
- `POST .../me/traveller-profile/pause`, `activate`, `close`, `verification`
- `GET /api/v1/spare-bag/v2/travellers/{profileId}`

### "Traveller Journeys" tab
- `POST` / `GET /api/v1/spare-bag/v2/journeys`. GET accepts `fromCountryId`, `toCountryId`, `dateFrom`, `dateTo`, `category`, `verifiedOnly`, `cursor` and `size`.
- `GET`, `PUT`, `DELETE /journeys/{id}`. DELETE soft-deletes and works on DRAFT only.
- `POST /journeys/{id}/publish`, `pause`, `close`, `report`
- `GET /api/v1/spare-bag/v2/me/journeys?status=`

### "Items to Send" tab
- `POST` / `GET /api/v1/spare-bag/v2/sender-requests`. GET accepts `fromCountryId`, `toCountryId`, `category`, `cursor` and `size`.
- `GET`, `PUT`, `DELETE /sender-requests/{id}`. PUT replaces the items and media.
- `POST /sender-requests/{id}/publish`, `pause`, `close`, `reopen`, `report`
- `GET /sender-requests/{id}/media/{mediaId}/download-url`
- `GET /api/v1/spare-bag/v2/me/sender-requests?status=`

### Matching
- `POST` / `GET /api/v1/spare-bag/v2/match-requests`. GET accepts `direction=INCOMING|OUTGOING` and `status`.
- `GET /match-requests/{id}`
- `POST /match-requests/{id}/accept`, `decline`, `cancel`, `close`, `conversation`

### Admin (`/api/v1/admin/spare-bag`)
- `GET /moderation?type=SENDER_REQUEST|JOURNEY`: the PENDING_REVIEW queue. A COUNTRY-scoped moderator sees only their countries.
- `POST /sender-requests/{id}/moderation` and `POST /journeys/{id}/moderation`, with body `{action: APPROVE|REJECT|REMOVE, reason}`.
  - Allowed: GLOBAL `PLATFORM_ADMIN` or `PLATFORM_MODERATOR`, or a COUNTRY moderator for either end of the route. Anyone else gets `MODERATOR_REQUIRED`.
- `GET /traveller-verifications` and `POST /traveller-profiles/{id}/verification` with body `{decision: VERIFIED|REJECTED|REVOKED, reason}`. Platform admin only, using the same SQL as `TicketingAccess.requirePlatformAdmin`; anyone else gets `PLATFORM_ADMIN_REQUIRED`.
- `PUT /country-config/{countryId}`: platform admin only.

## 6. State machines (as implemented)

All transitions are guarded conditional UPDATEs; a lost race returns 409.

### Sender request and journey lifecycle

| From | To | Trigger |
|---|---|---|
| — | DRAFT | create. Country must be enabled and no category prohibited. |
| DRAFT | PENDING_REVIEW | publish in MANUAL mode (default). Inserts a `moderation_queue` row. |
| DRAFT | PUBLISHED | publish in AUTO_APPROVE mode (`application-local.yml`) |
| PENDING_REVIEW | PUBLISHED | admin APPROVE. Publish checks run again. |
| PENDING_REVIEW | DRAFT | admin REJECT. Reason required. |
| PUBLISHED | PAUSED | owner |
| PAUSED | PUBLISHED | owner. Already reviewed, so not reviewed again. |
| PUBLISHED / PAUSED | PENDING_REVIEW | owner edit in MANUAL mode. The edit goes back through review. |
| PUBLISHED | MATCHED | match accepted. Sender requests only; journeys have no MATCHED status. |
| MATCHED | PUBLISHED | owner `reopen`, only when no ACCEPTED match remains |
| DRAFT, PENDING_REVIEW, PUBLISHED, PAUSED (+ MATCHED for requests) | CLOSED | owner |
| PENDING_REVIEW, PUBLISHED, PAUSED | EXPIRED | worker |
| any except REMOVED | REMOVED | admin REMOVE. Reason required. Pending matches expire. |

**Checks at publish and approve:**
- Both countries must be active and enabled; otherwise `SPARE_BAG_COUNTRY_DISABLED`.
- No category may be prohibited; otherwise `PROHIBITED_CATEGORY`.
- Sender requests:
  - Disclosure must be complete when either country requires it (`ITEM_DISCLOSURE_REQUIRED`).
  - `closes_at` must be in the future. If it is unset, it defaults to now + 30 days (`request-default-ttl`).
- Journeys:
  - `travel_date >= CURRENT_DATE`; otherwise `JOURNEY_TRAVEL_DATE_PAST`.
  - The traveller profile must be ACTIVE.
  - Airports must be in their leg's country; otherwise `JOURNEY_AIRPORT_COUNTRY_MISMATCH`.

**Schema rules are not repeated in Java.** CHECK violations for pairs, quantities, prices, capacity and route-distinctness come back as 400 `SENDER_REQUEST_INVALID`, `SENDER_ITEM_INVALID` or `JOURNEY_INVALID`.

### Traveller profile
- `status`: ACTIVE ↔ PAUSED (owner). ACTIVE or PAUSED → CLOSED (owner); closing also closes the profile's open journeys.
- `verification_status`:
  - NOT_VERIFIED, REJECTED or REVOKED → PENDING when the owner submits.
  - PENDING → VERIFIED.
  - PENDING → REJECTED, reason required.
  - VERIFIED → REVOKED, reason required.
  - Decisions are platform-admin only, and an admin cannot verify their own profile.
  - Each decision writes `moderation_actions`, `audit_logs` and a notification.

### Match request
- PENDING → ACCEPTED or DECLINED (by the responder).
- PENDING → CANCELLED (by the requester).
- PENDING → EXPIRED (by the worker, or when the request is matched or removed).
- ACCEPTED → CLOSED (by either participant).

**Create** checks, in order:
- The actor must own exactly one side.
- The counterpart must be visible under §6.6; otherwise 404.
- Both postings must be listed; otherwise `POSTING_NOT_AVAILABLE`.
- The countries must match; otherwise `ROUTE_MISMATCH`.
- The journey's `accepted_categories` must cover the request's item categories; otherwise `CATEGORY_NOT_ACCEPTED`.
- The users must not have blocked each other; otherwise `BLOCKED`.
- Idempotency uses `idempotency_keys` plus an advisory lock, the same pattern as the legacy contacts.

**Accept** runs in one transaction:
- The match moves to ACCEPTED.
- The request moves PUBLISHED → MATCHED.
- It calls `MessagingApi.ensureContextConversation(actor, null, "SPARE_BAG_SENDER_REQUEST", senderRequestId, requester, null)` and links the conversation.
- Competing PENDING matches move to EXPIRED.
- The requester and the expired requesters are notified.

### Visibility (§6.6)
- `SpareBagVisibility.visibleCountries(viewer)` takes `CommunityApi.membershipsOf(viewer)`, resolves each through `CommunityApi.context(...)`, and collects the `destinationCountryId`s. Memberships that can't be resolved are skipped, the same way `myAccess` does it. The module runs no profile or community SQL of its own.
- **Search** returns PUBLISHED, open postings whose `from_country_id` or `to_country_id` is in that set.
  - Journeys must also have an ACTIVE traveller and a travel date that hasn't passed.
  - Blocked owners are removed.
- **Detail** is visible to:
  - the owner;
  - a moderator for the route;
  - the counterpart of a live or closed match, so a MATCHED request stays readable;
  - anyone the rule admits while the posting is listed.

  Everyone else gets 404.

### Expiry worker (`SpareBagPostingExpiryWorker`)
- Schedule: `diasporum.spare-bag.v2.expiry-interval`, default PT15M.
- Four steps, each a single guarded UPDATE in its own transaction:
  1. Journeys past `closes_at` or their last travel date → EXPIRED.
  2. Requests past `closes_at` → EXPIRED. MATCHED requests are never expired.
  3. Stale PENDING matches → EXPIRED.
  4. Open queue rows whose content is no longer PENDING_REVIEW → AUTO_RESOLVED.
- Notifications use dedupe keys, so repeated or concurrent runs neither change a row twice nor notify twice.

### Notifications
These reuse existing `notification_type` values, so no enum migration was needed:
- `SPARE_BAG_CONTACT_REQUEST` for match events;
- `SPARE_BAG_LISTING_UPDATE` for moderation, verification and expiry.

## 7. Files

**Created (main)**
- `src/main/resources/db/migration/V39__spare_bag_match_requests.sql`
- `sparebag/internal/domain/SpareBagV2Types.java`
- `sparebag/internal/infrastructure/persistence/v2/`:
  - `SqlSupport`
  - `SpareBagReferenceRepository`
  - `TravellerProfileRepository`
  - `JourneyRepository`
  - `SenderRequestRepository`
  - `MatchRequestRepository`
  - `SpareBagModerationRepository`
- `sparebag/internal/application/v2/`:
  - `SpareBagV2Properties`
  - `SpareBagV2Support`
  - `SpareBagReferenceService`
  - `SpareBagVisibility`
  - `SpareBagModeration`
  - `SpareBagOwners`
  - `TravellerProfileService`
  - `TravellerJourneyService`
  - `SenderRequestService`
  - `SpareBagMatchService`
  - `SpareBagPostingExpiryWorker`
- `sparebag/internal/api/rest/SpareBagV2Controller.java`, `SpareBagV2AdminController.java`

**Created (test)**
- `src/test/java/com/diasporum/backend/sparebag/SpareBagRedesignIntegrationTest.java` (8 tests)

**Modified**
- `messaging/internal/application/MessagingService.java`: adds `MODULE_CONTEXT_TYPES`; `createConversation` delegates with a `moduleCall` flag.
- `messaging/package-info.java`: doc update.
- `media/internal/application/MediaService.java`: adds the `SPARE_BAG_SENDER` purpose.
- `application.yaml`: new `diasporum.spare-bag.v2` block (`moderation-mode`, `request-default-ttl`, `expiry-interval`, all with env overrides).
- `application-local.yml`: AUTO_APPROVE for local dev.
- `AGENTS.md`, `db/migration/README.md`: migration range updated to V39.

## 8. Verification

All runs were local, using Testcontainers `postgis/postgis:17-3.5`. V39 applied cleanly on every container.

**1. Targeted run**
`./mvnw -o test -Dtest=SpareBagRedesignIntegrationTest,SpareBagModuleIntegrationTest,ModuleBoundaryTest,MessagingModuleIntegrationTest,MediaModuleIntegrationTest,ServiceMarketplaceModuleIntegrationTest,BusinessDirectoryModuleIntegrationTest`
→ `Tests run: 107, Failures: 0, Errors: 0` and BUILD SUCCESS in 6:02 min.

| Class | Tests | Why included |
|---|---|---|
| `SpareBagRedesignIntegrationTest` (new) | 8 | the new model |
| `SpareBagModuleIntegrationTest` (legacy, unedited) | 15 | old endpoints, plus the V8→latest upgrade and V10 replay with V39 present |
| `ModuleBoundaryTest` | 27 | module boundaries and cycles |
| `MessagingModuleIntegrationTest` | 22 | the context-type change |
| `MediaModuleIntegrationTest` | 8 | the new media purpose |
| `ServiceMarketplaceModuleIntegrationTest` | 15 | moderation and admin-role precedent |
| `BusinessDirectoryModuleIntegrationTest` | 12 | moderation and admin-role precedent |

No dedicated moderation test class exists; those two classes cover moderation and admin roles.

The first run of the new class on its own failed 1 of 8 (`travellerVerificationAdminFlow`). The cause was the test's SQL: the journey approval also writes a `moderation_actions` row for the same user, so the lookup returned two rows. The query was narrowed to the verification row; no production code changed.

**2. Full `./mvnw -o test`**
→ `Tests run: 488, Failures: 0, Errors: 0, Skipped: 0` and BUILD SUCCESS in 17:57 min, across 48 classes.
- The previous green total was 479. The new class adds 8.
- `TicketingIntegrationTest` now has 15 tests instead of 14. That file changed outside this task and was not touched here.

**3. Not run**
Full `./mvnw verify` was not run (the brief made it optional). The test phase above already includes every test class.

**What the new tests cover**

| Requirement | Test |
|---|---|
| Sender-request lifecycle, including prohibited categories, CHECK errors surfaced as 400s, item disclosure, and MANUAL review (queue row, reject → DRAFT, resubmit, approve) | `senderRequestLifecycleModerationAndProhibitedCategories` |
| Journey publish date rule, re-checked on approve; airport/country mismatch; capacity CHECK | `journeyPublishRequiresFutureTravelDate` |
| Visibility from both route ends, the home-country community, outsiders and unaffiliated users | `visibilityFollowsCommunityDestinationBothDirections` |
| Match request → accept → linked `SPARE_BAG_SENDER_REQUEST` conversation; MATCHED; competing match expired; idempotency; REST spoofing guard; close and reopen | `matchAcceptLinksConversationAndMatchesRequest` |
| Country `is_enabled` gate on create and publish; public config and legal notice | `disabledCountryBlocksPosting` |
| Expiry worker: 4 concurrent runs each change a row once, a repeat run changes nothing, and no duplicate notifications | `expiryWorkerIsIdempotentUnderConcurrency` |
| Traveller verification admin flow (submit, reject, verify, revoke; admin-only; no self-verification; `verifiedOnly`) | `travellerVerificationAdminFlow` |
| Reference endpoints (8 units, 6 categories) and category validation over HTTP | `referenceDataEndpoints` |

## 9. Deferred

- **Data migration** of legacy listing and contact rows into the new tables. The schema defers this to a separate reviewed migration.
- **Billing quota for v2 publishing.** `SPARE_BAG_LISTING_PUBLISH` stays on the legacy flow.
- **Media for journeys and traveller profiles.** The schema has no junction tables for them.
- **Verification document upload.** There is no schema for it; admins review the profile.
- **Admin suspension of traveller profiles.** SUSPENDED is honoured: such profiles can't post and are hidden from search. But no code path sets it yet.
- **AI pre-screening** (the `ai_*` columns on `moderation_queue`) and moderation policy rules for Spare Bag.
- **DB trigger validation for `SPARE_BAG_SENDER_REQUEST` conversations.** The module-API-only gate enforces it for now.
- **Saving or bookmarking v2 postings.** There is no table for it.
- **Per-country `feature_flags`.** The country config table is the gate.
