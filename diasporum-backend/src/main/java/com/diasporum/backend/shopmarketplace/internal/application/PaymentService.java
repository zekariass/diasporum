package com.diasporum.backend.shopmarketplace.internal.application;

import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.conflict;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.notFound;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.unavailable;

import com.diasporum.backend.shopmarketplace.internal.application.PaymentProvider.CheckoutStatus;
import com.diasporum.backend.shopmarketplace.internal.application.PaymentProvider.ConnectedAccountStatus;
import com.diasporum.backend.shopmarketplace.internal.application.PaymentProvider.WebhookEvent;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Payment-provider boundary: verifies webhook signatures, deduplicates events via
 * marketplace_webhook_events, then dispatches to the order lifecycle. Provider objects are
 * always re-fetched before being trusted — webhook payloads themselves are never authoritative.
 */
@Service
public class PaymentService {
    private final JdbcTemplate jdbc;
    private final ShopSupport support;
    private final OrderLifecycleService lifecycle;
    private final PaymentProvider provider;
    private final SellerAccessPolicy policy;

    public PaymentService(ShopSupport support, OrderLifecycleService lifecycle, SellerAccessPolicy policy,
            List<PaymentProvider> providers) {
        this.jdbc = support.jdbc();
        this.support = support;
        this.lifecycle = lifecycle;
        this.policy = policy;
        this.provider = providers.stream().filter(PaymentProvider::available).findFirst()
                .orElse(providers.isEmpty() ? null : providers.getFirst());
    }

    // ------------------------------------------------------------------ webhooks

    /**
     * Entry point for the Stripe webhook endpoint. Signature is verified before anything is
     * stored; duplicate deliveries short-circuit on the unique (provider,event) key.
     */
    @Transactional
    public void handleWebhook(String payload, String signatureHeader) {
        if (provider == null || !provider.available()) {
            throw unavailable("PAYMENT_PROVIDER_UNAVAILABLE");
        }
        WebhookEvent event = provider.verifyWebhook(payload, signatureHeader);
        int inserted = jdbc.update("INSERT INTO marketplace_webhook_events(provider_key,external_event_id,event_type,payload,"
                + "signature_verified,processing_status) VALUES(?,?,?,?::jsonb,true,'PROCESSING') "
                + "ON CONFLICT(provider_key,external_event_id) DO NOTHING", provider.key(), event.id(), event.type(),
                ShopSupport.json(event.raw()));
        if (inserted == 0) {
            return; // already received/processed — provider retries are idempotent
        }
        try {
            dispatch(event);
            jdbc.update("UPDATE marketplace_webhook_events SET processing_status='PROCESSED',processed_at=now() "
                    + "WHERE provider_key=? AND external_event_id=?", provider.key(), event.id());
        } catch (RuntimeException e) {
            jdbc.update("UPDATE marketplace_webhook_events SET processing_status='RETRY',attempt_count=attempt_count+1,"
                    + "last_error=? WHERE provider_key=? AND external_event_id=?", String.valueOf(e.getMessage())
                    .substring(0, Math.min(500, String.valueOf(e.getMessage()).length())), provider.key(), event.id());
            throw e; // the endpoint answers 5xx so the provider retries
        }
    }

    private void dispatch(WebhookEvent event) {
        Map<String, Object> object = event.object() == null ? Map.of() : event.object();
        switch (event.type()) {
            case "checkout.session.completed", "checkout.session.async_payment_succeeded" ->
                onCheckoutSettled(String.valueOf(object.get("id")), true);
            case "checkout.session.expired", "checkout.session.async_payment_failed" ->
                onCheckoutSettled(String.valueOf(object.get("id")), false);
            case "account.updated" -> syncConnectedAccount(String.valueOf(object.get("id")));
            case "payout.paid", "payout.failed", "payout.canceled", "payout.created" -> onPayout(object, event.type());
            case "charge.dispute.created" -> onDispute(object);
            case "transfer.reversed" -> onTransferReversed(object);
            default -> {
            }
        }
    }

