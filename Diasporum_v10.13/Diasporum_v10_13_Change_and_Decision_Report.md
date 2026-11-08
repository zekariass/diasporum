# Diasporum v10.13 — Shop Marketplace Change and Decision Report

**Baseline:** Supplied Diasporum v10.12 system design, PostgreSQL/PostGIS clean-install schema, project context, REST API folder structure, reference seeds, smoke-test plan and change/audit report.  
**New design version:** v10.13  
**Prepared:** 4 November 2026  
**Status:** Consolidated design proposal. No marketplace code, SQL migration or live provider/database validation is claimed.

## 1. Executive summary

Version 10.13 adds a global, multi-vendor Shop Marketplace to the Diasporum v10.12 product and architecture baseline. The feature is designed for physical-goods commerce and includes individual and Business Account sellers, multiple shops per legal seller, global product catalogue, market/currency-specific prices, per-country product availability, stock and reservations, mixed-seller carts, checkout, parent and seller orders, Stripe Connect, shipping/Shippo, provider-backed tax, promotions, featured placements, reviews, returns, refunds, disputes and a mobile Seller Workspace.

The Shop Marketplace is a new full-commerce domain. It is not an extension of the existing lead-generation Service Marketplace. Service Marketplace remains service-request/lead/contact based; it does not gain product checkout or service payments through this design.

The proposal adds **74 new marketplace tables**. It deliberately reuses v10.12 identity, Business Accounts, countries, addresses, media, Billing entitlements, featured placements, reports/moderation, messaging, notifications, audit, idempotency and transactional outbox capabilities.

## 2. v10.12 baseline preserved

- Mobile remains the primary user experience: React Native, Expo and TypeScript.
- Backend remains a Java/Spring Boot REST modular monolith with PostgreSQL/PostGIS and Flyway.
- Next.js remains scoped to the admin/moderation console and informational public website; the buyer marketplace and seller workspace are mobile-first.
- `users` remains the permanent account identity; `profiles` remains the optional one-to-one profile extension.
- Business ownership and staff access reuse `business_accounts` and `business_account_members`, including existing fixed Java role policies. No generic roles/permissions or `shop_members` role matrix is introduced.
- Cloudflare R2 remains the object store; the existing Media module owns upload, processing and access policy.
- Ably, notifications, audit, moderation, idempotency and outbox remain shared platform capabilities.
- Subscription billing and entitlements remain in the Billing module. Commerce product orders/payments/refunds are separate because multi-seller checkout and seller settlement have different lifecycles.

## 3. Marketplace decisions incorporated

