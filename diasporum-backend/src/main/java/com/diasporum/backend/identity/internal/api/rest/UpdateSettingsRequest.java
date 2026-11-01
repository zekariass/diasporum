package com.diasporum.backend.identity.internal.api.rest;

import jakarta.validation.constraints.Pattern;
import java.util.UUID;

/** Sparse PATCH body for general settings. */
public record UpdateSettingsRequest(
        @Pattern(regexp = "^(?i)(LIGHT|DARK|SYSTEM)$") String theme,
        @Pattern(regexp = "^[a-zA-Z]{2}(-[a-zA-Z]{2})?$") String preferredLanguageCode,
        UUID activeCommunityId,
        UUID defaultCommunityId) {
}
