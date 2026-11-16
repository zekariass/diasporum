package com.diasporum.backend.billing.internal.application;

import com.diasporum.backend.billing.internal.domain.BillingModels.CountryBillingSettings;
import com.diasporum.backend.billing.internal.domain.BillingModels.PaymentProofView;
import com.diasporum.backend.billing.internal.domain.BillingModels.ProviderCapability;
import com.diasporum.backend.billing.internal.infrastructure.persistence.BillingPurchaseRepository;
import com.diasporum.backend.billing.internal.infrastructure.persistence.CountryBillingRepository;
import java.math.BigDecimal;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Platform-admin configuration of country billing policy, the provider x
 * country capability matrix and plan price options, plus verification of
 * manual payment proofs. Every mutation is audited to
 * {@code billing_audit_events}.
 */
@Service
public class BillingCountryAdminService {

    private static final Set<String> ARRANGEMENTS = Set.of("RECURRING", "PREPAID");
    private static final Set<String> INTERVALS = Set.of("NONE", "MONTH", "YEAR");
    private static final int MAX_ARRAY_TOKENS = 32;

    private final BillingAdminService admin;
    private final CountryBillingRepository config;
    private final BillingPurchaseRepository purchases;
    private final BillingSubscriptionService subscriptions;

    public BillingCountryAdminService(BillingAdminService admin,
            CountryBillingRepository config, BillingPurchaseRepository purchases,
            BillingSubscriptionService subscriptions) {
        this.admin = admin;
        this.config = config;
        this.purchases = purchases;
        this.subscriptions = subscriptions;
    }

    // ---- country billing policy ----

    @Transactional(readOnly = true)
    public List<CountryBillingSettings> countrySettings(UUID actor) {
        admin.requireGlobalAdmin(actor);
        return config.allSettings();
    }

    /**
     * Upserts a country's billing policy. Turning
     * {@code recurringBillingEnabled} on only makes recurring options
     * purchasable from then on; existing prepaid subscriptions are untouched
     * and are never converted.
     */
    @Transactional
    public CountryBillingSettings upsertCountrySettings(UUID actor, UUID countryId,
            boolean billingEnabled, boolean subscriptionsEnabled, String defaultCurrency,
            List<String> supportedCurrencies, boolean recurringBillingEnabled,
            boolean manualVerificationEnabled, boolean prepaidTermsEnabled, boolean active,
            String notes) {
        admin.requireGlobalAdmin(actor);
        String currency = requireCurrency(defaultCurrency);
        List<String> currencies = requireTokens(supportedCurrencies, "BILLING_CURRENCY_INVALID");
        if (!currencies.contains(currency)) {
            throw bad("BILLING_DEFAULT_CURRENCY_NOT_SUPPORTED");
        }
        config.upsertSettings(countryId, billingEnabled, subscriptionsEnabled, currency,
                CountryBillingRepository.arrayLiteral(currencies), recurringBillingEnabled,
                manualVerificationEnabled, prepaidTermsEnabled, active, notes);
        purchases.audit(actor, "BILLING_COUNTRY_SETTINGS_UPDATED", "COUNTRY", countryId,
                BillingSubscriptionService.json("billingEnabled", String.valueOf(billingEnabled),
                        "recurringBillingEnabled", String.valueOf(recurringBillingEnabled),
                        "prepaidTermsEnabled", String.valueOf(prepaidTermsEnabled),
                        "defaultCurrency", currency));
        return config.settings(countryId).orElseThrow(
                () -> bad("BILLING_COUNTRY_NOT_CONFIGURED"));
    }

    // ---- provider capability matrix ----

    @Transactional(readOnly = true)
    public List<ProviderCapability> capabilities(UUID actor, UUID countryId) {
        admin.requireGlobalAdmin(actor);
        return config.capabilities(countryId);
    }

