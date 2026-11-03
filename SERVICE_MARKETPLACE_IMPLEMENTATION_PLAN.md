# DIASPORUM Service Marketplace Implementation Plan

**Status:** Implementation complete; actual verification results are recorded in `SERVICE_MARKETPLACE_IMPLEMENTATION_REPORT.md`.  
**Target branch/worktree:** `feature/service-marketplace` in the dedicated Service Marketplace worktree.  
**Verified migration baseline:** `origin/main` and the worktree were at `f5d3e54` during inspection; migrations run from V1 through V12, with V12 the latest.  
**Scope:** Spring Boot backend, PostgreSQL/PostGIS, Expo/React Native mobile, and the minimum shared integrations required for a production-oriented lead-generation marketplace.

This plan follows the actual repository rather than historical implementation reports. No application code, migration, or test has been changed or run during planning.

---

## 1. Product requirements

### 1.1 Specification sources and current-state findings

The following v10.12 artifacts were reviewed as product and architecture sources:

- `Diasporum_Project_Context_v10_12.md`.
- `Diasporum_System_Design_v10_12.docx`, including §9 messaging, §12.4 Service Marketplace, API, schema, media, privacy, notification, billing, and testing sections.
- `Diasporum_PostgreSQL_Schema_v10_12.sql`.
- `Diasporum_Spring_Boot_REST_API_Folder_Structure_v10_12.md`.
- `Diasporum_v10_12_Smoke_Test.sql`.
- `Diasporum_v10_12_Reference_Data_Seeds.md`.
- `Diasporum_v10_12_Change_and_Audit_Report.md`.
- `Diasporum_v10_12_strict_clean_install.sql` and `README_v10_12.md` for baseline and installation context.

The system-design PDF is the viewing counterpart of the DOCX; the editable DOCX was used for text extraction and cross-checked against the SQL and Markdown specifications.

Repository findings that materially affect implementation:

1. The canonical Service Marketplace schema already exists in `V1__baseline_v10_12.sql`.
2. The backend `servicemarketplace` module contains only an empty public API and package placeholders.
3. No mobile Service Marketplace feature implementation exists.
4. Mobile navigation already contains a `services` feature entry, and `CreateSheet` already contains an unrouted `service-request` option.
5. The latest migration is V12. V13 is the next candidate only if `origin/main` still ends at V12 when implementation begins.
6. No approved Service Marketplace category seed catalogue exists in the v10.12 reference-data document or migrations.
7. The current media constraint and `MediaService` do not support a Service Marketplace attachment purpose.
8. The current `notification_type` enum has no service-specific label.
9. Messaging already supports `SERVICE_REQUEST` conversations, but current Java authorization checks participant membership without revalidating Service Marketplace lead access on every path. The database insert trigger alone does not close reuse/read/send bypasses.

### 1.2 Mandatory customer workflows

Customers must be able to:

- Browse active, translated service categories.
- Create a request as a DRAFT without a publishing charge.
- Select one category and provide title, description, country, approximate service-area coordinates, optional owned private address, optional budget range/currency, optional preferred date, optional expiry, and ordered image attachments.
- Publish a DRAFT through the configured `SERVICE_JOB_POST` entitlement.
- View and manage only their own requests through ownership-aware endpoints.
- Pause/resume an OPEN request, cancel an unfinished request, and close an OPEN or PAUSED request.
- Discover matching active providers for a request using category and PostGIS distance/radius matching.
- View provider responses and accept or decline a SENT response.
- Review a provider after a recorded interaction, without describing the review as proof of completed work.
- Report a request, provider, or review.
- Open the ordinary contextual conversation only when the corresponding provider/request lead grant has `chat_enabled=true` and is ACTIVE.
- See loading, empty, validation, entitlement, authorization, offline/network, and retry states on every relevant mobile workflow.

### 1.3 Mandatory provider workflows

A provider can be owned by exactly one personal user or one Business Account. Provider managers must be able to:

- Register one provider per personal owner or Business Account without a registration charge.
- Maintain display name, description, category mappings, one base location, editable `radius_km` from 1 through 300, and availability.
- Pause/resume/close their provider profile; SUSPENDED remains moderation-controlled and verification remains an administrative state, not a self-service claim.
- Discover OPEN, unexpired requests in their categories and coverage area, excluding requests owned by themselves or their Business Account members.
- Filter relevant requests by category, country, supported city rule, budget, preferred date, and distance.
- Sort requests deterministically by newest, price, or distance.
- Maintain one response per provider/request, with INTEREST and CONTACT in the baseline scope. QUOTE is conditional on the explicit approval recorded in §10.
- Withdraw a SENT response; the customer may accept or decline it.
- Acquire one idempotent `SERVICE_LEAD_ACCESS` grant per provider/request for chat and/or permitted contact details.
- Upgrade an ACTIVE grant from chat to contact details, or the reverse, without another charge.
- View their own responses and lead grants in a provider workspace.
- Respond to a customer review and use the existing conversation system after chat access is granted.

For Business Account providers, the proposed management roles are `OWNER`, `ADMINISTRATOR`, `EDITOR`, and `LISTING_MANAGER`, matching existing marketplace management policy. Every operation revalidates current account/membership state. `BILLING_MANAGER` alone does not gain provider representation rights.

### 1.4 Categories, addresses, coverage, and location

- `service_categories` and `service_category_translations` are the only category model.
- Categories are hierarchical, active/inactive, ordered, and translated through the existing languages catalogue.
- No category keys or translations will be invented. The initial approved catalogue is an approval gate in §10.
- A provider has exactly one `base_location` and one editable `radius_km`; no provider address table, coverage table, or multiple coverage areas will be introduced.
- Provider “service address management” therefore means maintaining the single base point, not creating a separate address book.
- A request stores an approximate/service-area point independently of its optional exact private address reference.
- An attached address must belong to the customer, match the request country, and remain excluded from discovery DTOs.
- Device coordinates used as public/approximate points will be reduced to the existing approximate-coordinate precision pattern. Manual general-area entry remains available when location permission is denied.
- Missing coordinates never imply global coverage.

### 1.5 Discovery, filtering, sorting, and pagination

Provider job discovery uses the selected provider’s base point and radius:

- Join the provider’s category mappings and require `status='OPEN'`, `deleted_at IS NULL`, and a future/null expiry.
- Use `ST_DWithin(sr.location, sp.base_location, effectiveRadiusMeters)` and `ST_Distance` in PostgreSQL, not application-side distance calculations.
- Default the effective radius to `sp.radius_km`; an optional smaller `maxDistanceKm` may further restrict it.
- Country/category/budget/date filters are applied in SQL.
- City filtering follows the default rule in §10 unless the schema alternative is approved.

