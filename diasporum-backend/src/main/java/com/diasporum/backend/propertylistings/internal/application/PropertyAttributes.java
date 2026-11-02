package com.diasporum.backend.propertylistings.internal.application;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Bounded, category-aware JSONB validation for non-core property attributes. */
@Component
class PropertyAttributes {

    private static final Set<String> RESIDENTIAL = Set.of("APARTMENT", "HOUSE",
            "TOWNHOUSE", "VILLA", "STUDIO", "ROOM", "OTHER");
    private static final Set<String> COMMON = Set.of("energyRating", "yearBuilt",
            "floor", "parkingSpaces", "petsAllowed", "smokingAllowed", "reference");
    private static final Set<String> LAND = Set.of("plotUse", "planningPermission",
            "reference");
    private static final Set<String> COMMERCIAL = Set.of("commercialUse",
            "energyRating", "yearBuilt", "floor", "parkingSpaces", "reference");

    private final ObjectMapper mapper;

    PropertyAttributes(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    String validate(Map<String, Object> attributes, String typeKey) {
        Map<String, Object> value = attributes == null ? Map.of() : attributes;
        if (value.size() > 30) {
            throw invalid();
        }
        Set<String> allowed = "LAND".equals(typeKey) ? LAND
                : "COMMERCIAL".equals(typeKey) ? COMMERCIAL : COMMON;
        if (!RESIDENTIAL.contains(typeKey) && !"LAND".equals(typeKey)
                && !"COMMERCIAL".equals(typeKey)) {
            allowed = COMMON;
        }
        for (var entry : value.entrySet()) {
            if (!allowed.contains(entry.getKey())
                    || !entry.getKey().matches("^[a-z][A-Za-z0-9]{0,63}$")) {
                throw invalid();
            }
            validateValue(mapper.valueToTree(entry.getValue()), 0);
        }
        try {
            return mapper.writeValueAsString(value);
        } catch (JacksonException e) {
            throw invalid();
        }
    }

    private void validateValue(JsonNode value, int depth) {
        if (value == null || value.isNull() || value.isObject() || depth > 1) {
            throw invalid();
        }
        if (value.isArray()) {
            if (value.size() > 20) {
                throw invalid();
            }
            for (JsonNode item : value) {
                if (item.isArray() || item.isObject() || item.isNull()) {
                    throw invalid();
                }
                validateScalar(item);
            }
        } else {
            validateScalar(value);
        }
    }

    private void validateScalar(JsonNode value) {
        if (value.isTextual() && value.textValue().length() > 500) {
            throw invalid();
        }
        if (!value.isValueNode() || value.isBinary() || value.isPojo()) {
            throw invalid();
        }
    }

    JsonNode read(String json) {
        try {
            return mapper.readTree(json);
        } catch (JacksonException e) {
            throw new IllegalStateException("Invalid stored property attributes", e);
        }
    }

    private static ResponseStatusException invalid() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "INVALID_PROPERTY_ATTRIBUTES");
    }
}
