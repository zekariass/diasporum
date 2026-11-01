# Diasporum Business Account Mobile Implementation Report

## Status

Implemented and verified the foundational Business Workspace vertical slice:

**Personal Profile → Business Workspace → account selector/empty state → account creation → membership-checked Business Workspace dashboard**

This is not a claim that the complete Business Accounts specification is production-complete. Business profiles, branches, listings, team operations, messaging, reviews, promotions, billing, and settings require additional backend contracts and mobile implementation. Unavailable operations are explicitly marked **Pending API** and are not presented as functional.

## 1. Initial repository assessment

### Existing capabilities found

- Expo Router mobile application with an authenticated personal session and reusable `ApiClient`.
- Personal Profile tab and existing five-item bottom navigation.
- Shared Diasporum theme, colors, spacing, buttons, inputs, loading states, and Ionicons.
- Spring Boot backend using authenticated `DiasporumUserPrincipal`, JDBC, transactions, PostgreSQL, and Flyway.
- v10.12 database support for:
  - `business_accounts` and `business_account_members`.
  - Fixed roles `OWNER`, `ADMINISTRATOR`, `EDITOR`, `LISTING_MANAGER`, and `BILLING_MANAGER`.
  - Accepted, revoked, suspended, and closed lifecycle fields.
  - Initial accepted `OWNER` bootstrap after account creation.
  - Account and membership audit events.
  - Business-owned public profiles through `business_listings.business_account_id`.
  - Business locations, messaging ownership fields, and subscription-related schema.
- Database constraints require an accepted active owner for active or suspended accounts and enforce personal-versus-business listing ownership.

### Missing capabilities found

- The backend `businessaccounts` and `billing` packages were placeholders; no reusable Business Account REST flow existed.
- No Business Account discovery, creation, workspace, team, or business billing controllers/services were available.
- No mobile Business Account selector, creation screen, workspace, service, or routes existed.
- No backend-supported invitation acceptance, team management, business messaging, business billing, or business settings operations were available for mobile integration.

### Implementation decision

The smallest real implementation was delivered instead of a mock dashboard. New endpoints were limited to account discovery, account creation, and workspace loading. Existing database lifecycle and audit triggers were reused; no alternative authentication, schema, messaging, or billing system was introduced.

## 2. Backend capabilities and API contracts

### Implemented contracts

