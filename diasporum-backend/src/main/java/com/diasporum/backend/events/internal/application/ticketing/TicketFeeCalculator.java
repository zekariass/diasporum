package com.diasporum.backend.events.internal.application.ticketing;

import java.math.BigDecimal;
import java.math.RoundingMode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Pure per-unit pricing for a ticket order. An order holds a single ticket type,
 * so every unit is identical and per-ticket refund amounts divide exactly.
 *
 * <ul>
 *   <li>unitDiscount: PERCENTAGE → round(price × value / 100); FIXED_AMOUNT →
 *       min(value, price) per ticket.</li>
 *   <li>unitNet = price − unitDiscount (organiser gross revenue per ticket).</li>
 *   <li>unitFee = 0 for a free unit, else round(unitNet × commission_bps / 10000)
 *       + fixed fee (fixed_fee_minor in the config currency; applied only when it
 *       equals the event currency — no FX).</li>
 *   <li>BUYER_PAYS → buyer bears the whole fee; ORGANISER_ABSORBS → organiser;
 *       SPLIT → organiser bears round(fee × organiser_split_bps / 10000), buyer
 *       the rest.</li>
 * </ul>
 */
public final class TicketFeeCalculator {
    private static final Logger log = LoggerFactory.getLogger(TicketFeeCalculator.class);
    private static final BigDecimal TEN_THOUSAND = BigDecimal.valueOf(10_000);
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

    private TicketFeeCalculator() {
    }

    /** Effective fee settings for one event (resolved config + event override). */
    public record FeeConfig(int commissionBps, long fixedFeeMinor, String configCurrency,
            String feeModel, Integer organiserSplitBps, BigDecimal minPayoutAmount,
            int payoutDelayDays, boolean configured) {

        public static FeeConfig fallback() {
            return new FeeConfig(0, 0, null, "BUYER_PAYS", null, TicketMoney.zero(), 7, false);
        }
    }

    /** Promo discount input (null for none). */
    public record Discount(String type, BigDecimal value) {
    }

    public record UnitPricing(BigDecimal unitPrice, BigDecimal unitDiscount, BigDecimal unitNet,
            BigDecimal unitFee, BigDecimal buyerFee, BigDecimal organiserFee, String feePaidBy) {
    }

    public record OrderTotals(UnitPricing unit, int quantity, BigDecimal subtotal,
            BigDecimal discount, BigDecimal platformFee, BigDecimal total,
            BigDecimal organiserGross, BigDecimal organiserFee) {
    }

    public static UnitPricing unit(BigDecimal price, String currency, Discount discount,
            FeeConfig config, String eventFeeModel) {
        BigDecimal unitPrice = TicketMoney.round(price, currency);
        BigDecimal unitDiscount = TicketMoney.zero();
        if (discount != null) {
            if ("PERCENTAGE".equals(discount.type())) {
                unitDiscount = TicketMoney.round(unitPrice.multiply(discount.value())
                        .divide(HUNDRED, 8, RoundingMode.HALF_UP), currency);
            } else {
                unitDiscount = TicketMoney.round(discount.value().min(unitPrice), currency);
            }
        }
        BigDecimal unitNet = unitPrice.subtract(unitDiscount).max(TicketMoney.zero());
        String model = eventFeeModel != null ? eventFeeModel : config.feeModel();
        BigDecimal fee = TicketMoney.zero();
        if (unitNet.signum() > 0) {
            fee = TicketMoney.round(unitNet.multiply(BigDecimal.valueOf(config.commissionBps()))
                    .divide(TEN_THOUSAND, 8, RoundingMode.HALF_UP), currency);
            if (config.fixedFeeMinor() > 0) {
                if (currency.equals(config.configCurrency())) {
                    fee = fee.add(TicketMoney.fromMinor(config.fixedFeeMinor(), currency));
                } else {
                    log.warn("Ticket fee config currency {} differs from event currency {};"
                            + " fixed fee not applied", config.configCurrency(), currency);
                }
            }
        }
        BigDecimal organiserFee;
        switch (model) {
            case "ORGANISER_ABSORBS" -> organiserFee = fee;
            case "SPLIT" -> {
                int bps = config.organiserSplitBps() == null ? 0 : config.organiserSplitBps();
                organiserFee = TicketMoney.round(fee.multiply(BigDecimal.valueOf(bps))
                        .divide(TEN_THOUSAND, 8, RoundingMode.HALF_UP), currency);
            }
            default -> organiserFee = TicketMoney.zero();
        }
        BigDecimal buyerFee = fee.subtract(organiserFee);
        return new UnitPricing(unitPrice, unitDiscount, unitNet, fee, buyerFee, organiserFee, model);
    }

    public static OrderTotals totals(UnitPricing unit, int quantity) {
        BigDecimal q = BigDecimal.valueOf(quantity);
        BigDecimal subtotal = unit.unitPrice().multiply(q);
        BigDecimal discount = unit.unitDiscount().multiply(q);
        BigDecimal platformFee = unit.buyerFee().multiply(q);
        BigDecimal total = subtotal.subtract(discount).add(platformFee);
        return new OrderTotals(unit, quantity, subtotal, discount, platformFee, total,
                unit.unitNet().multiply(q), unit.organiserFee().multiply(q));
    }
}
