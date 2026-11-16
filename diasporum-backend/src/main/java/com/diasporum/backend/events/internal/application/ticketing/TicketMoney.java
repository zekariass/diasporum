package com.diasporum.backend.events.internal.application.ticketing;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Currency;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Money conventions for ticketing. The schema stores numeric(12,2) major units;
 * providers and {@code ticket_fee_configurations.fixed_fee_minor} use minor
 * units. Computed amounts round HALF_UP to the currency's precision (capped at
 * the column's two decimals), so zero-decimal currencies never carry cents.
 */
public final class TicketMoney {

    private TicketMoney() {
    }

    public static int digits(String currency) {
        try {
            int d = Currency.getInstance(currency).getDefaultFractionDigits();
            return d < 0 ? 2 : d;
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "CURRENCY_INVALID");
        }
    }

    /** Rounding scale for computed amounts: min(currency digits, 2). */
    public static int scale(String currency) {
        return Math.min(digits(currency), 2);
    }

    public static BigDecimal round(BigDecimal amount, String currency) {
        return amount.setScale(scale(currency), RoundingMode.HALF_UP).setScale(2);
    }

    /** Whether an entered amount is representable in the currency (no sub-unit digits). */
    public static boolean representable(BigDecimal amount, String currency) {
        return amount.stripTrailingZeros().scale() <= scale(currency);
    }

    public static BigDecimal fromMinor(long minor, String currency) {
        return round(BigDecimal.valueOf(minor).movePointLeft(digits(currency)), currency);
    }

    public static long toMinor(BigDecimal major, String currency) {
        return major.movePointRight(digits(currency)).setScale(0, RoundingMode.UNNECESSARY)
                .longValueExact();
    }

    public static BigDecimal zero() {
        return BigDecimal.ZERO.setScale(2);
    }
}
