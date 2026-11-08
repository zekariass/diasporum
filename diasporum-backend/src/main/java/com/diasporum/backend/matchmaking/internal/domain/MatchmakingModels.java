package com.diasporum.backend.matchmaking.internal.domain;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Application/domain contracts; REST transport types stay in the controller. */
public final class MatchmakingModels {

    private MatchmakingModels() {
    }

    public record ProfileCommand(String genderKey, UUID addressId,
            UUID nationalityCountryId, UUID religionId, String educationLevel,
            String occupation, String relationshipIntention, String maritalStatus,
            Boolean hasChildren, String wantsChildren, String smoking, String drinking,
            String activityLevel, Integer heightCm, String marriageTimeline,
            Boolean longDistanceRelationship, String religionImportance,
            Boolean willingToRelocate, UUID photoMediaId, UUID blurredPhotoMediaId,
            String nameVisibility, String photoVisibility, String anonymousAlias,
            String status) {

        /** Copy with the blurred rendition reference replaced (server-derived). */
        public ProfileCommand withBlurredPhotoMediaId(UUID id) {
            return new ProfileCommand(genderKey, addressId, nationalityCountryId,
                    religionId, educationLevel, occupation, relationshipIntention,
                    maritalStatus, hasChildren, wantsChildren, smoking, drinking,
                    activityLevel, heightCm, marriageTimeline,
                    longDistanceRelationship, religionImportance, willingToRelocate,
                    photoMediaId, id, nameVisibility, photoVisibility,
                    anonymousAlias, status);
        }
    }

    public record ProfileView(UUID userId, String genderKey, UUID addressId,
            UUID nationalityCountryId, UUID religionId, String educationLevel,
            String occupation, String relationshipIntention, String maritalStatus,
            Boolean hasChildren, String wantsChildren, String smoking, String drinking,
            String activityLevel, Integer heightCm, String marriageTimeline,
            Boolean longDistanceRelationship, String religionImportance,
            Boolean willingToRelocate, UUID photoMediaId, UUID blurredPhotoMediaId,
            String nameVisibility, String photoVisibility, String anonymousAlias,
            String verificationStatus, String status, Instant activatedAt,
            Instant lastActiveAt, Instant createdAt, Instant updatedAt) {
    }

    public record PreferenceCommand(Integer minAge, Integer maxAge,
            Integer maxDistanceKm, Boolean showVerifiedOnly,
            String hasChildrenPreference, String wantsChildrenPreference,
            List<String> genderKeys, List<UUID> religionIds, List<UUID> languageIds) {
    }

    public record PreferenceView(UUID userId, int minAge, int maxAge,
            Integer maxDistanceKm, boolean showVerifiedOnly,
            String hasChildrenPreference, String wantsChildrenPreference,
            List<String> genderKeys, List<UUID> religionIds, List<UUID> languageIds) {
    }

    /** Internal projection row; the nullable photo ID is never exposed directly. */
    public record PublicProfileRow(UUID userId, String displayName, UUID photoMediaId,
            String genderKey, Integer age, UUID nationalityCountryId, UUID religionId,
            String educationLevel, String occupation, String relationshipIntention,
            String maritalStatus, Boolean hasChildren, String wantsChildren,
            String smoking, String drinking, String activityLevel, Integer heightCm,
            String marriageTimeline, Boolean longDistanceRelationship,
            String religionImportance, Boolean willingToRelocate,
            String verificationStatus, String bio, String publicLocation,
            List<String> interests, List<String> languages, String nameVisibility,
            String photoVisibility) {
    }

    public record PublicProfileView(UUID userId, String displayName, String photoUrl,
            String genderKey, Integer age, UUID nationalityCountryId, UUID religionId,
            String educationLevel, String occupation, String relationshipIntention,
            String maritalStatus, Boolean hasChildren, String wantsChildren,
            String smoking, String drinking, String activityLevel, Integer heightCm,
            String marriageTimeline, Boolean longDistanceRelationship,
            String religionImportance, Boolean willingToRelocate,
            String verificationStatus, String bio, String publicLocation,
            List<String> interests, List<String> languages, String nameVisibility,
            String photoVisibility) {
    }

    public record MatchRow(UUID id, UUID userAId, UUID userBId, String status,
            Instant matchedAt, Instant closedAt, UUID closedBy, String closeReason) {
        public boolean includes(UUID userId) {
            return userAId.equals(userId) || userBId.equals(userId);
        }

        public UUID other(UUID userId) {
            return userAId.equals(userId) ? userBId : userAId;
        }
    }

    public record MatchView(UUID id, String status, PublicProfileView other,
            Instant matchedAt, Instant closedAt, UUID conversationId) {
    }

    public record SwipeRow(UUID swiperUserId, UUID targetUserId, String action,
            String status, Instant createdAt) {
    }

    public record HistorySwipe(UUID eventId, UUID swiperUserId, UUID targetUserId,
            String action) {
    }

    public record SwipeResult(String action, String status, boolean matched,
            UUID matchId, UUID conversationId) {
    }

    /**
     * Server-computed Dating entry state. {@code reason} explains why a user is not
     * eligible so clients can route to the correct screen: DOB_REQUIRED (no stored
     * date of birth — collect it first), NO_PROFILE, PROFILE_INCOMPLETE,
     * PROFILE_PAUSED, PROFILE_SUSPENDED, PROFILE_DELETED, NOT_ADULT (a birth date
     * exists but fails the 18+ check), DISCOVERY_OPT_IN_REQUIRED or ELIGIBLE.
     */
    public record EligibilityView(boolean eligible, String reason, String profileStatus,
            String verificationStatus, boolean adult, boolean hasDateOfBirth,
            boolean discoveryOptIn, boolean hasPreferences) {
    }

    public record MatchPageRow(MatchRow match, PublicProfileRow other) {
    }

    public record ReferenceOption(String id, String label) {
    }

    public record PrivateAddressOption(String id, String label, String countryId) {
    }

    public record ReferenceDataView(List<ReferenceOption> genders,
            List<ReferenceOption> religions, List<ReferenceOption> countries,
            List<ReferenceOption> languages, List<PrivateAddressOption> addresses,
            java.util.Map<String, List<ReferenceOption>> profileOptions) {
        public ReferenceDataView(List<ReferenceOption> genders, List<ReferenceOption> religions,
                List<ReferenceOption> countries, List<ReferenceOption> languages, List<PrivateAddressOption> addresses) {
            this(genders, religions, countries, languages, addresses, java.util.Map.of());
        }
    }

    public record Page<T>(List<T> items, String nextCursor) {
    }
}
