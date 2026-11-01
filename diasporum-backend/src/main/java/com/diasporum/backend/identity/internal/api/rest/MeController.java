package com.diasporum.backend.identity.internal.api.rest;

import com.diasporum.backend.identity.IdentityApi;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * /me endpoint — returns the current authenticated user's profile.
 * Uses IdentityApi.profileSummary — profiles.id == users.id, so no separate lookup needed.
 */
@RestController
@RequestMapping("/api/v1")
public class MeController {

    private final IdentityApi identity;

    public MeController(IdentityApi identity) { this.identity = identity; }

    @GetMapping("/me")
    public ResponseEntity<MeResponse> me(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        return identity.profileSummary(principal.userId())
            .map(p -> ResponseEntity.ok(new MeResponse(p.id(), p.displayName(),
                    p.accountStatus(), p.profileCompleted())))
            .orElse(ResponseEntity.notFound().build());
    }

    public record MeResponse(java.util.UUID id, String displayName,
            String accountStatus, boolean profileCompleted) {}
}
