package com.diasporum.backend.matchmaking.internal.application;

import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.SwipeResult;
import com.diasporum.backend.matchmaking.internal.infrastructure.persistence.MatchmakingRepository;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Rewinds only the latest eligible unreversed SWIPE; no client-selected target. */
@Service
public class RewindSwipeService {

    private final MatchmakingRepository repository;
    private final MatchmakingAccess access;

    public RewindSwipeService(MatchmakingRepository repository, MatchmakingAccess access) {
        this.repository = repository;
        this.access = access;
    }

    @Transactional
    public SwipeResult rewind(UUID actor) {
        access.requireEligible(actor);
        repository.actorLock(actor);
        var latest = repository.latestUnreversedSwipe(actor).orElseThrow(
                () -> MatchmakingSupport.conflict("MATCHMAKING_REWIND_NOT_AVAILABLE"));
        repository.pairLock(actor, latest.targetUserId());
        access.requireDiscoverableTarget(actor, latest.targetUserId());
        if (repository.matchExistsForPair(actor, latest.targetUserId())) {
            throw MatchmakingSupport.conflict("MATCHMAKING_REWIND_NOT_AVAILABLE");
        }
        repository.reverseSwipe(latest, "REWOUND", "REWOUND");
        return new SwipeResult(latest.action(), "REWOUND", false, null, null);
    }
}
