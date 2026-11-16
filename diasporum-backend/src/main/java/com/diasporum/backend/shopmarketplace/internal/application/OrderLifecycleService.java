package com.diasporum.backend.shopmarketplace.internal.application;

import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.conflict;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.notFound;

import com.diasporum.backend.shopmarketplace.internal.application.LedgerService.Entry;
import com.diasporum.backend.shopmarketplace.internal.application.PaymentProvider.CheckoutStatus;
import com.diasporum.backend.shopmarketplace.internal.application.PaymentProvider.RefundResult;
import com.diasporum.backend.shopmarketplace.internal.application.PaymentProvider.TransferResult;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Order/payment state machine driven only by verified provider signals. One customer payment
 * fans out to one transfer per seller order; a failed transfer never re-charges the customer.
 * All transitions are idempotent so duplicated webhooks, retries and double submits are safe.
 */
@Service
public class OrderLifecycleService {
    private final JdbcTemplate jdbc;
    private final ShopSupport support;
    private final LedgerService ledger;
    private final SellerAccessPolicy policy;
    private final ShopProperties properties;
    private final PaymentProvider paymentProvider;
    private final InventoryService inventory;

    public OrderLifecycleService(ShopSupport support, LedgerService ledger, SellerAccessPolicy policy,
            ShopProperties properties, List<PaymentProvider> paymentProviders, InventoryService inventory) {
        this.jdbc = support.jdbc();
        this.support = support;
        this.ledger = ledger;
        this.policy = policy;
        this.properties = properties;
        this.paymentProvider = paymentProviders.stream().filter(PaymentProvider::available).findFirst()
                .orElse(paymentProviders.isEmpty() ? null : paymentProviders.getFirst());
        this.inventory = inventory;
    }

    // ------------------------------------------------------------------ tax link

    /** Attaches the session's stored tax calculation to the order and writes per-item lines. */
    void linkTax(UUID orderId, UUID checkoutSessionId) {
        UUID calcId = jdbc.query("SELECT id FROM tax_calculations WHERE checkout_session_id=? ORDER BY calculated_at DESC "
                + "LIMIT 1", rs -> rs.next() ? rs.getObject(1, UUID.class) : null, checkoutSessionId);
        if (calcId == null) {
            return;
        }
        jdbc.update("UPDATE tax_calculations SET order_id=?,status='COMMITTED',committed_at=now() WHERE id=?", orderId,
                calcId);
        jdbc.update("INSERT INTO tax_calculation_lines(tax_calculation_id,order_item_id,seller_order_id,charge_type,"
                + "tax_type,jurisdiction_code,tax_rate,taxable_amount_minor,tax_amount_minor,currency_code) "
                + "SELECT ?,oi.id,oi.seller_order_id,'ITEM','OTHER','PROVIDER',0,"
                + "oi.unit_price_minor*oi.quantity-oi.discount_amount_minor,oi.tax_amount_minor,oi.currency_code "
                + "FROM order_items oi WHERE oi.seller_order_id IN (SELECT id FROM seller_orders WHERE order_id=?)",
                calcId, orderId);
        jdbc.update("INSERT INTO tax_calculation_lines(tax_calculation_id,seller_order_id,charge_type,tax_type,"
                + "jurisdiction_code,tax_rate,taxable_amount_minor,tax_amount_minor,currency_code) "
                + "SELECT ?,so.id,'SHIPPING','OTHER','PROVIDER',0,so.shipping_amount_minor,"
                + "so.tax_amount_minor-COALESCE((SELECT sum(oi.tax_amount_minor) FROM order_items oi "
                + "WHERE oi.seller_order_id=so.id),0),so.currency_code FROM seller_orders so WHERE so.order_id=? "
                + "AND so.tax_amount_minor>COALESCE((SELECT sum(oi.tax_amount_minor) FROM order_items oi "
                + "WHERE oi.seller_order_id=so.id),0)", calcId, orderId);
        jdbc.update("INSERT INTO tax_liability_records(tax_calculation_id,seller_order_id,liable_party,liable_seller_id,"
                + "jurisdiction_code,tax_type,decision_source,reason_snapshot) "
                + "SELECT DISTINCT ?,t.seller_order_id,'SELLER',so.seller_id,t.jurisdiction_code,t.tax_type,'PROVIDER',"
                + "'Provider-calculated marketplace tax' FROM tax_calculation_lines t JOIN seller_orders so "
                + "ON so.id=t.seller_order_id WHERE t.tax_calculation_id=? ON CONFLICT DO NOTHING", calcId, calcId);
    }

