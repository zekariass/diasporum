package com.diasporum.backend.messaging.internal.application;

import com.diasporum.backend.messaging.internal.realtime.AblyGateway;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * M4 — Ephemeral typing indicators. Events are published directly to Ably
 * (bypassing the transactional outbox) because they are ephemeral and must
 * never be persisted or replayed. Authorization is enforced server-side before
 * any publish: the actor must be an active participant, conversations must be
 * ACCEPTED, and the user identity in the event is always set by the backend —
 * clients cannot impersonate other participants.
 */
@Service
public class TypingService {

    private static final Logger log = LoggerFactory.getLogger(TypingService.class);

    private final JdbcTemplate jdbc;
    private final AblyGateway ably;
    private final MessagingService messaging;

    public TypingService(JdbcTemplate jdbc, AblyGateway ably, MessagingService messaging) {
        this.jdbc = jdbc;
        this.ably = ably;
        this.messaging = messaging;
    }

    /**
     * Publishes a TYPING_STARTED or TYPING_STOPPED event to all other
     * participants' personal user channels. Validates that the actor is an
     * active participant in an ACCEPTED conversation before publishing.
     *
     * @param actor          authenticated user
     * @param conversationId target conversation
     * @param typing         true = started, false = stopped
     */
    public void publishTyping(UUID actor, UUID conversationId, boolean typing) {
        // Verify conversation is ACCEPTED (no typing in REQUESTED/DECLINED).
        String status = jdbc.query(
                "SELECT status::text FROM direct_conversations WHERE id=?",
                (rs, i) -> rs.getString(1), conversationId)
                .stream().findFirst()
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "CONVERSATION_NOT_FOUND"));
        if (!"ACCEPTED".equals(status)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "TYPING_NOT_ALLOWED_IN_NON_ACCEPTED_CONVERSATION");
        }

        // Verify actor is a participant.
        Set<UUID> allParticipants = messaging.conversationParticipantUserIds(conversationId);
        if (!allParticipants.contains(actor)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "NOT_CONVERSATION_PARTICIPANT");
        }
        if (!ably.isUsable()) {
            return; // Realtime disabled — silently skip (REST still works).
        }

        String eventName = typing ? "TYPING_STARTED" : "TYPING_STOPPED";
        Map<String, Object> payload = Map.of(
                "type", eventName,
                "conversationId", conversationId.toString(),
                "userId", actor.toString());

        // Publish to every OTHER participant's personal channel.
        for (UUID recipientId : allParticipants) {
            if (recipientId.equals(actor)) continue;
            try {
                ably.publish("user:" + recipientId, eventName, payload);
            } catch (AblyGateway.AblyPublishException e) {
                log.warn("typing publish to user:{} failed: {}", recipientId, e.getMessage());
            }
        }
    }
}
