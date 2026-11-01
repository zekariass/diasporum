package com.diasporum.backend.identity.internal.application;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * First-party authentication: registration, login, token issuance, refresh, logout.
 * users.id is the permanent account identity; profiles.id = users.id (1:0-1).
 */
@Service
public class AuthService {

    private final JdbcTemplate db;
    private final PasswordEncoder passwordEncoder;
    private final SessionService sessionService;
    private final TokenService tokenService;
    private final EmailService emailService;
    private final long refreshTtlSeconds;
    private final long sessionTtlSeconds;

    public AuthService(JdbcTemplate db, PasswordEncoder passwordEncoder,
            SessionService sessionService, TokenService tokenService,
            EmailService emailService,
            @org.springframework.beans.factory.annotation.Value("${diasporum.auth.jwt.refresh-token-ttl:P30D}") java.time.Duration refreshTtl,
            @org.springframework.beans.factory.annotation.Value("${diasporum.auth.jwt.absolute-session-ttl:P90D}") java.time.Duration sessionTtl) {
        this.db = db;
        this.passwordEncoder = passwordEncoder;
        this.sessionService = sessionService;
        this.tokenService = tokenService;
        this.emailService = emailService;
        this.refreshTtlSeconds = refreshTtl.getSeconds();
        this.sessionTtlSeconds = sessionTtl.getSeconds();
    }

    public record AuthResult(UUID userId, String accessToken, String refreshToken, UUID sessionId) {}

    // ---- Registration ----

    @Transactional
    public UUID register(String email, String password, String clientType,
            String deviceId, String deviceName, String ip, String userAgent) {
        String normalized = email.trim().toLowerCase();
        if (db.queryForObject("SELECT count(*) FROM users WHERE email_normalized=? AND deleted_at IS NULL", Integer.class, normalized) > 0)
            throw new IllegalArgumentException("EMAIL_TAKEN");
        if (password.length() < 8) throw new IllegalArgumentException("PASSWORD_TOO_SHORT");

        UUID userId = UUID.randomUUID();
        // Email verification deferred — accounts activate immediately.
        // To re-enable: insert 'PENDING_VERIFICATION' here and restore the
        // INITIAL_REGISTRATION token + sendVerification call (verifyEmail /
        // resendVerification below are still functional).
        db.update("INSERT INTO users(id,email,account_status) VALUES(?,?,'ACTIVE')", userId, normalized);
        db.update("INSERT INTO user_credentials(user_id,password_hash) VALUES(?,?)", userId, passwordEncoder.encode(password));
        return userId;
    }

    // ---- Password login ----

    @Transactional
    public AuthResult login(String email, String password, String clientType,
            String deviceId, String deviceName, String ip, String userAgent) {
        String normalized = email.trim().toLowerCase();
        Optional<UserRow> user = db.query("SELECT id,email,account_status FROM users WHERE email_normalized=? AND deleted_at IS NULL",
            (rs, n) -> new UserRow(rs.getObject("id", UUID.class), rs.getString("email"), rs.getString("account_status")),
            normalized).stream().findFirst();
        if (user.isEmpty()) throw new IllegalArgumentException("INVALID_CREDENTIALS");
        if (!"ACTIVE".equals(user.get().accountStatus()) && !"PENDING_VERIFICATION".equals(user.get().accountStatus()))
            throw new IllegalArgumentException("ACCOUNT_RESTRICTED");

        Optional<String> hash = db.query("SELECT password_hash FROM user_credentials WHERE user_id=?",
            (rs, n) -> rs.getString(1), user.get().id()).stream().findFirst();
        if (hash.isEmpty() || !passwordEncoder.matches(password, hash.get()))
            throw new IllegalArgumentException("INVALID_CREDENTIALS");

        return createSession(user.get().id(), "PASSWORD", clientType, deviceId, deviceName, ip, userAgent);
    }

    // ---- Session + token creation (shared) ----

    private AuthResult createSession(UUID userId, String method, String clientType,
            String deviceId, String deviceName, String ip, String userAgent) {
        UUID sessionId = sessionService.create(userId, clientType, method, deviceId, deviceName, ip, userAgent,
            Instant.now().plusSeconds(sessionTtlSeconds));
        var issued = tokenService.issue(sessionId, Instant.now().plusSeconds(refreshTtlSeconds));
        // JWT is issued by the caller (AuthController) via JwtService — keep access token out of DB
        return new AuthResult(userId, null, issued.value(), sessionId);
    }

    // ---- Refresh ----

    @Transactional
    public Optional<AuthResult> refresh(String refreshToken) {
        Optional<TokenService.RotatedToken> rotated = tokenService.rotate(refreshToken,
            Instant.now().plusSeconds(refreshTtlSeconds));
        if (rotated.isEmpty()) return Optional.empty();
        // Reuse existing session — do not create a new one. Reject refresh for
        // revoked or absolutely-expired sessions so no new access token is issued.
        var session = sessionService.findById(rotated.get().sessionId());
        if (session.isEmpty() || !sessionService.isActive(rotated.get().sessionId()))
            return Optional.empty();
        return Optional.of(new AuthResult(session.get().userId(), null, rotated.get().token(), rotated.get().sessionId()));
    }