Customer provider discovery uses the request point:

- Require request ownership for request-specific matching.
- Require ACTIVE providers mapped to the request category.
- Use each provider’s own radius with `ST_DWithin(sp.base_location, sr.location, sp.radius_km * 1000)`.
- Return distance in meters and never infer coverage when a point is absent.

Sorting and cursors:

- `NEWEST`: `published_at DESC, id DESC`.
- `DISTANCE`: `distance_meters ASC, id ASC`; distance sort requires a defined origin.
- `PRICE_ASC`/`PRICE_DESC`: sort by `COALESCE(budget_min,budget_max)`, use the other budget value as a secondary numeric key, and always place missing budgets last. Require an explicit `currencyCode` filter so raw amounts are never compared across currencies.
- All pages use `items` and `nextCursor`, with a server-enforced default/maximum page size.
- Cursor payloads contain the sort values and ID, a filter/sort fingerprint, and a version. Invalid, stale, or changed-filter cursors return `INVALID_CURSOR` rather than silently mixing pages.
- Distance cursor predicates repeat the PostGIS expression with the same origin and deterministic ID tie-breaker.

### 1.6 Lifecycle rules

Request transitions:

| Current | Allowed customer action | Next | Billing |
|---|---|---|---|
| DRAFT | Publish | OPEN | Consume `SERVICE_JOB_POST` once |
| DRAFT | Cancel/discard | CANCELLED | None |
| OPEN | Pause | PAUSED | None |
| PAUSED | Resume | OPEN | None; reuse original publishing consumption |
| OPEN or PAUSED | Close | CLOSED | None |
| OPEN or PAUSED | Cancel | CANCELLED | None |
| OPEN or PAUSED, past expiry | Expiry job/read reconciliation | EXPIRED | None |
| Any nonterminal request | Moderator removal | REMOVED | None |

- CANCELLED, CLOSED, EXPIRED, and REMOVED are terminal for ordinary users.
- DRAFT allows full editing. OPEN/PAUSED allows only safe descriptive, budget/date/expiry, and media edits; category, country, approximate point, and exact address become immutable after first publication to avoid changing the meaning of existing responses and grants.
- Responses and new lead grants require the statuses enforced by the canonical triggers. Expired or removed requests disappear from ordinary discovery.
- A small scheduled expiry reconciler will persist EXPIRED in bounded batches; queries must still exclude past-expiry rows even if the job has not run.

Provider transitions:

- ACTIVE ↔ PAUSED through self-service.
- ACTIVE or PAUSED → CLOSED through self-service; CLOSED is terminal.
- SUSPENDED is set/restored only by an authorized moderation action.
- Registration starts UNVERIFIED. Verification administration is not a mobile self-service workflow.

### 1.7 Lead access, messaging, notifications, and privacy

- Lead access is a backend entitlement, never a client-side visibility flag.
- Every contact-detail response rechecks an ACTIVE grant with `contact_details_unlocked=true`.
- Every SERVICE_REQUEST conversation create/reuse/detail/list/history/send/delete/read/archive/mute/attachment/typing path rechecks an ACTIVE grant with `chat_enabled=true`, valid participants, and current actor membership.
- Revoked grants cannot be reactivated by a provider. Moderation restoration, if ever required, is a separate privileged decision.
- Ordinary request/provider discovery DTOs contain no exact address, account login email, private contact payload, billing usage ID, or lead grant for another provider.
- The default contact unlock contains the exact linked private address only when one exists, plus non-sensitive display information. Phone/email behavior is unresolved in §10 because the canonical service model has no service contact fields.
- Media download URLs are short-lived, authorized, and never public/permanent.
- The existing response-insert Ably outbox trigger remains in use. Durable notifications use `NotificationsApi` and deterministic dedupe keys.

### 1.8 Community, country, moderation, and trust boundaries

- Service requests are country-based in the canonical schema; they have no `community_id` or community visibility mapping.
- No community-membership visibility rule or new community column will be invented. Authentication, active-profile checks, country filters, and existing block/moderation rules apply.
- Existing community selection may supply mobile context, but it does not silently restrict Service Marketplace visibility.
- Service-specific `service_reports` and `service_moderation_actions` are used. The generic moderation target enum and generic reports table will not be expanded.
- Users can submit reports; privileged platform/country moderators can review, hide/restore/remove requests, suspend/restore providers, hide/restore reviews, warn, or dismiss reports within their authorized scope.
- Admin actions write the service moderation audit record and update the report lifecycle atomically. No mobile admin UI is planned.
- Reviews require an ACTIVE lead grant or a SENT/ACCEPTED response, as enforced by the schema, and self-review is rejected.

### 1.9 Explicitly excluded or future scope

- Booking, appointments, scheduling, reservations, checkout, escrow, payouts, service settlement, and payment gateways.
- Provider registration charges and any `SERVICE_PROVIDER_REGISTER` seed.
- Activating or charging `SERVICE_QUOTE_SEND`.
- Separate provider location/coverage tables.
- Duplicate billing, messaging, notification, media-upload, or generic moderation infrastructure.
- Provider verification self-service, category-admin mobile UI, saved requests/providers, promotion/featured placements, and completion/work-verification claims unless separately approved.
- QUOTE responses remain excluded unless the specific approval question in §10 is answered affirmatively.

---

## 2. Proposed architecture

### 2.1 Backend module structure

Implementation stays in `com.diasporum.backend.servicemarketplace` using the existing JDBC/JdbcTemplate style:

- Root `ServiceMarketplaceApi`: public cross-module conversation-access contract only; no internal types leak.
- `internal/domain`: records/enums for providers, requests, responses, grants, reviews, reports, filters, cursor values, and page results.
- `internal/application`:
  - `ServiceCategoryService`.
  - `ServiceProviderService` and authorization policy.
  - `ServiceRequestService` and lifecycle/expiry reconciliation.
  - `ServiceDiscoveryService`.
  - `ServiceResponseService`.
  - `ServiceLeadAccessService`.
  - `ServiceReviewService`.
  - `ServiceReportService` and `ServiceModerationService`.
  - `ServiceMarketplaceApiImpl` for Messaging authorization.
- `internal/infrastructure/persistence`: focused JDBC repositories, PostGIS discovery queries, cursor codec, advisory-lock helpers, and batch enrichment queries.
- `internal/api/rest`: controllers and request/response records with Bean Validation; no business authorization in DTOs or controllers.
- `internal/infrastructure/integration`: only if an adapter is needed to keep public module API calls separate from domain logic.

