package com.diasporum.backend.shopmarketplace.internal.application;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Marketplace payment provider port (Stripe Connect separate charges and transfers is the
 * initial adapter). The mobile client never talks to the provider directly and never
 * calculates commissions, transfers or payouts.
 */
public interface PaymentProvider {

    String key();

    boolean available();

    /** Hosted payment page for one customer charge covering the whole mixed-seller checkout. */
    HostedCheckout createHostedCheckout(HostedCheckoutRequest request);

    CheckoutStatus retrieveHostedCheckout(String providerCheckoutId);

    void expireHostedCheckout(String providerCheckoutId);

    /**
     * @param businessType Stripe's {@code business_type} — {@code "individual"} or {@code "company"}.
     *     Pre-filling this from our own {@code seller_type} means the hosted onboarding link
     *     skips asking the seller a question we already know the answer to.
     * @param companyName required when {@code businessType} is {@code "company"}; ignored otherwise.
     */
    String createConnectedAccount(String idempotencyKey, String countryIso2, String businessType,
            String companyName, Map<String, String> metadata);

    OnboardingLinkResult accountLink(String connectedAccountId, String returnUrl, String refreshUrl);

    ConnectedAccountStatus retrieveConnectedAccount(String connectedAccountId);

    TransferResult transfer(String idempotencyKey, long amountMinor, String currency, String destination,
            String transferGroup, String sourceChargeId);

    RefundResult refund(String idempotencyKey, String paymentIntentId, long amountMinor, String reason);

    TransferResult reverseTransfer(String idempotencyKey, String transferId, long amountMinor);

    /** Verifies the provider signature before anything is persisted; throws on failure. */
    WebhookEvent verifyWebhook(String payload, String signatureHeader);

    record CheckoutLine(String name, long unitAmountMinor, int quantity) {
    }

    record HostedCheckoutRequest(String idempotencyKey, String currency, List<CheckoutLine> lines,
            String transferGroup, String successUrl, String cancelUrl, Instant expiresAt,
            Map<String, String> metadata) {
    }

    record HostedCheckout(String providerCheckoutId, String url, Instant expiresAt) {
    }

    /** status: OPEN, PAID, EXPIRED, FAILED. */
    record CheckoutStatus(String status, String paymentIntentId, String chargeId, String failureCode,
            String failureMessage) {
    }

    record OnboardingLinkResult(String url, Instant expiresAt) {
    }

    record ConnectedAccountStatus(String accountId, String country, boolean chargesEnabled,
            boolean payoutsEnabled, boolean detailsSubmitted, List<String> requirementsDue,
            boolean disabled, String disabledReason) {
    }

    /** status: SUCCEEDED, PENDING, FAILED. */
    record TransferResult(String providerId, String status, String failureCode) {
    }

    record RefundResult(String providerRefundId, String status, String failureCode) {
    }

    record WebhookEvent(String id, String type, String account, Map<String, Object> object,
            Map<String, Object> raw) {
    }
}
