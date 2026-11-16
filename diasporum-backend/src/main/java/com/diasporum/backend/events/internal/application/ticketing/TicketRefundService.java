package com.diasporum.backend.events.internal.application.ticketing;

import static com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.bad;
import static com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.conflict;
import static com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.forbidden;
import static com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.notFound;

import com.diasporum.backend.events.internal.application.ticketing.TicketFulfilmentService.PricingSnapshot;
import com.diasporum.backend.events.internal.application.ticketing.TicketLedger.Source;
import com.diasporum.backend.events.internal.application.ticketing.TicketOrderStore.OrderRow;
import com.diasporum.backend.events.internal.application.ticketing.TicketPaymentGateway.Refund;
import com.diasporum.backend.events.internal.application.ticketing.TicketingAccess.TicketedEvent;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Whole-ticket refunds. Lifecycle: PENDING (buyer request) → APPROVED →
 * PROCESSING → PROCESSED | FAILED, or PENDING → REJECTED. Organiser-initiated,
 * event-cancelled and admin-override refunds are created already APPROVED.
 *
 * <p>The provider refund is issued outside any DB transaction with key
 * {@code ticket-refund:{id}} (safe to repeat). Finalization is one idempotent
 * transaction guarded by {@code status='PROCESSING'}: ticket → REFUNDED,
 * quantity_sold − 1, ledger REFUND_DEDUCTION debit (the organiser's gross for
 * that ticket) and FEE_REFUND credit (the organiser-borne fee share given
 * back), order status recomputed. Ledger rows are only ever appended.
 */
@Service
public class TicketRefundService {
    private static final Logger log = LoggerFactory.getLogger(TicketRefundService.class);

    private static final Set<String> FEE_RETURNING = Set.of("EVENT_CANCELLED", "ADMIN_OVERRIDE");
    private static final List<String> OPEN = List.of("PENDING", "APPROVED", "PROCESSING");
    private static final String REFUND_COLS = "id,order_id,issued_ticket_id,refund_amount,"
            + "platform_fee_refund,currency_code,refund_type,status,reason,provider_refund_id,"
            + "requested_by,approved_by,created_at,approved_at,processed_at";
    private static final String INSERT = "INSERT INTO ticket_refunds(order_id,issued_ticket_id,"
            + "refund_amount,platform_fee_refund,currency_code,refund_type,status,reason,"
            + "idempotency_key,requested_by,approved_by,approved_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,"
            + "CASE WHEN ?='APPROVED' THEN now() END) RETURNING id";

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final TicketingAccess access;
    private final TicketOrderStore store;
    private final TicketFulfilmentService fulfilment;
    private final TicketLedger ledger;
    private final TicketPaymentGateway gateway;

    public TicketRefundService(JdbcTemplate jdbc, org.springframework.transaction.PlatformTransactionManager txManager, TicketingAccess access,
            TicketOrderStore store, TicketFulfilmentService fulfilment, TicketLedger ledger,
            TicketPaymentGateway gateway) {
        this.jdbc = jdbc;
        this.tx = new TransactionTemplate(txManager);
        this.access = access;
        this.store = store;
        this.fulfilment = fulfilment;
        this.ledger = ledger;
        this.gateway = gateway;
    }

    public record RefundView(UUID id, UUID orderId, UUID issuedTicketId, BigDecimal refundAmount,
            BigDecimal platformFeeRefund, String currencyCode, String refundType, String status,
            String reason, String providerRefundId, UUID requestedBy, UUID approvedBy,
            Instant createdAt, Instant approvedAt, Instant processedAt) {
    }

    // =================== create ===================

    /** Buyer asks for refunds of their tickets (all VALID tickets of the order when none named). */
    public List<RefundView> requestByBuyer(UUID buyer, UUID orderId, List<UUID> ticketIds,
            String reason) {
        OrderRow order = store.requireOrder(orderId);
        if (!buyer.equals(order.buyerUserId())) {
            throw notFound("ORDER_NOT_FOUND");
        }
        TicketedEvent e = access.requireEvent(order.eventId());
        if (!e.cancelled()) {
            requirePolicyAllows(e);
        }
        return create(order, ticketIds, "BUYER_REQUESTED", reason, buyer);
    }

