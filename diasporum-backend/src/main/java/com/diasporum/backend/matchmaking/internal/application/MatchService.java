package com.diasporum.backend.matchmaking.internal.application;

import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.MatchPageRow;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.MatchRow;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.MatchView;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.Page;
import com.diasporum.backend.matchmaking.internal.infrastructure.persistence.MatchmakingRepository;
import com.diasporum.backend.messaging.MessagingApi;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Participant-safe active match pages and match detail projections. */
@Service
public class MatchService {

    private static final Set<String> REPORT_REASONS = Set.of("SPAM", "SCAM", "HARASSMENT",
            "HATE", "SEXUAL_MISCONDUCT", "MISINFORMATION", "IMPERSONATION", "PRIVACY", "OTHER");

    private final MatchmakingRepository repository;
    private final MatchmakingAccess access;
    private final ProfileProjections projections;
    private final MessagingApi messaging;

    public MatchService(MatchmakingRepository repository, MatchmakingAccess access,
            ProfileProjections projections, MessagingApi messaging) {
        this.repository = repository;
        this.access = access;
        this.projections = projections;
        this.messaging = messaging;
    }

    @Transactional(readOnly = true)
    public Page<MatchView> matches(UUID actor, String cursor, int size) {
        int limit = MatchmakingSupport.limit(size);
        var decoded = MatchmakingSupport.matchCursor(cursor);
        List<MatchPageRow> rows = repository.matches(actor,
                decoded == null ? null : decoded.matchedAt(),
                decoded == null ? null : decoded.matchId(), limit + 1);
        String next = null;
        if (rows.size() > limit) {
            rows = rows.subList(0, limit);
            var last = rows.get(rows.size() - 1).match();
            next = MatchmakingSupport.cursor(last.matchedAt(), last.id());
        }
        return new Page<>(rows.stream().map(row -> view(actor, row.match(), row.other())).toList(),
                next);
    }

    @Transactional(readOnly = true)
    public MatchView detail(UUID actor, UUID matchId) {
        MatchRow match = repository.match(matchId).orElseThrow(
                () -> MatchmakingSupport.notFound("MATCHMAKING_MATCH_NOT_FOUND"));
        if (!match.includes(actor)) {
            throw MatchmakingSupport.notFound("MATCHMAKING_MATCH_NOT_FOUND");
        }
        UUID other = match.other(actor);
        access.requireUnblocked(actor, other);
        var profile = repository.publicProfile(other).orElseThrow(
                () -> MatchmakingSupport.notFound("MATCHMAKING_MATCH_NOT_FOUND"));
        return view(actor, match, profile);
    }

    @Transactional
    public UUID report(UUID actor, UUID matchId, String reason, String details) {
        MatchRow match = repository.match(matchId).orElseThrow(
                () -> MatchmakingSupport.notFound("MATCHMAKING_MATCH_NOT_FOUND"));
        if (!match.includes(actor)) {
            throw MatchmakingSupport.notFound("MATCHMAKING_MATCH_NOT_FOUND");
        }
        String normalized = reason == null ? null : reason.trim().toUpperCase(Locale.ROOT);
        if (normalized == null || !REPORT_REASONS.contains(normalized)) {
            throw MatchmakingSupport.bad("INVALID_REPORT_REASON");
        }
        if (details != null && details.length() > 4000) {
            throw MatchmakingSupport.bad("REPORT_DETAILS_TOO_LONG");
        }
        return repository.createMatchReport(actor, matchId, normalized, details)
                .orElseThrow(() -> MatchmakingSupport.conflict("REPORT_DUPLICATE"));
    }

    private MatchView view(UUID actor, MatchRow match,
            com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PublicProfileRow other) {
        return new MatchView(match.id(), match.status(), projections.publicProfile(other),
                match.matchedAt(), match.closedAt(),
                messaging.conversationIdForMatch(match.id()).orElse(null));
    }
}
