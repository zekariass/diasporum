package com.diasporum.backend.matchmaking.internal.application;

import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.EligibilityView;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ProfileView;
import com.diasporum.backend.matchmaking.internal.infrastructure.persistence.MatchmakingRepository;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Server-side resolution of the caller's Dating entry state. This is the single
 * read the client uses to decide between profile creation, setup completion,
 * restricted-status messaging and discovery; enforcement stays in the write and
 * discovery paths via {@link MatchmakingAccess} and the database triggers.
 */
@Service
public class EligibilityService {

    public static final String ELIGIBLE = "ELIGIBLE";
    public static final String DOB_REQUIRED = "DOB_REQUIRED";
    public static final String NO_PROFILE = "NO_PROFILE";
    public static final String PROFILE_INCOMPLETE = "PROFILE_INCOMPLETE";
    public static final String PROFILE_PAUSED = "PROFILE_PAUSED";
    public static final String PROFILE_SUSPENDED = "PROFILE_SUSPENDED";
    public static final String PROFILE_DELETED = "PROFILE_DELETED";
    public static final String NOT_ADULT = "NOT_ADULT";
    public static final String OPT_IN_REQUIRED = "DISCOVERY_OPT_IN_REQUIRED";

    private final MatchmakingRepository repository;

    public EligibilityService(MatchmakingRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public EligibilityView eligibility(UUID actor) {
        boolean adult = repository.adult(actor);
        boolean hasDob = repository.hasDateOfBirth(actor);
        boolean optedIn = repository.discoveryOptedIn(actor);
        boolean hasPreferences = repository.preferences(actor).isPresent();
        var profile = repository.profile(actor).orElse(null);
        if (!repository.activeAccount(actor)) {
            return view(false, PROFILE_SUSPENDED, profile, false, hasDob, optedIn, hasPreferences);
        }
        if (repository.needsAgeConfirmation(actor)) {
            return view(false, "AGE_CONFIRMATION_REQUIRED", profile, false, hasDob, optedIn, hasPreferences);
        }
        if (!adult) {
            return view(false, hasDob ? NOT_ADULT : DOB_REQUIRED, profile,
                    false, hasDob, optedIn, hasPreferences);
        }
        if (profile != null && ("REJECTED".equals(profile.verificationStatus())
                || "REVOKED".equals(profile.verificationStatus()))) {
            return view(false, PROFILE_SUSPENDED, profile, adult, hasDob, optedIn, hasPreferences);
        }
        if (profile == null) {
            return view(false, !hasDob ? DOB_REQUIRED : adult ? NO_PROFILE : NOT_ADULT, null,
                    adult, hasDob, optedIn, hasPreferences);
        }
        return switch (profile.status()) {
            case "DELETED" -> view(false, PROFILE_DELETED, profile, adult, hasDob, optedIn,
                    hasPreferences);
            case "SUSPENDED" -> view(false, PROFILE_SUSPENDED, profile, adult, hasDob, optedIn,
                    hasPreferences);
            case "DRAFT" -> view(false, hasDob ? PROFILE_INCOMPLETE : DOB_REQUIRED, profile, adult,
                    hasDob, optedIn, hasPreferences);
            case "PAUSED" -> view(false, PROFILE_PAUSED, profile, adult, hasDob, optedIn,
                    hasPreferences);
            default -> {
                if (!hasDob) {
                    yield view(false, DOB_REQUIRED, profile, adult, hasDob, optedIn, hasPreferences);
                }
                if (!adult) {
                    yield view(false, NOT_ADULT, profile, false, hasDob, optedIn, hasPreferences);
                }
                if (!optedIn) {
                    yield view(false, OPT_IN_REQUIRED, profile, true, hasDob, false, hasPreferences);
                }
                boolean eligible = repository.eligible(actor);
                yield view(eligible, eligible ? ELIGIBLE : PROFILE_INCOMPLETE,
                        profile, true, hasDob, true, hasPreferences);
            }
        };
    }

    private static EligibilityView view(boolean eligible, String reason, ProfileView profile,
            boolean adult, boolean hasDob, boolean optedIn, boolean hasPreferences) {
        return new EligibilityView(eligible, reason,
                profile == null ? null : profile.status(),
                profile == null ? null : profile.verificationStatus(),
                adult, hasDob, optedIn, hasPreferences);
    }
}
