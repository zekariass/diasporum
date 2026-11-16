package com.diasporum.backend.matchmaking.internal.application;

import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ProfileCommand;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ProfileView;
import com.diasporum.backend.matchmaking.internal.infrastructure.persistence.MatchmakingRepository;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Owner-only matchmaking profile lifecycle and reference validation. */
@Service
@EnableConfigurationProperties(MatchmakingProperties.class)
public class MatchmakingProfileService {

    private static final Set<String> STATUSES = Set.of("DRAFT", "ACTIVE", "PAUSED");
    private static final Set<String> GENDERS = Set.of("MALE", "FEMALE");
    private static final Set<String> EDUCATION = Set.of("SECONDARY", "VOCATIONAL",
            "UNDERGRADUATE", "POSTGRADUATE", "DOCTORATE", "OTHER", "PREFER_NOT_TO_SAY");
    private static final Set<String> INTENTIONS = Set.of("MARRIAGE", "SERIOUS_RELATIONSHIP",
            "LONG_TERM_DATING", "NOT_SURE_YET");
    private static final Set<String> MARITAL = Set.of("NEVER_MARRIED", "MARRIED", "SEPARATED",
            "DIVORCED", "WIDOWED", "OTHER", "PREFER_NOT_TO_SAY");
    private static final Set<String> WANTS_CHILDREN = Set.of("YES", "NO", "UNSURE",
            "PREFER_NOT_TO_SAY");
    private static final Set<String> HABITS = Set.of("NO", "OCCASIONALLY", "YES",
            "PREFER_NOT_TO_SAY");
    private static final Set<String> ACTIVITY = Set.of("LOW", "MODERATE", "HIGH", "VERY_HIGH",
            "PREFER_NOT_TO_SAY");
    private static final Set<String> TIMELINE = Set.of("ASAP", "WITHIN_1_YEAR", "1_2_YEARS",
            "2_PLUS_YEARS", "UNSURE", "NOT_APPLICABLE");
    private static final Set<String> RELIGION_IMPORTANCE = Set.of("DEAL_BREAKER", "VERY_IMPORTANT",
            "SOMEWHAT_IMPORTANT", "NOT_IMPORTANT");

    static java.util.Map<String, List<com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ReferenceOption>> profileOptions() {
        return java.util.Map.of(
                "education", choices(EDUCATION),
                "intentions", choices(INTENTIONS), "marital", choices(MARITAL),
                "wantsChildren", choices(WANTS_CHILDREN), "habits", choices(HABITS),
                "activity", choices(ACTIVITY), "timeline", choices(TIMELINE),
                "religionImportance", choices(RELIGION_IMPORTANCE));
    }

    private static List<com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ReferenceOption> choices(Set<String> values) {
        return values.stream().sorted().map(value -> {
            String label = switch (value) {
                case "ASAP" -> "As soon as possible";
                case "1_2_YEARS" -> "1–2 years";
                case "2_PLUS_YEARS" -> "2+ years";
                default -> value.substring(0, 1) + value.substring(1).toLowerCase(java.util.Locale.ROOT).replace('_', ' ');
            };
            return new com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ReferenceOption(value, label);
        }).toList();
    }

    private final MatchmakingRepository repository;
    private final MatchmakingAccess access;
    private final MatchmakingPhotoService photos;
    private final MatchmakingProperties properties;

    public MatchmakingProfileService(MatchmakingRepository repository,
            MatchmakingAccess access, MatchmakingPhotoService photos,
            MatchmakingProperties properties) {
        this.repository = repository;
        this.access = access;
        this.photos = photos;
        this.properties = properties;
    }

    @Transactional(readOnly = true)
    public ProfileView profile(UUID actor) {
        access.requireAdult(actor);
        return repository.profile(actor)
                .map(view -> view.withPhotos(
                        photos.photos(actor).photos(), properties.maxProfilePhotos()))
                .orElseThrow(() -> MatchmakingSupport.notFound("MATCHMAKING_PROFILE_NOT_FOUND"));
    }

