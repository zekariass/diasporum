package com.diasporum.backend.identity.internal.api.rest;

import java.util.UUID;

/**
 * Response for {@code GET /api/v1/me}: the internal Diasporum profile for the
 * authenticated principal. No Keycloak claims, tokens or credentials.
 * {@code displayName} is null until onboarding completes.
 */
public record MeResponse(UUID id, String displayName, String accountStatus,
        boolean profileCompleted) {
}
