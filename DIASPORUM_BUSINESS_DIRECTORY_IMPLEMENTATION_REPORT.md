# Business Directory Implementation Report

## Scope and result

Implemented the approved v10.12 Business Directory plan across the Spring Boot backend and Expo mobile application. The implementation covers profile ownership and lifecycle, category and visibility rules, branches and opening hours, media, published-only discovery, reviews, saves, verification, reporting, and BUSINESS_PROFILE contact delegation.

The approved plan file was not modified. The existing `feature/business-directory` branch was rebased for integration review; no additional branch or worktree was created. No commits, pushes, pull requests, merges, or Next.js consumer screens were added. No bottom-navigation tabs were changed.

## Backend implementation

### Persistence and shared-module integration

- Added `V8__business_directory_operations.sql` with active-branch and timezone fields, logo support, single-logo enforcement, and discovery indexes. Earlier migrations were not changed; Messaging M4 owns V6 and Jobs owns V7.
- Extended the existing media service to accept BUSINESS JPEG, PNG, and WebP uploads while preserving MESSAGE_IMAGE, MESSAGE_DOCUMENT, and JOB validation. Directory media uses the existing R2 upload/complete/delete flow and parent-authorized signed download URLs.
- Reused Business Accounts for live membership and OWNER/ADMINISTRATOR/EDITOR authorization, communities and identity for visibility, shared addresses for branches, shared reports/moderation/audit tables, and existing BUSINESS_PROFILE messaging.

### Directory APIs and policies

- Added thin `/api/v1` REST endpoints and JDBC application services for profile creation, editing, publication, unpublication, soft deletion, and managed collections.
- Enforced exactly one personal or Business Account owner, active categories, contact-field validation, HTTP(S) websites, community membership/visibility, and manager-only access to non-public profiles.
- Added global/country category administration and audited verification transitions restricted to scoped platform staff.
- Added published-only discovery with keyword, category, country, city, community, verification, and PostGIS nearby filters. Newest and distance pages use opaque keyset cursors with a maximum size of 50.
- Added branch CRUD/deactivation, one primary branch, shared PUBLIC addresses, IANA timezone validation, and complete seven-day opening-hours replacement.
- Added logo/cover/gallery attachment, role uniqueness, ordering, detachment, deletion, and visibility-checked signed downloads.
- Added one current 1–5 review per user, owner edit/delete, cursor pages, trigger-maintained aggregate reads, manager responses, and shared BUSINESS/BUSINESS_REVIEW reports.
- Added idempotent save/unsave and cursor-paginated saved listings with current visibility checks.
- Added manager verification requests, staff approve/reject/revoke transitions, and directory contact delegation to the existing messaging policy.

Public DTOs do not expose exact geographic points, R2 keys, or private Business Account workspace details.

## Mobile implementation

- Added typed directory DTOs and API methods for all consumer and manager operations, including BUSINESS media upload/complete/attach and parent-authorized image downloads.
- Added reusable cards, form controls, reporting, review, and signed-image components.
- Added discovery/search, category and community filters, verified and nearby sorting, refresh, loading/empty/error states, and cursor pagination.
- Added public details with branches, timezone-labelled hours, gallery, reviews, owner responses, reports, saves, and contact navigation.
- Added saved and managed collections, personal/account-owned creation and editing, lifecycle controls, branch/hours editing, media role/order management, verification requests, and confirmed destructive actions.
- Connected Explore to Businesses and Business Workspace to account-filtered Business Profiles without adding tabs.
- Nearby search accepts explicit latitude, longitude, and kilometre radius; no new device-geolocation dependency was introduced.

## Post-Messaging-M4 and Jobs integration review

