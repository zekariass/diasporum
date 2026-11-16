package com.diasporum.backend.billing.internal.application;

import com.diasporum.backend.billing.internal.domain.BillingModels;
import com.diasporum.backend.billing.internal.domain.BillingModels.BillingOption;
import com.diasporum.backend.billing.internal.domain.BillingModels.BillingOptionsView;
import com.diasporum.backend.billing.internal.domain.BillingModels.CheckoutCommand;
import com.diasporum.backend.billing.internal.domain.BillingModels.CountryBillingSettings;
import com.diasporum.backend.billing.internal.domain.BillingModels.PriceOption;
import com.diasporum.backend.billing.internal.domain.BillingModels.ProviderCapability;
import com.diasporum.backend.billing.internal.domain.BillingModels.SubscriptionView;
import com.diasporum.backend.billing.internal.infrastructure.integration.PaymentProvider;
import com.diasporum.backend.billing.internal.infrastructure.integration.PaymentProvider.PaymentInitiation;
import com.diasporum.backend.billing.internal.infrastructure.integration.PaymentProviderRegistry;
import com.diasporum.backend.billing.internal.infrastructure.persistence.BillingPurchaseRepository;
import com.diasporum.backend.billing.internal.infrastructure.persistence.CountryBillingRepository;
import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.identity.IdentityApi.ProfileSummary;
import com.diasporum.backend.media.MediaApi;
import com.diasporum.backend.taxonomy.TaxonomyApi;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * Country-aware checkout: what a caller may buy, and starting the purchase.
 *
 * <p>Every decision resolves through {@code country_billing_settings} and
 * {@code payment_provider_country_capabilities} — there is no country-specific
 * branch in this class. A country gaining a payment capability is a
 * configuration change.
 */
@Service
public class BillingCheckoutService {

    /** Media purposes a payment receipt may already be uploaded under. */
    private static final Set<String> RECEIPT_PURPOSES = Set.of("DOCUMENT", "OTHER");

    private final BillingPurchaseRepository purchases;
    private final CountryBillingRepository config;
    private final PaymentProviderRegistry registry;
    private final IdentityApi identity;
    private final TaxonomyApi taxonomy;
    private final MediaApi media;
    private final ObjectMapper mapper;

    public BillingCheckoutService(BillingPurchaseRepository purchases,
            CountryBillingRepository config, PaymentProviderRegistry registry,
            IdentityApi identity, TaxonomyApi taxonomy, MediaApi media, ObjectMapper mapper) {
        this.purchases = purchases;
        this.config = config;
        this.registry = registry;
        this.identity = identity;
        this.taxonomy = taxonomy;
        this.media = media;
        this.mapper = mapper;
    }

    /** A checkout request. {@code priceId} alone identifies an option; the
     * plan/term fields are the alternative for clients that resolved an
     * option from {@link #options}. */
    public record CheckoutRequest(UUID countryId, String planKey, UUID priceId,
            String billingArrangement, String billingInterval, Integer intervalCount,
            String currencyCode, String providerKey, String method, String idempotencyKey) {
    }

    /** What the client must do to complete payment. */
    public record CheckoutResult(UUID orderId, UUID paymentId, UUID subscriptionId,
            String providerKey, String status, String instructions,
            Map<String, Object> details) {
    }

    // ---- what can be bought ----

    @Transactional(readOnly = true)
    public BillingOptionsView options(UUID userId, UUID requestedCountryId) {
        requireActiveProfile(userId);
        UUID countryId = resolveBillingCountry(userId, requestedCountryId);
        CountryBillingSettings settings = requireSettings(countryId);
        String iso2 = countryIso2(countryId);

        var usable = config.capabilities(countryId).stream()
                .filter(ProviderCapability::enabled)
                .filter(ProviderCapability::providerActive)
                .filter(this::adapterUsable)
                .toList();
        var prices = preferCountrySpecific(config.purchasableOptions(countryId,
                CountryBillingRepository.arrayLiteral(settings.supportedCurrencies())));

        var options = new ArrayList<BillingOption>();
        for (PriceOption price : prices) {
            if (!settings.supportsArrangement(price.billingArrangement())
                    || !settings.supportsCurrency(price.currencyCode())
                    || !measurableTerm(price)) {
                continue;
            }
            for (ProviderCapability capability : usable) {
                if (!capability.supportsArrangement(price.billingArrangement())
                        || !capability.supportedCurrencies().contains(price.currencyCode())) {
                    continue;
                }
                options.add(new BillingOption(price.planKey(), price.planDisplayName(),
                        price.planId(), price.id(), price.amount(), price.currencyCode(),
                        price.billingInterval(), price.intervalCount(),
                        price.billingArrangement(), capability.providerKey(),
                        capability.displayName(), capability.supportedMethods(),
                        capability.requiresManualVerification()));
            }
        }
        return new BillingOptionsView(countryId, iso2, settings.defaultCurrency(),
                settings.supportedCurrencies(), settings.recurringBillingEnabled(),
                settings.prepaidTermsEnabled(), List.copyOf(options));
    }

