package com.diasporum.backend.propertylistings.internal.application;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Signed-by-integrity-not-secrecy opaque cursor for stable timestamp/id ordering. */
final class PropertyCursors {

    private PropertyCursors() {
    }

    record Cursor(Instant time, UUID id) {
    }

    static String encode(Instant time, UUID id) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(
                (time + "|" + id).getBytes(StandardCharsets.UTF_8));
    }

    static Cursor decode(String value) {
        try {
            String[] parts = new String(Base64.getUrlDecoder().decode(value),
                    StandardCharsets.UTF_8).split("\\|");
            if (parts.length != 2) {
                throw new IllegalArgumentException();
            }
            return new Cursor(Instant.parse(parts[0]), UUID.fromString(parts[1]));
        } catch (IllegalArgumentException | NullPointerException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_CURSOR");
        }
    }
}
