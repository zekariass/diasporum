package com.diasporum.backend.sparebag.internal.application.v2;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * v10.15 Spare Bag configuration ({@code diasporum.spare-bag.v2.*}).
 * {@code moderationMode} MANUAL (default) routes publishes through
 * PENDING_REVIEW; AUTO_APPROVE publishes directly (local dev, like the shop's
 * {@code diasporum.shop.moderation-mode}). {@code requestDefaultTtl} is applied
 * as {@code closes_at} to sender requests published without one.
 */
@ConfigurationProperties(prefix = "diasporum.spare-bag.v2")
public record SpareBagV2Properties(String moderationMode, Duration requestDefaultTtl) {

    public SpareBagV2Properties {
        moderationMode = moderationMode == null || moderationMode.isBlank()
                ? "MANUAL" : moderationMode.trim().toUpperCase();
        requestDefaultTtl = requestDefaultTtl == null ? Duration.ofDays(30) : requestDefaultTtl;
    }

    public boolean autoApprove() {
        return "AUTO_APPROVE".equals(moderationMode);
    }

    @Configuration
    @EnableConfigurationProperties(SpareBagV2Properties.class)
    static class SpareBagV2Configuration {
    }
}