    // ---- starting a purchase ----

    /**
     * Creates the order and payment for a new subscription, a plan change or a
     * voluntary arrangement switch, then hands off to the provider.
     *
     * <p>A prepaid subscriber buying a recurring option gets a second,
     * INCOMPLETE subscription row: their prepaid term keeps running untouched
     * until the new arrangement is actually paid for. Nothing here converts an
     * existing arrangement.
     */
    @Transactional
    public CheckoutResult checkout(UUID userId, CheckoutRequest request) {
        requireActiveProfile(userId);
        UUID countryId = resolveBillingCountry(userId, request.countryId());
        CountryBillingSettings settings = requireSettings(countryId);
        PriceOption price = resolvePrice(countryId, settings, request);
        ProviderCapability capability = requireCapability(request.providerKey(), countryId,
                price, request.method());

        Optional<UUID> replayed = purchases.orderByIdempotencyKey(userId,
                request.idempotencyKey());
        if (replayed.isPresent()) {
            return reinitiate(userId, countryId, replayed.get(), price, capability);
        }

        var live = purchases.liveSubscription(userId);
        UUID subscriptionId = resolveTargetSubscription(userId, countryId, price, capability,
                live);
        UUID orderId = purchases.insertOrder(userId, countryId, price.currencyCode(),
                price.amount(), capability.providerKey(), subscriptionId, price.id(),
                request.idempotencyKey());
        UUID paymentId = purchases.insertPayment(orderId, subscriptionId,
                capability.providerKey(), price.amount(), price.currencyCode());
        if (purchases.subscription(subscriptionId).map(s -> s.sourceOrderId() == null)
                .orElse(false)) {
            purchases.linkOrderSubscription(orderId, subscriptionId);
        }
        purchases.audit(userId, "BILLING_CHECKOUT_STARTED", "BILLING_ORDER", orderId,
                BillingSubscriptionService.json("planKey", price.planKey(),
                        "arrangement", price.billingArrangement(),
                        "providerKey", capability.providerKey(),
                        "subscriptionId", subscriptionId.toString()));

        PaymentInitiation initiation = initiate(userId, countryId, price, capability, orderId,
                paymentId);
        return new CheckoutResult(orderId, paymentId, subscriptionId, capability.providerKey(),
                initiation.status(), initiation.instructions(), initiation.details());
    }

    /**
     * Renews the caller's live prepaid subscription for another term on the
     * same row. Defaults to the term that was last purchased.
     */
    @Transactional
    public CheckoutResult renew(UUID userId, CheckoutRequest request) {
        SubscriptionView subscription = purchases.liveSubscription(userId)
                .filter(SubscriptionView::prepaid)
                .orElseThrow(() -> error(HttpStatus.CONFLICT, "NO_PREPAID_SUBSCRIPTION"));
        CheckoutRequest effective = request;
        if (request.priceId() == null && request.planKey() == null) {
            UUID previousPrice = subscription.sourceOrderId() == null ? null
                    : purchases.order(subscription.sourceOrderId())
                            .map(BillingPurchaseRepository.PaidOrder::planPriceId).orElse(null);
            if (previousPrice == null) {
                throw error(HttpStatus.BAD_REQUEST, "BILLING_RENEWAL_TERM_REQUIRED");
            }
            effective = new CheckoutRequest(request.countryId(), null, previousPrice,
                    BillingModels.PREPAID, null, null, null, request.providerKey(),
                    request.method(), request.idempotencyKey());
        }
        if (!BillingModels.PREPAID.equals(effective.billingArrangement())) {
            throw error(HttpStatus.BAD_REQUEST, "BILLING_RENEWAL_MUST_BE_PREPAID");
        }
        return checkout(userId, effective);
    }