| Method | Endpoint                                          | Purpose                                                                                                                         |
| ------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/business-accounts`                       | Returns accepted, active memberships for the authenticated personal user in active or suspended accounts.                       |
| `POST` | `/api/v1/business-accounts`                       | Creates a workspace from `{ "accountName": "..." }`; the creator is derived from the authenticated principal.                   |
| `GET`  | `/api/v1/business-accounts/{accountId}/workspace` | Revalidates membership and account status, then returns workspace identity, role, real profile count, and backend capabilities. |

Account responses contain only implemented fields:

- `id`
- `accountName`
- `status`
- `role`
- `profileCount`
- `createdAt`

Workspace responses additionally contain `capabilities`:

- `manageProfiles`
- `manageListings`
- `manageTeam`
- `manageBilling`
- `manageSettings`

### Authorization policy

| Role              | Profiles | Listings | Team | Billing | Settings |
| ----------------- | -------: | -------: | ---: | ------: | -------: |
| `OWNER`           |      Yes |      Yes |  Yes |     Yes |      Yes |
| `ADMINISTRATOR`   |      Yes |      Yes |  Yes |      No |      Yes |
| `EDITOR`          |      Yes |       No |   No |      No |       No |
| `LISTING_MANAGER` |       No |      Yes |   No |      No |       No |
| `BILLING_MANAGER` |       No |       No |   No |     Yes |       No |

The mobile app uses these backend-returned capabilities for visibility; it does not infer access from a role label. These flags currently control dashboard integration points only. They do not authorize unimplemented operations.

## 3. Personal Profile entry point

A prominent lavender **Business Workspace** card was added directly below personal identity information and above personal details.

It includes:

- Briefcase icon and chevron.
- “Manage your businesses, listings and team.”
- “Manage Business Accounts” action label.
- Navigation to the account selector/empty-state flow.

The personal identity block, authentication session, personal details, and five-item bottom navigation remain unchanged.

## 4. Business Account selector

Implemented:

- Real account loading through the authenticated API.
- Loading, error, retry, and pull-to-refresh states.
- Empty landing experience with account creation action.
- Multiple-account rendering.
- Actual account name, role, status, and non-deleted business profile count.
- Workspace navigation for the selected account.
- Creation action when accounts already exist.

Pending and revoked memberships and closed accounts are excluded by backend queries. Suspended accounts remain discoverable and display their status. Invitation acceptance is not fabricated; the empty state states that it depends on the future team API.

Last-selected workspace persistence is not implemented. Workspace access is always fetched and revalidated when opened or refocused.

## 5. Business Account creation flow

Implemented:

- Guided creation screen collecting only the supported `accountName` field.
- Trimmed input, required validation, and 180-character limit.
- Clear distinction between a private Business Account and a public Business Directory profile.
- Explanation that the personal login remains unchanged and the creator becomes the first owner.
- Disabled/loading state and an in-flight duplicate-submission guard.
- API error display and navigation to the created workspace on success.

The database trigger creates the initial accepted `OWNER` and audit records in the same transaction.

**Remaining hardening gap:** there is no backend idempotency-key contract. The UI prevents repeated in-flight taps, but guaranteed deduplication after ambiguous network failures or cross-device retries still requires an approved backend idempotency design.

## 6. Business Workspace dashboard

Implemented:

- Active Business Account name, icon, role, status, and real public-profile count.
- Suspended-account notice.
- Backend-capability-aware management sections.
- Business Account switcher.
- Return to Personal Diasporum without changing the authenticated identity.
- Workspace refetch on focus and removal of displayed workspace data when access validation fails.
- Explicit **Pending API** labels on unavailable management modules.

No member counts, unread counts, sales, analytics, plan details, or other unsupported data are shown.

## 7. Business profiles and branches

Not implemented beyond the real profile count and capability integration point.

Required next backend slice:

- Account-scoped profile list/detail and CRUD contracts.
- Membership, role, account-status, and `business_account_id` ownership checks on every operation.
- Branch/location, opening-hours, category, media, verification-status, and public-directory navigation contracts.

No account is automatically treated as a verified public profile.

## 8. Business listings

Not implemented beyond the dashboard capability integration point.

Required next slices include account-scoped listing retrieval and lifecycle operations for each supported listing module, plus an explicit personal/business ownership selector in eligible composers. The backend must derive the human actor from the principal and independently validate business membership, permission, and resource ownership.

## 9. Team and invitation management

Not implemented; the Team dashboard entry is an integration point only.

Required backend contracts include member lists, invitation lists, invite/accept/decline/revoke/re-invite operations, role changes, ownership transfer, and entitlement-driven seat-limit enforcement. Existing database lifecycle and audit triggers should be reused. The last-active-owner constraint must remain enforced.

## 10. Role-aware UI

Implemented for the dashboard through backend-returned capabilities.

Automated tests cover every fixed role and verify that:

- Administrators do not receive billing capability.
- Editors do not receive billing, listing, team, or settings capabilities.
- Listing managers receive only listing capability.
- Billing managers receive only billing capability.
- Unknown roles receive no capabilities.
- The mobile billing-manager view hides unrelated management sections.

Frontend visibility is not treated as backend authorization.

## 11. Personal/business context switching

Implemented navigation between the personal Profile, account selector, and selected workspace. The app continues using the same personal authentication session and `ApiClient`; no business JWT, credentials, login, or user identity was added.

Publishing and messaging ownership contexts are not yet implemented because their operational backend contracts are absent.

## 12. Business messaging integration

Not implemented. No separate messaging system was created.

A future implementation must extend the shared messaging module with account-scoped conversation queries and acting-member authorization, while rechecking accepted active membership for every read/write operation.

## 13. Business billing integration

Not implemented. No second billing engine or fabricated plan information was created.

The shared billing/entitlement module needs business-account subscription, entitlement, history, and authorized management contracts before the mobile Billing section can become operational. Payment must remain independent of business verification.

## 14. Files created and modified

### Backend created

- `diasporum-backend/src/main/java/com/diasporum/backend/businessaccounts/internal/api/rest/BusinessAccountController.java`
- `diasporum-backend/src/main/java/com/diasporum/backend/businessaccounts/internal/application/BusinessAccountService.java`
- `diasporum-backend/src/main/java/com/diasporum/backend/businessaccounts/internal/application/BusinessAccountAuthorization.java`
- `diasporum-backend/src/test/java/com/diasporum/backend/businessaccounts/BusinessAccountAuthorizationTest.java`
- `diasporum-backend/src/test/java/com/diasporum/backend/businessaccounts/BusinessAccountModuleIntegrationTest.java`

### Mobile created

- `diasporum-mobile/src/features/business/services/business-api.ts`
- `diasporum-mobile/src/features/business/types/business-types.ts`
- `diasporum-mobile/src/features/business/screens/business-accounts-screen.tsx`
- `diasporum-mobile/src/features/business/screens/create-business-screen.tsx`
- `diasporum-mobile/src/features/business/screens/business-workspace-screen.tsx`
- `diasporum-mobile/src/app/(app)/business/index.tsx`
- `diasporum-mobile/src/app/(app)/business/create.tsx`
- `diasporum-mobile/src/app/(app)/business/workspace/[accountId].tsx`
- `diasporum-mobile/src/__tests__/features/business/business-api.test.ts`
- `diasporum-mobile/src/__tests__/features/business/business-ui.test.tsx`

### Mobile modified

- `diasporum-mobile/src/app/(app)/(tabs)/profile.tsx`

## 15. API endpoints integrated

The mobile service integrates exactly the three endpoints listed in section 2, all with `{ authenticated: true }`. No unsupported business endpoint is called.

## 16. Database changes and migrations

None.

The implementation reuses the approved v10.12 baseline and its current Flyway migrations. No columns, tables, triggers, role matrices, or lifecycle rules were added or changed.

## 17. Tests executed and actual results

### Mobile

| Check                                  | Actual result                                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck` (`tsc --noEmit`)   | Passed.                                                                                                                                                                        |
| Focused Business API and UI Jest tests | **2 suites, 9 tests passed.**                                                                                                                                                  |
| Full `npm test -- --runInBand`         | **9 suites, 85 tests passed.**                                                                                                                                                 |
| Full `npm run lint` (`expo lint`)      | Failed on **11 pre-existing errors and 10 warnings**; all 11 errors are in untouched `features/feed/components/community-drawer.tsx`. No Business Workspace file was reported. |