    /**
     * Upserts one provider's capability in one country. This is the supported
     * way for a country to gain a payment capability — no schema change and no
     * code change. It records intent only: a provider still needs an adapter
     * and {@code is_active=true} before anything can be charged.
     */
    @Transactional
    public ProviderCapability upsertCapability(UUID actor, String providerKey, UUID countryId,
            boolean enabled, boolean supportsOneTime, boolean supportsRecurring,
            boolean supportsRefund, boolean requiresManualVerification,
            List<String> supportedCurrencies, List<String> supportedMethods, String notes) {
        admin.requireGlobalAdmin(actor);
        String provider = requireProvider(providerKey);
        List<String> currencies = requireTokens(supportedCurrencies, "BILLING_CURRENCY_INVALID");
        List<String> methods = requireTokens(supportedMethods, "PAYMENT_METHOD_INVALID");
        config.upsertCapability(provider, countryId, enabled, supportsOneTime,
                supportsRecurring, supportsRefund, requiresManualVerification,
                CountryBillingRepository.arrayLiteral(currencies),
                CountryBillingRepository.arrayLiteral(methods), notes);
        purchases.audit(actor, "BILLING_PROVIDER_CAPABILITY_UPDATED", "COUNTRY", countryId,
                BillingSubscriptionService.json("providerKey", provider,
                        "enabled", String.valueOf(enabled),
                        "supportsRecurring", String.valueOf(supportsRecurring),
                        "requiresManualVerification", String.valueOf(requiresManualVerification)));
        return config.capability(provider, countryId).orElseThrow(
                () -> bad("PAYMENT_PROVIDER_NOT_AVAILABLE"));
    }

    /**
     * Flips a provider's availability and config. This is the switch that
     * reflects whether an adapter is actually in the build; capability rows
     * alone never authorize a charge.
     */
    @Transactional
    public void updateProvider(UUID actor, String providerKey, boolean active,
            String configJson) {
        admin.requireGlobalAdmin(actor);
        String provider = requireProvider(providerKey);
        config.updateProvider(provider, active, configJson);
        purchases.audit(actor, "BILLING_PROVIDER_UPDATED", "PAYMENT_PROVIDER", null,
                BillingSubscriptionService.json("providerKey", provider,
                        "active", String.valueOf(active),
                        "configUpdated", String.valueOf(configJson != null)));
    }

    // ---- plan price options ----

    /**
     * Adds a price option. Existing subscriptions are unaffected: each order
     * references the exact price row it bought, and a subscription snapshots
     * its own country, currency and period.
     */
    @Transactional
    public UUID addPriceOption(UUID actor, String planKey, UUID countryId, String currencyCode,
            BigDecimal amount, String billingInterval, Integer intervalCount,
            String billingArrangement) {
        admin.requireGlobalAdmin(actor);
        UUID planId = config.planIdByKey(normalized(planKey)).orElseThrow(
                () -> bad("BILLING_PLAN_NOT_FOUND"));
        String currency = requireCurrency(currencyCode);
        String interval = normalized(billingInterval);
        String arrangement = normalized(billingArrangement);
        int count = intervalCount == null ? 1 : intervalCount;
        if (!INTERVALS.contains(interval) || !ARRANGEMENTS.contains(arrangement) || count < 1) {
            throw bad("BILLING_PRICE_OPTION_INVALID");
        }
        if (amount == null || amount.signum() < 0) {
            throw bad("BILLING_PRICE_OPTION_INVALID");
        }
        if ("PREPAID".equals(arrangement) && "NONE".equals(interval)) {
            // A prepaid term has to have a length to compute a period end.
            throw bad("BILLING_TERM_NOT_MEASURABLE");
        }
        UUID priceId = config.insertPrice(planId, countryId, currency, amount, interval, count,
                arrangement);
        purchases.audit(actor, "BILLING_PRICE_OPTION_ADDED", "BILLING_PLAN_PRICE", priceId,
                BillingSubscriptionService.json("planKey", normalized(planKey),
                        "currency", currency, "interval", interval,
                        "intervalCount", String.valueOf(count), "arrangement", arrangement));
        return priceId;
    }

