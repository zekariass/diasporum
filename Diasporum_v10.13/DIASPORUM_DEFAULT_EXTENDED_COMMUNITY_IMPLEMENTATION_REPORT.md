# Diasporum Default and Extended Community Implementation Report

**Implementation date:** 7 November 2026  
**Architecture baseline:** Diasporum v10.13 and the existing backend/mobile repositories  
**Status:** Implemented; clean backend and mobile automated regressions passed. Production rollout and authenticated device/browser verification remain outstanding.

## 1. Scope and architecture decision

The Default and Extended Community model was applied to the existing platform rather than implemented as a parallel community, identity, Billing or feature-management system.

Preserved boundaries include:

- `communities`, `community_memberships` and `user_settings` for community membership and active context.
- `profiles.origin_country_id` and `profiles.current_country_id` for Default/Extended classification.
- The Spring Boot modular monolith and public cross-module APIs.
- Existing Feed, Reels, Community Help, Matchmaking, Media, Messaging and administration services.
- Existing Billing plans, entitlements, grants, usage records, feature flags and access rules.
- Existing `idempotency_keys`, audit records and transactional service boundaries.
- The Expo/React Native application and its shared session, API-client and navigation infrastructure.

No duplicate identity, membership, match, conversation, payment or publication model was introduced.

## 2. Implemented backend behavior

### 2.1 Community resolution and central authorization

`CommunityAccessPolicyService` and the public `CommunityApi` now provide centralized context and action decisions.

- Default requires matching origin and current countries, an active community and an active membership.
- Extended (`ORIGIN_EXTENDED`) requires the same origin country, a different destination country and an explicitly joined active membership.
- An active account, active community, active membership and valid origin relationship are mandatory.
- Default Communities retain normal module access subject to existing roles, moderation, rollout, entitlement, privacy and security rules.
- Extended Communities expose only Feed, Reels, Matchmaking and Community Help & Offers.
- Unknown or unavailable capabilities fail closed; client-supplied capability or Billing decisions are not authoritative.
- `GET /api/v1/communities/my-access` exposes server-derived contexts and effective module maps.
- `GET /api/v1/me/community-actions/{actionKey}/eligibility` exposes non-mutating action eligibility for confirmation UX.

The broad REST interceptor denies restricted Extended modules on direct API attempts. Account-level settings, notifications and existing direct conversations remain available under their existing authorization rules. MVC-only test slices without database-backed Community services skip interceptor registration; full application contexts retain the enforcement boundary.

### 2.2 Switching and country reconciliation

- Active-community switching is authorized against current membership and persists through existing user settings.
- Current-country changes resolve and activate the new Default Community.
- Origin-country changes end memberships that no longer have a valid origin relationship and select a valid context.
- Historical posts, Help rows, swipes, matches, conversations and Billing usage are not deleted by reconciliation.
- Scoped `COMMUNITY_MODULE_{MODULE}` flags can further restrict modules but cannot expand the Extended allow-list.

### 2.3 Extended Billing and audit

The following existing-Billing features were added as monthly, community-targeted quota features:

| Successful action                  | Feature key                               |
| ---------------------------------- | ----------------------------------------- |
| GENERAL Feed publication           | `EXTENDED_FEED_POST_PUBLISH`              |
| REEL publication                   | `EXTENDED_REEL_PUBLISH`                   |
| Outgoing Matchmaking LIKE          | `EXTENDED_MATCHMAKING_LIKE`               |
| Community Help REQUEST publication | `EXTENDED_COMMUNITY_HELP_REQUEST_PUBLISH` |

Consumption uses `target_type='COMMUNITY'` and the selected community UUID.

- Finite grants take precedence over plan allowances.
- Quantity and reset period are administrator-configurable per plan.
- A transaction-scoped PostgreSQL advisory lock serializes account/feature consumption.
- Quota checks and usage insertion occur in the same domain transaction as the successful action.
- Idempotent replay returns the original usage result without another charge.
- Quota exhaustion fails with `ENTITLEMENT_QUOTA_EXCEEDED`; it is not converted into a free action.
- An explicit `{"unconfiguredFree":true}` launch fallback applies only when neither an entitlement nor a grant is configured and the scoped rule is enabled.
- Reversal retains the usage ledger row, excludes it from future quota totals, restores finite grant consumption and writes an audit event.

