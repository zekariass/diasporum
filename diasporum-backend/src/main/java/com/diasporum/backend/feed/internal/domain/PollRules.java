package com.diasporum.backend.feed.internal.domain;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Stateless Poll validation, lifecycle and result-calculation rules. */
public final class PollRules {

    public static final int MIN_OPTIONS = 2;
    public static final int MAX_OPTIONS = 20;
    public static final int DEFAULT_MAX_OPTIONS = 10;
    public static final int MAX_QUESTION_LENGTH = 20_000;
    public static final int MAX_OPTION_LENGTH = 250;

    private PollRules() {
    }

    public enum Status {
        ACTIVE, EXPIRED, CLOSED
    }

    public record ValidatedOptions(int maxOptions, List<String> values) {
    }

    public static String question(String value) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isEmpty() || normalized.length() > MAX_QUESTION_LENGTH) {
            throw new IllegalArgumentException("INVALID_QUESTION");
        }
        return normalized;
    }

    public static ValidatedOptions options(List<String> values, Integer requestedMax) {
        int max = requestedMax == null ? DEFAULT_MAX_OPTIONS : requestedMax;
        validateMaxOptions(max, values == null ? 0 : values.size());
        if (values == null || values.size() < MIN_OPTIONS || values.size() > max) {
            throw new IllegalArgumentException("INVALID_OPTIONS");
        }
        List<String> normalized = new ArrayList<>(values.size());
        Set<String> unique = new HashSet<>();
        for (String value : values) {
            String text = value == null ? "" : value.trim();
            if (text.isEmpty() || text.length() > MAX_OPTION_LENGTH) {
                throw new IllegalArgumentException("INVALID_OPTION_TEXT");
            }
            if (!unique.add(text.toLowerCase(Locale.ROOT))) {
                throw new IllegalArgumentException("DUPLICATE_OPTION");
            }
            normalized.add(text);
        }
        return new ValidatedOptions(max, List.copyOf(normalized));
    }

    public static void validateMaxOptions(int maxOptions, int optionCount) {
        if (maxOptions < MIN_OPTIONS || maxOptions > MAX_OPTIONS
                || optionCount > maxOptions) {
            throw new IllegalArgumentException("INVALID_MAX_OPTIONS");
        }
    }

    public static Instant futureDeadline(Instant closesAt, Instant databaseNow) {
        if (closesAt != null && (databaseNow == null || !closesAt.isAfter(databaseNow))) {
            throw new IllegalArgumentException("INVALID_POLL_DEADLINE");
        }
        return closesAt;
    }

    public static Status status(Instant closesAt, Instant closedAt, Instant databaseNow) {
        if (closedAt != null) {
            return Status.CLOSED;
        }
        if (closesAt != null && databaseNow != null && !closesAt.isAfter(databaseNow)) {
            return Status.EXPIRED;
        }
        return Status.ACTIVE;
    }

    public static boolean resultsVisible(String visibility, boolean viewerVoted,
            Status status) {
        return "IMMEDIATE".equals(visibility)
                || ("AFTER_VOTING".equals(visibility) && viewerVoted)
                || ("AFTER_CLOSE".equals(visibility) && status != Status.ACTIVE);
    }

    /** Percentages intentionally use distinct voters, including multi-select. */
    public static BigDecimal percentage(long optionVotes, long totalVoters) {
        if (totalVoters == 0) {
            return BigDecimal.ZERO.setScale(1);
        }
        return BigDecimal.valueOf(optionVotes).multiply(BigDecimal.valueOf(100))
                .divide(BigDecimal.valueOf(totalVoters), 1, RoundingMode.HALF_UP);
    }
}
