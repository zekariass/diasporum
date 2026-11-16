package com.diasporum.backend.events.internal.application.ticketing;

import static com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.bad;
import static com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.conflict;
import static com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.forbidden;
import static com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.notFound;

import com.diasporum.backend.events.internal.application.ticketing.PayoutAccountService.AccountFacts;
import com.diasporum.backend.events.internal.application.ticketing.TicketFeeCalculator.FeeConfig;
import com.diasporum.backend.events.internal.application.ticketing.TicketLedger.Source;
import com.diasporum.backend.events.internal.application.ticketing.TicketingAccess.TicketedEvent;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Manual organiser payouts from the immutable ledger.
 *
 * <p>Settlement rule = the event's resolved {@code ticket_fee_configurations}
 * row: a payout may be requested once {@code coalesce(ends_at, starts_at) +
 * payout_delay_days} has passed and the available balance (ledger SUM(credit −
 * debit) minus PENDING/ON_HOLD/PROCESSING payouts) is positive and at least
 * {@code min_payout_amount}. Requests are serialized per event with an
 * advisory lock so two requests can never spend the same balance.
 *
 * <p>Admin lifecycle: PENDING ⇄ ON_HOLD → (approve) PROCESSING → (complete with
 * transfer reference) COMPLETED + ledger PAYOUT debit; PENDING/ON_HOLD →
 * CANCELLED (reject); PROCESSING → FAILED. Approval/reference/provider rules are
 * the table's CHECK constraints — they are not duplicated here; a violation is
 * surfaced as 409 PAYOUT_STATE_INVALID.
 */
@Service
public class OrganiserPayoutService {

    private static final List<String> HELD = List.of("PENDING", "ON_HOLD", "PROCESSING");
    private static final String COLS = "id,event_id,payout_account_id,organiser_user_id,"
            + "business_account_id,period_start,period_end,gross_revenue,total_platform_fees,"
            + "total_refunds_deducted,net_payout_amount,currency_code,tickets_sold_count,"
            + "tickets_refunded_count,status,disbursement_method,requested_by_user_id,"
            + "approved_by_user_id,approved_at,transfer_reference,transferred_by_user_id,"
            + "failure_reason,created_at,completed_at";
    private static final String PENDING_SUM = "SELECT coalesce(sum(net_payout_amount),0)"
            + " FROM ticket_organiser_payouts WHERE event_id=? AND status IN ('PENDING','ON_HOLD','PROCESSING')";
    private static final String INSERT = "INSERT INTO ticket_organiser_payouts(event_id,"
            + "payout_account_id,organiser_user_id,business_account_id,period_start,period_end,"
            + "gross_revenue,total_platform_fees,total_refunds_deducted,net_payout_amount,"
            + "currency_code,tickets_sold_count,tickets_refunded_count,status,disbursement_method,"
            + "requested_by_user_id,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,"
            + "'PENDING','MANUAL',?,?) RETURNING id";

    private final JdbcTemplate jdbc;
    private final TicketingAccess access;
    private final TicketLedger ledger;
    private final TicketFeeConfigs feeConfigs;
    private final PayoutAccountService accounts;
    private final TicketNotifications notifications;

    public OrganiserPayoutService(JdbcTemplate jdbc, TicketingAccess access, TicketLedger ledger,
            TicketFeeConfigs feeConfigs, PayoutAccountService accounts,
            TicketNotifications notifications) {
        this.jdbc = jdbc;
        this.access = access;
        this.ledger = ledger;
        this.feeConfigs = feeConfigs;
        this.accounts = accounts;
        this.notifications = notifications;
    }

    public record Eligibility(BigDecimal ledgerBalance, BigDecimal pendingPayouts,
            BigDecimal availableBalance, BigDecimal minPayoutAmount, int payoutDelayDays,
            Instant eligibleAt, boolean feeConfigured, boolean eligible, String blockedReason) {
    }

    public record SalesSummary(UUID eventId, String currencyCode, long ordersPaid,
            long ticketsSold, long ticketsCheckedIn, long ticketsRefunded,
            Map<String, Map<String, BigDecimal>> ledgerByEntryType, Eligibility payout) {
    }

    public record PayoutView(UUID id, UUID eventId, UUID payoutAccountId, UUID organiserUserId,
            UUID businessAccountId, Instant periodStart, Instant periodEnd, BigDecimal grossRevenue,
            BigDecimal totalPlatformFees, BigDecimal totalRefundsDeducted,
            BigDecimal netPayoutAmount, String currencyCode, int ticketsSoldCount,
            int ticketsRefundedCount, String status, String disbursementMethod,
            UUID requestedByUserId, UUID approvedByUserId, Instant approvedAt,
            String transferReference, UUID transferredByUserId, String failureReason,
            Instant createdAt, Instant completedAt) {
    }

