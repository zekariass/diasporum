# Diasporum Global Shop Marketplace — Logical Data Model v10.13

**Status:** Proposed design for review; not an executable migration.  
**Baseline:** Diasporum v10.12 PostgreSQL/PostGIS schema and system design supplied with this request.  
**Prepared:** 4 November 2026.

This model adds full multi-vendor physical-goods commerce to Diasporum. It is deliberately additive and reuses existing v10.12 identity, Business Account, country, address, media, billing-entitlement, messaging, moderation, notification, audit, idempotency, featured-placement and outbox capabilities.

> **Migration warning:** v10.12 SQL is a clean-install baseline, not an upgrade script. This document does not assign a Flyway version and must not be executed as a migration. Before DDL is authored, inspect the repository's actual Flyway baseline and the deployed database, then prepare and rehearse an additive migration. Do not edit an already-applied migration or run the v10.12 clean-install script over a populated database.

---

## 1. Product decisions captured by this design

1. The Shop Marketplace is global-ready and country-aware, but a country is enabled only when seller onboarding, payment/payout, shipping, tax, consumer-protection and operational requirements have been reviewed.
2. Both individual sellers and Business Account sellers are supported. An individual seller maps to `users.id`; a business seller maps to `business_accounts.id`.
3. A seller is a legal/accounting party and can own one or more shops. A connected payment account belongs to the seller entity, not automatically to each storefront.
4. Product categories are global, hierarchical and centrally managed by Diasporum. They are separate from `business_categories`, `job_categories`, `service_categories` and country feed categories.
5. One cart and one checkout may contain items from multiple shops, in one checkout currency. The customer receives one parent order and each seller receives a separate seller order.
6. Sellers manage their own stock, packaging, shipping choices, dispatch and customer-facing shop policies. One seller order can have multiple parcels/shipments.
7. Shipping supports Shippo-calculated rates/labels where available and seller-managed external shipping with carrier/tracking details. Shippo/carrier coverage is not assumed for every route.
8. Stripe Connect is the initial payment-provider candidate. The proposed multi-seller flow is a platform charge followed by separate transfers to connected sellers, subject to Stripe eligibility, funds-flow configuration and legal approval.
9. Transfers and bank payouts are separate events. Connect is not escrow; the design does not promise that Diasporum can hold seller proceeds indefinitely until delivery.
10. Global tax is provider-backed. Diasporum stores registrations, calculation snapshots, tax lines, liability decisions and tax documents. It does not initially implement a home-grown country-by-country tax rules engine.
11. The existing Billing module remains responsible for subscriptions, entitlements and platform feature billing. Marketplace customer orders, seller transfers and refunds have separate commerce records.
12. Sellers use the React Native/Expo app's Seller Workspace, entered from Profile. No separate seller app or seller bottom-navigation tab is introduced. The Next.js app remains the admin/moderation and informational site.
13. Existing Business Account roles and fixed Java policies are reused. Do not add generic roles/permissions or a duplicate shop role-permission matrix.
14. The initial product and fulfilment model is physical goods. Digital products are a future extension requiring their own delivery, tax, refunds and consumer-rights design.

## 2. Domain boundaries

### 2.1 `shopmarketplace`

Owns sellers, shops, catalogue, product prices, inventory, cart, checkout, orders, seller fulfilment, shipping configuration, returns, reviews, promotions, commission snapshots and marketplace-specific financial records.

### 2.2 Existing modules to reuse

| Existing v10.12 module/table                                              | Marketplace use                                                             | Do not duplicate                                                                                |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `identity.users`                                                          | Customer and individual seller account identity                             | Do not create another users/profiles table                                                      |
| `businessaccounts.business_accounts`, `business_account_members`          | Business seller ownership and delegated staff access                        | Do not create `shop_members` or a generic permission matrix initially                           |
| `countries`                                                               | Legal seller country, buyer destination and market configuration FK         | Do not create a second country catalogue                                                        |
| `addresses`                                                               | Seller dispatch locations, inventory locations and saved customer addresses | Orders still need immutable address snapshots                                                   |
| `media_objects`                                                           | Shop logos/covers, product media, review evidence and shipping documents    | Add allowed media purposes `SHOP` and `PRODUCT` via a reviewed schema change                    |
| `billing_*`                                                               | Subscriptions, feature entitlements, optional paid promotion products       | Do not reuse `billing_orders`, `billing_payments` or `billing_refunds` for product purchases    |
| `featured_items`, `featured_placement_rules`, `featured_item_impressions` | Editorial/paid featured shops and products                                  | Extend the allowed content reference type; do not create `featured_shops` / `featured_products` |
| `reports`, `moderation_actions`, `audit_logs`                             | Shop/product/review reports, decisions and audit                            | Extend supported report target types and validation                                             |
| `notifications`, `notification_preferences`, `notification_deliveries`    | Buyer/seller updates and push delivery                                      | Add marketplace notification types rather than a second notification system                     |
| `outbox_events`, `idempotency_keys`                                       | Durable provider events, event publication and safe retry                   | Reuse the existing transactional outbox/idempotency contracts                                   |
| `direct_conversations` and Messaging API                                  | Buyer-to-seller/product/order conversation contexts                         | Extend allowed contexts; do not create a new chat subsystem                                     |
| `media_processing_jobs`                                                   | Product image/video processing                                              | Reuse media pipeline and ACLs                                                                   |

The existing service marketplace remains a lead/contact product. It must not be folded into shop checkout or treated as a seller product catalogue.

## 3. Country, market and currency model

`countries` remains the authoritative country reference. Add `marketplace_country_settings` to explicitly control marketplace readiness per country, and `product_market_availability` to define product-level destination eligibility. A country can be visible for browsing while buying, seller onboarding or payouts are disabled.

A market must not become purchasable merely because its country row exists. Enablement checks include:

- Buyer checkout and payment-method support.
- Whether a seller in that country can be onboarded by the selected Connect configuration or an approved alternative payout provider.
- Cross-border transfer and settlement support for the platform/seller-country pair.
- Shipping-carrier and Shippo route coverage, or seller-managed shipping readiness.
- Tax provider coverage and the legally responsible tax entity.
- Consumer returns/refund requirements, product restrictions, customs/import requirements and required disclosures.

Use ISO 4217 currency codes. Prices are represented as integer minor units with a currency code, using the currency's actual minor-unit exponent (not an assumption that every currency has two decimal places). `product_market_availability` explicitly enables or restricts each product by destination country. `product_variant_prices` stores explicit prices per variant, market country and currency, so different countries that share a currency can still have different prices. One checkout/order uses one currency. The initial design does not promise automatic FX conversion; a currency must have an explicit price or a separately approved FX quote/price-conversion integration.

The active Diasporum community is not a marketplace access boundary. Product and shop discovery are based on marketplace country/market, product-level availability, shipping destinations, moderation and user filters. Community membership must not be inferred from a profile's origin/current country and must not be required to buy globally available products.

## 4. Seller ownership and permissions

`marketplace_sellers` represents the legal seller entity. Exactly one of `owner_user_id` or `business_account_id` is populated. For an individual, the authenticated `users.id` owns the seller. For a business, active `business_account_members` govern access through fixed Java capability policies:

- `OWNER` / `ADMINISTRATOR`: full seller/shop administration, subject to platform policy.
- `EDITOR`: permitted catalogue and content edits.
- `LISTING_MANAGER`: products, variants, inventory and listing lifecycle.
- `BILLING_MANAGER`: payment-account status, financial reports and permitted payout settings.