    // ------------------------------------------------------------------ paid / failed

    /**
     * Finalizes an order once the provider has verified payment. Idempotent: a second call for
     * the same payment is a no-op. Confirms reservations into stock movements, posts balanced
     * ledger entries and queues one seller transfer per seller order.
     */
    @Transactional
    public void finalizePaid(UUID paymentId, String paymentIntentId, String chargeId) {
        Object[] payment = jdbc.query("SELECT mp.order_id,mp.status,mp.amount_minor,mp.currency_code::text FROM "
                + "marketplace_payments mp WHERE mp.id=? FOR UPDATE", rs -> rs.next() ? new Object[] {
                        rs.getObject(1, UUID.class), rs.getString(2), rs.getLong(3), rs.getString(4).trim()} : null,
                paymentId);
        if (payment == null) {
            throw notFound("PAYMENT_NOT_FOUND");
        }
        if ("SUCCEEDED".equals(payment[1])) {
            return;
        }
        UUID orderId = (UUID) payment[0];
        String currency = (String) payment[3];
        jdbc.update("UPDATE marketplace_payments SET status='SUCCEEDED',paid_at=now(),provider_charge_id=?,"
                + "provider_payment_intent_id=COALESCE(?,provider_payment_intent_id),updated_at=now() WHERE id=?",
                chargeId, paymentIntentId, paymentId);
        jdbc.update("UPDATE marketplace_payment_transactions SET status='SUCCEEDED',provider_transaction_id=?,"
                + "occurred_at=now() WHERE payment_id=? AND transaction_type='AUTHORIZATION'", chargeId, paymentId);
        jdbc.update("INSERT INTO marketplace_payment_transactions(payment_id,transaction_type,provider_key,"
                + "provider_transaction_id,amount_minor,currency_code,status) VALUES(?,'CAPTURE','STRIPE',?,?,?,'SUCCEEDED') "
                + "ON CONFLICT(provider_key,provider_transaction_id) DO NOTHING", paymentId,
                chargeId == null ? paymentIntentId : chargeId + "-capture", payment[2], currency);

        UUID sessionId = jdbc.queryForObject("SELECT checkout_session_id FROM orders WHERE id=?", UUID.class, orderId);
        jdbc.update("UPDATE orders SET status='PLACED',placed_at=now(),updated_at=now() WHERE id=? AND status='PAYMENT_PENDING'",
                orderId);
        jdbc.update("INSERT INTO order_status_history(order_id,from_status,to_status) VALUES(?,'PAYMENT_PENDING','PLACED')",
                orderId);
        jdbc.update("UPDATE checkout_sessions SET status='PLACED',updated_at=now() WHERE id=?", sessionId);
        jdbc.update("UPDATE shopping_carts SET status='CONVERTED',converted_at=now(),updated_at=now() WHERE id=?",
                jdbc.queryForObject("SELECT cart_id FROM checkout_sessions WHERE id=?", UUID.class, sessionId));
        jdbc.update("UPDATE seller_orders SET status='PLACED',updated_at=now() WHERE order_id=? AND status='PAYMENT_PENDING'",
                orderId);
        jdbc.update("INSERT INTO seller_order_status_history(seller_order_id,from_status,to_status) "
                + "SELECT id,'PAYMENT_PENDING','PLACED' FROM seller_orders WHERE order_id=?", orderId);

        confirmReservations(sessionId, orderId);
        redeemDiscounts(orderId, sessionId);
        ledger.post("ORDER_PAYMENT", "order-payment-" + orderId, orderId, null, paymentId, currency,
                "Customer payment received", List.of(Entry.debit("PLATFORM.CASH", (Long) payment[2]),
                        Entry.credit("PLATFORM.CLEARING", (Long) payment[2])));
        for (Object[] so : jdbc.query("SELECT id,seller_id,subtotal_amount_minor+shipping_amount_minor-discount_amount_minor"
                + "+tax_amount_minor AS gross,commission_amount_minor,seller_net_amount_minor,seller_order_number "
                + "FROM seller_orders WHERE order_id=?", (rs, i) -> new Object[] {rs.getObject(1, UUID.class),
                        rs.getObject(2, UUID.class), rs.getLong(3), rs.getLong(4), rs.getLong(5), rs.getString(6)},
                orderId)) {
            UUID sellerOrderId = (UUID) so[0];
            ledger.post("SELLER_ORDER_SPLIT", "seller-split-" + sellerOrderId, orderId, sellerOrderId, paymentId, currency,
                    "Seller order " + so[5],
                    List.of(Entry.debit("PLATFORM.CLEARING", (Long) so[2]),
                            Entry.seller("CREDIT", (UUID) so[1], (Long) so[4]),
                            Entry.credit("PLATFORM.COMMISSION_REVENUE", (Long) so[3])));
            UUID accountId = jdbc.query("SELECT id FROM seller_payment_accounts WHERE seller_id=? AND provider_key='STRIPE' "
                    + "AND charges_enabled", rs -> rs.next() ? rs.getObject(1, UUID.class) : null, so[1]);
            if (accountId != null) {
                jdbc.update("INSERT INTO seller_transfers(seller_order_id,payment_id,seller_payment_account_id,transfer_group,"
                        + "source_charge_id,currency_code,gross_amount_minor,commission_amount_minor,transfer_amount_minor,"
                        + "status) VALUES(?,?,?,?,?,?,?,?,?,'PENDING') ON CONFLICT(seller_order_id,payment_id) DO NOTHING",
                        sellerOrderId, paymentId, accountId, "order-" + orderId, chargeId, currency, so[2], so[3], so[4]);
            } else {
                for (UUID recipient : policy.sellerRecipients((UUID) so[1])) {
                    support.notify(recipient, "MARKETPLACE_ACCOUNT_ACTION_REQUIRED", "Payment account disconnected",
                            "A paid seller order cannot be transferred; reconnect the payout account.", "SHOP", null,
                            "transfer-blocked:" + sellerOrderId + ":" + recipient);
                }
            }
        }
        Object[] order = jdbc.query("SELECT customer_user_id,order_number FROM orders WHERE id=?",
                rs -> rs.next() ? new Object[] {rs.getObject(1, UUID.class), rs.getString(2)} : null, orderId);
        support.notify((UUID) order[0], "MARKETPLACE_ORDER_UPDATE", "Order confirmed",
                "Your order " + order[1] + " is confirmed.", "SHOP_ORDER", orderId, "order-confirmed:" + orderId);
        for (UUID sellerOrderId : jdbc.queryForList("SELECT id FROM seller_orders WHERE order_id=?", UUID.class, orderId)) {
            UUID sellerId = jdbc.queryForObject("SELECT seller_id FROM seller_orders WHERE id=?", UUID.class, sellerOrderId);
            for (UUID recipient : policy.sellerRecipients(sellerId)) {
                support.notify(recipient, "MARKETPLACE_ORDER_UPDATE", "New order",
                        "You have a new order to fulfil.", "SHOP_ORDER", sellerOrderId,
                        "new-order:" + sellerOrderId + ":" + recipient);
            }
        }
    }

