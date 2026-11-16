package com.diasporum.backend.events.internal.application.ticketing;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Event ticketing configuration ({@code diasporum.events.ticketing.*}). Stripe
 * credentials are the platform account's — buyers pay Diasporum, organisers are
 * paid out manually from the ledger, so no Connect account is involved. Every
 * secret is env-only (see application.yaml); blank values make the payment
 * gateway and the payout cipher fail closed.
 */
@ConfigurationProperties(prefix = "diasporum.events.ticketing")
public record TicketingProperties(Duration reservationTtl, Duration paymentTtl,
        String payoutDataKey, Stripe stripe) {

    public TicketingProperties {
        reservationTtl = reservationTtl == null ? Duration.ofMinutes(15) : reservationTtl;
        paymentTtl = paymentTtl == null ? Duration.ofMinutes(15) : paymentTtl;
        stripe = stripe == null ? new Stripe(null, null, null) : stripe;
    }

    /** Platform Stripe account; webhook secret is per endpoint (ticket payments). */
    public record Stripe(String secretKey, String webhookSecret, String apiBase) {

        public boolean configured() {
            return secretKey != null && !secretKey.isBlank();
        }

        public String base() {
            return apiBase == null || apiBase.isBlank() ? "https://api.stripe.com" : apiBase;
        }
    }

    @Configuration
    @EnableConfigurationProperties(TicketingProperties.class)
    static class TicketingConfiguration {
    }
}
