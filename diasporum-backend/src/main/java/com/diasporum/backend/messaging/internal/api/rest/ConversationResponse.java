package com.diasporum.backend.messaging.internal.api.rest;

import com.diasporum.backend.messaging.internal.application.MessagingService.ConversationView;
import com.diasporum.backend.messaging.internal.application.MessagingService.ParticipantView;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** REST projection with the badge derived from the linked match lifecycle. */
public record ConversationResponse(UUID id, String contextType, UUID contextId,
        String status, boolean matched, ParticipantView self, ParticipantView other,
        long lastMessageSeq, Instant lastMessageAt, String lastMessagePreview,
        long unreadCount, Instant archivedAt, Instant mutedUntil,
        UUID pendingRequestId, String pendingRequestDirection, Instant createdAt) {

    static ConversationResponse from(ConversationView value, boolean matched) {
        return new ConversationResponse(value.id(), value.contextType(), value.contextId(),
                value.status(), matched, value.self(), value.other(), value.lastMessageSeq(),
                value.lastMessageAt(), value.lastMessagePreview(), value.unreadCount(),
                value.archivedAt(), value.mutedUntil(), value.pendingRequestId(),
                value.pendingRequestDirection(), value.createdAt());
    }

    record Page(List<ConversationResponse> items, String nextCursor) {
    }

    static Map<String, Object> detail(ConversationView value, boolean matched,
            Object participants) {
        return Map.of("conversation", from(value, matched), "participants", participants);
    }
}