The module will call `IdentityApi`, `BusinessAccountsApi`, `BillingApi`, `NotificationsApi`, and `MediaApi`. `CommunityApi` is not needed for visibility because the canonical model is country-based. `TaxonomyApi` may be used for active country/language validation where its existing contract supports it.

### 2.2 Messaging dependency direction and bypass prevention

To avoid a module cycle, Service Marketplace will **not** depend on Messaging:

1. Mobile opens a conversation through the existing `POST /api/v1/conversations` contract with `contextType='SERVICE_REQUEST'` and `contextId=requestId`.
2. Messaging will depend on the root `ServiceMarketplaceApi` to authorize this existing context type.
3. `ServiceMarketplaceApiImpl` validates the request/customer/provider participants, the provider/request grant, `chat_enabled`, ACTIVE status, and the actor’s current personal/business membership.
4. Messaging invokes this check before create and reuse, inside participant authorization, and when constructing list/unread projections so revoked grants cannot leak previews or permit known-ID access.
5. List filtering will be batched and cursor-safe: inaccessible service conversations are removed before items are returned, and fetching continues until a page is filled or candidates are exhausted. No unbounded “load all then filter” query is acceptable.
6. The existing database trigger remains defense in depth for inserts. No Messaging API method is removed or changed incompatibly, and no Service Marketplace conversation table is created.

This produces the acyclic direction `messaging -> servicemarketplace -> billing/media/notifications/identity/businessaccounts`; ArchUnit must remain green.

### 2.3 Mobile feature structure

Create `src/features/service-marketplace/` with:

- `services/service-marketplace-api.ts`: typed client over the existing `ApiClient`.
- `services/service-marketplace-media.ts`: existing shared media-upload helper with `SERVICE_REQUEST` purpose.
- `types/service-marketplace-types.ts`: DTO, filter, form, and lifecycle types.
- `hooks/`: API binding, discovery/pagination, categories, and provider/workspace state.
- `components/`: request/provider cards, filters, category selector, location input, media picker, response/lead/review/report forms, and shared collection states.
- `screens/`: route-level customer/provider workflows.
- `utils/`: validation, error mapping, approximate coordinates, currency/budget formatting, and cursor-safe list helpers.

Use `useSession()`, Expo Router, existing theme/spacing/buttons/form controls, `expo-location`, `expo-image-picker`, and the existing messaging API. No new state manager, HTTP client, map/geocoding dependency, or design system is needed.

### 2.4 Canonical entity relationships

- Category 1—N translations; category 1—N requests; category N—N providers through `service_provider_services`.
- User or Business Account 1—1 provider through the partial unique ownership indexes.
- Customer 1—N requests; request 1—N ordered media references; request 1—N responses with one response per provider.
- Provider/request 1—1 lead grant with a required immutable billing usage record.
- Request/provider/customer 1—1 review uniqueness as defined by the canonical constraint.
- Reports and moderation actions reference request/provider/review targets through the existing validated polymorphic target type/ID pairs.
- Existing direct conversations reference a request through `context_type='SERVICE_REQUEST'` and `context_id`.

No JPA entities or second persistence model are necessary; the established JDBC services map these records directly.

### 2.5 Authorization matrix

| Capability | Rule |
|---|---|
| Read active categories/providers/open requests | Authenticated ACTIVE profile plus discovery eligibility |
| Create/edit/publish request | Request customer; server-derived principal, never client owner ID |
| Manage provider | Personal owner or current authorized Business Account manager |
| Discover jobs as provider | Manager of the specified ACTIVE provider |
| Respond to request | Provider manager; OPEN request; no self/business self-response |
| View all responses | Request customer only |
| View own provider response | Corresponding provider manager only |
| Accept/decline response | Request customer only |
| Acquire/use lead | Corresponding provider manager; billing owner derived from provider ownership |
| Reveal exact address | ACTIVE contact-unlocked grant; customer may view their own address |
| Use contextual chat | Valid participants plus ACTIVE chat-enabled grant on every Messaging path |
| Create review | Request customer with recorded interaction; no self-review |
| Respond to review | Provider manager |
| Report | Authenticated user; target validated server-side |
| Moderate | Existing global/country scoped platform roles; no community scope invented |

For unauthorized resource access, use 404 concealment where existence itself is sensitive; use 403 for a known resource whose action is forbidden. Validation uses 400, lifecycle/idempotency conflicts 409, and Billing’s established entitlement/quota failures propagate unchanged.

---

## 3. Database and migration plan

### 3.1 Existing schema to reuse unchanged

V1 already contains all core tables, relationships, checks, triggers, and GiST/query indexes listed in §2.4. It also contains:

- `SERVICE_JOB_POST`, `SERVICE_LEAD_ACCESS`, and reserved `SERVICE_QUOTE_SEND` billing feature definitions.
- No `SERVICE_PROVIDER_REGISTER` feature.
- Provider radius, ownership, request response, grant immutability, review interaction, report target, response-outbox, and SERVICE_REQUEST conversation triggers.
- Required indexes including provider/request GiST indexes, discovery/budget/customer indexes, unique provider/request response and lead keys, and review/report indexes.

Therefore the default plan creates **no new core tables, foreign keys, request/provider columns, coverage model, or replacement indexes**.

### 3.2 Proposed additive V13

One additive `V13__service_marketplace_integration.sql` is proposed for integration reference data only:

1. Add `SERVICE_REQUEST` to the `media_objects_purpose_check` values while preserving every existing value.
2. Add `SERVICE_RESPONSE` and `SERVICE_REQUEST_UPDATE` to `notification_type`, giving durable service notifications semantic types instead of misusing SYSTEM.
3. Insert the explicitly approved category keys, hierarchy, sort order, and translations idempotently. This portion is blocked until §10.1 is answered.

Add `V13__service_marketplace_integration.sql.conf` with `executeInTransaction=false`, following V11’s PostgreSQL enum migration pattern. Because the script is then nontransactional, each statement must be safely retryable/idempotent; enum values use `ADD VALUE IF NOT EXISTS`, constraint replacement uses the established guarded pattern, and seeds use conflict handling that does not overwrite curated active state unexpectedly.

No enum value is used by a later statement in the same migration, avoiding the PostgreSQL uncommitted-enum restriction.

If implementation starts and `origin/main` already contains V13 or later, stop and renumber/reassess against the new head. Never edit old migrations and never enable `outOfOrder=true`.

### 3.3 Seed and billing configuration rules

