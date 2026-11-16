package com.diasporum.backend.events.internal.application.ticketing;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Shared persistence for ticket orders and reservations. Every status change is
 * a conditional UPDATE ({@code WHERE status IN (...)}) plus an audit row in
 * {@code ticket_order_status_history}, so competing paths (webhook, expiry
 * worker, buyer cancel) can never both win a transition. Inventory is only
 * moved with guarded arithmetic updates — never read-then-write.
 */
@Component
public class TicketOrderStore {

    static final String ORDER_COLS = "o.id,o.event_id,o.buyer_user_id,o.order_number,o.currency_code,"
            + "o.subtotal_amount,o.platform_fee_amount,o.discount_amount,o.total_amount,o.fee_paid_by,"
            + "o.promo_code_id,o.status,o.payment_provider,o.payment_provider_id,"
            + "o.payment_method_summary,o.idempotency_key,o.reservation_id,o.created_at,o.paid_at,"
            + "o.cancelled_at,o.expires_at";
    private static final String RES_COLS = "id,ticket_type_id,buyer_user_id,quantity,status,"
            + "expires_at,confirmed_order_id";
    private static final String HISTORY = "INSERT INTO ticket_order_status_history(order_id,"
            + "previous_status,new_status,changed_by_user_id,change_source,reason)"
            + " VALUES(?,?,?,?,?,?)";

    private final JdbcTemplate jdbc;

    public TicketOrderStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record OrderRow(UUID id, UUID eventId, UUID buyerUserId, String orderNumber,
            String currencyCode, BigDecimal subtotalAmount, BigDecimal platformFeeAmount,
            BigDecimal discountAmount, BigDecimal totalAmount, String feePaidBy, UUID promoCodeId,
            String status, String paymentProvider, String paymentProviderId,
            String paymentMethodSummary, String idempotencyKey, UUID reservationId,
            Instant createdAt, Instant paidAt, Instant cancelledAt, Instant expiresAt) {
    }

    public record ReservationRow(UUID id, UUID ticketTypeId, UUID buyerUserId, int quantity,
            String status, Instant expiresAt, UUID confirmedOrderId) {
    }

    // =================== orders ===================

    public OrderRow order(UUID id) {
        return jdbc.query("SELECT " + ORDER_COLS + " FROM ticket_orders o WHERE o.id=?",
                rs -> rs.next() ? mapOrder(rs) : null, id);
    }

    public OrderRow lockOrder(UUID id) {
        return jdbc.query("SELECT " + ORDER_COLS + " FROM ticket_orders o WHERE o.id=? FOR UPDATE",
                rs -> rs.next() ? mapOrder(rs) : null, id);
    }

