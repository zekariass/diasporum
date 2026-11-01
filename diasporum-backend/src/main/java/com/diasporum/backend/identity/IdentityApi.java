package com.diasporum.backend.identity;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Public API of the identity module. Other modules must interact with
 * Identity exclusively through this interface — never via
 * {@code identity.internal.*}.
 *
 * <p>Lookup-only operations: provisioning on first login is an internal
 * concern of the {@code /api/v1/*} endpoints and must not be triggered by
 * callers of this API.
 */
public interface IdentityApi {

    /**
     * Maps an external identity pair to an internal profile, if one exists.
     * Does NOT provision — returns empty when unmapped.
     */
    Optional<IdentityView> findByExternalId(String issuer, String subject);

    /**
     * Public-safe profile fields for cross-module display/authorization use.
     * No email, DOB or privacy-restricted data.
     */
    Optional<ProfileSummary> profileSummary(UUID profileId);

    /** Batch version of {@link #profileSummary} — one query for many ids,
     * for cross-module list enrichment (e.g. social relationship pages). */
    List<ProfileSummary> profileSummaries(Collection<UUID> profileIds);

    /** The user's persisted active community selection ({@code user_settings}), if set. */
    Optional<UUID> activeCommunityId(UUID profileId);

    /**
     * Stores the user's active community selection in {@code user_settings}.
     * Callers must validate membership/eligibility first — this only persists.
     * {@code null} clears the selection.
     */
    void setActiveCommunity(UUID profileId, UUID communityId);

    /**
     * Stores the user's default community in {@code user_settings}.
     * Set once during onboarding to the origin+destination matched community.
     * Callers must validate membership/eligibility first — this only persists.
     */
    void setDefaultCommunity(UUID profileId, UUID communityId);

    /** External-identity mapping view. */
    record IdentityView(UUID profileId, String issuer, String subject) {
    }

    /** Cross-module-safe profile projection. */
    record ProfileSummary(UUID id, String username, String displayName,
            String accountStatus, boolean profileCompleted,
            UUID originCountryId, UUID currentCountryId) {
    }
}
