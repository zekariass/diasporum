# Diasporum Default and Extended Community System Design

**Architecture baseline:** Diasporum v10.13  
**Implementation supplement:** 7 November 2026  
**Scope:** Community participation, module authorization, Extended Community Billing, mobile context, administration, migration and publication reliability.

This document supplements the v10.13 consolidated system design. It describes the implemented Default/Extended Community model without replacing the existing community, identity, taxonomy, Feed, Matchmaking, Media, Billing or administration architecture. The OpenAPI contract is in `diasporum-backend/docs/community-access-api-v1.yaml`; schema details are in Section 26 of `Diasporum_Shop_Marketplace_Data_Model_v10_13.md`.

## 1. Architecture assessment and preserved boundaries

The implementation extends the existing modular monolith and PostgreSQL schema:

- `communities`, `community_memberships` and `user_settings` remain the only community and active-context model.
- `profiles.origin_country_id` and `profiles.current_country_id` remain authoritative for community classification.
- Taxonomy remains the community catalogue; Community owns participation and authorization.
- Feed and Community Help continue to use `feed_posts` and `community_help_posts`; Reels remain Feed publications with existing Media validation.
- Matchmaking retains one profile per account and one canonical match per unordered user pair.
- Billing continues to resolve plans, entitlements, grants, quotas, usage and products centrally.
- Existing scoped `feature_flags` and `feature_access_rules` carry administrator configuration.
- Existing `idempotency_keys`, `audit_logs` and transactional service boundaries are reused.
- Cross-module calls use public module APIs. No parallel membership, payment, identity, feature-management or publication table was introduced.

## 2. Community classification and invariants

A usable context requires an active account, an active community and an `ACTIVE` membership. The community origin must equal the user's origin country.

| Context                      | Required relationship                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Default                      | Community origin = profile origin; community destination = profile current country; active membership                     |
| Extended (`ORIGIN_EXTENDED`) | Community origin = profile origin; community destination differs from profile current country; explicit active membership |

Origin matching alone does not create an Extended membership. Users join through the existing discovery/join flow. Onboarding resolves the single active origin/current-country community, creates or reactivates its membership, and sets both default and active community settings.

Classification is derived on every backend authorization decision. A client-supplied access type, module map, price, credit balance or eligibility decision has no authority.

## 3. Central access policy and module matrix

`CommunityAccessPolicyService` is the central policy. `CommunityApi` exposes validated context, active-context, module and action-eligibility operations to other modules. Unknown modules and unavailable capabilities fail closed.

| Module               | Default Community                             | Extended Community |
| -------------------- | --------------------------------------------- | ------------------ |
| Feed                 | Enabled, subject to normal policy and rollout | Enabled            |
| Reels                | Enabled, subject to normal policy and rollout | Enabled            |
| Matchmaking          | Enabled, subject to normal policy and rollout | Enabled            |
| Community Help       | Enabled, subject to normal policy and rollout | Enabled            |
| Business Directory   | Existing rules                                | Denied and hidden  |
| Events               | Existing rules                                | Denied and hidden  |
| Jobs                 | Existing rules                                | Denied and hidden  |
| Service Marketplace  | Existing rules                                | Denied and hidden  |
| Spare Bag            | Existing rules                                | Denied and hidden  |
| Property Marketplace | Existing rules                                | Denied and hidden  |
| Vehicle Marketplace  | Existing rules                                | Denied and hidden  |
| Shop Marketplace     | Existing rules                                | Denied and hidden  |
| General Chat         | Existing rules                                | Denied and hidden  |
| Voice Rooms          | Existing rules                                | Denied and hidden  |
| People Connect       | Existing rules                                | Denied and hidden  |

Default access does not bypass subscription, role, moderation, age, privacy, blocking, country or rollout checks. Account settings, notifications and existing direct conversations remain account-level capabilities rather than Extended Community modules.

Scoped `COMMUNITY_MODULE_{MODULE}` flags can further disable a module globally, for a country or for a community. They cannot expand the Extended base allow-list.

## 4. Switching and country changes

Switching persists the active community only after membership authorization. The mobile session then reloads `my-access`; navigation, creation entry points, Feed/Reels context, Matchmaking discovery and Billing previews use the resulting server-derived context.

Route-group and deep-link guards revalidate capabilities. If a selected inline Home feature becomes unavailable, the rendered feature falls back to Feed without retaining a restricted panel.

Country-change reconciliation follows the profile update event:

- A current-country change resolves and activates the new Default Community, updates default/active settings and reclassifies other valid memberships by derivation.
- An origin-country change ends memberships whose community origin is no longer eligible and selects a valid active context.
- Existing posts, Help lifecycle rows, matches, conversations, swipe history and Billing usage are not deleted.
- Historical source-community references remain audit metadata; community deletion behavior remains governed by existing foreign keys.

## 5. Extended Community Billing

The feature catalogue contains four `PER_TARGET` quota features. Billing calls use `target_type='COMMUNITY'` and the selected community UUID.