    /** Organiser-initiated or event-cancelled refunds; auto-approved and sent immediately. */
    public List<RefundView> createByOrganiser(UUID actor, UUID eventId, UUID orderId,
            List<UUID> ticketIds, String type, String reason) {
        if (!"ORGANISER_INITIATED".equals(type) && !"EVENT_CANCELLED".equals(type)) {
            throw bad("REFUND_TYPE_INVALID");
        }
        TicketedEvent e = access.requireEvent(eventId);
        if (!access.canManageFinances(actor, e) && !access.isPlatformAdmin(actor)) {
            throw forbidden("NOT_EVENT_FINANCE_MANAGER");
        }
        if ("EVENT_CANCELLED".equals(type) && !e.cancelled()) {
            throw conflict("EVENT_NOT_CANCELLED");
        }
        OrderRow order = store.requireOrder(orderId);
        if (!order.eventId().equals(eventId)) {
            throw notFound("ORDER_NOT_FOUND");
        }
        List<RefundView> created = create(order, ticketIds, type, reason, actor);
        return created.stream().map(r -> process(r.id())).toList();
    }

    public List<RefundView> createByAdmin(UUID actor, UUID orderId, List<UUID> ticketIds,
            String reason) {
        access.requirePlatformAdmin(actor);
        List<RefundView> created = create(store.requireOrder(orderId), ticketIds, "ADMIN_OVERRIDE",
                reason, actor);
        return created.stream().map(r -> process(r.id())).toList();
    }

    private List<RefundView> create(OrderRow orderRef, List<UUID> ticketIds, String type,
            String reason, UUID actor) {
        String why = reason == null ? "" : reason.trim();
        if (why.isEmpty() || why.length() > 2000) {
            throw bad("REFUND_REASON_REQUIRED");
        }
        List<UUID> ids = tx.execute(s -> {
            OrderRow order = store.lockOrder(orderRef.id());
            if (!TicketFulfilmentService.PAID_OR_LATER.contains(order.status())) {
                throw conflict("ORDER_NOT_REFUNDABLE");
            }
            boolean admin = "ADMIN_OVERRIDE".equals(type);
            List<Map<String, Object>> tickets = jdbc.queryForList("SELECT t.id,t.status,"
                    + "i.unit_price,i.discount_per_unit FROM issued_tickets t JOIN ticket_order_items i"
                    + " ON i.id=t.order_item_id WHERE i.order_id=? ORDER BY t.created_at", order.id());
            List<Map<String, Object>> selected = new ArrayList<>();
            for (Map<String, Object> t : tickets) {
                UUID id = (UUID) t.get("id");
                if (ticketIds != null && !ticketIds.isEmpty() && !ticketIds.contains(id)) {
                    continue;
                }
                String status = (String) t.get("status");
                boolean eligible = "VALID".equals(status) || admin && "CHECKED_IN".equals(status);
                if (!eligible) {
                    if (ticketIds != null && !ticketIds.isEmpty()) {
                        throw conflict("TICKET_NOT_REFUNDABLE");
                    }
                    continue;
                }
                Integer open = jdbc.queryForObject("SELECT count(*) FROM ticket_refunds"
                        + " WHERE issued_ticket_id=? AND status IN ('PENDING','APPROVED','PROCESSING')",
                        Integer.class, id);
                if (open != null && open > 0) {
                    throw conflict("REFUND_ALREADY_REQUESTED");
                }
                selected.add(t);
            }
            if (ticketIds != null && !ticketIds.isEmpty() && selected.size() != ticketIds.size()) {
                throw notFound("TICKET_NOT_FOUND");
            }
            if (selected.isEmpty()) {
                throw conflict("NO_REFUNDABLE_TICKETS");
            }
            PricingSnapshot pricing = fulfilment.pricing(order.id());
            BigDecimal buyerFee = order.platformFeeAmount()
                    .divide(BigDecimal.valueOf(pricing.quantity()), 2, RoundingMode.UNNECESSARY);
            String status = "BUYER_REQUESTED".equals(type) ? "PENDING" : "APPROVED";
            List<UUID> out = new ArrayList<>();
            for (Map<String, Object> t : selected) {
                UUID ticketId = (UUID) t.get("id");
                BigDecimal net = ((BigDecimal) t.get("unit_price"))
                        .subtract((BigDecimal) t.get("discount_per_unit"));
                BigDecimal feeBack = FEE_RETURNING.contains(type) ? buyerFee : TicketMoney.zero();
                BigDecimal amount = net.add(feeBack);
                if (amount.signum() == 0) {
                    cancelFreeTicket(order, ticketId, actor, why);
                    continue;
                }
                Integer attempts = jdbc.queryForObject("SELECT count(*) FROM ticket_refunds"
                        + " WHERE issued_ticket_id=?", Integer.class, ticketId);
                out.add(jdbc.queryForObject(INSERT, UUID.class, order.id(), ticketId, amount, feeBack,
                        order.currencyCode(), type, status, why,
                        "refund:" + ticketId + ":" + (attempts == null ? 0 : attempts), actor,
                        "APPROVED".equals(status) ? actor : null, status));
            }
            recomputeOrder(order.id(), actor, sourceFor(type), why);
            return out;
        });
        return ids.stream().map(this::view).toList();
    }