Do not trust role, seller ID, shop ID or ownership values supplied by the client. Every query and command resolves the seller through the authenticated actor and Business Accounts API/policy. Revoked members lose access immediately. Individual sellers do not receive extra staff accounts through a parallel role table; delegated teams use a Business Account.

A `seller_payment_accounts` row links a seller entity to its Stripe connected account. A single connected account may support multiple shops owned by the same legal seller. Never create a new Connect account just because the seller opens another storefront.

## 5. Buyer and seller mobile experience

### 5.1 Buyer surfaces

- Marketplace discovery: search, global product categories, country/ship-to filter, shop filters, price range, condition, availability and delivery estimate where known.
- Product detail: variants, explicit currency price, product condition, stock/availability, seller/shop identity, shipping/returns policy summary, reviews and seller contact.
- Cart: mixed-shop items, per-seller subtotals and shipping selections, unavailable-item handling and currency consistency.
- Checkout: delivery address, seller-specific shipping options, discounts, tax calculation, final amount and payment confirmation.
- Orders: one parent order, seller-order sections, separate shipments/tracking, cancellation/refund/return status and support contact.
- Wishlist and verified-purchase reviews.

### 5.2 Seller Workspace

Entry point: `Profile -> Seller Workspace`. Keep it distinct from the existing Business Workspace. A user with multiple shops chooses a shop; business-owned shops use Business Account membership/permissions.

Seller Workspace sections:

1. Overview: sales summary, order queue, low stock, returns requiring attention and account/payment readiness.
2. Products: create/edit/draft/publish/archive products, manage variants, media, prices, category attributes and availability.
3. Inventory: stock by location/variant, reservations, adjustments and movement history.
4. Orders: new/processing/dispatched/delivered/cancelled seller orders, item details, customer address disclosure only when needed for fulfilment.
5. Shipping: zones, methods, free-shipping rules, package defaults, Shippo rates/labels and external carrier/tracking entry.
6. Earnings and payouts: order proceeds, commission, transfers, Stripe payout state, refunds, fees and reconciliation references. Distinguish pending, transferred and paid-out amounts.
7. Promotions: discount codes, product/category promotions and featured placement requests/campaign status.
8. Returns and disputes: review requests, decisions, return parcel status, partial/full refunds and evidence.
9. Reviews and shop settings: customer reviews, seller response, shop profile, policy and support details.
10. Payments: Connect onboarding, requirements due, charges/payout capability and Stripe-hosted account-management link where available.

Mobile screens must include loading, empty, offline, retry, permission-denied, verification-pending, payment-restricted and market-not-supported states. Seller financial data is restricted to the authorised seller entity and must never be shown to all business members by default without policy.

## 6. Product catalogue and publication

Use a single global hierarchical `product_categories` taxonomy with translated labels. It is independent from all existing feature taxonomies. Category definitions describe filterable attributes (for example size, colour, material, compatibility, model, dimensions). `products.attributes` is a validated JSONB object for product-level category attributes; variant-defining attributes are stored in `product_variant_attribute_values`.

Every published product has at least one purchasable variant. A simple product uses one default variant. SKU uniqueness is scoped to a seller (or seller + SKU) rather than globally. `product_market_availability` defines where a product may be offered; `product_variant_prices` stores an explicit amount for each supported market/currency pair. Product list cards can show the selected market price only when a matching price exists.

Product lifecycle: `DRAFT -> PENDING_REVIEW (when moderation is required) -> PUBLISHED -> PAUSED / OUT_OF_STOCK / ARCHIVED / REMOVED`. Only published, in-market, deliverable and moderation-eligible products are purchasable. Product publication rechecks category active state, media READY state and shop/seller status.

Product photos/videos use `media_objects` in R2 and a `product_media` join table. The media module validates ownership, purpose, MIME/signature, size, malware/content checks where selected, processing state and access scope. Product media is not public until the owning product is published and its access policy allows it.

## 7. Inventory and stock reservations

Inventory is tracked per variant and location. `inventory_items.quantity_on_hand` is the physical on-hand quantity. Active `inventory_reservations` reduce available stock:

`available = quantity_on_hand - sum(active, unexpired reservations)`.

Reservation creation is transactional and concurrency-safe (row lock or atomic conditional update). Checkout reserves stock for a short configurable period (initial proposal: 15 minutes). Successful payment converts the reservation to confirmed stock movement; payment failure, cancellation or expiry releases the reservation. A scheduled worker expires stale reservations idempotently. Never rely on a mobile timer for reservation expiry.

Manual adjustments require a reason and create an immutable `inventory_movements` record. Order confirmation, fulfilment, cancellation, return/restock and damage write explicit movements. A return does not automatically restock a product; seller/admin inspection and disposition policy decide whether it returns to sellable stock.

## 8. Multi-seller cart, checkout and order structure

A cart may contain multiple shops but one checkout currency. Cart items reference variants; checkout resolves the active seller, shop, variant, market-specific currency price, product-country availability, stock, shipping destination, discount and tax. If any line lacks an explicit price for the selected market/currency, is not enabled for the destination country or cannot ship to the destination, checkout must ask the buyer to resolve it or remove the item; it must not silently convert or omit charges.

Checkout quote is an attempt, not yet a customer order. It snapshots product name, SKU, variant label, selected market/currency price, quantity, discounts, shipping quote, delivery destination, currency, tax calculation reference and relevant shop policy versions. At buyer confirmation, copy the accepted quote into pending parent/seller order snapshots before payment. Shipping is calculated per shop. A free-shipping threshold applies to the eligible subtotal for that seller only, not the entire mixed-shop cart.

When the buyer confirms checkout, create the parent `orders` record and one `seller_orders` record per participating shop in `PAYMENT_PENDING`, together with immutable `order_items` and address/price/shipping/discount/tax snapshots. Create the PaymentIntent idempotently and associate it with the parent order. A verified payment-success webhook then finalizes the order to `PLACED` and confirms inventory reservations/stock movements. If payment fails or expires, cancel the pending orders and release reservations exactly once. This avoids a circular dependency in which a payment would need an order ID before the order exists.

Parent order status is an aggregate summary. Seller order status is independently authoritative for each seller's fulfilment. Seller A dispatching must not move Seller B's order to dispatched. Customer order detail displays seller-order progress and multiple shipments under one parent.

## 9. Payment architecture — Stripe Connect

### 9.1 Account onboarding

Use Stripe-hosted Connect onboarding as the initial integration choice, with the connected-account controller/dashboard configuration confirmed before implementation. Generate one-time Account Links on the server only. The authenticated Expo app opens the URL in the system browser and returns via a verified app/universal link. The return URL is not proof of verification: the app refreshes status from Diasporum and the backend reconciles through signed webhooks and an account retrieval. Persist Stripe account ID and capability/requirements status; do not persist identity documents or bank credentials in Diasporum.

Use one connected account per legal seller/payment entity where supported; multiple shops owned by that entity can use the same seller payment account. Account type/dashboard properties are difficult or impossible to change later, so final Express/Standard/custom controller model is a launch gate, not an incidental implementation detail.

### 9.2 Multi-seller money flow

Candidate flow: one platform PaymentIntent/charge for the full customer checkout, then separate transfers to the connected account for each seller order. The backend calculates allocations and commissions; Stripe executes transfers. Use a transfer group to associate the transfers with the parent order and source-transaction linkage where supported/appropriate. Persist every PaymentIntent, Charge, transfer, reversal, refund and payout identifier.

Illustration: items of 60 and 40 units from two sellers, 10% commission each; seller allocations are 54 and 36, platform commission is 10, before shipping, tax, Stripe fees and other adjustments. This is an example only; the actual allocation formula and commission base must be configured and snapshotted.

