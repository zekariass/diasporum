package com.diasporum.backend.events.internal.application.ticketing;

import static com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.bad;
import static com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.conflict;
import static com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.notFound;

import com.diasporum.backend.events.internal.application.ticketing.TicketFeeCalculator.Discount;
import com.diasporum.backend.events.internal.application.ticketing.TicketFeeCalculator.OrderTotals;
import com.diasporum.backend.events.internal.application.ticketing.TicketFeeCalculator.UnitPricing;
import com.diasporum.backend.events.internal.application.ticketing.TicketFulfilmentService.PricingSnapshot;
import com.diasporum.backend.events.internal.application.ticketing.TicketOrderStore.Cursor;
import com.diasporum.backend.events.internal.application.ticketing.TicketOrderStore.OrderRow;
import com.diasporum.backend.events.internal.application.ticketing.TicketOrderStore.ReservationRow;
import com.diasporum.backend.events.internal.application.ticketing.TicketPaymentGateway.Intent;
import com.diasporum.backend.events.internal.application.ticketing.TicketingAccess.TicketedEvent;
import java.math.BigDecimal;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/**
 * Reservation → order. Free orders are paid and fulfilled in the creating
 * transaction. Paid orders commit RESERVED first, then create the platform
 * PaymentIntent OUTSIDE any transaction (keyed {@code ticket-order:{id}}, so a
 * retry reuses the same intent), then move to PAYMENT_PENDING. The buyer's
 * idempotency key is stored namespaced ({@code buyerId:key}) because the column
 * is globally unique.
 */
@Service
public class TicketOrderService {

    private static final String INSERT_ORDER = "INSERT INTO ticket_orders(event_id,buyer_user_id,"
            + "order_number,currency_code,subtotal_amount,platform_fee_amount,discount_amount,"
            + "total_amount,fee_paid_by,promo_code_id,status,idempotency_key,reservation_id,"
            + "expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,'RESERVED',?,?,now()+(?*interval '1 second'))"
            + " RETURNING id";
    private static final String CREATED_HISTORY = "INSERT INTO ticket_order_status_history("
            + "order_id,previous_status,new_status,changed_by_user_id,change_source,metadata)"
            + " VALUES(?,NULL,'RESERVED',?,'BUYER',?::jsonb)";
    private static final String PROMO = "SELECT id,discount_type,discount_value,currency_code,"
            + "max_uses,used_count,max_uses_per_user,applicable_ticket_type_ids,valid_from,"
            + "valid_until,is_active FROM event_ticket_promo_codes WHERE event_id=? AND code=?"
            + " FOR UPDATE";
    private static final String TICKET_VIEW_COLS = "t.id,t.event_id,e.title AS event_title,"
            + "e.starts_at,t.ticket_type_id,tt.name AS type_name,t.ticket_code,t.qr_payload,t.status,"
            + "t.checked_in_at,t.holder_name,i.order_id";

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final TicketingAccess access;
    private final TicketOrderStore store;
    private final TicketFeeConfigs feeConfigs;
    private final TicketFulfilmentService fulfilment;
    private final TicketPaymentGateway gateway;
    private final TicketingProperties properties;

    public TicketOrderService(JdbcTemplate jdbc, org.springframework.transaction.PlatformTransactionManager txManager, TicketingAccess access,
            TicketOrderStore store, TicketFeeConfigs feeConfigs, TicketFulfilmentService fulfilment,
            TicketPaymentGateway gateway, TicketingProperties properties) {
        this.jdbc = jdbc;
        this.tx = new TransactionTemplate(txManager);
        this.access = access;
        this.store = store;
        this.feeConfigs = feeConfigs;
        this.fulfilment = fulfilment;
        this.gateway = gateway;
        this.properties = properties;
    }

    public record OrderView(UUID id, UUID eventId, String orderNumber, String status,
            String currencyCode, BigDecimal subtotalAmount, BigDecimal discountAmount,
            BigDecimal platformFeeAmount, BigDecimal totalAmount, String feePaidBy,
            Integer quantity, UUID ticketTypeId, String paymentProvider, Instant createdAt,
            Instant paidAt, Instant expiresAt, String clientSecret, List<TicketView> tickets) {
    }

