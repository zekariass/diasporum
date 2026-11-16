package com.diasporum.backend.billing.internal.infrastructure.integration;

import com.diasporum.backend.billing.internal.domain.BillingModels.BillingPaymentView;
import com.diasporum.backend.billing.internal.domain.BillingModels.CheckoutCommand;
import com.diasporum.backend.billing.internal.domain.BillingModels.SubscriptionView;
import java.math.BigDecimal;
import java.util.Map;

/**
 * Payment provider port. Each adapter registers as a Spring bean and is
 * selected by the {@code provider_key} resolved from
 * {@code payment_provider_country_capabilities}, so adding a provider to a
 * country is configuration rather than a code change.
 *
 * <p>Only {@code BANK_TRANSFER} has an adapter today
 * ({@link ManualPaymentProvider}). Every other registry row is seeded
 * {@code is_active=false}: a capability row expresses intended country
 * capability, never that an integration exists.
 */
public interface PaymentProvider {

    /** Must match a {@code payment_providers.provider_key} value. */
    String providerKey();

    /**
     * True when this adapter has everything it needs to transact. Checked at
     * checkout in addition to the registry's {@code is_active} flag, so an
     * adapter missing credentials or account details fails closed.
     */
    boolean available(Map<String, Object> providerConfig);

    /**
     * Starts collection for an order whose {@code billing_orders} and
     * {@code billing_payments} rows already exist in PENDING. Returns whatever
     * the client needs to complete payment: a provider client secret, a
     * redirect, or out-of-band transfer instructions.
     */
    PaymentInitiation initiate(CheckoutCommand command);

    /**
     * Normalizes a provider callback into a payment outcome. The caller must
     * have verified authenticity before persisting anything. MANUAL providers
     * have no callback channel and reject this call — staff verification of a
     * {@code billing_payment_proofs} row drives them instead.
     */
    PaymentConfirmation confirm(WebhookContext event);

    /** Requests a refund. Adapters that cannot refund return a rejection. */
    RefundResult refund(BillingPaymentView payment, BigDecimal amount);

    /**
     * Cancels a provider-side recurring agreement. A no-op for providers that
     * never hold one, which includes every prepaid and manual arrangement.
     */
    default void cancelRecurring(SubscriptionView subscription) {
        // No recurring agreement exists for one-time or manual providers.
    }

    /**
     * What the client must do next. {@code status} is PENDING when payment
     * happens out of band (manual transfer), REQUIRES_ACTION when the client
     * must complete a provider flow, or SUCCEEDED when already settled.
     * {@code details} carries provider-specific, non-secret fields such as
     * bank account details or a client secret.
     */
    record PaymentInitiation(String providerKey, String status, String instructions,
            Map<String, Object> details) {
    }

    /** A normalized payment outcome. {@code status} matches billing_payments.status. */
    record PaymentConfirmation(String providerKey, String providerPaymentId, String status,
            BigDecimal amount, String currencyCode, String failureCode, String failureMessage) {
    }

    /** A provider callback whose authenticity the caller already established. */
    record WebhookContext(String providerKey, String providerEventId, String eventType,
            Map<String, Object> payload) {
    }

    /** Refund outcome. {@code accepted} false means the provider declined or cannot refund. */
    record RefundResult(boolean accepted, String providerRefundId, String status, String message) {
    }
}