- Category seeds require approved keys, parent relationships, English display names/descriptions, sort order, and any additional approved language translations.
- Do not reuse job, property, or Spare Bag categories as a silent substitute.
- Billing plan entitlements, prices, quotas, reset periods, and grants remain configuration data. Do not hard-code an allowance or create a plan solely to make tests pass.
- Keep `SERVICE_QUOTE_SEND` disabled and unchanged.
- Tests create explicit isolated entitlements/grants for the accounts under test, following existing Billing integration-test conventions.

### 3.4 Fresh-install and upgrade verification

- Migrate an empty PostGIS database from V1 through V13 and validate every Flyway checksum/version.
- Upgrade a populated V12 database with existing media, notifications, categories, providers, requests, responses, grants, and conversations; confirm preservation of all prior values and records.
- Verify V13 retry behavior after an induced later-statement failure because enum migration execution is nontransactional.
- Assert no duplicate/old media purposes are lost, both new notification labels exist, and approved categories/translations are complete and active.
- Assert no provider coverage/location table and no `SERVICE_PROVIDER_REGISTER` feature exists.
- Exercise the canonical constraints/triggers and inspect query plans for provider/request GiST usage on representative indexed datasets.
- Re-run the relevant v10.12 smoke assertions in a disposable PostgreSQL/PostGIS environment only.

The optional city-schema alternative in §10.4 is not part of this V13 by default and would require an explicitly revised migration/test plan.

---

## 4. API contract plan

### 4.1 Conventions and shared response shapes

All endpoints require the normal authenticated principal unless identified as admin. Base paths follow the v10.12 catalogue’s `/api/v1/service` naming. Mutable request bodies use Bean Validation; IDs and ownership are resolved server-side.

Common responses:

- Page: `items`, `nextCursor`.
- Category: `id`, `categoryKey`, `parentId`, `displayName`, `description`, `sortOrder`.
- Provider summary: `id`, `displayName`, `description`, `categories`, `radiusKm`, `status`, `verificationStatus`, `distanceMeters`, `canManage`, safe owner/business summary.
- Provider management detail adds `baseLatitude`, `baseLongitude`, timestamps, and management capabilities only for an authorized manager.
- Request summary/detail: `id`, `category`, `countryId`, safe customer summary, `title`, `description`, `budgetMin`, `budgetMax`, `currencyCode`, `preferredDate`, `status`, `expiresAt`, `publishedAt`, approximate `latitude`/`longitude`, `distanceMeters`, ordered `mediaIds`, `canManage`, and caller-specific response/lead summaries.
- Response: `id`, `serviceRequestId`, `serviceProviderId`, `responseType`, `message`, optional approved quote fields, `status`, `respondedByUserId`, timestamps, and safe provider summary.
- Lead: `id`, `serviceRequestId`, `serviceProviderId`, `chatEnabled`, `contactDetailsUnlocked`, `status`, `accessedAt`; never expose `billingUsageRecordId` in ordinary DTOs.
- Contact payload: nullable exact structured `address` only when authorized; no login email or unapproved phone field.
- Review: `id`, `serviceRequestId`, `serviceProviderId`, safe reviewer summary, `rating`, `reviewText`, `status`, `providerResponse`, timestamps.
- Errors use the existing `ApiError` envelope. Expected domain codes include `INVALID_CURSOR`, `INVALID_LOCATION`, `INVALID_RADIUS`, `INVALID_BUDGET`, `CURRENCY_REQUIRED_FOR_PRICE_SORT`, `ACTIVE_PROFILE_REQUIRED`, `NOT_PROVIDER_MANAGER`, `NOT_REQUEST_OWNER`, `INVALID_REQUEST_TRANSITION`, `INVALID_RESPONSE_TRANSITION`, `RESPONSE_CONFLICT`, `LEAD_ACCESS_REQUIRED`, `LEAD_ACCESS_REVOKED`, `MEDIA_NOT_ATTACHABLE`, `ADDRESS_NOT_OWNED`, and `REVIEW_INTERACTION_REQUIRED`.

### 4.2 Categories and providers

| Method and URL | Purpose and permissions | Request/filter fields | Response and expected errors |
|---|---|---|---|
| GET `/api/v1/service/categories` | Active translated catalogue; authenticated user | `languageCode`, optional `parentId` | Category list ordered by parent/sort/key; `INVALID_LANGUAGE` |
| POST `/api/v1/service/providers` | Register personal/business provider; prospective manager | `businessAccountId?`, `displayName`, `description?`, `baseLatitude`, `baseLongitude`, `radiusKm`, `categoryIds[]` | 201 provider detail; `PROVIDER_ALREADY_EXISTS`, `NOT_PROVIDER_MANAGER`, validation errors |
| GET `/api/v1/service/providers` | Discover ACTIVE providers | `categoryId?`, `originLatitude?`, `originLongitude?`, `radiusKm?`, `query?`, `sort=NEWEST|DISTANCE`, `cursor?`, `size?` | Provider page; origin required together, `INVALID_CURSOR`, `INVALID_LOCATION` |
| GET `/api/v1/me/service/providers` | List caller-manageable providers | optional `status`, `cursor`, `size` | Provider page without other owners’ data |
| GET `/api/v1/service/providers/{providerId}` | Public ACTIVE detail or authorized management detail | Path ID | Provider detail/review aggregate; 404 for hidden/unavailable |
| PUT `/api/v1/service/providers/{providerId}` | Full manager edit of profile/categories/base/radius | Same editable registration fields | Updated provider; `NOT_PROVIDER_MANAGER`, `PROVIDER_NOT_EDITABLE` |
| POST `/api/v1/service/providers/{providerId}/pause` | ACTIVE manager pauses | None | Updated provider; invalid-state conflict |
| POST `/api/v1/service/providers/{providerId}/resume` | PAUSED manager resumes | None | Updated provider; SUSPENDED/CLOSED rejected |
| POST `/api/v1/service/providers/{providerId}/close` | Manager closes provider | None | Updated provider; terminal-state conflict |

Public provider DTOs omit exact base coordinates. The public discovery endpoint uses caller-supplied approximate origin; request-specific provider matching uses the server-loaded request point instead.

### 4.3 Requests and lifecycle

