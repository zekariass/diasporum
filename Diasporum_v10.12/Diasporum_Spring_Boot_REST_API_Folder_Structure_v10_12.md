# Diasporum Spring Boot REST API — Recommended Folder Structure (v10.12)

## Architecture decision

Build Diasporum as a **modular monolith**: one Spring Boot REST API, one primary PostgreSQL/PostGIS database, and feature-oriented Java packages with enforced module boundaries.

This is a REST API, not a server-rendered web application. Use REST controllers (`@RestController`) to expose HTTP endpoints and JSON/HATEOAS representations. Do not add server-side HTML view folders or Thymeleaf/JSP templates. Spring MVC may still provide the HTTP infrastructure used by Spring Boot REST controllers; that does not make this a server-rendered MVC application.

Replace `com.yourcompany.diasporum` with your organisation's actual Java package name.

## 1. Repository structure

```text
diasporum-api/
├── pom.xml
├── README.md
├── Dockerfile
├── compose.yaml
├── .env.example
├── .gitignore
├── docs/
│   ├── architecture/
│   │   ├── modular-monolith.md
│   │   ├── module-dependencies.md
│   │   └── decisions/
│   ├── api/
│   │   ├── authentication-and-authorisation.md
│   │   ├── error-format.md
│   │   └── pagination-filtering-sorting.md
│   └── operations/
│       ├── local-development.md
│       ├── deployment.md
│       └── database-backups.md
├── src/
│   ├── main/
│   │   ├── java/com/yourcompany/diasporum/
│   │   │   ├── DiasporumApplication.java
│   │   │   │
│   │   │   ├── identity/
│   │   │   ├── social/
│   │   │   ├── community/
│   │   │   ├── taxonomy/
│   │   │   ├── media/
│   │   │   ├── feed/
│   │   │   ├── communitychat/
│   │   │   ├── messaging/
│   │   │   ├── voice/
│   │   │   ├── businessaccounts/
│   │   │   ├── businessdirectory/
│   │   │   ├── events/
│   │   │   ├── jobs/
│   │   │   ├── propertylistings/
│   │   │   ├── vehiclelistings/
│   │   │   ├── sparebag/
│   │   │   ├── matchmaking/
│   │   │   ├── servicemarketplace/
│   │   │   ├── billing/
│   │   │   ├── notifications/
│   │   │   ├── moderation/
│   │   │   ├── administration/
│   │   │   ├── appconfiguration/
│   │   │   ├── security/
│   │   │   └── platform/
│   │   │
│   │   └── resources/
│   │       ├── application.yml
│   │       ├── application-local.yml
│   │       ├── application-test.yml
│   │       └── db/
│   │           └── migration/
│   │               └── README.md
│   │
│   └── test/
│       ├── java/com/yourcompany/diasporum/
│       │   ├── architecture/
│       │   ├── identity/
│       │   ├── messaging/
│       │   ├── matchmaking/
│       │   ├── servicemarketplace/
│       │   ├── voice/
│       │   └── integration/
│       └── resources/
│           ├── application-test.yml
│           └── fixtures/
└── .github/
    └── workflows/
        └── ci.yml
```

The `db/migration/` directory is the shared Flyway migration location. The v10.12 SQL files supplied with this package are clean-install baselines, not a versioned migration to run on top of an existing v10.8 or earlier v10.9 database. For an already-populated deployment, first inventory actual schema/data state and create a separately reviewed, tested backfill/migration. Do not treat the illustrative `README.md` as a migration.

## 2. Standard structure inside a feature module

Use a consistent structure inside each feature module. Create only the folders that a module actually needs; do not add empty folders just to satisfy a template.

Example: `servicemarketplace/`

