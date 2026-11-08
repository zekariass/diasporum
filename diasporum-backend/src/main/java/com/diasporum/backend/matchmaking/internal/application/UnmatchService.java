package com.diasporum.backend.matchmaking.internal.application;

import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.MatchView;
import com.diasporum.backend.matchmaking.internal.infrastructure.persistence.MatchmakingRepository;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Closes the match and linked chat; messages and independent relationships remain. */
@Service
public class UnmatchService {

    private final MatchmakingRepository repository;
    private final MatchService matches;

    public UnmatchService(MatchmakingRepository repository, MatchService matches) {
        this.repository = repository;
        this.matches = matches;
    }

    @Transactional
    public MatchView unmatch(UUID actor, UUID matchId, String reason) {
        if (reason != null && (reason.isBlank() || reason.length() > 500)) {
            throw MatchmakingSupport.bad("INVALID_UNMATCH_REASON");
        }
        var participant = repository.match(matchId).orElseThrow(
                () -> MatchmakingSupport.notFound("MATCHMAKING_MATCH_NOT_FOUND"));
        if (!participant.includes(actor) || !repository.adult(actor)) {
            throw MatchmakingSupport.notFound("MATCHMAKING_MATCH_NOT_FOUND");
        }
        repository.pairLock(participant.userAId(), participant.userBId());
        var match = repository.matchForUpdate(matchId).orElseThrow(
                () -> MatchmakingSupport.notFound("MATCHMAKING_MATCH_NOT_FOUND"));
        if (!match.includes(actor)) {
            throw MatchmakingSupport.notFound("MATCHMAKING_MATCH_NOT_FOUND");
        }
        if ("UNMATCHED".equals(match.status())) {
            return matches.detail(actor, matchId);
        }
        if (!"MATCHED".equals(match.status())) {
            throw MatchmakingSupport.conflict("MATCHMAKING_MATCH_NOT_ACTIVE");
        }
        if (!repository.unmatch(matchId, actor, reason == null ? "User unmatch" : reason)) {
            throw MatchmakingSupport.conflict("MATCHMAKING_MATCH_NOT_ACTIVE");
        }
        repository.outbox(match.userAId(), "MATCHMAKING_UNMATCHED", matchId,
                "matchmaking-unmatched:" + matchId + ":" + match.userAId());
        repository.outbox(match.userBId(), "MATCHMAKING_UNMATCHED", matchId,
                "matchmaking-unmatched:" + matchId + ":" + match.userBId());
        return matches.detail(actor, matchId);
    }
}
