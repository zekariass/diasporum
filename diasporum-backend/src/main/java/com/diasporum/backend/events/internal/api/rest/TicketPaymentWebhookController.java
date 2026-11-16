package com.diasporum.backend.events.internal.api.rest;

import com.diasporum.backend.events.internal.application.ticketing.TicketPaymentWebhookService;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Stripe webhook for ticket payments (platform account). Unauthenticated at the
 * HTTP layer — authenticity is the Stripe-Signature HMAC over the raw body,
 * which is why the body is taken as an untouched String.
 */
@RestController
@RequestMapping("/api/v1/webhooks")
public class TicketPaymentWebhookController {

    private final TicketPaymentWebhookService webhooks;

    public TicketPaymentWebhookController(TicketPaymentWebhookService webhooks) {
        this.webhooks = webhooks;
    }

    @PostMapping("/ticket-payments")
    public ResponseEntity<Map<String, String>> ticketPayments(@RequestBody String payload,
            @RequestHeader(name = "Stripe-Signature", required = false) String signature) {
        return ResponseEntity.ok(Map.of("status", webhooks.handle(payload, signature)));
    }
}