| Method and URL | Purpose and permissions | Request/filter fields | Response and expected errors |
|---|---|---|---|
| POST `/api/v1/service/requests` | Create customer DRAFT | `serviceCategoryId`, `countryId`, `addressId?`, `latitude`, `longitude`, `title`, `description`, `budgetMin?`, `budgetMax?`, `currencyCode?`, `preferredDate?`, `expiresAt?`, `mediaIds[]` | 201 request; `ADDRESS_NOT_OWNED`, `INVALID_BUDGET`, `MEDIA_NOT_ATTACHABLE` |
| GET `/api/v1/service/requests` | Job discovery for a managed provider | required `providerId`; optional `categoryId`, `countryId`, `city`, `budgetMin`, `budgetMax`, `currencyCode`, `preferredDateFrom/To`, `maxDistanceKm`, `sort`, `cursor`, `size` | OPEN matching request page; `NOT_PROVIDER_MANAGER`, price/currency/cursor errors |
| GET `/api/v1/me/service/requests` | Customer’s own requests | optional `status`, `cursor`, `size` | Owned request page; no discovery authorization substitute |
| GET `/api/v1/service/requests/{requestId}` | View discoverable request or authorized owner/provider detail | Path ID | Privacy-safe detail; 404 for REMOVED/inaccessible |
| PUT `/api/v1/service/requests/{requestId}` | Customer edits allowed fields for current lifecycle | Same create fields with lifecycle immutability enforced | Updated request; `NOT_REQUEST_OWNER`, `REQUEST_NOT_EDITABLE`, `PUBLISHED_LOCATION_IMMUTABLE` |
| POST `/api/v1/service/requests/{requestId}/publish` | DRAFT → OPEN | None | Published request; Billing entitlement errors or `INVALID_REQUEST_TRANSITION` |
| POST `/api/v1/service/requests/{requestId}/pause` | OPEN → PAUSED | None | Updated request; ownership/state errors |
| POST `/api/v1/service/requests/{requestId}/resume` | PAUSED → OPEN without another charge | None | Updated request; expiry/state errors |
| POST `/api/v1/service/requests/{requestId}/cancel` | DRAFT/OPEN/PAUSED → CANCELLED | None | Updated request; terminal-state conflict |
| POST `/api/v1/service/requests/{requestId}/close` | OPEN/PAUSED → CLOSED | None | Updated request; terminal-state conflict |
| GET `/api/v1/service/requests/{requestId}/providers` | Customer discovers providers covering this request | `maxDistanceKm?`, `sort=DISTANCE|NEWEST`, `cursor`, `size` | Matching provider page; `NOT_REQUEST_OWNER`, invalid state/location |
| POST `/api/v1/service/requests/{requestId}/media/{mediaId}/download-url` | Authorize one attached image URL | Path IDs | Short-lived `downloadUrl`; `MEDIA_NOT_FOUND`, request access errors |

Draft creation is always free. Mobile may compose create + publish into one UX, but the endpoints preserve a recoverable DRAFT when publishing entitlement fails.

### 4.4 Responses and lead access

| Method and URL | Purpose and permissions | Request fields | Response and expected errors |
|---|---|---|---|
| GET `/api/v1/service/requests/{requestId}/responses` | Customer sees all; provider manager sees only its response | `cursor`, `size` | Response page; no other providers’ responses leaked |
| PUT `/api/v1/service/requests/{requestId}/response` | Create/revise the provider’s single response | `serviceProviderId`, `responseType=INTEREST|CONTACT` (`QUOTE` only if approved), `message?`, conditional `quotedAmount?`, `currencyCode?` | Upserted SENT response; `RESPONSE_CONFLICT`, self-response/state/quote validation errors |
| POST `/api/v1/service/requests/{requestId}/response/withdraw` | Provider withdraws its SENT response | `serviceProviderId` | Updated response; ownership/state errors |
| POST `/api/v1/service/responses/{responseId}/accept` | Customer accepts SENT response | None | Updated response; `NOT_REQUEST_OWNER`, `INVALID_RESPONSE_TRANSITION` |
| POST `/api/v1/service/responses/{responseId}/decline` | Customer declines SENT response | None | Updated response; same authorization/state errors |
| PUT `/api/v1/service/requests/{requestId}/lead-access` | Acquire or upgrade the one provider/request grant | `serviceProviderId`, `enableChat`, `unlockContactDetails`; at least one true | Lead plus authorized contact payload; Billing errors, `LEAD_ACCESS_REVOKED`, state/ownership errors |
| GET `/api/v1/service/requests/{requestId}/lead-access` | Read caller-specific grant/contact state | `serviceProviderId` for provider; customer sees their own contact data | Lead/contact payload or 404; `LEAD_ACCESS_REQUIRED` for locked contact |

`PUT` lead access is naturally retry-safe and needs no client-generated billing key. Chat initiation is deliberately not a second Service Marketplace endpoint: use existing `POST /api/v1/conversations` with `contextType`, `contextId`, and the server-derived safe recipient IDs. Messaging returns `LEAD_ACCESS_REQUIRED`/404 on missing or revoked access.

### 4.5 Reviews, reports, and moderation

| Method and URL | Purpose and permissions | Request/filter fields | Response and expected errors |
|---|---|---|---|
| POST `/api/v1/service/requests/{requestId}/reviews` | Customer reviews an interacted provider | `serviceProviderId`, `rating` 1–5, `reviewText?` | 201 review; `REVIEW_INTERACTION_REQUIRED`, duplicate/self-review conflict |
| GET `/api/v1/service/providers/{providerId}/reviews` | Published review page | `cursor`, `size` | Review page plus average/count; unavailable provider returns 404 |
| POST `/api/v1/service/reviews/{reviewId}/provider-response` | Provider manager responds once | `providerResponse` | Updated review; manager/lifecycle validation |
| POST `/api/v1/service/reports` | Report request/provider/review | `targetType`, `targetId`, `reasonCode`, `description?` | 201 report ID; target/reason validation and duplicate/rate-limit handling |
| GET `/api/v1/admin/service/reports` | Scoped moderator queue | `status?`, `cursor`, `size` | Report page; `MODERATION_FORBIDDEN` |
| POST `/api/v1/admin/service/reports/{reportId}/actions` | Apply audited service moderation action | `actionKey`, `reason`, optional object `metadata` | Updated report/target state and action ID; scope/state errors |

Review publication defaults to PUBLISHED unless the existing moderation policy requires review; no false “verified completed work” label is returned. Moderation actions update only service-owned tables and preserve the audit trail.

---

## 5. Billing plan

### 5.1 Publishing consumption

Publishing executes in one database transaction:

1. Load the request FOR UPDATE/through the repository’s deterministic operation lock and verify customer ownership and DRAFT state.
2. Validate category/location/media/expiry immediately before consumption.
3. Call `BillingApi.consume(ConsumptionCommand)` with personal `userId=customerUserId`, quantity 1, feature `SERVICE_JOB_POST`, target type `SERVICE_REQUEST`, target ID `requestId`, and stable idempotency key `service-job-post:{requestId}`.
4. Persist OPEN and `published_at` in the same transaction. Replaying publish returns the already published request without another unit.
5. Pause/resume and ordinary edits never consume again. Any exception before commit rolls back both status and usage.