1. **Separate domain:** add `shopmarketplace`; do not merge with lead-generation `servicemarketplace`.
2. **Seller model:** support individual sellers and Business Account sellers. A legal seller can operate multiple shops.
3. **Payment-account ownership:** associate a Connect account with the legal seller/payment entity, not automatically with each shop. Multiple shops for one legal seller can share the account.
4. **Global market:** reuse the existing `countries` reference table; add explicit country-market settings and product-country availability. A country can permit browsing while checkout or seller onboarding remains disabled.
5. **Currency and pricing:** store integer minor-unit amounts with ISO 4217 currency codes and the correct currency exponent. Variant prices are explicit per market country and currency. One checkout/order uses one currency. No automatic FX conversion is assumed.
6. **Product taxonomy:** one centrally managed global hierarchical `product_categories` taxonomy, separate from Business Directory, Jobs, Service Marketplace and Feed taxonomies. Category-specific attribute definitions and translations are supported.
7. **Catalogue:** products have at least one purchasable variant; seller-scoped SKU, explicit market prices, images/videos and validated attributes are supported. Digital goods are deferred.
8. **Inventory:** stock is held per variant/location. Time-limited checkout reservations (15 minutes is an initial configurable proposal) prevent overselling; expiry and release are backend-managed and idempotent.
9. **Multi-seller checkout:** one cart/checkout can contain multiple shops in one currency. One customer-facing parent order contains seller-specific orders. Seller fulfilment, shipments, returns and refunds progress independently.
10. **Order/payment ordering:** create parent and seller orders in `PAYMENT_PENDING` when the buyer confirms checkout, then create the PaymentIntent idempotently. A verified payment-success webhook finalizes the order and stock transition. Failed/expired payment cancels the pending orders and releases reservations. This avoids a payment-to-order circular reference.
11. **Connect money flow:** the proposal is one platform charge followed by separate seller transfers. Diasporum calculates seller allocations/commission; Stripe executes transfers. Transfer and bank payout are separate states. Connect is not escrow.
12. **Onboarding:** use server-created Stripe-hosted onboarding links and open them in the Expo system browser. A return URL does not prove verification; backend status refresh and signed webhooks determine readiness.
13. **Shipping:** support seller flat-rate, weight-based, free/threshold, Shippo-calculated and seller-managed external shipping. One seller order can have multiple shipments and packages.
14. **Tax:** seven dedicated provider-backed tables; no custom global country-by-country tax rules engine initially. Tax liability and invoice issuer still require legal/accounting approval.
15. **Promotions and featured content:** reuse existing featured-item/placement infrastructure for shops/products. Add marketplace promotion and discount tables. Paid feature products can use Billing entitlements if enabled.
16. **Reviews, reports, moderation and messaging:** use verified-purchase review rules and extend shared modules rather than introduce duplicates.
17. **Mobile seller experience:** Seller Workspace is accessed from Profile in the Expo application. It includes shop switching, overview, products, inventory, orders, shipping, earnings/transfers/payouts, promotions, returns, reviews, payment onboarding and settings. It is not a separate app or bottom-navigation tab.

## 4. Proposed new table inventory

| Area                                   | Tables                                                                                                                                                                                                                                                                                                       |  Count |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -----: |
| Country and seller foundation          | `marketplace_country_settings`, `marketplace_sellers`, `seller_payment_accounts`, `shops`, `shop_policies`, `shop_shipping_profiles`, `shop_media`                                                                                                                                                           |      7 |
| Catalogue and market eligibility       | `product_categories`, `product_category_translations`, `product_attribute_definitions`, `product_attribute_options`, `products`, `product_market_availability`, `product_variants`, `product_variant_attribute_values`, `product_variant_prices`, `product_media`, `product_tags`, `product_tag_assignments` |     12 |
| Inventory                              | `inventory_locations`, `inventory_items`, `inventory_reservations`, `inventory_movements`                                                                                                                                                                                                                    |      4 |
| Cart and checkout                      | `shopping_carts`, `shopping_cart_items`, `wishlists`, `wishlist_items`, `checkout_sessions`, `checkout_items`, `shipping_rate_quotes`                                                                                                                                                                        |      7 |
| Orders                                 | `orders`, `seller_orders`, `order_items`, `order_addresses`, `order_status_history`, `seller_order_status_history`                                                                                                                                                                                           |      6 |
| Payments, Connect, ledger and disputes | `marketplace_payments`, `marketplace_payment_transactions`, `seller_transfers`, `marketplace_refunds`, `seller_payout_records`, `marketplace_webhook_events`, `marketplace_ledger_transactions`, `marketplace_ledger_entries`, `marketplace_disputes`                                                        |      9 |
| Shipping and fulfilment                | `shipping_zones`, `shipping_zone_countries`, `shipping_methods`, `shipping_method_rules`, `shipments`, `shipment_items`, `shipment_packages`, `shipping_labels`, `shipping_tracking_events`                                                                                                                  |      9 |
| Promotions and discounts               | `marketplace_promotions`, `promotion_products`, `promotion_categories`, `discount_codes`, `discount_redemptions`                                                                                                                                                                                             |      5 |
| Reviews                                | `product_reviews`, `product_review_media`, `shop_reviews`                                                                                                                                                                                                                                                    |      3 |
| Returns                                | `return_requests`, `return_request_items`, `return_request_media`, `return_status_history`                                                                                                                                                                                                                   |      4 |
| Commission                             | `marketplace_commission_rules`                                                                                                                                                                                                                                                                               |      1 |
| Global tax                             | `tax_registrations`, `tax_calculations`, `tax_calculation_lines`, `tax_liability_records`, `tax_documents`, `tax_document_lines`, `tax_provider_configurations`                                                                                                                                              |      7 |
| **Total**                              |                                                                                                                                                                                                                                                                                                              | **74** |