    /**
     * Submits evidence for a manual-verification payment. Verification itself
     * is a platform-admin action; this only queues the claim.
     */
    @Transactional
    public UUID submitPaymentProof(UUID userId, UUID paymentId, String proofReference,
            UUID mediaObjectId, String notes) {
        requireActiveProfile(userId);
        var payment = purchases.payment(paymentId).orElseThrow(
                () -> error(HttpStatus.NOT_FOUND, "BILLING_PAYMENT_NOT_FOUND"));
        var order = payment.orderId() == null ? null
                : purchases.order(payment.orderId()).orElse(null);
        if (order == null || !userId.equals(order.userId())) {
            throw error(HttpStatus.FORBIDDEN, "NOT_PAYMENT_OWNER");
        }
        if (!"PENDING".equals(payment.status())) {
            throw error(HttpStatus.CONFLICT, "BILLING_PAYMENT_NOT_PENDING");
        }
        if (!manualVerification(payment.providerKey(), order.countryId())) {
            throw error(HttpStatus.CONFLICT, "PAYMENT_NOT_MANUALLY_VERIFIED");
        }
        if ((proofReference == null || proofReference.isBlank()) && mediaObjectId == null) {
            throw error(HttpStatus.BAD_REQUEST, "BILLING_PROOF_EVIDENCE_REQUIRED");
        }
        if (purchases.hasPendingProof(paymentId)) {
            throw error(HttpStatus.CONFLICT, "BILLING_PROOF_ALREADY_SUBMITTED");
        }
        if (mediaObjectId != null) {
            requireOwnedReceipt(userId, mediaObjectId);
        }
        UUID proofId = purchases.insertProof(paymentId, userId,
                proofReference == null ? null : proofReference.trim(), mediaObjectId, notes);
        purchases.audit(userId, "BILLING_PAYMENT_PROOF_SUBMITTED", "BILLING_PAYMENT_PROOF",
                proofId, BillingSubscriptionService.json("paymentId", paymentId.toString()));
        return proofId;
    }

    // ---- resolution and validation ----

    /**
     * The caller's billing country: an explicit request value, else the
     * current country on their profile. Never derived from IP.
     */
    private UUID resolveBillingCountry(UUID userId, UUID requestedCountryId) {
        UUID countryId = requestedCountryId != null ? requestedCountryId
                : identity.profileSummary(userId).map(ProfileSummary::currentCountryId)
                        .orElse(null);
        if (countryId == null) {
            throw error(HttpStatus.UNPROCESSABLE_ENTITY, "BILLING_COUNTRY_REQUIRED");
        }
        if (!taxonomy.isCountryActive(countryId)) {
            throw error(HttpStatus.UNPROCESSABLE_ENTITY, "BILLING_COUNTRY_INACTIVE");
        }
        return countryId;
    }

    private CountryBillingSettings requireSettings(UUID countryId) {
        CountryBillingSettings settings = config.settings(countryId).orElseThrow(
                () -> error(HttpStatus.CONFLICT, "BILLING_COUNTRY_NOT_CONFIGURED"));
        if (!settings.active() || !settings.billingEnabled()) {
            throw error(HttpStatus.CONFLICT, "BILLING_NOT_ENABLED_IN_COUNTRY");
        }
        if (!settings.subscriptionsEnabled()) {
            throw error(HttpStatus.CONFLICT, "SUBSCRIPTIONS_NOT_ENABLED_IN_COUNTRY");
        }
        return settings;
    }

