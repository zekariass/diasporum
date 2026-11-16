package com.diasporum.backend.shopmarketplace.internal.infrastructure.stripe;

import static com.diasporum.backend.shopmarketplace.internal.infrastructure.ProviderHttp.arr;
import static com.diasporum.backend.shopmarketplace.internal.infrastructure.ProviderHttp.bool;
import static com.diasporum.backend.shopmarketplace.internal.infrastructure.ProviderHttp.lng;
import static com.diasporum.backend.shopmarketplace.internal.infrastructure.ProviderHttp.obj;
import static com.diasporum.backend.shopmarketplace.internal.infrastructure.ProviderHttp.str;

import com.diasporum.backend.shopmarketplace.internal.application.PaymentProvider;
import com.diasporum.backend.shopmarketplace.internal.application.ShopProperties;
import com.diasporum.backend.shopmarketplace.internal.infrastructure.ProviderHttp;
import com.diasporum.backend.shopmarketplace.internal.infrastructure.ProviderHttp.ProviderException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Stripe adapter: Checkout Sessions for the single customer charge, Connect hosted onboarding,
 * separate transfers per seller order, refunds, transfer reversals and signed webhooks.
 * The secret key never leaves the backend.
 */
@Component
public class StripePaymentProvider implements PaymentProvider {
    private static final long SIGNATURE_TOLERANCE_SECONDS = 300;

    private final ShopProperties.Stripe config;

    public StripePaymentProvider(ShopProperties properties) {
        this.config = properties.stripe();
    }

    @Override
    public String key() {
        return "STRIPE";
    }

    @Override
    public boolean available() {
        return config.configured();
    }

