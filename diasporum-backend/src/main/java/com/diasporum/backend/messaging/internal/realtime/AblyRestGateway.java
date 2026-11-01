package com.diasporum.backend.messaging.internal.realtime;

import io.ably.lib.rest.AblyRest;
import io.ably.lib.rest.Auth.TokenParams;
import io.ably.lib.rest.Auth.TokenRequest;
import io.ably.lib.types.AblyException;
import io.ably.lib.types.ClientOptions;
import java.util.Map;
import tools.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * REST-only Ably gateway — the server never opens realtime sockets; it only
 * publishes and signs token requests. The {@link AblyRest} client is created
 * lazily so the app boots cleanly with realtime disabled.
 */
@Component
class AblyRestGateway implements AblyGateway {

    private static final Logger log =
            LoggerFactory.getLogger(AblyRestGateway.class);

    private final AblyProperties props;
    private final ObjectMapper mapper = new ObjectMapper();
    private volatile AblyRest rest;

    AblyRestGateway(AblyProperties props) {
        this.props = props;
    }

    @Override
    public boolean isUsable() {
        return props.usable();
    }

    private AblyRest rest() {
        if (rest == null) {
            synchronized (this) {
                if (rest == null) {
                    try {
                        rest = new AblyRest(new ClientOptions(props.apiKey()));
                    } catch (AblyException e) {
                        throw new IllegalStateException(
                                "Ably client init failed", e);
                    }
                }
            }
        }
        return rest;
    }

    @Override
    public void publish(String channel, String eventName,
            Map<String, Object> data) throws AblyPublishException {
        try {
            rest().channels.get(channel)
                    .publish(eventName, mapper.writeValueAsString(data));
        } catch (Exception e) {
            throw new AblyPublishException(
                    "publish to " + channel + " failed: " + e.getMessage(), e);
        }
    }

    @Override
    @SuppressWarnings("unchecked")
    public Map<String, Object> createTokenRequest(String clientId,
            String capabilityJson, long ttlMillis) {
        TokenParams params = new TokenParams();
        params.clientId = clientId;
        params.capability = capabilityJson;
        params.ttl = ttlMillis;
        try {
            TokenRequest tr = rest().auth.createTokenRequest(params, null);
            // keyName/ttl/capability/clientId/timestamp/nonce/mac — exactly
            // the JSON shape the client SDK's authCallback must hand back.
            return mapper.readValue(tr.asJson(), Map.class);
        } catch (Exception e) {
            log.warn("token request signing failed", e);
            throw new IllegalStateException("ABLY_TOKEN_SIGNING_FAILED", e);
        }
    }
}