A single payment does not guarantee atomic success of every seller transfer. Model payment success, each transfer's pending/succeeded/failed/reversed status and any recovery/retry separately. Do not charge the customer again because one transfer failed. Use idempotency keys and reconciliation jobs.

### 9.3 Transfers, payouts and refunds

A transfer moves funds from the platform Stripe balance to a connected account balance. A payout is a subsequent movement from the connected account balance to its bank. They are different states and should appear separately in Seller Workspace.

The initial release should not promise escrow or hold funds until delivery. A proposed default is transfer when the customer charge has succeeded and funds are eligible/available, subject to the final Connect funds-flow and risk decision. Refunds after transfer may require a full/partial transfer reversal; a reversal can fail if the connected account does not have sufficient balance. The platform may carry balance, refund, dispute or negative-balance exposure depending on the chosen Connect configuration. Obtain legal, finance and Stripe approval for the platform's merchant-of-record/merchant responsibility, refunds, disputes, seller terms and loss allocation before launch.

## 10. Shipping and Shippo

A seller defines country shipping zones and shipping methods. Methods can be flat-rate, weight-based, free, free-above-threshold, Shippo-calculated or seller-managed external carrier. Rule evaluation and the seller-specific eligible subtotal are snapshotted at checkout. Changing a shipping method later never recalculates an existing order.

Shippo integration supports the shipment -> rates -> label purchase -> tracking lifecycle where Shippo and the selected carrier support the route. Seller can use permitted seller/carrier account references through Shippo where configured; credential secrets remain with the provider/secrets manager. A seller-managed method stores validated carrier name, tracking reference and safe tracking URL, without claiming a Shippo label was created.

One seller order can have many shipments; one shipment can have many packages and shipment items. Package weight and dimensions are captured per package. Labels are stored as protected media or provider references; do not assume a provider URL is permanent. Tracking webhooks update shipment events idempotently. Use `shipments.shipment_type='RETURN'` for return parcels, avoiding a separate return-shipment table.

For international parcels, customs descriptions, HS codes, origin country, declared value, commercial invoices, restricted items, duties and import taxes require a separate approved shipping/customs policy. Shippo coverage and service availability are route/carrier-dependent; do not expose a rate/label option unless returned and validated by the provider.

## 11. Global tax — deliberately small, provider-backed

Initial dedicated tax tables (7):

1. `tax_registrations`
2. `tax_calculations`
3. `tax_calculation_lines`
4. `tax_liability_records`
5. `tax_documents`
6. `tax_document_lines`
7. `tax_provider_configurations`

Provider webhook/event delivery is recorded through `marketplace_webhook_events`, not a second tax-only event queue. Use the external provider for supported calculations; persist immutable calculation snapshots and the liable entity. The provider may calculate a rate/amount but it does not automatically settle the legal question of which seller or marketplace entity must account for tax. That liability must be determined and approved for each supported marketplace model/jurisdiction. If the tax provider or approved liability configuration cannot calculate a transaction, checkout fails closed rather than silently applying zero tax.

Tax calculation lines may include multiple components for one order item (for example, combined state/local taxes). Store currency, taxable amount, tax amount, tax type, jurisdiction code, rate, tax-inclusive flag and provider reference. Liability records store whether the seller or platform is responsible and the actual liable entity. Tax documents can be issued by the relevant seller/platform entity; the invoice issuer must agree with the legal supply model. Tax returns and remittances are deferred; external tax calculation is not the same as registration, filing or remitting tax.

## 12. Discounts, campaigns and featured placements

`marketplace_promotions` represents time-bounded seller or platform campaigns; product/category join tables define eligible items. `discount_codes` and `discount_redemptions` cover redeemable codes and limits. Discounts are snapshotted per checkout item and seller order; the system records who funded the discount (seller, platform or shared) so seller settlement is correct.

Reuse `featured_items`, `featured_placement_rules` and `featured_item_impressions` for `SHOP` and `PRODUCT` targets by extending the existing `content_reference_type` enum and allowed placement configuration. Label paid/sponsored placements, apply frequency caps and serve-time eligibility checks. Do not create `featured_shops` or `featured_products` tables.

Paid promotion products/entitlements should reuse the existing Billing catalogue/entitlement system when enabled. Do not hardcode subscription limits or paid-placement price in the marketplace service.

## 13. Reviews, messaging, moderation and notifications

A product review requires an eligible purchased order item; a shop review is linked to a completed/eligible seller order under the published review policy. Product/shop review media references `media_objects`. Do not claim a review proves the work was completed; that limitation belongs to the existing service marketplace, not product purchases.

Reuse `reports`, `moderation_actions` and `audit_logs`. Add shop/product/review target types to the appropriate existing enum/validation contracts. Marketplace moderation can pause/hide shops and products; moderation does not delete financial or completed-order history.

Reuse `direct_conversations` with new context types for shop, product and seller-order support. Respect existing message-request, block, privacy and business participant rules. Reuse notification preferences, in-app notifications, push delivery and outbox; add types for new order, order update, shipment update, return update, payout/account action and low-stock alerts.

## 14. Proposed API surface

All routes are proposals, not implemented endpoints. Use the existing `/api/v1` convention, server-derived identity, explicit DTOs, cursor pagination, correlation IDs, idempotency keys and module public APIs.

### Buyer

- `GET /api/v1/marketplace/markets`
- `GET /api/v1/marketplace/categories`
- `GET /api/v1/marketplace/products`
- `GET /api/v1/marketplace/products/{productId}`
- `GET /api/v1/marketplace/shops/{shopId}`
- `GET/POST /api/v1/marketplace/cart`
- `PATCH/DELETE /api/v1/marketplace/cart/items/{itemId}`
- `POST /api/v1/marketplace/checkout/quote`
- `POST /api/v1/marketplace/checkout`
- `GET /api/v1/marketplace/orders`
- `GET /api/v1/marketplace/orders/{orderId}`
- Wishlist, reviews, returns and seller-contact routes under `/api/v1/marketplace/...`.

### Seller Workspace

- `GET/POST /api/v1/seller/shops`; `GET/PATCH /api/v1/seller/shops/{shopId}`
- Product/category/variant/price/media CRUD and publish/archive operations under `/api/v1/seller/shops/{shopId}/products`.
- Inventory views and adjustment routes under `/api/v1/seller/shops/{shopId}/inventory`.
- Seller-order list/detail/status/dispatch routes under `/api/v1/seller/shops/{shopId}/orders`.
- Shipping zones/methods/rates/labels/tracking configuration under `/api/v1/seller/shops/{shopId}/shipping`.
- Return decisions, refund requests, reviews and promotion administration under `/api/v1/seller/shops/{shopId}/...`.
- `POST /api/v1/seller/shops/{shopId}/payments/connect/onboarding`
- `GET /api/v1/seller/shops/{shopId}/payments/connect/status`
- `POST /api/v1/seller/shops/{shopId}/payments/connect/refresh-link`
- `GET /api/v1/seller/shops/{shopId}/earnings` and payout history.

### Provider webhooks and admin

- `POST /api/v1/webhooks/stripe` (signature verification before persistence/processing)
- `POST /api/v1/webhooks/shippo` (provider authenticity verification where available)
- Platform-admin routes for country enablement, category/taxonomy moderation, shop/product review, commission configuration, featured placements and disputes.

## 15. Spring Boot module placement

Add `shopmarketplace` to the root backend package. Suggested module structure:

