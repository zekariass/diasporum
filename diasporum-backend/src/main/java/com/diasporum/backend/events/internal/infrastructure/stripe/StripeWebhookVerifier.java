package com.diasporum.backend.events.internal.infrastructure.stripe;

import static com.diasporum.backend.events.internal.infrastructure.stripe.StripeHttp.obj;
import static com.diasporum.backend.events.internal.infrastructure.stripe.StripeHttp.str;

import com.diasporum.backend.events.internal.application.ticketing.TicketingProperties;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Stripe webhook signature verification (scheme v1: HMAC-SHA256 over
 * {@code timestamp + "." + rawBody}, constant-time compare, 300 s tolerance).
 * Nothing in the payload is trusted until this passes.
 */
@Component
public class StripeWebhookVerifier {
    static final long TOLERANCE_SECONDS = 300;

    private final String secret;
    private final Clock clock;

    @org.springframework.beans.factory.annotation.Autowired
    public StripeWebhookVerifier(TicketingProperties properties) {
        this(properties.stripe().webhookSecret(), Clock.systemUTC());
    }

    StripeWebhookVerifier(String secret, Clock clock) {
        this.secret = secret;
        this.clock = clock;
    }

    /** A verified event: id, type and the {@code data.object} map. */
    public record VerifiedEvent(String id, String type, Map<String, Object> object) {
    }

    public VerifiedEvent verify(String payload, String signatureHeader) {
        if (secret == null || secret.isBlank() || signatureHeader == null || payload == null) {
            throw invalid();
        }
        String timestamp = null;
        List<String> signatures = new ArrayList<>();
        for (String part : signatureHeader.split(",")) {
            String[] kv = part.trim().split("=", 2);
            if (kv.length == 2 && "t".equals(kv[0])) {
                timestamp = kv[1];
            } else if (kv.length == 2 && "v1".equals(kv[0])) {
                signatures.add(kv[1]);
            }
        }
        if (timestamp == null || signatures.isEmpty()) {
            throw invalid();
        }
        long ts;
        try {
            ts = Long.parseLong(timestamp);
        } catch (NumberFormatException e) {
            throw invalid();
        }
        if (Math.abs(clock.instant().getEpochSecond() - ts) > TOLERANCE_SECONDS) {
            throw invalid();
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
            throw invalid();
        }
        Map<String, Object> event = StripeHttp.parse(payload);
        String id = str(event.get("id"));
        String type = str(event.get("type"));
        if (id == null || type == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "WEBHOOK_PAYLOAD_INVALID");
        }
        return new VerifiedEvent(id, type, obj(obj(event.get("data")).get("object")));
    }

    /** Signs a payload the way Stripe does; used by tests and local tooling. */
    public static String signatureHeader(String secret, long timestamp, String payload) {
        return "t=" + timestamp + ",v1="
                + HexFormat.of().formatHex(hmac(secret, timestamp + "." + payload));
    }

    static byte[] hmac(String secret, String value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return mac.doFinal(value.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException("HMAC unavailable", e);
        }
    }

    private static ResponseStatusException invalid() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "WEBHOOK_SIGNATURE_INVALID");
    }
}