```text
servicemarketplace/
├── ServiceMarketplaceApi.java          # Public API for other modules
├── ServiceRequestPublished.java         # Published module event, if needed
├── ServiceLeadAccessGranted.java        # Published module event, if needed
├── package-info.java                    # Module documentation / Modulith metadata
└── internal/
    ├── api/
    │   └── rest/
    │       ├── ServiceRequestController.java
    │       ├── ServiceProviderController.java
    │       ├── ServiceResponseController.java
    │       ├── ServiceLeadAccessController.java
    │       ├── ServiceReviewController.java
    │       ├── ServiceReportController.java
    │       ├── request/
    │       ├── response/
    │       └── assembler/
    │
    ├── application/
    │   ├── command/
    │   ├── query/
    │   ├── service/
    │   └── port/
    │
    ├── domain/
    │   ├── model/
    │   ├── valueobject/
    │   ├── policy/
    │   ├── event/
    │   └── exception/
    │
    ├── infrastructure/
    │   ├── persistence/
    │   │   ├── entity/
    │   │   ├── repository/
    │   │   └── mapper/
    │   └── integration/
    │       ├── billing/
    │       ├── messaging/
    │       ├── media/
    │       └── notifications/
    │
    └── config/
```

### Layer responsibilities

| Package | Responsibility |
|---|---|
| `api.rest` | REST endpoints, HTTP status codes, request validation, API DTOs and response links. No business rules or database queries directly in controllers. |
| `application` | Executes use cases, coordinates domain logic, calls module APIs/ports and defines transaction boundaries. |
| `domain` | Business rules, domain models, value objects, policies and domain-specific exceptions. Keep it independent of web controllers and Spring Data repositories where practical. |
| `infrastructure.persistence` | JPA entities, Spring Data repositories, database queries and persistence mapping. |
| `infrastructure.integration` | Adapters for other modules and external systems. |
| `config` | Feature-specific Spring configuration, only where required. |
| Module root | Narrow public interfaces and events that other modules are allowed to use. Internal implementation remains under `internal`. |

For a simpler module, it is acceptable to start with `api/rest`, `application`, `domain` and `infrastructure` without further subdivision. Split packages only when their size or responsibilities justify it.

## 3. Diasporum module ownership

| Module package | Owns |
|---|---|
| `identity` | Account identity (`users`), optional profile extension (`profiles`), primary email, local credentials, Google/Apple external identity mappings, account lifecycle, sessions, refresh-token rotation, verification and recovery. Spring Boot is the authentication authority. |
| `social` | Follow relationships, friend requests, friendships, blocks and mutes. |
| `community` | Communities, memberships and community-level settings. |
| `taxonomy` | Countries, languages, interests and shared catalogues. |
| `media` | Media metadata, upload state, media access grants and processing lifecycle. |
| `feed` | Posts, Reels, post media, comments, reactions, polls and post-related behaviour. The Reels subdomain owns Community/Nearby/Following feed selection and ranking; it reuses feed posts and engagement. The Community Help subdomain owns structured REQUEST/OFFER posts and their lifecycle, reusing the same feed post, taxonomy, moderation and messaging infrastructure. |
| `communitychat` | Community chat rooms, room messages, mentions and per-user room state. |
| `messaging` | Direct conversations, context-specific threads, participant identities, message requests, direct messages and direct-message media. |
| `voice` | Voice rooms, sessions, participants, seats, speaker requests, invites, moderation and session-temporary comments. |
| `businessaccounts` | Business accounts, membership, scoped business roles and fixed Java role-policy rules to act for a business. No database-driven permission matrix. |
| `businessdirectory` | Public business listings, branch locations, opening hours, directory reviews and saves. |
| `events` | Events, RSVPs, event media and event-related lifecycle. |
| `jobs` | Job listings, listing categories, applications and job-specific lifecycle. |
| `propertylistings` | Property listings, amenities, media, contact permissions and property search. |
| `vehiclelistings` | Vehicle listings, core specifications, JSONB additional attributes, media and vehicle search. |
| `sparebag` | Spare Bag listings, categories, media and contact requests. |
| `matchmaking` | Matchmaking profiles, preferences, swipes, matches, unmatch behaviour and match lifecycle. |
| `servicemarketplace` | Service categories, provider profiles, service requests, responses/quotes, paid lead access, reviews, reports and moderation records. |
| `billing` | Plans, features, entitlements, usage records, configured quotas/reset periods and payment-related workflows. |
| `notifications` | In-app notifications, notification preferences, device tokens and delivery orchestration. |
| `moderation` | Platform-wide reports, moderation workflows and audit records. Feature-specific moderation rules can remain in their owning module. |
| `administration` | Admin-only use cases that orchestrate multiple modules. It should not own other modules' domain data. |
| `appconfiguration` | Runtime application settings and feature flags. |
| `security` | Spring Security configuration, Diasporum JWT signing/validation/JWKS, principal resolution to `users.id`, active-session (`sid`) validation, role-scope enforcement and request-level security integration. No runtime OIDC identity provider is required. |
| `platform` | Small technical capabilities such as transactional outbox support, idempotency infrastructure, correlation IDs and operational helpers. Do not put general business logic here. |