```text
shopmarketplace/
├── ShopMarketplaceApi.java
├── package-info.java
└── internal/
    ├── api/rest/                 # buyer, seller and admin controllers/DTOs
    ├── application/              # commands, queries, policies, orchestration
    ├── domain/                   # seller, shop, product, inventory, order, shipment
    ├── infrastructure/persistence/
    ├── infrastructure/stripe/    # Connect accounts, payments, transfers, webhooks
    ├── infrastructure/shippo/    # rates, labels, tracking and webhook adapter
    ├── infrastructure/tax/      # provider adapter and tax snapshot mapper
    └── jobs/                     # reservation expiry, reconciliation and tracking repair
```

Use public APIs of Identity, Business Accounts, Address, Media, Billing, Messaging, Notifications, Moderation and Search modules. Do not access another module's internal repositories. Stripe, Shippo and tax-provider SDKs stay behind adapters; no secrets in mobile or web builds.

## 16. Complete proposed marketplace table inventory (74 tables)

The 74 proposed tables below are new marketplace persistence objects. Existing shared tables listed in Section 2 are reused and are not counted.

### A. Country and seller foundation (7)

| Table                          | Key responsibilities / important columns                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `marketplace_country_settings` | One row per `countries.id`; market status, buyer checkout enabled, seller onboarding enabled, default currency, allowed currency codes, payment/shipping/tax readiness configuration and rollout timestamps. |
| `marketplace_sellers`          | Seller legal entity; `seller_type`, exactly one of `owner_user_id` or `business_account_id`, legal country, display/legal name, status and lifecycle timestamps.                                             |
| `seller_payment_accounts`      | Seller-to-provider relationship; provider key, connected account ID, account country/type, onboarding/capability status, requirements due snapshot and last sync.                                            |
| `shops`                        | Storefront; seller FK, unique slug, name, description, status, primary market/country and publication timestamps.                                                                                            |
| `shop_policies`                | Versioned shipping/return/cancellation/refund policy document and effective version.                                                                                                                         |
| `shop_shipping_profiles`       | Default dispatch inventory location, handling time, package defaults and permitted provider/carrier account reference.                                                                                       |
| `shop_media`                   | Shop-to-`media_objects` relationship with role (logo, cover, gallery) and display order.                                                                                                                     |

### B. Catalogue and product media (12)

| Table                              | Key responsibilities / important columns                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `product_categories`               | Global category tree; parent, slug, active status, sort order and provider-neutral tax category key.                                                                                             |
| `product_category_translations`    | Category name/description per language code.                                                                                                                                                     |
| `product_attribute_definitions`    | Category-specific attribute key, data type, required/filterable/variant-level flags and validation config.                                                                                       |
| `product_attribute_options`        | Controlled options for enumerated attributes.                                                                                                                                                    |
| `products`                         | Shop, category, name, slug, description, brand, condition, status, validated product-level attributes JSONB and publication fields.                                                              |
| `product_market_availability`      | Per-product country eligibility; product, country, status, availability reason, effective dates and audit timestamps. Prevents display or purchase in restricted/unapproved destination markets. |
| `product_variants`                 | Product, seller-scoped SKU/barcode, variant label, weight/dimensions, status and fulfilment metadata. Every product has at least one variant.                                                    |
| `product_variant_attribute_values` | Normalized size/colour/variant-defining attribute values by variant and attribute definition.                                                                                                    |
| `product_variant_prices`           | Variant, currency code, amount in currency minor units, optional compare-at price, effective dates and status.                                                                                   |
| `product_media`                    | Product-to-`media_objects` links, media role, sort order and alt text.                                                                                                                           |
| `product_tags`                     | Normalized controlled/user-suggested search tags.                                                                                                                                                |
| `product_tag_assignments`          | Product-to-tag join and ordering.                                                                                                                                                                |

### C. Inventory (4)

| Table                    | Key responsibilities / important columns                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inventory_locations`    | Seller stock/dispatch location; shop/seller, shared `address_id`, label, status and location type.                                                 |
| `inventory_items`        | Unique inventory location + variant; quantity on hand, low-stock threshold, updated time. Available quantity is derived after active reservations. |
| `inventory_reservations` | Checkout, inventory item, quantity, ACTIVE/CONFIRMED/RELEASED/EXPIRED state, expires time and state timestamps.                                    |
| `inventory_movements`    | Immutable stock adjustment/receipt/dispatch/return/write-off record, signed quantity delta, reason and source reference.                           |

### D. Cart and checkout (7)

| Table                  | Key responsibilities / important columns                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shopping_carts`       | Customer, selected currency, active/abandoned/converted status and timestamps.                                                                                  |
| `shopping_cart_items`  | Cart, variant, quantity and added/updated timestamps. Seller/shop is derived from product ownership.                                                            |
| `wishlists`            | Customer-owned named wishlist.                                                                                                                                  |
| `wishlist_items`       | Wishlist/product join.                                                                                                                                          |
| `checkout_sessions`    | Customer, cart, currency, quoted subtotal/shipping/discount/tax/total, status, expiry and tax-calculation reference.                                            |
| `checkout_items`       | Immutable checkout-time product, variant, SKU, seller/shop, quantity, currency price, discounts and tax-reference snapshot.                                     |
| `shipping_rate_quotes` | Checkout, seller/shop, shipping method/provider/rate reference, amount/currency, service description and expiry; selected quote is snapshotted to seller order. |

### E. Orders (6)

| Table                         | Key responsibilities / important columns                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orders`                      | One parent order per customer checkout; order number, customer, currency, monetary totals, payment/aggregate status and placed time.                                  |
| `seller_orders`               | One seller/shop-specific order per parent order; seller subtotal, discounts, shipping, tax, commission, seller net, policy snapshot and fulfilment status.            |
| `order_items`                 | Immutable purchased product/variant/SKU/name/condition/price/quantity/discount/tax snapshots; nullable product FKs preserve history if catalogue entries are removed. |
| `order_addresses`             | Immutable billing/shipping address snapshots (not live references to mutable address rows).                                                                           |
| `order_status_history`        | Parent order state transition history with actor/reason/time.                                                                                                         |
| `seller_order_status_history` | Seller order state transition history with actor/reason/time.                                                                                                         |

### F. Payment, Connect, ledger and disputes (9)

| Table                              | Key responsibilities / important columns                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marketplace_payments`             | One or more payment attempts against parent order; provider, PaymentIntent/Charge IDs, amount/currency/status and paid timestamps.                                        |
| `marketplace_payment_transactions` | Append-only provider transaction/event references for authorisation, capture, failure, fee, refund and related financial events.                                          |
| `seller_transfers`                 | One allocation/transfer per seller order; connected account, gross/commission/net amounts, Stripe transfer ID, transfer group, source charge, status and reversal totals. |
| `marketplace_refunds`              | Customer refund amount/currency/reason/status; references payment and optionally seller order/item; Stripe refund ID and transfer reversal state reference.               |
| `seller_payout_records`            | Stripe payout object/status for a connected seller account; amount, currency, arrival/paid/failed timestamps and provider reference.                                      |
| `marketplace_webhook_events`       | Stripe/Shippo (and relevant tax provider) webhook event ID, type, verified payload reference, processing status, attempts and error details. Unique provider/event ID.    |
| `marketplace_ledger_transactions`  | Immutable journal header; order/payment/seller reference, event type, currency, idempotency key and creation time.                                                        |
| `marketplace_ledger_entries`       | Debit/credit entries per journal, ledger account, seller/platform entity, amount in minor units and currency. Journal must balance per currency before commit.            |
| `marketplace_disputes`             | Stripe chargeback/dispute and internal buyer-seller case reference, amount, reason, evidence deadline, status and resolution.                                             |

