package com.diasporum.backend.matchmaking.internal.application;

import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PreferenceCommand;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PreferenceView;
import com.diasporum.backend.matchmaking.internal.infrastructure.persistence.MatchmakingRepository;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Atomic replacement and validation of reciprocal discovery preferences. */
@Service
public class PreferenceService {

    private static final Set<String> CHILDREN = Set.of("ANY", "YES", "NO");
    private static final Set<String> WANTS_CHILDREN = Set.of("ANY", "YES", "NO", "UNSURE");

    private final MatchmakingRepository repository;

    public PreferenceService(MatchmakingRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public PreferenceView preferences(UUID actor) {
        return repository.preferences(actor).orElseThrow(
                () -> MatchmakingSupport.notFound("MATCHMAKING_PREFERENCES_NOT_FOUND"));
    }

    @Transactional
    public PreferenceView replace(UUID actor, PreferenceCommand command) {
        var profile = repository.profile(actor).orElseThrow(
                () -> MatchmakingSupport.notFound("MATCHMAKING_PROFILE_NOT_FOUND"));
        if ("DELETED".equals(profile.status())) {
            throw MatchmakingSupport.conflict("MATCHMAKING_PROFILE_NOT_EDITABLE");
        }
        validate(command);
        var normalized = new PreferenceCommand(command.minAge(), command.maxAge(),
                command.maxDistanceKm(), command.showVerifiedOnly(),
                command.hasChildrenPreference(), command.wantsChildrenPreference(),
                command.genderKeys().stream().distinct().toList(),
                command.religionIds().stream().distinct().toList(),
                command.languageIds().stream().distinct().toList());
        repository.replacePreferences(actor, normalized);
        return preferences(actor);
    }

    private void validate(PreferenceCommand c) {
        if (c == null || c.minAge() == null || c.maxAge() == null
                || c.showVerifiedOnly() == null || c.genderKeys() == null
                || c.religionIds() == null || c.languageIds() == null
                || c.minAge() < 18 || c.maxAge() > 110 || c.maxAge() < c.minAge()
                || c.maxDistanceKm() != null
                    && (c.maxDistanceKm() < 1 || c.maxDistanceKm() > 20_000)
                || !CHILDREN.contains(c.hasChildrenPreference())
                || !WANTS_CHILDREN.contains(c.wantsChildrenPreference())) {
            throw MatchmakingSupport.bad("INVALID_MATCHMAKING_PREFERENCES");
        }
        if (repository.invalidGenders(c.genderKeys()) != 0
                || repository.invalidReligions(c.religionIds()) != 0
                || repository.invalidLanguages(c.languageIds()) != 0) {
            throw MatchmakingSupport.bad("INVALID_MATCHMAKING_REFERENCE");
        }
    }
}
