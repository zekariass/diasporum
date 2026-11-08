package com.diasporum.backend.businessaccounts.internal.application;

import com.diasporum.backend.businessaccounts.internal.application.BusinessAccountAuthorization.Capabilities;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Read-only workspace billing view: the account's current subscription, its
 * plan entitlements, team-seat usage and recent orders. No payment or
 * subscription-mutation flow is fabricated — provider integration is a
 * separate milestone, so this view only reports what is actually stored.
 */
@Service
public class BusinessBillingService {

    private final JdbcTemplate jdbc;
    private final Membership membership;

    public BusinessBillingService(JdbcTemplate jdbc, Membership membership) {
        this.jdbc = jdbc;
        this.membership = membership;
    }

    @Transactional(readOnly = true)
    public BusinessBillingView billing(UUID actor, UUID accountId) {
        membership.requireCapability(actor, accountId, Capabilities::manageBilling);
        return new BusinessBillingView(subscription(accountId), seats(accountId),
                entitlements(accountId), orders(accountId));
    }

    private SubscriptionView subscription(UUID accountId) {
        return jdbc.query("SELECT p.plan_key,p.display_name,s.status,"
                        + "s.current_period_start,s.current_period_end,"
                        + "s.cancel_at_period_end"
                        + " FROM billing_subscriptions s"
                        + " JOIN billing_plans p ON p.id=s.plan_id"
                        + " WHERE s.business_account_id=?"
                        + " ORDER BY s.created_at DESC LIMIT 1",
                (rs, i) -> new SubscriptionView(rs.getString("plan_key"),
                        rs.getString("display_name"), rs.getString("status"),
                        ts(rs, "current_period_start"),
                        ts(rs, "current_period_end"),
                        rs.getBoolean("cancel_at_period_end")),
                accountId).stream().findFirst().orElse(null);
    }

    private SeatsView seats(UUID accountId) {
        long used = jdbc.queryForObject("SELECT count(*)"
                        + " FROM business_account_members"
                        + " WHERE business_account_id=? AND accepted_at IS NOT NULL"
                        + " AND revoked_at IS NULL", Long.class, accountId);
        Long limit = jdbc.query("SELECT e.quantity_limit"
                        + " FROM billing_subscriptions s"
                        + " JOIN billing_plan_entitlements e ON e.plan_id=s.plan_id"
                        + " JOIN billing_features f ON f.id=e.feature_id"
                        + " WHERE s.business_account_id=? AND e.enabled"
                        + " AND f.feature_key='BUSINESS_TEAM_SEATS'"
                        + " AND s.status IN ('TRIALING','ACTIVE','PAST_DUE','PAUSED')"
                        + " ORDER BY s.created_at DESC LIMIT 1",
                (rs, i) -> rs.getObject(1, Long.class), accountId)
                .stream().findFirst().orElse(null);
        return new SeatsView(used, limit);
    }

    private List<EntitlementView> entitlements(UUID accountId) {
        return jdbc.query("SELECT f.feature_key,f.display_name,f.feature_kind,"
                        + "e.enabled,e.quantity_limit,e.reset_period"
                        + " FROM billing_subscriptions s"
                        + " JOIN billing_plan_entitlements e ON e.plan_id=s.plan_id"
                        + " JOIN billing_features f ON f.id=e.feature_id"
                        + " WHERE s.business_account_id=?"
                        + " AND s.status IN ('TRIALING','ACTIVE','PAST_DUE','PAUSED')"
                        + " ORDER BY f.feature_key",
                (rs, i) -> new EntitlementView(rs.getString("feature_key"),
                        rs.getString("display_name"), rs.getString("feature_kind"),
                        rs.getBoolean("enabled"),
                        rs.getObject("quantity_limit", Long.class),
                        rs.getString("reset_period")),
                accountId);
    }

    private List<OrderView> orders(UUID accountId) {
        return jdbc.query("SELECT id,status,currency_code,total_amount,"
                        + "created_at,paid_at FROM billing_orders"
                        + " WHERE business_account_id=?"
                        + " ORDER BY created_at DESC,id LIMIT 20",
                (rs, i) -> new OrderView(rs.getObject("id", UUID.class),
                        rs.getString("status"), rs.getString("currency_code"),
                        rs.getBigDecimal("total_amount"),
                        ts(rs, "created_at"), ts(rs, "paid_at")),
                accountId);
    }

    private static Instant ts(java.sql.ResultSet rs, String column)
            throws java.sql.SQLException {
        var t = rs.getTimestamp(column);
        return t == null ? null : t.toInstant();
    }

    public record BusinessBillingView(SubscriptionView subscription,
            SeatsView seats, List<EntitlementView> entitlements,
            List<OrderView> orders) {
    }

    public record SubscriptionView(String planKey, String displayName,
            String status, Instant currentPeriodStart,
            Instant currentPeriodEnd, boolean cancelAtPeriodEnd) {
    }

    public record SeatsView(long used, Long limit) {
    }

    public record EntitlementView(String featureKey, String displayName,
            String featureKind, boolean enabled, Long quantityLimit,
            String resetPeriod) {
    }

    public record OrderView(UUID id, String status, String currencyCode,
            java.math.BigDecimal totalAmount, Instant createdAt,
            Instant paidAt) {
    }
}