### `identity/` and `security/` (v10.12 first-party authentication)

```text
identity/
├── IdentityApi.java
├── internal/
│   ├── api/rest/
│   │   ├── RegistrationController.java
│   │   ├── AuthenticationController.java
│   │   ├── SocialAuthenticationController.java
│   │   └── AccountSecurityController.java
│   ├── application/
│   │   ├── RegistrationService.java
│   │   ├── AuthenticationService.java
│   │   ├── IdentityLinkingService.java
│   │   ├── SessionService.java
│   │   └── PasswordRecoveryService.java
│   ├── domain/
│   │   ├── model/
│   │   └── policy/
│   └── infrastructure/
│       ├── persistence/
│       └── provider/
│           ├── google/
│           ├── apple/
│           └── local/

security/
└── internal/
    ├── config/
    ├── jwt/                 # signing, validation, JWKS and key rotation
    ├── authentication/      # Spring Security principal and filters
    └── authorization/       # platform role scope and request integration
```

`users` is the account identity and owns the UUID/email/account status. `profiles` is a one-to-zero-or-one profile extension with the same UUID. Passwords are optional and stored in `user_credentials`; Google/Apple identities are stored in `external_identities` by `(issuer, subject)`. The backend verifies social ID tokens and issues its own access JWT plus rotating opaque refresh tokens. The provider email is used for account linking only under the verified-email assurance rules in the v10.12 system design; different normalized emails mean separate accounts.

Use Argon2id for password hashing, SHA-256 digests for high-entropy opaque refresh/reset/verification tokens, per-device `user_sessions`, refresh-token family replay detection, and `audit_logs` for security-sensitive events. Keep Apple refresh credentials encrypted in the provider credential vault only where provider-side revocation requires them.

Do not add a generic `roles`/`permissions` framework. `global_user_roles` stores platform roles and their global/country/community scope; `community_memberships` stores community roles; `business_account_members` stores business roles; voice participant roles remain session-scoped. Role capability checks live in fixed Java policy classes in the owning module.

## 4. Recommended internal shape for the main complex modules

### `messaging/`

```text
messaging/
├── MessagingApi.java
├── ConversationCreated.java
├── MessageSent.java
└── internal/
    ├── api/rest/
    │   ├── DirectConversationController.java
    │   ├── DirectMessageController.java
    │   ├── MessageRequestController.java
    │   ├── request/
    │   ├── response/
    │   └── assembler/
    ├── application/
    │   ├── CreateConversationService.java
    │   ├── SendMessageService.java
    │   ├── MessageRequestService.java
    │   ├── ConversationAccessService.java
    │   └── ConversationContextService.java
    ├── domain/
    │   ├── model/
    │   ├── policy/
    │   └── event/
    └── infrastructure/
        ├── persistence/
        └── realtime/
```

Conversation context values currently agreed for planning are `GENERAL`, `PROPERTY_LISTING`, `VEHICLE_LISTING`, `BUSINESS_PROFILE`, `EVENT`, `JOB_LISTING`, `SPARE_BAG_CONTACT`, `SERVICE_REQUEST` and `COMMUNITY_HELP_POST`. Matchmaking uses `GENERAL`; a matched badge is derived from the matchmaking relationship. Context-specific enquiries should be separate conversations, while repeated entry into the same context reuses its conversation. Any context reference must be validated against its owning module. Do not make `USER_TO_BUSINESS` a context type: participant identity and conversation context are different concepts.

### `matchmaking/`

```text
matchmaking/
└── internal/
    ├── api/rest/
    ├── application/
    │   ├── RecordSwipeService.java
    │   ├── CreateMatchService.java
    │   └── UnmatchService.java
    ├── domain/
    │   ├── model/
    │   └── policy/
    └── infrastructure/persistence/
```

