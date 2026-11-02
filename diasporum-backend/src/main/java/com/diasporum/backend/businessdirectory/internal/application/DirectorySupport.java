package com.diasporum.backend.businessdirectory.internal.application;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

/** Shared validation, cursor, and audit helpers for directory application services. */
abstract class DirectorySupport {

    static final int DEFAULT_PAGE = 20;
    static final int MAX_PAGE = 50;

    final JdbcTemplate jdbc;

    DirectorySupport(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    static ResponseStatusException bad(String code) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, code);
    }

    static ResponseStatusException forbidden(String code) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, code);
    }

    static ResponseStatusException conflict(String code) {
        return new ResponseStatusException(HttpStatus.CONFLICT, code);
    }

    static ResponseStatusException notFound(String code) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, code);
    }

    static int clamp(int size) {
        return size <= 0 ? DEFAULT_PAGE : Math.min(size, MAX_PAGE);
    }

    static Instant ts(java.sql.ResultSet rs, String column)
            throws java.sql.SQLException {
        var value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    static String encodeTimeCursor(Instant createdAt, UUID id) {
        return encode(createdAt + "|" + id);
    }

    static TimeCursor decodeTimeCursor(String cursor) {
        try {
            String[] parts = decode(cursor).split("\\|", -1);
            if (parts.length != 2) {
                throw new IllegalArgumentException();
            }
            return new TimeCursor(Instant.parse(parts[0]), UUID.fromString(parts[1]));
        } catch (RuntimeException e) {
            throw bad("INVALID_CURSOR");
        }
    }

    static String encodeDistanceCursor(double distance, UUID id) {
        return encode(distance + "|" + id);
    }

    static DistanceCursor decodeDistanceCursor(String cursor) {
        try {
            String[] parts = decode(cursor).split("\\|", -1);
            double distance = Double.parseDouble(parts[0]);
            if (parts.length != 2 || !Double.isFinite(distance) || distance < 0) {
                throw new IllegalArgumentException();
            }
            return new DistanceCursor(distance, UUID.fromString(parts[1]));
        } catch (RuntimeException e) {
            throw bad("INVALID_CURSOR");
        }
    }

    private static String encode(String value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(
                value.getBytes(StandardCharsets.UTF_8));
    }

    private static String decode(String value) {
        return new String(Base64.getUrlDecoder().decode(value),
                StandardCharsets.UTF_8);
    }

    void audit(UUID actor, String action, String targetType, UUID targetId) {
        jdbc.update("INSERT INTO audit_logs(actor_user_id,actor_type,action_key,"
                        + "target_type,target_id) VALUES(?,'USER',?,?,?)",
                actor, action, targetType, targetId);
    }

    record TimeCursor(Instant createdAt, UUID id) {
    }

    record DistanceCursor(double distance, UUID id) {
    }
}
