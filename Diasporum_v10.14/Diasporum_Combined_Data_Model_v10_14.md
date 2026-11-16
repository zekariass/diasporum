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

## Service Marketplace v10.14 integration

## 1. Product decision and boundary

The selected model is **lead generation + structured quotations + quote acceptance + service-completion tracking**.

Diasporum helps a customer publish a service request, discover providers, receive and compare quotes, select one provider, and record progress through completion. The actual service is delivered and paid for outside Diasporum.

**Explicitly out of scope:** appointment calendars, time-slot booking, platform checkout, deposits, escrow, provider payouts, service-payment refunds, and platform adjudication of workmanship/payment disputes. Do not reuse Shop Marketplace order/payment tables for services.

## 2. Entity map

```text
service_categories ──< service_category_translations
       ├──< service_category_media
       │
       ├──< service_provider_services >── service_providers ──< service_provider_media
       │                                      │
       └──< service_requests ──< service_request_media
                    │
                    ├──< service_request_responses (interest/contact compatibility)
                    ├──< service_quotes ──< service_quote_items
                    │        │
                    │        └── accepted quote
                    │                 │
                    │          service_engagements
                    │                 ├──< service_engagement_status_history
                    │                 └──< service_engagement_media
                    │
                    ├──< service_lead_access
                    ├──< service_reviews
                    ├──< service_reports
                    └── service_moderation_actions (polymorphic target)
```

## 3. Existing v10.13 tables retained