### G. Shipping and fulfilment (9 additional; quotes are in checkout group)

| Table                      | Key responsibilities / important columns                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shipping_zones`           | Shop-specific destination zone and status.                                                                                                                 |
| `shipping_zone_countries`  | Zone-to-`countries` join.                                                                                                                                  |
| `shipping_methods`         | Seller method type (flat, weight, free, threshold, Shippo, external), name, zone, currency and status.                                                     |
| `shipping_method_rules`    | Validated rule JSON/config or typed threshold fields; seller-specific free threshold and weight/rate conditions.                                           |
| `shipments`                | Seller order, optional inventory origin, OUTBOUND/RETURN type, provider/carrier, tracking and lifecycle status; return request reference when type RETURN. |
| `shipment_items`           | Shipment/order-item/quantity allocation. One order item may be split across parcels.                                                                       |
| `shipment_packages`        | Individual parcel weight, dimensions, package type and customs data reference where required.                                                              |
| `shipping_labels`          | Package, provider label/transaction/carrier service identifiers, protected media reference, label status and purchase cost.                                |
| `shipping_tracking_events` | Provider event ID, status/code, description/location/time and idempotency reference.                                                                       |

### H. Promotion and discounts (5)

| Table                    | Key responsibilities / important columns                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `marketplace_promotions` | Seller/platform campaign, promotion type, discount/funding model, dates, status and limits.           |
| `promotion_products`     | Promotion/product join.                                                                               |
| `promotion_categories`   | Promotion/category join.                                                                              |
| `discount_codes`         | Shop/platform code, type/value/currency, min spend, total/per-user limits, dates and active state.    |
| `discount_redemptions`   | User/order/code redemption snapshot, amount funded and timestamp; unique constraints prevent overuse. |

Featured shop/product placement uses existing featured tables with approved enum/config additions.

### I. Reviews (3)

| Table                  | Key responsibilities / important columns                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `product_reviews`      | Product, eligible order item, reviewer, rating, text, moderation status and timestamps; one permitted review per purchase item. |
| `product_review_media` | Review-to-`media_objects` links.                                                                                                |
| `shop_reviews`         | Shop, eligible seller order, reviewer, rating, text, seller response and moderation status.                                     |

### J. Returns (4)

| Table                   | Key responsibilities / important columns                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `return_requests`       | Seller order/customer, reason, description, request status, decision, timestamps and outcome. |
| `return_request_items`  | Return request, order item, quantity, condition/reason and requested resolution/refund.       |
| `return_request_media`  | Return evidence media links.                                                                  |
| `return_status_history` | Return state transition history. Return parcels use `shipments.shipment_type='RETURN'`.       |

### K. Commission (1)

| Table                          | Key responsibilities / important columns                                                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marketplace_commission_rules` | Global/shop/category scoped rate in basis points and/or fixed minor-unit fee, currency, priority, effective dates and status. Actual commission is snapshotted to seller order/ledger. |

### L. Global tax (7)

