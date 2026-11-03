# DIASPORUM Polls Implementation Report

## Status

**The approved full-stack Polls implementation is complete and ready for review on `feature/polls`.** Backend and mobile Poll workflows, focused and regression tests, schema verification, and static checks have been executed.

Two unrelated repository issues remain explicitly qualified below: the repository-wide mobile lint command reports errors in untouched Vehicle files, and the canonical v10.12 smoke script stops at an existing social-model assertion before reaching its Poll assertions. The Poll-specific strict-schema assertions pass. Neither issue was hidden by changing unrelated source or approved SQL files.

No commit, push, merge, rebase, reset, or stash was performed. The approved plan file was not edited.

## Scope and Constraints

The implementation follows the approved Polls plan and v10.12 design:

- Polls remain part of the existing `feed` module.
- Poll posts use `feed_posts.post_type='POLL'` and the existing Poll child tables.
- The existing V1–V12 Flyway schema is sufficient; the migration directory still contains exactly V1–V12.
- No database migration, dependency, package manifest, or lockfile was added or modified.
- No files were deleted.
- Existing Feed pagination, ordinary posts, comments, reactions, saved posts, media attachments, and parent-post deletion remain in place.
- Notifications, Media, Moderation internals, and unrelated feature modules were not modified.
- Poll reporting delegates to the existing Moderation API using the shared `FEED_POST` target type.
- All work is uncommitted on `feature/polls` for user review.

## Implemented Backend Functionality

### Domain Rules and Validation

Added `PollRules` as a stateless domain helper for:

- Trimming and validating questions from 1 through 20,000 characters.
- Normalizing and validating ordered options from 1 through 250 characters each.
- Enforcing 2 through `maxOptions` options.
- Defaulting `maxOptions` to 10 and enforcing the supported range of 2–20.
- Rejecting duplicate options after trimming and case-insensitive comparison.
- Validating closing deadlines against database time.
- Deriving `ACTIVE`, `EXPIRED`, and `CLOSED` lifecycle states.
- Applying `IMMEDIATE`, `AFTER_VOTING`, and `AFTER_CLOSE` result visibility.
- Calculating percentages with distinct voters as the denominator, one decimal place, and half-up rounding.
- Returning `0.0` percentages when a visible Poll has zero voters.

Generic parent-post editing now applies `PollRules.question` whenever the parent is a Poll. Poll question updates through that route therefore cannot bypass trimming, blank-question rejection, or the 20,000-character limit. Non-Poll parent-post editing is unchanged.

### Typed REST Contracts

Added validated request records and shared response records for Poll creation, editing, voting, reporting, and Feed payloads.

The shared Poll response includes:

- Parent post ID and question.
- Lifecycle state and deadline/closure timestamps.
- Voting, withdrawal, change, anonymity, and result-visibility policies.
- Maximum option count.
- Ordered options with IDs and sort positions.
- Nullable option counts, percentages, voter totals, and vote totals when results are hidden.
- The current viewer's own option selections without exposing other voter identities.

### Transactional Creation

The dedicated Poll creation workflow:

1. Enforces the configured creation rate limit.
2. Validates Poll rules and policy values.
3. Uses existing Feed/community/category authorization.
4. Creates the parent post in DRAFT state.
5. Inserts Poll metadata and ordered options.
6. Publishes the parent post in the same transaction.
7. Returns the common typed Poll response.

Generic `POST /feed/posts` creation rejects `POLL`, preventing incomplete or non-transactional Poll creation.

### Retrieval and Feed Assembly

- Poll detail authorizes access through the existing parent-post rules.
- Poll state is derived using the database clock on every read.
- Results, counts, totals, and viewer selections are read from one consistent SQL snapshot.
- Feed pages batch-load Poll data for Poll posts only.
- Poll data is exposed as `payload.poll` using the same response semantics as Poll detail.
- Existing Feed sorting, cursor generation, pagination, and non-Poll payload behavior are retained.

### Editing and Lifecycle Management

- Authors and authorized community moderators can edit Polls within the lifecycle rules.
- Ordered options and voting/privacy policies are editable only before the first vote.
- Existing option IDs are preserved where possible during positional option updates.
- Question editing remains available under the applicable ownership rules.
- Deadline edits are allowed only while a Poll is active.
- Early closure sets the closure timestamp and actor transactionally.
- Repeated explicit close requests are idempotent.
- Closed or expired Polls cannot be reopened.
- Existing parent-post soft deletion remains the deletion mechanism.

### Voting