A missing/disabled/zero/exhausted entitlement fails closed; no implicit grant or fallback free publish is introduced. `quantity_limit=NULL` retains Billing’s existing unlimited semantics.

### 5.2 Lead-access consumption and upgrade

Lead acquisition executes in one transaction using a deterministic provider/request advisory lock:

1. Authorize the actor and derive the billing owner from the provider row: personal `owner_user_id` XOR `business_account_id`.
2. Lock `service-lead-access:{requestId}:{providerId}` and reload any existing grant.
3. If ACTIVE, enable the newly requested booleans and return the original grant without calling Billing. The original `billing_usage_record_id` remains unchanged.
4. If REVOKED, reject; do not create a second grant or reactivate it through the public API.
5. If absent, consume quantity 1 of `SERVICE_LEAD_ACCESS` with target type `SERVICE_REQUEST`, target ID `requestId`, and deterministic key `service-lead-access:{requestId}:{providerId}`.
6. Insert the lead using the returned `usageRecordId`, requested grant booleans, and acting user. Commit usage and grant atomically.
7. A retry after failure uses the same target and key; Billing replays only the exact original command. Unique constraints remain defense in depth against races.

Chat/contact upgrades are free regardless of which capability was purchased first. There is no refund, charge, or service-payment flow. Quote responses never invoke Billing; `SERVICE_QUOTE_SEND` remains reserved and inactive.

### 5.3 Failure and mobile handling

- Preserve Billing’s existing HTTP/error contract and map known codes to clear mobile messages with a “keep draft”/retry path.
- Distinguish entitlement not configured, exhausted allowance, permission denied, conflict, timeout, and network failure.
- Never show lead/contact success before the committed backend response.
- Concurrent taps use disabled/loading controls, but server locking and idempotency remain authoritative.

---

## 6. Messaging and notifications plan

### 6.1 Contact and conversation workflow

1. A provider sends INTEREST/CONTACT without obtaining contact data.
2. The provider acquires lead access with chat and/or contact unlock.
3. Contact unlock returns only the separately authorized contact payload.
4. For chat, mobile calls the existing Messaging API with `SERVICE_REQUEST` and the request ID. Provider-side calls use the provider Business Account as `actingBusinessAccountId` when applicable; customer-side calls address the provider’s personal/business endpoint from the safe DTO.
5. Messaging creates or reuses the canonical participant/context conversation. The Service Marketplace public authorization API validates the grant and participants before either operation.
6. Existing conversation screens, message IDs, attachments, read cursors, Ably channels, and idempotent `clientMessageId` behavior are reused unchanged.
7. Revocation or membership removal takes effect on subsequent list/detail/history/send/read/attachment/typing access without deleting history.

### 6.2 Durable and realtime notifications

Use `NotificationsApi.notify` in the same domain transaction for:

- Response created/revised → customer, type `SERVICE_RESPONSE`, target `SERVICE_REQUEST_RESPONSE`, dedupe `service-response-created:{responseId}` or `service-response-revised:{responseId}:{revision}`.
- Response accepted/declined → responding provider actor, type `SERVICE_RESPONSE`, dedupe `service-response-{status}:{responseId}`.
- Request paused/resumed/closed/cancelled with an existing provider interaction → affected provider actor where product messaging is useful, type `SERVICE_REQUEST_UPDATE`, dedupe `service-request-{status}:{requestId}`.
- Review created → provider owner/representative, type `SERVICE_REQUEST_UPDATE`, target `SERVICE_REVIEW`, dedupe `service-review-created:{reviewId}`.
- Moderation outcomes → existing MODERATION type where appropriate.

No notification is generated merely for viewing a request or upgrading a lead. Business notifications target the recorded acting/responding user or canonical representative rather than fanning out unexpectedly to every member.

The existing `SERVICE_RESPONSE_CREATED` transactional Ably trigger remains the realtime path. Durable notification dedupe and existing outbox dedupe prevent duplicate delivery; no second event bus or notification table is added.

### 6.3 Media integration

- V13 enables purpose `SERVICE_REQUEST`; `MediaService.ALLOWED` adds JPEG/PNG/WebP only, matching existing image marketplace constraints.
- Mobile uses `uploadMedia` and existing initiate → direct upload → processing/READY lifecycle.
- Create/edit accepts at most five unique media IDs, verifies every asset belongs to the principal, has purpose `SERVICE_REQUEST`, and is READY through `MediaApi.validateForAttach`.
- `service_request_media.sort_order` is the array index; replacement is transactional.
- Detail/list responses contain IDs/metadata, not permanent URLs. The download endpoint verifies current request visibility/ownership and attachment membership before calling `MediaApi.authorizedDownloadUrl`.

---

## 7. Mobile UI/UX plan

### 7.1 Routes and screens

| Proposed route | Workflow |
|---|---|
| `/(app)/services` | Services landing/discovery with Find Providers and Provider Jobs modes, filters, sorting, pull-to-refresh, and cursor pagination |
| `/(app)/services/requests/create` | Customer request form, approximate location, optional private address, budget/date/expiry, and images |
| `/(app)/services/requests/mine` | Customer request list with status filters and create/resume actions |
| `/(app)/services/requests/[id]` | Privacy-safe detail, lifecycle actions, response/lead state, matching-provider and contact entry points |
| `/(app)/services/requests/[id]/edit` | Lifecycle-aware request editing |
| `/(app)/services/requests/[id]/responses` | Customer response inbox and accept/decline; provider sees only its own response where applicable |
| `/(app)/services/requests/[id]/providers` | Distance-ranked providers covering the request |
| `/(app)/services/providers/register` | Personal/Business Account provider registration |
| `/(app)/services/providers/[id]` | Public provider detail, categories, distance, reviews, report action |
| `/(app)/services/providers/[id]/edit` | Provider profile/base point/radius/categories and availability |
| `/(app)/services/providers/[id]/workspace` | Provider jobs, own responses, lead grants, and contact/chat actions |
| `/(app)/services/requests/[id]/review` | Customer review form after a recorded interaction |

Review/report forms may be reusable sheets/components instead of separate routes where that matches existing UI patterns. Admin moderation remains outside the mobile scope.

### 7.2 Navigation changes

