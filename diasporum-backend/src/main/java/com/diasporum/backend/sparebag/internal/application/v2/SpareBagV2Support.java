package com.diasporum.backend.sparebag.internal.application.v2;

import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Base64;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Error, cursor and paging helpers shared by the v2 Spare Bag services. */
final class SpareBagV2Support {

    static final int DEFAULT_PAGE = 20;
    static final int MAX_PAGE = 50;

    private SpareBagV2Support() {
    }

    static int pageSize(Integer size) {
        if (size == null) {
            return DEFAULT_PAGE;
        }
        if (size < 1 || size > MAX_PAGE) {
            throw bad("INVALID_PAGE_SIZE");
        }
        return size;
    }

    static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String t = value.trim();
        return t.isEmpty() ? null : t;
    }

    static String upper(String value) {
        String t = trimToNull(value);
        return t == null ? null : t.toUpperCase();
    }

    // =================== cursors: base64url("key|uuid") ===================

    static String cursor(Object key, UUID id) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(
                (key + "|" + id).getBytes(StandardCharsets.UTF_8));
    }

    record Cursor(String key, UUID id) {

        Instant instant() {
            return Instant.parse(key);
        }

        LocalDate date() {
            return LocalDate.parse(key);
        }
    }

    static Cursor decode(String cursor) {
        if (cursor == null || cursor.isBlank()) {
            return null;
        }
        try {
            String raw = new String(Base64.getUrlDecoder().decode(cursor),
                    StandardCharsets.UTF_8);
            int bar = raw.lastIndexOf('|');
            return new Cursor(raw.substring(0, bar), UUID.fromString(raw.substring(bar + 1)));
        } catch (RuntimeException e) {
            throw bad("INVALID_CURSOR");
        }
    }

    static Instant cursorInstant(Cursor c) {
        try {
            return c == null ? null : c.instant();
        } catch (RuntimeException e) {
            throw bad("INVALID_CURSOR");
        }
    }

    static LocalDate cursorDate(Cursor c) {
        try {
            return c == null ? null : c.date();
        } catch (RuntimeException e) {
            throw bad("INVALID_CURSOR");
        }
    }

    // =================== errors ===================

    /**
     * Surfaces a schema CHECK (23514), NOT NULL (23502) or FK (23503) violation as a 400 with the
     * given code instead of re-implementing the constraint in Java; anything
     * else (e.g. unique violations) is rethrown for the caller to map.
     */
    static ResponseStatusException translate(DataIntegrityViolationException e, String code) {
        String state = sqlState(e);
        if ("23514".equals(state) || "23502".equals(state)) {
            return bad(code);
        }
        if ("23503".equals(state)) {
            return bad("INVALID_REFERENCE");
        }
        throw e;
    }

    private static String sqlState(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof SQLException sql && sql.getSQLState() != null) {
                return sql.getSQLState();
            }
        }
        return null;
    }

    static ResponseStatusException bad(String code) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, code);
    }

    static ResponseStatusException conflict(String code) {
        return new ResponseStatusException(HttpStatus.CONFLICT, code);
    }

    static ResponseStatusException forbidden(String code) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, code);
    }

    static ResponseStatusException notFound(String code) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, code);
    }
}