    /** Free tickets have no money to return (refund_amount must be > 0): cancel directly. */
    private void cancelFreeTicket(OrderRow order, UUID ticketId, UUID actor, String reason) {
        UUID typeId = jdbc.query("UPDATE issued_tickets SET status='CANCELLED',updated_at=now()"
                + " WHERE id=? AND status IN ('VALID','CHECKED_IN') AND checked_in_at IS NULL"
                + " RETURNING ticket_type_id", rs -> rs.next() ? rs.getObject(1, UUID.class) : null,
                ticketId);
        if (typeId != null) {
            jdbc.update("UPDATE event_ticket_types SET quantity_sold=quantity_sold-1,updated_at=now()"
                    + " WHERE id=? AND quantity_sold>0", typeId);
        }
    }

    // =================== approve / reject ===================

    public RefundView approve(UUID actor, UUID refundId) {
        tx.executeWithoutResult(s -> {
            RefundView r = lockRefund(refundId);
            requireDecider(actor, r);
            if (!"PENDING".equals(r.status())) {
                throw conflict("REFUND_NOT_PENDING");
            }
            jdbc.update("UPDATE ticket_refunds SET status='APPROVED',approved_by=?,approved_at=now()"
                    + " WHERE id=? AND status='PENDING'", actor, refundId);
        });
        return process(refundId);
    }

    @Transactional
    public RefundView reject(UUID actor, UUID refundId, String note) {
        RefundView r = lockRefund(refundId);
        requireDecider(actor, r);
        if (!"PENDING".equals(r.status())) {
            throw conflict("REFUND_NOT_PENDING");
        }
        jdbc.update("UPDATE ticket_refunds SET status='REJECTED',approved_by=? WHERE id=?"
                + " AND status='PENDING'", actor, refundId);
        recomputeOrder(r.orderId(), actor, access.isPlatformAdmin(actor) ? "ADMIN" : "ORGANISER",
                note == null ? "Refund rejected" : note);
        return view(refundId);
    }

    private void requireDecider(UUID actor, RefundView r) {
        OrderRow order = store.requireOrder(r.orderId());
        TicketedEvent e = access.requireEvent(order.eventId());
        if (!access.canManageFinances(actor, e) && !access.isPlatformAdmin(actor)) {
            throw forbidden("NOT_EVENT_FINANCE_MANAGER");
        }
    }

    // =================== provider ===================

    /** APPROVED → PROCESSING → provider refund (outside tx) → PROCESSED/FAILED or stays PROCESSING. */
    public RefundView process(UUID refundId) {
        String[] target = tx.execute(s -> {
            RefundView r = lockRefund(refundId);
            boolean resend = "PROCESSING".equals(r.status()) && r.providerRefundId() == null;
            if (!"APPROVED".equals(r.status()) && !resend) {
                return null;
            }
            jdbc.update("UPDATE ticket_refunds SET status='PROCESSING' WHERE id=?", refundId);
            OrderRow order = store.requireOrder(r.orderId());
            return new String[]{order.paymentProviderId(), r.currencyCode(),
                r.refundAmount().toPlainString()};
        });
        if (target == null) {
            return view(refundId);
        }
        if (target[0] == null) {
            // Nothing was charged through the provider (should not happen for amount > 0).
            fail(refundId, "NO_PROVIDER_PAYMENT");
            return view(refundId);
        }
        Refund result = gateway.refund("ticket-refund:" + refundId, target[0],
                TicketMoney.toMinor(new BigDecimal(target[2]), target[1]),
                Map.of("ticket_refund_id", refundId.toString()));
        applyProviderResult(refundId, result);
        return view(refundId);
    }