    private void onCheckoutSettled(String checkoutSessionId, boolean succeeded) {
        UUID paymentId = jdbc.query("SELECT id FROM marketplace_payments WHERE provider_key='STRIPE' "
                + "AND provider_payment_intent_id=? ORDER BY created_at DESC LIMIT 1",
                rs -> rs.next() ? rs.getObject(1, UUID.class) : null, checkoutSessionId);
        if (paymentId == null) {
            return; // not a marketplace payment — belongs to another product surface
        }
        CheckoutStatus status = provider.retrieveHostedCheckout(checkoutSessionId);
        if (succeeded && "PAID".equals(status.status())) {
            lifecycle.finalizePaid(paymentId, status.paymentIntentId(), status.chargeId());
        } else if (!succeeded || "EXPIRED".equals(status.status()) || "FAILED".equals(status.status())) {
            lifecycle.finalizeFailed(paymentId, status.failureCode(), status.failureMessage());
        }
    }

    /** Re-fetches the connected account — the webhook payload is a hint, not the truth. */
    public void syncConnectedAccount(String connectedAccountId) {
        if (connectedAccountId == null || connectedAccountId.isBlank() || provider == null) {
            return;
        }
        UUID accountId = jdbc.query("SELECT id FROM seller_payment_accounts WHERE provider_key='STRIPE' "
                + "AND connected_account_id=?", rs -> rs.next() ? rs.getObject(1, UUID.class) : null, connectedAccountId);
        if (accountId == null) {
            return;
        }
        ConnectedAccountStatus status = provider.retrieveConnectedAccount(connectedAccountId);
        String onboarding = status.disabled() ? "REJECTED"
                : status.chargesEnabled() && status.payoutsEnabled() ? "COMPLETE"
                : status.detailsSubmitted() || !status.requirementsDue().isEmpty() ? "PENDING" : "NOT_STARTED";
        jdbc.update("UPDATE seller_payment_accounts SET onboarding_status=?,charges_enabled=?,payouts_enabled=?,"
                + "details_submitted=?,requirements_due=?::jsonb,last_synced_at=now(),updated_at=now() WHERE id=?",
                onboarding, status.chargesEnabled(), status.payoutsEnabled(), status.detailsSubmitted(),
                ShopSupport.json(status.requirementsDue()), accountId);
        UUID sellerId = jdbc.queryForObject("SELECT seller_id FROM seller_payment_accounts WHERE id=?", UUID.class, accountId);
        if (!status.chargesEnabled()) {
            return;
        }
        for (UUID recipient : policy.sellerRecipients(sellerId)) {
            support.notify(recipient, "MARKETPLACE_ACCOUNT_ACTION_REQUIRED", "Payout account ready",
                    "Your marketplace payout account is ready to receive transfers.", "SHOP", sellerId,
                    "connect-ready:" + accountId + ":" + recipient);
        }
    }

    private void onPayout(Map<String, Object> object, String type) {
        String payoutId = String.valueOf(object.get("id"));
        String destination = String.valueOf(object.get("destination"));
        UUID accountId = jdbc.query("SELECT id FROM seller_payment_accounts WHERE provider_key='STRIPE' "
                + "AND connected_account_id=?", rs -> rs.next() ? rs.getObject(1, UUID.class) : null, destination);
        if (accountId == null) {
            return;
        }
        long amount = ((Number) object.getOrDefault("amount", 0)).longValue();
        String currency = String.valueOf(object.getOrDefault("currency", "usd")).toUpperCase();
        String status = switch (type) {
            case "payout.paid" -> "PAID";
            case "payout.failed" -> "FAILED";
            case "payout.canceled" -> "CANCELLED";
            default -> "PENDING";
        };
        String arrival = object.get("arrival_date") == null ? null
                : Instant.ofEpochSecond(((Number) object.get("arrival_date")).longValue()).toString().substring(0, 10);
        jdbc.update("INSERT INTO seller_payout_records(seller_payment_account_id,provider_payout_id,currency_code,"
                + "amount_minor,status,arrival_date,paid_at,failed_at,failure_code) VALUES(?,?,?,?,?,?,"
                + "CASE WHEN ?='PAID' THEN now() END,CASE WHEN ?='FAILED' THEN now() END,?) "
                + "ON CONFLICT(provider_payout_id) DO UPDATE SET status=EXCLUDED.status,paid_at=EXCLUDED.paid_at,"
                + "failed_at=EXCLUDED.failed_at,failure_code=EXCLUDED.failure_code,updated_at=now()",
                accountId, payoutId, currency, amount, status, arrival == null ? null : java.sql.Date.valueOf(arrival),
                status, status, object.get("failure_code") == null ? null : String.valueOf(object.get("failure_code")));
        if ("PAID".equals(status)) {
            for (UUID recipient : policy.sellerRecipients(jdbc.queryForObject(
                    "SELECT seller_id FROM seller_payment_accounts WHERE id=?", UUID.class, accountId))) {
                support.notify(recipient, "MARKETPLACE_PAYOUT_UPDATE", "Payout sent",
                        "A payout to your bank account completed.", "SHOP", accountId,
                        "payout-paid:" + payoutId + ":" + recipient);
            }
        }
    }

