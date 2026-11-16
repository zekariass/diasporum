package com.diasporum.backend.events.internal.infrastructure.stripe;

import static com.diasporum.backend.events.internal.infrastructure.stripe.StripeHttp.lng;
import static com.diasporum.backend.events.internal.infrastructure.stripe.StripeHttp.obj;
import static com.diasporum.backend.events.internal.infrastructure.stripe.StripeHttp.str;

import com.diasporum.backend.events.internal.application.ticketing.TicketPaymentGateway;
import com.diasporum.backend.events.internal.application.ticketing.TicketingProperties;
import com.diasporum.backend.events.internal.infrastructure.stripe.StripeHttp.StripeException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Stripe PaymentIntents on the platform account for ticket orders: the buyer
 * pays Diasporum, the organiser ledger is credited, payouts are manual. No
 * Connect, no transfer_data, no application fees. The secret key never leaves
 * the backend; the mobile client only receives the intent's client_secret.
 */
@Component
public class StripeTicketPaymentGateway implements TicketPaymentGateway {

    private final TicketingProperties.Stripe config;

    public StripeTicketPaymentGateway(TicketingProperties properties) {
        this.config = properties.stripe();
    }

    @Override
    public boolean available() {
        return config.configured();
    }

    private Map<String, Object> call(String method, String path, List<String[]> form,
            String idempotencyKey) {
        if (!available()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "PAYMENT_PROVIDER_UNAVAILABLE");
        }
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Authorization", "Bearer " + config.secretKey());
        if (idempotencyKey != null) {
            headers.put("Idempotency-Key", idempotencyKey);
        }
        return StripeHttp.send(method, config.base() + path, headers,
                form == null ? null : StripeHttp.form(form));
    }

    @Override
    public Intent createPaymentIntent(String idempotencyKey, long amountMinor, String currency,
            Map<String, String> metadata) {
        List<String[]> form = new ArrayList<>();
        form.add(new String[]{"amount", Long.toString(amountMinor)});
        form.add(new String[]{"currency", currency.toLowerCase()});
        form.add(new String[]{"automatic_payment_methods[enabled]", "true"});
        metadata.forEach((k, v) -> form.add(new String[]{"metadata[" + k + "]", v}));
        try {
            return intent(call("POST", "/v1/payment_intents", form, idempotencyKey));
        } catch (StripeException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "PAYMENT_PROVIDER_ERROR");
        }
    }

    @Override
    public Intent retrieve(String paymentIntentId) {
        try {
            return intent(call("GET", "/v1/payment_intents/" + enc(paymentIntentId), null, null));
        } catch (StripeException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "PAYMENT_PROVIDER_ERROR");
        }
    }

    @Override
    public Intent cancel(String paymentIntentId) {
        try {
            return intent(call("POST", "/v1/payment_intents/" + enc(paymentIntentId) + "/cancel",
                    List.of(), "ticket-pi-cancel:" + paymentIntentId));
        } catch (StripeException e) {
            // Already succeeded/processing/canceled intents cannot be cancelled:
            // report the authoritative state instead.
            return retrieve(paymentIntentId);
        }
    }

    @Override
    public Refund refund(String idempotencyKey, String paymentIntentId, long amountMinor,
            Map<String, String> metadata) {
        List<String[]> form = new ArrayList<>();
        form.add(new String[]{"payment_intent", paymentIntentId});
        form.add(new String[]{"amount", Long.toString(amountMinor)});
        metadata.forEach((k, v) -> form.add(new String[]{"metadata[" + k + "]", v}));
        try {
            return refundOf(call("POST", "/v1/refunds", form, idempotencyKey));
        } catch (StripeException e) {
            return new Refund(null, "FAILED", e.errorCode());
        }
    }

    @Override
    public Refund retrieveRefund(String refundId) {
        try {
            return refundOf(call("GET", "/v1/refunds/" + enc(refundId), null, null));
        } catch (StripeException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "PAYMENT_PROVIDER_ERROR");
        }
    }

    private static Intent intent(Map<String, Object> pi) {
        String summary = null;
        Map<String, Object> error = obj(pi.get("last_payment_error"));
        if (!error.isEmpty()) {
            summary = str(error.get("code"));
        }
        return new Intent(str(pi.get("id")), str(pi.get("client_secret")), str(pi.get("status")),
                lng(pi.get("amount")), upper(str(pi.get("currency"))), summary);
    }

    private static Refund refundOf(Map<String, Object> r) {
        String status = switch (String.valueOf(r.get("status"))) {
            case "succeeded" -> "SUCCEEDED";
            case "failed", "canceled" -> "FAILED";
            default -> "PENDING";
        };
        return new Refund(str(r.get("id")), status, str(r.get("failure_reason")));
    }

    private static String upper(String s) {
        return s == null ? null : s.toUpperCase();
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }
}
