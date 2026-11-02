package com.diasporum.backend.messaging.internal.application;

import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Match-aware GENERAL conversation integration owned by Messaging. */
@Service
public class MatchConversationService {

    private final JdbcTemplate jdbc;
    private final MessagingService messaging;

    public MatchConversationService(JdbcTemplate jdbc, MessagingService messaging) {
        this.jdbc = jdbc;
        this.messaging = messaging;
    }

    @Transactional
    public UUID ensureAcceptedGeneralConversation(UUID userA, UUID userB, UUID matchId) {
        if (matchId == null) {
            return messaging.ensureAcceptedGeneralConversation(userA, userB);
        }
        UUID conversationId = messaging.ensureAcceptedGeneralConversation(userA, userB);
        int linked = jdbc.update("UPDATE direct_conversations SET matchmaking_match_id=?,"
                + "updated_at=now() WHERE id=? AND context_type='GENERAL'"
                + " AND (matchmaking_match_id IS NULL OR matchmaking_match_id=?)",
                matchId, conversationId, matchId);
        if (linked != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "CONVERSATION_MATCH_CONFLICT");
        }
        return conversationId;
    }

    public Optional<UUID> conversationIdForMatch(UUID matchId) {
        return jdbc.query("SELECT id FROM direct_conversations"
                        + " WHERE matchmaking_match_id=? AND context_type='GENERAL'",
                (rs, i) -> rs.getObject("id", UUID.class), matchId)
                .stream().findFirst();
    }
}