    public OrderRow requireOrder(UUID id) {
        OrderRow o = order(id);
        if (o == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "ORDER_NOT_FOUND");
        }
        return o;
    }

    public OrderRow byIdempotencyKey(String key) {
        return jdbc.query("SELECT " + ORDER_COLS + " FROM ticket_orders o WHERE o.idempotency_key=?",
                rs -> rs.next() ? mapOrder(rs) : null, key);
    }

    public OrderRow byPaymentIntent(String paymentIntentId) {
        return jdbc.query("SELECT " + ORDER_COLS + " FROM ticket_orders o WHERE o.payment_provider=?"
                + " AND o.payment_provider_id=?", rs -> rs.next() ? mapOrder(rs) : null,
                TicketPaymentGateway.PROVIDER_KEY, paymentIntentId);
    }

    /**
     * Conditional transition + history; false when the order was not in
     * {@code from}. Must run inside the caller's transaction: the row lock
     * taken here serializes competing transitions until commit.
     */
    public boolean transition(UUID orderId, List<String> from, String to, UUID actor,
            String source, String reason) {
        String previous = jdbc.query("SELECT status FROM ticket_orders WHERE id=? FOR UPDATE",
                rs -> rs.next() ? rs.getString(1) : null, orderId);
        if (previous == null || !from.contains(previous)) {
            return false;
        }
        jdbc.update("UPDATE ticket_orders SET status=?,"
                + " paid_at=CASE WHEN ?='PAID' THEN now() ELSE paid_at END,"
                + " cancelled_at=CASE WHEN ? IN ('CANCELLED','EXPIRED') THEN now() ELSE cancelled_at END"
                + " WHERE id=? AND status=?", to, to, to, orderId, previous);
        if (!previous.equals(to)) {
            history(orderId, previous, to, actor, source, reason);
        }
        return true;
    }

    public void history(UUID orderId, String previous, String to, UUID actor, String source,
            String reason) {
        jdbc.update(HISTORY, orderId, previous, to, actor, source, reason);
    }

    // =================== reservations ===================

    public ReservationRow reservation(UUID id) {
        return jdbc.query("SELECT " + RES_COLS + " FROM ticket_reservations WHERE id=?",
                rs -> rs.next() ? mapReservation(rs) : null, id);
    }

    public ReservationRow lockReservation(UUID id) {
        return jdbc.query("SELECT " + RES_COLS + " FROM ticket_reservations WHERE id=? FOR UPDATE",
                rs -> rs.next() ? mapReservation(rs) : null, id);
    }

    /**
     * ACTIVE → RELEASED and give the held quantity back. Idempotent: a second
     * call finds no ACTIVE row and restores nothing.
     */
    public boolean releaseReservation(UUID reservationId) {
        if (reservationId == null) {
            return false;
        }
        ReservationRow r = jdbc.query("UPDATE ticket_reservations SET status='RELEASED',"
                + "updated_at=now() WHERE id=? AND status='ACTIVE' RETURNING " + RES_COLS,
                rs -> rs.next() ? mapReservation(rs) : null, reservationId);
        if (r == null) {
            return false;
        }
        jdbc.update("UPDATE event_ticket_types SET quantity_reserved=quantity_reserved-?,"
                + "updated_at=now() WHERE id=? AND quantity_reserved>=?", r.quantity(),
                r.ticketTypeId(), r.quantity());
        return true;
    }

    /** Gives back one promo use for an order that never got paid. */
    public void restorePromoUse(UUID promoCodeId) {
        if (promoCodeId != null) {
            jdbc.update("UPDATE event_ticket_promo_codes SET used_count=used_count-1,"
                    + "updated_at=now() WHERE id=? AND used_count>0", promoCodeId);
        }
    }

    // =================== mapping ===================

    static OrderRow mapOrder(ResultSet rs) throws SQLException {
        return new OrderRow(rs.getObject("id", UUID.class), rs.getObject("event_id", UUID.class),
                rs.getObject("buyer_user_id", UUID.class), rs.getString("order_number"),
                rs.getString("currency_code").trim(), rs.getBigDecimal("subtotal_amount"),
                rs.getBigDecimal("platform_fee_amount"), rs.getBigDecimal("discount_amount"),
                rs.getBigDecimal("total_amount"), rs.getString("fee_paid_by"),
                rs.getObject("promo_code_id", UUID.class), rs.getString("status"),
                rs.getString("payment_provider"), rs.getString("payment_provider_id"),
                rs.getString("payment_method_summary"), rs.getString("idempotency_key"),
                rs.getObject("reservation_id", UUID.class), instant(rs.getTimestamp("created_at")),
                instant(rs.getTimestamp("paid_at")), instant(rs.getTimestamp("cancelled_at")),
                instant(rs.getTimestamp("expires_at")));
    }

    static ReservationRow mapReservation(ResultSet rs) throws SQLException {
        return new ReservationRow(rs.getObject("id", UUID.class),
                rs.getObject("ticket_type_id", UUID.class), rs.getObject("buyer_user_id", UUID.class),
                rs.getInt("quantity"), rs.getString("status"), instant(rs.getTimestamp("expires_at")),
                rs.getObject("confirmed_order_id", UUID.class));
    }

    static Instant instant(Timestamp ts) {
        return ts == null ? null : ts.toInstant();
    }

    // =================== cursors ===================

    /** Opaque keyset cursor over (created_at DESC, id DESC). */
    public record Cursor(Instant createdAt, UUID id) {
        public String encode() {
            return Base64.getUrlEncoder().withoutPadding().encodeToString(
                    (createdAt.toString() + "|" + id).getBytes(StandardCharsets.UTF_8));
        }

        public static Cursor decode(String raw) {
            if (raw == null || raw.isBlank()) {
                return null;
            }
            try {
                String[] parts = new String(Base64.getUrlDecoder().decode(raw),
                        StandardCharsets.UTF_8).split("\\|", 2);
                return new Cursor(Instant.parse(parts[0]), UUID.fromString(parts[1]));
            } catch (RuntimeException e) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "CURSOR_INVALID");
            }
        }
    }
}
