package com.diasporum.backend.events.internal.application.ticketing;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi;
import com.diasporum.backend.businessaccounts.BusinessAccountsApi.AccountMembershipView;
import com.diasporum.backend.events.internal.application.EventAuthorization;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Ticketing view of an event plus the authorization rules for ticketing
 * actions. Managers (ticket types, promo codes, check-in, refund approval) are
 * the same people who manage the event; finance (payout accounts, payout
 * requests) is narrower: the owning user, or a business OWNER/ADMINISTRATOR.
 * Platform admins are {@code global_user_roles} PLATFORM_ADMIN at GLOBAL scope.
 */
@Component
public class TicketingAccess {

    private static final String EVENT_SQL = "SELECT id,country_id,event_category_id,organizer_id,"
            + "owner_user_id,business_account_id,title,status::text AS status,starts_at,ends_at,"
            + "cancelled_at,is_ticketed,ticket_currency_code,ticket_fee_model,refund_policy,"
            + "refund_cutoff_hours FROM events WHERE id=?";
    private static final String ADMIN_SQL = "SELECT count(*) FROM global_user_roles"
            + " WHERE user_id=? AND role_key='PLATFORM_ADMIN' AND scope_type='GLOBAL'"
            + " AND revoked_at IS NULL";

    private final JdbcTemplate jdbc;
    private final BusinessAccountsApi businessAccounts;

    public TicketingAccess(JdbcTemplate jdbc, BusinessAccountsApi businessAccounts) {
        this.jdbc = jdbc;
        this.businessAccounts = businessAccounts;
    }

    /** Ticketing-relevant columns of {@code events}. */
    public record TicketedEvent(UUID id, UUID countryId, UUID categoryId, UUID organizerId,
            UUID ownerUserId, UUID businessAccountId, String title, String status,
            Instant startsAt, Instant endsAt, Instant cancelledAt, boolean ticketed,
            String currencyCode, String feeModel, String refundPolicy, Integer refundCutoffHours) {

        public boolean cancelled() {
            return cancelledAt != null;
        }

        /** End of the event for settlement purposes (ends_at, else starts_at). */
        public Instant settlementAnchor() {
            return endsAt != null ? endsAt : startsAt;
        }
    }

    public TicketedEvent requireEvent(UUID eventId) {
        TicketedEvent e = jdbc.query(EVENT_SQL, rs -> rs.next() ? map(rs) : null, eventId);
        return e != null ? e : throwNotFound();
    }

    public TicketedEvent lockEvent(UUID eventId) {
        TicketedEvent e = jdbc.query(EVENT_SQL + " FOR UPDATE", rs -> rs.next() ? map(rs) : null,
                eventId);
        return e != null ? e : throwNotFound();
    }

    private static TicketedEvent throwNotFound() {
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "EVENT_NOT_FOUND");
    }

    public boolean canManage(UUID actor, TicketedEvent e) {
        if (actor == null) {
            return false;
        }
        if (actor.equals(e.ownerUserId()) || actor.equals(e.organizerId())
                && e.ownerUserId() == null && e.businessAccountId() == null) {
            return true;
        }
        if (e.businessAccountId() != null) {
            return EventAuthorization.canManageEvents(role(actor, e.businessAccountId()));
        }
        return false;
    }

    public boolean canManageFinances(UUID actor, TicketedEvent e) {
        if (actor == null) {
            return false;
        }
        if (e.businessAccountId() != null) {
            return EventAuthorization.canManageFinances(role(actor, e.businessAccountId()));
        }
        return actor.equals(e.ownerUserId());
    }

    /** True when the actor may act on payout accounts owned by the business account. */
    public boolean canManageBusinessFinances(UUID actor, UUID businessAccountId) {
        return EventAuthorization.canManageFinances(role(actor, businessAccountId));
    }

    public TicketedEvent requireManager(UUID actor, UUID eventId) {
        TicketedEvent e = requireEvent(eventId);
        if (!canManage(actor, e) && !isPlatformAdmin(actor)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "NOT_EVENT_ORGANIZER");
        }
        return e;
    }

    public TicketedEvent requireFinance(UUID actor, UUID eventId) {
        TicketedEvent e = requireEvent(eventId);
        if (!canManageFinances(actor, e)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "NOT_EVENT_FINANCE_MANAGER");
        }
        return e;
    }

    public boolean isPlatformAdmin(UUID actor) {
        Integer count = jdbc.queryForObject(ADMIN_SQL, Integer.class, actor);
        return count != null && count > 0;
    }

    public void requirePlatformAdmin(UUID actor) {
        if (!isPlatformAdmin(actor)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "PLATFORM_ADMIN_REQUIRED");
        }
    }

    private String role(UUID actor, UUID businessAccountId) {
        return businessAccounts.membership(actor, businessAccountId)
                .map(AccountMembershipView::role).orElse(null);
    }

    private static TicketedEvent map(ResultSet rs) throws SQLException {
        int cutoff = rs.getInt("refund_cutoff_hours");
        Integer cutoffHours = rs.wasNull() ? null : cutoff;
        return new TicketedEvent(rs.getObject("id", UUID.class),
                rs.getObject("country_id", UUID.class),
                rs.getObject("event_category_id", UUID.class),
                rs.getObject("organizer_id", UUID.class),
                rs.getObject("owner_user_id", UUID.class),
                rs.getObject("business_account_id", UUID.class),
                rs.getString("title"), rs.getString("status"),
                instant(rs.getTimestamp("starts_at")), instant(rs.getTimestamp("ends_at")),
                instant(rs.getTimestamp("cancelled_at")), rs.getBoolean("is_ticketed"),
                trim(rs.getString("ticket_currency_code")), rs.getString("ticket_fee_model"),
                rs.getString("refund_policy"), cutoffHours);
    }

    static Instant instant(Timestamp ts) {
        return ts == null ? null : ts.toInstant();
    }

    static String trim(String s) {
        return s == null ? null : s.trim();
    }
}
