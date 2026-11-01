package com.diasporum.backend.messaging.internal.realtime;

import com.diasporum.backend.identity.IdentityApi;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * Issues Ably token requests scoped to the authenticated user.
 *
 * <p>Authorization model: realtime events fan out per-participant over
 * {@code user:{userId}} channels, so the only capability a client can ever
 * obtain is {@code subscribe} on its own channel. There is deliberately no
 * parameter for channel names — a client cannot ask for another user's
 * channel or a conversation channel, and business acting adds nothing
 * (business events arrive on the acting member's own channel). Conversation
 * access itself is still enforced by the REST API and the publish-side
 * participant resolution, never by the channel name.
 */
@Service
public class RealtimeTokenService {

    private final AblyGateway ably;
    private final AblyProperties props;
    private final IdentityApi identity;

    public RealtimeTokenService(AblyGateway ably, AblyProperties props,
            IdentityApi identity) {
        this.ably = ably;
        this.props = props;
        this.identity = identity;
    }

    /** Channel an authenticated user may subscribe to — always their own. */
    public static String channelFor(UUID userId) {
        return "user:" + userId;
    }

    /**
     * Signed Ably token request (keyName/ttl/capability/clientId/timestamp/
     * nonce/mac) for the client SDK to exchange. Requires an ACTIVE account;
     * realtime never elevates a suspended user.
     */
    public Map<String, Object> tokenRequest(UUID actor) {
        if (!ably.isUsable()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "REALTIME_UNAVAILABLE");
        }
        var p = identity.profileSummary(actor)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));
        if (!"ACTIVE".equals(p.accountStatus())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "ACCOUNT_NOT_ACTIVE");
        }
        String capability = "{\"" + channelFor(actor)
                + "\":[\"subscribe\"]}";
        return ably.createTokenRequest(actor.toString(), capability,
                props.tokenTtl().toMillis());
    }
}
