package com.diasporum.backend.shopmarketplace.internal.application;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Shop Marketplace operational configuration. Provider secrets are injected from the
 * environment only and never returned to clients.
 */
@ConfigurationProperties(prefix = "diasporum.shop")
public record ShopProperties(
        /** MANUAL keeps products/shops/sellers in PENDING_REVIEW until moderated; AUTO_APPROVE is for local/dev. */
        String moderationMode,
        boolean reviewsAutoPublish,
        Duration reservationTtl,
        Duration quoteTtl,
        String paymentReturnUrl,
        String paymentCancelUrl,
        String connectReturnUrl,
        String connectRefreshUrl,
        String taxEnvironment,
        Stripe stripe,
        Shippo shippo) {

    public ShopProperties {
        moderationMode = moderationMode == null ? "MANUAL" : moderationMode.toUpperCase();
        reservationTtl = reservationTtl == null ? Duration.ofMinutes(30) : reservationTtl;
        quoteTtl = quoteTtl == null ? Duration.ofMinutes(30) : quoteTtl;
        taxEnvironment = taxEnvironment == null ? "TEST" : taxEnvironment.toUpperCase();
        stripe = stripe == null ? new Stripe(null, null, null, null) : stripe;
        shippo = shippo == null ? new Shippo(null, null, null) : shippo;
    }

    public boolean autoApprove() {
        return "AUTO_APPROVE".equals(moderationMode);
    }

    public record Stripe(String secretKey, String webhookSecret, String apiBase, String connectAccountType) {
        public boolean configured() {
            return secretKey != null && !secretKey.isBlank();
        }

        public String base() {
            return apiBase == null || apiBase.isBlank() ? "https://api.stripe.com" : apiBase;
        }

        public String accountType() {
            return connectAccountType == null || connectAccountType.isBlank() ? "express"
                    : connectAccountType.toLowerCase();
        }
    }

    public record Shippo(String apiToken, String webhookToken, String apiBase) {
        public boolean configured() {
            return apiToken != null && !apiToken.isBlank();
        }

        public String base() {
            return apiBase == null || apiBase.isBlank() ? "https://api.goshippo.com" : apiBase;
        }
    }

    @Configuration
    @EnableConfigurationProperties(ShopProperties.class)
    static class ShopConfiguration {
    }
}
