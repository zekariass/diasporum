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

/**
 * Privacy-safe discovery, candidate detail, and received-LIKE projections.
 * Transactions are read/write because a first-time blurred derivative is
 * generated lazily inside the read path (idempotent single write).
 */
@Service
public class DiscoveryService {

    private final MatchmakingRepository repository;
    private final MatchmakingAccess access;
    private final MatchmakingProfileVisibilityService visibility;
    private final CommunityApi community;

    public DiscoveryService(MatchmakingRepository repository, MatchmakingAccess access,
            MatchmakingProfileVisibilityService visibility, CommunityApi community) {
        this.repository = repository;
        this.access = access;
        this.visibility = visibility;
        this.community = community;
    }

    @Transactional
    public Page<PublicProfileView> discover(UUID actor, String cursor, int size) {
        access.requireEligible(actor);
        var context = community.requireActiveModule(actor, "MATCHMAKING");
        int limit = MatchmakingSupport.limit(size);
        List<PublicProfileRow> rows = repository.discover(actor, context.communityId(),
                MatchmakingSupport.uuidCursor(cursor), limit + 1);
        return profilePage(actor, rows, limit);
    }

    @Transactional
    public Page<PublicProfileView> receivedLikes(UUID actor, String cursor, int size) {
        access.requireEligible(actor);
        int limit = MatchmakingSupport.limit(size);
        List<PublicProfileRow> rows = repository.receivedLikes(actor,
                MatchmakingSupport.uuidCursor(cursor), limit + 1);
        return profilePage(actor, rows, limit);
    }

    @Transactional
    public Page<PublicProfileView> sentLikes(UUID actor, String cursor, int size) {
        access.requireEligible(actor);
        int limit = MatchmakingSupport.limit(size);
        return profilePage(actor, repository.sentLikes(actor,
                MatchmakingSupport.uuidCursor(cursor), limit + 1), limit);
    }

    @Transactional
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
        return repository.publicProfile(target).map(row -> visibility.resolve(actor, row))
                .orElseThrow(() -> MatchmakingSupport.notFound("MATCHMAKING_PROFILE_NOT_FOUND"));
    }

    @Transactional
    public PublicProfileView preview(UUID actor) {
        access.requireAdult(actor);
        return repository.publicProfile(actor).map(row -> visibility.resolve(actor, row))
                .orElseThrow(() -> MatchmakingSupport.notFound("MATCHMAKING_PROFILE_NOT_FOUND"));
    }

    private Page<PublicProfileView> profilePage(UUID actor, List<PublicProfileRow> rows,
            int limit) {
        String next = null;
        if (rows.size() > limit) {
            rows = rows.subList(0, limit);
            next = MatchmakingSupport.cursor(rows.get(rows.size() - 1).userId());
        }
        return new Page<>(visibility.resolveAll(actor, rows), next);
    }
}
