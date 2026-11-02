package com.diasporum.backend.messaging.internal.application;

import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Read-only match badge projection; no match state is duplicated in Messaging. */
@Component
public class ConversationMatchProjection {

    private final JdbcTemplate jdbc;

    public ConversationMatchProjection(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean isMatched(UUID conversationId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1"
                + " FROM direct_conversations dc JOIN matchmaking_matches mm"
                + " ON mm.id=dc.matchmaking_match_id AND mm.status='MATCHED'"
                + " WHERE dc.id=?)", Boolean.class, conversationId));
    }

    public Map<UUID, Boolean> matchedFor(Collection<UUID> conversationIds) {
        Map<UUID, Boolean> result = new HashMap<>();
        if (conversationIds == null || conversationIds.isEmpty()) {
            return result;
        }
        String placeholders = String.join(",",
                java.util.Collections.nCopies(conversationIds.size(), "?"));
        jdbc.query("SELECT dc.id,(mm.status='MATCHED') AS matched"
                        + " FROM direct_conversations dc JOIN matchmaking_matches mm"
                        + " ON mm.id=dc.matchmaking_match_id WHERE dc.id IN (" + placeholders + ")",
                rs -> {
                    result.put(rs.getObject("id", UUID.class), rs.getBoolean("matched"));
                }, conversationIds.toArray());
        return result;
    }
}