    public record OrderPage(List<OrderView> items, String nextCursor) {
    }

    public record TicketView(UUID id, UUID eventId, String eventTitle, Instant eventStartsAt,
            UUID ticketTypeId, String ticketTypeName, String ticketCode, String qrPayload,
            String status, Instant checkedInAt, String holderName, UUID orderId) {
    }

    // =================== create ===================

    public OrderView create(UUID buyer, UUID reservationId, String promoCode, String idempotencyKey) {
        if (idempotencyKey == null || idempotencyKey.isBlank() || idempotencyKey.length() > 120) {
            throw bad("IDEMPOTENCY_KEY_REQUIRED");
        }
        String storedKey = buyer + ":" + idempotencyKey.trim();
        OrderRow existing = store.byIdempotencyKey(storedKey);
        if (existing == null) {
            try {
                existing = tx.execute(s -> insertOrder(buyer, reservationId, promoCode, storedKey));
            } catch (DuplicateKeyException race) {
                existing = store.byIdempotencyKey(storedKey);
                if (existing == null) {
                    throw conflict("RESERVATION_IN_CHECKOUT");
                }
            }
        }
        if (!reservationId.equals(existing.reservationId())) {
            throw conflict("IDEMPOTENCY_KEY_REUSED");
        }
        return resumePayment(existing);
    }

