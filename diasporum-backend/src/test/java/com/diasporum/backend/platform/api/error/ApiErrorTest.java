package com.diasporum.backend.platform.api.error;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import org.junit.jupiter.api.Test;

class ApiErrorTest {

    @Test
    void createsErrorWithoutFieldErrors() {
        ApiError error = ApiError.of(404, "NOT_FOUND", "Resource not found", "/api/v1/items/1");

        assertEquals(404, error.status());
        assertEquals("NOT_FOUND", error.code());
        assertEquals("Resource not found", error.message());
        assertEquals("/api/v1/items/1", error.path());
        assertNotNull(error.timestamp());
        assertTrue(error.fieldErrors().isEmpty());
    }

    @Test
    void createsErrorWithFieldErrors() {
        Map<String, String> fields = Map.of("title", "must not be blank");

        ApiError error = ApiError.of(400, "VALIDATION_FAILED", "Request validation failed",
                "/api/v1/posts", fields);

        assertEquals("must not be blank", error.fieldErrors().get("title"));
    }
}
