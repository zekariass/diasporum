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

    record BrowseCursor(String value, UUID id) { }

    static String encodeBrowse(String sort, String value, UUID id) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(
                (sort + "|" + value + "|" + id).getBytes(StandardCharsets.UTF_8));
    }

    static BrowseCursor decodeBrowse(String value, String sort) {
        try {
            if (value.length() > 256) throw new IllegalArgumentException();
            String[] parts = new String(Base64.getUrlDecoder().decode(value),
                    StandardCharsets.UTF_8).split("\\|");
            if (parts.length == 2 && "NEWEST".equals(sort)) {
                return new BrowseCursor(Instant.parse(parts[0]).toString(), UUID.fromString(parts[1]));
            }
            if (parts.length != 3 || !sort.equals(parts[0])) throw new IllegalArgumentException();
            if ("NEWEST".equals(sort)) Instant.parse(parts[1]);
            else if (!parts[1].matches("[0-9]{1,14}(\\.[0-9]{1,2})?")) throw new IllegalArgumentException();
            return new BrowseCursor(parts[1], UUID.fromString(parts[2]));
        } catch (RuntimeException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_CURSOR");
        }
    }

    static Cursor decode(String value) {
        try {
            if (value.length() > 256) throw new IllegalArgumentException();
            String[] parts = new String(Base64.getUrlDecoder().decode(value),
                    StandardCharsets.UTF_8).split("\\|");
            if (parts.length != 2) {
                throw new IllegalArgumentException();
            }
            return new Cursor(Instant.parse(parts[0]), UUID.fromString(parts[1]));
        } catch (RuntimeException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_CURSOR");
        }
    }
}
