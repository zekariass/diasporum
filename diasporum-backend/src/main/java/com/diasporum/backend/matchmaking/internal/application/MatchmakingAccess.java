package com.diasporum.backend.matchmaking.internal.application;

import com.diasporum.backend.matchmaking.internal.infrastructure.persistence.MatchmakingRepository;
import com.diasporum.backend.social.SocialApi;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** Central authorization policy shared by read and write use cases. */
@Component
public class MatchmakingAccess {

    private final MatchmakingRepository repository;
    private final SocialApi social;

    public MatchmakingAccess(MatchmakingRepository repository, SocialApi social) {
        this.repository = repository;
        this.social = social;
    }

    public void requireAdult(UUID userId) {
        if (!repository.adult(userId)) {
            throw MatchmakingSupport.forbidden("MATCHMAKING_NOT_ELIGIBLE");
        }
    }

    public void requireEligible(UUID userId) {
        requireAdult(userId);
        if (!repository.eligible(userId)) {
            throw MatchmakingSupport.forbidden("MATCHMAKING_NOT_ELIGIBLE");
        }
    }

    public void requireDiscoverableTarget(UUID actor, UUID target) {
        if (!repository.eligible(target) || !social.canInteract(actor, target)) {
            throw MatchmakingSupport.notFound("MATCHMAKING_PROFILE_NOT_FOUND");
        }
    }

    public void requireUnblocked(UUID actor, UUID target) {
        if (!repository.adult(target) || !social.canInteract(actor, target)) {
            throw MatchmakingSupport.notFound("MATCHMAKING_PROFILE_NOT_FOUND");
        }
    }
}
