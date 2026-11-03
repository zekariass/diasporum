# DIASPORUM Service Marketplace Implementation Report

## Status

Implementation is complete on `feature/service-marketplace` and ready for code review. The approved lead-generation scope is implemented across the Spring Boot backend, PostgreSQL/PostGIS persistence, shared module integrations, and Expo/React Native mobile application.

The final clean backend suite and full mobile Jest suite pass. Mobile TypeScript passes and `git diff --check` reports no whitespace errors. Mobile lint remains red because of four existing Vehicle-feature errors and eleven unrelated warnings; no Service Marketplace lint findings remain.

No commit, push, rebase, merge, reset, stash, or other Git write operation was performed.

## Implemented scope

### Backend domain and REST APIs

The `servicemarketplace` module now provides:

- Active, translated service-category retrieval without inventing a production category catalogue.
- Personal and Business Account provider registration and management.
- Current-manager authorization for personal owners and active Business Account `OWNER`, `ADMINISTRATOR`, `EDITOR`, and `LISTING_MANAGER` members.
- Provider category mappings, one base point, editable 1–300 km radius, and ACTIVE/PAUSED/CLOSED lifecycle operations.
- Customer DRAFT creation, publishing, pause/resume, cancellation, closure, draft soft deletion, ownership-aware reads, and scheduled expiry reconciliation.
- Lifecycle-aware request editing:
  - DRAFT requests permit full editing.
  - OPEN and PAUSED requests permit descriptive, budget/date/expiry, and media edits.
  - Category, country, approximate point, and exact address are immutable after publication.
  - Terminal requests cannot be edited.
  - Updates lock the request row while checking lifecycle and immutable fields.
- At most five unique READY images per request, with ownership and `SERVICE_REQUEST` purpose validation.
- Managed-provider job discovery with mandatory provider selection, category matching, provider default radius, optional smaller radius, and personal/Business Account self-request exclusion.
- Customer provider matching using the owned request point and each provider's configured coverage radius.
- SQL-backed country, category, linked-address city, budget, preferred-date, and distance filters.
- PostGIS `ST_DWithin`/`ST_Distance` discovery and deterministic NEWEST, DISTANCE, PRICE_ASC, and PRICE_DESC sorting with filter-bound cursors.
- One INTEREST or CONTACT response per provider/request, response revision/withdrawal, and customer acceptance/decline transitions.
- QUOTE rejection; no quote or service-payment workflow was introduced.
- Idempotent `SERVICE_LEAD_ACCESS` acquisition and free chat/contact upgrades, with provider-derived billing ownership and transaction/advisory-lock concurrency protection.
- Interaction-backed reviews, provider responses, service-specific reports, scoped moderation actions, and moderation audit records.
- Privacy-safe DTOs and grant-controlled exact-address/contact responses.

### Shared backend integrations

- `SERVICE_JOB_POST` is consumed once when a DRAFT is first published. Replayed publish, pause/resume, and safe edits do not consume another unit.
- `SERVICE_LEAD_ACCESS` consumption and grant creation are atomic and retry-safe.
- Billing PostgreSQL timestamp mapping/binding was corrected where required by the real integration path.
- `SERVICE_REQUEST` media support uses the existing Media upload, READY-state, ownership, attachment, and authorized-download mechanisms.
- Durable response/review/request notifications use the existing Notifications module and deterministic deduplication keys.
- Messaging depends on the root `ServiceMarketplaceApi`; Service Marketplace does not depend back on Messaging.
- SERVICE_REQUEST conversation create/reuse and subsequent Messaging access paths revalidate the current actor, participants, and ACTIVE chat-enabled lead grant.
- The modular-monolith dependency direction remains intact.

### Database migration

`V13__service_marketplace_integration.sql` and its nontransactional Flyway configuration add only the approved integration reference values:

- `SERVICE_REQUEST` media purpose.
- `SERVICE_RESPONSE` and `SERVICE_REQUEST_UPDATE` notification types.

The migration does not seed service categories, add a provider registration charge, activate quote billing, create a provider coverage table, or alter earlier migrations. Fresh V1→V13 and V12→V13 migration paths were exercised against real PostgreSQL/PostGIS Testcontainers.

