package com.diasporum.backend.events.internal.application.ticketing;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.diasporum.backend.events.internal.application.ticketing.TicketFeeCalculator.Discount;
import com.diasporum.backend.events.internal.application.ticketing.TicketFeeCalculator.FeeConfig;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class TicketFeeCalculatorTest {

    private static FeeConfig config(int bps, long fixedMinor, String currency, String model,
            Integer split) {
        return new FeeConfig(bps, fixedMinor, currency, model, split, new BigDecimal("0.00"), 7, true);
    }

    private static void money(String expected, BigDecimal actual) {
        assertEquals(new BigDecimal(expected), actual);
    }

    @Test
    void buyerPaysCommissionPlusFixedFee() {
        var unit = TicketFeeCalculator.unit(new BigDecimal("20.00"), "EUR", null,
                config(1000, 50, "EUR", "BUYER_PAYS", null), null);
        money("2.50", unit.unitFee());
        money("2.50", unit.buyerFee());
        money("0.00", unit.organiserFee());
        var totals = TicketFeeCalculator.totals(unit, 3);
        money("60.00", totals.subtotal());
        money("7.50", totals.platformFee());
        money("67.50", totals.total());
        // schema CHECK: total = subtotal − discount + platform_fee
        assertEquals(0, totals.total().compareTo(
                totals.subtotal().subtract(totals.discount()).add(totals.platformFee())));
    }

    @Test
    void eventOverrideAbsorbsAndSplitRoundsHalfUp() {
        var absorbed = TicketFeeCalculator.unit(new BigDecimal("19.99"), "EUR", null,
                config(1000, 0, "EUR", "BUYER_PAYS", null), "ORGANISER_ABSORBS");
        money("2.00", absorbed.unitFee()); // 1.999 → 2.00
        money("2.00", absorbed.organiserFee());
        money("0.00", absorbed.buyerFee());
        assertEquals("ORGANISER_ABSORBS", absorbed.feePaidBy());

        var split = TicketFeeCalculator.unit(new BigDecimal("10.00"), "EUR", null,
                config(1250, 3, "EUR", "SPLIT", 3333), null);
        money("1.28", split.unitFee());           // 1.25 + 0.03
        money("0.43", split.organiserFee());      // 1.28 × 0.3333 = 0.4266 → 0.43
        money("0.85", split.buyerFee());          // remainder, never lost to rounding
    }

    @Test
    void discountsAndFreeUnitsCarryNoFee() {
        var pct = TicketFeeCalculator.unit(new BigDecimal("40.00"), "EUR",
                new Discount("PERCENTAGE", new BigDecimal("50")),
                config(1000, 50, "EUR", "BUYER_PAYS", null), null);
        money("20.00", pct.unitDiscount());
        money("20.00", pct.unitNet());
        money("2.50", pct.unitFee());

        var fixedOver = TicketFeeCalculator.unit(new BigDecimal("5.00"), "EUR",
                new Discount("FIXED_AMOUNT", new BigDecimal("8.00")),
                config(1000, 50, "EUR", "BUYER_PAYS", null), null);
        money("5.00", fixedOver.unitDiscount()); // capped at price
        money("0.00", fixedOver.unitFee());      // free unit: no fee, not even the fixed part
        money("0.00", TicketFeeCalculator.totals(fixedOver, 2).total());
    }

    @Test
    void fixedFeeOnlyInMatchingCurrencyAndZeroDecimalCurrencies() {
        var mismatch = TicketFeeCalculator.unit(new BigDecimal("20.00"), "GBP", null,
                config(1000, 50, "EUR", "BUYER_PAYS", null), null);
        money("2.00", mismatch.unitFee()); // fixed EUR fee not applied to GBP (no FX)

        var yen = TicketFeeCalculator.unit(new BigDecimal("1999"), "JPY", null,
                config(1000, 100, "JPY", "BUYER_PAYS", null), null);
        money("300.00", yen.unitFee()); // 199.9 → 200 (no sub-yen), + ¥100 fixed
        assertEquals(1999L, TicketMoney.toMinor(new BigDecimal("1999.00"), "JPY"));
        assertEquals(4500L, TicketMoney.toMinor(new BigDecimal("45.00"), "EUR"));
        money("0.50", TicketMoney.fromMinor(50, "EUR"));
    }

    @Test
    void fallbackConfigIsZeroFee() {
        var unit = TicketFeeCalculator.unit(new BigDecimal("20.00"), "EUR", null,
                FeeConfig.fallback(), null);
        money("0.00", unit.unitFee());
        assertEquals(7, FeeConfig.fallback().payoutDelayDays());
    }
}
