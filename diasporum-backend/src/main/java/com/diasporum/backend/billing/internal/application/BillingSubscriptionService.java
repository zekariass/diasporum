package com.diasporum.backend.billing.internal.application;

import com.diasporum.backend.billing.internal.domain.BillingModels.PriceOption;
import com.diasporum.backend.billing.internal.domain.BillingModels.SubscriptionView;
import com.diasporum.backend.billing.internal.infrastructure.persistence.BillingPurchaseRepository;
import com.diasporum.backend.billing.internal.infrastructure.persistence.CountryBillingRepository;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Subscription lifecycle: activation, prepaid renewal, arrangement switching
 * and expiry.
 *
 * <p>This service only decides <em>when a plan applies and until when</em>. It
 * never touches entitlement resolution: the rows it writes are read by the
 * existing provider-neutral resolver, which is why a plan grants identical
 * entitlements however it was paid for.
 *
 * <p>Two invariants shape every transition:
 * <ul>
 *   <li>A prepaid subscription is never auto-converted to recurring. A country
 *       enabling recurring billing changes nothing for existing subscribers;
 *       only a deliberate purchase of a recurring option switches them, and
 *       even then the time they already paid for is carried over.</li>
 *   <li>At most one subscription per owner may be live, enforced by the
 *       pre-existing partial unique indexes. A row taking over from another
 *       supersedes it first, in the same transaction.</li>
 * </ul>
 */
@Service
public class BillingSubscriptionService {

    private final BillingPurchaseRepository purchases;
    private final CountryBillingRepository config;

    public BillingSubscriptionService(BillingPurchaseRepository purchases,
            CountryBillingRepository config) {
        this.purchases = purchases;
        this.config = config;
    }

    public Optional<SubscriptionView> currentSubscription(UUID userId) {
        return purchases.liveSubscription(userId);
    }

    /**
     * Applies a settled payment to its subscription. Idempotent: replaying a
     * confirmation for an already-paid order changes nothing, which matters
     * because both a provider callback and an admin verifying a payment proof
     * can reach this path.
     *
     * @return the subscription as it stands after the transition
     */
    @Transactional
    public SubscriptionView activateFromPaidOrder(UUID orderId, String providerBillingId) {
        var order = purchases.order(orderId).orElseThrow(
                () -> error(HttpStatus.NOT_FOUND, "BILLING_ORDER_NOT_FOUND"));
        if (!"PAID".equals(order.status())) {
            throw error(HttpStatus.CONFLICT, "BILLING_ORDER_NOT_PAID");
        }
        UUID subscriptionId = order.subscriptionId();
        if (subscriptionId == null) {
            throw error(HttpStatus.CONFLICT, "BILLING_ORDER_HAS_NO_SUBSCRIPTION");
        }
        PriceOption price = order.planPriceId() == null ? null
                : config.purchasedPriceById(order.planPriceId()).orElse(null);
        if (price == null) {
            throw error(HttpStatus.CONFLICT, "BILLING_ORDER_PRICE_UNRESOLVED");
        }
        var subscription = purchases.subscription(subscriptionId).orElseThrow(
                () -> error(HttpStatus.NOT_FOUND, "BILLING_SUBSCRIPTION_NOT_FOUND"));

        Term term = Term.of(price);
        if ("INCOMPLETE".equals(subscription.status())) {
            return activateNewTerm(order.userId(), subscription, term, orderId, providerBillingId);
        }
        if (isLive(subscription.status())) {
            return extendExistingTerm(subscription, term, orderId);
        }
        // EXPIRED or CANCELED. Checkout targets a lapsed subscriber's purchase
        // at a fresh row, so this is the late-confirmation case: the row was
        // retired between checkout and payment (an expired hold, or an
        // arrangement switch that landed first). Starting a new term on it is
        // still correct — the customer paid for one.
        return activateNewTerm(order.userId(), subscription, term, orderId, providerBillingId);
    }

