package com.diasporum.backend.identity;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * Google/Apple external-identity verification + account linking against a real
 * v10.12 database, using controlled provider fixtures: a local JWKS server
 * publishes test RSA keys and the test signs provider-shaped ID tokens itself.
 * No live Google/Apple credentials required.
 */
@SpringBootTest
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
@SuppressWarnings("resource") // container lifecycle managed by @Testcontainers
class ExternalIdentityIntegrationTest {

    private static final String GOOGLE_ISS = "https://accounts.google.com";
    private static final String APPLE_ISS = "https://appleid.apple.com";
    private static final String GOOGLE_AUD = "test-google-client";
    private static final String APPLE_AUD = "test-apple-client";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    private static java.security.KeyPair googleKeyPair;
    private static java.security.KeyPair appleKeyPair;
    private static HttpServer jwksServer;

    static {
        try {
            var gen = KeyPairGenerator.getInstance("RSA");
            gen.initialize(2048);
            googleKeyPair = gen.generateKeyPair();
            appleKeyPair = gen.generateKeyPair();

            RSAKey googleJwk = new RSAKey.Builder((RSAPublicKey) googleKeyPair.getPublic())
                    .keyID("google-test-1").build();
            RSAKey appleJwk = new RSAKey.Builder((RSAPublicKey) appleKeyPair.getPublic())
                    .keyID("apple-test-1").build();

            jwksServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            jwksServer.createContext("/google/jwks.json", ex -> respond(ex,
                new JWKSet(googleJwk).toJSONObject().toString()));
            jwksServer.createContext("/apple/jwks.json", ex -> respond(ex,
                new JWKSet(appleJwk).toJSONObject().toString()));
            jwksServer.start();
        } catch (Exception e) { throw new ExceptionInInitializerError(e); }
    }