Browsing, reading, reactions, comments, sharing, saving, editing, PASS, received LIKEs, mutual matches, existing conversations, Help OFFER publication and Help responses do not invoke these new charges. Existing module-specific charges remain in place.

### 2.4 Durable publication replay

Feed post/Reel and Community Help creation support optional client idempotency keys through the existing `idempotency_keys` table.

- Operation keys are namespaced as `feed-post-create:{clientKey}` and `feed-help-create:{clientKey}`.
- Same-user/same-operation requests are serialized with a PostgreSQL advisory transaction lock.
- A SHA-256 request hash binds the key to the canonical request payload, excluding the key itself.
- Domain writes, Billing usage and the stored JSON response commit atomically.
- Same key and equivalent payload return the original response without duplicate content or usage.
- Same key with a different payload returns HTTP 409 `IDEMPOTENCY_KEY_REUSED`.
- Failed transactions leave neither successful content nor a successful replay record.
- Successful replay rows expire after seven days.
- Missing keys preserve backward-compatible non-replayed behavior; invalid keys fail validation.

### 2.5 Matchmaking community context

- Discovery is scoped to active members of the selected community while retaining existing adult, preference, privacy, verification and blocking rules.
- Targets outside the selected community cannot be swiped through that context.
- Current swipes and append-only history retain nullable source `community_id` metadata.
- Profiles remain one per account; matches and conversations remain canonical at the account/account-pair level.
- PASS is free, only a successful outgoing Extended LIKE consumes the new feature, and an already processed swipe does not charge again.
- Switching communities does not remove historical matches or conversations.

### 2.6 Administration

Existing backend administration was extended with audited, platform-admin-only operations for:

- Community activation and deactivation.
- Global, country and community module flags.
- Extended plan entitlements and unconfigured-free fallback rules.
- Billing usage reversal.

All require an unrevoked global `PLATFORM_ADMIN` role. Existing grant and product administration remains the source for additional credit entitlements and commercial configuration.

## 3. Implemented mobile behavior

- Community selectors identify Default, Extended and Active communities and consume server-derived capabilities.
- Navigation, creation entry points, route/deep-link guards and inline Home features hide or reject restricted modules.
- Context switches reload access state so Feed, Reels, Matchmaking and Billing previews use the selected community.
- Chargeable publication and outgoing LIKE flows request server eligibility before a new attempt and display configured allowance/credit or denial information.
- Free reading and browsing do not show the new payment prompts.
- Post, Reel and Help composers generate UUID idempotency keys and retain the exact request snapshot, including uploaded media IDs and Help expiry, across ambiguous retries in the mounted composer.
- Exact retries reuse the original key and payload rather than creating another publication attempt or repeating Billing confirmation/media upload.
- Render-derived feature fallback prevents an unavailable inline feature from remaining visible while access state is refreshed.

## 4. Database and API artifacts

- `../diasporum-backend/src/main/resources/db/migration/V24__default_extended_community_access.sql` adds Matchmaking source-community metadata, Billing reversal/grant fields, indexes, four Extended feature definitions and explicit fallback rules.
- Publication replay reuses the baseline idempotency table; no additional replay migration was required.
- `../diasporum-backend/docs/community-access-api-v1.yaml` contains the OpenAPI 3.1 access, eligibility, replay and administration contract.
- `Diasporum_Shop_Marketplace_Data_Model_v10_13.md` Section 26 documents the implemented persistence model.
- `Diasporum_Default_Extended_Community_System_Design.md` records the architecture and deployment boundaries.

The v10.13 clean-install SQL was not converted into an in-place upgrade script and must not be run over an existing database.

## 5. Verification performed

### 5.1 Final clean backend regression

Command, run from `diasporum-backend`:

```text
.\mvnw.cmd clean test
```

