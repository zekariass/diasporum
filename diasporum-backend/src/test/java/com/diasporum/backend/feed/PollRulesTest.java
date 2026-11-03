package com.diasporum.backend.feed;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.diasporum.backend.feed.internal.domain.PollRules;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class PollRulesTest {

    @Test
    void questionUsesTrimmedLengthAndBoundaries() {
        assertEquals("Question?", PollRules.question("  Question?  "));
        assertEquals("x", PollRules.question("x"));
        assertEquals(20_000, PollRules.question("x".repeat(20_000)).length());
        assertThrows(IllegalArgumentException.class, () -> PollRules.question("  "));
        assertThrows(IllegalArgumentException.class,
                () -> PollRules.question("x".repeat(20_001)));
    }

    @Test
    void optionsDefaultToTenAndNormalize() {
        var result = PollRules.options(List.of(" Yes ", "No"), null);
        assertEquals(10, result.maxOptions());
        assertEquals(List.of("Yes", "No"), result.values());
        assertEquals(250, PollRules.options(
                List.of("x".repeat(250), "other"), 2).values().get(0).length());
    }

    @Test
    void optionCountAndMaximumAreEnforced() {
        assertThrows(IllegalArgumentException.class,
                () -> PollRules.options(List.of("only"), 10));
        assertThrows(IllegalArgumentException.class,
                () -> PollRules.options(List.of("one", "two", "three"), 2));
        assertThrows(IllegalArgumentException.class,
                () -> PollRules.options(List.of("one", "two"), 1));
        assertThrows(IllegalArgumentException.class,
                () -> PollRules.options(List.of("one", "two"), 21));
        assertThrows(IllegalArgumentException.class,
                () -> PollRules.options(List.of("one", "x".repeat(251)), 10));
    }

    @Test
    void duplicateOptionsAreTrimmedAndCaseInsensitive() {
        assertThrows(IllegalArgumentException.class,
                () -> PollRules.options(List.of(" Yes ", "yes"), 10));
        assertThrows(IllegalArgumentException.class,
                () -> PollRules.options(List.of("YES", "yes "), 10));
    }

    @Test
    void deadlinesAndLifecycleUseTheDatabaseClock() {
        Instant now = Instant.parse("2026-01-01T00:00:00Z");
        assertEquals(now.plusSeconds(60),
                PollRules.futureDeadline(now.plusSeconds(60), now));
        assertThrows(IllegalArgumentException.class,
                () -> PollRules.futureDeadline(now, now));
        assertEquals(PollRules.Status.ACTIVE,
                PollRules.status(now.plusSeconds(60), null, now));
        assertEquals(PollRules.Status.EXPIRED,
                PollRules.status(now, null, now));
        assertEquals(PollRules.Status.CLOSED,
                PollRules.status(now.plusSeconds(60), now, now));
    }

    @Test
    void resultVisibilityAppliesWithoutCreatorSpecialCases() {
        assertTrue(PollRules.resultsVisible("IMMEDIATE", false,
                PollRules.Status.ACTIVE));
        assertFalse(PollRules.resultsVisible("AFTER_VOTING", false,
                PollRules.Status.ACTIVE));
        assertTrue(PollRules.resultsVisible("AFTER_VOTING", true,
                PollRules.Status.ACTIVE));
        assertFalse(PollRules.resultsVisible("AFTER_CLOSE", true,
                PollRules.Status.ACTIVE));
        assertTrue(PollRules.resultsVisible("AFTER_CLOSE", false,
                PollRules.Status.EXPIRED));
        assertTrue(PollRules.resultsVisible("AFTER_CLOSE", false,
                PollRules.Status.CLOSED));
    }

    @Test
    void percentagesUseVotersAndHalfUpRounding() {
        assertEquals(new BigDecimal("0.0"), PollRules.percentage(0, 0));
        assertEquals(new BigDecimal("33.3"), PollRules.percentage(1, 3));
        assertEquals(new BigDecimal("66.7"), PollRules.percentage(2, 3));
        assertEquals(new BigDecimal("6.3"), PollRules.percentage(1, 16));
        BigDecimal first = PollRules.percentage(2, 2);
        BigDecimal second = PollRules.percentage(2, 2);
        assertEquals(new BigDecimal("200.0"), first.add(second));
    }
}
