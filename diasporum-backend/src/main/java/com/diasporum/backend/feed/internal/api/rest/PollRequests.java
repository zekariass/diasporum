package com.diasporum.backend.feed.internal.api.rest;

import com.diasporum.backend.feed.internal.api.rest.PollResponses.ResultsVisibility;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Typed request bodies for Poll and Feed-post reporting endpoints. */
public final class PollRequests {

    private PollRequests() {
    }

    public record CreatePollRequest(
            @NotNull UUID communityId,
            @NotNull UUID categoryId,
            @NotNull @Size(max = 20_000) String question,
            @NotNull @Size(min = 2, max = 20) List<@NotNull String> options,
            @Min(2) @Max(20) Integer maxOptions,
            Instant closesAt,
            Boolean allowMultiple,
            Boolean allowVoteChange,
            Boolean allowVoteWithdraw,
            Boolean anonymousVoting,
            ResultsVisibility resultsVisibility) {

        public CreatePollRequest {
            maxOptions = maxOptions == null ? 10 : maxOptions;
            allowMultiple = Boolean.TRUE.equals(allowMultiple);
            allowVoteChange = Boolean.TRUE.equals(allowVoteChange);
            allowVoteWithdraw = Boolean.TRUE.equals(allowVoteWithdraw);
            anonymousVoting = Boolean.TRUE.equals(anonymousVoting);
            resultsVisibility = resultsVisibility == null
                    ? ResultsVisibility.AFTER_VOTING : resultsVisibility;
        }
    }

    public record UpdatePollRequest(
            @Size(max = 20_000) String question,
            @Size(min = 2, max = 20) List<@NotNull String> options,
            @Min(2) @Max(20) Integer maxOptions,
            Instant closesAt,
            Boolean allowMultiple,
            Boolean allowVoteChange,
            Boolean allowVoteWithdraw,
            Boolean anonymousVoting,
            ResultsVisibility resultsVisibility) {

        public boolean changesOptionsOrPolicy() {
            return options != null || maxOptions != null || allowMultiple != null
                    || allowVoteChange != null || allowVoteWithdraw != null
                    || anonymousVoting != null || resultsVisibility != null;
        }

        public boolean changesPolicy() {
            return maxOptions != null || allowMultiple != null
                    || allowVoteChange != null || allowVoteWithdraw != null
                    || anonymousVoting != null || resultsVisibility != null;
        }
    }

    public record VoteRequest(Boolean withdraw) {
        public VoteRequest {
            withdraw = Boolean.TRUE.equals(withdraw);
        }
    }

    public record ReportPostRequest(
            @NotBlank @Size(max = 50) String reason,
            @Size(max = 4_000) String details) {
    }
}