- Voting revalidates parent-post and active-community access.
- Poll row locks and per-Poll/user advisory locks serialize state changes.
- Current votes and policies are rechecked after locking.
- Same-option retries succeed without creating duplicate rows.
- Single-choice vote changes use an atomic `UPDATE`, not delete/reinsert.
- Changing a single-choice vote does not require withdrawal permission.
- Multiple-choice Polls allow one current vote per selected option.
- Withdrawal removes only the addressed option and requires withdrawal permission.
- Voting, changes, and withdrawal stop when a Poll is expired or explicitly closed.
- State and integrity races are mapped to conflict responses where appropriate.

### Results and Privacy

- `totalVoters` counts distinct current voters.
- `totalVotes` counts all current vote rows.
- Multiple-choice totals intentionally differ.
- Percentages use `optionVoteCount / totalVoters * 100`.
- Multiple-choice percentages may total more than 100%.
- Result visibility applies equally to creators and other viewers.
- Hidden aggregate values are serialized as `null`, not zero.
- A viewer's own selections remain visible when aggregate results are hidden.
- Anonymous Polls retain internal user-linked votes, but no voter directory or voter identities are exposed.

### Reporting and Rate Limits

- Added generic parent-post reporting through `ModerationApi` with target type `FEED_POST`.
- Report details are limited to 4,000 characters.
- Poll creation uses a database-backed rolling one-hour window over existing Poll post rows.
- New vote submissions use a database-backed rolling one-minute window over existing vote rows.
- Defaults are 10 creations per user per hour and 120 new vote rows per user per minute.
- Limits are configurable through:
  - `diasporum.feed.polls.create-per-hour`
  - `diasporum.feed.polls.vote-per-minute`
- Retries, vote changes, and withdrawals do not create new vote rows and therefore do not consume the new-vote quota.

## API Routes Implemented

All routes use the authenticated Diasporum principal; actor IDs are not accepted from request bodies.

| Method | Route | Result |
|---|---|---|
| `POST` | `/api/v1/feed/polls` | `201` with typed Poll response |
| `GET` | `/api/v1/feed/polls/{postId}` | Typed Poll response |
| `PATCH` | `/api/v1/feed/polls/{postId}` | Updated typed Poll response |
| `POST` | `/api/v1/feed/polls/options/{optionId}/vote` | Updated typed Poll response |
| `POST` | `/api/v1/feed/polls/{postId}/close` | Updated typed Poll response |
| `POST` | `/api/v1/feed/posts/{postId}/reports` | `201` with report ID |

Existing parent-post edit and delete routes remain the shared post operations.

## Implemented Mobile Functionality

### Typed Contracts and API

- Added strongly typed Poll lifecycle, result-visibility, option, response, create/update request, and shared report contracts.
- Added optional typed `payload.poll` support to Feed items while retaining other payload fields.
- Added typed Poll create, detail, update, vote/withdraw, close, and generic parent-post report methods through the existing API client.
- Poll mutation methods return authoritative typed Poll responses.

### Reusable Poll Components

`PollForm` supports:

- FEED category selection during creation.
- Question and ordered option editing with add/remove controls.
- Question, option, count, duplicate, and future-deadline validation matching the backend.
- Configurable maximum options and native closing date/time selection.
- Multiple-selection, vote-change, withdrawal, anonymity, and result-visibility policies.
- Create/edit request mapping with trimming.
- Preview, submitting state, post-vote configuration locking, and closed/expired read-only states.
- Omission of immutable options and policies from post-vote update requests.

`PollCard` supports:

- Single- and multiple-choice selection and submission.
- Atomic single-choice vote changes through one vote request.
- Sequential multiple-choice removals before additions.
- Duplicate-submission prevention while requests are in flight.
- Authoritative response propagation after each successful mutation.
- Preservation of successful earlier mutations if a later operation fails.
- Exact totals, percentages, progress indicators, zero-vote states, and hidden-result explanations.
- Vote-change/withdrawal policy enforcement and closed/expired states.
- Safe API and generic error messages without exposing internal error details.

### Creation, Editing, Feed, and Detail Workflows

- The existing composer now uses `PollForm` for Poll mode and requires an active FEED category.
- The Poll feature deep link is `/(app)/posts/create?mode=poll`.
- Poll creation retains entered values after errors and navigates back only after success.
- Existing non-Poll composer media upload and post behavior remains intact.
- The editor loads Poll detail and supports pre-vote configuration editing.
- After votes, options and policies are locked while the question and active deadline remain editable.
- An authoritative HTTP 409 also locks configuration when hidden results prevented the client from knowing that votes already existed.
- Closed and expired Polls are read-only.
- Poll management UI recognizes the backend roles `MODERATOR` and `COMMUNITY_ADMIN`.
- Feed items render one shared Poll card without duplicating the parent-post question.
- Vote and close responses update `payload.poll` through the existing in-place Feed update mechanism; pagination is not refreshed for a Poll mutation.
- Close and delete require confirmation; delete continues through the existing parent-post workflow.
- Non-owner Poll reporting uses the shared moderation reason set.
- Post detail loads Poll data only for Poll posts and retains existing post/comments behavior and voting.
- Community-switch coverage verifies that a Poll from the previous community is replaced by the active community's Feed data.