    // ---- Logout ----

    @Transactional
    public void logout(UUID sessionId) { sessionService.revoke(sessionId, "USER_LOGOUT"); }

    @Transactional
    public void logoutAll(UUID userId) { sessionService.revokeAllForUser(userId, "USER_LOGOUT_ALL"); }

    // ---- Email verification ----

    @Transactional
    public boolean verifyEmail(String token) {
        Optional<UUID> userId = db.query("SELECT user_id FROM email_verification_tokens WHERE token_hash=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()",
            (rs, n) -> rs.getObject(1, UUID.class), digest(token)).stream().findFirst();
        if (userId.isEmpty()) return false;
        db.update("UPDATE email_verification_tokens SET consumed_at=now() WHERE token_hash=?", digest(token));
        // Activate only accounts still pending verification — must not resurrect
        // SUSPENDED/DELETION_PENDING accounts via an outstanding token.
        db.update("UPDATE users SET email_verified_at=now(),account_status=CASE WHEN account_status='PENDING_VERIFICATION' THEN 'ACTIVE' ELSE account_status END WHERE id=?",
            userId.get());
        return true;
    }

    @Transactional
    public void resendVerification(String email) {
        String normalized = email.trim().toLowerCase();
        db.query("SELECT id FROM users WHERE email_normalized=? AND deleted_at IS NULL AND email_verified_at IS NULL",
            (rs, n) -> rs.getObject(1, UUID.class), normalized).stream().findFirst().ifPresent(userId -> {
            String token = UUID.randomUUID().toString().replace("-", "");
            db.update("INSERT INTO email_verification_tokens(id,user_id,purpose,email_to_verify,token_hash,expires_at) VALUES(?,?,?,?,?,now()+interval '24 hours')",
                UUID.randomUUID(), userId, "INITIAL_REGISTRATION", normalized, digest(token));
            emailService.sendVerification(normalized, token);
        });
        // Always return — do not reveal whether email exists or is already verified
    }

    // ---- Password reset ----

    @Transactional
    public void requestPasswordReset(String email) {
        String normalized = email.trim().toLowerCase();
        Optional<UUID> userId = db.query("SELECT id FROM users WHERE email_normalized=? AND deleted_at IS NULL",
            (rs, n) -> rs.getObject(1, UUID.class), normalized).stream().findFirst();
        if (userId.isPresent()) {
            String token = UUID.randomUUID().toString().replace("-", "");
            db.update("INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at) VALUES(?,?,?,now()+interval '1 hour')",
                UUID.randomUUID(), userId.get(), digest(token));
            emailService.sendPasswordReset(normalized, token);
        }
        // Always return success — do not reveal whether email exists
    }

    @Transactional
    public boolean resetPassword(String token, String newPassword) {
        if (newPassword.length() < 8) throw new IllegalArgumentException("PASSWORD_TOO_SHORT");
        Optional<UUID> userId = db.query("SELECT user_id FROM password_reset_tokens WHERE token_hash=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()",
            (rs, n) -> rs.getObject(1, UUID.class), digest(token)).stream().findFirst();
        if (userId.isEmpty()) return false;
        db.update("UPDATE password_reset_tokens SET consumed_at=now() WHERE token_hash=?", digest(token));
        // Upsert — external-identity-only accounts have no credential row yet.
        db.update("INSERT INTO user_credentials(user_id,password_hash,password_changed_at) VALUES(?,?,now()) "
                + "ON CONFLICT (user_id) DO UPDATE SET password_hash=EXCLUDED.password_hash,password_changed_at=now()",
            userId.get(), passwordEncoder.encode(newPassword));
        sessionService.revokeAllForUser(userId.get(), "PASSWORD_RESET");
        return true;
    }

    @Transactional
    public boolean changePassword(UUID userId, String currentPassword, String newPassword) {
        Optional<String> hash = db.query("SELECT password_hash FROM user_credentials WHERE user_id=?",
            (rs, n) -> rs.getString(1), userId).stream().findFirst();
        if (hash.isEmpty() || !passwordEncoder.matches(currentPassword, hash.get())) return false;
        if (newPassword.length() < 8) throw new IllegalArgumentException("PASSWORD_TOO_SHORT");
        db.update("UPDATE user_credentials SET password_hash=?,password_changed_at=now() WHERE user_id=?",
            passwordEncoder.encode(newPassword), userId);
        sessionService.revokeAllForUser(userId, "PASSWORD_CHANGED");
        return true;
    }

    private byte[] digest(String token) {
        try { return java.security.MessageDigest.getInstance("SHA-256").digest(token.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }

    private record UserRow(UUID id, String email, String accountStatus) {}
}
