package com.diasporum.backend.events.internal.application.ticketing;

import com.diasporum.backend.events.internal.application.ticketing.TicketFeeCalculator.FeeConfig;
import com.diasporum.backend.events.internal.application.ticketing.TicketingAccess.TicketedEvent;
import java.math.BigDecimal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Resolves the active {@code ticket_fee_configurations} row for an event — the
 * fee and settlement rule (payout_delay_days, min_payout_amount). Precedence:
 * (country, category) → (country, any category) → (global, any category). With
 * no row the fallback is zero fee and the column defaults (7 days, no minimum),
 * logged so an unconfigured market is visible.
 */
@Component
public class TicketFeeConfigs {
    private static final Logger log = LoggerFactory.getLogger(TicketFeeConfigs.class);

    private static final String LOOKUP = "SELECT commission_rate_bps,fixed_fee_minor,currency_code,"
            + "fee_model,organiser_split_bps,min_payout_amount,payout_delay_days"
            + " FROM ticket_fee_configurations WHERE is_active"
            + " AND (country_id=? OR country_id IS NULL)"
            + " AND (event_category_id=? OR event_category_id IS NULL)"
            + " ORDER BY (country_id IS NULL), (event_category_id IS NULL) LIMIT 1";

    private final JdbcTemplate jdbc;

    public TicketFeeConfigs(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public FeeConfig forEvent(TicketedEvent e) {
        FeeConfig config = jdbc.query(LOOKUP, rs -> {
            if (!rs.next()) {
                return null;
            }
            int split = rs.getInt("organiser_split_bps");
            Integer splitBps = rs.wasNull() ? null : split;
            BigDecimal min = rs.getBigDecimal("min_payout_amount");
            return new FeeConfig(rs.getInt("commission_rate_bps"), rs.getLong("fixed_fee_minor"),
                    rs.getString("currency_code").trim(), rs.getString("fee_model"), splitBps,
                    min == null ? TicketMoney.zero() : min, rs.getInt("payout_delay_days"), true);
        }, e.countryId(), e.categoryId());
        if (config == null) {
            log.warn("No active ticket_fee_configurations row for event {} (country {});"
                    + " using zero fee and default settlement", e.id(), e.countryId());
            return FeeConfig.fallback();
        }
        return config;
    }
}
