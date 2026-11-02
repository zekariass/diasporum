# Diasporum Jobs Module Implementation Report

## Outcome

The Jobs module is implemented across the Spring Boot/PostgreSQL backend and Expo React Native mobile application. The implementation includes personal and Business Account ownership, listing lifecycle and discovery, media, saved jobs, reporting, internal and external applications, applicant/employer privacy, mobile workflows, and focused plus full-suite validation.

All work remains uncommitted on `feature/jobs`. No commit, push, merge, branch switch, worktree operation, or edit to an earlier migration was performed.

## Backend Architecture

The Jobs implementation follows the existing modular-monolith boundaries:

- `jobs.internal.api.rest.JobController` is a thin versioned REST adapter. It validates request DTOs and obtains the actor exclusively from `DiasporumUserPrincipal`.
- `jobs.internal.application.JobService` owns listing CRUD, discovery, lifecycle, categories, media references, saved jobs, reporting, and owner collections.
- `jobs.internal.application.JobApplicationService` owns internal applications, applicant/employer collections, withdrawal, résumé access, and review transitions.
- `jobs.internal.application.JobAuthorization` centralizes personal/business management and participation checks.
- Persistence uses parameterized `JdbcTemplate` SQL and transactions rather than introducing a new persistence or service stack.
- Integration uses existing public module APIs: `CommunityApi`, `IdentityApi`, `TaxonomyApi`, `BusinessAccountsApi`, and `MediaApi`.
- Contextual contact continues through the existing Messaging API with `contextType: "JOB_LISTING"`; Jobs has no Messaging module code dependency and adds no messaging endpoint.

### Ownership and Authorization

- Personal listings use `employer_user_id`; the baseline `owner_user_id` ownership context is also populated.
- Business listings use `business_account_id`, while `posted_by_user_id` records the acting user.
- Every Business Account write rechecks an ACTIVE account, accepted non-revoked membership, and one of `OWNER`, `ADMINISTRATOR`, `EDITOR`, or `LISTING_MANAGER`.
- Client-supplied actor or owner identity is never trusted.
- Job images and application résumés are downloadable only after listing-visibility or application participant/owner authorization.
- Applicant materials are exposed only to the applicant and authorized hiring managers.

### Lifecycle and Validation

- The exact existing status model is retained: `DRAFT`, `PAUSED`, `PUBLISHED`, `CLOSED`, and `EXPIRED`.
- Invalid lifecycle transitions are rejected. Listings whose deadlines have passed are lazily expired.
- Publishing requires valid publishable data, categories, and a future deadline where applicable.
- Creation can atomically create a draft, attach categories/media, and publish in the same transaction.
- Published primary-category immutability is preserved; mobile edit payloads omit category IDs for published jobs.
- Soft deletion sets `deleted_at` and retains applications and audit history without adding a new status enum.
- External HTTP(S) URLs are parsed with `java.net.URI`; credentials, fragments, and non-web schemes are rejected.
- Public location data contains city, region, and formatted address only; exact coordinates are not exposed.

### Discovery, Applications, Saves, and Reports

- Discovery uses PostgreSQL full-text search and whitelist filters for community/scope, category, employment type, workplace type, city, salary range, and publication dates.
- `NEWEST` and `CLOSING` sorts use bounded keyset cursors.
- Default community discovery uses the persisted active community. Country discovery requires the viewer's current country. Explicit community reads do not treat profile country data as membership.
- Viewer saved/application state and manager permissions are batch-derived for returned rows.
- Internal applications require a published, unexpired `INTERNAL` listing, a non-owner applicant, an optional authorized ready DOCUMENT résumé, and respect `(job_id, applicant_id)` uniqueness.
- External applications open the validated external URL and never create an application row.
- Applicants can read and withdraw their own applications. Authorized managers can review applications and advance them through the allowed transition graph; terminal states are protected.
- Save/unsave is idempotent and visibility checked. Saved collections exclude unavailable listings.
- Reporting writes the existing `reports` table using target type `JOB` and existing reason/status enums. A partial unique index and conflict mapping prevent duplicate open reports.

## Database Migration

`V7__jobs_module.sql` is the only new migration. Earlier migrations were not changed.

The v10.12 baseline already contained Business Account ownership and the contextual-messaging foreign key. Messaging M4 owns `V6__messaging_m4_attachments.sql`, so Jobs follows it as V7 and adds only the missing soft-deletion column and supporting indexes:

