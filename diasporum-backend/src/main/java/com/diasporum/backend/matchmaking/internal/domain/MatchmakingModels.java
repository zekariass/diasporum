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
            String verificationStatus) {
    }

    public record PublicProfileView(UUID userId, String displayName, String photoUrl,
            String genderKey, Integer age, UUID nationalityCountryId, UUID religionId,
            String educationLevel, String occupation, String relationshipIntention,
            String maritalStatus, Boolean hasChildren, String wantsChildren,
            String smoking, String drinking, String activityLevel, Integer heightCm,
            String marriageTimeline, Boolean longDistanceRelationship,
            String religionImportance, Boolean willingToRelocate,
            String verificationStatus) {
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

    public record MatchPageRow(MatchRow match, PublicProfileRow other) {
    }

    public record ReferenceOption(String id, String label) {
    }

    public record PrivateAddressOption(String id, String label, String countryId) {
    }

    public record ReferenceDataView(List<ReferenceOption> genders,
            List<ReferenceOption> religions, List<ReferenceOption> countries,
            List<ReferenceOption> languages, List<PrivateAddressOption> addresses) {
    }

    public record Page<T>(List<T> items, String nextCursor) {
    }
}