    /** Webhook / reconciliation entry point keyed by the provider refund id. */
    public UUID finalizeFromProvider(String providerRefundId) {
        UUID refundId = jdbc.query("SELECT id FROM ticket_refunds WHERE provider_refund_id=?",
                rs -> rs.next() ? rs.getObject(1, UUID.class) : null, providerRefundId);
        if (refundId == null) {
            return null;
        }
        applyProviderResult(refundId, gateway.retrieveRefund(providerRefundId));
        return refundId;
    }

    private void applyProviderResult(UUID refundId, Refund result) {
        if (result.id() != null) {
            jdbc.update("UPDATE ticket_refunds SET provider_refund_id=? WHERE id=?"
                    + " AND provider_refund_id IS NULL", result.id(), refundId);
        }
        switch (result.status()) {
            case "SUCCEEDED" -> tx.executeWithoutResult(s -> finalizeProcessed(refundId));
            case "FAILED" -> fail(refundId, result.failureCode());
            default -> log.info("Ticket refund {} pending at provider", refundId);
        }
    }

    private void fail(UUID refundId, String code) {
        tx.executeWithoutResult(s -> {
            RefundView r = lockRefund(refundId);
            if (jdbc.update("UPDATE ticket_refunds SET status='FAILED' WHERE id=?"
                    + " AND status='PROCESSING'", refundId) == 1) {
                log.warn("Ticket refund {} failed at provider: {}", refundId, code);
                recomputeOrder(r.orderId(), null, "SYSTEM", "Refund failed: " + code);
            }
        });
    }

    /** One idempotent transaction; a replay finds the row no longer PROCESSING and does nothing. */
    void finalizeProcessed(UUID refundId) {
        RefundView r = lockRefund(refundId);
        if (jdbc.update("UPDATE ticket_refunds SET status='PROCESSED',processed_at=now()"
                + " WHERE id=? AND status='PROCESSING'", refundId) == 0) {
            return;
        }
        OrderRow order = store.requireOrder(r.orderId());
        if (r.issuedTicketId() == null) {
            // Late-payment refund: nothing was sold, nothing is journalled.
            return;
        }
        UUID typeId = jdbc.query("UPDATE issued_tickets SET status='REFUNDED',checked_in_at=NULL,"
                + "updated_at=now() WHERE id=? AND status IN ('VALID','CHECKED_IN')"
                + " RETURNING ticket_type_id", rs -> rs.next() ? rs.getObject(1, UUID.class) : null,
                r.issuedTicketId());
        if (typeId != null) {
            jdbc.update("UPDATE event_ticket_types SET quantity_sold=quantity_sold-1,updated_at=now()"
                    + " WHERE id=? AND quantity_sold>0", typeId);
        }
        TicketedEvent e = access.requireEvent(order.eventId());
        PricingSnapshot pricing = fulfilment.pricing(order.id());
        BigDecimal ticketNet = r.refundAmount().subtract(r.platformFeeRefund());
        ledger.debit(e, "REFUND_DEDUCTION", Source.refund(refundId), ticketNet,
                "Refund " + order.orderNumber(), "refund:" + refundId + ":deduction");
        ledger.credit(e, "FEE_REFUND", Source.refund(refundId), pricing.organiserFee(),
                "Platform fee returned " + order.orderNumber(), "refund:" + refundId + ":fee");
        recomputeOrder(order.id(), null, "SYSTEM", "Refund processed");
    }

    /** Order status from its tickets and open refunds (only for orders that were paid). */
    void recomputeOrder(UUID orderId, UUID actor, String source, String reason) {
        OrderRow order = store.lockOrder(orderId);
        if (order == null || !TicketFulfilmentService.PAID_OR_LATER.contains(order.status())) {
            return;
        }
        Map<String, Object> c = jdbc.queryForMap("SELECT count(*) AS total,"
                + " count(*) FILTER (WHERE t.status IN ('REFUNDED','CANCELLED')) AS gone"
                + " FROM issued_tickets t JOIN ticket_order_items i ON i.id=t.order_item_id"
                + " WHERE i.order_id=?", orderId);
        Integer open = jdbc.queryForObject("SELECT count(*) FROM ticket_refunds WHERE order_id=?"
                + " AND status IN ('PENDING','APPROVED','PROCESSING')", Integer.class, orderId);
        long total = ((Number) c.get("total")).longValue();
        long gone = ((Number) c.get("gone")).longValue();
        String next = open != null && open > 0 ? "REFUND_REQUESTED"
                : total > 0 && gone == total ? "REFUNDED"
                : gone > 0 ? "PARTIALLY_REFUNDED" : "PAID";
        if (!next.equals(order.status())) {
            store.transition(orderId, TicketFulfilmentService.PAID_OR_LATER, next, actor, source,
                    reason);
        }
    }