    /**
     * Converts ACTIVE reservations into stock decrements (SALE movements). If stock was re-sold
     * between reservation expiry and payment confirmation, that seller order is refunded in
     * full instead of overselling — the rest of the order still finalizes.
     */
    private void confirmReservations(UUID sessionId, UUID orderId) {
        for (Object[] r : jdbc.query("SELECT r.id,r.inventory_item_id,r.quantity,ci.variant_id,ci.id FROM "
                + "inventory_reservations r JOIN checkout_items ci ON ci.id=r.checkout_item_id "
                + "WHERE r.checkout_session_id=? AND r.status='ACTIVE' FOR UPDATE OF r",
                (rs, i) -> new Object[] {rs.getObject(1, UUID.class), rs.getObject(2, UUID.class), rs.getInt(3),
                        rs.getObject(4, UUID.class), rs.getObject(5, UUID.class)}, sessionId)) {
            jdbc.update("UPDATE inventory_reservations SET status='CONFIRMED',confirmed_at=now() WHERE id=?", r[0]);
            int updated = jdbc.update("UPDATE inventory_items SET quantity_on_hand=quantity_on_hand-?,updated_at=now() "
                    + "WHERE id=? AND quantity_on_hand>=?", r[2], r[1], r[2]);
            if (updated == 0) {
                UUID sellerOrderId = jdbc.query("SELECT seller_order_id FROM order_items WHERE checkout_item_id=?",
                        rs -> rs.next() ? rs.getObject(1, UUID.class) : null, r[4]);
                if (sellerOrderId != null) {
                    jdbc.update("UPDATE inventory_reservations SET status='RELEASED',released_at=now() "
                            + "WHERE status IN ('ACTIVE','CONFIRMED') AND checkout_item_id IN "
                            + "(SELECT checkout_item_id FROM order_items WHERE seller_order_id=?)", sellerOrderId);
                    long gross = jdbc.queryForObject("SELECT subtotal_amount_minor+shipping_amount_minor"
                            + "-discount_amount_minor+tax_amount_minor FROM seller_orders WHERE id=?", Long.class,
                            sellerOrderId);
                    refundSellerOrder(sellerOrderId, gross, "ALLOCATION_FAILED", null);
                }
                continue;
            }
            jdbc.update("INSERT INTO inventory_movements(inventory_item_id,movement_type,quantity_delta,reason,source_type,"
                    + "source_id) VALUES(?,'SALE',?,'Order fulfilment','ORDER',?)", r[1], -(Integer) r[2], orderId);
            UUID productId = jdbc.queryForObject("SELECT product_id FROM product_variants WHERE id=?", UUID.class, r[3]);
            if (productId != null) {
                inventory.refreshProductStock(productId);
            }
        }
    }

