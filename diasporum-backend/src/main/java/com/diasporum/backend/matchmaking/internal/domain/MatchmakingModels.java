package com.diasporum.backend.matchmaking.internal.domain;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Application/domain contracts; REST transport types stay in the controller. */
public final class MatchmakingModels {

    private MatchmakingModels() {
    }

    /**
     * Profile write command. Photos are managed through the dedicated photo
     * endpoints, never through this record. {@code blurPhotosUntilMatch} /
     * {@code hideNameUntilMatch} are the user-controlled privacy switches.
     */
    public record ProfileCommand(String genderKey, UUID addressId,
            UUID nationalityCountryId, UUID religionId, String educationLevel,
            String occupation, String relationshipIntention, String maritalStatus,
            Boolean hasChildren, String wantsChildren, String smoking, String drinking,
            String activityLevel, Integer heightCm, String marriageTimeline,
            Boolean longDistanceRelationship, String religionImportance,
            Boolean willingToRelocate, Boolean blurPhotosUntilMatch,
            Boolean hideNameUntilMatch, String anonymousAlias, String status) {
    }

    public record ProfileView(UUID userId, String genderKey, UUID addressId,
            UUID nationalityCountryId, UUID religionId, String educationLevel,
            String occupation, String relationshipIntention, String maritalStatus,
            Boolean hasChildren, String wantsChildren, String smoking, String drinking,
            String activityLevel, Integer heightCm, String marriageTimeline,
            Boolean longDistanceRelationship, String religionImportance,
            Boolean willingToRelocate, Boolean blurPhotosUntilMatch,
            Boolean hideNameUntilMatch, String anonymousAlias,
            String verificationStatus, String status, Instant activatedAt,
            Instant lastActiveAt, Instant createdAt, Instant updatedAt,
            List<ProfilePhotoView> photos, int maxProfilePhotos) {

        /** Copy with the gallery collection + configured limit attached. */
        public ProfileView withPhotos(List<ProfilePhotoView> photos, int maxProfilePhotos) {
            return new ProfileView(userId, genderKey, addressId, nationalityCountryId,
                    religionId, educationLevel, occupation, relationshipIntention,
                    maritalStatus, hasChildren, wantsChildren, smoking, drinking,
                    activityLevel, heightCm, marriageTimeline,
                    longDistanceRelationship, religionImportance, willingToRelocate,
                    blurPhotosUntilMatch, hideNameUntilMatch, anonymousAlias,
                    verificationStatus, status, activatedAt, lastActiveAt, createdAt,
                    updatedAt, photos, maxProfilePhotos);
        }
    }

    /** One owned gallery photo. {@code url} is a presigned original rendition. */
    public record ProfilePhotoView(UUID id, UUID mediaId, int sortOrder,
            boolean isPrimary, String url) {
    }

    /** Photo collection plus the configured upload limit. */
    public record ProfilePhotoListView(List<ProfilePhotoView> photos, int maxPhotos) {
    }

    /** Gender is implicit (automatic opposite-gender discovery). */
    public record PreferenceCommand(Integer minAge, Integer maxAge,
            Integer maxDistanceKm, Boolean showVerifiedOnly,
            String hasChildrenPreference, String wantsChildrenPreference,
            List<UUID> religionIds, List<UUID> languageIds) {
    }

    public record PreferenceView(UUID userId, int minAge, int maxAge,
            Integer maxDistanceKm, boolean showVerifiedOnly,
            String hasChildrenPreference, String wantsChildrenPreference,
            List<UUID> religionIds, List<UUID> languageIds) {
    }

    /**
     * Internal projection row: raw display name, alias and privacy switches.
     * Never serialised — the visibility service resolves the authorised view.
     */
    public record PublicProfileRow(UUID userId, String displayName, String anonymousAlias,
            boolean hideNameUntilMatch, boolean blurPhotosUntilMatch,
            String genderKey, Integer age, UUID nationalityCountryId, UUID religionId,
            String educationLevel, String occupation, String relationshipIntention,
            String maritalStatus, Boolean hasChildren, String wantsChildren,
            String smoking, String drinking, String activityLevel, Integer heightCm,
            String marriageTimeline, Boolean longDistanceRelationship,
            String religionImportance, Boolean willingToRelocate,
            String verificationStatus, String bio, String publicLocation,
            List<String> interests, List<String> languages) {
    }

    /** Internal photo row (original media id only — resolved per viewer). */
    public record ProfilePhotoRow(UUID id, UUID mediaId, int sortOrder,
            boolean isPrimary, UUID userId) {
    }

    /** Authorised photo rendition for one viewer relationship. */
    public record PublicPhotoView(String url, boolean isPrimary, int sortOrder,
            String rendition) {
    }

    public record PublicProfileView(UUID userId, String displayName, String photoUrl,
            List<PublicPhotoView> photos, boolean nameRevealed,
            String genderKey, Integer age, UUID nationalityCountryId, UUID religionId,
            String educationLevel, String occupation, String relationshipIntention,
            String maritalStatus, Boolean hasChildren, String wantsChildren,
            String smoking, String drinking, String activityLevel, Integer heightCm,
            String marriageTimeline, Boolean longDistanceRelationship,
            String religionImportance, Boolean willingToRelocate,
            String verificationStatus, String bio, String publicLocation,
            List<String> interests, List<String> languages) {
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
            java.util.Map<String, List<ReferenceOption>> profileOptions,
            int maxProfilePhotos) {
        public ReferenceDataView(List<ReferenceOption> genders, List<ReferenceOption> religions,
                List<ReferenceOption> countries, List<ReferenceOption> languages, List<PrivateAddressOption> addresses) {
            this(genders, religions, countries, languages, addresses, java.util.Map.of(), 0);
        }
    }

    public record Page<T>(List<T> items, String nextCursor) {
    }
}