    /**
     * Activates a subscription that is not yet live, superseding whatever was
     * live for the same owner. Any unexpired time on the superseded row is
     * carried into the new term, so a voluntary prepaid-to-recurring switch
     * costs the subscriber nothing they already paid for.
     */
    private SubscriptionView activateNewTerm(UUID userId, SubscriptionView subscription,
            Term term, UUID orderId, String providerBillingId) {
        var superseded = purchases.liveSubscription(userId)
                .filter(live -> !live.id().equals(subscription.id()));
        java.time.Instant anchor = null;
        if (superseded.isPresent()) {
            var previous = superseded.get();
            anchor = previous.currentPeriodEnd();
            // Remove the previous row from the one-live-subscription index
            // before the new row enters it.
            purchases.supersede(previous.id());
            purchases.audit(userId, "BILLING_SUBSCRIPTION_SUPERSEDED", "BILLING_SUBSCRIPTION",
                    previous.id(), json("replacedBy", subscription.id().toString(),
                            "previousArrangement", previous.billingArrangement(),
                            "newArrangement", subscription.billingArrangement()));
        }
        purchases.activateTerm(subscription.id(), term.years(), term.months(), anchor,
                orderId, providerBillingId);
        purchases.audit(userId, "BILLING_SUBSCRIPTION_ACTIVATED", "BILLING_SUBSCRIPTION",
                subscription.id(), json("arrangement", subscription.billingArrangement(),
                        "orderId", orderId.toString(), "planKey", subscription.planKey()));
        return reload(subscription.id());
    }

    /** A renewal of the same prepaid subscription: one row, many terms. */
    private SubscriptionView extendExistingTerm(SubscriptionView subscription, Term term,
            UUID orderId) {
        if (!subscription.prepaid()) {
            // A live recurring subscription is renewed by its provider, not by
            // an order the platform settles.
            throw error(HttpStatus.CONFLICT, "BILLING_SUBSCRIPTION_NOT_PREPAID");
        }
        purchases.extendTerm(subscription.id(), term.years(), term.months(), orderId);
        purchases.audit(subscription.userId(), "BILLING_SUBSCRIPTION_RENEWED",
                "BILLING_SUBSCRIPTION", subscription.id(),
                json("orderId", orderId.toString(), "planKey", subscription.planKey()));
        return reload(subscription.id());
    }

    /**
     * Marks elapsed prepaid terms EXPIRED. Recurring subscriptions are left
     * alone: their provider drives PAST_DUE and cancellation through webhooks.
     */
    @Transactional
    public int expireElapsedPrepaidTerms() {
        return purchases.expireElapsedPrepaidTerms();
    }

    private SubscriptionView reload(UUID subscriptionId) {
        return purchases.subscription(subscriptionId).orElseThrow(
                () -> error(HttpStatus.NOT_FOUND, "BILLING_SUBSCRIPTION_NOT_FOUND"));
    }

    static boolean isLive(String status) {
        return "TRIALING".equals(status) || "ACTIVE".equals(status)
                || "PAST_DUE".equals(status) || "PAUSED".equals(status);
    }

    /**
     * A purchased term expressed as whole years and months, the units
     * {@code billing_interval} supports. A prepaid option must have a length;
     * {@code NONE} describes a free or one-off price and cannot be a term.
     */
    record Term(int years, int months) {

        static Term of(PriceOption price) {
            int count = price.intervalCount();
            return switch (price.billingInterval()) {
                case "YEAR" -> new Term(count, 0);
                case "MONTH" -> new Term(0, count);
                default -> throw error(HttpStatus.CONFLICT, "BILLING_TERM_NOT_MEASURABLE");
            };
        }
    }

    static String json(String... keyValues) {
        var builder = new StringBuilder("{");
        for (int i = 0; i + 1 < keyValues.length; i += 2) {
            if (i > 0) {
                builder.append(',');
            }
            builder.append('"').append(keyValues[i]).append("\":\"")
                    .append(keyValues[i + 1] == null ? "" : keyValues[i + 1]
                            .replace("\\", "\\\\").replace("\"", "\\\""))
                    .append('"');
        }
        return builder.append('}').toString();
    }

    static ResponseStatusException error(HttpStatus status, String reason) {
        return new ResponseStatusException(status, reason);
    }
}