    private Map<String, Object> call(String method, String path, List<String[]> form, String idempotencyKey) {
        if (!available()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "PAYMENT_PROVIDER_UNAVAILABLE");
        }
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Authorization", "Bearer " + config.secretKey());
        if (idempotencyKey != null) {
            headers.put("Idempotency-Key", idempotencyKey);
        }
        return ProviderHttp.send(method, config.base() + path, headers, "application/x-www-form-urlencoded",
                form == null ? null : ProviderHttp.form(form));
    }

    private static void add(List<String[]> form, String key, Object value) {
        if (value != null) {
            form.add(new String[] {key, String.valueOf(value)});
        }
    }

    @Override
    public HostedCheckout createHostedCheckout(HostedCheckoutRequest request) {
        List<String[]> form = ProviderHttp.pairs();
        add(form, "mode", "payment");
        add(form, "success_url", request.successUrl());
        add(form, "cancel_url", request.cancelUrl());
        add(form, "expires_at", request.expiresAt().getEpochSecond());
        add(form, "payment_intent_data[transfer_group]", request.transferGroup());
        int i = 0;
        for (CheckoutLine line : request.lines()) {
            String p = "line_items[" + i++ + "]";
            add(form, p + "[quantity]", line.quantity());
            add(form, p + "[price_data][currency]", request.currency().toLowerCase());
            add(form, p + "[price_data][unit_amount]", line.unitAmountMinor());
            add(form, p + "[price_data][product_data][name]", line.name());
        }
        request.metadata().forEach((k, v) -> {
            add(form, "metadata[" + k + "]", v);
            add(form, "payment_intent_data[metadata][" + k + "]", v);
        });
        Map<String, Object> session = call("POST", "/v1/checkout/sessions", form, request.idempotencyKey());
        Long expires = lng(session.get("expires_at"));
        return new HostedCheckout(str(session.get("id")), str(session.get("url")),
                expires == null ? request.expiresAt() : Instant.ofEpochSecond(expires));
    }

    @Override
    public CheckoutStatus retrieveHostedCheckout(String providerCheckoutId) {
        Map<String, Object> session = call("GET", "/v1/checkout/sessions/" + providerCheckoutId, null, null);
        String paymentIntent = str(session.get("payment_intent"));
        String status = str(session.get("status"));
        if ("paid".equals(session.get("payment_status")) || "no_payment_required".equals(session.get("payment_status"))) {
            String charge = null;
            if (paymentIntent != null) {
                charge = str(call("GET", "/v1/payment_intents/" + paymentIntent, null, null).get("latest_charge"));
            }
            return new CheckoutStatus("PAID", paymentIntent, charge, null, null);
        }
        if ("expired".equals(status)) {
            return new CheckoutStatus("EXPIRED", paymentIntent, null, "checkout_expired", "Payment window expired");
        }
        if (paymentIntent != null) {
            Map<String, Object> pi = call("GET", "/v1/payment_intents/" + paymentIntent, null, null);
            Map<String, Object> error = obj(pi.get("last_payment_error"));
            if (!error.isEmpty() && "requires_payment_method".equals(pi.get("status"))) {
                return new CheckoutStatus("OPEN", paymentIntent, null, str(error.get("code")), str(error.get("message")));
            }
        }
        return new CheckoutStatus("OPEN", paymentIntent, null, null, null);
    }

    @Override
    public void expireHostedCheckout(String providerCheckoutId) {
        try {
            call("POST", "/v1/checkout/sessions/" + providerCheckoutId + "/expire", ProviderHttp.pairs(), null);
        } catch (ProviderException e) {
            // Already completed/expired sessions cannot be expired again; the webhook reconciles.
        }
    }

    @Override
    public String createConnectedAccount(String idempotencyKey, String countryIso2, String businessType,
            String companyName, Map<String, String> metadata) {
        List<String[]> form = ProviderHttp.pairs();
        add(form, "type", config.accountType());
        add(form, "country", countryIso2);
        add(form, "capabilities[transfers][requested]", "true");
        if ("individual".equals(businessType) || "company".equals(businessType)) {
            add(form, "business_type", businessType);
            if ("company".equals(businessType) && companyName != null && !companyName.isBlank()) {
                add(form, "company[name]", companyName);
            }
        }
        metadata.forEach((k, v) -> add(form, "metadata[" + k + "]", v));
        return str(call("POST", "/v1/accounts", form, idempotencyKey).get("id"));
    }

    @Override
    public OnboardingLinkResult accountLink(String connectedAccountId, String returnUrl, String refreshUrl) {
        List<String[]> form = ProviderHttp.pairs();
        add(form, "account", connectedAccountId);
        add(form, "return_url", returnUrl);
        add(form, "refresh_url", refreshUrl);
        add(form, "type", "account_onboarding");
        Map<String, Object> link = call("POST", "/v1/account_links", form, null);
        Long expires = lng(link.get("expires_at"));
        return new OnboardingLinkResult(str(link.get("url")), expires == null ? null : Instant.ofEpochSecond(expires));
    }

    @Override
    public ConnectedAccountStatus retrieveConnectedAccount(String connectedAccountId) {
        return accountStatus(call("GET", "/v1/accounts/" + connectedAccountId, null, null));
    }

    public static ConnectedAccountStatus accountStatus(Map<String, Object> account) {
        Map<String, Object> requirements = obj(account.get("requirements"));
        List<String> due = arr(requirements.get("currently_due")).stream().map(String::valueOf).toList();
        String disabled = str(requirements.get("disabled_reason"));
        return new ConnectedAccountStatus(str(account.get("id")), str(account.get("country")),
                bool(account.get("charges_enabled")), bool(account.get("payouts_enabled")),
                bool(account.get("details_submitted")), due, disabled != null, disabled);
    }

    @Override
    public TransferResult transfer(String idempotencyKey, long amountMinor, String currency, String destination,
            String transferGroup, String sourceChargeId) {
        List<String[]> form = ProviderHttp.pairs();
        add(form, "amount", amountMinor);
        add(form, "currency", currency.toLowerCase());
        add(form, "destination", destination);
        add(form, "transfer_group", transferGroup);
        add(form, "source_transaction", sourceChargeId);
        try {
            Map<String, Object> transfer = call("POST", "/v1/transfers", form, idempotencyKey);
            return new TransferResult(str(transfer.get("id")), "SUCCEEDED", null);
        } catch (ProviderException e) {
            return new TransferResult(null, "FAILED", errorCode(e));
        }
    }

    @Override
    public RefundResult refund(String idempotencyKey, String paymentIntentId, long amountMinor, String reason) {
        List<String[]> form = ProviderHttp.pairs();
        add(form, "payment_intent", paymentIntentId);
        add(form, "amount", amountMinor);
        add(form, "metadata[reason]", reason);
        try {
            Map<String, Object> refund = call("POST", "/v1/refunds", form, idempotencyKey);
            String status = str(refund.get("status"));
            return new RefundResult(str(refund.get("id")), "succeeded".equals(status) ? "SUCCEEDED"
                    : "failed".equals(status) || "canceled".equals(status) ? "FAILED" : "PENDING", null);
        } catch (ProviderException e) {
            return new RefundResult(null, "FAILED", errorCode(e));
        }
    }

    @Override
    public TransferResult reverseTransfer(String idempotencyKey, String transferId, long amountMinor) {
        List<String[]> form = ProviderHttp.pairs();
        add(form, "amount", amountMinor);
        try {
            Map<String, Object> reversal = call("POST", "/v1/transfers/" + transferId + "/reversals", form, idempotencyKey);
            return new TransferResult(str(reversal.get("id")), "SUCCEEDED", null);
        } catch (ProviderException e) {
            return new TransferResult(null, "FAILED", errorCode(e));
        }
    }

    private static String errorCode(ProviderException e) {
        Map<String, Object> error = obj(e.body().get("error"));
        String code = str(error.get("code"));
        return code == null ? "provider_error_" + e.status() : code;
    }

    @Override
    public WebhookEvent verifyWebhook(String payload, String signatureHeader) {
        String secret = config.webhookSecret();
        if (secret == null || secret.isBlank() || signatureHeader == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "WEBHOOK_SIGNATURE_INVALID");
        }
        String timestamp = null;
        List<String> signatures = new java.util.ArrayList<>();
        for (String part : signatureHeader.split(",")) {
            String[] kv = part.trim().split("=", 2);
            if (kv.length == 2 && "t".equals(kv[0])) {
                timestamp = kv[1];
            } else if (kv.length == 2 && "v1".equals(kv[0])) {
                signatures.add(kv[1]);
            }
        }
        if (timestamp == null || signatures.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "WEBHOOK_SIGNATURE_INVALID");
        }
        long ts;
        try {
            ts = Long.parseLong(timestamp);
        } catch (NumberFormatException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "WEBHOOK_SIGNATURE_INVALID");
        }
        if (Math.abs(Instant.now().getEpochSecond() - ts) > SIGNATURE_TOLERANCE_SECONDS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "WEBHOOK_SIGNATURE_EXPIRED");
        }
        byte[] expected = hmac(secret, timestamp + "." + payload);
        boolean match = signatures.stream().anyMatch(sig -> {
            try {
                return MessageDigest.isEqual(expected, HexFormat.of().parseHex(sig));
            } catch (IllegalArgumentException e) {
                return false;
            }
        });
        if (!match) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "WEBHOOK_SIGNATURE_INVALID");
        }
        Map<String, Object> event = ProviderHttp.parse(payload);
        Map<String, Object> data = obj(event.get("data"));
        return new WebhookEvent(str(event.get("id")), str(event.get("type")), str(event.get("account")),
                obj(data.get("object")), event);
    }

    public static byte[] hmac(String secret, String value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return mac.doFinal(value.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
