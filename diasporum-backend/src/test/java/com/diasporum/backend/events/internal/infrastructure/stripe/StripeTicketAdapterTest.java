package com.diasporum.backend.events.internal.infrastructure.stripe;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.diasporum.backend.events.internal.application.ticketing.TicketingProperties;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

/** Stripe adapter against a local stub server (no network, no keys) + signature verification. */
class StripeTicketAdapterTest {

    private HttpServer server;
    private final List<String[]> requests = new CopyOnWriteArrayList<>(); // method, path, idem, body, auth

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            String path = exchange.getRequestURI().getPath();
            requests.add(new String[]{exchange.getRequestMethod(), path,
                exchange.getRequestHeaders().getFirst("Idempotency-Key"), body,
                exchange.getRequestHeaders().getFirst("Authorization")});
            String response;
            int status = 200;
            if (path.equals("/v1/payment_intents")) {
                response = "{\"id\":\"pi_1\",\"client_secret\":\"pi_1_secret\","
                        + "\"status\":\"requires_payment_method\",\"amount\":4500,\"currency\":\"eur\"}";
            } else if (path.equals("/v1/payment_intents/pi_1/cancel")) {
                status = 400;
                response = "{\"error\":{\"code\":\"payment_intent_unexpected_state\"}}";
            } else if (path.equals("/v1/payment_intents/pi_1")) {
                response = "{\"id\":\"pi_1\",\"status\":\"succeeded\",\"amount\":4500,\"currency\":\"eur\"}";
            } else if (path.equals("/v1/refunds")) {
                response = "{\"id\":\"re_1\",\"status\":\"pending\"}";
            } else {
                status = 404;
                response = "{\"error\":{\"code\":\"resource_missing\"}}";
            }
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private StripeTicketPaymentGateway gateway(String key) {
        return new StripeTicketPaymentGateway(new TicketingProperties(null, null, null,
                new TicketingProperties.Stripe(key, "whsec", "http://127.0.0.1:"
                        + server.getAddress().getPort())));
    }

    private static Map<String, String> form(String body) {
        return java.util.Arrays.stream(body.split("&")).map(p -> p.split("=", 2))
                .collect(java.util.stream.Collectors.toMap(
                        p -> URLDecoder.decode(p[0], StandardCharsets.UTF_8),
                        p -> URLDecoder.decode(p[1], StandardCharsets.UTF_8)));
    }

    @Test
    void paymentIntentOnPlatformAccountWithIdempotencyKeyAndMinorUnits() {
        var intent = gateway("sk_test_x").createPaymentIntent("ticket-order:abc", 4500, "EUR",
                Map.of("ticket_order_id", "abc"));
        assertEquals("pi_1", intent.id());
        assertEquals("pi_1_secret", intent.clientSecret());
        assertEquals("EUR", intent.currency());
        String[] req = requests.get(0);
        assertEquals("POST", req[0]);
        assertEquals("ticket-order:abc", req[2]);
        assertEquals("Bearer sk_test_x", req[4]);
        Map<String, String> f = form(req[3]);
        assertEquals("4500", f.get("amount"));
        assertEquals("eur", f.get("currency"));
        assertEquals("abc", f.get("metadata[ticket_order_id]"));
        // platform charge: no Connect destination or application fee
        assertTrue(f.keySet().stream().noneMatch(k -> k.startsWith("transfer_data")
                || k.startsWith("application_fee")));
    }

    @Test
    void cancelOfSucceededIntentReportsAuthoritativeStateAndRefundsMapStatus() {
        var g = gateway("sk_test_x");
        assertTrue(g.cancel("pi_1").succeeded());
        var refund = g.refund("ticket-refund:r1", "pi_1", 2000, Map.of());
        assertEquals("re_1", refund.id());
        assertEquals("PENDING", refund.status());
        String[] req = requests.stream().filter(r -> r[1].equals("/v1/refunds")).findFirst().get();
        assertEquals("ticket-refund:r1", req[2]);
        assertEquals("2000", form(req[3]).get("amount"));
    }

    @Test
    void unconfiguredGatewayFailsClosed() {
        var ex = assertThrows(ResponseStatusException.class,
                () -> gateway("").createPaymentIntent("k", 100, "EUR", Map.of()));
        assertEquals("PAYMENT_PROVIDER_UNAVAILABLE", ex.getReason());
        assertTrue(requests.isEmpty());
    }

    // =================== webhook signatures ===================

    private static final Instant NOW = Instant.parse("2026-11-16T12:00:00Z");

    private static StripeWebhookVerifier verifier() {
        return new StripeWebhookVerifier("whsec_unit", Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    void verifiesStripeV1Signatures() {
        String payload = "{\"id\":\"evt_1\",\"type\":\"payment_intent.succeeded\","
                + "\"data\":{\"object\":{\"id\":\"pi_9\"}}}";
        String header = StripeWebhookVerifier.signatureHeader("whsec_unit", NOW.getEpochSecond(), payload);
        var event = verifier().verify(payload, header);
        assertEquals("evt_1", event.id());
        assertEquals("pi_9", event.object().get("id"));
        // multiple v1 entries (secret rotation): any match passes
        assertEquals("evt_1", verifier().verify(payload, header + ",v1=00ff").id());
    }

    @Test
    void rejectsWrongSecretTamperingStaleAndMalformedHeaders() {
        String payload = "{\"id\":\"evt_1\",\"type\":\"x\"}";
        long t = NOW.getEpochSecond();
        for (String header : new String[]{
            StripeWebhookVerifier.signatureHeader("whsec_other", t, payload),
            StripeWebhookVerifier.signatureHeader("whsec_unit", t - 301, payload),
            "v1=abc", "t=notanumber,v1=abc", "garbage", null}) {
            var ex = assertThrows(ResponseStatusException.class, () -> verifier().verify(payload, header));
            assertEquals("WEBHOOK_SIGNATURE_INVALID", ex.getReason());
        }
        String good = StripeWebhookVerifier.signatureHeader("whsec_unit", t, payload);
        assertThrows(ResponseStatusException.class,
                () -> verifier().verify(payload.replace("x", "y"), good));
        assertThrows(ResponseStatusException.class,
                () -> new StripeWebhookVerifier("", Clock.systemUTC()).verify(payload, good));
    }
}