- Rebased the existing branch onto final base `cccb50de273615faa1e38a69c31d038efcf345b9` (`cccb50d`, merge PR #4 from `feature/jobs`). `HEAD`, `origin/main`, and the merge base are identical; all implementation changes remain uncommitted on top of that base.
- Final Flyway sequence is V1 baseline, V2 authentication cleanup, V3 onboarding relaxation, V4 events lifecycle, V5 events voice-room boundary, V6 Messaging M4 attachments, V7 Jobs, and V8 Business Directory. No temporary Jobs migration remains in the tree.
- `MediaService.java` differs from merged Jobs main only by adding BUSINESS image support. Shared lifecycle tests exercise MESSAGE_IMAGE, MESSAGE_DOCUMENT, JOB, and BUSINESS through presigned upload, storage-head completion, READY/purpose validation, owner and parent-authorized signed downloads, non-owner rejection, and deletion.
- Messaging participant and nonparticipant attachment-download checks remain in place. Jobs job-media downloads retain `requireViewable` plus `job_media` link checks, and resume downloads retain applicant-or-live-manager authorization. Directory downloads retain profile visibility and `business_media` link checks.
- Business Directory reads `business_categories`; Jobs reads `job_categories`. The integration suite verifies that a Directory category is not present in the Jobs taxonomy.
- Personal/account ownership, live OWNER/ADMINISTRATOR/EDITOR membership and revocation, country/community visibility, branch management and public-address privacy, and staff-only audited verification remain covered. Explore retains both Jobs and Businesses navigation.
- R2 behavior was verified through the existing `StorageClient` contract with test fakes and real PostgreSQL/PostGIS; no live Cloudflare R2 credentials or bucket were used.

## Verification results

| Check | Exact result |
|---|---|
| Backend full suite: `./mvnw.cmd clean test` | **PASS — BUILD SUCCESS; 256 tests, 0 failures, 0 errors, 0 skipped** |
| Backend directory integration suite | **PASS — 12 tests, 0 failures, 0 errors, 0 skipped** using real PostgreSQL/PostGIS Testcontainers, including fresh V1→V8 and V6+V7→V8 upgrade migration coverage |
| Backend ArchUnit `ModuleBoundaryTest` | **PASS — 26 tests, 0 failures, 0 errors, 0 skipped** |
| Mobile focused directory suites | **PASS — 2 suites, 16 tests, 0 failures** (8 API and 8 UI) |
| Mobile full suite: `npm test -- --runInBand` | **PASS — 21 suites, 216 tests, 0 failures** |
| Mobile TypeScript: `npm run typecheck` | **PASS — 0 errors** |
| Directory/mobile integration focused lint | **PASS — 0 errors, 0 warnings** |
| Expo public config: `expo config <project-dir> --type public --json` | **PASS — SDK 58.0.0 config resolved; typed routes enabled** |
| Mobile full lint: `npm run lint` | **NOT CLEAN — 11 errors and 11 warnings, all in pre-existing files outside the Business Directory changes** |

The remaining full-lint errors are in `src/features/feed/components/community-drawer.tsx` (`react-hooks/refs` and `react-hooks/set-state-in-effect`). Ten warnings are in the pre-existing `env.test.ts`, `security.tsx`, and `provider-signin.ts` files, and one is in the merged Messaging `use-thread.ts` hook. These unrelated files were not refactored. Business Directory files are absent from the final full-lint findings.

The full mobile test run also retains pre-existing non-fatal React `act(...)` console noise in the Events tests. The new Business Directory UI suite enables the act environment and awaits render/events correctly.

## Changed files

### Backend

- `diasporum-backend/src/main/java/com/diasporum/backend/businessdirectory/internal/api/rest/BusinessDirectoryController.java`
- `diasporum-backend/src/main/java/com/diasporum/backend/businessdirectory/internal/application/BusinessBranchService.java`
- `diasporum-backend/src/main/java/com/diasporum/backend/businessdirectory/internal/application/BusinessDirectoryAdminService.java`
- `diasporum-backend/src/main/java/com/diasporum/backend/businessdirectory/internal/application/BusinessDirectoryService.java`
- `diasporum-backend/src/main/java/com/diasporum/backend/businessdirectory/internal/application/BusinessEngagementService.java`
- `diasporum-backend/src/main/java/com/diasporum/backend/businessdirectory/internal/application/DirectoryAuthorization.java`
- `diasporum-backend/src/main/java/com/diasporum/backend/businessdirectory/internal/application/DirectorySupport.java`
- `diasporum-backend/src/main/java/com/diasporum/backend/businessdirectory/internal/domain/DirectoryTypes.java`
- `diasporum-backend/src/main/java/com/diasporum/backend/media/internal/application/MediaService.java`
- `diasporum-backend/src/main/java/com/diasporum/backend/messaging/internal/application/MessagingService.java` (two comment-byte encoding corrections only)
- `diasporum-backend/src/main/resources/db/migration/V8__business_directory_operations.sql`
- `diasporum-backend/src/test/java/com/diasporum/backend/businessdirectory/BusinessDirectoryModuleIntegrationTest.java`
- `diasporum-backend/src/test/java/com/diasporum/backend/media/MediaModuleIntegrationTest.java`
- `diasporum-backend/src/test/java/com/diasporum/backend/messaging/MessagingAttachmentIntegrationTest.java`

### Mobile routes

- `diasporum-mobile/src/app/(app)/businesses/index.tsx`
- `diasporum-mobile/src/app/(app)/businesses/saved.tsx`
- `diasporum-mobile/src/app/(app)/businesses/manage.tsx`
- `diasporum-mobile/src/app/(app)/businesses/create.tsx`
- `diasporum-mobile/src/app/(app)/businesses/[businessId]/index.tsx`
- `diasporum-mobile/src/app/(app)/businesses/[businessId]/edit.tsx`
- `diasporum-mobile/src/app/(app)/businesses/[businessId]/manage.tsx`
- `diasporum-mobile/src/app/(app)/businesses/[businessId]/branch.tsx`

### Mobile feature and integration

- `diasporum-mobile/src/features/business-directory/components/business-card.tsx`
- `diasporum-mobile/src/features/business-directory/components/business-image.tsx`
- `diasporum-mobile/src/features/business-directory/components/business-reviews.tsx`
- `diasporum-mobile/src/features/business-directory/components/directory-ui.tsx`
- `diasporum-mobile/src/features/business-directory/components/report-form.tsx`
- `diasporum-mobile/src/features/business-directory/screens/branch-form-screen.tsx`
- `diasporum-mobile/src/features/business-directory/screens/business-collection-screen.tsx`
- `diasporum-mobile/src/features/business-directory/screens/business-detail-screen.tsx`
- `diasporum-mobile/src/features/business-directory/screens/business-form-screen.tsx`
- `diasporum-mobile/src/features/business-directory/screens/businesses-screen.tsx`
- `diasporum-mobile/src/features/business-directory/screens/manage-business-screen.tsx`
- `diasporum-mobile/src/features/business-directory/services/directory-api.ts`
- `diasporum-mobile/src/features/business-directory/types/directory-types.ts`
- `diasporum-mobile/src/features/business/screens/business-workspace-screen.tsx`
- `diasporum-mobile/src/features/feed/screens/explore-screen.tsx`
- `diasporum-mobile/src/__tests__/features/business-directory/directory-api.test.ts`
- `diasporum-mobile/src/__tests__/features/business-directory/directory-ui.test.tsx`

### Report

- `DIASPORUM_BUSINESS_DIRECTORY_IMPLEMENTATION_REPORT.md`

## Assumptions and verification limits

- Creation and country discovery use the signed-in profile's current country. Active-community discovery is applied only when explicitly selected.
- Branch editing leaves coordinate inputs blank by default so public discovery coordinates cannot accidentally overwrite stored exact coordinates; clearing coordinates is explicit.
- Existing selected-community assignments remain unchanged during profile edits unless the manager changes the selection.
- One opening period is stored per weekday, as specified by the approved plan.
- Fresh-database V1→V8 migration and a separate upgrade from a real Flyway V7 database containing Messaging M4 V6 and Jobs V7 to Business Directory V8 were verified in PostgreSQL/PostGIS Testcontainers. No production database was used.
- Mobile API and UI behavior was verified with mocked native/session boundaries. No physical-device, simulator, browser, Keycloak, live-R2, or end-to-end messaging run was performed.
- Expo public config validation passed; Expo Doctor and native iOS/Android builds were not run.
- No live production deployment or manual moderation workflow was performed.
