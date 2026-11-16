package com.diasporum.backend.events.internal.application.ticketing;

import com.diasporum.backend.events.internal.application.ticketing.TicketOrderStore.OrderRow;
import com.diasporum.backend.events.internal.application.ticketing.TicketPaymentGateway.Intent;
import com.diasporum.backend.events.internal.infrastructure.stripe.StripeWebhookVerifier;
import com.diasporum.backend.events.internal.infrastructure.stripe.StripeWebhookVerifier.VerifiedEvent;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/**
 * Stripe webhook intake for ticket payments.
 *
 * <ol>
 *   <li>Verify the signature first. An unverified request is rejected (400) and
 *       NOTHING is stored — its event id is untrusted, and persisting it would
 *       let a forged delivery pre-empt the real event in the dedup index.</li>
 *   <li>Insert into {@code ticket_payment_events} (signature_verified = true) in
 *       its own committed transaction; UNIQUE(provider_key, provider_event_id)
 *       makes a second delivery a no-op answered as IGNORED.</li>
 *   <li>Claim the row (RECEIVED/FAILED → PROCESSING) so concurrent deliveries
 *       cannot both process.</li>
 *   <li>Process. Objects are re-fetched from Stripe and matched against our own
 *       order by stored provider id — the payload's amount/status is never
 *       trusted. Every downstream step is itself idempotent.</li>
 *   <li>PROCESSED / IGNORED on success; FAILED (+ error_detail, committed
 *       separately) and HTTP 500 on error so Stripe retries.</li>
 * </ol>
 */
@Service
public class TicketPaymentWebhookService {
    private static final Logger log = LoggerFactory.getLogger(TicketPaymentWebhookService.class);
    private static final String PROVIDER = TicketPaymentGateway.PROVIDER_KEY;

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final StripeWebhookVerifier verifier;
    private final TicketPaymentGateway gateway;
    private final TicketOrderStore store;
    private final TicketOrderService orders;
    private final TicketFulfilmentService fulfilment;
    private final TicketRefundService refunds;

    public TicketPaymentWebhookService(JdbcTemplate jdbc, org.springframework.transaction.PlatformTransactionManager txManager,
            StripeWebhookVerifier verifier, TicketPaymentGateway gateway, TicketOrderStore store,
            TicketOrderService orders, TicketFulfilmentService fulfilment,
            TicketRefundService refunds) {
        this.jdbc = jdbc;
        this.tx = new TransactionTemplate(txManager);
        this.verifier = verifier;
        this.gateway = gateway;
        this.store = store;
        this.orders = orders;
        this.fulfilment = fulfilment;
        this.refunds = refunds;
    }

    private record Result(String status, UUID orderId, UUID refundId, String detail) {
        static Result ignored(String detail) {
            return new Result("IGNORED", null, null, detail);
        }
    }

