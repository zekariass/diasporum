package com.diasporum.backend.events;

import com.diasporum.backend.events.internal.application.ticketing.TicketPaymentGateway;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * In-memory stand-in for the platform Stripe account. Intents and refunds keep
 * Stripe's idempotency semantics (same key → same object); tests drive state
 * transitions explicitly. No network, no keys.
 */
public class FakeTicketPaymentGateway implements TicketPaymentGateway {

    private final Map<String, Intent> intents = new ConcurrentHashMap<>();
    private final Map<String, String> intentByKey = new ConcurrentHashMap<>();
    private final Map<String, Refund> refunds = new ConcurrentHashMap<>();
    private final Map<String, String> refundByKey = new ConcurrentHashMap<>();
    private final AtomicInteger seq = new AtomicInteger();
    public final AtomicInteger createCalls = new AtomicInteger();
    public final AtomicInteger cancelCalls = new AtomicInteger();
    public final AtomicInteger refundCalls = new AtomicInteger();
    public volatile String nextRefundStatus = "SUCCEEDED";

    public void reset() {
        intents.clear();
        intentByKey.clear();
        refunds.clear();
        refundByKey.clear();
        createCalls.set(0);
        cancelCalls.set(0);
        refundCalls.set(0);
        nextRefundStatus = "SUCCEEDED";
    }

    @Override
    public boolean available() {
        return true;
    }

    @Override
    public Intent createPaymentIntent(String idempotencyKey, long amountMinor, String currency,
            Map<String, String> metadata) {
        createCalls.incrementAndGet();
        String id = intentByKey.computeIfAbsent(idempotencyKey, k -> {
            String pi = "pi_test_" + seq.incrementAndGet();
            intents.put(pi, new Intent(pi, pi + "_secret", "requires_payment_method", amountMinor,
                    currency.toUpperCase(), null));
            return pi;
        });
        return intents.get(id);
    }

    @Override
    public Intent retrieve(String paymentIntentId) {
        return intents.get(paymentIntentId);
    }

    @Override
    public Intent cancel(String paymentIntentId) {
        cancelCalls.incrementAndGet();
        Intent i = intents.get(paymentIntentId);
        if (i.succeeded() || i.processing()) {
            return i;
        }
        return setStatus(paymentIntentId, "canceled");
    }

    @Override
    public Refund refund(String idempotencyKey, String paymentIntentId, long amountMinor,
            Map<String, String> metadata) {
        refundCalls.incrementAndGet();
        String id = refundByKey.computeIfAbsent(idempotencyKey, k -> {
            String re = "re_test_" + seq.incrementAndGet();
            refunds.put(re, new Refund(re, nextRefundStatus, null));
            return re;
        });
        return refunds.get(id);
    }

    @Override
    public Refund retrieveRefund(String refundId) {
        return refunds.get(refundId);
    }

    public Intent setStatus(String paymentIntentId, String status) {
        Intent i = intents.get(paymentIntentId);
        Intent next = new Intent(i.id(), i.clientSecret(), status, i.amountMinor(), i.currency(),
                "requires_payment_method".equals(status) ? "card_declined" : null);
        intents.put(paymentIntentId, next);
        return next;
    }

    public void setRefundStatus(String refundId, String status) {
        refunds.put(refundId, new Refund(refundId, status, null));
    }
}