A mutual like creates the matchmaking match, creates a friendship through the public `social` module API, and ensures an accepted `GENERAL` conversation through `messaging`. A match should not write directly to another module's repositories. Preserve pre-existing friendships when unmatching; remove only a friendship that was created by that match. Ordinary conversation history should remain available unless a separate block or safety policy restricts it.

### `servicemarketplace/`

```text
servicemarketplace/
└── internal/
    ├── api/rest/
    ├── application/
    │   ├── PublishServiceRequestService.java
    │   ├── ProviderDiscoveryService.java
    │   ├── ServiceResponseService.java
    │   ├── ServiceLeadAccessService.java
    │   └── ServiceReviewService.java
    ├── domain/
    │   ├── model/
    │   └── policy/
    └── infrastructure/
        ├── persistence/
        └── integration/
```

Use PostGIS distance queries for provider discovery. Use the shared `billing` module for `SERVICE_JOB_POST` and `SERVICE_LEAD_ACCESS`; keep `SERVICE_QUOTE_SEND` reserved until deliberately configured. Granting chat access and later revealing contact details for the same provider/job must reuse the existing lead-access grant and billing usage record. This module is a lead-generation/contact marketplace: it does not own bookings, appointments, escrow or service payments.

### `voice/`

```text
voice/
└── internal/
    ├── api/rest/
    ├── application/
    │   ├── VoiceRoomLifecycleService.java
    │   ├── VoiceSessionService.java
    │   ├── VoiceParticipantService.java
    │   ├── VoiceModerationService.java
    │   └── VoiceRoomCommentService.java
    ├── domain/
    └── infrastructure/
        ├── persistence/
        ├── realtime/
        └── rtc/
```

Voice-room comments are stored against a specific session and are temporary. They survive only recoverable disconnections/grace periods and must be deleted when the session definitively ends or expires. Use a reliable cleanup mechanism and real-time event delivery; a database table alone does not deliver live comments.

## 5. REST API conventions

- Use `@RestController` and explicit REST resource paths under `/api/v1/...`.
- Keep request/response DTOs separate from JPA entities and domain models.
- Apply Bean Validation (`@Valid`) at the API boundary; enforce business rules in the application/domain layer.
- Use Spring HATEOAS for links where it fits the API response contract already adopted by Diasporum.
- Standardise error responses, pagination, filtering, sorting, API versioning and correlation IDs.
- Put global exception translation in a small shared REST/API support package only if it remains technical and does not depend on individual module internals.
- Keep file uploads, WebSocket/realtime endpoints and voice-provider callbacks as explicit adapters; they are not server-rendered pages.
- Do not create `templates/`, `views/`, Thymeleaf or JSP directories for this API project.

## 6. Cross-module dependency rules

1. A module may access another module only through its public API, published events or explicitly approved interface.
2. Do not import another module's `internal` packages, JPA entities or Spring Data repositories.
3. Each module owns its business tables and persistence implementation, even though all modules use one PostgreSQL database.
4. Use IDs and small public DTOs across module boundaries rather than sharing entity classes.
5. Use transactions for a single use case; use an outbox/retry strategy when a change must reliably trigger work in another module after commit.
6. Avoid cyclic dependencies. For example, `matchmaking` may call `social` and `messaging` public APIs, but those modules must not depend back on matchmaking internals.
7. Spring Boot owns first-party authentication and issues Diasporum JWTs. Google/Apple are identity-verification providers only. Modules enforce resource-level rules such as ownership, privacy, scoped membership and blocking; role capabilities live in fixed policies in the owning module.
8. Add architecture tests using Spring Modulith (or ArchUnit) to fail CI when module boundaries are violated.

## 7. Testing structure

Place tests under the same feature-oriented package layout:

```text
src/test/java/com/yourcompany/diasporum/
├── architecture/
│   └── ModuleBoundaryTests.java
├── identity/
├── messaging/
│   ├── ConversationContextTests.java
│   ├── MessagePrivacyTests.java
│   └── BusinessParticipantTests.java
├── matchmaking/
│   ├── MatchCreatedTests.java
│   └── UnmatchTests.java
├── servicemarketplace/
│   ├── ProviderDistanceTests.java
│   ├── LeadAccessIdempotencyTests.java
│   └── ServiceModerationTests.java
├── voice/
│   └── VoiceCommentCleanupTests.java
└── integration/
```