| Table                                 | Responsibility                                                                                                                                                                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service_categories`                  | Hierarchical service taxonomy and stable category keys.                                                                                                                                                                                                                 |
| `service_category_media` (new v10.14) | Category icons, thumbnails and cover images using shared `media_objects`.                                                                                                                                                                                               |
| `service_category_translations`       | Localised category labels/descriptions.                                                                                                                                                                                                                                 |
| `service_providers`                   | One provider identity owned by exactly one personal user or Business Account; one base geography point and editable service radius. v10.14 adds a dedicated onboarding lifecycle.                                                                                       |
| `service_provider_media` (new v10.14) | Provider profile image, cover image and portfolio media references using shared `media_objects`.                                                                                                                                                                        |
| `service_provider_services`           | Many-to-many mapping of providers to child service categories; these subscriptions are the only jobs a provider can discover.                                                                                                                                           |
| `service_requests`                    | Customer request, child service, country, approximate location, budget/currency, preferred date, expiry and publication lifecycle. `reposted_from_request_id` links a fresh open job round to its closed source while preserving old quotes, charges and conversations. |
| `service_request_media`               | Reuses shared `media_objects` for request photos/documents.                                                                                                                                                                                                             |
| `service_request_responses`           | Lightweight INTEREST/CONTACT response and notification compatibility. It is no longer the authoritative quote record.                                                                                                                                                   |
| `service_lead_access`                 | One provider/request access grant controlling chat and/or contact-detail visibility, with an immutable lead price/currency snapshot and an optional billing usage record for free leads.                                                                                |
| `service_reviews`                     | Customer feedback; eligibility is tightened to completed engagements.                                                                                                                                                                                                   |
| `service_reports`                     | Reports against service requests, providers and reviews.                                                                                                                                                                                                                |
| `service_moderation_actions`          | Moderation decisions/audit trail, separate from reports.                                                                                                                                                                                                                |

## 4. Provider onboarding (v10.14 enhancement)

Provider onboarding is managed on `service_providers`; no separate onboarding table is needed for the initial release. The provider record is created as a draft and progressively completed.

`onboarding_status` values: `DRAFT`, `IN_PROGRESS`, `SUBMITTED`, `APPROVED`, `REJECTED`. The migration preserves existing provider records as `APPROVED` and changes the column default to `DRAFT` for newly created providers. This avoids unexpectedly hiding existing providers while ensuring new providers cannot be treated as onboarded by default.

The provider record also stores `onboarding_submitted_at`, `onboarding_reviewed_at`, `onboarding_reviewed_by_user_id` and `onboarding_rejection_reason`. `status` remains the operational state (`ACTIVE`, `PAUSED`, `SUSPENDED`, `CLOSED`); `verification_status` remains a separate identity/business/professional verification outcome. These concepts must not be conflated.

Recommended onboarding steps: choose individual or Business Account ownership; enter provider display name and description; select service categories; set base location and service radius; upload profile/cover/portfolio media; complete any policy-required verification; submit for review. The moderation/admin workflow approves or rejects the submission. Rejected providers can correct and resubmit. Provider registration remains free.

Discovery and quote submission must require `onboarding_status='APPROVED'` and `status='ACTIVE'`; the API must enforce this even if a client bypasses the UI. Business Account actions additionally require an active authorised member. The migration does not introduce a document/KYC workflow; if licences or identity documents become mandatory, design a separate restricted verification-document capability with retention and access controls.

### `service_provider_media`

Stores references to shared media for `PROFILE_IMAGE`, `COVER_IMAGE` and multiple `PORTFOLIO_IMAGE` assets. One profile image and one cover image are allowed per provider; portfolio images may be multiple and ordered. The binary objects remain in shared `media_objects`/storage.

### `service_category_media`

Stores references to shared media for category `ICON`, `THUMBNAIL` and `COVER` assets. One icon and one cover are allowed per category; multiple thumbnails are supported and ordered. Category text and localisation remain in `service_category_translations`; media is not duplicated per language unless a later product requirement explicitly calls for locale-specific artwork.

## 5. New v10.14 quote and engagement tables

### `service_quotes`

One row represents one immutable quote revision from one provider for one request. Stores title, scope of work, total amount, ISO currency, optional estimated duration, validity deadline, inclusions, exclusions, terms, author, revision number, predecessor and status. A revised quote is a new row; never overwrite sent quote terms. At most one quote can be accepted for a request. The provider/request/revision tuple is unique.

Statuses: `SENT`, `ACCEPTED`, `DECLINED`, `WITHDRAWN`, `EXPIRED`, `SUPERSEDED`.

### `service_quote_items`

Optional itemised breakdown of a quote (description, quantity, unit, unit amount and line amount). The quote header `amount` is the authoritative total agreed by the parties. The application must validate that line totals reconcile to the header when line items are supplied; do not rely on floating-point arithmetic.

### `service_engagements`

Created atomically when the customer accepts a quote. Exactly one engagement per service request and one engagement per accepted quote. Snapshots the customer/provider/request association and records the coordination lifecycle. It is not an order, booking or payment.

Statuses: `ACCEPTED` → `IN_PROGRESS` → `COMPLETION_SUBMITTED` → `COMPLETED`; side paths include `CANCELLED` and `ISSUE_RAISED`. An issue state records that the parties need to resolve something; it does not imply platform adjudication.

### `service_engagement_status_history`

Append-only record of each engagement status transition, timestamp and actor. The API must supply the actor; direct client writes are prohibited.

### `service_engagement_media`

Optional completion or issue evidence, referencing shared `media_objects`. The API must enforce participant/moderator access and media purpose/retention rules.

## 6. Core workflows

### Customer posts a request

1. Customer creates a `DRAFT` request.
2. Publishing validates the configured `SERVICE_JOB_POST` entitlement/usage through shared billing.
3. Request becomes `OPEN`; only approximate/service-area geography is exposed in discovery.
4. Only approved active providers subscribed to the request's child service can discover or read it; customers cannot browse posted jobs. Country, radius, budget and preferred-date filters further refine provider discovery.
5. `diasporum.service-marketplace.max-providers-per-request` caps distinct providers across responses, quotes and lead unlocks. A customer may repost an unsuitable job, closing the source and creating a fresh `OPEN` round with new capacity and one `SERVICE_JOB_POST` charge.

### Provider responds and quotes

1. Provider may send an INTEREST or CONTACT response in `service_request_responses`.
2. Provider creates a structured `service_quotes` row with optional `service_quote_items`.
3. The quote author must own the personal provider profile or be an active Business Account member.
4. Quote submission is allowed only while the request is OPEN and provider is ACTIVE.
5. Revision creates a new row with incremented `revision_no` and `supersedes_quote_id`; the previous current quote becomes `SUPERSEDED`.
6. Customer compares quote scope, price, currency, validity and duration. A quote does not reserve a time slot.

### Lead access

`SERVICE_LEAD_ACCESS` remains the entitlement for unlocking contact details and/or enabling in-app chat when the configured lead price is positive. One unique provider/request grant is charged once. Upgrading chat/contact permissions must not create a second usage unit. A zero configured price creates a free grant with `lead_price=0` and no billing usage record; a positive price snapshots its amount/currency and requires exactly one usage record. Access grant and any billing usage record must be committed atomically using an idempotency key. The v10.14 migration conditionally adds the FK from `service_lead_access.billing_usage_record_id` to `billing_usage_records(id)` where it is missing.

### Quote acceptance and service progress

1. Customer accepts one current, unexpired `SENT` quote.
2. In one database transaction, lock the request, mark the quote `ACCEPTED`, create the unique engagement and close the request. The partial unique index prevents two accepted quotes for one request; the unique engagement constraint is a second guard.
3. Provider records `IN_PROGRESS` when work starts.
4. Provider submits completion with optional note/evidence.
5. Customer confirms completion, producing `COMPLETED`; alternatively the customer raises an issue. The application must authorise each transition by participant role.
6. The platform records progress but does not collect or hold payment.

### Reviews

A customer can create one review for a provider/request only after the matching engagement is `COMPLETED`. Reviews are not available merely because a lead was unlocked or a quote was sent. Existing provider response and moderation controls remain.

## 7. Billing rules

- `SERVICE_JOB_POST`: controls request publication according to configured plan/price.
- `SERVICE_LEAD_ACCESS`: controls provider contact/chat access.
- `SERVICE_QUOTE_SEND`: optional and disabled by default; enable only if a deliberate quote-charging policy is approved.
- Provider registration remains free.
- Quote acceptance, engagement progress, completion and reviews do not create service payments or platform fees.

## 8. Shared infrastructure reused

Reuse `users`, `business_accounts`, `business_account_members`, `countries`, `addresses`, `languages`, `media_objects`, `billing_features`, `billing_plan_entitlements`, `billing_usage_records`, `direct_conversations`, `notifications`, `outbox_events`, `reports`/shared moderation and audit infrastructure. Do not create a second user, address, media, messaging, notification, billing or payment subsystem.

## 9. Integrity and application invariants

- Exactly one provider owner: personal user XOR Business Account.
- New providers default to `onboarding_status='DRAFT'`; only approved and operationally active providers are discoverable or may quote. When applying the separate additive upgrade migration to a populated v10.13 database, preserve existing providers as `APPROVED` for compatibility; the v10.14 clean-install baseline starts all newly created providers as `DRAFT`.
- `onboarding_status`, operational `status` and `verification_status` are independent lifecycle dimensions.
- Provider/category media references use shared `media_objects`; API validation must enforce media ownership, allowed purpose, moderation state and visibility.
- Provider membership/ownership is checked on every write, not trusted from client payloads.
- Provider must be ACTIVE to respond or quote; request must be OPEN to receive quotes.
- Quote revisions are immutable after submission; accepted quote is immutable.
- One accepted quote and one engagement per service request.
- Acceptance is a single transaction with row locking; handle concurrent customer requests safely.
- Currency is mandatory on every quote; no implicit FX conversion. Amounts are decimal monetary values at API boundary and use a documented rounding policy; do not use binary floating point.
- Quote line items, if supplied, must reconcile to the header total.
- Only the customer can accept a quote, confirm completion, raise an issue and review; only an authorised provider member can submit quotes, start work and submit completion.
- Review eligibility requires `COMPLETED` engagement.
- Exact private address/contact data is not returned before authorised lead access.
- Billing usage and lead access grant commit atomically and are idempotent.
- Notifications are emitted through the durable outbox after transaction commit; do not publish directly before persistence.
- Engagement status history is append-only; clients cannot edit history.

## 10. Migration and compatibility notes

The v10.14 integrated SQL files are **clean-install baselines** and include the Service Marketplace additions directly in the schema. They are not upgrade scripts for populated databases. For an existing v10.13 deployment, use a separately versioned additive Flyway migration based on the v10.14 changes; preserve existing provider records as approved during that upgrade. Never edit an already-applied Flyway migration and never run a clean-install SQL file over a populated database.

`service_request_responses` is retained for existing INTEREST/CONTACT semantics and compatibility. New quotes belong in `service_quotes`; do not store new structured quote data in the legacy `quoted_amount` fields. Existing legacy QUOTE response rows, if any, should be handled by a separately reviewed data migration rather than silently discarded.

## 11. Required tests before release

1. Personal provider owner and Business Account member authorisation; reject unrelated users and revoked members.
2. Quote only for OPEN request and ACTIVE provider; reject closed/expired requests and inactive providers.
3. Quote revision sequence, predecessor ownership, immutability and expiration.
4. Concurrent acceptance attempts for two providers: exactly one accepted quote and one engagement.
5. Acceptance transaction rollback: quote must not remain accepted if engagement creation fails; request must not close partially.
6. Valid engagement transition matrix and role authorisation.
7. Provider cannot mark completion directly as customer-confirmed; only customer can confirm.
8. Issue raising and resolution transitions; terminal completed/cancelled states cannot be reopened.
9. Review blocked before completion; one review per request/provider; self-review and provider self-response blocked.
10. Lead-access idempotency, billing FK, upgrade from chat to contact without second charge.
11. Exact address/contact privacy and media access control.
12. Outbox notification creation for quote sent, quote accepted, work started, completion submitted, completion confirmed and issue raised.
13. Flyway migration against a v10.13 database with existing service data; verify no data loss.

## 12. Deliberate future extensions (not required for this release)

Multiple provider branches/locations, provider availability calendars, quote negotiation chat beyond normal messaging, service appointments, deposits, platform payments, refunds, escrow, formal dispute adjudication, tax invoices and commission settlement. Add these only when product scope and jurisdictional/legal requirements are defined.
