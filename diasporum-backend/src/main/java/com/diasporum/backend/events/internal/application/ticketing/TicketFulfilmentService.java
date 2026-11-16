package com.diasporum.backend.events.internal.application.ticketing;

import com.diasporum.backend.events.internal.application.ticketing.TicketLedger.Source;
import com.diasporum.backend.events.internal.application.ticketing.TicketOrderStore.OrderRow;
import com.diasporum.backend.events.internal.application.ticketing.TicketOrderStore.ReservationRow;
import com.diasporum.backend.events.internal.application.ticketing.TicketingAccess.TicketedEvent;
import com.diasporum.backend.identity.IdentityApi;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * Turns a paid (or free) order into tickets in ONE transaction: order → PAID,
 * held inventory → sold, reservation → CONFIRMED, item snapshot, issued tickets
 * with opaque codes, and the organiser ledger (TICKET_SALE gross credit +
 * PLATFORM_FEE debit for the organiser-borne share). Re-entrant: a second call
 * for an already-paid order is a no-op, so webhook replays and the
 * reconciliation worker can both call it safely.
 */
@Service
public class TicketFulfilmentService {
    private static final Logger log = LoggerFactory.getLogger(TicketFulfilmentService.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    static final List<String> UNPAID = List.of("RESERVED", "PAYMENT_PENDING");
    static final List<String> PAID_OR_LATER = List.of("PAID", "REFUND_REQUESTED",
            "PARTIALLY_REFUNDED", "REFUNDED");

    private static final String MOVE_HELD = "UPDATE event_ticket_types SET"
            + " quantity_reserved=quantity_reserved-?, quantity_sold=quantity_sold+?,"
            + " updated_at=now() WHERE id=? AND quantity_reserved>=?";
    private static final String SELL_FREE_STOCK = "UPDATE event_ticket_types SET"
            + " quantity_sold=quantity_sold+?, updated_at=now()"
            + " WHERE id=? AND quantity_sold+quantity_reserved+?<=quantity_total";
    private static final String INSERT_ITEM = "INSERT INTO ticket_order_items(order_id,"
            + "ticket_type_id,ticket_type_name_snapshot,quantity,unit_price,discount_per_unit,"
            + "line_total) VALUES(?,?,?,?,?,?,?) RETURNING id";
    private static final String INSERT_TICKET = "INSERT INTO issued_tickets(order_item_id,"
            + "ticket_type_id,event_id,holder_user_id,holder_name,ticket_code,qr_payload)"
            + " VALUES(?,?,?,?,?,?,?)";
    private static final String PRICING = "SELECT metadata::text FROM ticket_order_status_history"
            + " WHERE order_id=? AND previous_status IS NULL AND metadata IS NOT NULL"
            + " ORDER BY changed_at LIMIT 1";
    private static final String LATE_REFUND = "INSERT INTO ticket_refunds(order_id,refund_amount,"
            + "currency_code,refund_type,status,reason,idempotency_key,approved_at)"
            + " VALUES(?,?,?,'ADMIN_OVERRIDE','APPROVED',"
            + "'Payment received after the order was closed',?,now())"
            + " ON CONFLICT (idempotency_key) DO NOTHING";

    private final JdbcTemplate jdbc;
    private final TicketOrderStore store;
    private final TicketingAccess access;
    private final TicketLedger ledger;
    private final IdentityApi identity;
    private final TicketNotifications notifications;

    public TicketFulfilmentService(JdbcTemplate jdbc, TicketOrderStore store, TicketingAccess access,
            TicketLedger ledger, IdentityApi identity, TicketNotifications notifications) {
        this.jdbc = jdbc;
        this.store = store;
        this.access = access;
        this.ledger = ledger;
        this.identity = identity;
        this.notifications = notifications;
    }

    public enum Outcome { CONFIRMED, ALREADY_PAID, LATE_PAYMENT_REFUND_QUEUED }

    /** Pricing snapshot taken at order creation (organiser fee is not an order column). */
    public record PricingSnapshot(int quantity, BigDecimal unitPrice, BigDecimal unitDiscount,
            BigDecimal unitFee, BigDecimal buyerFee, BigDecimal organiserFee, UUID ticketTypeId) {
    }

    @Transactional
    public Outcome confirmPaid(UUID orderId, String source, UUID actor) {
        OrderRow order = store.lockOrder(orderId);
        if (order == null) {
            throw new IllegalStateException("order not found: " + orderId);
        }
        if (PAID_OR_LATER.contains(order.status())) {
            return Outcome.ALREADY_PAID;
        }
        if (!UNPAID.contains(order.status())) {
            return queueLateRefund(order);
        }
        PricingSnapshot pricing = pricing(orderId);
        int q = pricing.quantity();
        ReservationRow reservation = order.reservationId() == null ? null
                : store.lockReservation(order.reservationId());
        boolean moved = false;
        if (reservation != null && "ACTIVE".equals(reservation.status())) {
            moved = jdbc.update(MOVE_HELD, q, q, pricing.ticketTypeId(), q) == 1;
        }
        if (!moved && jdbc.update(SELL_FREE_STOCK, q, pricing.ticketTypeId(), q) == 0) {
            // Hold lost and no free stock left: never oversell — refund instead.
            store.transition(orderId, UNPAID, "EXPIRED", null, "SYSTEM",
                    "Inventory no longer available at payment confirmation");
            store.releaseReservation(order.reservationId());
            store.restorePromoUse(order.promoCodeId());
            return queueLateRefund(store.order(orderId));
        }
        if (reservation != null && "ACTIVE".equals(reservation.status())) {
            jdbc.update("UPDATE ticket_reservations SET status='CONFIRMED',confirmed_order_id=?,"
                    + "updated_at=now() WHERE id=? AND status='ACTIVE'", orderId, reservation.id());
        }
        store.transition(orderId, UNPAID, "PAID", actor, source, null);

        String typeName = jdbc.queryForObject("SELECT name FROM event_ticket_types WHERE id=?",
                String.class, pricing.ticketTypeId());
        BigDecimal qty = BigDecimal.valueOf(q);
        BigDecimal lineTotal = pricing.unitPrice().subtract(pricing.unitDiscount()).multiply(qty);
        UUID itemId = jdbc.queryForObject(INSERT_ITEM, UUID.class, orderId, pricing.ticketTypeId(),
                typeName, q, pricing.unitPrice(), pricing.unitDiscount(), lineTotal);
        String holderName = order.buyerUserId() == null ? null
                : identity.profileSummary(order.buyerUserId())
                        .map(p -> p.displayName() != null ? p.displayName() : p.username())
                        .orElse(null);
        for (int i = 0; i < q; i++) {
            issueTicket(itemId, pricing.ticketTypeId(), order.eventId(), order.buyerUserId(),
                    holderName);
        }
        TicketedEvent e = access.requireEvent(order.eventId());
        ledger.credit(e, "TICKET_SALE", Source.order(orderId), lineTotal,
                "Ticket sale " + order.orderNumber(), "order:" + orderId + ":sale");
        ledger.debit(e, "PLATFORM_FEE", Source.order(orderId), pricing.organiserFee().multiply(qty),
                "Platform fee (" + order.feePaidBy() + ") " + order.orderNumber(),
                "order:" + orderId + ":fee");
        notifications.purchased(order.buyerUserId(), order.eventId(), e.title(), orderId, q);
        return Outcome.CONFIRMED;
    }

    private void issueTicket(UUID itemId, UUID typeId, UUID eventId, UUID holder, String holderName) {
        for (int attempt = 0; ; attempt++) {
            try {
                jdbc.update(INSERT_TICKET, itemId, typeId, eventId, holder, holderName,
                        TicketCodes.ticketCode(), TicketCodes.qrPayload());
                return;
            } catch (DuplicateKeyException collision) {
                // 60/256-bit random codes: a collision is astronomically unlikely; retry once.
                if (attempt >= 2) {
                    throw collision;
                }
            }
        }
    }

    /**
     * Money arrived for an order that is already closed (expired/cancelled, or
     * its inventory was lost). Queue a full refund; the refund worker sends it.
     */
    private Outcome queueLateRefund(OrderRow order) {
        if (order.totalAmount().signum() > 0) {
            jdbc.update(LATE_REFUND, order.id(), order.totalAmount(), order.currencyCode(),
                    "late-payment:" + order.id());
            log.warn("Late payment for closed ticket order {} — full refund queued", order.id());
        }
        return Outcome.LATE_PAYMENT_REFUND_QUEUED;
    }

    public PricingSnapshot pricing(UUID orderId) {
        String json = jdbc.query(PRICING, rs -> rs.next() ? rs.getString(1) : null, orderId);
        if (json == null) {
            throw new IllegalStateException("pricing snapshot missing for order " + orderId);
        }
        Map<?, ?> m = JSON.readValue(json, Map.class);
        return new PricingSnapshot(Integer.parseInt(String.valueOf(m.get("quantity"))),
                dec(m.get("unit_price")), dec(m.get("unit_discount")), dec(m.get("unit_fee")),
                dec(m.get("buyer_fee")), dec(m.get("organiser_fee")),
                UUID.fromString(String.valueOf(m.get("ticket_type_id"))));
    }

    static String pricingJson(PricingSnapshot p) {
        return JSON.writeValueAsString(Map.of("quantity", p.quantity(),
                "unit_price", p.unitPrice().toPlainString(),
                "unit_discount", p.unitDiscount().toPlainString(),
                "unit_fee", p.unitFee().toPlainString(),
                "buyer_fee", p.buyerFee().toPlainString(),
                "organiser_fee", p.organiserFee().toPlainString(),
                "ticket_type_id", p.ticketTypeId().toString()));
    }

    private static BigDecimal dec(Object v) {
        return new BigDecimal(String.valueOf(v)).setScale(2, RoundingMode.UNNECESSARY);
    }
}