    /** Retires a price option without altering any subscription already sold on it. */
    @Transactional
    public void retirePriceOption(UUID actor, UUID priceId) {
        admin.requireGlobalAdmin(actor);
        if (config.deactivatePrice(priceId) == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "BILLING_PRICE_NOT_AVAILABLE");
        }
        purchases.audit(actor, "BILLING_PRICE_OPTION_RETIRED", "BILLING_PLAN_PRICE", priceId,
                "{}");
    }

    // ---- manual payment verification ----

    @Transactional(readOnly = true)
    public List<PaymentProofView> paymentProofs(UUID actor, String status, int limit,
            int offset) {
        admin.requireGlobalAdmin(actor);
        String normalized = status == null || status.isBlank() ? "PENDING" : normalized(status);
        return purchases.proofsByStatus(normalized, Math.min(Math.max(limit, 1), 100),
                Math.max(offset, 0));
    }

    /**
     * Verifies a payment proof, which is what settles a manual payment: there
     * is no webhook for an out-of-band transfer. Settling the payment marks
     * the order paid and activates or extends the subscription, so a prepaid
     * term starts when the money is confirmed rather than when it was claimed.
     */
    @Transactional
    public PaymentProofView verifyPaymentProof(UUID actor, UUID proofId) {
        admin.requireGlobalAdmin(actor);
        var proof = purchases.proof(proofId).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "BILLING_PROOF_NOT_FOUND"));
        if (!"PENDING".equals(proof.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "BILLING_PROOF_NOT_PENDING");
        }
        if (purchases.verifyProof(proofId, actor) == 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "BILLING_PROOF_NOT_PENDING");
        }
        var payment = purchases.payment(proof.paymentId()).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "BILLING_PAYMENT_NOT_FOUND"));
        if ("PENDING".equals(payment.status())) {
            purchases.markPaymentSucceeded(payment.id(), null);
            if (payment.orderId() != null) {
                purchases.markOrderPaid(payment.orderId());
                subscriptions.activateFromPaidOrder(payment.orderId(), null);
            }
        }
        purchases.audit(actor, "BILLING_PAYMENT_PROOF_VERIFIED", "BILLING_PAYMENT_PROOF",
                proofId, BillingSubscriptionService.json("paymentId", payment.id().toString(),
                        "orderId", payment.orderId() == null ? null
                                : payment.orderId().toString()));
        return purchases.proof(proofId).orElseThrow();
    }

    /** Rejects a proof. The payment stays PENDING so the customer can resubmit. */
    @Transactional
    public PaymentProofView rejectPaymentProof(UUID actor, UUID proofId, String reason) {
        admin.requireGlobalAdmin(actor);
        if (reason == null || reason.isBlank()) {
            throw bad("BILLING_PROOF_REJECTION_REASON_REQUIRED");
        }
        if (purchases.rejectProof(proofId, actor, reason.trim()) == 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "BILLING_PROOF_NOT_PENDING");
        }
        purchases.audit(actor, "BILLING_PAYMENT_PROOF_REJECTED", "BILLING_PAYMENT_PROOF",
                proofId, BillingSubscriptionService.json("reason", reason.trim()));
        return purchases.proof(proofId).orElseThrow();
    }

    // ---- validation ----

    private String requireProvider(String providerKey) {
        String provider = normalized(providerKey);
        if (provider == null || !config.providerExists(provider)) {
            throw bad("PAYMENT_PROVIDER_NOT_FOUND");
        }
        return provider;
    }

    private static String requireCurrency(String currencyCode) {
        String currency = normalized(currencyCode);
        if (currency == null || !currency.matches("[A-Z]{3}")) {
            throw bad("BILLING_CURRENCY_INVALID");
        }
        return currency;
    }

    /**
     * Normalizes and validates array tokens. Validation is what makes it safe
     * to pass these as a Postgres array literal, and it keeps the vocabulary
     * open: a new payment method needs no migration.
     */
    private static List<String> requireTokens(List<String> values, String reason) {
        if (values == null || values.isEmpty() || values.size() > MAX_ARRAY_TOKENS) {
            throw bad(reason);
        }
        var tokens = values.stream().map(BillingCountryAdminService::normalized)
                .filter(java.util.Objects::nonNull).distinct().toList();
        if (tokens.size() != values.size()
                || tokens.stream().anyMatch(t -> !t.matches("[A-Z][A-Z0-9_]*"))) {
            throw bad(reason);
        }
        return tokens;
    }

    private static String normalized(String value) {
        return value == null || value.isBlank() ? null
                : value.trim().toUpperCase(Locale.ROOT);
    }

    private static ResponseStatusException bad(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason);
    }
}