| Table                         | Key responsibilities / important columns                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tax_registrations`           | Seller or platform tax registration by country/jurisdiction and tax type, registration number, status and validity dates.                                 |
| `tax_calculations`            | External provider calculation reference, checkout/order link, currency, total tax, status and timestamp.                                                  |
| `tax_calculation_lines`       | Per order item/shipping/charge taxable amount, tax rate, tax amount, tax type, jurisdiction and inclusive flag.                                           |
| `tax_liability_records`       | Final liable party/entity (seller or platform), seller order, jurisdiction/tax type, decision source and reason snapshot.                                 |
| `tax_documents`               | Invoice/credit-note metadata, issuer entity, order/seller order, number, currency, totals and protected document reference.                               |
| `tax_document_lines`          | Invoice/credit-note lines linked to calculation/order lines, descriptions, quantities, taxable amount, tax and total.                                     |
| `tax_provider_configurations` | Provider key, market/jurisdiction scope, environment, enabled calculation capabilities and non-secret configuration. Secrets remain in a secrets manager. |

`marketplace_webhook_events` handles provider event idempotency; a separate `tax_provider_events` table is not required initially.

## 17. Key database constraints and indexes

- XOR ownership: exactly one of `marketplace_sellers.owner_user_id` and `business_account_id` is non-null.
- Unique seller/provider connected account reference; never duplicate a Stripe account for every shop belonging to the same legal seller.
- Unique shop slug under the intended market/namespace; product slug unique per shop; SKU unique per seller.
- Product must belong to a seller through its shop; variants must belong to the same product; prices must be unique per variant/currency/effective start.
- Checkout currency must match all selected item price currencies and selected shipping quote currencies.
- One active cart per user/currency where intended; one order per successfully placed checkout session.
- One seller order per `(order_id, shop_id)` or `(order_id, seller_id)` according to whether one seller can have multiple shops in one checkout. Recommended: one seller order per shop in the parent order, allowing seller separation where storefront operations differ.
- Order/item snapshots are immutable after placement except explicitly audited corrections/financial adjustments.
- Reservation quantity must be positive; reservation expiry must be after creation; active reservations must not cause overselling under concurrent checkouts.
- Inventory movement records are append-only; manual adjustment requires reason and actor.
- Each seller transfer must be <= the corresponding eligible seller proceeds, and transfer currency must match supported settlement/transfer constraints.
- Ledger journals must balance debit/credit per currency before being committed; no update/delete of posted ledger entries.
- Refund totals and transfer reversals must not exceed the refundable/unreversed amounts; concurrent refund requests must be serialised.
- One verified review per eligible order item and one shop review per eligible seller order according to policy.
- Webhook `(provider_key, external_event_id)` unique; webhook handler idempotent under retry/reorder.
- Shippo/other provider IDs indexed and unique in the appropriate scope; tracking events deduplicated by provider event ID.
- Currency stored with every monetary amount; amounts use currency minor units and currency-specific exponent. Never aggregate currencies without an explicit FX conversion record.
- Foreign-key delete rules preserve placed orders, financial ledger, tax records and audit trails. Product/shop deletion is soft/archive where history exists.
- Search/discovery indexes support category, shop, product status, country market, availability, effective price and text. Do not expose private dispatch/customer addresses in public search.

## 18. Existing v10.12 schema extensions to review

The eventual migration must review and explicitly update these existing schema contracts:

1. `media_objects.purpose` CHECK: allow `SHOP` and `PRODUCT` purposes (and any separately approved review/document purpose).
2. `content_reference_type` enum: add `SHOP` and `PRODUCT` for `featured_items` / `featured_placement_rules`.
3. `report_target_type` enum and report-target validation: allow shop, product, product review and shop review targets.
4. `direct_conversations.context_type` CHECK: add `SHOP`, `SHOP_PRODUCT` and `SHOP_ORDER` (or the final approved naming) while preserving canonical participant ordering and context uniqueness.
5. `notification_type` enum: add seller/customer shop-order, shipment, return, payout/account-action and low-stock event types.
6. `billing_products.target_type` CHECK: add `SHOP`/`PRODUCT` only if paid featured placement products are enabled; otherwise defer.
7. Existing `featured_placement_rules` seed/configuration: define allowed marketplace placement keys and paid/editorial behaviour; content type additions alone do not enable placements.
8. Add `shopmarketplace` to the backend module architecture and module-boundary tests; add API event/outbox types and admin scope.

Do not update already-applied migrations. The exact Flyway version and whether the repository has an existing baseline must be determined from the actual repo/deployment.

## 19. State models

### Seller / shop

`PENDING_REVIEW -> ACTIVE -> PAUSED / SUSPENDED / CLOSED` (with `REJECTED` or `RESTRICTED` where policy requires). Seller verification/onboarding state is separate from shop publication state.

### Product

`DRAFT -> PENDING_REVIEW -> PUBLISHED -> PAUSED / OUT_OF_STOCK / ARCHIVED / REMOVED`.

### Checkout

`OPEN -> QUOTED -> PAYMENT_PENDING -> PLACED` with terminal/recovery states `EXPIRED`, `CANCELLED`, `PAYMENT_FAILED`. Do not mark order placed until payment state and order-creation invariants are reconciled.

### Payment / transfer / payout

Keep separate state machines for customer payment, seller transfer, refund, dispute and payout. A payment may succeed while one transfer is pending/failed; this is not a failed customer payment.

### Seller order

`PLACED -> ACCEPTED -> PROCESSING -> PARTIALLY_DISPATCHED / DISPATCHED -> DELIVERED`, with `CANCEL_REQUESTED`, `CANCELLED`, `RETURN_REQUESTED`, `PARTIALLY_RETURNED`, `RETURNED` and `REFUNDED` states as appropriate. Parent order status is derived/aggregated.

### Shipment

`LABEL_PENDING -> LABEL_CREATED -> READY_TO_DISPATCH -> IN_TRANSIT -> OUT_FOR_DELIVERY -> DELIVERED`, with `FAILED`, `RETURNED_TO_SENDER`, `CANCELLED`, `LOST` as carrier/policy events. Preserve provider event history.

### Returns

`REQUESTED -> UNDER_REVIEW -> APPROVED / REJECTED -> AWAITING_RETURN -> RETURN_IN_TRANSIT -> RECEIVED -> INSPECTED -> REFUND_PENDING -> REFUNDED / CLOSED`. Seller policy and country law determine eligibility; no state is assumed to require refund before inspection.

## 20. Security, reliability and compliance gates

- All customer/seller/admin commands are authenticated and server-authorised; derive actor from `users.id`.
- Enforce seller/shop access using `marketplace_sellers`, `business_account_members` and module policy on every endpoint, including media grants, webhooks, deep links and exports.
- Never disclose full address or phone details in catalogue/search; disclose delivery address only to the seller/fulfilment actors who need it for an active order.
- Do not expose Stripe account requirements, bank information, private provider payloads, webhook secrets or other sellers' financial data to clients.
- Verify webhook signatures before storing/processing events. Persist raw provider evidence safely; avoid putting sensitive PII in logs.
- Use idempotency for checkout, payment, transfer, refund, label purchase, inventory reservation, discounts and webhook handlers.
- Use transactional outbox for durable order/stock/notification changes; events are published after commit and deduplicated by event ID.
- Provider timeouts must not create duplicate charges, duplicate transfers, double stock release or duplicate labels. Add reconciliation jobs for payment/transfer/payout/shipment drift.
- Use immutable snapshots and append-only financial history. Reconcile Stripe balance transactions, transfers, reversals, refunds and payouts against the Diasporum ledger.
- Define prohibited/restricted goods, product safety, counterfeit, sanctions/export, customs, consumer returns, privacy, seller terms and jurisdiction-specific obligations before enabling each market.
- Keep tax and payment secrets in the approved secret store, never in tables, source code or client bundles.
- Privacy export/deletion must preserve records that must legally be retained, with documented anonymisation/retention policy.

## 21. Required acceptance tests

1. Seller ownership XOR and Business Account role/revocation enforcement.
2. Multiple shops under one legal seller share one connected account; one seller cannot see another seller's dashboard or orders.
3. Global category hierarchy/translations, category-specific attribute validation, per-country product availability and market/currency variant price integrity.
4. Market/currency catalogue pricing, one-currency checkout validation and rejection of unsupported/missing market prices.
5. Mixed-shop cart creates pending parent/seller orders before payment, then finalizes them once on verified payment; each seller's subtotal/shipping/discount/tax/commission snapshots reconcile to parent totals.
6. Concurrent checkout race on final stock never oversells; reservation expiry/release/confirmation is idempotent.
7. Price/category/status change after checkout quote cannot silently change placed order snapshots.
8. Seller shipping thresholds are evaluated on that seller's eligible items only; one seller's shipping/dispatch does not alter another seller order.
9. Shippo test-mode rate/label/tracking lifecycle and seller-managed external tracking lifecycle; duplicate/out-of-order webhook handling.
10. Stripe onboarding: link one-time use/expiry/refresh, return-without-completion, capability/requirements changes, webhook verification, and country eligibility.
11. One parent payment can produce multiple transfers; transfer failure does not recharge customer; retry is idempotent; refund/partial refund and transfer reversal are reconciled.
12. Transfer and payout are displayed separately; balance/reconciliation records do not report a transfer as bank payout.
13. Tax provider failure or unsupported liability configuration blocks checkout; seller/platform liability snapshots remain immutable; multiple tax components and credit-note reversals are correct.
14. Return one seller's item while another seller order remains delivered; partial refund and stock disposition are correct.
15. Review eligibility prevents self-review and reviews without eligible purchase.
16. Reports/moderation/featured targets validate object existence, status, country and placement allow-list at creation and serving.
17. Contextual buyer-to-seller messaging respects privacy, blocks, requests and shop/order participant authorisation.
18. Mobile Seller Workspace states, screen-reader labels, offline/retry flows, large text, deep links and permissions.
19. Module-boundary tests prove marketplace code calls public APIs rather than internal repositories of Business Accounts, Billing, Media, Messaging, Moderation and Notifications.
20. Fresh schema install, migration rehearsal from the exact existing DB, Postgres concurrency/integration tests, reconciliation tests and restore/rollback or forward-fix rehearsal.

## 22. Delivery phases

1. **Foundation:** market settings, sellers/shops, seller permissions, product categories, catalogue, variants, prices and media.
2. **Stock and buyer journey:** inventory, reservations, wishlists, cart, checkout quote and currency/market validation.
3. **Orders:** parent/seller order split, order snapshots, order lifecycle and notifications.
4. **Connect payments:** hosted onboarding, eligibility checks, one customer payment, seller transfer allocation, refunds, ledger, webhook and reconciliation.
5. **Shipping:** seller zones/methods, Shippo rates/labels/tracking, external-carrier mode, multi-package shipments.
6. **Tax and compliance:** supported-market tax-provider setup, registration capture, liability approval, tax invoices/credit notes.
7. **Growth and trust:** discounts, campaigns, featured placements, reviews, returns, disputes and admin tooling.
8. **Scale and international expansion:** new markets only after country readiness, payout, tax, customs, product restrictions and operational review.

## 23. Decisions still requiring explicit approval

- Final Stripe Connect account controller/dashboard configuration and platform liability model.
- Whether connected accounts are Express or another supported model; country/capability combinations must be verified before seller country enablement.
- Marketplace legal role (seller-of-record / marketplace facilitator / other roles) by jurisdiction, including consumer-facing invoice issuer and tax liability.
- Transfer release timing and financial risk/negative-balance allocation. The proposal is transfer after the platform charge succeeds and funds are eligible, not escrow until delivery.
- Initial launch countries and payment/payout corridors. “Global-ready” does not mean Stripe supports sellers in every country.
- Whether launch includes physical goods only (recommended for first release) or digital goods too.
- Shipping cost payer and label-purchase owner (seller, platform or customer) plus return-label policy.
- Discount funding, commission base (item value vs item+shipping), seller subscription tiers and paid promotion pricing.
- Supported currency catalogue and whether any FX conversion is allowed at checkout.
- Tax provider markets, tax registrations, liability configuration and invoice-issuer/legal entity.
- Product prohibited/restricted goods and seller verification standards.

## 24. External integration references checked 4 November 2026

- Stripe Connect separate charges and transfers: https://docs.stripe.com/connect/separate-charges-and-transfers
- Stripe-hosted onboarding: https://docs.stripe.com/connect/hosted-onboarding
- Stripe Connect cross-border payouts and current regional availability: https://docs.stripe.com/connect/connect-cross-border-payouts
- Stripe Tax with Connect and marketplace liability distinction: https://docs.stripe.com/tax/connect
- Stripe supported presentment currencies: https://docs.stripe.com/currencies
- Shippo authentication/test/live mode: https://docs.goshippo.com/docs/guides_general/authentication/
- Shippo single-call label creation: https://docs.goshippo.com/docs/guides_general/single_call/

These references describe provider capabilities, not legal advice or a promise that a specific seller/country/payment/carrier combination is available. Recheck provider terms, capabilities, pricing and supported countries during implementation and before each market launch.

---

## 25. Shared `location_places` catalogue (platform reference data — outside the 74-table marketplace scope)

`location_places` is a **shared Diasporum reference-data table**, not a Shop Marketplace table. It is therefore documented here separately and is **not** counted in the 74-table marketplace inventory in Section 16. Its first consumer is Dating/Matchmaking onboarding, but any module may use it for searchable place selection.

### 25.1 Purpose and boundaries

- One searchable catalogue row per city, town, village, district or region within one `countries.id`. `countries` remains the authoritative country reference; no `country_code`/`country_name` is duplicated on the place row.
- `location geography(Point,4326)` stores the **approximate place-centre point** — never a person's device GPS fix.
- `alternative_names text[]` holds alternative spellings, former names and transliterations (e.g. Addis Ababa / Finfinne). Exact-name lookup uses `alternative_names @> ARRAY[term]`.
- `location_precision` is a controlled value: `CITY`, `TOWN`, `VILLAGE`, `DISTRICT`, `NEIGHBOURHOOD`, `REGION` or `OTHER`. Settlement-level rows require `city`; only `REGION` rows may omit it.
- `source_provider` + `source_place_id` keep optional import provenance and make repeated imports idempotent (a partial unique index rejects the same external record twice). Admin-curated rows may leave both NULL.
- `is_active=false` removes a place from selection APIs but keeps the record: `user_discovery_locations.location_place_id` is `ON DELETE RESTRICT`, so a referenced place must be deactivated, never deleted, preserving historical references.
- Duplicate prevention: one row per `(country_id, lower(region), lower(city), location_precision)` — e.g. a `CITY` and a `DISTRICT` named Leeds may coexist; two `CITY` rows may not.

Search/index support: a GiST index on `location`, a country-scoped partial index on active places, `text_pattern_ops` functional indexes for case-insensitive prefix search on `city`, `region` and `display_name`, and a GIN index on `alternative_names`. `pg_trgm` was deliberately not added: the prefix/containment operators above cover the documented search contract; trigram fuzzy search can be added later as a reviewed migration if product needs it.

### 25.2 Relationship to `user_discovery_locations` and `addresses`

Two existing location concepts are preserved and must not be merged:

| Concept                               | Table / column                                            | Privacy posture                                                                                                                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private address                       | `matchmaking_profiles.address_id → addresses`             | Optional. Must be `visibility='PRIVATE'` and owned by the user (existing `validate_matchmaking_profile` trigger). Never projected to other users. Selecting a discovery location does **not** require or create a street address. |
| Consented approximate discovery point | `user_discovery_locations.location` + `location_place_id` | Opt-in, approximate only. Used by `matchmaking_users_compatible` distance checks. Deleted when all location-based discovery is disabled (existing privacy-toggle trigger). Raw point is never serialized.                         |

`user_discovery_locations` gains one nullable column: `location_place_id uuid REFERENCES location_places(id) ON DELETE RESTRICT`. All existing columns, the `location_source` allow-list (`DEVICE_APPROXIMATE`, `USER_SELECTED`, `CITY_CENTRE`), `precision_radius_m` and `consented_at` are unchanged. No new source type is introduced.

A `BEFORE INSERT OR UPDATE` trigger (`trg_user_discovery_locations_place`) enforces catalogue consistency:

- The referenced place must exist and must be `is_active` **at selection time** (insert or change of `location_place_id`). Later deactivation does not break existing rows.
- A catalogue reference requires `location_source='CITY_CENTRE'`. `DEVICE_APPROXIMATE` is for phone-based points; `USER_SELECTED` remains for any explicitly supported manual-point flow that is not a catalogue place.
- `location` is always **derived from `location_places.location`** — coordinates submitted by a client for a catalogue selection are ignored, so the stored point and its place reference cannot disagree.
- An `AFTER UPDATE OF location` trigger on `location_places` propagates curated centre-point corrections to referencing discovery rows.

### 25.3 Matchmaking onboarding — two location options

Location selection in Dating/Matchmaking onboarding offers two options; neither requires a private street address and `matchmaking_profiles.address_id` stays optional and untouched.

**Choose location manually (catalogue search)**

1. Backend resolves the authenticated user's `profiles.current_country_id` and uses it as the default country filter. The mobile UI preselects that country in the country selector.
2. Search is always country-scoped and active-only: `WHERE country_id=:selected AND is_active`, matching prefix on `city`, `region`, `display_name` or exact containment on `alternative_names`. Results show `display_name` (city, region, country) to disambiguate same-named places, paginated/limited.
3. The user may switch the country selector to any active country and search there — e.g. a user whose current country is Ethiopia can switch to the United Kingdom and pick Leeds. Switching the search country does **not** modify `profiles.current_country_id`; the stored place's country comes from the selected `location_places` row, never from a client-supplied country value.
4. If `profiles.current_country_id` is NULL or the profile row does not exist yet, the API returns no unfiltered global list: the client shows the country selector first and the user must pick a country before places load.
5. On confirm, the backend saves `user_discovery_locations` with `location_source='CITY_CENTRE'` and the chosen `location_place_id`; the database derives the stored point.

**Use my current location (device)**

1. The app explains why location permission is needed and requests it only after the user chooses this option. Location permission and discovery consent are separate decisions.
2. The backend receives the approximate device fix, determines the actual device country (which may differ from `profiles.current_country_id` and must not be forced into it), and reverse-geocodes/matches against `location_places` for the nearest suitable active place.
3. The detected city and country are shown for confirmation before anything is saved.
4. If an active catalogue place matches, save `location_source='CITY_CENTRE'` + `location_place_id` — the stored point becomes the catalogue centre, so no raw GPS fix is persisted. If no place matches or reverse-geocoding fails, save `location_source='DEVICE_APPROXIMATE'` with `location_place_id=NULL` and a backend-fuzzed point constrained by `precision_radius_m`.
5. Denied permission, unavailable GPS, timeout or geocoding failure all fall back to manual selection. Users can always complete Matchmaking setup via manual selection without granting phone location permission.

Both paths record consent in the existing `consented_at` column and respect `precision_radius_m`. Changing the location updates the same single row per user (PK `user_id`); disabling all location-based discovery deletes the row via the existing privacy-toggle trigger — no stale approximate point is retained.

### 25.4 Proposed API surface (`/api/v1`, authenticated principal only)

The backend always derives the user from the security principal; client-supplied `user_id`/`owner_user_id` is never trusted.

| Endpoint                                                                                                                             | Behaviour                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/location-places?country_id=&q=&limit=&cursor=`                                                                          | Country-scoped active-place search. `country_id` optional only when resolvable from the caller's `profiles.current_country_id`; an explicit `country_id` overrides the default. `q` matches city/region/display-name prefix or alternative-name containment. Returns `id`, `display_name`, `region`, `country`, `location_precision` — never an unfiltered global list and no `location` coordinates. |
| `GET /api/v1/location-places/default-country` (or embedded in the search response)                                                   | Resolves the default search country from `profiles.current_country_id`; returns none when NULL so the client shows the country selector first.                                                                                                                                                                                                                                                        |
| `PUT /api/v1/me/discovery-location` `{ "location_place_id": "<uuid>" }`                                                              | Manual catalogue confirm. Server validates the place is active, stores `CITY_CENTRE` + derived point, sets `consented_at`.                                                                                                                                                                                                                                                                            |
| `PUT /api/v1/me/discovery-location` `{ "device": { "latitude":…, "longitude":…, "accuracy_m":… }, "confirmed_place_id": "<uuid>"? }` | Device path after user confirmation. With `confirmed_place_id`: catalogue match → `CITY_CENTRE` derived point. Without it → `DEVICE_APPROXIMATE` fuzzed point within `precision_radius_m`.                                                                                                                                                                                                            |
| `DELETE /api/v1/me/discovery-location`                                                                                               | Immediate removal of the consented point (in addition to the existing privacy-toggle deletion).                                                                                                                                                                                                                                                                                                       |