    /** @return the stored event status: PROCESSED, IGNORED or FAILED (non-retryable anomaly). */
    public String handle(String payload, String signatureHeader) {
        VerifiedEvent event = verifier.verify(payload, signatureHeader);
        UUID rowId = tx.execute(s -> jdbc.query("INSERT INTO ticket_payment_events(provider_key,"
                + "provider_event_id,event_type,payload,signature_verified,status)"
                + " VALUES(?,?,?,?::jsonb,true,'RECEIVED') ON CONFLICT (provider_key,provider_event_id)"
                + " DO NOTHING RETURNING id", rs -> rs.next() ? rs.getObject(1, UUID.class) : null,
                PROVIDER, event.id(), event.type(), payload));
        if (rowId == null) {
            rowId = jdbc.query("SELECT id FROM ticket_payment_events WHERE provider_key=?"
                    + " AND provider_event_id=?", rs -> rs.next() ? rs.getObject(1, UUID.class) : null,
                    PROVIDER, event.id());
        }
        final UUID id = rowId;
        Integer claimed = tx.execute(s -> jdbc.update("UPDATE ticket_payment_events SET"
                + " status='PROCESSING' WHERE id=? AND (status IN ('RECEIVED','FAILED')"
                + " OR (status='PROCESSING' AND received_at < now()-interval '10 minutes'))", id));
        if (claimed == null || claimed == 0) {
            return "IGNORED"; // duplicate delivery of an already handled (or in-flight) event
        }
        try {
            Result r = dispatch(event);
            tx.executeWithoutResult(s -> jdbc.update("UPDATE ticket_payment_events SET status=?,"
                    + "order_id=coalesce(?,order_id),refund_id=coalesce(?,refund_id),error_detail=?,"
                    + "processed_at=now() WHERE id=?", r.status(), r.orderId(), r.refundId(),
                    truncate(r.detail()), id));
            return r.status();
        } catch (RuntimeException ex) {
            log.warn("Ticket webhook {} ({}) failed: {}", event.id(), event.type(), ex.toString());
            tx.executeWithoutResult(s -> jdbc.update("UPDATE ticket_payment_events SET"
                    + " status='FAILED',error_detail=? WHERE id=?", truncate(ex.toString()), id));
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "WEBHOOK_PROCESSING_FAILED");
        }
    }

    private Result dispatch(VerifiedEvent event) {
        Map<String, Object> object = event.object();
        String objectId = object.get("id") == null ? null : String.valueOf(object.get("id"));
        return switch (event.type()) {
            case "payment_intent.succeeded" -> paymentSucceeded(objectId);
            case "payment_intent.payment_failed" -> paymentFailed(objectId);
            case "payment_intent.canceled" -> paymentCanceled(objectId);
            case "refund.created", "refund.updated", "refund.failed" -> refundUpdated(List.of(objectId));
            case "charge.refunded" -> refundUpdated(chargeRefundIds(object));
            default -> Result.ignored("unhandled event type");
        };
    }

    private Result paymentSucceeded(String paymentIntentId) {
        OrderRow order = paymentIntentId == null ? null : store.byPaymentIntent(paymentIntentId);
        if (order == null) {
            return Result.ignored("no ticket order for payment intent");
        }
        Intent intent = gateway.retrieve(paymentIntentId);
        if (!intent.succeeded()) {
            return new Result("IGNORED", order.id(), null, "intent status " + intent.status());
        }
        long expected = TicketMoney.toMinor(order.totalAmount(), order.currencyCode());
        if (intent.amountMinor() != expected || !order.currencyCode().equalsIgnoreCase(intent.currency())) {
            log.error("Ticket order {} amount mismatch: expected {} {}, provider {} {}", order.id(),
                    expected, order.currencyCode(), intent.amountMinor(), intent.currency());
            return new Result("FAILED", order.id(), null, "AMOUNT_MISMATCH");
        }
        var outcome = fulfilment.confirmPaid(order.id(), "PAYMENT_WEBHOOK", null);
        return new Result("PROCESSED", order.id(), null, outcome.name());
    }

    private Result paymentFailed(String paymentIntentId) {
        OrderRow order = paymentIntentId == null ? null : store.byPaymentIntent(paymentIntentId);
        if (order == null) {
            return Result.ignored("no ticket order for payment intent");
        }
        Intent intent = gateway.retrieve(paymentIntentId);
        tx.executeWithoutResult(s -> jdbc.update("UPDATE ticket_orders SET payment_method_summary=?"
                + " WHERE id=? AND status='PAYMENT_PENDING'", truncate60(intent.paymentMethodSummary()),
                order.id()));
        // The order stays PAYMENT_PENDING: the buyer may retry until it expires.
        return new Result("PROCESSED", order.id(), null, "payment attempt failed");
    }

    private Result paymentCanceled(String paymentIntentId) {
        OrderRow order = paymentIntentId == null ? null : store.byPaymentIntent(paymentIntentId);
        if (order == null) {
            return Result.ignored("no ticket order for payment intent");
        }
        Intent intent = gateway.retrieve(paymentIntentId);
        if (!intent.canceled()) {
            return new Result("IGNORED", order.id(), null, "intent status " + intent.status());
        }
        tx.executeWithoutResult(s -> orders.closeUnpaid(order.id(), "EXPIRED", null,
                "PAYMENT_WEBHOOK", "Payment intent canceled"));
        return new Result("PROCESSED", order.id(), null, null);
    }

    private Result refundUpdated(List<String> providerRefundIds) {
        UUID last = null;
        for (String refundId : providerRefundIds) {
            if (refundId != null) {
                UUID ours = refunds.finalizeFromProvider(refundId);
                last = ours != null ? ours : last;
            }
        }
        return last == null ? Result.ignored("no ticket refund for provider refund")
                : new Result("PROCESSED", null, last, null);
    }

    @SuppressWarnings("unchecked")
    private static List<String> chargeRefundIds(Map<String, Object> charge) {
        List<String> ids = new ArrayList<>();
        Object refundsObj = charge.get("refunds");
        if (refundsObj instanceof Map<?, ?> m && m.get("data") instanceof List<?> list) {
            for (Object o : list) {
                if (o instanceof Map<?, ?> r && r.get("id") != null) {
                    ids.add(String.valueOf(r.get("id")));
                }
            }
        }
        return ids;
    }

    private static String truncate(String s) {
        return s == null ? null : s.length() > 500 ? s.substring(0, 500) : s;
    }

    private static String truncate60(String s) {
        return s == null ? null : s.length() > 60 ? s.substring(0, 60) : s;
    }
}