- Add a Services panel to the existing `feature-panels.tsx` switch using new provider/request cards; `feature-nav.tsx` already has `services` and needs no registration change.
- Add `route: "/(app)/services/requests/create"` to the existing `service-request` option in `create-sheet.tsx`.
- Add stack screen titles/options in the authenticated app layout only if Expo Router’s current conventions require explicit registration.
- Link contact buttons to the existing conversation route after the existing Messaging create/reuse call succeeds.
- Preserve all current tab items and routes; no new bottom tab is needed.

### 7.3 Forms and reusable components

- `ServiceRequestForm`: category, title/description, approximate location, optional owned address, budget/currency, preferred date, expiry, and ordered media.
- `ProviderForm`: owner selector limited to manageable accounts, categories, base point, radius slider/input, and profile fields.
- `ServiceFilters`: country/category/city/budget/date/distance/sort with active-filter summary and reset.
- `ProviderCard`, `ServiceRequestCard`, `ResponseCard`, `LeadAccessCard`, `ReviewCard`, `MediaStrip`, `StatusBadge`, and `ContactActions`.
- Shared loading skeleton/spinner, retryable error, empty results, no-provider onboarding, no-category configuration error, entitlement panel, and permission-denied manual location entry.

### 7.4 Validation and state behavior

- Validate coordinates, 1–300 km radius, required category/title/description, budget ordering/currency, future expiry, quote fields only if approved, rating, and at least one requested lead capability.
- Disable duplicate submissions and show operation-specific progress for publish, lead unlock, media upload, response, and chat creation.
- Preserve unsent form values after entitlement/network failures; attached READY media IDs remain recoverable.
- Use request cancellation/stale-response guards for filters and pagination, dedupe appended items by ID, and reset the cursor whenever filters change.
- Never optimistically reveal an address or enable chat; render only server-confirmed capabilities.
- Handle deleted/revoked provider membership, expired requests, revoked grants, 401 session refresh, 403/404 concealment, and offline retry without crashing or showing stale private data.
- Use accessible labels/roles, existing typography/colors/spacing, safe-area handling, and responsive cards consistent with current marketplace screens.

---

## 8. File impact and merge-risk assessment

### 8.1 Backend and database

| Files/modules | Classification | Expected change and merge risk |
|---|---|---|
| `servicemarketplace/ServiceMarketplaceApi.java` | Existing Service Marketplace file | Replace empty placeholder with the minimal Messaging-facing access contract; isolated, low conflict |
| `servicemarketplace/internal/domain/*` | New Service Marketplace files | Domain records, filters, lifecycle, pages; low conflict |
| `servicemarketplace/internal/application/*` | New Service Marketplace files | Provider/request/discovery/response/lead/review/report/moderation/expiry/API implementation services; low conflict |
| `servicemarketplace/internal/infrastructure/persistence/*` | New Service Marketplace files | JDBC repositories, PostGIS queries, locks, cursor codec; low conflict |
| `servicemarketplace/internal/api/rest/*` | New Service Marketplace files | Controllers and validated DTOs; low conflict |
| `messaging/internal/application/MessagingService.java` | Shared integration file | Add root-API authorization for SERVICE_REQUEST create/reuse and every read/send/list path; **high integration sensitivity**, minimal targeted edits only |
| `media/internal/application/MediaService.java` | Shared integration file | Add one SERVICE_REQUEST image purpose entry; small but shared, medium conflict risk |
| `db/migration/V13__service_marketplace_integration.sql` and `.conf` | Database migration | Add media/notification reference values and approved seeds; version conflict must be rechecked at implementation time |
| `billing/**`, `notifications/**` implementations | Shared files, not planned for modification | Reuse public APIs unchanged |
| `MessagingApi.java`, `MediaApi.java`, SecurityConfig, global error handler | Shared files, not planned for modification | Existing contracts are sufficient |

### 8.2 Mobile

| Files/modules | Classification | Expected change and merge risk |
|---|---|---|
| `src/features/service-marketplace/**` | New Service Marketplace files | API, types, hooks, components, screens, utilities; isolated, low conflict |
| `src/app/(app)/services/**` | New Service Marketplace files | Expo Router wrappers; isolated, low conflict |
| `src/features/feed/components/feature-panels.tsx` | Shared integration file | Add Services import/panel only; already large and **high conflict risk**, keep edit narrow |
| `src/shared/components/create-sheet.tsx` | Shared integration file | Add the missing route to the existing Service Request option; one-line behavioral change, medium risk |
| `src/app/(app)/_layout.tsx` | Shared integration file, conditional | Add stack options only if required by current route conventions; avoid otherwise |
| `src/features/messaging/**` | Existing shared feature, not planned for modification | SERVICE_REQUEST types and createConversation API already exist |
| `src/core/api/api-client.ts`, `feature-nav.tsx`, shared media upload | Shared files, not planned for modification | Existing capabilities are sufficient |

### 8.3 Tests and final documentation

- New `servicemarketplace` backend integration, migration, concurrency, authorization, and repository/query tests: **Test files**.
- New Messaging SERVICE_REQUEST authorization regression tests; targeted additions to existing Messaging/Media tests only where a new isolated test cannot cover the behavior: **Test files**, shared regression risk.
- New mobile Service Marketplace API/form/screen/hook tests and narrow navigation tests: **Test files**.
- No changes to ArchUnit rules are expected; the existing module-boundary suite must pass.
- After implementation and verification only, create `SERVICE_MARKETPLACE_IMPLEMENTATION_REPORT.md` with actual results.

Merge-safety rules: no unrelated refactors/formatting, no contract removal, no changes to other feature modules, no broad shared-file replacement, no new dependency unless separately justified, no Git write operations, and re-check `origin/main` migration/head state before implementation. Run all consumers’ regressions for Messaging and Media because those are the only planned shared production implementations.

---

## 9. Testing strategy

### 9.1 Backend domain and REST integration tests

Use `@SpringBootTest`, MockMvc, real Flyway migrations, `IdentityTestSupport`, and PostgreSQL/PostGIS Testcontainers (`postgis/postgis:17-3.5`) following existing marketplace suites.

Cover:

- Personal/business provider registration, duplicate ownership, role changes, category mappings, base-point updates, all radius boundaries, pause/resume/close/suspension behavior.
- Draft creation, owned-address/country validation, media ownership/purpose/READY checks, budget/date/expiry validation, lifecycle transitions, post-publication immutability, and expiry reconciliation.
- Job/provider discovery across category, country, city decision, budget, date, radius, expiry, paused/removed/self-owned exclusion, and missing locations.
- Real PostGIS `ST_DWithin`/`ST_Distance` correctness, index-aware query plans, deterministic newest/price/distance ordering, missing budgets, mixed-currency rejection, tie-breaking, cursor fingerprints, and stable pagination.
- Response create/revise/withdraw/accept/decline, one-response uniqueness, self-response rejection, state rules, customer/provider visibility, and quote acceptance/rejection according to the approved scope.
- Review interaction/self-review/duplicate rules, provider responses, reporting target validation, moderator scopes, audit records, and hidden/removed content exclusion.
- Validation and shared error-envelope behavior, not merely HTTP 200 assertions.