Use unit tests for domain rules, module integration tests for module APIs, and integration tests against PostgreSQL/PostGIS for database constraints and geospatial queries. Test the billing and lead-access operations for concurrency and retry safety.

## 8. Spatial support with PostGIS (carried forward in v10.9)

Use PostGIS geography for radius search and distance ordering. Put only reusable technical primitives under `platform/geospatial`; each feature owns its filtering policy and spatial repository.

```text
platform/
└── geospatial/
    ├── GeoPoint.java
    ├── DistanceUnit.java
    ├── DistanceCalculator.java
    └── config/
        └── PostgisConfiguration.java

identity/
└── internal/
    └── infrastructure/
        └── persistence/
            └── spatial/
                └── NearbyPeopleRepository.java

matchmaking/
└── internal/
    └── infrastructure/
        └── persistence/
            └── spatial/
                └── MatchmakingSpatialRepository.java

jobs/                    # analogous spatial repository for published physical jobs
propertylistings/        # analogous spatial repository for property discovery
vehiclelistings/         # analogous spatial repository for vehicle discovery
events/                  # venue distance filters
businessdirectory/       # branch-location distance filters
servicemarketplace/      # provider radius matching and request discovery
```

Prefer indexed predicates such as `ST_DWithin(geography, :origin, :radiusKm * 1000)` and sort with `ST_Distance`. Keep query origins parameterized. For people discovery, query only the separate `user_discovery_locations` table and enforce opt-in, visibility, blocks, and audience scope. For entity proximity, query `addresses.discovery_location`, never the exact `addresses.location` point. Do not return raw points in DTOs. For confidential property/vehicle/job addresses, use a suitably approximate discovery point rather than exposing distance from an exact private address. Validate query plans with `EXPLAIN (ANALYZE, BUFFERS)`.

## 9. Practical dependencies to consider

Keep dependencies purposeful. The project will likely use Spring Boot starters for REST, validation, Spring Security/OAuth2 resource server, Spring Data JPA, Flyway, PostgreSQL, PostGIS integration, Spring HATEOAS, Actuator and testing. Add Spring Modulith or ArchUnit for architecture verification. Use MapStruct only where explicit object mapping is helpful. Use the existing realtime and voice-provider integrations behind module-owned interfaces.

Choose versions that are compatible with the selected Spring Boot release and pin them through the Spring Boot dependency management/BOM. Do not add separate microservice infrastructure, Kafka or a distributed cache simply because the platform may grow; add them when the runtime requirements justify them.

## 10. Implementation order

1. Create the Spring Boot application, shared REST error conventions, first-party Spring Security/JWT authentication and Flyway baseline.
2. Establish module boundaries and architecture tests.
3. Implement identity, social, community and taxonomy APIs.
4. Implement media and feed, including baseline Reels playback and Community/Nearby/Following retrieval.
5. Implement messaging and business-account authorisation.
6. Implement listings, directory, jobs, events and Spare Bag.
7. Implement matchmaking against the messaging/social public APIs.
8. Implement billing primitives and then service marketplace lead access with idempotency.
9. Implement voice lifecycle, realtime delivery and temporary comment cleanup.
10. Add geospatial discovery APIs, privacy checks, query-plan tests, notification/outbox reliability, observability and deployment pipelines.

This is the recommended folder and module layout, not generated Java source code. Treat module names and boundaries as the starting architecture; implement and verify them incrementally.


## 11. v10.9-v10.11 product responsibilities carried forward; v10.12 authentication update

### `social/`

- Keep `user_follows` as the directional relationship source of truth; expose mutual connections through a repository/view over reciprocal follows.
- Remove the `friend_requests` and `friendships` service/table assumptions. Do not create follower edges as a side effect of a matchmaking match.
- Coordinate follow/block operations with transaction-safe policy checks. A block removes both follow directions and overrides discovery/messaging.
- Evaluate `dm_permission=MUTUAL_FOLLOWERS` separately from one-way follows. A follow is never an implicit DM grant.