- `job_listings.deleted_at`.
- Personal and Business Account ownership/cursor indexes.
- Published newest and closing-soon discovery indexes.
- Saved-job and applicant-application cursor indexes.
- A Jobs-only partial unique index for one open report per reporter/listing.

Existing ownership, published-category, and `JOB_LISTING` messaging triggers remain in force.

## REST API

### Listings, Discovery, and Media

| Method | Endpoint                                            | Purpose                                             |
| ------ | --------------------------------------------------- | --------------------------------------------------- |
| GET    | `/api/v1/jobs/categories`                           | Job-owned categories, optionally by country         |
| POST   | `/api/v1/jobs`                                      | Create a draft or publish a listing                 |
| GET    | `/api/v1/jobs`                                      | Search, filter, sort, and cursor-paginate discovery |
| GET    | `/api/v1/jobs/{jobId}`                              | Authorized listing detail                           |
| PATCH  | `/api/v1/jobs/{jobId}`                              | Manager-only listing update                         |
| POST   | `/api/v1/jobs/{jobId}/publish`                      | Publish/reopen according to lifecycle rules         |
| POST   | `/api/v1/jobs/{jobId}/close`                        | Close a listing                                     |
| DELETE | `/api/v1/jobs/{jobId}`                              | Soft-delete a listing                               |
| GET    | `/api/v1/jobs/{jobId}/media/{mediaId}/download-url` | Authorized JOB media download                       |
| PUT    | `/api/v1/jobs/{jobId}/save`                         | Idempotently save a visible listing                 |
| DELETE | `/api/v1/jobs/{jobId}/save`                         | Idempotently unsave a listing                       |
| POST   | `/api/v1/jobs/{jobId}/report`                       | Create a moderated JOB report                       |

### Owned and Saved Listings

| Method | Endpoint                | Purpose                                                |
| ------ | ----------------------- | ------------------------------------------------------ |
| GET    | `/api/v1/me/jobs`       | Cursor-paginated personal/business-manageable listings |
| GET    | `/api/v1/me/jobs/saved` | Cursor-paginated available saved listings              |

### Applications

| Method | Endpoint                                                       | Purpose                                          |
| ------ | -------------------------------------------------------------- | ------------------------------------------------ |
| POST   | `/api/v1/jobs/{jobId}/applications`                            | Submit an internal application                   |
| GET    | `/api/v1/jobs/{jobId}/applications`                            | Manager-only, status-filterable application page |
| GET    | `/api/v1/me/job-applications`                                  | Applicant's cursor-paginated applications        |
| GET    | `/api/v1/job-applications/{applicationId}`                     | Participant/manager application detail           |
| PATCH  | `/api/v1/job-applications/{applicationId}`                     | Authorized employer status transition            |
| POST   | `/api/v1/job-applications/{applicationId}/withdraw`            | Applicant withdrawal                             |
| GET    | `/api/v1/job-applications/{applicationId}/resume/download-url` | Authorized résumé download URL                   |

## Mobile Application

The mobile feature uses the shared authenticated API client, active-community session, theme, state components, pull-to-refresh, cursor pagination, confirmation dialogs, media upload lifecycle, and business workspace catalogue.

Implemented screens and components cover:

- Discovery with debounced search, filters, sorting, refresh, pagination, and loading/error/empty states.
- Listing cards and details with save/unsave, report, external application, internal application state, and existing contextual contact.
- Create/edit forms for personal/business ownership, classifications, categories, public location, salary, deadline, application method, source data, and optional JOB images.
- Deadline validation includes impossible-calendar-date detection; unsafe URLs and invalid salary/location/classification inputs are rejected before submission.
- Owner collections and lifecycle actions, including publish, pause/close behavior, edit, and delete confirmation.
- Saved jobs with refresh and pagination.
- Internal applications with a cover letter and optional DOCUMENT résumé selection/upload.
- Applicant application history and detail with withdrawal.
- Employer application collections with status filters, applicant context, review transitions, terminal-action confirmations, and authorized résumé opening.
- Backend authorization/transition failures are shown without prematurely changing displayed application state.

Expo Router wrappers were added for discovery, detail, create, edit, owned jobs, saved jobs, apply, applicant history, employer applications, and application detail.

Navigation is limited to the approved existing entry points:

- Create Sheet: create Job.
- Profile: Jobs discovery card.
- Explore: Jobs header shortcut.

