package com.diasporum.backend.messaging.internal.realtime;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Outbox dispatch settings ({@code diasporum.messaging.outbox.*}). Defaults
 * are pinned in the compact constructor so an unset property can never
 * silently disable the publisher.
 */
@ConfigurationProperties(prefix = "diasporum.messaging.outbox")
public record OutboxProperties(
        /** Delay between dispatch cycles. */
        Duration pollInterval,
        /** Max events claimed per cycle. */
        int batchSize,
        /** Attempts before an event is parked (left unpublished for ops). */
        int maxAttempts,
        /** Base retry delay; grows linearly with attempt count. */
        Duration retryBackoff,
        /** A claim older than this is treated as stale (worker died mid-batch)
         * and the event becomes claimable again. */
        Duration lockTimeout) {

    public OutboxProperties {
        if (pollInterval == null || pollInterval.isNegative()
                || pollInterval.isZero()) {
            pollInterval = Duration.ofSeconds(2);
        }
        if (batchSize <= 0) {
            batchSize = 50;
        }
        if (maxAttempts <= 0) {
            maxAttempts = 8;
        }
        if (retryBackoff == null || retryBackoff.isNegative()
                || retryBackoff.isZero()) {
            retryBackoff = Duration.ofSeconds(10);
        }
        if (lockTimeout == null || lockTimeout.isNegative()
                || lockTimeout.isZero()) {
            lockTimeout = Duration.ofMinutes(2);
        }
    }
}
