package com.diasporum.backend.messaging.internal.realtime;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Ably connection + token-issuance settings ({@code diasporum.ably.*}).
 *
 * <p>The API key is server-side only — it is never shipped to clients; the
 * mobile app receives short-lived signed token requests from
 * {@code POST /api/v1/realtime/token} instead. When {@code enabled=false}
 * (or no key is configured) realtime is inert: outbox rows stay queued and
 * the token endpoint answers {@code 503 REALTIME_UNAVAILABLE}, so the REST
 * messaging API keeps working without an Ably account.
 */
@ConfigurationProperties(prefix = "diasporum.ably")
public record AblyProperties(
        /** Master or publish+token-revocation key ({@code appId.keyId:secret}).
         * Loaded from {@code ABLY_API_KEY}; never committed. */
        String apiKey,
        /** Master switch — keeps realtime off in environments without keys. */
        boolean enabled,
        /** Lifetime of issued tokens; the client SDK renews via authCallback. */
        Duration tokenTtl) {

    public AblyProperties {
        if (tokenTtl == null || tokenTtl.isZero() || tokenTtl.isNegative()) {
            tokenTtl = Duration.ofHours(1);
        }
    }

    /** Realtime is only usable when enabled *and* a key is present. */
    public boolean usable() {
        return enabled && apiKey != null && !apiKey.isBlank();
    }
}
