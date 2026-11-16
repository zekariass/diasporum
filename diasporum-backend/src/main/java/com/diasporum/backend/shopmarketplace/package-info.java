/**
 * Global Shop Marketplace (v10.13): sellers, shops, global product catalogue, market/currency
 * prices, inventory and reservations, multi-seller cart/checkout, parent and seller orders,
 * shipping (Shippo and seller-managed), Stripe Connect payments/transfers/payouts, returns,
 * refunds, reviews, discount codes and an append-only marketplace ledger.
 * <p>Physical goods only. Separate from the lead-generation Service Marketplace and from
 * subscription Billing. Uses the public APIs of Identity, Business Accounts, Media and
 * Notifications; Messaging depends on {@link com.diasporum.backend.shopmarketplace.ShopMarketplaceApi}.
 * <p><b>Boundary:</b> other modules may depend only on this module's root
 * public API/events. Access to {@code internal.*} packages is forbidden;
 * architecture tests enforce it.
 */
package com.diasporum.backend.shopmarketplace;
