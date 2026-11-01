package com.diasporum.backend.identity.internal.api.rest;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Own-profile response ({@code GET /api/v1/me/profile}). Self-view includes the
 * owner's own date of birth; a separate limited DTO is required before any
 * public profile endpoint is added.
 */
public record ProfileResponse(UUID id, String username, String displayName,
        String bio, String city, LocalDate dateOfBirth, UUID originCountryId,
        UUID currentCountryId, String accountStatus, boolean profileCompleted,
        UUID avatarMediaId) {
}