    // =================== eligibility / dashboard ===================

    public Eligibility eligibility(TicketedEvent e) {
        FeeConfig config = feeConfigs.forEvent(e);
        BigDecimal balance = ledger.balance(e.id());
        BigDecimal pending = jdbc.queryForObject(PENDING_SUM, BigDecimal.class, e.id()).setScale(2);
        BigDecimal available = balance.subtract(pending);
        Instant eligibleAt = e.settlementAnchor().plus(Duration.ofDays(config.payoutDelayDays()));
        String blocked = null;
        if (Instant.now().isBefore(eligibleAt)) {
            blocked = "PAYOUT_NOT_YET_ELIGIBLE";
        } else if (available.signum() <= 0 || available.compareTo(config.minPayoutAmount()) < 0) {
            blocked = "PAYOUT_BELOW_MINIMUM";
        }
        return new Eligibility(balance, pending, available, config.minPayoutAmount(),
                config.payoutDelayDays(), eligibleAt, config.configured(), blocked == null, blocked);
    }

    @Transactional(readOnly = true)
    public SalesSummary summary(UUID actor, UUID eventId) {
        TicketedEvent e = access.requireManager(actor, eventId);
        Map<String, Object> counts = jdbc.queryForMap("SELECT"
                + " (SELECT count(*) FROM ticket_orders WHERE event_id=? AND paid_at IS NOT NULL) AS paid,"
                + " (SELECT count(*) FROM issued_tickets WHERE event_id=?) AS sold,"
                + " (SELECT count(*) FROM issued_tickets WHERE event_id=? AND status='CHECKED_IN') AS checked,"
                + " (SELECT count(*) FROM issued_tickets WHERE event_id=? AND status='REFUNDED') AS refunded",
                eventId, eventId, eventId, eventId);
        Map<String, Map<String, BigDecimal>> byType = new LinkedHashMap<>();
        ledger.totalsByType(eventId).forEach((type, cd) -> byType.put(type,
                Map.of("credit", cd[0], "debit", cd[1])));
        return new SalesSummary(eventId, e.currencyCode(), num(counts.get("paid")),
                num(counts.get("sold")), num(counts.get("checked")), num(counts.get("refunded")),
                byType, eligibility(e));
    }

    @Transactional(readOnly = true)
    public List<PayoutView> eventPayouts(UUID actor, UUID eventId) {
        access.requireManager(actor, eventId);
        return jdbc.query("SELECT " + COLS + " FROM ticket_organiser_payouts WHERE event_id=?"
                + " ORDER BY created_at DESC", (rs, i) -> map(rs), eventId);
    }

    // =================== organiser request ===================