The authoritative table-by-table logical model, including key responsibilities/columns, is in `Diasporum_Shop_Marketplace_Data_Model_v10_13.md`.

## 5. Existing v10.12 structures to reuse

- `users`, `profiles`, `countries`.
- `business_accounts`, `business_account_members`.
- `addresses` (with immutable order-address snapshots retained for historical orders).
- `media_objects`, media processing and access controls.
- `billing_*` for subscriptions, plans, entitlements and any future promotion entitlements; not for marketplace customer product payments.
- `featured_items`, `featured_placement_rules`, `featured_item_impressions` for SHOP/PRODUCT placements.
- `reports`, `moderation_actions`, `audit_logs`.
- `notifications`, `notification_preferences`, `notification_deliveries`.
- `direct_conversations` and Messaging module.
- `idempotency_keys`, `outbox_events`, `media_processing_jobs`.

## 6. Existing schema contracts requiring additive review

The exact DDL must be designed against the current repository and actual database. The design anticipates review of the following v10.12 constraints/contracts:

- Add approved `SHOP` and `PRODUCT` purposes to the `media_objects.purpose` CHECK allow-list.
- Extend `content_reference_type` to include `SHOP` and `PRODUCT`; configure the approved placement keys and serving eligibility. Do not introduce separate featured shop/product tables.
- Extend `report_target_type` and moderation service validation for shop, product, product review and shop review targets.
- Extend the `direct_conversations.context_type` CHECK for seller/shop/product/order conversation contexts while preserving canonical participant ordering and context uniqueness.
- Extend `notification_type` for shop order, seller order, fulfilment/shipment, returns, payouts/account requirements and low-stock notifications.
- Extend `billing_products.target_type` for SHOP/PRODUCT only if paid featured placements are actually part of the approved launch scope.
- Add `shopmarketplace` module/API boundary tests and the corresponding outbox event contracts.

Do not edit an already-applied migration. The supplied v10.12 SQL is a clean-install baseline, not an in-place migration.

## 7. Important provider and global-market constraints

- Stripe Connect country/capability and cross-border payout coverage is not universal. Market activation must check the platform country, connected seller country, payout corridor and requested capabilities. An alternative payout arrangement may be required for unsupported seller countries.
- Stripe hosted onboarding is preferred, but the final account controller/dashboard configuration and Express/Standard/custom model must be agreed before account creation. Some account configuration properties are difficult or impossible to change later.
- A platform charge followed by transfers requires careful handling of payment success, separate transfer state, transfer reversal, refunds, disputes, insufficient seller balances and platform exposure. It is not escrow.
- Shippo rate/label/carrier support depends on account, carrier and route. Use seller-managed tracking where appropriate; do not show unavailable Shippo rates or claim a label was bought if it was not.
- A tax provider calculates only supported tax treatments; it does not automatically determine every marketplace's legal liability, register the seller/platform, issue all legal documents or remit tax. Tax liability and invoice issuer must be approved by jurisdiction.
- Global-ready architecture does not mean enabling all countries at launch. Enable markets only after payments, seller onboarding, payout, currency, shipping, tax, customs, product restriction and consumer-protection readiness checks pass.

## 8. Decisions still requiring approval before implementation/production