### `communitychat/`

- Keep General Chat as one persistent `GENERAL` text room per community.
- Use the scoped user restriction repository to distinguish MUTE from BAN, and room-specific from community-wide CHAT restrictions.
- Validate moderators, active community membership, expiry, revocation and audit metadata on the server. Keep `notifications_muted_until` strictly as self-service notification preference.
- Test message inserts against database guards plus the full API read/join/history/send policy.

### `voice/`

- Treat `VoiceRoom` as persistent and `VoiceRoomSession` as a disposable live activity record. Room status does not expire automatically when session inactivity expires.
- Model the durable room owner separately from session HOST/MODERATOR/SPEAKER/LISTENER roles.
- Implement a heartbeat/reconciliation worker: detect disconnect, retain comments during default 30-minute recovery grace, resume the same session where appropriate, otherwise terminally end/expire it.
- On terminal session close, clear session comments and pending comment-created outbox events and publish `VOICE_ROOM_COMMENTS_CLEARED`; a later session gets a new session ID and no old comment history.
- Serialize joins, promotions, seat assignments, host transfer, and terminal close. Issue short-lived RTC provider credentials only after authorization and capacity checks.
- Ably provides presence/control/comment delivery; the selected RTC/SFU provider transports audio. Evaluate LiveKit and Cloudflare Realtime SFU before locking a provider. The mobile app is not the audio transport.

### `feed/`

- Treat polls as a lifecycle: create the feed post as DRAFT, create poll metadata/options, validate 2..max_options (default 10, cap 20), then publish.
- Implement result visibility and anonymous voter-identity filtering at the API DTO layer. Anonymous polls still have user-linked vote rows internally; do not describe them as cryptographically anonymous from the platform.
- Implement the explicit vote-change/withdraw contract, close-early operation and immutable option set after first vote.
- Featured placement is server-controlled. Validate each placement against `featured_placement_rules`, promotion products/entitlements/payment, content status, visibility, audience and moderation. Store one `featured_items` row per placement/campaign surface.

### `feed/reels/` (v10.10 Reels addition)

- Represent a Reel as `feed_posts.post_type='REEL'`; do not create a second post, comments, reactions or follows model.
- `ReelCommandService` creates a DRAFT post, attaches one creator-owned `FEED_VIDEO` via `feed_post_media`, waits for `media_objects.status=READY`, then publishes it. The database guards enforce the one-video publication contract.
- `ReelsFeedService` exposes three feed modes: `COMMUNITY` (eligible active-community/wider-audience Reels, newest first), `NEARBY` (eligible Reels ordered by viewer-to-creator current-address distance), and `FOLLOWING` (eligible Reels by creators followed by the viewer, newest first).
- Nearby queries join `profiles.current_address_id` to `addresses.location` for the viewer and Reel author, use PostGIS `ST_Distance` for ordering and an optional bounded `ST_DWithin` radius. Exclude users without a usable current address and enforce audience/active-account/block/moderation rules before returning results. Never return address fields, exact coordinates or numeric distance to the client.
- No `reel_details` table, per-Reel Nearby flag, filming-location metadata or extra Nearby opt-in is part of the initial design. Do not persist a duplicate video pointer outside `feed_post_media`.
- Reuse `feed_post_comments`, `feed_post_reactions`, `post_shares`, `user_content_views` and `analytics_events`. Record impressions and watch progress/completion through idempotent analytics events; do not treat every autoplay start as a qualified view.
- Candidate endpoints: `POST /api/v1/reels` (create draft), `POST /api/v1/reels/{id}/publish`, `GET /api/v1/reels/feed?mode=COMMUNITY|NEARBY|FOLLOWING&cursor=...&limit=...`, and `POST /api/v1/reels/{id}/view-events`. Reuse standard post endpoints for comments/reactions where practical.
- Load a small batch and preload the next video on mobile; use opaque cursor pagination. Define upload size/duration constraints, thumbnail/transcoding steps and authorized playback URL policy before production.

### `businessaccounts/`