    @Transactional
    public PayoutView request(UUID actor, UUID eventId, UUID payoutAccountId, String idempotencyKey) {
        if (idempotencyKey == null || idempotencyKey.isBlank() || idempotencyKey.length() > 120) {
            throw bad("IDEMPOTENCY_KEY_REQUIRED");
        }
        TicketedEvent e = access.requireFinance(actor, eventId);
        String storedKey = actor + ":" + idempotencyKey.trim();
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", rs -> null,
                "ticket-payout:" + eventId);
        UUID existing = jdbc.query("SELECT id FROM ticket_organiser_payouts WHERE idempotency_key=?",
                rs -> rs.next() ? rs.getObject(1, UUID.class) : null, storedKey);
        if (existing != null) {
            PayoutView v = view(existing);
            if (!v.eventId().equals(eventId) || !v.payoutAccountId().equals(payoutAccountId)) {
                throw conflict("IDEMPOTENCY_KEY_REUSED");
            }
            return v;
        }
        AccountFacts account = accounts.facts(payoutAccountId);
        boolean owned = e.businessAccountId() != null
                ? e.businessAccountId().equals(account.businessAccountId())
                : Objects.equals(e.ownerUserId(), account.organiserUserId())
                        && account.businessAccountId() == null;
        if (!owned) {
            throw forbidden("PAYOUT_ACCOUNT_NOT_OWNED");
        }
        if ("REJECTED".equals(account.verificationStatus())) {
            throw conflict("PAYOUT_ACCOUNT_REJECTED");
        }
        Eligibility el = eligibility(e);
        if (!el.eligible()) {
            throw conflict(el.blockedReason());
        }
        Instant now = Instant.now();
        Timestamp start = jdbc.queryForObject("SELECT coalesce((SELECT max(period_end) FROM"
                + " ticket_organiser_payouts WHERE event_id=? AND status NOT IN ('CANCELLED','FAILED')),"
                + " (SELECT min(created_at) FROM ticket_organiser_ledger WHERE event_id=?), now())",
                Timestamp.class, eventId, eventId);
        Map<String, Object> period = jdbc.queryForMap("SELECT"
                + " coalesce(sum(credit_amount) FILTER (WHERE entry_type='TICKET_SALE'),0) AS gross,"
                + " coalesce(sum(debit_amount) FILTER (WHERE entry_type='PLATFORM_FEE'),0)"
                + "  - coalesce(sum(credit_amount) FILTER (WHERE entry_type='FEE_REFUND'),0) AS fees,"
                + " coalesce(sum(debit_amount) FILTER (WHERE entry_type='REFUND_DEDUCTION'),0) AS refunds"
                + " FROM ticket_organiser_ledger WHERE event_id=? AND created_at>=? AND created_at<=?",
                eventId, start, Timestamp.from(now));
        Integer sold = jdbc.queryForObject("SELECT count(*) FROM issued_tickets WHERE event_id=?"
                + " AND created_at>=? AND created_at<=?", Integer.class, eventId, start, Timestamp.from(now));
        Integer refunded = jdbc.queryForObject("SELECT count(*) FROM ticket_refunds r JOIN ticket_orders o"
                + " ON o.id=r.order_id WHERE o.event_id=? AND r.status='PROCESSED'"
                + " AND r.processed_at>=? AND r.processed_at<=?", Integer.class, eventId, start,
                Timestamp.from(now));
        UUID id = jdbc.queryForObject(INSERT, UUID.class, eventId, payoutAccountId,
                e.businessAccountId() == null ? e.ownerUserId() : null, e.businessAccountId(),
                start, Timestamp.from(now), nonNegative(period.get("gross")),
                nonNegative(period.get("fees")), nonNegative(period.get("refunds")),
                el.availableBalance(), e.currencyCode(), sold, refunded, actor, storedKey);
        return view(id);
    }

    // =================== admin ===================

    @Transactional(readOnly = true)
    public List<PayoutView> adminQueue(UUID actor, String status) {
        access.requirePlatformAdmin(actor);
        String filter = status == null || status.isBlank()
                ? " WHERE status IN ('PENDING','ON_HOLD','PROCESSING')" : " WHERE status=?";
        Object[] args = status == null || status.isBlank() ? new Object[0]
                : new Object[]{status.trim().toUpperCase()};
        return jdbc.query("SELECT " + COLS + " FROM ticket_organiser_payouts" + filter
                + " ORDER BY created_at LIMIT 500", (rs, i) -> map(rs), args);
    }

    @Transactional
    public PayoutView approve(UUID actor, UUID payoutId) {
        access.requirePlatformAdmin(actor);
        PayoutView p = lock(payoutId);
        if (!"VERIFIED".equals(accounts.facts(p.payoutAccountId()).verificationStatus())) {
            throw conflict("PAYOUT_ACCOUNT_NOT_VERIFIED");
        }
        return move(payoutId, "UPDATE ticket_organiser_payouts SET status='PROCESSING',"
                + "approved_by_user_id=?,approved_at=now() WHERE id=? AND status IN ('PENDING','ON_HOLD')",
                actor, payoutId);
    }

    @Transactional
    public PayoutView hold(UUID actor, UUID payoutId, boolean onHold) {
        access.requirePlatformAdmin(actor);
        lock(payoutId);
        return move(payoutId, "UPDATE ticket_organiser_payouts SET status=? WHERE id=? AND status=?",
                onHold ? "ON_HOLD" : "PENDING", payoutId, onHold ? "PENDING" : "ON_HOLD");
    }

    /**
     * Records the manual transfer. Approval and the transfer reference are the
     * table's CHECKs (COMPLETED requires approved_at; MANUAL requires
     * transfer_reference) — enforced by the database, surfaced as 409.
     */
    @Transactional
    public PayoutView complete(UUID actor, UUID payoutId, String transferReference) {
        access.requirePlatformAdmin(actor);
        PayoutView p = lock(payoutId);
        String ref = transferReference == null || transferReference.isBlank() ? null
                : transferReference.trim();
        PayoutView done = move(payoutId, "UPDATE ticket_organiser_payouts SET status='COMPLETED',"
                + "transfer_reference=?,transferred_by_user_id=?,completed_at=now() WHERE id=?"
                + " AND status IN ('PENDING','ON_HOLD','PROCESSING')", ref, actor, payoutId);
        TicketedEvent e = access.requireEvent(p.eventId());
        ledger.debit(e, "PAYOUT", Source.payout(payoutId), p.netPayoutAmount(),
                "Manual payout " + ref, "payout:" + payoutId);
        notifications.payoutCompleted(p.requestedByUserId(), p.eventId(), e.title(), payoutId,
                p.netPayoutAmount(), p.currencyCode());
        return done;
    }

    @Transactional
    public PayoutView reject(UUID actor, UUID payoutId, String reason, boolean failedTransfer) {
        access.requirePlatformAdmin(actor);
        PayoutView p = lock(payoutId);
        if (reason == null || reason.isBlank()) {
            throw bad("FAILURE_REASON_REQUIRED");
        }
        PayoutView out = failedTransfer
                ? move(payoutId, "UPDATE ticket_organiser_payouts SET status='FAILED',failure_reason=?"
                        + " WHERE id=? AND status='PROCESSING'", reason.trim(), payoutId)
                : move(payoutId, "UPDATE ticket_organiser_payouts SET status='CANCELLED',"
                        + "failure_reason=? WHERE id=? AND status IN ('PENDING','ON_HOLD')",
                        reason.trim(), payoutId);
        TicketedEvent e = access.requireEvent(p.eventId());
        notifications.payoutRejected(p.requestedByUserId(), p.eventId(), e.title(), payoutId,
                out.status());
        return out;
    }

    private PayoutView move(UUID payoutId, String sql, Object... args) {
        int n;
        try {
            n = jdbc.update(sql, args);
        } catch (DataIntegrityViolationException ex) {
            throw conflict("PAYOUT_STATE_INVALID");
        }
        if (n == 0) {
            throw conflict("PAYOUT_STATE_INVALID");
        }
        return view(payoutId);
    }

    private PayoutView lock(UUID payoutId) {
        PayoutView p = jdbc.query("SELECT " + COLS + " FROM ticket_organiser_payouts WHERE id=?"
                + " FOR UPDATE", rs -> rs.next() ? map(rs) : null, payoutId);
        if (p == null) {
            throw notFound("PAYOUT_NOT_FOUND");
        }
        return p;
    }

    public PayoutView view(UUID payoutId) {
        PayoutView p = jdbc.query("SELECT " + COLS + " FROM ticket_organiser_payouts WHERE id=?",
                rs -> rs.next() ? map(rs) : null, payoutId);
        if (p == null) {
            throw notFound("PAYOUT_NOT_FOUND");
        }
        return p;
    }

    private static BigDecimal nonNegative(Object v) {
        BigDecimal d = v == null ? BigDecimal.ZERO : (BigDecimal) v;
        return d.max(BigDecimal.ZERO).setScale(2);
    }

    private static long num(Object v) {
        return v == null ? 0 : ((Number) v).longValue();
    }

    private static PayoutView map(ResultSet rs) throws SQLException {
        return new PayoutView(rs.getObject("id", UUID.class), rs.getObject("event_id", UUID.class),
                rs.getObject("payout_account_id", UUID.class),
                rs.getObject("organiser_user_id", UUID.class),
                rs.getObject("business_account_id", UUID.class), ts(rs, "period_start"),
                ts(rs, "period_end"), rs.getBigDecimal("gross_revenue"),
                rs.getBigDecimal("total_platform_fees"), rs.getBigDecimal("total_refunds_deducted"),
                rs.getBigDecimal("net_payout_amount"), rs.getString("currency_code").trim(),
                rs.getInt("tickets_sold_count"), rs.getInt("tickets_refunded_count"),
                rs.getString("status"), rs.getString("disbursement_method"),
                rs.getObject("requested_by_user_id", UUID.class),
                rs.getObject("approved_by_user_id", UUID.class), ts(rs, "approved_at"),
                rs.getString("transfer_reference"), rs.getObject("transferred_by_user_id", UUID.class),
                rs.getString("failure_reason"), ts(rs, "created_at"), ts(rs, "completed_at"));
    }

    private static Instant ts(ResultSet rs, String col) throws SQLException {
        Timestamp t = rs.getTimestamp(col);
        return t == null ? null : t.toInstant();
    }
}