Result:

```text
Tests run: 410, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS
```

The clean build compiled 340 production source files and 46 test source files. PostgreSQL/PostGIS Testcontainers suites exercised fresh V1–V24 migrations and populated upgrade paths. The result includes the new Extended Matchmaking concurrency test and all final corrections.

Notable verified coverage includes:

- Default/Extended resolution, membership and origin invariants, active-context switching and country reconciliation.
- Extended module denial at backend boundaries and server-derived capabilities.
- Extended publication/LIKE Billing, free actions, launch fallback, grants, allowances, quota denial, replay and reversal.
- Feed post/Reel and Help same-key response replay, changed-payload conflict and failed-transaction rollback.
- Selected-community Matchmaking discovery and rejection of a Default-only outsider.
- Two concurrent LIKE attempts against one remaining allowance: exactly one succeeded, the loser received `ENTITLEMENT_QUOTA_EXCEEDED`, and only one usage row remained.
- Free PASS, duplicate LIKE replay, source-community persistence and rollback of the losing concurrent swipe.
- Existing module, security, architecture, migration and regression suites.

The final Matchmaking suite passed 18/18 tests. The Service Marketplace suite passed 11/11 tests after its fixture was corrected to reset shared FREE-plan entitlement rows between tests; production Billing behavior was not weakened.

### 5.2 Final mobile regression

Command, run from `diasporum-mobile`:

```text
npm test -- --runInBand
```

Result:

```text
Test Suites: 44 passed, 44 total
Tests:       534 passed, 534 total
Snapshots:   0 total
```

Mobile lint completed with zero errors and 15 existing warnings. No timeout or assertion was weakened to obtain the final test result.

### 5.3 API document check

The OpenAPI YAML was parsed successfully with the repository's existing `js-yaml` dependency; 12 paths and the expected root document fields were found. This was syntax/basic-structure validation, not a complete OpenAPI schema validation or automated controller-to-contract conformance check.

## 6. Final regression corrections

The final validation cycle also corrected three test/integration issues without removing production authorization or Billing checks:

1. `CommunityModuleWebConfig` uses optional dependency providers so MVC-only security slices can start without database services, while full application contexts still register the restricted-module interceptor.
2. `PollSchemaIntegrationTest` compares the installed schema version with Flyway's current version instead of hardcoding V12.
3. `ServiceMarketplaceModuleIntegrationTest` resets its shared Service entitlement configuration before each test, preventing one test's enabled FREE-plan allowance from invalidating another test's denial assertion.

## 7. Implemented but not verified in a live runtime

The following remains outside the automated evidence above:

- No authenticated physical-device, emulator or browser smoke test was performed.
- The Next.js scaffold does not contain a dedicated visual administration console for the new settings; the audited backend administration APIs are implemented and tested.
- Pending mobile publication requests are retained only by mounted composers. They are not restored after process restart, application reinstall or device loss.
- The OpenAPI document has not undergone full schema/controller conformance validation.
- The consolidated v10.13 DOCX/PDF viewing copies were not regenerated; the Markdown supplement is the authoritative record for this implementation.

## 8. Outstanding deployment and rollout work

Before production rollout:

1. Back up the target database and rehearse V1–V24 or the applicable V24 upgrade against a restored copy of the actual deployed schema and data.
2. Verify the deployed Flyway history and never modify an already-applied migration.
3. Review and explicitly configure production plan entitlements, grants, module flags and the unconfigured-free fallback for each launch community.
4. Configure and verify the visual administration experience if required for operations; until then use the secured backend administration contracts through an approved operational client.
5. Run authenticated device/browser smoke tests for community switching, direct deep links, all four chargeable actions, exact retries, insufficient allowance and country changes.
6. Decide whether cross-restart composer recovery is required and, if so, persist encrypted pending-request snapshots with appropriate expiry and privacy controls.
7. Monitor Billing denial/replay metrics, usage reversal audit, migration health and restricted-module denials during staged rollout.

No production deployment, live payment-provider transaction or restored-production-database migration rehearsal is claimed by this report.
