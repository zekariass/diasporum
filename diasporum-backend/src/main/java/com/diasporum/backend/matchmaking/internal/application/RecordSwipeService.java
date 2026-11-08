package com.diasporum.backend.matchmaking.internal.application;

import com.diasporum.backend.billing.BillingApi;
import com.diasporum.backend.community.CommunityApi;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.SwipeResult;
import com.diasporum.backend.matchmaking.internal.infrastructure.persistence.MatchmakingRepository;
import com.diasporum.backend.messaging.MessagingApi;
import com.diasporum.backend.notifications.NotificationsApi;
import com.diasporum.backend.notifications.NotificationsApi.NotificationCommand;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Records a LIKE/PASS and atomically orchestrates a mutual match. */
@Service
public class RecordSwipeService {

    private static final Set<String> ACTIONS = Set.of("LIKE", "PASS");

    private final MatchmakingRepository repository;
    private final MatchmakingAccess access;
    private final MessagingApi messaging;
    private final BillingApi billing;
    private final NotificationsApi notifications;
    private final CommunityApi community;

    public RecordSwipeService(MatchmakingRepository repository, MatchmakingAccess access,
            MessagingApi messaging, BillingApi billing,
            NotificationsApi notifications, CommunityApi community) {
        this.repository = repository;
        this.access = access;
        this.messaging = messaging;
        this.billing = billing;
        this.notifications = notifications;
        this.community = community;
    }

    @Transactional
    public SwipeResult record(UUID actor, UUID target, String action) {
        if (actor.equals(target) || !ACTIONS.contains(action)) {
            throw MatchmakingSupport.bad("INVALID_MATCHMAKING_SWIPE");
        }
        access.requireEligible(actor);
        var context = community.requireActiveModule(actor, "MATCHMAKING");
        repository.actorLock(actor);
        repository.pairLock(actor, target);
        access.requireDiscoverableTarget(actor, target);
        if (!repository.compatible(actor, target)) {
            throw MatchmakingSupport.conflict("MATCHMAKING_PROFILES_INCOMPATIBLE");
        }
        var existing = repository.swipe(actor, target).orElse(null);
        if (existing == null && !community.isActiveMember(target, context.communityId())) {
            throw MatchmakingSupport.notFound("MATCHMAKING_PROFILE_NOT_FOUND");
        }
        var match = repository.matchForPair(actor, target).orElse(null);
        if (match != null && !"MATCHED".equals(match.status())) {
            throw MatchmakingSupport.conflict("MATCHMAKING_SWIPE_CONFLICT");
        }
        if (existing != null && "ACTIVE".equals(existing.status())) {
            if (!action.equals(existing.action())) {
                throw MatchmakingSupport.conflict("MATCHMAKING_SWIPE_CONFLICT");
            }
            return new SwipeResult(action, "ACTIVE", match != null,
                    match == null ? null : match.id(),
                    match == null ? null : messaging.conversationIdForMatch(match.id()).orElse(null));
        }
        if (match != null) throw MatchmakingSupport.conflict("MATCHMAKING_SWIPE_CONFLICT");

        UUID historyEventId = repository.insertSwipe(actor, target, action,
                context.communityId());
        if (context.isDefault()) {
            billing.consumePersonalFeature(actor, "MATCHMAKING_INTERACT",
                    historyEventId.toString());
        } else if ("LIKE".equals(action)) {
            community.consumeExtendedAction(actor, context.communityId(),
                    "EXTENDED_MATCHMAKING_LIKE", historyEventId.toString());
        }
        if ("LIKE".equals(action)) {
            notifyLike(actor, target);
        }
        if (!"LIKE".equals(action) || !repository.reciprocalActiveLike(actor, target)) {
            return new SwipeResult(action, "ACTIVE", false, null, null);
        }

        UUID matchId = repository.insertMatch(actor, target);
        UUID conversationId = messaging.ensureAcceptedGeneralConversation(actor, target, matchId);
        notifyMatch(actor, matchId);
        notifyMatch(target, matchId);
        repository.outbox(actor, "MATCHMAKING_MATCHED", matchId,
                "matchmaking-matched:" + matchId + ":" + actor);
        repository.outbox(target, "MATCHMAKING_MATCHED", matchId,
                "matchmaking-matched:" + matchId + ":" + target);
        return new SwipeResult(action, "ACTIVE", true, matchId, conversationId);
    }

    private void notifyLike(UUID actor, UUID target) {
        notifications.create(new NotificationCommand(target, "MATCHMAKING_LIKE",
                "New matchmaking like", "Someone liked your matchmaking profile",
                "MATCHMAKING_PROFILE", actor, "matchmaking-like:" + actor + ":" + target));
    }

    private void notifyMatch(UUID recipient, UUID matchId) {
        notifications.create(new NotificationCommand(recipient, "MATCHMAKING_MATCH",
                "It is a match", "You have a new mutual match", "MATCHMAKING_MATCH",
                matchId, "matchmaking-match:" + matchId + ":" + recipient));
    }
}