- Initial launch countries and market activation sequence.
- Supported checkout currencies and whether an FX conversion provider is required.
- Stripe Connect account type/controller/dashboard configuration, country eligibility and any alternative payout provider.
- Legal marketplace role, merchant-of-record/seller-of-record model, tax liability and invoice issuer by jurisdiction.
- Seller transfer release timing, commission base, Stripe fee allocation, negative-balance and dispute loss allocation.
- Who pays for shipping labels, how free shipping is funded, and return-label policy.
- Physical-goods-only initial release (recommended) versus digital goods.
- Prohibited/restricted product policy, seller verification, customs declarations, duties and import tax treatment.
- Whether paid featured product/shop placements are included in the first commercial release.

## 9. Validation and implementation status

- v10.12 documents and SQL were reviewed as the design baseline.
- The marketplace logical table list was checked for 74 unique names.
- The v10.13 full system design DOCX was rendered to 77 page images and visually inspected. A PDF viewing copy was generated from that DOCX.
- The v10.12 canonical SQL and strict clean-install SQL have not been modified.
- No marketplace DDL, Flyway version, backend implementation, mobile implementation, Stripe/Shippo integration or live tax calculation has been created or validated in this task.
- The 74 tables are proposed logical persistence objects, not a command to implement all tables in one migration.

## 10. Recommended next step

Review and approve the v10.13 product/domain decisions and launch gates. Then inspect the actual repository Flyway configuration and deployed schema, compare this logical model with existing code/tables, agree a migration sequence and implement incrementally with PostgreSQL concurrency tests, provider test-mode workflows, module-boundary tests and end-to-end buyer/seller tests.

## 11. Shared `location_places` catalogue and Matchmaking location selection (non-marketplace addition)

A reusable global location catalogue was added to the v10.13 SQL package after the marketplace proposal. It is **shared platform reference data**, first consumed by Dating/Matchmaking onboarding; it is not a marketplace table and the 74-table marketplace inventory is unchanged.

### New objects

- `location_places` — one selectable row per city/town/village/district/region in one `countries.id`; `alternative_names text[]`; approximate place-centre `geography(Point,4326)`; controlled `location_precision` (`CITY`,`TOWN`,`VILLAGE`,`DISTRICT`,`NEIGHBOURHOOD`,`REGION`,`OTHER`); `is_active`; optional `source_provider`/`source_place_id` provenance. GiST index on `location`, country-scoped active index, case-insensitive prefix indexes on city/region/display_name, GIN index on `alternative_names`, a uniqueness rule on `(country_id, lower(region), lower(city), location_precision)` and a partial unique index on provider provenance.
- `user_discovery_locations.location_place_id uuid NULL REFERENCES location_places(id) ON DELETE RESTRICT` — the only change to the table; all existing columns, the `location_source` allow-list, `precision_radius_m`, `consented_at` and opt-out deletion behaviour are preserved.
- `trg_user_discovery_locations_place` — validates that a catalogue selection references an active place, requires `location_source='CITY_CENTRE'` for catalogue rows, and always derives the stored point from `location_places.location` (client coordinates are never trusted for a catalogue selection).
- `trg_location_places_point_propagation` — propagates curated place-centre corrections to referencing discovery rows.
- `trg_location_places_updated_at` — standard `updated_at` maintenance.

### Behaviour locked in

- Manual selection is always country-scoped (`country_id = :selected AND is_active`); the initial country is resolved server-side from `profiles.current_country_id`, the user may switch countries, and a NULL/missing profile country returns no unfiltered global list. Switching the search country never writes back to `profiles.current_country_id`; the selected place's own country is authoritative.
- Device location is independent of the profile country; a matched catalogue place stores `CITY_CENTRE` + derived centre point (no raw GPS persisted), and an unmatched device fix stores `DEVICE_APPROXIMATE` with `location_place_id = NULL` under the existing `precision_radius_m` rules.
- `matchmaking_profiles.address_id` is unchanged: still optional, still a private `addresses` reference validated by the existing trigger. No street address is required for Matchmaking location selection.
- Distance matching continues to run on `user_discovery_locations.location` via `matchmaking_users_compatible`; consent (`consented_at`), privacy-toggle opt-out deletion and the "never serialize the raw point" rule are preserved.

