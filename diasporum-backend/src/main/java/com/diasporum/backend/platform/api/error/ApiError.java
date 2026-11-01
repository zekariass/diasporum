package com.diasporum.backend.platform.api.error;

import java.time.Instant;
import java.util.Map;

/**
 * Standard REST error envelope returned for every API error response.
 *
 * <p>Never include internal exception details, stack traces, SQL, secrets or
 * private user data in {@link #message} or {@link #fieldErrors}.
 */
public record ApiError(
        int status,
        String code,
        String message,
        String path,
        Instant timestamp,
        Map<String, String> fieldErrors) {

    public static ApiError of(int status, String code, String message, String path) {
        return new ApiError(status, code, message, path, Instant.now(), Map.of());
    }

    public static ApiError of(int status, String code, String message, String path,
            Map<String, String> fieldErrors) {
        return new ApiError(status, code, message, path, Instant.now(), fieldErrors);
    }
}