No tab or Next.js consumer functionality was added.

## Validation Evidence

| Validation                                               | Result                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------- |
| Focused PostgreSQL/Testcontainers Jobs integration tests | 13 passed, including fresh and post-M4 migration scenarios  |
| Focused `ModuleBoundaryTest` / ArchUnit boundaries       | 26 passed                                                   |
| Focused mobile Jobs Jest suites                          | 4 suites, 34 tests passed                                   |
| Full backend `.\mvnw test`                               | 244 tests, 0 failures, 0 errors, 0 skipped; `BUILD SUCCESS` |
| Full mobile `npm test -- --runInBand`                    | 19 suites, 200 tests passed                                 |
| Mobile `npm run typecheck`                               | Passed                                                      |
| `git diff --check`                                       | Passed; no whitespace errors                                |

Backend integration coverage includes migration behavior, CRUD/lifecycle, search/filter/cursors, community/country visibility, personal/business/revoked authorization, media, application privacy/transitions/duplicates, saves, reports, URL validation, authentication, and IDOR behavior.

Mobile tests cover API wiring, discovery/filter/pagination/states, detail actions, save/external apply/contact, editor validation and lifecycle payloads, internal application and résumé upload, withdrawal, saved jobs, applicant/employer collections, employer transitions, and authorization errors.

### Post-Messaging-M4 Integration Review

- `feature/jobs` was rebased onto fetched `origin/main` at `09041fa28d3cc4cf73bbcc4f9c93320c660e06ba` (`Merge pull request #3 from zekariass/feature/messaging-m4`). The final `HEAD` and `origin/main` hashes are identical; Jobs remains entirely uncommitted on top of that base.
- Restoring the uncommitted Jobs work caused one content conflict in `MediaService.java`. It was resolved by preserving M4's complete allowlist, including `MESSAGE_IMAGE` and `MESSAGE_DOCUMENT`, and adding only the `JOB` image entry. No conflict remains.
- Final migration sequence ends with `V6__messaging_m4_attachments.sql` followed by `V7__jobs_module.sql`. No earlier migration was edited.
- PostgreSQL integration tests verify both a fresh V1–V7 installation and an installation first migrated only through M4 V6 and then upgraded to Jobs V7. Both preserve the M4/JOB media constraint and create the Jobs schema objects successfully.
- A media integration test completes upload lifecycles and attachment validation for `JOB`, `MESSAGE_IMAGE`, and `MESSAGE_DOCUMENT`. Messaging M4's 13 attachment integration tests also pass.
- The combined focused backend run passed 58 tests: 13 Jobs, 6 Media, 13 Messaging Attachment, and 26 ArchUnit tests.
- Final full backend result: 244 tests passed, 0 failures/errors/skipped.
- Final mobile results: TypeScript passed; focused Jobs passed 4 suites/34 tests; full mobile passed 19 suites/200 tests.
- The combined discovery/debounce/pagination UI test initially exceeded Jest's 5-second default under load. Its timeout was raised to 15 seconds without changing production behavior; both final mobile runs passed.
- Final dependency review found only existing public backend module APIs in Jobs and existing merged mobile Business/Messaging services. ArchUnit passed, and no dependency on an unmerged feature was introduced.

### Pre-existing Repository Issues

These remain unchanged because they are unrelated to Jobs:

- `npm run lint` still reports 11 errors and 10 warnings. The remaining errors are in `src/features/feed/components/community-drawer.tsx`; warnings are in existing environment, security, and authentication files. No Jobs lint errors remain.
- `npx expo-doctor` passes 19/20 checks. Existing patch-version mismatches remain for `@expo/ui` (expected `~58.0.26`, found `58.0.25`), `expo` (expected `~58.0.22`, found `58.0.21`), and `expo-router` (expected `~58.0.29`, found `58.0.28`).
- Full mobile tests emit existing non-fatal Events `act(...)` console warnings and expected API warning logs, but all tests pass.

## Changed Files

### Backend

