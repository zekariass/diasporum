package com.diasporum.backend.identity.internal.api.rest;

import java.util.UUID;

/** Own-user general settings response. */
public record SettingsResponse(UUID defaultCommunityId, UUID activeCommunityId,
        String preferredLanguageCode, String theme) {
}