    @Transactional
    public ProfileView save(UUID actor, ProfileCommand command) {
        access.requireAdult(actor);
        if (command == null) throw MatchmakingSupport.bad("INVALID_MATCHMAKING_PROFILE");
        repository.actorLock(actor);
        repository.profile(actor).ifPresent(current -> {
            if ("DRAFT".equals(command.status()) && !"DRAFT".equals(current.status())) {
                throw MatchmakingSupport.conflict("MATCHMAKING_PROFILE_NOT_EDITABLE");
            }
            if ("REJECTED".equals(current.verificationStatus()) || "REVOKED".equals(current.verificationStatus())) {
                throw MatchmakingSupport.forbidden("MATCHMAKING_NOT_ELIGIBLE");
            }
        });
        var normalized = new ProfileCommand(command.genderKey(), command.addressId(),
                command.nationalityCountryId(), command.religionId(), command.educationLevel(),
                command.occupation(), command.relationshipIntention(), command.maritalStatus(),
                command.hasChildren(), command.wantsChildren(), command.smoking(),
                command.drinking(), command.activityLevel(), command.heightCm(),
                command.marriageTimeline(), command.longDistanceRelationship(),
                command.religionImportance(), command.willingToRelocate(),
                command.blurPhotosUntilMatch() == null || command.blurPhotosUntilMatch(),
                command.hideNameUntilMatch() == null || command.hideNameUntilMatch(),
                command.anonymousAlias(), command.status());
        validate(actor, normalized);
        repository.profile(actor).ifPresent(current -> {
            if ("SUSPENDED".equals(current.status()) || "DELETED".equals(current.status())) {
                throw MatchmakingSupport.conflict("MATCHMAKING_PROFILE_NOT_EDITABLE");
            }
        });
        if ("ACTIVE".equals(command.status())) {
            if (!repository.adult(actor) || !repository.discoveryOptedIn(actor)) {
                throw MatchmakingSupport.forbidden("MATCHMAKING_NOT_ELIGIBLE");
            }
            if (repository.preferences(actor).isEmpty()) {
                throw MatchmakingSupport.bad("MATCHMAKING_PREFERENCES_REQUIRED");
            }
            if (!repository.hasReadyPrimaryPhoto(actor)) {
                throw MatchmakingSupport.bad("MATCHMAKING_PRIMARY_PHOTO_REQUIRED");
            }
        }
        repository.upsertProfile(actor, normalized);
        return profile(actor);
    }

    @Transactional
    public void delete(UUID actor) {
        access.requireAdult(actor);
        if (repository.profile(actor).isEmpty()) return;
        repository.closeActiveMatchesForUser(actor);
        repository.markProfileDeleted(actor);
    }

    private void validate(UUID actor, ProfileCommand c) {
        if (c == null || c.genderKey() == null || !GENDERS.contains(c.genderKey())
                || !STATUSES.contains(c.status())
                || c.anonymousAlias() == null || c.anonymousAlias().isBlank()
                || c.anonymousAlias().length() > 80) {
            throw MatchmakingSupport.bad("INVALID_MATCHMAKING_PROFILE");
        }
        if ((c.religionId() != null
                    && repository.invalidReligions(List.of(c.religionId())) != 0)
                || (c.nationalityCountryId() != null
                    && !repository.activeCountry(c.nationalityCountryId()))
                || (c.addressId() != null && !repository.privateAddressOwned(actor, c.addressId()))) {
            throw MatchmakingSupport.bad("INVALID_MATCHMAKING_REFERENCE");
        }
        allowed(c.educationLevel(), EDUCATION);
        allowed(c.relationshipIntention(), INTENTIONS);
        allowed(c.maritalStatus(), MARITAL);
        allowed(c.wantsChildren(), WANTS_CHILDREN);
        allowed(c.smoking(), HABITS);
        allowed(c.drinking(), HABITS);
        allowed(c.activityLevel(), ACTIVITY);
        allowed(c.marriageTimeline(), TIMELINE);
        allowed(c.religionImportance(), RELIGION_IMPORTANCE);
        if (c.occupation() != null && c.occupation().length() > 160
                || c.heightCm() != null && (c.heightCm() < 80 || c.heightCm() > 250)) {
            throw MatchmakingSupport.bad("INVALID_MATCHMAKING_PROFILE");
        }
    }

    private static void allowed(String value, Set<String> allowed) {
        if (value != null && !allowed.contains(value)) {
            throw MatchmakingSupport.bad("INVALID_MATCHMAKING_PROFILE");
        }
    }
}