### 9.2 Billing, concurrency, and failure tests

- Publish with configured allowance, unlimited (`quantity_limit=NULL`), zero, exhausted, disabled, missing, and incomplete entitlement configurations.
- Publish retry and concurrent publish produce one OPEN request and one usage record; pause/resume adds none.
- Lead grant for personal and business billing owners; insufficient entitlement leaves neither grant nor partial contact access.
- Two concurrent lead requests produce one grant and one usage record with the immutable returned ID.
- Chat-first then contact upgrade and contact-first then chat upgrade produce no second usage unit.
- Retries with the same operation preserve success; mismatched idempotency commands retain Billing’s conflict behavior.
- REVOKED grants cannot be reactivated or bypassed through another endpoint.
- Notification or database failure inside a consuming transaction rolls back the domain change and usage as intended.

### 9.3 Messaging, notification, and media integration tests

- Directly call existing `POST /api/v1/conversations` with and without chat access; verify create and known-ID reuse both fail closed.
- Verify customer/provider participant matching, personal/business actors, self-contact prevention, and live Business Account membership revocation.
- After lead revocation, verify conversation list previews, unread projections, detail, history, send, delete, read, archive/mute, attachment URL, and typing/access paths deny or filter access as appropriate.
- Reusing an existing conversation does not create another lead charge or duplicate conversation.
- Durable notification recipient/type/target/dedupe assertions and existing response Ably outbox dedupe assertions.
- SERVICE_REQUEST media initiate/mime validation, READY ownership attach, ordering/replacement, authorized URLs, cross-user/cross-purpose/wrong-request denial, and existing media-purpose regressions.

### 9.4 Database migration tests

- Fresh V1→latest migration and populated V12→V13 upgrade.
- Constraint/index/FK/trigger assertions, enum/media value preservation, category seed completeness, V13 retry safety, and no forbidden tables/features.
- PostGIS distance/radius and query-plan tests on real PostgreSQL, never H2.
- Populate pre-upgrade requests/providers/grants/conversations and prove data and authorization remain intact.

### 9.5 Mobile tests

Use Jest 30 and React Native Testing Library for:

- API path/query/body mapping, cursor handling, error mapping, and authentication through the existing client.
- Request/provider form validation, location-permission denial/manual fallback, approximate coordinates, address selection, media upload states, and lifecycle-aware fields.
- Customer create/publish/manage/responses/providers/review flows.
- Provider registration/edit/discovery/response/lead/workspace flows and Business Account selection.
- Filter/sort/reset, deterministic rendering, pagination dedupe, pull-to-refresh, stale response handling, loading/empty/error states, and preserved form state.
- Billing failure, lead pending/success/revoked, exact-address nonexposure, Messaging entry success/failure, 401/session behavior, and unauthorized states.
- Services feature panel, CreateSheet route, and existing navigation regressions.

### 9.6 Regression and static verification

After implementation, run and record actual results for:

- Full backend `mvn test`, with focused Service Marketplace, Messaging, Media, Billing, Notifications, Community, and architecture suites first for diagnosability.
- Mobile `npm test -- --runInBand`, `npm run typecheck`, and `npm run lint`.
- Fresh/upgrade migration tests and PostGIS integration tests.
- Existing marketplace/mobile navigation regressions for every shared file touched.
- `git diff --check`, conflict-marker scan, final changed-file audit, branch/status verification, and scope review.

Do not delete or weaken failing tests. Separate pre-existing unrelated failures from introduced failures with evidence. The final implementation report must list passed, failed, skipped, and unrun checks honestly.

---

## 10. Questions and unresolved decisions

The following require explicit product approval. Except for these gates, the plan is implementation-ready.

### 10.1 Initial service-category catalogue — required before implementation

Supply the approved initial category keys, parent/child hierarchy, sort order, English display names/descriptions, and required non-English translations. No suitable approved Service Marketplace catalogue exists in the repository. The plan will not invent categories or silently reuse the Jobs taxonomy.

### 10.2 Quote responses — explicit scope conflict requiring approval

v10.12 §12.4 supports INTEREST, CONTACT, and QUOTE responses, while the task’s strict boundaries prohibit quote-sending workflows unless explicitly required and approved. The default implementation includes only INTEREST and CONTACT and rejects QUOTE.

If approved, QUOTE will be supported only as the existing response type with `quotedAmount` and `currencyCode`, with no separate quote checkout/negotiation/payment workflow and no `SERVICE_QUOTE_SEND` consumption. Confirm whether this unbilled QUOTE response capability is approved.

### 10.3 Meaning of “contact details” — data-model limitation

The canonical request has an optional private address but no service phone, WhatsApp, or contact-email fields. The default contact unlock therefore reveals only that exact owned address (when present) and safe display information; it does **not** expose the customer’s account login email or invent phone fields.

Confirm this default, or specify exactly which additional contact fields are approved. Additional stored contact channels would require a revised additive schema/API/privacy plan rather than an undocumented implementation choice.

### 10.4 City filtering versus canonical request schema — confirm default behavior

v10.12 mentions city filtering, but `service_requests` has no city column and an address is optional. The default implementation applies `city` through the linked address’s city; requests without an address do not match a city filter, while country/category/distance discovery remains complete.

Confirm this behavior, or approve adding a denormalized optional request city with backfill/index and corresponding form/privacy rules. The latter is not included in the proposed V13 by default.

### 10.5 Additive integration migration and notification types — approval requested

Approve V13’s `SERVICE_REQUEST` media purpose and `SERVICE_RESPONSE`/`SERVICE_REQUEST_UPDATE` notification labels, plus the one-entry `MediaService` change. These are the only planned database/shared-media changes. Reusing OTHER/SYSTEM would avoid a migration but is rejected as semantically weaker and less maintainable.

---

## Approval boundary

No implementation will begin until this plan and the required decisions in §10 are explicitly approved. Implementation will then be limited to the approved scope, followed by the test strategy above and the required `SERVICE_MARKETPLACE_IMPLEMENTATION_REPORT.md`. No commit, push, rebase, merge, reset, stash, or other Git write operation will be performed.