### Seeding and migration

- No fabricated worldwide place dataset is shipped. Catalogue population is an approved-source, idempotent import keyed on provider provenance plus the uniqueness rule; admins activate/deactivate places, and referenced places are never deletable. Documented in `Diasporum_Shop_Marketplace_Data_Model_v10_13.md` §25.
- The repository Flyway history is `V1__baseline_v10_12.sql` + `V2`–`V15` incremental migrations (deployed schema does not contain the marketplace tables or `location_places`). Adoption against a populated database requires a new additive migration — `CREATE TABLE location_places` (after `countries`), the `ALTER TABLE user_discovery_locations ADD COLUMN location_place_id` plus the two consistency triggers — prepared and rehearsed as a separately reviewed proposal. No migration version was assigned here and no already-applied migration was modified.
- Note: the packaged schema keeps `profiles.current_country_id NOT NULL`, while deployed migration `V3` relaxed it to nullable. The location-selection contract therefore treats a NULL or absent profile country as "choose a country first".

### Validation performed

- Canonical `Diasporum_PostgreSQL_Schema_v10_13.sql` and `Diasporum_v10_13_strict_clean_install.sql` bodies verified byte-identical apart from the strict `BEGIN`/`COMMIT` wrapper.
- `Diasporum_v10_13_Shop_Marketplace_Smoke_Test.sql` gained catalog assertions (table/FK/SRID 4326/GiST/alternative names/RESTRICT link/triggers) and rolled-back behavioural assertions: duplicate place rejection, alternative-name containment, derived catalogue point, inactive-place rejection, `CITY_CENTRE` enforcement, device path without a place, centre-point propagation and referenced-place delete protection.
- Two pre-existing package defects that prevented any execution were corrected: a stray `\n` literal before the marketplace banner (syntax error), and `validate_shop_marketplace_conversation_context` selecting a whole table alias into a `%ROWTYPE` variable inside a mixed `INTO` list (invalid PL/pgSQL — now selects the two seller fields actually used). No marketplace behaviour was changed.
- **Live validation was performed:** `Diasporum_v10_13_strict_clean_install.sql` executed end-to-end on a disposable `postgis/postgis:17-3.5` container (fresh database, ran to `COMMIT` with no errors), followed by `Diasporum_v10_13_Shop_Marketplace_Smoke_Test.sql`, which completed both assertion blocks (marketplace + location catalogue) and rolled back cleanly. The test container was removed afterwards; the development `diasporum-postgres` database was not touched.
- API-level assertions (default country resolved from `profiles.current_country_id`, country switching, consent copy, no unfiltered global listing) are documented contract requirements for the backend implementation (§25.4), not SQL-executable checks.

## 12. Implemented Default and Extended Community model (application supplement)

The existing backend and Expo application now implement the Default and Extended Community participation, authorization and monetisation model. This is a separate application supplement: it does not implement the proposed Shop Marketplace and does not change the 74-table marketplace inventory or the validation claims above.

### Architecture and access decisions

- Existing communities, memberships, user settings, profile countries, taxonomy, Feed, Matchmaking, Media, Billing, idempotency and administration infrastructure are reused. No parallel community, identity, match, conversation, Billing or feature-management system was added.
- Default Communities require matching origin/current countries and an active membership. Extended Communities require the same origin, another destination and an explicitly joined active membership.
- Default retains normal module access under existing policy. Extended is limited to Feed, Reels, Matchmaking and Community Help & Offers; restricted modules are hidden on mobile and denied by backend authorization, including direct REST attempts.
- `CommunityAccessPolicyService`, `CommunityApi`, `my-access` and action-eligibility responses provide server-derived context and capabilities. Country changes reconcile active context without deleting historical content, matches, conversations or usage.

