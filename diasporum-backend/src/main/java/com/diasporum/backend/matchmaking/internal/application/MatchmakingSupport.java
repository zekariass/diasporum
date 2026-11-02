package com.diasporum.backend.matchmaking.internal.application;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Shared transport-safe validation and opaque cursor helpers. */
final class MatchmakingSupport {

    private static final int DEFAULT_PAGE = 20;
    private static final int MAX_PAGE = 50;

    private MatchmakingSupport() {
    }

    static int limit(int requested) {
        if (requested <= 0) return DEFAULT_PAGE;
        return Math.min(requested, MAX_PAGE);
    }

    static String cursor(UUID id) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(
                id.toString().getBytes(StandardCharsets.UTF_8));
    }

    static UUID uuidCursor(String cursor) {
        if (cursor == null || cursor.isBlank()) return null;
        try {
            return UUID.fromString(new String(Base64.getUrlDecoder().decode(cursor),
                    StandardCharsets.UTF_8));
        } catch (IllegalArgumentException ex) {
            throw bad("INVALID_CURSOR");
        }
    }

    static String cursor(Instant timestamp, UUID id) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(
                (timestamp + "|" + id).getBytes(StandardCharsets.UTF_8));
    }

    static MatchCursor matchCursor(String cursor) {
        if (cursor == null || cursor.isBlank()) return null;
        try {
            String[] parts = new String(Base64.getUrlDecoder().decode(cursor),
                    StandardCharsets.UTF_8).split("\\|");
            if (parts.length != 2) throw new IllegalArgumentException();
            return new MatchCursor(Instant.parse(parts[0]), UUID.fromString(parts[1]));
        } catch (RuntimeException ex) {
            throw bad("INVALID_CURSOR");
        }
    }

    static ResponseStatusException bad(String code) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, code);
    }

    static ResponseStatusException forbidden(String code) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, code);
    }

    static ResponseStatusException notFound(String code) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, code);
    }

    static ResponseStatusException conflict(String code) {
        return new ResponseStatusException(HttpStatus.CONFLICT, code);
    }

    record MatchCursor(Instant matchedAt, UUID matchId) {
    }
}