    private void redeemDiscounts(UUID orderId, UUID sessionId) {
        UUID userId = jdbc.queryForObject("SELECT customer_user_id FROM orders WHERE id=?", UUID.class, orderId);
        for (Object[] row : jdbc.query("SELECT DISTINCT ci.attributes_snapshot->>'code' AS code,ci.shop_id,"
                + "sum(ci.discount_amount_minor) FROM checkout_items ci WHERE ci.checkout_session_id=? "
                + "AND ci.attributes_snapshot->>'code'<>'' GROUP BY 1,2", (rs, i) -> new Object[] {rs.getString(1),
                        rs.getObject(2, UUID.class), rs.getLong(3)}, sessionId)) {
            UUID codeId = jdbc.query("SELECT id FROM discount_codes WHERE shop_id=? AND code=?",
                    rs -> rs.next() ? rs.getObject(1, UUID.class) : null, row[1], row[0]);
            if (codeId != null) {
                jdbc.update("INSERT INTO discount_redemptions(discount_code_id,user_id,order_id,amount_minor,currency_code,"
                        + "funding_party) SELECT ?,?,?,?,currency_code,'SELLER' FROM orders WHERE id=? "
                        + "ON CONFLICT(discount_code_id,order_id) DO NOTHING", codeId, userId, orderId, row[2], orderId);
            }
        }
    }