    // =================== refund policy ===================

    static void requirePolicyAllows(TicketedEvent e) {
        Instant now = Instant.now();
        switch (e.refundPolicy()) {
            case "NO_REFUNDS" -> throw conflict("REFUND_NOT_ALLOWED");
            case "REFUND_UNTIL_EVENT" -> {
                if (!now.isBefore(e.startsAt())) {
                    throw conflict("REFUND_WINDOW_CLOSED");
                }
            }
            case "REFUND_UNTIL_CUTOFF" -> {
                Instant cutoff = e.startsAt().minus(Duration.ofHours(e.refundCutoffHours()));
                if (!now.isBefore(cutoff)) {
                    throw conflict("REFUND_WINDOW_CLOSED");
                }
            }
            default -> { /* ORGANISER_DISCRETION: request accepted, organiser decides */ }
        }
    }

    // =================== views ===================

    @Transactional(readOnly = true)
    public List<RefundView> eventRefunds(UUID actor, UUID eventId, String status) {
        access.requireManager(actor, eventId);
        String sql = "SELECT " + prefixed() + " FROM ticket_refunds r JOIN ticket_orders o"
                + " ON o.id=r.order_id WHERE o.event_id=?";
        List<Object> args = new ArrayList<>(List.of(eventId));
        if (status != null && !status.isBlank()) {
            sql += " AND r.status=?";
            args.add(status.trim().toUpperCase());
        }
        return jdbc.query(sql + " ORDER BY r.created_at DESC LIMIT 500", (rs, i) -> map(rs),
                args.toArray());
    }

    /** Refunds waiting for the provider (worker retry/reconciliation). */
    List<UUID> stuck(int limit) {
        return jdbc.queryForList("SELECT id FROM ticket_refunds WHERE (status='APPROVED'"
                + " AND coalesce(approved_at,created_at) < now()-interval '1 minute')"
                + " OR (status='PROCESSING' AND created_at < now()-interval '5 minutes')"
                + " ORDER BY created_at LIMIT ?", UUID.class, limit);
    }

    /** Worker: resend APPROVED/unsent refunds, poll ones pending at the provider. */
    void reconcile(UUID refundId) {
        RefundView r = view(refundId);
        if ("PROCESSING".equals(r.status()) && r.providerRefundId() != null) {
            applyProviderResult(refundId, gateway.retrieveRefund(r.providerRefundId()));
        } else {
            process(refundId);
        }
    }

    public RefundView view(UUID refundId) {
        RefundView r = jdbc.query("SELECT " + REFUND_COLS + " FROM ticket_refunds WHERE id=?",
                rs -> rs.next() ? map(rs) : null, refundId);
        if (r == null) {
            throw notFound("REFUND_NOT_FOUND");
        }
        return r;
    }

    private RefundView lockRefund(UUID refundId) {
        RefundView r = jdbc.query("SELECT " + REFUND_COLS + " FROM ticket_refunds WHERE id=?"
                + " FOR UPDATE", rs -> rs.next() ? map(rs) : null, refundId);
        if (r == null) {
            throw notFound("REFUND_NOT_FOUND");
        }
        return r;
    }

    private static String sourceFor(String type) {
        return switch (type) {
            case "BUYER_REQUESTED" -> "BUYER";
            case "ADMIN_OVERRIDE" -> "ADMIN";
            default -> "ORGANISER";
        };
    }

    private static String prefixed() {
        return "r." + REFUND_COLS.replace(",", ",r.");
    }

    private static RefundView map(ResultSet rs) throws SQLException {
        var approved = rs.getTimestamp("approved_at");
        var processed = rs.getTimestamp("processed_at");
        return new RefundView(rs.getObject("id", UUID.class), rs.getObject("order_id", UUID.class),
                rs.getObject("issued_ticket_id", UUID.class), rs.getBigDecimal("refund_amount"),
                rs.getBigDecimal("platform_fee_refund"), rs.getString("currency_code").trim(),
                rs.getString("refund_type"), rs.getString("status"), rs.getString("reason"),
                rs.getString("provider_refund_id"), rs.getObject("requested_by", UUID.class),
                rs.getObject("approved_by", UUID.class), rs.getTimestamp("created_at").toInstant(),
                approved == null ? null : approved.toInstant(),
                processed == null ? null : processed.toInstant());
    }
}
