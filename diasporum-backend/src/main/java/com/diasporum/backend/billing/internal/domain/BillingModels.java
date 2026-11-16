package com.diasporum.backend.billing.internal.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Purchase-layer domain records. Entitlement resolution is unaffected by
 * anything here: these models describe how a subscription was bought, never
 * what it grants. A plan grants identical entitlements whichever provider,
 * country or arrangement produced the {@code billing_subscriptions} row.
 */
public final class BillingModels {

    private BillingModels() {
    }

    /** Provider-renewed versus prepaid fixed-term. */
    public static final String RECURRING = "RECURRING";
    public static final String PREPAID = "PREPAID";

    /** Per-country billing policy ({@code country_billing_settings}). */
    public record CountryBillingSettings(UUID countryId, boolean billingEnabled,
            boolean subscriptionsEnabled, String defaultCurrency,
            List<String> supportedCurrencies, boolean recurringBillingEnabled,
            boolean manualVerificationEnabled, boolean prepaidTermsEnabled,
            boolean active) {

        public boolean supportsCurrency(String currencyCode) {
            return supportedCurrencies.contains(currencyCode);
        }

        public boolean supportsArrangement(String arrangement) {
            return RECURRING.equals(arrangement) ? recurringBillingEnabled
                    : prepaidTermsEnabled;
        }
    }

    /**
     * A provider's capability in one country, joined with its registry row.
     * {@code providerActive} is the implementation kill switch: a capability
     * row is configuration and does not imply a working integration.
     */
    public record ProviderCapability(String providerKey, String displayName,
            String integrationType, boolean providerActive, UUID countryId,
            boolean enabled, boolean supportsOneTime, boolean supportsRecurring,
            boolean supportsRefund, boolean requiresManualVerification,
            List<String> supportedCurrencies, List<String> supportedMethods) {

        public boolean manual() {
            return "MANUAL".equals(integrationType) || requiresManualVerification;
        }

        public boolean supportsArrangement(String arrangement) {
            return RECURRING.equals(arrangement) ? supportsRecurring : supportsOneTime;
        }
    }

    /**
     * One purchasable price option. {@code countryId} null means the
     * currency-level default used when no country-specific row exists.
     */
    public record PriceOption(UUID id, UUID planId, String planKey, String planDisplayName,
            UUID countryId, String currencyCode, BigDecimal amount,
            String billingInterval, int intervalCount, String billingArrangement) {

        public boolean prepaid() {
            return PREPAID.equals(billingArrangement);
        }
    }

    /** A subscription row as the purchase layer sees it. */
    public record SubscriptionView(UUID id, UUID userId, UUID planId, String planKey,
            String status, String billingArrangement, String sourceType, UUID countryId,
            String currencyCode, Instant currentPeriodStart, Instant currentPeriodEnd,
            boolean cancelAtPeriodEnd, String providerKey, String providerBillingId,
            UUID sourceOrderId, Instant renewalReminderSentAt) {

        public boolean prepaid() {
            return PREPAID.equals(billingArrangement);
        }
    }

    /** A payment row as the purchase layer and providers see it. */
    public record BillingPaymentView(UUID id, UUID orderId, UUID subscriptionId,
            String providerKey, String providerPaymentId, String status,
            BigDecimal amount, String currencyCode) {
    }

    /** Manual-verification evidence ({@code billing_payment_proofs}). */
    public record PaymentProofView(UUID id, UUID paymentId, UUID submittedByUserId,
            String proofReference, UUID mediaObjectId, String notes, String status,
            UUID verifiedByUserId, Instant verifiedAt, String rejectionReason,
            Instant createdAt) {
    }

    /**
     * Everything a provider needs to start collecting one payment. The order
     * and payment rows already exist in PENDING when this is handed over.
     */
    public record CheckoutCommand(UUID userId, UUID countryId, String countryIso2,
            PriceOption price, String providerKey, String method, UUID orderId,
            UUID paymentId, BigDecimal amount, String currencyCode,
            Map<String, Object> providerConfig) {
    }

    /** One plan/term/provider combination offered to a specific caller. */
    public record BillingOption(String planKey, String planDisplayName, UUID planId,
            UUID priceId, BigDecimal amount, String currencyCode, String billingInterval,
            int intervalCount, String billingArrangement, String providerKey,
            String providerDisplayName, List<String> methods,
            boolean requiresManualVerification) {
    }

    /** The caller's available options for their resolved billing country. */
    public record BillingOptionsView(UUID countryId, String countryIso2, String defaultCurrency,
            List<String> supportedCurrencies, boolean recurringBillingEnabled,
            boolean prepaidTermsEnabled, List<BillingOption> options) {
    }
}
