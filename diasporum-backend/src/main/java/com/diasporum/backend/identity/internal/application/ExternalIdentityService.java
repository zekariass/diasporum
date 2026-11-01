package com.diasporum.backend.identity.internal.application;

import com.nimbusds.jose.jwk.source.RemoteJWKSet;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jose.util.DefaultResourceRetriever;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.nimbusds.jwt.proc.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URL;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * External identity verification (Google, Apple) + account linking per v10.12.
 * Verifies provider ID tokens via JWKS, resolves to Diasporum users.id.
 */
@Service
public class ExternalIdentityService {

    private static final Logger log = LoggerFactory.getLogger(ExternalIdentityService.class);

    private final JdbcTemplate db;
    private final SessionService sessionService;
    private final TokenService tokenService;
    private final List<String> googleClientIds;
    private final String appleClientId;
    private final RemoteJWKSet<SecurityContext> googleJwks;
    private final RemoteJWKSet<SecurityContext> appleJwks;

    public ExternalIdentityService(JdbcTemplate db, SessionService sessionService,
            TokenService tokenService,
            @Value("${diasporum.auth.google.client-ids:}") List<String> googleClientIds,
            @Value("${diasporum.auth.apple.client-id:}") String appleClientId,
            @Value("${diasporum.auth.google.jwks-url:https://www.googleapis.com/oauth2/v3/certs}") String googleJwksUrl,
            @Value("${diasporum.auth.apple.jwks-url:https://appleid.apple.com/auth/keys}") String appleJwksUrl) throws Exception {
        this.db = db;
        this.sessionService = sessionService;
        this.tokenService = tokenService;
        this.googleClientIds = googleClientIds;
        this.appleClientId = appleClientId;
        var retriever = new DefaultResourceRetriever(2000, 2000);
        this.googleJwks = new RemoteJWKSet<>(new URL(googleJwksUrl), retriever);
        this.appleJwks = new RemoteJWKSet<>(new URL(appleJwksUrl), retriever);
    }

    public record ExternalLoginResult(UUID userId, String refreshToken, UUID sessionId) {}

    /**
     * Verify provider token and resolve to a Diasporum account.
     * Linking policy: verified email + existing account → link; different email → new account.
     */
    @Transactional
    public AuthService.AuthResult login(String issuer, String idToken,
            String clientType, String deviceId, String deviceName, String ip, String userAgent) {
        VerifiedClaims claims = verify(issuer, idToken);
        if (claims == null) throw new IllegalArgumentException("INVALID_EXTERNAL_TOKEN");

        // 1. Existing external identity → login to linked account.
        //    Enforce account status — restricted/deleted accounts must not get a
        //    new session through their still-linked provider identity.
        var linkedUser = db.query(
            "SELECT e.user_id, u.account_status FROM external_identities e JOIN users u ON u.id=e.user_id "
            + "WHERE e.issuer=? AND e.subject=? AND u.deleted_at IS NULL",
            (rs, n) -> new Object[]{rs.getObject(1, UUID.class), rs.getString(2)},
            issuer, claims.subject()).stream().findFirst();

        if (linkedUser.isPresent()) {
            if (!"ACTIVE".equals(linkedUser.get()[1]))
                throw new IllegalArgumentException("ACCOUNT_RESTRICTED");
            UUID userId = (UUID) linkedUser.get()[0];
            db.update("UPDATE external_identities SET last_login_at=now() WHERE issuer=? AND subject=?",
                issuer, claims.subject());
            return createSession(userId, claims.method(), clientType, deviceId, deviceName, ip, userAgent);
        }

        // 2. No linked identity — check verified email for account linking
        if (!claims.emailVerified() || claims.email() == null)
            throw new IllegalArgumentException("EMAIL_NOT_VERIFIED");

        String normalized = claims.email().trim().toLowerCase();
        var existingUser = db.query(
            "SELECT id, account_status FROM users WHERE email_normalized=? AND deleted_at IS NULL",
            (rs, n) -> new Object[]{rs.getObject(1, UUID.class), rs.getString(2)},
            normalized).stream().findFirst();

        UUID userId;
        if (existingUser.isPresent()) {
            String status = (String) existingUser.get()[1];
            if ("SUSPENDED".equals(status) || "DELETION_PENDING".equals(status))
                throw new IllegalArgumentException("ACCOUNT_RESTRICTED");
            userId = (UUID) existingUser.get()[0];
            linkIdentity(userId, issuer, claims.subject(), normalized, true);
            // Provider-verified email proves ownership — complete verification on
            // accounts still pending rather than creating a duplicate user row
            // (ux_users_email_normalized would reject the insert anyway).
            if (!"ACTIVE".equals(status))
                db.update("UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()),account_status='ACTIVE' WHERE id=?",
                    userId);
        } else {
            // New account — create user + external identity
            userId = UUID.randomUUID();
            db.update("INSERT INTO users(id,email,email_verified_at,account_status) VALUES(?,?,now(),'ACTIVE')",
                userId, normalized);
            linkIdentity(userId, issuer, claims.subject(), normalized, true);
        }
        return createSession(userId, claims.method(), clientType, deviceId, deviceName, ip, userAgent);
    }

