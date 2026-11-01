package com.diasporum.backend.messaging.internal.realtime;

import java.util.Map;

/**
 * Narrow Ably surface used by the messaging module — keeps Ably SDK types
 * out of callers so tests can stub publishing without an Ably account.
 */
public interface AblyGateway {

    /** True when realtime is enabled and credentials are configured. */
    boolean isUsable();

    /**
     * Publish {@code data} as {@code eventName} on {@code channel}.
     * Throws {@link AblyPublishException} on any transport failure — callers
     * must treat a failure as "not delivered" and keep the outbox row.
     */
    void publish(String channel, String eventName, Map<String, Object> data)
            throws AblyPublishException;

    /**
     * Signed Ably token request the client SDK exchanges for a token.
     * Returns the TokenRequest fields as a map ready for JSON serialization.
     */
    Map<String, Object> createTokenRequest(String clientId,
            String capabilityJson, long ttlMillis);

    /** Publication failed — the event remains unpublished and retryable. */
    class AblyPublishException extends RuntimeException {
        public AblyPublishException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
