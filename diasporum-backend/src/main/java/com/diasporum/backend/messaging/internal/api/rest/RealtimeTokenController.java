package com.diasporum.backend.messaging.internal.api.rest;

import com.diasporum.backend.messaging.internal.realtime.RealtimeTokenService;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Ably auth endpoint — returns a signed, short-lived token request scoped to
 * the caller's own {@code user:{id}} channel. No request parameters: clients
 * can never choose channels or capabilities.
 */
@RestController
@RequestMapping("/api/v1/realtime")
public class RealtimeTokenController {

    private final RealtimeTokenService service;

    public RealtimeTokenController(RealtimeTokenService service) {
        this.service = service;
    }

    /** Ably authCallback target — exchange for a token with Ably. */
    @PostMapping("/token")
    public Map<String, Object> token(
            @AuthenticationPrincipal DiasporumUserPrincipal principal) {
        return service.tokenRequest(principal.userId());
    }
}
