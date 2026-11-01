package com.diasporum.backend.identity.internal.api.rest;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

/** Converts an already-whitelisted PATCH map to its typed request, mapping malformed values to 400. */
final class PatchBodies {

    private PatchBodies() {
    }

    static <T> T convert(ObjectMapper mapper, Map<String, Object> body, Class<T> type) {
        try {
            return mapper.convertValue(body, type);
        } catch (IllegalArgumentException | JacksonException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST_BODY");
        }
    }
}