## Database and Migration Verification

No schema migration was needed or added.

`PollSchemaIntegrationTest` verifies on real PostgreSQL/PostGIS:

- A fresh V1–V12 schema has no failed Flyway entries and reaches version 12.
- Poll primary keys, foreign keys, option-order uniqueness, lifecycle triggers, and the vote user index exist.
- A populated current-schema database passes Flyway validation.
- Running migration again is a no-op.
- Existing Poll metadata, options, and votes survive the no-op upgrade.

The implementation did not enable or modify Flyway out-of-order migration behavior.

## Automated Verification Results

Commands were run from `diasporum-backend` or `diasporum-mobile` as appropriate. Backend integration tests used the existing Testcontainers `postgis/postgis:17-3.5` setup, not H2.

| Verification | Result |
|---|---|
| Backend full suite: `.\mvnw.cmd test` | **Passed — 318 tests, 0 failures, 0 errors, 0 skipped** |
| Backend architecture: `ModuleBoundaryTest` | **Passed — 26/26 tests**, included in the full suite |
| `PollRulesTest` | **7/7 passed** |
| `FeedModuleIntegrationTest` | **16/16 passed** |
| `PollModuleIntegrationTest` | **13/13 passed** |
| `PollSchemaIntegrationTest` | **1/1 passed** |
| Mobile full Jest suite: `npm test -- --runInBand` | **Passed — 34 suites, 349 tests** |
| Mobile TypeScript: `npm run typecheck` | **Passed**, rerun after the final test-only edits |
| Feed-scoped lint: `npm run lint -- src/features/feed src/__tests__/features/feed` | **Passed with no findings** |
| Repository-wide mobile lint: `npm run lint` | **Not clean: 4 unrelated errors and 11 unrelated warnings in untouched files** |
| Strict v10.12 clean-install SQL on disposable PostGIS | **Passed** |
| Canonical v10.12 smoke SQL | **Stopped before Poll checks on an unrelated existing social-model assertion** |
| Poll-specific strict-schema assertions | **Passed** |
| `git diff --check` | **Passed; no output** |
| Backend/mobile source conflict-marker scans | **No matches** |

### Focused Mobile Poll/Feed Coverage

The five directly relevant suites contain **71 passing tests**:

| Suite | Tests | Coverage |
|---|---:|---|
| `feed-api.test.ts` | 21 | Typed Poll create/detail/edit/vote/close/report requests plus existing Feed/Post API operations |
| `poll-form.test.tsx` | 21 | Validation, request mapping, category/question/options/deadline/policies, preview, locking, and read-only states |
| `poll-card.test.tsx` | 13 | Single/multiple voting, atomic changes, withdrawal, duplicate prevention, partial failure, results, visibility, lifecycle, and safe errors |
| `poll-workflows.test.tsx` | 15 | Create/deep link, error retention, editing/authorization, Feed mutation updates, close/delete/report, detail voting, and ordinary-post regression |
| `poll-community-switch.test.tsx` | 1 | Real `useFeed` replacement of Poll items after active-community changes |

Backend Poll tests cover validation boundaries, duplicate options, lifecycle and visibility rules, percentages, transactional rollback, typed Feed payloads, generic parent-post question validation, editing, voting, withdrawal, expiry, closure, membership changes, shared moderation reporting, rate limits, concurrency, HTTP contracts, voter privacy, schema objects, and populated no-op migration behavior.

## Canonical SQL Verification and Existing Smoke Issue

A separate disposable `postgis/postgis:17-3.5` container was used, without a named volume or host port. The persistent development database was not touched. The runtime reported PostgreSQL 17.5 and PostGIS 3.5.2.

1. `Diasporum_v10.12/Diasporum_v10_12_strict_clean_install.sql` completed successfully on the fresh database.
2. `Diasporum_v10.12/Diasporum_v10_12_Smoke_Test.sql` stopped at line 120 with `Follow/friendship social model is incomplete`, before its Poll assertions.
3. Inspection confirmed that canonical v10.12 SQL and backend V1 define directional `user_follows` and a `user_mutual_connections` view, with no `friendships` table. The smoke assertion expects `friendships`; this is an existing canonical smoke/schema mismatch outside the Polls change.
4. Poll-specific assertions equivalent to the smoke Poll checks were executed against the same strict installation. They confirmed all three required policy columns and all four required lifecycle triggers.
5. The disposable container was stopped and removed. No canonical SQL or smoke file was changed to bypass the failure.

## Non-Blocking and Unrelated Verification Findings

