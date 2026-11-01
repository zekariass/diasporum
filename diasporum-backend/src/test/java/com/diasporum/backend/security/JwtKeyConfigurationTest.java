package com.diasporum.backend.security;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.time.Duration;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Startup-time JWT key configuration rules: persistent keys required outside
 * local dev/tests, both halves required, and the configured pair must match.
 * Pure unit tests — no Spring context.
 */
class JwtKeyConfigurationTest {

    private static final String ISSUER = "https://api.diasporum.test";
    private static final String AUD = "diasporum-api";

    private static String[] pemPair() throws Exception {
        KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        KeyPair kp = gen.generateKeyPair();
        var enc = Base64.getMimeEncoder(64, "\n".getBytes());
        return new String[]{
            "-----BEGIN PRIVATE KEY-----\n" + enc.encodeToString(kp.getPrivate().getEncoded())
                    + "\n-----END PRIVATE KEY-----",
            "-----BEGIN PUBLIC KEY-----\n" + enc.encodeToString(kp.getPublic().getEncoded())
                    + "\n-----END PUBLIC KEY-----"};
    }

    private JwtService service(String priv, String pub, boolean allowEphemeral)
            throws Exception {
        return new JwtService(ISSUER, AUD, "test-1", Duration.ofMinutes(15),
                priv, pub, allowEphemeral);
    }

    @Test
    void missingKeysRejectedWhenEphemeralNotAllowed() {
        // staging/prod shape — no keys, no ephemeral opt-in → fail fast
        assertThrows(IllegalStateException.class,
                () -> service("", "", false));
    }

    @Test
    void singleKeyRejected() throws Exception {
        var pair = pemPair();
        assertThrows(IllegalStateException.class,
                () -> service(pair[0], "", false));
        assertThrows(IllegalStateException.class,
                () -> service("", pair[1], false));
    }

    @Test
    void mismatchedPairRejected() throws Exception {
        var a = pemPair();
        var b = pemPair();
        // private from pair A, public from pair B — must not start
        assertThrows(IllegalStateException.class,
                () -> service(a[0], b[1], false));
    }

    @Test
    void configuredPairIssuesAndVerifiesTokens() throws Exception {
        var pair = pemPair();
        var svc = service(pair[0], pair[1], false);
        var sid = UUID.randomUUID();
        var token = svc.issue(UUID.randomUUID(), sid);
        var validated = svc.validate(token.token());
        assertNotNull(validated);
        assertNotNull(svc.jwks().get("keys"));
    }

    @Test
    void ephemeralPairWorksOnlyWhenExplicitlyAllowed() throws Exception {
        var svc = service("", "", true);
        var token = svc.issue(UUID.randomUUID(), UUID.randomUUID());
        assertNotNull(svc.validate(token.token()));
    }
}