    private void linkIdentity(UUID userId, String issuer, String subject, String email, boolean verified) {
        db.update("INSERT INTO external_identities(id,user_id,issuer,subject,email_at_link_time,email_verified) VALUES(?,?,?,?,?,?)",
            UUID.randomUUID(), userId, issuer, subject, email, verified);
    }

    private AuthService.AuthResult createSession(UUID userId, String method, String clientType,
            String deviceId, String deviceName, String ip, String userAgent) {
        UUID sessionId = sessionService.create(userId, clientType, method, deviceId, deviceName, ip, userAgent,
            Instant.now().plusSeconds(7776000)); // 90 days
        var issued = tokenService.issue(sessionId, Instant.now().plusSeconds(2592000)); // 30 days
        return new AuthService.AuthResult(userId, null, issued.value(), sessionId);
    }

    /** Link an external identity to an existing authenticated user. */
    @Transactional
    public void link(UUID userId, String issuer, String idToken) {
        VerifiedClaims claims = verify(issuer, idToken);
        if (claims == null) throw new IllegalArgumentException("INVALID_EXTERNAL_TOKEN");
        // Check if already linked to a different account
        Optional<UUID> existing = db.query(
            "SELECT user_id FROM external_identities WHERE issuer=? AND subject=?",
            (rs, n) -> rs.getObject(1, UUID.class), issuer, claims.subject()).stream().findFirst();
        if (existing.isPresent() && !existing.get().equals(userId))
            throw new IllegalArgumentException("IDENTITY_ALREADY_LINKED");
        if (existing.isEmpty())
            linkIdentity(userId, issuer, claims.subject(), claims.email(), claims.emailVerified());
    }

    /** Unlink an external identity owned by the user.
     *  Refuses to remove the last sign-in method so the account stays reachable. */
    @Transactional
    public void unlink(UUID userId, UUID externalIdentityId) {
        var owner = db.query("SELECT user_id FROM external_identities WHERE id=?",
            (rs, n) -> rs.getObject(1, UUID.class), externalIdentityId).stream().findFirst();
        if (owner.isEmpty() || !owner.get().equals(userId)) return; // not theirs — silent no-op
        Integer identities = db.queryForObject(
            "SELECT count(*) FROM external_identities WHERE user_id=?", Integer.class, userId);
        Integer credentials = db.queryForObject(
            "SELECT count(*) FROM user_credentials WHERE user_id=?", Integer.class, userId);
        if ((credentials == null || credentials == 0) && identities != null && identities <= 1)
            throw new IllegalArgumentException("LAST_AUTH_METHOD");
        db.update("DELETE FROM external_identities WHERE id=? AND user_id=?",
            externalIdentityId, userId);
    }

    // ---- Token verification ----

    private record VerifiedClaims(String subject, String email, boolean emailVerified, String method) {}

    private VerifiedClaims verify(String issuer, String idToken) {
        try {
            SignedJWT jwt = SignedJWT.parse(idToken);
            RemoteJWKSet<SecurityContext> jwks = "https://appleid.apple.com".equals(issuer) ? appleJwks : googleJwks;
            var claims = jwt.getJWTClaimsSet();
            String iss = "https://appleid.apple.com".equals(issuer) ? "https://appleid.apple.com" : "https://accounts.google.com";
            if (!iss.equals(claims.getIssuer())) return null;
            // Audience must match ANY configured client id — Google may issue
            // tokens for the Android, iOS and web client ids of one project.
            var auds = "https://appleid.apple.com".equals(issuer)
                    ? List.of(appleClientId) : googleClientIds;
            if (auds.stream().filter(a -> a != null && !a.isBlank())
                    .noneMatch(a -> claims.getAudience().contains(a))) return null;
            if (claims.getExpirationTime() == null || claims.getExpirationTime().before(new java.util.Date())) return null;
            // Signature verification via JWKS
            var jwk = jwks.get(new com.nimbusds.jose.jwk.JWKSelector(
                new com.nimbusds.jose.jwk.JWKMatcher.Builder().keyID(jwt.getHeader().getKeyID()).build()), null);
            if (jwk.isEmpty()) return null;
            if (!jwt.verify(new com.nimbusds.jose.crypto.RSASSAVerifier(
                    (com.nimbusds.jose.jwk.RSAKey) jwk.get(0)))) return null;
            String email = claims.getStringClaim("email");
            // Providers send email_verified either as a JSON boolean (Google)
            // or as the string "true" (Apple) — read it type-agnostically.
            Object ev = claims.getClaim("email_verified");
            boolean emailVerified = Boolean.TRUE.equals(ev) || "true".equals(ev);
            return new VerifiedClaims(claims.getSubject(), email, emailVerified,
                "https://appleid.apple.com".equals(issuer) ? "APPLE" : "GOOGLE");
        } catch (Exception e) {
            log.warn("External token verification failed for issuer {}: {}", issuer, e.getMessage());
            return null;
        }
    }
}