Matchmaking discovery responses never expose `location`, `location_place_id` coordinates or `addresses` rows; distance eligibility remains computed server-side by `matchmaking_users_compatible` over `user_discovery_locations`.

### 25.5 Catalogue data and seeding

- The existing `seed_reference_data.sql` countries seed is unchanged. **No fabricated worldwide city dataset is shipped.** Example records (Arba Minch / Hosaena / Semera, Ethiopia; Leeds, United Kingdom) describe the supported shape only.
- Populate per approved sources (e.g. an openly licensed global gazetteer or a licensed geodata provider) via an **idempotent importer** keyed on `(source_provider, source_place_id)` plus the `(country, region, city, precision)` uniqueness rule. Re-running an import updates `display_name`/`alternative_names`/coordinates rather than duplicating rows.
- Importers must validate `country_id` against `countries`, coordinate ranges (PostGIS rejects invalid geography), and normalize `display_name` as "City, Region, Country".
- Admin curation can add/deactivate places (`is_active`) at any time; deactivation never deletes a referenced record.
- Clearly labelled test fixtures may be used in automated tests and smoke tests only.

---

## 26. Default and Extended Community access (implemented platform addition — outside the 74-table marketplace scope)

This section documents the additive Flyway migration `V24__default_extended_community_access.sql`. It extends existing shared platform tables and does not add a community, membership, Billing, identity or feature-management table. The v10.13 clean-install SQL remains a separate baseline artifact and is not an in-place upgrade script.

