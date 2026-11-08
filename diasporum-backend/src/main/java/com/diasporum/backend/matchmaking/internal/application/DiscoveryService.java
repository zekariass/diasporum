package com.diasporum.backend.matchmaking.internal.application;

import com.diasporum.backend.community.CommunityApi;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.Page;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PublicProfileRow;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PublicProfileView;
import com.diasporum.backend.matchmaking.internal.infrastructure.persistence.MatchmakingRepository;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Privacy-safe discovery, candidate detail, and received-LIKE projections. */
@Service
public class DiscoveryService {

    private final MatchmakingRepository repository;
    private final MatchmakingAccess access;
    private final ProfileProjections projections;
    private final CommunityApi community;

    public DiscoveryService(MatchmakingRepository repository, MatchmakingAccess access,
            ProfileProjections projections, CommunityApi community) {
        this.repository = repository;
        this.access = access;
        this.projections = projections;
        this.community = community;
    }

    @Transactional(readOnly = true)
    public Page<PublicProfileView> discover(UUID actor, String cursor, int size) {
        access.requireEligible(actor);
        var context = community.requireActiveModule(actor, "MATCHMAKING");
        int limit = MatchmakingSupport.limit(size);
        List<PublicProfileRow> rows = repository.discover(actor, context.communityId(),
                MatchmakingSupport.uuidCursor(cursor), limit + 1);
        return profilePage(rows, limit);
    }

    @Transactional(readOnly = true)
    public Page<PublicProfileView> receivedLikes(UUID actor, String cursor, int size) {
        access.requireEligible(actor);
        int limit = MatchmakingSupport.limit(size);
        List<PublicProfileRow> rows = repository.receivedLikes(actor,
                MatchmakingSupport.uuidCursor(cursor), limit + 1);
        return profilePage(rows, limit);
    }

    @Transactional(readOnly = true)
    public Page<PublicProfileView> sentLikes(UUID actor, String cursor, int size) {
        access.requireEligible(actor);
        int limit = MatchmakingSupport.limit(size);
        return profilePage(repository.sentLikes(actor, MatchmakingSupport.uuidCursor(cursor), limit + 1), limit);
    }

    @Transactional(readOnly = true)
    public PublicProfileView profile(UUID actor, UUID target) {
        access.requireEligible(actor);
        if (actor.equals(target)) {
            throw MatchmakingSupport.notFound("MATCHMAKING_PROFILE_NOT_FOUND");
        }
        access.requireUnblocked(actor, target);
        if (!repository.activeMatchForPair(actor, target)) {
            var context = community.requireActiveModule(actor, "MATCHMAKING");
            if (!community.isActiveMember(target, context.communityId())) {
                throw MatchmakingSupport.notFound("MATCHMAKING_PROFILE_NOT_FOUND");
            }
            access.requireDiscoverableTarget(actor, target);
            if (!repository.compatible(actor, target)
                    || repository.matchExistsForPair(actor, target)
                    || repository.swipe(actor, target).filter(s -> "ACTIVE".equals(s.status())
                        && "PASS".equals(s.action())).isPresent()) {
                throw MatchmakingSupport.notFound("MATCHMAKING_PROFILE_NOT_FOUND");
            }
        }
        return repository.publicProfile(target).map(projections::publicProfile)
                .orElseThrow(() -> MatchmakingSupport.notFound("MATCHMAKING_PROFILE_NOT_FOUND"));
    }

    @Transactional(readOnly = true)
    public PublicProfileView preview(UUID actor) {
        access.requireAdult(actor);
        return repository.publicProfile(actor).map(projections::publicProfile)
                .orElseThrow(() -> MatchmakingSupport.notFound("MATCHMAKING_PROFILE_NOT_FOUND"));
    }

    private Page<PublicProfileView> profilePage(List<PublicProfileRow> rows, int limit) {
        String next = null;
        if (rows.size() > limit) {
            rows = rows.subList(0, limit);
            next = MatchmakingSupport.cursor(rows.get(rows.size() - 1).userId());
        }
        return new Page<>(rows.stream().map(projections::publicProfile).toList(), next);
    }
}