- Provide centralized `BusinessAccountAuthorization` using fixed Java role policies in the `businessaccounts` module. Do not depend on a database role-permission matrix or SQL permission helper.
- Keep account lifecycle, membership invites, acceptance, expiry, revocation, role changes, ownership transfer and closure/recovery as explicit transactional use cases.
- Ensure active/suspended accounts remain owned at transaction commit, audit membership and lifecycle changes, and revoke all associated conversation/channel access on member revocation or account closure.
- Treat business profile/branch ownership as distinct from workspace account ownership and preserve the actual acting user for listings/events/jobs.
- Keep verification separate from payments and subscription status. Business subscriptions are account-level; seat/location maxima are concurrent caps.

### `notifications/`

- Create durable in-app notifications separately from provider delivery records.
- Use the transactional outbox to create idempotent push work after commit; honor `notification_preferences`, retry failures with backoff, inspect receipts and deactivate invalid device tokens.
- Expo Push is the preferred mobile starting candidate, with provider adapters so APNS/FCM may be configured only when required. Ably is realtime delivery, not mobile push delivery.

## 12. v10.10 Reels test gates and v10.11 Community Help test gates (carried forward)

Add integration tests for Reels publication/media readiness, address ownership and Nearby distance ranking, Community/Nearby/Following feed visibility, pagination and block filtering; directional/mutual follows, block races, match/follow separation, voice-room persistence/session expiry, comment purge and clear events, concurrent speaker capacity, chat restriction scopes, poll vote concurrency and close/reopen behavior, promotion-placement allow-listing, fixed business role-policy tests and owner transfer, account-close access revocation, push retries/receipts, Spare Bag country derivation and PostGIS query plans. Use Testcontainers or an equivalent disposable PostgreSQL/PostGIS service; H2 alone is not sufficient validation for PostGIS and PostgreSQL trigger/locking behavior.

Static schema checks and unit tests do not replace executing the strict clean-install script and API tests against the target PostgreSQL/PostGIS version.


## 13. v10.11 Community Help & Offers design (carried forward)

Community Help & Offers is a structured feed feature, not a separate marketplace or a second messaging system. It supports informal assistance, donations, language practice, newcomer support and volunteering. Paid professional services remain in `servicemarketplace`.

### Data model

- Extend `feed_posts.post_type` with `COMMUNITY_HELP`. Keep the post's author, country, community, visibility, title/body, media, comments, reactions, publication and moderation lifecycle on `feed_posts`.
- Extend `category_module` with `COMMUNITY_HELP`. Administrators create/activate country-specific `country_categories` rows and map them through `country_category_modules.module_key='COMMUNITY_HELP'`. `validate_feed_post_country_category()` chooses `COMMUNITY_HELP` for these posts and `FEED` for other feed post types.
- Add one table, `community_help_posts`, keyed by `post_id` (PK/FK to `feed_posts.id`). It stores `help_kind` (`REQUEST`/`OFFER`), `help_status` (`OPEN`, `PAUSED`, `RESOLVED`, `CLOSED`, `EXPIRED`), optional `expires_at`, database-managed terminal timestamps, and standard timestamps.
- Add `COMMUNITY_HELP_POST` to `direct_conversations.context_type`. `context_id` references the parent `feed_posts.id` through the existing checked polymorphic context mechanism. Context uniqueness reuses the existing pair/context key, so reopening the same pair's thread reuses it.
- Do not create a separate responses table, comments table, reaction table, notification table, location table or help-specific chat system.

### Lifecycle and integrity

Create the parent `feed_posts` record as `DRAFT`, insert its `community_help_posts` row with `help_status='OPEN'`, then publish through the usual moderation/publication flow. The database rejects a published `COMMUNITY_HELP` post without lifecycle metadata and rejects help metadata attached to a non-help post. `help_kind` and `post_id` are immutable.

`feed_posts.status` controls content publication/moderation; `community_help_posts.help_status` controls availability. The only non-terminal transitions are `OPEN` ↔ `PAUSED`, and `OPEN`/`PAUSED` → `RESOLVED`, `CLOSED` or `EXPIRED`. `RESOLVED`, `CLOSED` and `EXPIRED` are terminal. State timestamps are database-managed. A Spring Boot/Quartz scheduled task marks due rows as `EXPIRED`; rows with `expires_at IS NULL` do not auto-expire. New responses are allowed only for a published, non-deleted parent with `help_status='OPEN'`. Existing conversations remain subject to ordinary messaging authorization and can remain available after a help post closes so users can finish arrangements.

