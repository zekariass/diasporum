package com.diasporum.backend.shopmarketplace.internal.api.rest;

import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.forbidden;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.unavailable;

import com.diasporum.backend.shopmarketplace.internal.application.PaymentService;
import com.diasporum.backend.shopmarketplace.internal.application.SellerOrderService;
import com.diasporum.backend.shopmarketplace.internal.application.ShippingProvider;
import com.diasporum.backend.shopmarketplace.internal.application.ShippingProvider.TrackingUpdate;
import com.diasporum.backend.shopmarketplace.internal.application.ShopProperties;
import com.diasporum.backend.shopmarketplace.internal.application.ShopSupport;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Provider webhooks — unauthenticated endpoints (permitAll) that prove authenticity by
 * signature/token verification inside the services, never by trusting the network.
 */
@RestController
@RequestMapping("/api/v1/shop/webhooks")
public class ShopWebhookController {
    private final PaymentService payments;
    private final SellerOrderService sellerOrders;
    private final List<ShippingProvider> shippingProviders;
    private final ShopProperties properties;
    private final JdbcTemplate jdbc;

    public ShopWebhookController(PaymentService payments, SellerOrderService sellerOrders,
            List<ShippingProvider> shippingProviders, ShopProperties properties,
            ShopSupport support) {
        this.payments = payments;
        this.sellerOrders = sellerOrders;
        this.shippingProviders = shippingProviders;
        this.properties = properties;
        this.jdbc = support.jdbc();
    }

    /**
     * Stripe webhook. {@code PaymentService} verifies the Stripe-Signature header, persists
     * the event idempotently, and answers 2xx only after successful processing.
     */
    @PostMapping("/stripe")
    public ResponseEntity<Map<String, String>> stripe(@RequestBody String payload,
            @RequestHeader(name = "Stripe-Signature", required = false) String signature) {
        payments.handleWebhook(payload, signature);
        return ResponseEntity.ok(Map.of("status", "received"));
    }

    /**
     * Shippo tracking webhook. Shippo does not sign payloads, so the configured webhook URL
     * carries a shared-secret token; a wrong/absent token is rejected without processing.
     * The update is deduplicated on provider event ids.
     */
    @PostMapping("/shippo")
    public ResponseEntity<Map<String, String>> shippo(@RequestBody Map<String, Object> payload,
            @RequestParam(name = "token", required = false) String token) {
        String expected = properties.shippo().webhookToken();
        if (expected == null || expected.isBlank()) {
            throw unavailable("SHIPPING_WEBHOOK_NOT_CONFIGURED");
        }
        if (token == null || !MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),
                token.getBytes(StandardCharsets.UTF_8))) {
            throw forbidden("INVALID_WEBHOOK_TOKEN");
        }
        ShippingProvider shippo = shippingProviders.stream()
                .filter(p -> p.key().equals("SHIPPO")).findFirst().orElse(null);
        if (shippo == null || !shippo.available()) {
            throw unavailable("SHIPPING_PROVIDER_UNAVAILABLE");
        }
        TrackingUpdate update = shippo.parseTrackingWebhook(payload);
        if (update != null && update.trackingNumber() != null) {
            String eventId = payload.get("event_id") == null
                    ? "tracking:" + update.trackingNumber() + ":" + update.status()
                    : String.valueOf(payload.get("event_id"));
            int inserted = jdbc.update("INSERT INTO marketplace_webhook_events(provider_key,"
                    + "external_event_id,event_type,payload,signature_verified,processing_status) "
                    + "VALUES('SHIPPO',?,?,?::jsonb,true,'PROCESSED') ON CONFLICT(provider_key,"
                    + "external_event_id) DO NOTHING", eventId, "track.updated",
                    ShopSupport.json(payload));
            if (inserted > 0) {
                sellerOrders.applyTrackingUpdate(update);
            }
        }
        return ResponseEntity.ok(Map.of("status", "received"));
    }
}