### Billing, replay and administration decisions

- Four community-targeted Billing features govern successful Extended GENERAL Feed posts, Reels, outgoing LIKEs and Community Help REQUESTs. Browsing, reactions, comments, sharing, saving, editing, PASS, received LIKEs, mutual matches, existing conversations, Help OFFERs and Help responses do not invoke these charges.
- Grants take precedence over plan allowances. Advisory transaction locks, stable idempotency and atomic domain/Billing transactions prevent duplicate usage and negative quota under concurrent consumption.
- An explicit scoped `unconfiguredFree` launch fallback applies only when no entitlement or grant is configured. Quota exhaustion is never converted into a free action.
- Usage reversal preserves the ledger, excludes reversed usage from quota and restores finite grants. Administrative configuration and reversal are audited and restricted to global platform administrators.
- Feed post/Reel and Help creation reuse `idempotency_keys` for durable whole-request response replay. Equivalent retries return the original response, changed-payload key reuse fails with HTTP 409, and failed transactions leave no successful replay state.
- Matchmaking discovery is selected-community scoped while profiles, matches and conversations remain canonical at account level. Nullable swipe source-community fields are audit metadata, not separate match partitions.
- Mobile composers retain exact retry requests in the mounted composer; cross-restart/reinstall recovery is not implemented.

### Migration and contracts

- `../diasporum-backend/src/main/resources/db/migration/V24__default_extended_community_access.sql` is the additive application migration. The clean-install SQL files remain unsuitable for in-place upgrades.
- `Diasporum_Shop_Marketplace_Data_Model_v10_13.md` Section 26 documents the persistence model.
- `Diasporum_Default_Extended_Community_System_Design.md` is the architecture supplement.
- `../diasporum-backend/docs/community-access-api-v1.yaml` is the OpenAPI 3.1 contract.
- `DIASPORUM_DEFAULT_EXTENDED_COMMUNITY_IMPLEMENTATION_REPORT.md` contains the complete implementation and verification record.

### Final automated validation

- Clean backend command `.\mvnw.cmd clean test`: **410 tests, 0 failures, 0 errors, 0 skipped; BUILD SUCCESS**. The clean build compiled 340 production and 46 test source files.
- The final Matchmaking suite passed **18/18**, including selected-community discovery and two concurrent LIKE attempts against one remaining allowance: one success, one `ENTITLEMENT_QUOTA_EXCEEDED`, no losing-transaction side effects and one community-targeted usage row.
- Final mobile Jest run: **44/44 suites and 534/534 tests passed**. Mobile lint reported zero errors and 15 existing warnings.
- Feed replay, conflict and rollback tests, Community access/Billing tests, MVC security slices, migration tests and existing module regressions are included in the clean backend result.
- The OpenAPI YAML parsed successfully with 12 paths using the existing `js-yaml` dependency. This was basic syntax/root-field validation, not full schema/controller conformance validation.
- Final corrections made the Community MVC interceptor safe for database-free test slices, removed a hardcoded V12 schema assertion in favor of Flyway's current version, and reset shared Service Marketplace entitlement fixtures between tests. Authorization, Billing, timeouts and assertions were not weakened.

### Remaining limits and rollout gates

- Administration is available through audited backend APIs; a substantive Next.js visual settings console was not added.
- No authenticated device/emulator/browser verification, production deployment, live provider transaction or restored-production-database migration rehearsal was performed.
- Mobile pending publication requests are not persisted across restart or reinstall.
- The consolidated DOCX/PDF viewing copies were not regenerated; the Markdown design supplement and implementation report are authoritative for this addition.
- Before rollout, rehearse V24 against a restored deployed copy, verify Flyway history, explicitly review production Billing/fallback configuration, run authenticated runtime smoke tests and monitor usage/replay/reversal behavior.