### 26.1 Existing community and capability objects reused

| Object                  | Role in the implemented model                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `communities`           | Unique origin/destination identity and active state. Default classification uses destination = `profiles.current_country_id`; Extended classification uses a different destination. |
| `community_memberships` | Explicit participation and lifecycle. Only `ACTIVE` membership authorizes a context. Extended membership is never inferred solely from origin matching.                             |
| `user_settings`         | Persists `default_community_id` and `active_community_id`; existing membership-integrity triggers remain authoritative.                                                             |
| `feature_flags`         | Scoped `COMMUNITY_MODULE_{MODULE}` rollout flags at global, country or community scope. Flags can restrict the base policy but cannot expand the Extended allow-list.               |
| `feature_access_rules`  | Scoped `FREE` rules with `config.unconfiguredFree` control the explicit launch fallback for unconfigured Extended Billing actions.                                                  |

No per-module access tables are introduced. `CommunityAccessPolicyService` derives Default/`ORIGIN_EXTENDED` context and effective modules at runtime.

### 26.2 Matchmaking source-community metadata

Two existing tables each gain one nullable column:

```sql
matchmaking_swipes.community_id
    uuid NULL REFERENCES communities(id) ON DELETE SET NULL
matchmaking_swipe_history.community_id
    uuid NULL REFERENCES communities(id) ON DELETE SET NULL
```

The value records where a swipe originated for Billing, audit and analytics. It does not partition the one-profile-per-account or one-canonical-match-per-user-pair model. Existing matches and conversations remain available after community switches.

Partial indexes support community-scoped inspection without indexing rows that have no source community:

- `ix_matchmaking_swipes_community(community_id, swiper_user_id, created_at DESC)`.
- `ix_matchmaking_swipe_history_community(community_id, swiper_user_id, created_at DESC)`.

### 26.3 Billing usage reversal and grant restoration

`billing_usage_records` gains:

| Column                                                                            | Purpose                                                                                  |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `reversed_at timestamptz NULL`                                                    | Marks usage excluded from active quota accounting while preserving the financial record. |
| `reversal_reason text NULL`                                                       | Administrative or moderation reversal explanation.                                       |
| `reversed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL`                   | Actor responsible for reversal.                                                          |
| `grant_id uuid NULL REFERENCES billing_entitlement_grants(id) ON DELETE SET NULL` | Links finite-grant consumption so reversal can restore the correct grant.                |

`ix_billing_usage_community_quota` indexes unreversed community-targeted usage by user, feature, target and time. `ix_billing_usage_reversal` indexes reversed rows. Per-community quotas reuse `quota_scope='PER_TARGET'`, `target_type='COMMUNITY'` and `target_id=<community UUID>`; no new quota scope was needed.

### 26.4 Extended feature catalogue and launch policy

The migration registers four existing-Billing features with `feature_kind='QUOTA'` and `quota_scope='PER_TARGET'`:

- `EXTENDED_FEED_POST_PUBLISH`.
- `EXTENDED_REEL_PUBLISH`.
- `EXTENDED_MATCHMAKING_LIKE`.
- `EXTENDED_COMMUNITY_HELP_REQUEST_PUBLISH`.

Plan entitlements supply enablement, quantity limit and reset period. Existing entitlement grants supply additional credits and take precedence over plan allowance. One unit is consumed per successful action. The migration inserts global `FREE` access rules with `{"unconfiguredFree":true}` using `ON CONFLICT DO NOTHING`; this is an explicit launch default, not an inferred price. Scoped administration may disable the fallback.

### 26.5 Durable publication replay reuses `idempotency_keys`

No publication replay table was added. Feed and Help publication use the baseline `idempotency_keys` uniqueness contract `(user_id, operation_key)` with:

- `operation_key = 'feed-post-create:{clientKey}'` or `'feed-help-create:{clientKey}'`.
- SHA-256 `request_hash` over the payload excluding `idempotencyKey`.
- HTTP status 200 and the original JSON `response_body`.
- Seven-day `expires_at` retention.

An advisory transaction lock serializes equivalent in-flight requests. Publication, Billing usage and replay insertion share a transaction, so a failed action cannot leave a successful replay record. Equivalent retries return the stored response; changed payload reuse conflicts. Mobile keys are optional in the API for backward compatibility.

### 26.6 Upgrade and recovery requirements

Apply `V24` only through Flyway after inspecting the deployed history and rehearsing against a restored copy. Do not edit an applied migration or execute the v10.13 clean-install package over a populated database. The additive columns are nullable and the new rows use conflict guards. Rollback/recovery should use database backup/restore and forward-fix migration practice; no destructive down migration is supplied.