    private void onDispute(Map<String, Object> object) {
        String chargeId = String.valueOf(object.get("charge"));
        UUID paymentId = jdbc.query("SELECT id FROM marketplace_payments WHERE provider_charge_id=? OR "
                + "provider_payment_intent_id=?", rs -> rs.next() ? rs.getObject(1, UUID.class) : null, chargeId, chargeId);
        if (paymentId == null) {
            return;
        }
        jdbc.update("INSERT INTO marketplace_disputes(payment_id,provider_dispute_id,dispute_type,reason_code,amount_minor,"
                + "currency_code,evidence_due_at,status) VALUES(?,?,'CHARGEBACK',?,?,?,?, 'OPEN') "
                + "ON CONFLICT(provider_dispute_id) DO NOTHING", paymentId, object.get("id"),
                object.get("reason") == null ? null : String.valueOf(object.get("reason")),
                ((Number) object.getOrDefault("amount", 0)).longValue(),
                String.valueOf(object.getOrDefault("currency", "usd")).toUpperCase(),
                object.get("evidence_details") instanceof Map<?, ?> ev && ev.get("due_by") instanceof Number n
                        ? java.sql.Timestamp.from(Instant.ofEpochSecond(n.longValue())) : null);
    }

    private void onTransferReversed(Map<String, Object> object) {
        String transferId = String.valueOf(object.get("id"));
        long reversed = ((Number) object.getOrDefault("amount_reversed", 0)).longValue();
        jdbc.update("UPDATE seller_transfers SET reversed_amount_minor=?,status=CASE WHEN ?>=transfer_amount_minor "
                + "THEN 'REVERSED' ELSE 'PARTIALLY_REVERSED' END,updated_at=now() WHERE provider_transfer_id=?",
                reversed, reversed, transferId);
    }

    /** Manual payment state reconciliation (order detail polling, admin repair). */
    @Transactional
    public void reconcilePayment(UUID orderId) {
        Object[] payment = jdbc.query("SELECT id,provider_payment_intent_id,status FROM marketplace_payments "
                + "WHERE order_id=? ORDER BY created_at DESC LIMIT 1", rs -> rs.next() ? new Object[] {
                        rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3)} : null, orderId);
        if (payment == null) {
            throw notFound("PAYMENT_NOT_FOUND");
        }
        if (provider == null || !provider.available() || "SUCCEEDED".equals(payment[2])) {
            return;
        }
        CheckoutStatus status = provider.retrieveHostedCheckout((String) payment[1]);
        if ("PAID".equals(status.status())) {
            lifecycle.finalizePaid((UUID) payment[0], status.paymentIntentId(), status.chargeId());
        } else if ("EXPIRED".equals(status.status()) || "FAILED".equals(status.status())) {
            lifecycle.finalizeFailed((UUID) payment[0], status.failureCode(), status.failureMessage());
        }
    }

    public PaymentProvider provider() {
        return provider;
    }

    void requireProvider() {
        if (provider == null || !provider.available()) {
            throw conflict("PAYMENT_PROVIDER_UNAVAILABLE");
        }
    }
}
