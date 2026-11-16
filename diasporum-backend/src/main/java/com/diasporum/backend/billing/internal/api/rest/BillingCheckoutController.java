package com.diasporum.backend.billing.internal.api.rest;

import com.diasporum.backend.billing.internal.application.BillingCheckoutService;
import com.diasporum.backend.billing.internal.application.BillingCheckoutService.CheckoutRequest;
import com.diasporum.backend.billing.internal.application.BillingCheckoutService.CheckoutResult;
import com.diasporum.backend.billing.internal.application.BillingSubscriptionService;
import com.diasporum.backend.billing.internal.domain.BillingModels.BillingOptionsView;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Subscription purchase endpoints for the authenticated caller. The billing
 * country, price and provider are all server-resolved; the client only picks
 * from what {@code /me/billing/options} offered it.
 */
@RestController
@RequestMapping("/api/v1/me/billing")
public class BillingCheckoutController {

    private final BillingCheckoutService checkout;
    private final BillingSubscriptionService subscriptions;

    public BillingCheckoutController(BillingCheckoutService checkout,
            BillingSubscriptionService subscriptions) {
        this.checkout = checkout;
        this.subscriptions = subscriptions;
    }

    /** Plans, terms and providers purchasable in the caller's billing country. */
    @GetMapping("/options")
    public BillingOptionsView options(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) UUID countryId) {
        return checkout.options(principal.userId(), countryId);
    }

    /** Creates the order and payment, and returns what the client must do next. */
    @PostMapping("/checkout")
    public CheckoutResult checkout(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestBody Map<String, Object> body) {
        return checkout.checkout(principal.userId(), request(body));
    }

    /** The caller's current subscription, including arrangement and period. */
    @GetMapping("/subscription")
    public Map<String, Object> subscription(
            @AuthenticationPrincipal DiasporumUserPrincipal principal) {
        var current = subscriptions.currentSubscription(principal.userId());
        var out = new java.util.HashMap<String, Object>();
        out.put("subscription", current.orElse(null));
        return out;
    }

    /** Buys another prepaid term for the caller's existing subscription. */
    @PostMapping("/subscription/renew")
    public CheckoutResult renew(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestBody Map<String, Object> body) {
        return checkout.renew(principal.userId(), request(body));
    }

    /** Submits a transfer reference and optional receipt for staff verification. */
    @PostMapping("/payments/{paymentId}/proofs")
    public Map<String, Object> submitProof(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID paymentId, @RequestBody Map<String, Object> body) {
        UUID proofId = checkout.submitPaymentProof(principal.userId(), paymentId,
                string(body.get("proofReference")), uuid(body.get("mediaObjectId")),
                string(body.get("notes")));
        return Map.of("id", proofId, "status", "PENDING");
    }

    private static CheckoutRequest request(Map<String, Object> body) {
        return new CheckoutRequest(uuid(body.get("countryId")), string(body.get("planKey")),
                uuid(body.get("priceId")), string(body.get("billingArrangement")),
                string(body.get("billingInterval")), integer(body.get("intervalCount")),
                string(body.get("currencyCode")), string(body.get("providerKey")),
                string(body.get("method")), requireIdempotencyKey(body.get("idempotencyKey")));
    }

    private static String requireIdempotencyKey(Object value) {
        String key = string(value);
        if (key == null || key.length() > 200) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "IDEMPOTENCY_KEY_REQUIRED");
        }
        return key;
    }

    private static String string(Object value) {
        return value == null || value.toString().isBlank() ? null : value.toString().trim();
    }

    private static Integer integer(Object value) {
        return value == null ? null : Integer.valueOf(value.toString());
    }

    private static UUID uuid(Object value) {
        return value == null || value.toString().isBlank() ? null
                : UUID.fromString(value.toString());
    }
}
