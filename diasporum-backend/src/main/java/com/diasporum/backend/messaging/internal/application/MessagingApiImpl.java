package com.diasporum.backend.messaging.internal.application;

import com.diasporum.backend.messaging.MessagingApi;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** Delegating implementation of {@link MessagingApi}. */
@Service
public class MessagingApiImpl implements MessagingApi {

    private final MessagingService service;
    private final MatchConversationService matchConversations;

    public MessagingApiImpl(MessagingService service,
            MatchConversationService matchConversations) {
        this.service = service;
        this.matchConversations = matchConversations;
    }

    @Override
    public UUID ensureAcceptedGeneralConversation(UUID userAId, UUID userBId) {
        return service.ensureAcceptedGeneralConversation(userAId, userBId);
    }

    @Override
    public UUID ensureAcceptedGeneralConversation(UUID userAId, UUID userBId, UUID matchId) {
        return matchConversations.ensureAcceptedGeneralConversation(userAId, userBId, matchId);
    }

    @Override
    public java.util.Optional<UUID> conversationIdForMatch(UUID matchId) {
        return matchConversations.conversationIdForMatch(matchId);
    }

    @Override
    public UUID ensureContextConversation(UUID actorUserId,
            UUID actingBusinessAccountId, String contextType, UUID contextId,
            UUID recipientUserId, UUID recipientBusinessAccountId) {
        return service.ensureContextConversation(actorUserId,
                actingBusinessAccountId, contextType, contextId,
                recipientUserId, recipientBusinessAccountId);
    }

    @Override
    public boolean canAccess(UUID viewerUserId, UUID conversationId) {
        return service.canAccess(viewerUserId, conversationId);
    }
}
