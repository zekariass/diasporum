package com.diasporum.backend.identity.internal.application;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;

/**
 * Refresh token lifecycle: opaque random tokens, SHA-256 digests, family rotation,
 * replay detection, atomic rotation in transaction.
 */
@Service
public class TokenService {

    private final JdbcTemplate db;
    private final SecureRandom rng = new SecureRandom();

    public TokenService(JdbcTemplate db) { this.db = db; }

    public record IssuedToken(String value, UUID sessionId, Instant expiresAt) {}
    public record TokenView(UUID id, UUID sessionId, UUID tokenFamilyId,
            Instant issuedAt, Instant expiresAt, Instant consumedAt, Instant revokedAt) {}

    private static TokenView map(java.sql.ResultSet rs, int n) throws java.sql.SQLException {
        return new TokenView(rs.getObject("id", UUID.class), rs.getObject("session_id", UUID.class),
            rs.getObject("token_family_id", UUID.class),
            rs.getTimestamp("issued_at").toInstant(), rs.getTimestamp("expires_at").toInstant(),
            rs.getTimestamp("consumed_at") != null ? rs.getTimestamp("consumed_at").toInstant() : null,
            rs.getTimestamp("revoked_at") != null ? rs.getTimestamp("revoked_at").toInstant() : null);
    }

    private byte[] digest(String token) {
        try { return MessageDigest.getInstance("SHA-256").digest(token.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    private String generate() {
        byte[] b = new byte[32];
        rng.nextBytes(b);
        return HexFormat.of().formatHex(b);
    }

    /** Issue initial refresh token + family for a new session. */
    @Transactional
    public IssuedToken issue(UUID sessionId, Instant expiresAt) {
        String token = generate();
        UUID familyId = UUID.randomUUID();
        UUID id = UUID.randomUUID();
        db.update("INSERT INTO user_refresh_tokens(id,session_id,token_family_id,token_hash,expires_at) VALUES(?,?,?,?,?)",
            id, sessionId, familyId, digest(token), java.sql.Timestamp.from(expiresAt));
        return new IssuedToken(token, sessionId, expiresAt);
    }

    /**
     * Rotate: validate, mark consumed, create successor in same family.
     * Detects replay (consumed token reused) → revokes entire family.
     * Atomic — single transaction prevents concurrent refresh creating multiple descendants.
     */
    @Transactional
    public Optional<RotatedToken> rotate(String presentedToken, Instant newExpiry) {
        byte[] hash = digest(presentedToken);
        Optional<TokenView> row = db.query("SELECT * FROM user_refresh_tokens WHERE token_hash=?",
            TokenService::map, hash).stream().findFirst();
        if (row.isEmpty()) return Optional.empty();
        TokenView t = row.get();

        if (t.revokedAt() != null) return Optional.empty();        // revoked
        if (t.consumedAt() != null) {
            // Replay detected — revoke entire family
            revokeFamily(t.tokenFamilyId());
            return Optional.empty();
        }
        if (t.expiresAt().isBefore(Instant.now())) return Optional.empty(); // expired

        // Rotation must satisfy two schema invariants:
        //  1. ux_user_refresh_tokens_one_active_per_family — at most one unconsumed,
        //     unrevoked token per family → the old token must be consumed BEFORE the
        //     successor is inserted.
        //  2. replaced_by_token_id FK → the successor must exist before replaced_by
        //     is set on the old row.
        // Order: consume old atomically → insert successor → link replaced_by.
        // The consumed_at IS NULL guard makes check-then-act race-safe: a concurrent
        // rotation that already consumed this token yields 0 rows → replay → family
        // revocation (single-winner guarantee under READ COMMITTED).
        int updated = db.update("UPDATE user_refresh_tokens SET consumed_at=now() WHERE id=? AND consumed_at IS NULL",
            t.id());
        if (updated == 0) {
            revokeFamily(t.tokenFamilyId());
            return Optional.empty();
        }
        String newToken = generate();
        UUID newId = UUID.randomUUID();
        db.update("INSERT INTO user_refresh_tokens(id,session_id,token_family_id,token_hash,expires_at) VALUES(?,?,?,?,?)",
            newId, t.sessionId(), t.tokenFamilyId(), digest(newToken), java.sql.Timestamp.from(newExpiry));
        db.update("UPDATE user_refresh_tokens SET replaced_by_token_id=? WHERE id=?", newId, t.id());
        return Optional.of(new RotatedToken(newToken, t.sessionId(), t.tokenFamilyId()));
    }

    @Transactional
    public void revokeFamily(UUID familyId) {
        db.update("UPDATE user_refresh_tokens SET revoked_at=now() WHERE token_family_id=? AND revoked_at IS NULL", familyId);
    }

    public record RotatedToken(String token, UUID sessionId, UUID familyId) {}
}