### Mobile application

The Services feature now includes typed API/state support and routes for:

- Services landing and provider/request discovery.
- Customer request creation, owned-request collection, detail, lifecycle-aware editing, matching providers, responses, and reviews.
- Provider registration/editing, managed-provider collection, provider details, and provider workspace.
- Response and lead-access workflows, including chat/contact upgrades and entry into the existing Messaging conversation screen.
- Existing feature-panel and Create Sheet navigation to Service Marketplace workflows.

The mobile request editor enforces the five-image limit, disables structural fields after publication, preserves the request's original country during edits, and exposes editing for DRAFT, OPEN, and PAUSED requests. Forms use the existing session, API client, upload flow, theme, safe-area, loading, validation, and error patterns.

## Verification results

| Check | Result |
|---|---|
| Clean full backend: `mvnw clean test` | **Passed** — 308 tests, 0 failures, 0 errors, 0 skipped |
| Focused Service Marketplace + migration backend tests | **Passed** — 12 tests, including 11 Service Marketplace integration tests |
| Full mobile: `npm test -- --runInBand` | **Passed** — 33 suites, 312 tests, 0 failures |
| Focused mobile Service Marketplace tests | **Passed** — 3 suites, 17 tests |
| Mobile TypeScript: `npm run typecheck` | **Passed** |
| Mobile lint: `npm run lint` | **Failed on existing unrelated findings** — 4 errors and 11 warnings; no Service Marketplace findings |
| `git diff --check` | **Passed** |
| Backend/mobile source conflict-marker scan | **Passed** — no markers found |
| Branch/baseline check | `feature/service-marketplace`; HEAD and `origin/main` remained `f5d3e54b958510a2dc5e5c7ded523f8ae11d9db6` |

Backend integration coverage includes real migrated PostgreSQL/PostGIS behavior, fresh/upgrade migration checks, personal/business authorization, discovery and cursor behavior, request lifecycle and safe editing, media validation, Billing idempotency, concurrent lead acquisition, private contact access, Messaging authorization, reviews, reports, and moderation. The full backend run also passed the existing architecture and other-module regression suites.

Testcontainers emitted connection-cleanup and Surefire shutdown warnings after the backend tests completed; Maven nevertheless recorded 308 passing tests and `BUILD SUCCESS`.

### Remaining lint findings

The four errors are existing `react-hooks/set-state-in-effect` findings in:

- `diasporum-mobile/src/features/vehicles/components/vehicle-form.tsx` (2).
- `diasporum-mobile/src/features/vehicles/screens/vehicles-screen.tsx` (2).

The eleven warnings are in existing environment configuration, security settings, authentication provider-sign-in, and Messaging files. They were not introduced by the Service Marketplace implementation and were left unchanged to preserve scope isolation.

## Explicit boundaries and operational requirements

- This is lead generation only. No bookings, appointments, checkout, escrow, payouts, service settlement, or payment gateway was added.
- `SERVICE_QUOTE_SEND` remains inactive and QUOTE responses are rejected.
- No `SERVICE_PROVIDER_REGISTER` feature or provider registration charge was added.
- Provider coverage continues to use `service_providers.base_location` and `radius_km`; no additional coverage table exists.
- Production service categories and Billing plan entitlements must be supplied through approved configuration/reference data. Automated tests create isolated test categories and entitlements only.
- Contact unlock exposes the linked exact private address when present and safe display information; it does not expose account login email or invent phone fields.
- Administrative moderation remains backend-only; no mobile admin UI was added.

## Not run

- Manual end-to-end testing on physical iOS/Android devices.
- Browser-based visual verification of native mobile screens.
- Deployment to a shared or production environment.
- Live external Keycloak, Ably, or object-storage smoke testing beyond the repository's automated integration coverage.

## Changed-file scope

Changes are limited to the new Service Marketplace backend/mobile feature and tests, V13 integration migration, the required Messaging/Media/Billing integration corrections, Services navigation, and the Matchmaking migration-count assertion necessitated by V13. No unrelated Vehicle lint issues or other legacy warnings were modified.