### Repository-Wide Mobile Lint

The full mobile lint command reports four `react-hooks/set-state-in-effect` errors in untouched Vehicle files:

- `src/features/vehicles/components/vehicle-form.tsx`
- `src/features/vehicles/screens/vehicles-screen.tsx`

It also reports eleven unrelated warnings in environment tests, security settings, authentication-provider sign-in, and messaging. No Poll or modified Feed file is implicated, and the Feed-scoped lint command is clean. Those unrelated files were not changed to manufacture a green repository-wide lint result.

### Runtime Warnings

- Maven emitted metadata-repository HTTP 401 warnings that did not block compilation or tests.
- Backend test shutdown emitted Hikari connection warnings, and Surefire reported killing its fork after `System.exit(0)` lingered for 30 seconds. Maven still finished with `BUILD SUCCESS` and all 318 tests passing.
- Existing Events tests emit React `act(...)` environment warnings, and API-client tests intentionally log warnings for exercised error scenarios. All mobile suites still pass.

## Test Issues Resolved During Implementation

- Jest workflow mock factories referenced shared router/navigation variables before initialization. Lazy router getters and function wrappers fixed the mock lifecycle without changing production navigation.
- Successful editor workflow tests now await the delayed navigation timer, preventing timers from surviving teardown.
- React Native Testing Library rendering and interaction calls were aligned with the installed asynchronous testing-library behavior.
- Community-switch mocking used a Jest-safe mock variable name, and probe capture moved into an effect to satisfy React Compiler rules.
- A concurrency test lambda required a `Callable` return value so its checked `InterruptedException` was valid.
- A zero-vote test incorrectly expected visible totals under default `AFTER_VOTING`; it now uses `IMMEDIATE` visibility.
- A schema test incorrectly assumed 12 successful Flyway history rows. It now asserts no failed entries and a maximum migration version of 12, matching the repository's migration history behavior.

## Files Added

### Backend

- `diasporum-backend/src/main/java/com/diasporum/backend/feed/internal/domain/PollRules.java`
- `diasporum-backend/src/main/java/com/diasporum/backend/feed/internal/api/rest/PollRequests.java`
- `diasporum-backend/src/main/java/com/diasporum/backend/feed/internal/api/rest/PollResponses.java`
- `diasporum-backend/src/test/java/com/diasporum/backend/feed/PollRulesTest.java`
- `diasporum-backend/src/test/java/com/diasporum/backend/feed/PollModuleIntegrationTest.java`
- `diasporum-backend/src/test/java/com/diasporum/backend/feed/PollSchemaIntegrationTest.java`

### Mobile

- `diasporum-mobile/src/features/feed/components/poll-form.tsx`
- `diasporum-mobile/src/features/feed/components/poll-card.tsx`
- `diasporum-mobile/src/__tests__/features/feed/poll-form.test.tsx`
- `diasporum-mobile/src/__tests__/features/feed/poll-card.test.tsx`
- `diasporum-mobile/src/__tests__/features/feed/poll-workflows.test.tsx`
- `diasporum-mobile/src/__tests__/features/feed/poll-community-switch.test.tsx`

### Report

- `DIASPORUM_POLLS_REPORT.md`

## Files Modified

### Backend

- `diasporum-backend/src/main/java/com/diasporum/backend/feed/internal/application/FeedService.java`
- `diasporum-backend/src/main/java/com/diasporum/backend/feed/internal/api/rest/FeedController.java`
- `diasporum-backend/src/main/resources/application.yaml`
- `diasporum-backend/src/test/java/com/diasporum/backend/feed/FeedModuleIntegrationTest.java`

### Mobile

- `diasporum-mobile/src/features/feed/types/feed-types.ts`
- `diasporum-mobile/src/features/feed/services/feed-api.ts`
- `diasporum-mobile/src/features/feed/components/post-item.tsx`
- `diasporum-mobile/src/features/feed/screens/create-post-screen.tsx`
- `diasporum-mobile/src/features/feed/screens/edit-post-screen.tsx`
- `diasporum-mobile/src/features/feed/screens/home-feed-screen.tsx`
- `diasporum-mobile/src/features/feed/screens/post-detail-screen.tsx`
- `diasporum-mobile/src/__tests__/features/feed/feed-api.test.ts`

## Final Review Conclusion

All approved Poll implementation tasks have corresponding backend/mobile code and automated coverage. The complete backend and mobile test suites, backend module boundaries, mobile TypeScript, Feed-scoped lint, strict schema installation, Poll schema assertions, whitespace checks, and conflict-marker scans pass.

The branch is ready for user review. Repository-wide mobile lint and the canonical full smoke script are not globally green for the unrelated reasons documented above; no Poll verification failure remains outstanding.