| Action                                        | Feature key                               | Initial behavior                     |
| --------------------------------------------- | ----------------------------------------- | ------------------------------------ |
| Successful GENERAL Feed publication           | `EXTENDED_FEED_POST_PUBLISH`              | Configurable plan allowance or grant |
| Successful REEL publication                   | `EXTENDED_REEL_PUBLISH`                   | Configurable plan allowance or grant |
| Successful outgoing LIKE                      | `EXTENDED_MATCHMAKING_LIKE`               | Configurable plan allowance or grant |
| Successful Community Help REQUEST publication | `EXTENDED_COMMUNITY_HELP_REQUEST_PUBLISH` | Configurable plan allowance or grant |

Browsing, reading, reactions, comments, sharing, saving, editing, PASS, received LIKEs, mutual match creation, existing conversations, Help OFFER publication and Help responses do not invoke these new charges. Existing module-specific charges remain unchanged.

Administrators configure plan enablement, quantity limit and reset period through Billing administration. Finite grants take precedence over subscription allowances. Quantity consumed is one per successful action. No price is inferred in feature code.

The additive migration installs an explicit launch fallback: if neither an entitlement nor a grant is configured, the four actions are free when the scoped fallback rule is enabled. Administrators can disable that fallback globally, per country or per community. Production launch requires an explicit review of this policy and all plan/grant configuration.

## 6. Transaction integrity, reversal and publication replay

Each chargeable feature operation validates access and executes its domain writes and Billing consumption in one database transaction. Validation or technical failure rolls back both. Usage keys are stable per domain action/community, and Billing serializes competing consumption so quota cannot become negative and duplicate usage is not created.

Usage reversal is append-only: `reversed_at`, reason, actor and grant reference are retained. Reversed usage is excluded from quota totals and finite grant consumption is restored. Administration and reversal operations write audit records.

Feed post/Reel and Community Help creation additionally support durable whole-request replay:

1. The client sends an optional `idempotencyKey` in the JSON body.
2. The backend derives `feed-post-create:{key}` or `feed-help-create:{key}` for the authenticated user.
3. A PostgreSQL advisory transaction lock serializes the same user/operation/key.
4. A SHA-256 hash binds the key to the request payload, excluding the key itself.
5. The domain action, Billing usage and stored JSON response commit together.
6. An equivalent retry returns the original response without another post or charge; changed payload reuse returns HTTP 409 `IDEMPOTENCY_KEY_REUSED`.
7. Failed transactions leave no successful replay row. Successful replay records expire after seven days.

Missing or blank keys preserve backward-compatible non-replayed behavior. Non-string or over-120-character keys fail with `FEED_IDEMPOTENCY_KEY_INVALID`.

The Expo composers generate UUID keys and retain the exact request, uploaded media IDs and Help expiry across ambiguous failures in the mounted composer. Exact retries skip Billing reconfirmation and media re-upload. These pending requests are not persisted across process restart or reinstall; durable server replay protects retries that are actually submitted, while cross-restart composer recovery remains a separate enhancement.

## 7. Matchmaking context

Discovery requires the selected community and filters candidates by active community membership in addition to existing adult, active-profile, preference, privacy, verification and blocking rules.

Current swipes and append-only swipe history record nullable `community_id` source metadata. This does not partition profiles or matches. Reciprocal LIKEs still create one canonical account-pair match and one existing direct conversation. Switching communities does not remove matches or conversations, and an already processed swipe does not produce another charge.

## 8. API and administration

`GET /api/v1/communities/my-access` returns default/active IDs and validated community contexts with effective module maps. `GET /api/v1/me/community-actions/{actionKey}/eligibility` returns a non-mutating server decision for confirmation UX. It is informational; the action endpoint authorizes and consumes again transactionally.

Platform-admin endpoints extend existing infrastructure for:

- Community activation/deactivation.
- Global, country and community module flags.
- Extended feature plan entitlements and unconfigured-free fallback rules.
- Billing usage reversal.

All require an unrevoked global `PLATFORM_ADMIN` role. Administrative mutations are audited. The current deliverable exposes backend administration contracts; the Next.js scaffold does not yet provide a dedicated visual console for these settings. Existing grant/product administration remains the source for additional credit entitlements and effective-dated commercial configuration.

## 9. Mobile behavior

The community drawer and Communities screen identify Default, Extended and Active communities and summarize enabled features. Feature navigation, bottom tabs, creation sheets and deep links consume the shared capability map.

Publication and outgoing LIKE flows request server eligibility before a new chargeable attempt and display configured quantity, remaining allowance/credits and denial reasons. Free browsing and reading do not show payment prompts. Exact publication retries reuse the original request rather than creating a new key.

## 10. Migration, deployment and verification boundaries

`V24__default_extended_community_access.sql` is the only schema migration required for this model. It adds Matchmaking source-community metadata, Billing reversal/grant fields, indexes, four feature definitions and explicit fallback rules. Publication replay reuses the baseline `idempotency_keys` table.

Do not run the v10.13 clean-install SQL over an existing database. Deploy through Flyway after backup and a restored-copy rehearsal. Verify the deployed migration history before rollout, configure production Billing policy explicitly, and run authenticated device/browser smoke tests.

Automated results, unrelated regressions and remaining runtime gaps are recorded in `DIASPORUM_DEFAULT_EXTENDED_COMMUNITY_IMPLEMENTATION_REPORT.md`; this design document does not claim device, provider or production verification.