    private PriceOption resolvePrice(UUID countryId, CountryBillingSettings settings,
            CheckoutRequest request) {
        PriceOption price;
        if (request.priceId() != null) {
            price = config.priceById(request.priceId()).orElseThrow(
                    () -> error(HttpStatus.NOT_FOUND, "BILLING_PRICE_NOT_AVAILABLE"));
            if (price.countryId() != null && !price.countryId().equals(countryId)) {
                throw error(HttpStatus.CONFLICT, "BILLING_PRICE_NOT_AVAILABLE");
            }
        } else {
            UUID planId = config.planIdByKey(normalized(request.planKey()))
                    .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "BILLING_PLAN_NOT_FOUND"));
            String currency = request.currencyCode() == null ? settings.defaultCurrency()
                    : normalized(request.currencyCode());
            price = config.resolvePrice(planId, countryId, currency,
                            normalized(request.billingInterval()),
                            request.intervalCount() == null ? 1 : request.intervalCount(),
                            normalized(request.billingArrangement()))
                    .orElseThrow(() -> error(HttpStatus.NOT_FOUND,
                            "BILLING_PRICE_NOT_AVAILABLE"));
        }
        if (!settings.supportsCurrency(price.currencyCode())) {
            throw error(HttpStatus.CONFLICT, "BILLING_CURRENCY_NOT_SUPPORTED");
        }
        if (!settings.supportsArrangement(price.billingArrangement())) {
            throw error(HttpStatus.CONFLICT, "BILLING_ARRANGEMENT_NOT_AVAILABLE");
        }
        if (!measurableTerm(price)) {
            throw error(HttpStatus.CONFLICT, "BILLING_TERM_NOT_MEASURABLE");
        }
        return price;
    }

    private ProviderCapability requireCapability(String providerKey, UUID countryId,
            PriceOption price, String method) {
        if (providerKey == null || providerKey.isBlank()) {
            throw error(HttpStatus.BAD_REQUEST, "PAYMENT_PROVIDER_REQUIRED");
        }
        ProviderCapability capability = config.capability(normalized(providerKey), countryId)
                .orElseThrow(() -> error(HttpStatus.CONFLICT,
                        "PAYMENT_PROVIDER_NOT_AVAILABLE"));
        if (!capability.enabled() || !capability.providerActive()) {
            throw error(HttpStatus.CONFLICT, "PAYMENT_PROVIDER_NOT_AVAILABLE");
        }
        if (!capability.supportsArrangement(price.billingArrangement())) {
            throw error(HttpStatus.CONFLICT, "PAYMENT_PROVIDER_ARRANGEMENT_UNSUPPORTED");
        }
        if (!capability.supportedCurrencies().contains(price.currencyCode())) {
            throw error(HttpStatus.CONFLICT, "BILLING_CURRENCY_NOT_SUPPORTED");
        }
        if (method != null && !method.isBlank()
                && !capability.supportedMethods().contains(normalized(method))) {
            throw error(HttpStatus.CONFLICT, "PAYMENT_METHOD_NOT_SUPPORTED");
        }
        return capability;
    }

    /**
     * Decides which subscription row this purchase applies to.
     *
     * <ul>
     *   <li>Same plan and arrangement, prepaid and live — a renewal of that row.</li>
     *   <li>Anything else while a row is live — a new INCOMPLETE row that will
     *       supersede the live one only once it is paid for. This is the
     *       voluntary switch path; the live row is not modified here.</li>
     *   <li>Nothing live — a new INCOMPLETE row.</li>
     * </ul>
     */
    private UUID resolveTargetSubscription(UUID userId, UUID countryId, PriceOption price,
            ProviderCapability capability, Optional<SubscriptionView> live) {
        if (live.isPresent()) {
            SubscriptionView current = live.get();
            boolean samePlan = current.planId().equals(price.planId());
            boolean sameArrangement = current.billingArrangement()
                    .equals(price.billingArrangement());
            if (samePlan && sameArrangement) {
                if (!current.prepaid()) {
                    // A live recurring subscription renews with its provider.
                    throw error(HttpStatus.CONFLICT, "ALREADY_SUBSCRIBED");
                }
                return current.id();
            }
            return reuseOrCreatePending(userId, countryId, price, capability);
        }
        return reuseOrCreatePending(userId, countryId, price, capability);
    }

    /** Reuses an unpaid INCOMPLETE row for the same option instead of piling up rows. */
    private UUID reuseOrCreatePending(UUID userId, UUID countryId, PriceOption price,
            ProviderCapability capability) {
        var pending = purchases.pendingSubscription(userId)
                .filter(s -> s.planId().equals(price.planId()))
                .filter(s -> s.billingArrangement().equals(price.billingArrangement()));
        return pending.map(SubscriptionView::id).orElseGet(() ->
                purchases.insertIncompleteSubscription(userId, price.planId(),
                        price.billingArrangement(), "PURCHASE", countryId,
                        price.currencyCode(), capability.providerKey(), null));
    }

    /** Re-hands an existing unpaid order back to its provider, creating nothing. */
    private CheckoutResult reinitiate(UUID userId, UUID countryId, UUID orderId,
            PriceOption price, ProviderCapability capability) {
        var order = purchases.order(orderId).orElseThrow(
                () -> error(HttpStatus.NOT_FOUND, "BILLING_ORDER_NOT_FOUND"));
        UUID paymentId = purchases.paymentOfOrder(orderId).orElseThrow(
                () -> error(HttpStatus.CONFLICT, "BILLING_PAYMENT_NOT_FOUND"));
        if ("PAID".equals(order.status())) {
            return new CheckoutResult(orderId, paymentId, order.subscriptionId(),
                    capability.providerKey(), "SUCCEEDED", null, Map.of());
        }
        PaymentInitiation initiation = initiate(userId, countryId, price, capability, orderId,
                paymentId);
        return new CheckoutResult(orderId, paymentId, order.subscriptionId(),
                capability.providerKey(), initiation.status(), initiation.instructions(),
                initiation.details());
    }

    private PaymentInitiation initiate(UUID userId, UUID countryId, PriceOption price,
            ProviderCapability capability, UUID orderId, UUID paymentId) {
        Map<String, Object> providerConfig = providerConfig(capability.providerKey());
        PaymentProvider provider = registry.require(capability.providerKey(), providerConfig);
        var command = new CheckoutCommand(userId, countryId, countryIso2(countryId), price,
                capability.providerKey(), null, orderId, paymentId, price.amount(),
                price.currencyCode(), providerConfig);
        return provider.initiate(command);
    }

    private boolean adapterUsable(ProviderCapability capability) {
        return registry.find(capability.providerKey())
                .map(p -> p.available(providerConfig(capability.providerKey())))
                .orElse(false);
    }

    private boolean manualVerification(String providerKey, UUID countryId) {
        if (countryId == null) {
            return false;
        }
        return config.capability(providerKey, countryId)
                .map(ProviderCapability::manual).orElse(false);
    }

    private void requireOwnedReceipt(UUID userId, UUID mediaObjectId) {
        var asset = media.asset(mediaObjectId).orElseThrow(
                () -> error(HttpStatus.NOT_FOUND, "MEDIA_NOT_FOUND"));
        if (!userId.equals(asset.ownerId()) || !RECEIPT_PURPOSES.contains(asset.purpose())) {
            throw error(HttpStatus.FORBIDDEN, "MEDIA_NOT_USABLE_AS_RECEIPT");
        }
        if (!media.isReady(mediaObjectId)) {
            throw error(HttpStatus.CONFLICT, "MEDIA_NOT_READY");
        }
    }

    private Map<String, Object> providerConfig(String providerKey) {
        String json = config.providerConfig(providerKey).orElse(null);
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            return mapper.readValue(json, new TypeReference<Map<String, Object>>() { });
        } catch (JacksonException e) {
            throw error(HttpStatus.CONFLICT, "PAYMENT_PROVIDER_NOT_CONFIGURED");
        }
    }

    private String countryIso2(UUID countryId) {
        return taxonomy.findCountryById(countryId).map(TaxonomyApi.CountryView::iso2)
                .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "COUNTRY_NOT_FOUND"));
    }

    private void requireActiveProfile(UUID userId) {
        ProfileSummary profile = identity.profileSummary(userId).orElseThrow(
                () -> error(HttpStatus.FORBIDDEN, "ACTIVE_PROFILE_REQUIRED"));
        if (!"ACTIVE".equals(profile.accountStatus())) {
            throw error(HttpStatus.FORBIDDEN, "ACTIVE_PROFILE_REQUIRED");
        }
    }

    /** Keeps the country-specific row when a currency-level default also matches. */
    private static List<PriceOption> preferCountrySpecific(List<PriceOption> prices) {
        var best = new LinkedHashMap<String, PriceOption>();
        for (PriceOption price : prices) {
            String key = price.planId() + "|" + price.currencyCode() + "|"
                    + price.billingInterval() + "|" + price.intervalCount() + "|"
                    + price.billingArrangement();
            best.putIfAbsent(key, price);
        }
        return List.copyOf(best.values());
    }

    private static boolean measurableTerm(PriceOption price) {
        return "MONTH".equals(price.billingInterval()) || "YEAR".equals(price.billingInterval());
    }

    private static String normalized(String value) {
        return value == null ? null : value.trim().toUpperCase(java.util.Locale.ROOT);
    }

    private static ResponseStatusException error(HttpStatus status, String reason) {
        return new ResponseStatusException(status, reason);
    }
}
