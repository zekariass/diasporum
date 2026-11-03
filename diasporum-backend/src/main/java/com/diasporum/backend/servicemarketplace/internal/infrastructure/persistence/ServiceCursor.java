package com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence;

import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Cursor;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Versioned, filter-bound cursor encoding for deterministic keyset pages. */
public final class ServiceCursor {
    private ServiceCursor() {
    }

    public static String fingerprint(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public static String encode(Cursor cursor) {
        String value = String.join("|", cursor.sort(), cursor.fingerprint(),
                cursor.primary(), cursor.secondary() == null ? "" : cursor.secondary(),
                cursor.id().toString());
        return Base64.getUrlEncoder().withoutPadding().encodeToString(
                value.getBytes(StandardCharsets.UTF_8));
    }

    public static Cursor decode(String encoded, String sort, String fingerprint) {
        if (encoded == null || encoded.isBlank()) {
            return null;
        }
        try {
            String value = new String(Base64.getUrlDecoder().decode(encoded), StandardCharsets.UTF_8);
            String[] parts = value.split("\\|", -1);
            if (parts.length != 5) {
                throw invalid();
            }
            Cursor cursor = new Cursor(parts[0], parts[1], parts[2],
                    parts[3].isEmpty() ? null : parts[3], UUID.fromString(parts[4]));
            if (!sort.equals(cursor.sort()) || !fingerprint.equals(cursor.fingerprint())
                    || cursor.primary().isBlank()) {
                throw invalid();
            }
            return cursor;
        } catch (Exception e) {
            if (e instanceof ResponseStatusException rse) {
                throw rse;
            }
            throw invalid();
        }
    }

    public static int pageSize(Integer size) {
        if (size == null || size <= 0) {
            return 20;
        }
        return Math.min(size, 50);
    }

    private static ResponseStatusException invalid() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_CURSOR");
    }
}
