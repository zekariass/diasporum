package com.diasporum.backend.events.internal.application.ticketing;

import com.diasporum.backend.events.internal.application.ticketing.TicketingAccess.TicketedEvent;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * The only writer of {@code ticket_organiser_ledger}. Entries are appended with
 * a deterministic idempotency key ({@code ON CONFLICT DO NOTHING}), so replayed
 * webhooks, retried workers and double submissions never double-post. Rows are
 * never updated or deleted (the DB triggers would reject it anyway); corrections
 * are new rows. Balance = SUM(credit − debit) per event.
 */
@Component
public class TicketLedger {

    private static final String INSERT = "INSERT INTO ticket_organiser_ledger(event_id,"
            + "organiser_user_id,business_account_id,entry_type,order_id,refund_id,payout_id,"
            + "credit_amount,debit_amount,currency_code,description,idempotency_key)"
            + " VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (idempotency_key) DO NOTHING";
    private static final String BALANCE = "SELECT coalesce(sum(credit_amount-debit_amount),0)"
            + " FROM ticket_organiser_ledger WHERE event_id=?";
    private static final String BY_TYPE = "SELECT entry_type,coalesce(sum(credit_amount),0) AS c,"
            + "coalesce(sum(debit_amount),0) AS d FROM ticket_organiser_ledger WHERE event_id=?"
            + " GROUP BY entry_type";

    private final JdbcTemplate jdbc;

    public TicketLedger(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Source record of an entry; exactly one is usually set. */
    public record Source(UUID orderId, UUID refundId, UUID payoutId) {
        public static Source order(UUID id) {
            return new Source(id, null, null);
        }

        public static Source refund(UUID id) {
            return new Source(null, id, null);
        }

        public static Source payout(UUID id) {
            return new Source(null, null, id);
        }
    }

    public void credit(TicketedEvent e, String entryType, Source source, BigDecimal amount,
            String description, String idempotencyKey) {
        append(e, entryType, source, amount, BigDecimal.ZERO, description, idempotencyKey);
    }

    public void debit(TicketedEvent e, String entryType, Source source, BigDecimal amount,
            String description, String idempotencyKey) {
        append(e, entryType, source, BigDecimal.ZERO, amount, description, idempotencyKey);
    }

    private void append(TicketedEvent e, String entryType, Source source, BigDecimal credit,
            BigDecimal debit, String description, String idempotencyKey) {
        if (credit.signum() == 0 && debit.signum() == 0) {
            return; // zero-value movements are not journalled (CHECK credit>0 OR debit>0)
        }
        UUID userOwner = e.businessAccountId() == null ? e.ownerUserId() : null;
        jdbc.update(INSERT, e.id(), userOwner, e.businessAccountId(), entryType,
                source.orderId(), source.refundId(), source.payoutId(), credit, debit,
                e.currencyCode(), description, idempotencyKey);
    }

    public BigDecimal balance(UUID eventId) {
        return jdbc.queryForObject(BALANCE, BigDecimal.class, eventId).setScale(2);
    }

    /** entry_type → [credit, debit] sums. */
    public Map<String, BigDecimal[]> totalsByType(UUID eventId) {
        Map<String, BigDecimal[]> out = new LinkedHashMap<>();
        jdbc.query(BY_TYPE, rs -> {
            out.put(rs.getString("entry_type"), new BigDecimal[]{
                rs.getBigDecimal("c").setScale(2), rs.getBigDecimal("d").setScale(2)});
        }, eventId);
        return out;
    }
}