### Feed and permissions

- Community Help discovery queries return only `feed_posts.status='PUBLISHED'`, non-deleted `COMMUNITY_HELP` records whose `help_status='OPEN'` and whose expiry is absent or in the future.
- Use existing feed audience/community/country checks, block checks, moderation checks and account status rules. Category labels never broaden audience visibility.
- A help card can optionally appear in the main Feed using the same `feed_posts` row. If its help status is paused or terminal, show that state and disable new responses; the dedicated active Community Help discovery view excludes it.
- The post author can pause/reopen an open item, mark it resolved or close it. Only backend-authorized actors can change lifecycle state. Moderator hiding/removal continues to use `feed_posts.status` and moderation workflows.

### Contextual response conversations

A response opens or reuses a normal `direct_conversations` row with `context_type='COMMUNITY_HELP_POST'` and `context_id=feed_posts.id`. The author must be a conversation participant; the target post must be published and OPEN when a new contextual conversation is created. Existing uniqueness by participant pair/context prevents duplicate threads. Context-specific conversations do not use the GENERAL message-request acceptance workflow; the backend must enforce context-contact eligibility, audience visibility, blocks, privacy preferences, quotas and authorization on every relevant action. Notify the author through the existing notification/outbox infrastructure when a new response conversation is created; do not create a response-specific persistence table.

### API candidates

- `POST /api/v1/community-help` — create draft parent post and lifecycle row in one transaction.
- `POST /api/v1/community-help/{postId}/publish` — publish after category, audience, moderation and body validation.
- `GET /api/v1/community-help?kind=REQUEST|OFFER&categoryId=...&communityId=...&cursor=...&limit=...` — browse open, unexpired posts with normal visibility checks.
- `POST /api/v1/community-help/{postId}/respond` — create/reuse a contextual direct conversation, validating that the post is published and OPEN.
- `PATCH /api/v1/community-help/{postId}/status` — author-controlled pause, reopen, resolve or close within the allowed state machine. Expiry is performed by the scheduled job.

### Suggested package structure

```text
feed/
└── internal/
    ├── api/rest/
    │   ├── CommunityHelpController.java
    │   ├── request/
    │   └── response/
    ├── application/
    │   ├── CreateCommunityHelpPostService.java
    │   ├── PublishCommunityHelpPostService.java
    │   ├── BrowseCommunityHelpQueryService.java
    │   ├── RespondToCommunityHelpService.java
    │   └── UpdateCommunityHelpStatusService.java
    ├── domain/
    │   ├── CommunityHelpKind.java
    │   ├── CommunityHelpStatus.java
    │   └── CommunityHelpPolicy.java
    └── infrastructure/persistence/
        ├── CommunityHelpPostRepository.java
        └── CommunityHelpPostMapper.java
```

This subdomain stays inside `feed`, since it reuses feed posts and engagement. It calls the public messaging-module API to create/reuse the `COMMUNITY_HELP_POST` conversation; it must not directly write the `messaging` module's tables.

### Acceptance checks

1. DRAFT `COMMUNITY_HELP` can be assembled, but publishing without lifecycle metadata is rejected.
2. Only `REQUEST`/`OFFER` are accepted; new rows start OPEN and help kind cannot be mutated.
3. A help category must be active in the same country and mapped to `COMMUNITY_HELP`; other post types require `FEED` categories.
4. Test valid and invalid lifecycle transitions, database-managed timestamps, terminal-state immutability, optional expiry, scheduled expiration and active-feed filtering.
5. New contextual conversations only open for published OPEN items; verify author participation, unique pair/context reuse, block/privacy enforcement, notifications and preserved existing message history after closure.
6. Verify community visibility, country-wide visibility where permitted, moderation, deletion, reports and main-feed card behavior. No `community_help_responses` table should exist.

The v10.12 SQL is a clean-install baseline; v10.11 remains the historical product baseline. It has not been executed against a live PostgreSQL/PostGIS database in this environment; run clean install, catalog smoke tests and transaction/integration tests in staging before production.
