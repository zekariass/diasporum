package com.diasporum.backend.businessaccounts.internal.application;

import com.diasporum.backend.businessaccounts.internal.application.BusinessAccountAuthorization.Capabilities;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Account-scoped listings overview: every content row the workspace owns,
 * grouped by listing module with totals and the most recent items. Read-only;
 * each listing module remains the owner of its lifecycle operations.
 */
@Service
public class BusinessListingService {

    private static final int SECTION_ITEMS = 10;

    private final JdbcTemplate jdbc;
    private final Membership membership;

    public BusinessListingService(JdbcTemplate jdbc, Membership membership) {
        this.jdbc = jdbc;
        this.membership = membership;
    }

    @Transactional(readOnly = true)
    public BusinessListingsView listings(UUID actor, UUID accountId) {
        membership.requireCapability(actor, accountId, Capabilities::manageListings);
        return new BusinessListingsView(
                section("SELECT id,name AS title,status::text AS status,created_at"
                        + " FROM business_listings WHERE business_account_id=?"
                        + " AND deleted_at IS NULL", accountId),
                section("SELECT id,title,status::text AS status,created_at"
                        + " FROM events WHERE business_account_id=?", accountId),
                section("SELECT id,title,status::text AS status,created_at"
                        + " FROM job_listings WHERE business_account_id=?", accountId),
                section("SELECT id,title,status,created_at"
                        + " FROM property_listings WHERE business_account_id=?"
                        + " AND status<>'REMOVED'", accountId),
                section("SELECT id,title,status,created_at"
                        + " FROM vehicle_listings WHERE business_account_id=?"
                        + " AND status<>'REMOVED'", accountId),
                section("SELECT id,display_name AS title,status,created_at"
                        + " FROM service_providers WHERE business_account_id=?",
                        accountId));
    }

    private Section section(String baseSql, UUID accountId) {
        List<ListingItem> items = jdbc.query(
                baseSql + " ORDER BY created_at DESC,id LIMIT " + SECTION_ITEMS,
                (rs, i) -> new ListingItem(rs.getObject("id", UUID.class),
                        rs.getString("title"), rs.getString("status"),
                        rs.getTimestamp("created_at").toInstant()),
                accountId);
        String countSql = "SELECT count(*) FROM (" + baseSql + ") s";
        long total = jdbc.queryForObject(countSql, Long.class, accountId);
        return new Section(total, items);
    }

    /**
     * Workspace dashboard metrics for a reporting window (days). View and enquiry
     * counts are window-bound; active listings and upcoming events reflect the
     * current state regardless of the window.
     */
    @Transactional(readOnly = true)
    public BusinessOverviewView overview(UUID actor, UUID accountId, int days) {
        membership.requireCapability(actor, accountId, Capabilities::manageListings);
        int period = days <= 0 ? 30 : Math.min(days, 365);
        Long views = jdbc.queryForObject("SELECT count(*) FROM user_content_views v"
                + " WHERE v.last_viewed_at>=now()-make_interval(days => ?)"
                + " AND ((v.content_type='PROPERTY' AND EXISTS(SELECT 1"
                + " FROM property_listings p WHERE p.id=v.content_id"
                + " AND p.business_account_id=?))"
                + " OR (v.content_type='VEHICLE' AND EXISTS(SELECT 1"
                + " FROM vehicle_listings x WHERE x.id=v.content_id"
                + " AND x.business_account_id=?)))",
                Long.class, period, accountId, accountId);
        Long enquiries = jdbc.queryForObject("SELECT count(*) FROM direct_conversations dc"
                + " WHERE dc.created_at>=now()-make_interval(days => ?)"
                + " AND (dc.participant_a_business_account_id=?"
                + " OR dc.participant_b_business_account_id=?)",
                Long.class, period, accountId, accountId);
        Long active = jdbc.queryForObject("SELECT"
                + " (SELECT count(*) FROM property_listings WHERE business_account_id=?"
                + " AND status='PUBLISHED' AND (expires_at IS NULL OR expires_at>now()))"
                + " +(SELECT count(*) FROM vehicle_listings WHERE business_account_id=?"
                + " AND status='PUBLISHED' AND (expires_at IS NULL OR expires_at>now()))",
                Long.class, accountId, accountId);
        Long upcoming = jdbc.queryForObject("SELECT count(*) FROM events"
                + " WHERE business_account_id=? AND status='PUBLISHED' AND starts_at>now()",
                Long.class, accountId);
        return new BusinessOverviewView(period, nn(views), nn(enquiries), nn(active),
                nn(upcoming));
    }

    private static long nn(Long value) {
        return value == null ? 0 : value;
    }

    public record BusinessOverviewView(int periodDays, long listingViews,
            long enquiries, long activeListings, long upcomingEvents) {
    }

    public record BusinessListingsView(Section profiles, Section events,
            Section jobs, Section properties, Section vehicles,
            Section providers) {
    }

    public record Section(long total, List<ListingItem> items) {
    }

    public record ListingItem(UUID id, String title, String status,
            Instant createdAt) {
    }
}
