package com.diasporum.backend.messaging.internal.api.rest;

import jakarta.validation.constraints.Size;
import java.util.UUID;

/** Request DTOs for the messaging REST surface. */
public final class Requests {

    private Requests() {
    }

    /**
     * Create/reuse a conversation. Exactly one recipient identity is required
     * except under {@code COMMUNITY_HELP_POST}, where the counterparty is the
     * post author resolved server-side.
     */
    public record CreateConversationRequest(
            String contextType,
            UUID contextId,
            UUID recipientUserId,
            UUID recipientBusinessAccountId,
            UUID actingBusinessAccountId,
            @Size(max = 10000) String initialMessage,
            @Size(max = 200) String clientMessageId) {
    }

    /** Send a text message. {@code clientMessageId} makes retries safe. */
    public record SendMessageRequest(
            @Size(max = 10000) String body,
            @Size(max = 200) String clientMessageId,
            UUID replyToMessageId) {
    }

    /** Mark-read: {@code lastReadSeq} null means "up to latest". */
    public record MarkReadRequest(Long lastReadSeq) {
    }

    /** Mute for {@code minutes}; null/absent clears the mute. */
    public record MuteRequest(Integer minutes) {
    }
}
