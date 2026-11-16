package com.diasporum.backend.events.internal.application.ticketing;

import static com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.conflict;
import static com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.bad;
import static com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.notFound;

import com.diasporum.backend.events.internal.application.EventService;
import com.diasporum.backend.events.internal.application.ticketing.TicketOrderStore.ReservationRow;
import com.diasporum.backend.events.internal.application.ticketing.TicketingAccess.TicketedEvent;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Inventory holds. The hold is a single guarded UPDATE —
 * {@code quantity_sold + quantity_reserved + q <= quantity_total} — so two
 * buyers racing for the last ticket cannot both succeed regardless of
 * isolation level; the table CHECK is the backstop, never the mechanism.
 */
@Service
public class TicketReservationService {

    private static final String HOLD = "UPDATE event_ticket_types SET"
            + " quantity_reserved=quantity_reserved+?, updated_at=now()"
            + " WHERE id=? AND is_active AND quantity_sold+quantity_reserved+?<=quantity_total";
    private static final String INSERT = "INSERT INTO ticket_reservations(ticket_type_id,"
            + "buyer_user_id,quantity,expires_at) VALUES(?,?,?,now()+(?*interval '1 second'))"
            + " RETURNING id";
    private static final String LIVE_ORDER = "SELECT count(*) FROM ticket_orders WHERE"
            + " reservation_id=? AND status IN ('RESERVED','PAYMENT_PENDING')";

    private final JdbcTemplate jdbc;
    private final TicketingAccess access;
    private final EventService events;
    private final TicketOrderStore store;
    private final TicketingProperties properties;

    public TicketReservationService(JdbcTemplate jdbc, TicketingAccess access, EventService events,
            TicketOrderStore store, TicketingProperties properties) {
        this.jdbc = jdbc;
        this.access = access;
        this.events = events;
        this.store = store;
        this.properties = properties;
    }

    public record ReservationView(UUID id, UUID eventId, UUID ticketTypeId, int quantity,
            String status, Instant expiresAt) {
    }

    @Transactional
    public ReservationView reserve(UUID buyer, UUID eventId, UUID ticketTypeId, int quantity) {
        events.requireViewer(buyer, eventId);
        TicketedEvent e = access.requireEvent(eventId);
        requireOnSale(e);
        var type = jdbc.query("SELECT is_active,max_per_order,sales_start_at,sales_end_at"
                + " FROM event_ticket_types WHERE id=? AND event_id=?", rs -> rs.next()
                ? new Object[]{rs.getBoolean(1), rs.getInt(2), rs.getTimestamp(3).toInstant(),
                    rs.getTimestamp(4).toInstant()} : null, ticketTypeId, eventId);
        if (type == null || !(Boolean) type[0]) {
            throw notFound("TICKET_TYPE_NOT_FOUND");
        }
        if (quantity < 1) {
            throw bad("TICKET_QUANTITY_INVALID");
        }
        if (quantity > (Integer) type[1]) {
            throw bad("MAX_PER_ORDER_EXCEEDED");
        }
        Instant now = Instant.now();
        if (now.isBefore((Instant) type[2]) || !now.isBefore((Instant) type[3])) {
            throw conflict("TICKET_SALES_CLOSED");
        }
        // One live hold per buyer per type: replace an earlier hold that is
        // not already in checkout (its inventory comes back first).
        List<UUID> previous = jdbc.queryForList("SELECT r.id FROM ticket_reservations r"
                + " WHERE r.ticket_type_id=? AND r.buyer_user_id=? AND r.status='ACTIVE'"
                + " AND NOT EXISTS (SELECT 1 FROM ticket_orders o WHERE o.reservation_id=r.id"
                + " AND o.status IN ('RESERVED','PAYMENT_PENDING'))", UUID.class, ticketTypeId, buyer);
        previous.forEach(store::releaseReservation);
        if (jdbc.update(HOLD, quantity, ticketTypeId, quantity) == 0) {
            throw conflict("TICKETS_SOLD_OUT");
        }
        UUID id = jdbc.queryForObject(INSERT, UUID.class, ticketTypeId, buyer, quantity,
                properties.reservationTtl().toSeconds());
        ReservationRow r = store.reservation(id);
        return new ReservationView(r.id(), eventId, r.ticketTypeId(), r.quantity(), r.status(),
                r.expiresAt());
    }

    /** Buyer gives a hold back early. A hold already in checkout is released by cancelling the order. */
    @Transactional
    public void release(UUID buyer, UUID reservationId) {
        ReservationRow r = store.lockReservation(reservationId);
        if (r == null || !r.buyerUserId().equals(buyer)) {
            throw notFound("RESERVATION_NOT_FOUND");
        }
        Integer live = jdbc.queryForObject(LIVE_ORDER, Integer.class, reservationId);
        if (live != null && live > 0) {
            throw conflict("RESERVATION_IN_CHECKOUT");
        }
        store.releaseReservation(reservationId);
    }

    static void requireOnSale(TicketedEvent e) {
        if (!e.ticketed() || e.currencyCode() == null) {
            throw conflict("EVENT_NOT_TICKETED");
        }
        if (!"PUBLISHED".equals(e.status())) {
            throw conflict("EVENT_NOT_PUBLISHED");
        }
        if (e.cancelled()) {
            throw conflict("EVENT_CANCELLED");
        }
    }
}