Mobile UI tests use mocked navigation and API clients. They cover the Profile entry, empty state, multiple accounts, actual role/status/count rendering, duplicate-submit protection, creation navigation, backend-capability visibility, return to personal context, and failed access revalidation. They are not live-backend or device tests.

### Backend

| Check                                                                 | Actual result                                                                                                   |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `mvnw compile`                                                        | Passed.                                                                                                         |
| Business Account unit and PostgreSQL/Testcontainers integration tests | **10 tests passed, 0 failures, 0 errors.**                                                                      |
| Full backend test compilation                                         | Remains blocked by 11 unrelated pre-existing source mismatches in Feed, Profile Management, and Taxonomy tests. |

The 10 passing backend tests comprise six role-policy unit tests and four real PostgreSQL integration tests. Coverage includes:

- Creator becomes accepted `OWNER`.
- Account/membership audit events.
- Discovery and workspace loading.
- Real non-deleted profile counts and business ownership constraints.
- Pending and revoked membership exclusion.
- Suspended and closed account behavior.
- Cross-account denial.
- HTTP authentication, validation, response contracts, and account isolation.

For focused verification only, Maven test compilation was temporarily restricted to the Business Account tests and their identity fixture so unrelated legacy test compilation failures would not block execution. That temporary build configuration was removed afterward; `pom.xml` has no resulting Business Account change.

## 18. Android/iOS screenshots

No Android or iOS simulator/device run was performed, so no platform screenshots are included. Visual appearance, safe areas, keyboard behavior, and navigation still require on-device validation.

## 19. Remaining backend gaps and release blockers

### Functional gaps

1. Business profile/branch/location/hours/media CRUD and verification workflows.
2. Business-owned listing APIs and personal/business publishing ownership selection.
3. Team membership, invitations, role changes, ownership transfer, and seat entitlements.
4. Shared business messaging authorization and conversation APIs.
5. Reviews, promotions, business settings, and account lifecycle operations.
6. Shared business subscription, billing, entitlement, and payment-history APIs.
7. Backend creation idempotency for ambiguous retries.
8. Optional last-selected workspace persistence and its restoration tests.

### Verification/release gaps

1. Repair unrelated legacy backend test-source API mismatches so the full backend suite can compile and run normally.
2. Resolve the pre-existing `community-drawer.tsx` lint errors for a clean full-mobile lint result.
3. Add live mobile-to-backend journey tests and platform UI tests as operational modules are delivered.
4. Perform Android and iOS device validation and capture screenshots.
5. Complete security and entitlement tests for each future protected operation, especially team, messaging, listing writes, and billing.

## Conclusion

The delivered slice establishes a real, secure foundation for Business Accounts as workspaces attached to the existing personal Diasporum identity. Account discovery, creation, owner bootstrap, membership-checked workspace loading, role-aware dashboard visibility, and personal/business navigation are implemented and tested. The remaining management areas are intentionally explicit integration points rather than simulated functionality.
