package com.diasporum.backend.feed.internal.api.rest;

import com.diasporum.backend.feed.internal.domain.PollRules;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Shared Poll response used by detail, mutations and Feed payloads. */
public final class PollResponses {

    private PollResponses() {
    }

    public enum ResultsVisibility {
        IMMEDIATE, AFTER_VOTING, AFTER_CLOSE
    }

    public record PollOptionResponse(
            UUID id,
            String text,
            int sortOrder,
            Long voteCount,
            BigDecimal percentage) {
    }

    public record PollResponse(
            UUID postId,
            String question,
            PollRules.Status status,
            Instant closesAt,
            Instant closedAt,
            boolean allowMultiple,
            boolean allowVoteChange,
            boolean allowVoteWithdraw,
            boolean anonymousVoting,
            int maxOptions,
            ResultsVisibility resultsVisibility,
            boolean resultsVisible,
            Long totalVoters,
            Long totalVotes,
            List<UUID> myVotes,
            List<PollOptionResponse> options) {
    }

    public record ReportResponse(UUID reportId) {
    }
}
