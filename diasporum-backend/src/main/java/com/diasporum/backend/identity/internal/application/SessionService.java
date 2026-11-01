package com.diasporum.backend.identity.internal.application;

import com.diasporum.backend.security.SessionValidator;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Manages device sessions and their lifecycle.
 * Each login creates a separate user_sessions record with its own absolute expiry.
 */
@Service
public class SessionService implements SessionValidator {

    private final JdbcTemplate db;

    public SessionService(JdbcTemplate db) { this.db = db; }

    public record SessionView(UUID id, UUID userId, String clientType, String authenticationMethod,
            String deviceId, String deviceName, Instant createdAt, Instant lastUsedAt,
            Instant absoluteExpiresAt) {}

    private static SessionView map(java.sql.ResultSet rs, int n) throws java.sql.SQLException {
        return new SessionView(rs.getObject("id", UUID.class),
            rs.getObject("user_id", UUID.class),
            rs.getString("client_type"), rs.getString("authentication_method"),
            rs.getString("device_id"), rs.getString("device_name"),
            rs.getTimestamp("created_at").toInstant(),
            rs.getTimestamp("last_used_at").toInstant(),
            rs.getTimestamp("absolute_expires_at").toInstant());
    }

    /** Create a new device session. Returns the session id. */
    @Transactional
    public UUID create(UUID userId, String clientType, String authMethod,
            String deviceId, String deviceName, String ipAddress, String userAgent,
            Instant absoluteExpiresAt) {
        UUID id = UUID.randomUUID();
        db.update("""
            INSERT INTO user_sessions(id,user_id,client_type,authentication_method,
                device_id,device_name,ip_address,user_agent,absolute_expires_at)
            VALUES(?,?,?,?,?,?,?::inet,?,?)""",
            id, userId, clientType, authMethod, deviceId, deviceName, ipAddress, userAgent,
            java.sql.Timestamp.from(absoluteExpiresAt));
        return id;
    }

    public boolean isActive(UUID sessionId) {
        Integer count = db.queryForObject("""
            SELECT count(*) FROM user_sessions
            WHERE id=? AND revoked_at IS NULL AND absolute_expires_at > now()""",
            Integer.class, sessionId);
        return count != null && count > 0;
    }

    public void touch(UUID sessionId) {
        db.update("UPDATE user_sessions SET last_used_at=now() WHERE id=?", sessionId);
    }

    public Optional<SessionView> findById(UUID sessionId) {
        return db.query("SELECT * FROM user_sessions WHERE id=?", SessionService::map, sessionId)
            .stream().findFirst();
    }

    /** Revoke a specific session + all its refresh tokens. */
    @Transactional
    public void revoke(UUID sessionId, String reason) {
        db.update("UPDATE user_sessions SET revoked_at=now(),revocation_reason=? WHERE id=?",
            reason, sessionId);
        db.update("UPDATE user_refresh_tokens SET revoked_at=now() WHERE session_id=?",
            sessionId);
    }

    /** Revoke all sessions + tokens for a user (logout all, account suspension, deletion). */
    @Transactional
    public void revokeAllForUser(UUID userId, String reason) {
        db.update("UPDATE user_sessions SET revoked_at=now(),revocation_reason=? WHERE user_id=? AND revoked_at IS NULL",
            reason, userId);
        db.update("UPDATE user_refresh_tokens t SET revoked_at=now() FROM user_sessions s WHERE t.session_id=s.id AND s.user_id=?",
            userId);
    }

    /** List active sessions for a user. */
    public List<SessionView> listForUser(UUID userId) {
        return db.query("SELECT * FROM user_sessions WHERE user_id=? AND revoked_at IS NULL ORDER BY last_used_at DESC",
            SessionService::map, userId);
    }

    /** Get user email for principal construction — queries users, not profiles. */
    public Optional<UserView> getUser(UUID userId) {
        return db.query("SELECT id,email,account_status,email_verified_at FROM users WHERE id=?",
            (rs, n) -> new UserView(rs.getObject("id", UUID.class), rs.getString("email"),
                rs.getString("account_status"),
                rs.getTimestamp("email_verified_at") != null
                    ? rs.getTimestamp("email_verified_at").toInstant() : null),
            userId).stream().findFirst();
    }

    public record UserView(UUID id, String email, String accountStatus, Instant emailVerifiedAt) {}

    /** SessionValidator contract — minimal user info for principal construction. */
    @Override
    public Optional<UserInfo> user(UUID userId) {
        return getUser(userId).map(u -> new UserInfo(u.id(), u.email()));
    }
}