    private OrderRow insertOrder(UUID buyer, UUID reservationId, String promoCode, String storedKey) {
        ReservationRow r = store.lockReservation(reservationId);
        if (r == null || !r.buyerUserId().equals(buyer)) {
            throw notFound("RESERVATION_NOT_FOUND");
        }
        if (!"ACTIVE".equals(r.status()) || !r.expiresAt().isAfter(Instant.now())) {
            throw conflict("RESERVATION_EXPIRED");
        }
        Integer live = jdbc.queryForObject("SELECT count(*) FROM ticket_orders WHERE reservation_id=?",
                Integer.class, reservationId);
        if (live != null && live > 0) {
            throw conflict("RESERVATION_IN_CHECKOUT");
        }
        var type = jdbc.query("SELECT event_id,price_amount FROM event_ticket_types WHERE id=?",
                rs -> rs.next() ? new Object[]{rs.getObject(1, UUID.class), rs.getBigDecimal(2)}
                        : null, r.ticketTypeId());
        UUID eventId = (UUID) type[0];
        TicketedEvent e = access.requireEvent(eventId);
        TicketReservationService.requireOnSale(e);

        UUID promoId = null;
        Discount discount = null;
        if (promoCode != null && !promoCode.isBlank()) {
            Object[] promo = applyPromo(buyer, e, r.ticketTypeId(), promoCode.trim().toUpperCase());
            promoId = (UUID) promo[0];
            discount = (Discount) promo[1];
        }
        var config = feeConfigs.forEvent(e);
        UnitPricing unit = TicketFeeCalculator.unit((BigDecimal) type[1], e.currencyCode(), discount,
                config, e.feeModel());
        if ("SPLIT".equals(unit.feePaidBy()) && config.organiserSplitBps() == null) {
            throw conflict("TICKET_FEE_SPLIT_UNCONFIGURED");
        }
        OrderTotals totals = TicketFeeCalculator.totals(unit, r.quantity());
        if (totals.total().signum() > 0 && !gateway.available()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "PAYMENT_PROVIDER_UNAVAILABLE");
        }
        long ttl = Math.max(properties.paymentTtl().toSeconds(), 60);
        UUID orderId = jdbc.queryForObject(INSERT_ORDER, UUID.class, eventId, buyer,
                TicketCodes.orderNumber(), e.currencyCode(), totals.subtotal(), totals.platformFee(),
                totals.discount(), totals.total(), unit.feePaidBy(), promoId, storedKey,
                reservationId, ttl);
        jdbc.update(CREATED_HISTORY, orderId, buyer, TicketFulfilmentService.pricingJson(
                new PricingSnapshot(r.quantity(), unit.unitPrice(), unit.unitDiscount(),
                        unit.unitFee(), unit.buyerFee(), unit.organiserFee(), r.ticketTypeId())));
        // The hold now lives as long as the checkout window.
        jdbc.update("UPDATE ticket_reservations SET expires_at=(SELECT expires_at FROM ticket_orders"
                + " WHERE id=?),updated_at=now() WHERE id=?", orderId, reservationId);
        if (totals.total().signum() == 0) {
            fulfilment.confirmPaid(orderId, "SYSTEM", buyer);
        }
        return store.order(orderId);
    }

    /** Locks + validates the promo code and consumes one use. Returns [promoId, Discount]. */
    private Object[] applyPromo(UUID buyer, TicketedEvent e, UUID ticketTypeId, String code) {
        Object[] p = jdbc.query(PROMO, rs -> rs.next() ? promoRow(rs) : null, e.id(), code);
        if (p == null || !(Boolean) p[10]) {
            throw bad("PROMO_CODE_INVALID");
        }
        Instant now = Instant.now();
        Instant from = (Instant) p[8];
        Instant until = (Instant) p[9];
        if (now.isBefore(from) || until != null && !now.isBefore(until)) {
            throw bad("PROMO_CODE_INVALID");
        }
        @SuppressWarnings("unchecked")
        List<UUID> types = (List<UUID>) p[7];
        if (types != null && !types.contains(ticketTypeId)) {
            throw bad("PROMO_CODE_NOT_APPLICABLE");
        }
        if ("FIXED_AMOUNT".equals(p[1]) && !e.currencyCode().equals(p[3])) {
            throw bad("PROMO_CODE_INVALID");
        }
        Integer maxUses = (Integer) p[4];
        if (maxUses != null && (Integer) p[5] >= maxUses) {
            throw conflict("PROMO_CODE_EXHAUSTED");
        }
        Integer perUser = (Integer) p[6];
        UUID promoId = (UUID) p[0];
        if (perUser != null) {
            Integer used = jdbc.queryForObject("SELECT count(*) FROM ticket_orders WHERE"
                    + " promo_code_id=? AND buyer_user_id=? AND status NOT IN ('EXPIRED','CANCELLED')",
                    Integer.class, promoId, buyer);
            if (used != null && used >= perUser) {
                throw conflict("PROMO_USER_LIMIT_REACHED");
            }
        }
        jdbc.update("UPDATE event_ticket_promo_codes SET used_count=used_count+1,updated_at=now()"
                + " WHERE id=?", promoId);
        return new Object[]{promoId, new Discount((String) p[1], (BigDecimal) p[2])};
    }

    private static Object[] promoRow(ResultSet rs) throws SQLException {
        int max = rs.getInt("max_uses");
        Integer maxUses = rs.wasNull() ? null : max;
        int per = rs.getInt("max_uses_per_user");
        Integer perUser = rs.wasNull() ? null : per;
        Array arr = rs.getArray("applicable_ticket_type_ids");
        List<UUID> types = arr == null ? null
                : Arrays.stream((Object[]) arr.getArray()).map(o -> (UUID) o).toList();
        String currency = rs.getString("currency_code");
        var until = rs.getTimestamp("valid_until");
        return new Object[]{rs.getObject("id", UUID.class), rs.getString("discount_type"),
            rs.getBigDecimal("discount_value"), currency == null ? null : currency.trim(), maxUses,
            rs.getInt("used_count"), perUser, types, rs.getTimestamp("valid_from").toInstant(),
            until == null ? null : until.toInstant(), rs.getBoolean("is_active")};
    }

    /**
     * Ensures a paid RESERVED order has its PaymentIntent and returns the view
     * with the client secret; terminal or free orders are returned as-is.
     */
    private OrderView resumePayment(OrderRow order) {
        if ("RESERVED".equals(order.status()) && order.totalAmount().signum() > 0) {
            Intent intent = gateway.createPaymentIntent("ticket-order:" + order.id(),
                    TicketMoney.toMinor(order.totalAmount(), order.currencyCode()),
                    order.currencyCode(), Map.of("ticket_order_id", order.id().toString(),
                            "event_id", order.eventId().toString(),
                            "order_number", order.orderNumber()));
            Boolean attached = tx.execute(s -> {
                int n = jdbc.update("UPDATE ticket_orders SET payment_provider=?,"
                        + "payment_provider_id=? WHERE id=? AND status='RESERVED'",
                        TicketPaymentGateway.PROVIDER_KEY, intent.id(), order.id());
                return n == 1 && store.transition(order.id(), List.of("RESERVED"),
                        "PAYMENT_PENDING", order.buyerUserId(), "BUYER", null);
            });
            if (!Boolean.TRUE.equals(attached)) {
                // Closed meanwhile (expired/cancelled): do not leave a payable intent behind.
                gateway.cancel(intent.id());
                return view(store.order(order.id()), null, false);
            }
            return view(store.order(order.id()), intent.clientSecret(), false);
        }
        if ("PAYMENT_PENDING".equals(order.status()) && order.paymentProviderId() != null) {
            Intent intent = gateway.retrieve(order.paymentProviderId());
            return view(order, intent.clientSecret(), false);
        }
        return view(order, null, true);
    }

    // =================== cancel ===================

    /** Buyer abandons an unpaid order: the intent is cancelled first so it can no longer be paid. */
    public OrderView cancel(UUID buyer, UUID orderId) {
        OrderRow order = store.requireOrder(orderId);
        if (!buyer.equals(order.buyerUserId())) {
            throw notFound("ORDER_NOT_FOUND");
        }
        if (!TicketFulfilmentService.UNPAID.contains(order.status())) {
            throw conflict("ORDER_NOT_CANCELLABLE");
        }
        if (order.paymentProviderId() != null) {
            Intent intent = gateway.cancel(order.paymentProviderId());
            if (intent.succeeded()) {
                fulfilment.confirmPaid(orderId, "SYSTEM", null);
                throw conflict("ORDER_ALREADY_PAID");
            }
            if (intent.processing()) {
                throw conflict("PAYMENT_IN_PROGRESS");
            }
        }
        tx.executeWithoutResult(s -> closeUnpaid(orderId, "CANCELLED", buyer, "BUYER",
                "Cancelled by buyer"));
        return view(store.order(orderId), null, true);
    }

    /** RESERVED/PAYMENT_PENDING → CANCELLED|EXPIRED, hold released, promo use returned. */
    boolean closeUnpaid(UUID orderId, String target, UUID actor, String source, String reason) {
        OrderRow order = store.lockOrder(orderId);
        if (order == null || !store.transition(orderId, TicketFulfilmentService.UNPAID, target,
                actor, source, reason)) {
            return false;
        }
        store.releaseReservation(order.reservationId());
        store.restorePromoUse(order.promoCodeId());
        return true;
    }

    // =================== buyer views ===================

    @Transactional(readOnly = true)
    public OrderView order(UUID buyer, UUID orderId) {
        OrderRow order = store.requireOrder(orderId);
        if (!buyer.equals(order.buyerUserId())) {
            throw notFound("ORDER_NOT_FOUND");
        }
        return view(order, null, true);
    }

    @Transactional(readOnly = true)
    public OrderPage myOrders(UUID buyer, String cursor, Integer limit) {
        return page("o.buyer_user_id=?", buyer, cursor, limit);
    }

    /** Organiser dashboard: all orders of an event. */
    @Transactional(readOnly = true)
    public OrderPage eventOrders(UUID actor, UUID eventId, String cursor, Integer limit) {
        access.requireManager(actor, eventId);
        return page("o.event_id=?", eventId, cursor, limit);
    }

    private OrderPage page(String filter, UUID key, String rawCursor, Integer limit) {
        int size = limit == null ? 20 : Math.min(Math.max(limit, 1), 50);
        Cursor c = Cursor.decode(rawCursor);
        List<Object> args = new ArrayList<>(List.of(key));
        String sql = "SELECT " + TicketOrderStore.ORDER_COLS + " FROM ticket_orders o WHERE " + filter;
        if (c != null) {
            sql += " AND (o.created_at,o.id) < (?,?)";
            args.add(java.sql.Timestamp.from(c.createdAt()));
            args.add(c.id());
        }
        sql += " ORDER BY o.created_at DESC,o.id DESC LIMIT " + (size + 1);
        List<OrderRow> rows = jdbc.query(sql, (rs, i) -> TicketOrderStore.mapOrder(rs), args.toArray());
        String next = null;
        if (rows.size() > size) {
            rows = rows.subList(0, size);
            OrderRow last = rows.get(size - 1);
            next = new Cursor(last.createdAt(), last.id()).encode();
        }
        return new OrderPage(rows.stream().map(o -> view(o, null, false)).toList(), next);
    }

    @Transactional(readOnly = true)
    public List<TicketView> myTickets(UUID holder, UUID eventId, String status) {
        List<Object> args = new ArrayList<>(List.of(holder));
        String sql = "SELECT " + TICKET_VIEW_COLS + " FROM issued_tickets t"
                + " JOIN events e ON e.id=t.event_id JOIN event_ticket_types tt ON tt.id=t.ticket_type_id"
                + " JOIN ticket_order_items i ON i.id=t.order_item_id WHERE t.holder_user_id=?";
        if (eventId != null) {
            sql += " AND t.event_id=?";
            args.add(eventId);
        }
        if (status != null && !status.isBlank()) {
            sql += " AND t.status=?";
            args.add(status.trim().toUpperCase());
        }
        sql += " ORDER BY e.starts_at,t.created_at LIMIT 500";
        return jdbc.query(sql, (rs, i) -> mapTicket(rs), args.toArray());
    }

    private OrderView view(OrderRow o, String clientSecret, boolean withTickets) {
        var item = jdbc.query("SELECT ticket_type_id,quantity FROM ticket_order_items WHERE order_id=?"
                + " LIMIT 1", rs -> rs.next() ? new Object[]{rs.getObject(1, UUID.class), rs.getInt(2)}
                : null, o.id());
        UUID typeId = null;
        Integer quantity = null;
        if (item != null) {
            typeId = (UUID) item[0];
            quantity = (Integer) item[1];
        } else if (o.reservationId() != null) {
            ReservationRow r = store.reservation(o.reservationId());
            if (r != null) {
                typeId = r.ticketTypeId();
                quantity = r.quantity();
            }
        }
        List<TicketView> tickets = withTickets ? jdbc.query("SELECT " + TICKET_VIEW_COLS
                + " FROM issued_tickets t JOIN events e ON e.id=t.event_id"
                + " JOIN event_ticket_types tt ON tt.id=t.ticket_type_id"
                + " JOIN ticket_order_items i ON i.id=t.order_item_id WHERE i.order_id=?"
                + " ORDER BY t.created_at", (rs, i) -> mapTicket(rs), o.id()) : null;
        return new OrderView(o.id(), o.eventId(), o.orderNumber(), o.status(), o.currencyCode(),
                o.subtotalAmount(), o.discountAmount(), o.platformFeeAmount(), o.totalAmount(),
                o.feePaidBy(), quantity, typeId, o.paymentProvider(), o.createdAt(), o.paidAt(),
                o.expiresAt(), clientSecret, tickets);
    }

    private static TicketView mapTicket(ResultSet rs) throws SQLException {
        var checked = rs.getTimestamp("checked_in_at");
        return new TicketView(rs.getObject("id", UUID.class), rs.getObject("event_id", UUID.class),
                rs.getString("event_title"), rs.getTimestamp("starts_at").toInstant(),
                rs.getObject("ticket_type_id", UUID.class), rs.getString("type_name"),
                rs.getString("ticket_code"), rs.getString("qr_payload"), rs.getString("status"),
                checked == null ? null : checked.toInstant(), rs.getString("holder_name"),
                rs.getObject("order_id", UUID.class));
    }
}
