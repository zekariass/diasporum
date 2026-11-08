package com.diasporum.backend.matchmaking.internal.application;

import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.SwipeResult;
import com.diasporum.backend.matchmaking.internal.infrastructure.persistence.MatchmakingRepository;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Cancels only the actor's current outgoing ACTIVE LIKE before a match. */
@Service
public class CancelLikeService {

    private final MatchmakingRepository repository;
    private final MatchmakingAccess access;

    public CancelLikeService(MatchmakingRepository repository, MatchmakingAccess access) {
        this.repository = repository;
        this.access = access;
    }

    @Transactional
    public SwipeResult cancel(UUID actor, UUID target) {
        access.requireEligible(actor);
        repository.actorLock(actor);
        repository.pairLock(actor, target);
        access.requireUnblocked(actor, target);
        var swipe = repository.swipe(actor, target).orElseThrow(
                () -> MatchmakingSupport.conflict("MATCHMAKING_LIKE_NOT_ACTIVE"));
        var history = repository.latestSwipeForPair(actor, target).orElseThrow(
                () -> MatchmakingSupport.conflict("MATCHMAKING_LIKE_NOT_ACTIVE"));
        if (!"LIKE".equals(swipe.action()) || !"ACTIVE".equals(swipe.status())
                || !"LIKE".equals(history.action())
                || repository.matchExistsForPair(actor, target)) {
            throw MatchmakingSupport.conflict("MATCHMAKING_LIKE_NOT_ACTIVE");
        }
        repository.reverseSwipe(history, "LIKE_CANCELLED", "WITHDRAWN");
        return new SwipeResult("LIKE", "WITHDRAWN", false, null, null);
    }
}