    /** Verified failure/expiry: releases reservations and marks the order PAYMENT_FAILED. */
    @Transactional
    public void finalizeFailed(UUID paymentId, String failureCode, String failureMessage) {
        Object[] payment = jdbc.query("SELECT order_id,status FROM marketplace_payments WHERE id=? FOR UPDATE",
                rs -> rs.next() ? new Object[] {rs.getObject(1, UUID.class), rs.getString(2)} : null, paymentId);
        if (payment == null || "SUCCEEDED".equals(payment[1])) {
            return;
        }
        UUID orderId = (UUID) payment[0];
        jdbc.update("UPDATE marketplace_payments SET status='FAILED',failure_code=?,failure_message=?,updated_at=now() "
                + "WHERE id=?", failureCode, failureMessage, paymentId);
        jdbc.update("UPDATE marketplace_payment_transactions SET status='FAILED' WHERE payment_id=? "
                + "AND transaction_type='AUTHORIZATION' AND status='PENDING'", paymentId);
        UUID sessionId = jdbc.queryForObject("SELECT checkout_session_id FROM orders WHERE id=?", UUID.class, orderId);
        releaseReservations(sessionId);
        jdbc.update("UPDATE orders SET status='PAYMENT_FAILED',updated_at=now() WHERE id=? AND status='PAYMENT_PENDING'",
                orderId);
        jdbc.update("INSERT INTO order_status_history(order_id,from_status,to_status,reason) "
                + "VALUES(?,'PAYMENT_PENDING','PAYMENT_FAILED',?)", orderId, failureCode);
        jdbc.update("UPDATE seller_orders SET status='CANCELLED',updated_at=now() WHERE order_id=? "
                + "AND status='PAYMENT_PENDING'", orderId);
        jdbc.update("INSERT INTO seller_order_status_history(seller_order_id,from_status,to_status,reason) "
                + "SELECT id,'PAYMENT_PENDING','CANCELLED','Payment failed' FROM seller_orders WHERE order_id=?", orderId);
        jdbc.update("UPDATE checkout_sessions SET status='PAYMENT_FAILED',updated_at=now() WHERE id=?", sessionId);
        UUID customer = jdbc.queryForObject("SELECT customer_user_id FROM orders WHERE id=?", UUID.class, orderId);
        support.notify(customer, "MARKETPLACE_ORDER_UPDATE", "Payment failed",
                "Payment for your order did not complete.", "SHOP_ORDER", orderId, "order-payment-failed:" + orderId);
    }

    /** Releases every ACTIVE reservation of a session (payment failure, expiry, cancel). */
    public void releaseReservations(UUID checkoutSessionId) {
        jdbc.update("UPDATE inventory_reservations SET status='RELEASED',released_at=now() WHERE checkout_session_id=? "
                + "AND status='ACTIVE'", checkoutSessionId);
    }

