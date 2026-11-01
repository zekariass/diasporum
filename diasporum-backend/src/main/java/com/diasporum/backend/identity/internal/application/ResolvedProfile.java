package com.diasporum.backend.identity.internal.application;

import java.util.UUID;

/**
 * Resolved internal Diasporum identity for an authenticated principal.
 * {@code displayName} is nullable until onboarding completes;
 * {@code profileCompleted} is derived from {@code profiles.profile_completed_at}.
 */
public record ResolvedProfile(UUID id, String displayName, String accountStatus,
        boolean profileCompleted) {
}