- `diasporum-backend/src/main/java/com/diasporum/backend/jobs/internal/api/rest/JobController.java` — new.
- `diasporum-backend/src/main/java/com/diasporum/backend/jobs/internal/application/JobApplicationService.java` — new.
- `diasporum-backend/src/main/java/com/diasporum/backend/jobs/internal/application/JobAuthorization.java` — new.
- `diasporum-backend/src/main/java/com/diasporum/backend/jobs/internal/application/JobService.java` — new.
- `diasporum-backend/src/main/java/com/diasporum/backend/media/internal/application/MediaService.java` — modified to allow JOB uploads.
- `diasporum-backend/src/main/resources/db/migration/V7__jobs_module.sql` — new.
- `diasporum-backend/src/test/java/com/diasporum/backend/jobs/JobsModuleIntegrationTest.java` — new.
- `diasporum-backend/src/test/java/com/diasporum/backend/media/MediaModuleIntegrationTest.java` — modified for M4/Jobs upload regression coverage.

### Mobile Feature, Routes, and Navigation

- `diasporum-mobile/src/features/jobs/components/job-card.tsx` — new.
- `diasporum-mobile/src/features/jobs/components/job-form.tsx` — new.
- `diasporum-mobile/src/features/jobs/screens/job-application-detail-screen.tsx` — new.
- `diasporum-mobile/src/features/jobs/screens/job-applications-screen.tsx` — new.
- `diasporum-mobile/src/features/jobs/screens/job-apply-screen.tsx` — new.
- `diasporum-mobile/src/features/jobs/screens/job-collection-screen.tsx` — new.
- `diasporum-mobile/src/features/jobs/screens/job-detail-screen.tsx` — new.
- `diasporum-mobile/src/features/jobs/screens/job-editor-screen.tsx` — new.
- `diasporum-mobile/src/features/jobs/screens/jobs-screen.tsx` — new.
- `diasporum-mobile/src/features/jobs/services/job-api.ts` — new.
- `diasporum-mobile/src/features/jobs/types/job-types.ts` — new.
- `diasporum-mobile/src/features/jobs/utils/job-format.ts` — new.
- `diasporum-mobile/src/app/(app)/jobs/index.tsx` — new.
- `diasporum-mobile/src/app/(app)/jobs/[id].tsx` — new.
- `diasporum-mobile/src/app/(app)/jobs/create.tsx` — new.
- `diasporum-mobile/src/app/(app)/jobs/edit/[id].tsx` — new.
- `diasporum-mobile/src/app/(app)/jobs/my.tsx` — new.
- `diasporum-mobile/src/app/(app)/jobs/saved.tsx` — new.
- `diasporum-mobile/src/app/(app)/jobs/apply/[id].tsx` — new.
- `diasporum-mobile/src/app/(app)/jobs/my-applications.tsx` — new.
- `diasporum-mobile/src/app/(app)/jobs/applications/[id].tsx` — new.
- `diasporum-mobile/src/app/(app)/jobs/application/[id].tsx` — new.
- `diasporum-mobile/src/app/(app)/(tabs)/profile.tsx` — modified for Jobs navigation.
- `diasporum-mobile/src/features/feed/screens/explore-screen.tsx` — modified for Jobs navigation.
- `diasporum-mobile/src/shared/components/create-sheet.tsx` — modified to enable Job creation.

### Mobile Tests

- `diasporum-mobile/src/__tests__/features/jobs/job-api.test.ts` — new.
- `diasporum-mobile/src/__tests__/features/jobs/job-applications-ui.test.tsx` — new.
- `diasporum-mobile/src/__tests__/features/jobs/job-form.test.ts` — new.
- `diasporum-mobile/src/__tests__/features/jobs/jobs-ui.test.tsx` — new.

### Report

- `DIASPORUM_JOBS_IMPLEMENTATION_REPORT.md` — new.

## Assumptions and Limitations

- The v10.12 baseline schema, enums, ownership/context triggers, and `JOB_LISTING` messaging integration are authoritative.
- Business authorization and application privacy are enforced server-side; mobile capability flags are presentation aids, not security boundaries.
- Mobile résumé selection supports PDF, DOC, DOCX, and TXT, a subset of the backend DOCUMENT allowlist.
- Signed media upload/download behavior is covered through mocked mobile tests and backend authorization tests; no live object-store or manual device end-to-end run was performed.
- Unrelated lint and Expo dependency issues were not remediated, and no unrelated Next.js, infrastructure, payment, or recruitment features were added.

## Git Status

Final branch: `feature/jobs`.

The working tree contains only the Jobs implementation, its tests, this report, and the approved media/navigation integration changes listed above. All changes are unstaged/uncommitted. No files were deleted, and no dependency manifest changes were introduced.