    /** Expires reservations whose TTL passed and marks their session EXPIRED when unpaid. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public int expireStaleSessions() {
        List<UUID> sessions = jdbc.queryForList("SELECT DISTINCT checkout_session_id FROM inventory_reservations "
                + "WHERE status='ACTIVE' AND expires_at<now()", UUID.class);
        int released = jdbc.update("UPDATE inventory_reservations SET status='EXPIRED' WHERE status='ACTIVE' "
                + "AND expires_at<now()");
        for (UUID sessionId : sessions) {
            String status = jdbc.queryForObject("SELECT status FROM checkout_sessions WHERE id=?", String.class, sessionId);
            if ("PAYMENT_PENDING".equals(status)) {
                // Ask the provider before failing the order; a late success still finalizes.
                UUID paymentId = jdbc.query("SELECT mp.id FROM marketplace_payments mp JOIN orders o ON o.id=mp.order_id "
                        + "WHERE o.checkout_session_id=? ORDER BY mp.created_at DESC LIMIT 1",
                        rs -> rs.next() ? rs.getObject(1, UUID.class) : null, sessionId);
                if (paymentId != null && paymentProvider != null) {
                    String providerId = jdbc.queryForObject("SELECT provider_payment_intent_id FROM marketplace_payments "
                            + "WHERE id=?", String.class, paymentId);
                    CheckoutStatus state = paymentProvider.retrieveHostedCheckout(providerId);
                    if ("PAID".equals(state.status())) {
                        finalizePaid(paymentId, state.paymentIntentId(), state.chargeId());
                        continue;
                    }
                    if ("EXPIRED".equals(state.status()) || "FAILED".equals(state.status())) {
                        finalizeFailed(paymentId, state.failureCode(), state.failureMessage());
                        continue;
                    }
                }
            }
            jdbc.update("UPDATE checkout_sessions SET status='EXPIRED',updated_at=now() WHERE id=? AND status IN "
                    + "('OPEN','QUOTED','PAYMENT_PENDING')", sessionId);
        }
        jdbc.update("UPDATE checkout_sessions SET status='EXPIRED',updated_at=now() WHERE status IN ('OPEN','QUOTED') "
                + "AND expires_at<now()");
        return released;
    }

    // ------------------------------------------------------------------ refunds

    /**
     * Refunds a seller order (full or partial) through the provider, then reverses the seller
     * transfer up to what was actually transferred. The customer is never re-charged.
     */
    @Transactional
    public void refundSellerOrder(UUID sellerOrderId, long amountMinor, String reason, UUID requestedBy) {
        Object[] so = jdbc.query("SELECT so.order_id,so.seller_id,so.currency_code::text,"
                + "so.subtotal_amount_minor+so.shipping_amount_minor-so.discount_amount_minor+so.tax_amount_minor AS gross "
                + "FROM seller_orders so WHERE so.id=? FOR UPDATE", rs -> rs.next() ? new Object[] {
                        rs.getObject(1, UUID.class), rs.getObject(2, UUID.class), rs.getString(3).trim(), rs.getLong(4)} : null,
                sellerOrderId);
        if (so == null) {
            throw notFound("SELLER_ORDER_NOT_FOUND");
        }
        long gross = (Long) so[3];
        long alreadyRefunded = jdbc.queryForObject("SELECT COALESCE(sum(amount_minor),0) FROM marketplace_refunds "
                + "WHERE seller_order_id=? AND status IN ('REQUESTED','PENDING','SUCCEEDED')", Long.class, sellerOrderId);
        if (amountMinor <= 0 || alreadyRefunded + amountMinor > gross) {
            throw conflict("REFUND_EXCEEDS_REMAINING");
        }
        UUID paymentId = jdbc.queryForObject("SELECT id FROM marketplace_payments WHERE order_id=? AND status IN "
                + "('SUCCEEDED','PARTIALLY_REFUNDED') ORDER BY created_at DESC LIMIT 1", UUID.class, so[0]);
        if (paymentId == null) {
            throw conflict("ORDER_NOT_PAID");
        }
        String paymentIntent = jdbc.queryForObject("SELECT provider_payment_intent_id FROM marketplace_payments WHERE id=?",
                String.class, paymentId);
        UUID refundId = UUID.randomUUID();
        jdbc.update("INSERT INTO marketplace_refunds(id,payment_id,seller_order_id,currency_code,amount_minor,reason,status,"
                + "transfer_reversal_status,requested_by_user_id) VALUES(?,?,?,?,?,?,'REQUESTED','PENDING',?)",
                refundId, paymentId, sellerOrderId, so[2], amountMinor, reason, requestedBy);
        if (paymentProvider == null) {
            jdbc.update("UPDATE marketplace_refunds SET status='FAILED' WHERE id=?", refundId);
            throw conflict("PAYMENT_PROVIDER_UNAVAILABLE");
        }
        RefundResult result = paymentProvider.refund("refund-" + refundId, paymentIntent, amountMinor, reason);
        if (!"SUCCEEDED".equals(result.status()) && !"PENDING".equals(result.status())) {
            jdbc.update("UPDATE marketplace_refunds SET status='FAILED' WHERE id=?", refundId);
            throw conflict("REFUND_FAILED:" + (result.failureCode() == null ? "PROVIDER" : result.failureCode()));
        }
        jdbc.update("UPDATE marketplace_refunds SET provider_refund_id=?,status=?,processed_at=now() WHERE id=?",
                result.providerRefundId(), "PENDING".equals(result.status()) ? "PENDING" : "SUCCEEDED", refundId);
        jdbc.update("INSERT INTO marketplace_payment_transactions(payment_id,transaction_type,provider_key,"
                + "provider_transaction_id,amount_minor,currency_code,status) VALUES(?,'REFUND','STRIPE',?,?,?,?) "
                + "ON CONFLICT(provider_key,provider_transaction_id) DO NOTHING", paymentId, result.providerRefundId(),
                -amountMinor, so[2], "PENDING".equals(result.status()) ? "PENDING" : "SUCCEEDED");
        // Reverse the seller transfer first; only the un-reversed remainder stays seller-payable.
        Object[] transfer = jdbc.query("SELECT id,transfer_amount_minor,reversed_amount_minor,provider_transfer_id,status "
                + "FROM seller_transfers WHERE seller_order_id=? AND payment_id=?", rs -> rs.next() ? new Object[] {
                        rs.getObject(1, UUID.class), rs.getLong(2), rs.getLong(3), rs.getString(4), rs.getString(5)} : null,
                sellerOrderId, paymentId);
        if (transfer != null && transfer[3] != null && amountMinor <= (Long) transfer[1] - (Long) transfer[2]) {
            TransferResult reversal = paymentProvider.reverseTransfer("reversal-" + refundId, (String) transfer[3],
                    amountMinor);
            if ("SUCCEEDED".equals(reversal.status())) {
                long newReversed = (Long) transfer[2] + amountMinor;
                jdbc.update("UPDATE seller_transfers SET reversed_amount_minor=?,status=?,updated_at=now() WHERE id=?",
                        newReversed, newReversed >= (Long) transfer[1] ? "REVERSED" : "PARTIALLY_REVERSED", transfer[0]);
                jdbc.update("UPDATE marketplace_refunds SET transfer_reversal_status='SUCCEEDED' WHERE id=?", refundId);
            } else {
                jdbc.update("UPDATE marketplace_refunds SET transfer_reversal_status='FAILED' WHERE id=?", refundId);
            }
        } else {
            jdbc.update("UPDATE marketplace_refunds SET transfer_reversal_status='NOT_REQUIRED' WHERE id=?", refundId);
        }
        long totalRefunded = alreadyRefunded + amountMinor;
        String soStatus = totalRefunded >= gross ? "REFUNDED" : "PARTIALLY_REFUNDED";
        jdbc.update("UPDATE seller_orders SET status=?,updated_at=now() WHERE id=?", soStatus, sellerOrderId);
        jdbc.update("INSERT INTO seller_order_status_history(seller_order_id,from_status,to_status,reason,actor_user_id) "
                + "SELECT id,status,?,?,? FROM seller_orders WHERE id=?", soStatus, reason, requestedBy, sellerOrderId);
        long refundedTotal = jdbc.queryForObject("SELECT COALESCE(sum(amount_minor),0) FROM marketplace_refunds "
                + "WHERE payment_id=? AND status IN ('SUCCEEDED','PENDING')", Long.class, paymentId);
        jdbc.update("UPDATE marketplace_payments SET status=? WHERE id=?",
                refundedTotal >= (Long) jdbc.queryForObject("SELECT amount_minor FROM marketplace_payments WHERE id=?",
                        Long.class, paymentId) ? "REFUNDED" : "PARTIALLY_REFUNDED", paymentId);
        ledger.post("REFUND", "refund-" + refundId, (UUID) so[0], sellerOrderId, paymentId, (String) so[2],
                "Refund " + refundId, List.of(Entry.debit("PLATFORM.CLEARING", amountMinor),
                        Entry.credit("PLATFORM.CASH", amountMinor)));
        if (transfer != null && amountMinor <= (Long) transfer[1]) {
            ledger.post("TRANSFER_REVERSAL", "reversal-" + refundId, (UUID) so[0], sellerOrderId, paymentId,
                    (String) so[2], "Transfer reversal " + refundId,
                    List.of(Entry.seller("DEBIT", (UUID) so[1], amountMinor),
                            Entry.credit("PLATFORM.CLEARING", amountMinor)));
        }
        refreshParentStatus((UUID) so[0]);
        UUID customer = jdbc.queryForObject("SELECT customer_user_id FROM orders WHERE id=?", UUID.class, so[0]);
        support.notify(customer, "MARKETPLACE_ORDER_UPDATE", "Refund processed",
                "A refund was processed for your order.", "SHOP_ORDER", (UUID) so[0], "refund:" + refundId);
    }

