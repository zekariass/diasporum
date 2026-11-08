package com.diasporum.backend.matchmaking.internal.application;

import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.MatchPageRow;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.MatchRow;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.MatchView;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.Page;
import com.diasporum.backend.matchmaking.internal.infrastructure.persistence.MatchmakingRepository;
import com.diasporum.backend.messaging.MessagingApi;
import com.diasporum.backend.moderation.ModerationApi;
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
    private final ModerationApi moderation;

    public MatchService(MatchmakingRepository repository, MatchmakingAccess access,
            ProfileProjections projections, MessagingApi messaging, ModerationApi moderation) {
        this.repository = repository;
        this.access = access;
        this.projections = projections;
        this.messaging = messaging;
        this.moderation = moderation;
    }

    @Transactional(readOnly = true)
    public Page<MatchView> matches(UUID actor, String cursor, int size) {
        access.requireAdult(actor);
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
        access.requireAdult(actor);
        MatchRow match = repository.match(matchId).orElseThrow(
                () -> MatchmakingSupport.notFound("MATCHMAKING_MATCH_NOT_FOUND"));
        if (!match.includes(actor)) {
            throw MatchmakingSupport.notFound("MATCHMAKING_MATCH_NOT_FOUND");
        }
        UUID other = match.other(actor);
        access.requireUnblocked(actor, other);
        for (UUID user : List.of(actor, other)) {
            var state = repository.profile(user).orElseThrow(
                    () -> MatchmakingSupport.notFound("MATCHMAKING_MATCH_NOT_FOUND"));
            if (Set.of("SUSPENDED", "DELETED").contains(state.status())
                    || Set.of("REJECTED", "REVOKED").contains(state.verificationStatus())) {
                throw MatchmakingSupport.notFound("MATCHMAKING_MATCH_NOT_FOUND");
            }
        }
        var profile = repository.publicProfile(other).orElseThrow(
                () -> MatchmakingSupport.notFound("MATCHMAKING_MATCH_NOT_FOUND"));
        return view(actor, match, profile);
    }

    @Transactional
    public UUID report(UUID actor, UUID matchId, String reason, String details) {
        access.requireAdult(actor);
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
        return moderation.report(actor, "MATCHMAKING_MATCH", matchId, null, null, normalized, details);
    }

    @Transactional
    public UUID reportProfile(UUID actor, UUID target, String reason, String details) {
        access.requireAdult(actor);
        if (actor.equals(target) || repository.profile(target).isEmpty()) {
            throw MatchmakingSupport.notFound("MATCHMAKING_PROFILE_NOT_FOUND");
        }
        // Reporting remains available after blocking; never reveal reporter identity.
        String normalized = reason == null ? "" : reason.trim().toUpperCase(Locale.ROOT);
        return moderation.report(actor, "MATCHMAKING_PROFILE", target, null, null, normalized, details);
    }

    private MatchView view(UUID actor, MatchRow match,
            com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PublicProfileRow other) {
        return new MatchView(match.id(), match.status(), projections.publicProfile(other),
                match.matchedAt(), match.closedAt(),
                "MATCHED".equals(match.status()) ? messaging.conversationIdForMatch(match.id()).orElse(null) : null);
    }
}
