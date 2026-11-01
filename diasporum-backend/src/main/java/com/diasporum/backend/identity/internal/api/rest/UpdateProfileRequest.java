package com.diasporum.backend.identity.internal.api.rest;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.constraints.Past;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Sparse PATCH body — only non-null fields are applied. Unknown keys (e.g.
 * protected fields like {@code accountStatus}, {@code id}, {@code trustScore})
 * are rejected by {@code ignoreUnknown = false}.
 */
@JsonIgnoreProperties(ignoreUnknown = false)
public record UpdateProfileRequest(
        @Size(min = 3, max = 20) String username,
        @Size(min = 1, max = 80) String displayName,
        @Size(max = 800) String bio,
        @Size(max = 120) String city,
        @Past LocalDate dateOfBirth,
        UUID originCountryId,
        UUID currentCountryId,
        UUID avatarMediaId) {
}
