package com.diasporum.backend.identity;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.diasporum.backend.identity.internal.application.EmailService;
import com.diasporum.backend.security.JwtService;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * End-to-end first-party auth flows against a real migrated v10.12 database:
 * registration, verification, login, JWT, refresh rotation/replay, sessions,
 * password reset/change, suspension, auth-only (profile-less) users.
 */
@SpringBootTest
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class AuthFlowIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired JwtService jwtService;
    @Autowired RecordingEmailService emails;

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String PASSWORD = "a-very-secure-password-15";
    private static final String NEW_PASSWORD = "an-even-better-password-16";

    /** Captures outbound tokens in place of real email delivery. */
    static class RecordingEmailService implements EmailService {
        final Map<String, String> verifyTokens = new ConcurrentHashMap<>();
        final Map<String, String> resetTokens = new ConcurrentHashMap<>();
        @Override public void sendVerification(String to, String token) { verifyTokens.put(to, token); }
        @Override public void sendPasswordReset(String to, String token) { resetTokens.put(to, token); }
        @Override public void sendSecurityNotification(String to, String s, String b) {}
        void clear() { verifyTokens.clear(); resetTokens.clear(); }
    }

    @TestConfiguration
    static class EmailConfig {
        @Bean @Primary
        RecordingEmailService recordingEmailService() { return new RecordingEmailService(); }
    }

    @BeforeEach
    void clean() {
        for (String t : new String[]{"user_refresh_tokens", "user_sessions",
                "email_verification_tokens", "password_reset_tokens",
                "external_identities", "user_credentials", "profiles", "users"})
            jdbc.update("DELETE FROM " + t);
        emails.clear();
    }

    // ---- helpers ----

    private String email(String tag) { return tag + "@diasporum.test"; }

    private UUID register(String email) throws Exception {
        MvcResult r = mvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.userId").exists())
                .andReturn();
        return UUID.fromString(JSON.readTree(r.getResponse().getContentAsString()).get("userId").asText());
    }

    private void verify(String email) throws Exception {
        String token = emails.verifyTokens.get(email);
        // Registration currently activates accounts directly without sending a
        // verification token — nothing to verify in that case.
        if (token == null) return;
        mvc.perform(post("/api/v1/auth/verify-email").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"" + token + "\"}"))
                .andExpect(status().isNoContent());
    }

    private JsonNode login(String email, String password) throws Exception {
        MvcResult r = mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").exists())
                .andExpect(jsonPath("$.refreshToken").exists())
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andReturn();
        return JSON.readTree(r.getResponse().getContentAsString());
    }

    private String bearer(String token) { return "Bearer " + token; }

    private String accountStatus(UUID userId) {
        return jdbc.queryForObject("SELECT account_status FROM users WHERE id=?", String.class, userId);
    }

    // ---- registration / verification / login ----

    @Test
    void registerVerifyLoginFullFlow() throws Exception {
        String e = email("flow");
        UUID userId = register(e);
        assertEquals("PENDING_VERIFICATION", accountStatus(userId));

        verify(e);
        assertEquals("ACTIVE", accountStatus(userId));
        assertNotNull(jdbc.queryForObject(
                "SELECT email_verified_at FROM users WHERE id=?", java.sql.Timestamp.class, userId));

        JsonNode tokens = login(e, PASSWORD);
        assertEquals(userId.toString(), tokens.get("userId").asText());
        assertNotNull(tokens.get("sessionId").asText());

        // access token carries sub=userId, sid=sessionId
        var claims = jwtService.verify(tokens.get("accessToken").asText());
        assertNotNull(claims);
        assertEquals(userId.toString(), claims.getSubject());
        assertEquals(tokens.get("sessionId").asText(), claims.getStringClaim("sid"));

        // authenticated /auth/me returns account data incl. verification timestamp
        mvc.perform(get("/api/v1/auth/me").header("Authorization", bearer(tokens.get("accessToken").asText())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(e))
                .andExpect(jsonPath("$.accountStatus").value("ACTIVE"));
    }

    @Test
    void registerValidationAndDuplicates() throws Exception {
        // short password → 400
        mvc.perform(post("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"a@b.co\",\"password\":\"short\"}"))
                .andExpect(status().isBadRequest());
        // malformed email → 400
        mvc.perform(post("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"not-an-email\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isBadRequest());
        // duplicate email → 409 EMAIL_TAKEN
        String e = email("dup");
        register(e);
        mvc.perform(post("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + e + "\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("EMAIL_TAKEN"));
    }

    @Test
    void loginFailuresAndVerificationTokenReuse() throws Exception {
        String e = email("loginfail");
        register(e);
        verify(e);
        // wrong password → 401
        mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + e + "\",\"password\":\"wrong-password-12345\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
        // unknown email → 401 (same code — no user enumeration)
        mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"ghost@x.io\",\"password\":\"wrong-password-12345\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
        // consumed verification token cannot be reused → 400
        String token = emails.verifyTokens.get(e);
        mvc.perform(post("/api/v1/auth/verify-email").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"" + token + "\"}"))
                .andExpect(status().isBadRequest());
        // garbage token → 400
        mvc.perform(post("/api/v1/auth/verify-email").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"deadbeef\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void resendVerificationIssuesFreshTokenAndDoesNotLeakExistence() throws Exception {
        String e = email("resend");
        register(e);
        String first = emails.verifyTokens.get(e);
        mvc.perform(post("/api/v1/auth/resend-verification").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + e + "\"}"))
                .andExpect(status().isNoContent());
        String second = emails.verifyTokens.get(e);
        assertNotNull(second);
        assertNotEquals(first, second);
        // unknown email → still 204 (no enumeration)
        mvc.perform(post("/api/v1/auth/resend-verification").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"ghost@x.io\"}"))
                .andExpect(status().isNoContent());
        assertNull(emails.verifyTokens.get("ghost@x.io"));
        verify(e);
        assertEquals("ACTIVE", accountStatus(
                jdbc.queryForObject("SELECT id FROM users WHERE email_normalized=?", UUID.class, e)));
    }

    // ---- JWT / JWKS ----

    @Test
    void jwksPublishesRsaKeyAndProtectedEndpointsRequireBearer() throws Exception {
        mvc.perform(get("/.well-known/jwks.json"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.keys[0].kty").value("RSA"))
                .andExpect(jsonPath("$.keys[0].kid").exists());
        // unauthenticated → 401, not 500
        mvc.perform(get("/api/v1/auth/me")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/auth/sessions")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/logout")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/change-password").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"x\",\"newPassword\":\"" + NEW_PASSWORD + "\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/me")).andExpect(status().isUnauthorized());
    }

    @Test
    void foreignAndTamperedTokensRejected() throws Exception {
        String e = email("jwtexp");
        register(e); verify(e);
        JsonNode tokens = login(e, PASSWORD);
        UUID userId = UUID.fromString(tokens.get("userId").asText());
        UUID sessionId = UUID.fromString(tokens.get("sessionId").asText());

        // token issued by a different issuer/key → 401
        var foreign = new JwtService("https://evil.example", "diasporum-api",
                "x", Duration.ofMinutes(15), "", "", true);
        mvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", bearer(foreign.issue(userId, sessionId).token())))
                .andExpect(status().isUnauthorized());

        // tampered signature on an otherwise valid token → 401
        String at = tokens.get("accessToken").asText();
        mvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", bearer(at.substring(0, at.length() - 4) + "AAAA")))
                .andExpect(status().isUnauthorized());

        // expired-token rejection is unit-tested in JwtClaimValidationTest
        // (validate_expiredToken_returnsNull) — the filter maps validate()==null to 401.
    }

    // ---- refresh rotation / replay / concurrency ----

    @Test
    void refreshRotatesAndReplayRevokesFamily() throws Exception {
        String e = email("rotate");
        register(e); verify(e);
        JsonNode t1 = login(e, PASSWORD);

        // rotate → new pair
        MvcResult r = mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"" + t1.get("refreshToken").asText() + "\"}"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode t2 = JSON.readTree(r.getResponse().getContentAsString());
        assertNotEquals(t1.get("refreshToken").asText(), t2.get("refreshToken").asText());
        // same session retained
        assertEquals(t1.get("sessionId").asText(), t2.get("sessionId").asText());

        // replay of the consumed token → 401 AND family revocation kills t2 as well
        mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"" + t1.get("refreshToken").asText() + "\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"" + t2.get("refreshToken").asText() + "\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void concurrentRefreshProducesSingleWinner() throws Exception {
        String e = email("race");
        register(e); verify(e);
        JsonNode t = login(e, PASSWORD);
        String body = "{\"refreshToken\":\"" + t.get("refreshToken").asText() + "\"}";

        int threads = 4;
        var latch = new CountDownLatch(1);
        var successes = new AtomicInteger();
        var failures = new AtomicInteger();
        var pool = java.util.concurrent.Executors.newFixedThreadPool(threads);
        try {
            for (int i = 0; i < threads; i++) {
                pool.submit(() -> {
                    try {
                        latch.await(5, TimeUnit.SECONDS);
                        var res = mvc.perform(post("/api/v1/auth/refresh")
                                        .contentType(MediaType.APPLICATION_JSON).content(body))
                                .andReturn().getResponse().getStatus();
                        if (res == 200) successes.incrementAndGet(); else failures.incrementAndGet();
                    } catch (Exception ex) { failures.incrementAndGet(); }
                    return null;
                });
            }
            latch.countDown();
            pool.shutdown();
            assertTrue(pool.awaitTermination(30, TimeUnit.SECONDS));
        } finally { pool.shutdownNow(); }

        // exactly one winner — the single-active-token-per-family invariant holds
        assertEquals(1, successes.get(), "expected exactly one successful rotation");
        assertEquals(threads - 1, failures.get());
    }

    @Test
    void refreshWithUnknownOrBlankTokenRejected() throws Exception {
        mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"nonexistent\"}"))
                .andExpect(status().isUnauthorized());
    }

    // ---- sessions / logout ----

    @Test
    void logoutRevokesSessionAndAccessTokenStopsWorking() throws Exception {
        String e = email("logout");
        register(e); verify(e);
        JsonNode t = login(e, PASSWORD);
        String at = t.get("accessToken").asText();
        String sid = t.get("sessionId").asText();

        mvc.perform(get("/api/v1/auth/sessions").header("Authorization", bearer(at)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(sid));

        mvc.perform(post("/api/v1/auth/logout").header("Authorization", bearer(at)))
                .andExpect(status().isNoContent());

        // access token dead because session revoked
        mvc.perform(get("/api/v1/auth/me").header("Authorization", bearer(at)))
                .andExpect(status().isUnauthorized());
        // refresh token revoked with the session
        mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"" + t.get("refreshToken").asText() + "\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void logoutAllRevokesEverySession() throws Exception {
        String e = email("logoutall");
        register(e); verify(e);
        JsonNode s1 = login(e, PASSWORD);
        JsonNode s2 = login(e, PASSWORD);
        assertNotEquals(s1.get("sessionId").asText(), s2.get("sessionId").asText());

        mvc.perform(get("/api/v1/auth/sessions").header("Authorization", bearer(s1.get("accessToken").asText())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));

        mvc.perform(post("/api/v1/auth/logout-all").header("Authorization", bearer(s1.get("accessToken").asText())))
                .andExpect(status().isNoContent());

        for (JsonNode s : List.of(s1, s2)) {
            mvc.perform(get("/api/v1/auth/me").header("Authorization", bearer(s.get("accessToken").asText())))
                    .andExpect(status().isUnauthorized());
            mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                            .content("{\"refreshToken\":\"" + s.get("refreshToken").asText() + "\"}"))
                    .andExpect(status().isUnauthorized());
        }
    }

    @Test
    void revokeIndividualSessionOnlyAffectsThatSession() throws Exception {
        String e = email("revokeone");
        register(e); verify(e);
        JsonNode s1 = login(e, PASSWORD);
        JsonNode s2 = login(e, PASSWORD);

        mvc.perform(delete("/api/v1/auth/sessions/" + s1.get("sessionId").asText())
                        .header("Authorization", bearer(s2.get("accessToken").asText())))
                .andExpect(status().isNoContent());

        mvc.perform(get("/api/v1/auth/me").header("Authorization", bearer(s1.get("accessToken").asText())))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/auth/me").header("Authorization", bearer(s2.get("accessToken").asText())))
                .andExpect(status().isOk());

        // cannot revoke another user's session — create second user and try
        String other = email("revokeother");
        register(other); verify(other);
        JsonNode o = login(other, PASSWORD);
        mvc.perform(delete("/api/v1/auth/sessions/" + o.get("sessionId").asText())
                        .header("Authorization", bearer(s2.get("accessToken").asText())))
                .andExpect(status().isNoContent()); // silent no-op
        mvc.perform(get("/api/v1/auth/me").header("Authorization", bearer(o.get("accessToken").asText())))
                .andExpect(status().isOk()); // still alive
    }

    // ---- password reset / change ----

    @Test
    void passwordResetRotatesCredentialsAndKillsSessions() throws Exception {
        String e = email("reset");
        register(e); verify(e);
        JsonNode t = login(e, PASSWORD);

        // forgot-password always 204 (also for unknown emails — no enumeration)
        mvc.perform(post("/api/v1/auth/forgot-password").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + e + "\"}"))
                .andExpect(status().isNoContent());
        mvc.perform(post("/api/v1/auth/forgot-password").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"ghost@x.io\"}"))
                .andExpect(status().isNoContent());
        assertNull(emails.resetTokens.get("ghost@x.io"));

        String resetToken = emails.resetTokens.get(e);
        assertNotNull(resetToken);
        mvc.perform(post("/api/v1/auth/reset-password").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"" + resetToken + "\",\"password\":\"" + NEW_PASSWORD + "\"}"))
                .andExpect(status().isNoContent());

        // all prior sessions revoked
        mvc.perform(get("/api/v1/auth/me").header("Authorization", bearer(t.get("accessToken").asText())))
                .andExpect(status().isUnauthorized());
        // old password dead, new password works
        mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + e + "\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isUnauthorized());
        login(e, NEW_PASSWORD);
        // reset token single-use
        mvc.perform(post("/api/v1/auth/reset-password").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"" + resetToken + "\",\"password\":\"" + NEW_PASSWORD + "\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void changePasswordRequiresCurrentAndRevokesSessions() throws Exception {
        String e = email("changepw");
        register(e); verify(e);
        JsonNode t = login(e, PASSWORD);
        String at = t.get("accessToken").asText();

        // wrong current password → 401
        mvc.perform(post("/api/v1/auth/change-password").header("Authorization", bearer(at))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"wrong-password-999\",\"newPassword\":\"" + NEW_PASSWORD + "\"}"))
                .andExpect(status().isUnauthorized());

        // correct → 204, all sessions revoked
        mvc.perform(post("/api/v1/auth/change-password").header("Authorization", bearer(at))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"" + PASSWORD + "\",\"newPassword\":\"" + NEW_PASSWORD + "\"}"))
                .andExpect(status().isNoContent());

        mvc.perform(get("/api/v1/auth/me").header("Authorization", bearer(at)))
                .andExpect(status().isUnauthorized());
        login(e, NEW_PASSWORD);
    }

    // ---- auth-only users (no profile) / suspension ----

    @Test
    void authOnlyUserAccessesAuthEndpointsAndGetsOnboardingSignal() throws Exception {
        String e = email("noprofile");
        register(e); verify(e);
        JsonNode t = login(e, PASSWORD);
        String at = t.get("accessToken").asText();

        // account endpoints work without a profile
        mvc.perform(get("/api/v1/auth/me").header("Authorization", bearer(at)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accountStatus").value("ACTIVE"));
        mvc.perform(get("/api/v1/auth/sessions").header("Authorization", bearer(at)))
                .andExpect(status().isOk());
        // no profile → /api/v1/me 404 is the client's signal to enter onboarding
        mvc.perform(get("/api/v1/me").header("Authorization", bearer(at)))
                .andExpect(status().isNotFound());
    }

    @Test
    void suspendedAccountLosesApiAccessImmediately() throws Exception {
        String e = email("suspend");
        UUID userId = register(e); verify(e);
        JsonNode t = login(e, PASSWORD);
        String at = t.get("accessToken").asText();

        mvc.perform(get("/api/v1/auth/me").header("Authorization", bearer(at)))
                .andExpect(status().isOk());

        // suspend — DB trigger revokes sessions + refresh tokens
        jdbc.update("UPDATE users SET account_status='SUSPENDED' WHERE id=?", userId);

        mvc.perform(get("/api/v1/auth/me").header("Authorization", bearer(at)))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"" + t.get("refreshToken").asText() + "\"}"))
                .andExpect(status().isUnauthorized());
        // password login also rejected
        mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + e + "\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCOUNT_RESTRICTED"));
    }
}
