package com.diasporum.backend.events.internal.application.ticketing;

import java.util.Map;

/**
 * Payment port for ticket orders. Payments are collected on the platform's own
 * provider account (PaymentIntents), never on organiser accounts. Amounts are
 * provider minor units; callers convert from the schema's numeric(12,2) major
 * units. Every mutating call carries an idempotency key so retries are safe.
 */
public interface TicketPaymentGateway {

    String PROVIDER_KEY = "STRIPE";

    boolean available();

    Intent createPaymentIntent(String idempotencyKey, long amountMinor, String currency,
            Map<String, String> metadata);

    Intent retrieve(String paymentIntentId);

    /** Cancels an unpaid intent; returns its resulting state (may already be succeeded). */
    Intent cancel(String paymentIntentId);

    Refund refund(String idempotencyKey, String paymentIntentId, long amountMinor,
            Map<String, String> metadata);

    Refund retrieveRefund(String refundId);

    /**
     * @param status provider status: requires_payment_method, requires_confirmation,
     *     requires_action, processing, requires_capture, canceled, succeeded
     */
    record Intent(String id, String clientSecret, String status, long amountMinor, String currency,
            String paymentMethodSummary) {

        public boolean succeeded() {
            return "succeeded".equals(status);
        }

        public boolean processing() {
            return "processing".equals(status) || "requires_capture".equals(status);
        }

        public boolean canceled() {
            return "canceled".equals(status);
        }
    }

    /** @param status SUCCEEDED, PENDING or FAILED */
    record Refund(String id, String status, String failureCode) {
    }
}