    /** Aggregates the parent order status from its independent seller orders. */
    public void refreshParentStatus(UUID orderId) {
        List<String> statuses = jdbc.queryForList("SELECT status FROM seller_orders WHERE order_id=?", String.class, orderId);
        if (statuses.isEmpty()) {
            return;
        }
        String current = jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, orderId);
        if ("PAYMENT_PENDING".equals(current) || "PAYMENT_FAILED".equals(current)) {
            return;
        }
        String next;
        boolean allCancelled = statuses.stream().allMatch(s -> "CANCELLED".equals(s));
        boolean anyRefund = statuses.stream().anyMatch(s -> s.contains("REFUND"));
        boolean allRefunded = statuses.stream().allMatch(s -> "REFUNDED".equals(s) || "CANCELLED".equals(s));
        boolean anyReturn = statuses.stream().anyMatch(s -> s.contains("RETURN"));
        boolean allDone = statuses.stream().allMatch(s -> List.of("DELIVERED", "RETURNED", "REFUNDED", "CANCELLED").contains(s));
        boolean anyShipped = statuses.stream().anyMatch(s -> List.of("DISPATCHED", "DELIVERED", "PARTIALLY_DISPATCHED")
                .contains(s));
        if (allCancelled) {
            next = "CANCELLED";
        } else if (allRefunded && anyRefund) {
            next = "REFUNDED";
        } else if (anyRefund) {
            next = "PARTIALLY_REFUNDED";
        } else if (allDone && anyReturn) {
            next = "RETURNED";
        } else if (allDone && anyShipped) {
            next = "FULFILLED";
        } else if (anyShipped || statuses.stream().anyMatch(s -> List.of("ACCEPTED", "PROCESSING").contains(s))) {
            next = anyShipped ? "PARTIALLY_FULFILLED" : "PLACED";
        } else {
            next = "PLACED";
        }
        if (!next.equals(current)) {
            jdbc.update("UPDATE orders SET status=?,updated_at=now() WHERE id=?", next, orderId);
            jdbc.update("INSERT INTO order_status_history(order_id,from_status,to_status) VALUES(?,?,?)", orderId, current,
                    next);
        }
    }

    /** Dispatches queued seller transfers; a provider failure is stored, never re-charged. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public int processPendingTransfers() {
        if (paymentProvider == null || !paymentProvider.available()) {
            return 0;
        }
        int processed = 0;
        for (UUID transferId : jdbc.queryForList("SELECT id FROM seller_transfers WHERE status='PENDING' "
                + "ORDER BY created_at LIMIT 25", UUID.class)) {
            Object[] t = jdbc.query("SELECT st.transfer_amount_minor,st.currency_code::text,pa.connected_account_id,"
                    + "st.transfer_group,st.source_charge_id,st.seller_order_id,st.payment_id FROM seller_transfers st "
                    + "JOIN seller_payment_accounts pa ON pa.id=st.seller_payment_account_id WHERE st.id=? FOR UPDATE",
                    rs -> rs.next() ? new Object[] {rs.getLong(1), rs.getString(2).trim(), rs.getString(3), rs.getString(4),
                            rs.getString(5), rs.getObject(6, UUID.class), rs.getObject(7, UUID.class)} : null, transferId);
            if (t == null) {
                continue;
            }
            try {
                TransferResult result = paymentProvider.transfer("transfer-" + transferId, (Long) t[0], (String) t[1],
                        (String) t[2], (String) t[3], (String) t[4]);
                if ("SUCCEEDED".equals(result.status()) || "PENDING".equals(result.status())) {
                    jdbc.update("UPDATE seller_transfers SET provider_transfer_id=?,status=?,transferred_at=now(),"
                            + "updated_at=now() WHERE id=?", result.providerId(),
                            "PENDING".equals(result.status()) ? "PROCESSING" : "SUCCEEDED", transferId);
                } else {
                    jdbc.update("UPDATE seller_transfers SET status='FAILED',failure_code=?,updated_at=now() WHERE id=?",
                            result.failureCode(), transferId);
                    notifyTransferFailed((UUID) t[5]);
                }
            } catch (RuntimeException e) {
                jdbc.update("UPDATE seller_transfers SET status='FAILED',failure_code='PROVIDER_ERROR',updated_at=now() "
                        + "WHERE id=?", transferId);
                notifyTransferFailed((UUID) t[5]);
            }
            processed++;
        }
        return processed;
    }

    private void notifyTransferFailed(UUID sellerOrderId) {
        UUID sellerId = jdbc.queryForObject("SELECT seller_id FROM seller_orders WHERE id=?", UUID.class, sellerOrderId);
        for (UUID recipient : policy.sellerRecipients(sellerId)) {
            support.notify(recipient, "MARKETPLACE_PAYOUT_UPDATE", "Transfer failed",
                    "A seller transfer failed and will be reviewed.", "SHOP_ORDER", sellerOrderId,
                    "transfer-failed:" + sellerOrderId);
        }
    }
}