    private static void respond(com.sun.net.httpserver.HttpExchange ex, String body)
            throws java.io.IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json");
        ex.sendResponseHeaders(200, bytes.length);
        ex.getResponseBody().write(bytes);
        ex.close();
    }

    @DynamicPropertySource
    static void jwksProperties(DynamicPropertyRegistry r) {
        String base = "http://127.0.0.1:" + jwksServer.getAddress().getPort();
        r.add("diasporum.auth.google.jwks-url", () -> base + "/google/jwks.json");
        r.add("diasporum.auth.apple.jwks-url", () -> base + "/apple/jwks.json");
        r.add("diasporum.auth.google.client-ids", () -> GOOGLE_AUD);
        r.add("diasporum.auth.apple.client-id", () -> APPLE_AUD);
    }

    @AfterAll
    static void stopServer() { if (jwksServer != null) jwksServer.stop(0); }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String PASSWORD = "a-very-secure-password-15";

    @BeforeEach
    void clean() {
        for (String t : new String[]{"user_refresh_tokens", "user_sessions",
                "email_verification_tokens", "password_reset_tokens",
                "external_identities", "user_credentials", "profiles", "users"})
            jdbc.update("DELETE FROM " + t);
    }

    // ---- helpers ----

    private String googleToken(String sub, String email, boolean verified) throws Exception {
        return sign(googleKeyPair, "google-test-1", GOOGLE_ISS, GOOGLE_AUD, sub, email, verified, false);
    }

    private String appleToken(String sub, String email, boolean verified) throws Exception {
        // Apple sends email_verified as the string "true"/"false", not a JSON boolean
        return sign(appleKeyPair, "apple-test-1", APPLE_ISS, APPLE_AUD, sub, email,
                verified ? "true" : "false", false);
    }

    private String sign(java.security.KeyPair keyPair, String kid, String iss, String aud, String sub,
            String email, Object emailVerifiedClaim, boolean expired) throws Exception {
        var claims = new JWTClaimsSet.Builder()
                .issuer(iss).subject(sub).audience(aud)
                .issueTime(new Date())
                .expirationTime(Date.from(Instant.now().plusSeconds(expired ? -60 : 300)));
        if (email != null) claims.claim("email", email);
        claims.claim("email_verified", emailVerifiedClaim);
        var jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(kid).build(),
                claims.build());
        jwt.sign(new RSASSASigner(keyPair.getPrivate()));
        return jwt.serialize();
    }

    private JsonNode externalLogin(String provider, String idToken) throws Exception {
        MvcResult r = mvc.perform(post("/api/v1/auth/" + provider)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idToken\":\"" + idToken + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").exists())
                .andExpect(jsonPath("$.refreshToken").exists())
                .andReturn();
        return JSON.readTree(r.getResponse().getContentAsString());
    }

    private UUID registerPasswordUser(String email) throws Exception {
        MvcResult r = mvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isCreated()).andReturn();
        return UUID.fromString(JSON.readTree(r.getResponse().getContentAsString()).get("userId").asString());
    }

    private JsonNode passwordLogin(String email) throws Exception {
        MvcResult r = mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isOk()).andReturn();
        return JSON.readTree(r.getResponse().getContentAsString());
    }

    private String statusOf(UUID userId) {
        return jdbc.queryForObject("SELECT account_status FROM users WHERE id=?", String.class, userId);
    }

    private int externalIdentitiesFor(UUID userId) {
        Integer n = jdbc.queryForObject(
                "SELECT count(*) FROM external_identities WHERE user_id=?", Integer.class, userId);
        return n == null ? 0 : n;
    }

    // ---- provider login ----

    @Test
    void googleNewVerifiedEmailCreatesActiveAccountAndSession() throws Exception {
        String token = googleToken("g-sub-1", "newuser@diasporum.test", true);
        JsonNode res = externalLogin("google", token);
        UUID userId = UUID.fromString(res.get("userId").asString());

        assertEquals("ACTIVE", statusOf(userId));
        assertNotNull(jdbc.queryForObject(
                "SELECT email_verified_at FROM users WHERE id=?", java.sql.Timestamp.class, userId));
        assertEquals(1, externalIdentitiesFor(userId));
        String method = jdbc.queryForObject(
                "SELECT authentication_method FROM user_sessions WHERE id=?",
                String.class, UUID.fromString(res.get("sessionId").asString()));
        assertEquals("GOOGLE", method);
    }

    @Test
    void googleExistingIdentityResolvesToSameAccount() throws Exception {
        String token = googleToken("g-sub-repeat", "repeat@diasporum.test", true);
        JsonNode first = externalLogin("google", token);
        JsonNode second = externalLogin("google", token);
        assertEquals(first.get("userId").asString(), second.get("userId").asString());
        // last_login_at updated
        assertNotNull(jdbc.queryForObject(
                "SELECT last_login_at FROM external_identities WHERE issuer=? AND subject=?",
                java.sql.Timestamp.class, GOOGLE_ISS, "g-sub-repeat"));
    }

    @Test
    void googleVerifiedEmailMatchingExistingPasswordAccountLinks() throws Exception {
        String e = "linked@diasporum.test";
        UUID userId = registerPasswordUser(e);
        // account is ACTIVE via direct verify (bypassing email here — password user verified in DB)
        jdbc.update("UPDATE users SET account_status='ACTIVE',email_verified_at=now() WHERE id=?", userId);

        JsonNode res = externalLogin("google", googleToken("g-link-1", e, true));
        assertEquals(userId.toString(), res.get("userId").asString());
        assertEquals(1, externalIdentitiesFor(userId));
    }

    @Test
    void googleVerifiedEmailMatchingPendingAccountLinksAndActivates() throws Exception {
        String e = "pending@diasporum.test";
        UUID userId = registerPasswordUser(e);
        // Registration activates directly now — simulate a legacy pending account.
        jdbc.update("UPDATE users SET account_status='PENDING_VERIFICATION' WHERE id=?", userId);
        assertEquals("PENDING_VERIFICATION", statusOf(userId));

        // provider-verified email proves ownership → link + activate instead of
        // duplicate INSERT (which would hit ux_users_email_normalized → 500)
        JsonNode res = externalLogin("google", googleToken("g-pending-1", e, true));
        assertEquals(userId.toString(), res.get("userId").asString());
        assertEquals("ACTIVE", statusOf(userId));
        assertEquals(1, externalIdentitiesFor(userId));
    }

    @Test
    void googleDifferentEmailCreatesSeparateAccount() throws Exception {
        String e1 = "first@diasporum.test";
        registerPasswordUser(e1);
        jdbc.update("UPDATE users SET account_status='ACTIVE' WHERE email_normalized=?", e1);

        JsonNode res = externalLogin("google", googleToken("g-other", "second@diasporum.test", true));
        assertNotNull(res.get("userId"));
        Integer users = jdbc.queryForObject("SELECT count(*) FROM users", Integer.class);
        assertEquals(2, users);
    }

    @Test
    void googleUnverifiedEmailRejected() throws Exception {
        mvc.perform(post("/api/v1/auth/google").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idToken\":\"" + googleToken("g-unver", "unver@diasporum.test", false) + "\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("EMAIL_NOT_VERIFIED"));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM users", Integer.class).intValue());
    }

    @Test
    void invalidAudienceAndExpiredProviderTokensRejected() throws Exception {
        // wrong audience
        String badAud = sign(googleKeyPair, "google-test-1", GOOGLE_ISS, "someone-elses-client",
                "g-aud", "a@b.io", true, false);
        mvc.perform(post("/api/v1/auth/google").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idToken\":\"" + badAud + "\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_EXTERNAL_TOKEN"));
        // expired
        String exp = sign(googleKeyPair, "google-test-1", GOOGLE_ISS, GOOGLE_AUD, "g-exp", "a@b.io", true, true);
        mvc.perform(post("/api/v1/auth/google").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idToken\":\"" + exp + "\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_EXTERNAL_TOKEN"));
        // token signed by apple key presented to google endpoint → wrong kid → 401
        mvc.perform(post("/api/v1/auth/google").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idToken\":\"" + sign(appleKeyPair, "apple-test-1", GOOGLE_ISS, GOOGLE_AUD,
                                "g-wrong", "a@b.io", true, false) + "\"}"))
                .andExpect(status().isUnauthorized());
        // garbage token
        mvc.perform(post("/api/v1/auth/google").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idToken\":\"not.a.jwt\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void applePrivateRelayEmailCreatesAccount() throws Exception {
        String relayEmail = "abc123@privaterelay.appleid.com";
        JsonNode res = externalLogin("apple", appleToken("apple-sub-1", relayEmail, true));
        UUID userId = UUID.fromString(res.get("userId").asString());
        assertEquals("ACTIVE", statusOf(userId));
        assertEquals(1, externalIdentitiesFor(userId));
        String method = jdbc.queryForObject(
                "SELECT authentication_method FROM user_sessions WHERE id=?",
                String.class, UUID.fromString(res.get("sessionId").asString()));
        assertEquals("APPLE", method);
    }

    // ---- explicit linking / unlinking ----

    @Test
    void linkGoogleToAuthenticatedAccountAndPreventDoubleLinking() throws Exception {
        String e = "linker@diasporum.test";
        UUID userId = registerPasswordUser(e);
        jdbc.update("UPDATE users SET account_status='ACTIVE' WHERE id=?", userId);
        JsonNode session = passwordLogin(e);
        String at = session.get("accessToken").asString();

        // link google identity (different email is fine — explicit user action)
        mvc.perform(post("/api/v1/auth/link/google").header("Authorization", "Bearer " + at)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idToken\":\"" + googleToken("g-linked", e, true) + "\"}"))
                .andExpect(status().isNoContent());
        assertEquals(1, externalIdentitiesFor(userId));

        // second user tries to link the SAME external identity → 409
        String e2 = "linker2@diasporum.test";
        registerPasswordUser(e2);
        jdbc.update("UPDATE users SET account_status='ACTIVE' WHERE email_normalized=?", e2);
        JsonNode s2 = passwordLogin(e2);
        mvc.perform(post("/api/v1/auth/link/google").header("Authorization", "Bearer " + s2.get("accessToken").asString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idToken\":\"" + googleToken("g-linked", e, true) + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDENTITY_ALREADY_LINKED"));

        // linked identity can now log in via google
        JsonNode ext = externalLogin("google", googleToken("g-linked", e, true));
        assertEquals(userId.toString(), ext.get("userId").asString());
    }

    @Test
    void unlinkOwnIdentityWorksAndLastMethodIsProtected() throws Exception {
        // OAuth-only user — only sign-in method is the external identity
        JsonNode res = externalLogin("google", googleToken("g-only", "oauthonly@diasporum.test", true));
        UUID userId = UUID.fromString(res.get("userId").asString());
        String at = res.get("accessToken").asString();
        UUID extId = jdbc.queryForObject(
                "SELECT id FROM external_identities WHERE user_id=?", UUID.class, userId);

        // unlinking the only sign-in method → 409 LAST_AUTH_METHOD
        mvc.perform(delete("/api/v1/auth/link/" + extId)
                        .header("Authorization", "Bearer " + at))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("LAST_AUTH_METHOD"));
        assertEquals(1, externalIdentitiesFor(userId));

        // password user CAN unlink (still has password credential)
        String e = "haspw@diasporum.test";
        UUID pwUser = registerPasswordUser(e);
        jdbc.update("UPDATE users SET account_status='ACTIVE' WHERE id=?", pwUser);
        jdbc.update("INSERT INTO external_identities(id,user_id,issuer,subject,email_verified) VALUES(?,?,?,?,?)",
                UUID.randomUUID(), pwUser, GOOGLE_ISS, "g-haspw", true);
        UUID ext2 = jdbc.queryForObject(
                "SELECT id FROM external_identities WHERE user_id=?", UUID.class, pwUser);
        JsonNode pwSession = passwordLogin(e);
        mvc.perform(delete("/api/v1/auth/link/" + ext2)
                        .header("Authorization", "Bearer " + pwSession.get("accessToken").asString()))
                .andExpect(status().isNoContent());
        assertEquals(0, externalIdentitiesFor(pwUser));

        // unlinking another user's identity is a silent no-op
        mvc.perform(delete("/api/v1/auth/link/" + extId)
                        .header("Authorization", "Bearer " + pwSession.get("accessToken").asString()))
                .andExpect(status().isNoContent());
        assertEquals(1, externalIdentitiesFor(userId)); // untouched
    }

    @Test
    void suspendedUserCannotLoginViaLinkedExternalIdentity() throws Exception {
        JsonNode res = externalLogin("google", googleToken("g-susp", "susp@diasporum.test", true));
        UUID userId = UUID.fromString(res.get("userId").asString());

        jdbc.update("UPDATE users SET account_status='SUSPENDED' WHERE id=?", userId);

        mvc.perform(post("/api/v1/auth/google").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idToken\":\"" + googleToken("g-susp", "susp@diasporum.test", true) + "\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCOUNT_RESTRICTED"));
    }
}
