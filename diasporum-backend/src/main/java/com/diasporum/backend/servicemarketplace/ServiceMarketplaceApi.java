package com.diasporum.backend.servicemarketplace;

import java.util.UUID;

/** Public cross-module authorization contract for service conversations. */
public interface ServiceMarketplaceApi {

    /**
     * Revalidates participant identities, live business membership and the
     * active chat-enabled lead grant for a SERVICE_REQUEST conversation.
     */
    boolean canAccessServiceConversation(UUID actorUserId,
            ServiceConversationContext conversation);

    /** Messaging-owned participant shape; no messaging internal types leak. */
    record ServiceConversationContext(UUID conversationId,
            UUID serviceRequestId, UUID participantAUserId,
            UUID participantABusinessAccountId, UUID participantBUserId,
            UUID participantBBusinessAccountId) {
    }
}
