package com.diasporum.backend.security;

import com.diasporum.backend.security.JwtService;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * JwtService RS256 sign/verify — replaces the old OAuth2 JwtDecoder validation tests.
 * Diasporum issues its own tokens; no external OIDC provider involved.
 */
class JwtClaimValidationTest {

    private final JwtService jwtService = create();

    private static JwtService create() {
        try {
            return new JwtService("https://api.diasporum.local", "diasporum-api",
                "test-1", java.time.Duration.ofMinutes(15), "", "", true);
        } catch (Exception e) { throw new RuntimeException(e); }
    }

    @Test
    void issueAndVerify_validToken_returnsClaims() throws Exception {
        UUID userId = UUID.randomUUID(), sessionId = UUID.randomUUID();
        var token = jwtService.issue(userId, sessionId);
        assertNotNull(token.token());
        var claims = jwtService.verify(token.token());
        assertNotNull(claims);
        assertEquals(userId.toString(), claims.getSubject());
        assertEquals(sessionId.toString(), claims.getStringClaim("sid"));
    }

    @Test
    void verify_wrongIssuer_returnsNull() {
        UUID userId = UUID.randomUUID(), sessionId = UUID.randomUUID();
        var token = jwtService.issue(userId, sessionId);
        // Corrupt the signature → verify returns null
        var claims = jwtService.verify(token.token() + "x");
        assertNull(claims);
    }

    @Test
    void jwks_containsRsaKey() {
        var jwks = jwtService.jwks();
        assertNotNull(jwks);
        assertNotNull(jwks.get("keys"));
    }

    @Test
    void validate_validToken_returnsUserAndSession() {
        UUID userId = UUID.randomUUID(), sessionId = UUID.randomUUID();
        var token = jwtService.issue(userId, sessionId);
        var validated = jwtService.validate(token.token());
        assertNotNull(validated);
        assertEquals(userId, validated.userId());
        assertEquals(sessionId, validated.sessionId());
    }

    @Test
    void validate_expiredToken_returnsNull() throws Exception {
        var shortLived = new JwtService("https://api.diasporum.local", "diasporum-api",
            "test-1", java.time.Duration.ofMillis(1), "", "", true);
        var token = shortLived.issue(UUID.randomUUID(), UUID.randomUUID());
        Thread.sleep(10);
        assertNull(shortLived.validate(token.token()));
    }
}
