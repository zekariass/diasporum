package com.diasporum.backend.billing.internal.application;

import com.diasporum.backend.billing.BillingApi;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** JDBC entitlement resolver over the existing billing schema. */
@Service
public class BillingService implements BillingApi {

    private final JdbcTemplate jdbc;

    public BillingService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    @Transactional
    public void consumePersonalFeature(UUID userId, String featureKey, String idempotencyKey) {
        if (userId == null || featureKey == null || idempotencyKey == null) {
            throw badRequest();
        }
        if (exists("SELECT 1 FROM billing_usage_records WHERE user_id=?"
                + " AND idempotency_key=?", userId, idempotencyKey)) {
            return;
        }
        Feature feature = jdbc.query("SELECT id FROM billing_features"
                        + " WHERE feature_key=? AND is_active=true",
                (rs, i) -> new Feature(rs.getObject("id", UUID.class)), featureKey)
                .stream().findFirst().orElseThrow(() -> denied("FEATURE_NOT_ENTITLED"));
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", rs -> null,
                userId + ":" + featureKey);

        Subscription subscription = jdbc.query("SELECT plan_id,current_period_start"
                        + " FROM billing_subscriptions WHERE user_id=?"
                        + " AND status IN ('TRIALING','ACTIVE','PAST_DUE','PAUSED')"
                        + " ORDER BY created_at DESC LIMIT 1",
                (rs, i) -> new Subscription(rs.getObject("plan_id", UUID.class),
                        rs.getTimestamp("current_period_start") == null ? null
                                : rs.getTimestamp("current_period_start").toInstant()), userId)
                .stream().findFirst().orElse(null);
        UUID planId = subscription == null ? freePlanId() : subscription.planId();
        Entitlement entitlement = jdbc.query("SELECT enabled,quantity_limit,reset_period"
                        + " FROM billing_plan_entitlements WHERE plan_id=? AND feature_id=?",
                (rs, i) -> new Entitlement(rs.getBoolean("enabled"),
                        rs.getObject("quantity_limit", Long.class),
                        rs.getString("reset_period")), planId, feature.id())
                .stream().findFirst().orElse(null);

        if (entitlement != null && entitlement.enabled()) {
            if (entitlement.quantityLimit() == null
                    || used(entitlement, subscription, userId, feature.id())
                    < entitlement.quantityLimit()) {
                insertUsage(userId, feature.id(), idempotencyKey);
                return;
            }
        }
        if (consumeGrant(userId, feature.id(), idempotencyKey)) {
            return;
        }
        if (entitlement != null && entitlement.enabled()
                && entitlement.quantityLimit() != null) {
            throw denied("FEATURE_QUOTA_EXCEEDED");
        }
        throw denied("FEATURE_NOT_ENTITLED");
    }

    private UUID freePlanId() {
        return jdbc.query("SELECT id FROM billing_plans"
                        + " WHERE plan_key='FREE' AND account_type='PERSONAL'",
                (rs, i) -> rs.getObject("id", UUID.class)).stream().findFirst()
                .orElseThrow(() -> denied("FEATURE_NOT_ENTITLED"));
    }

    private long used(Entitlement entitlement, Subscription subscription,
            UUID userId, UUID featureId) {
        Instant start = periodStart(entitlement.resetPeriod(), subscription);
        if (start == null) {
            Long count = jdbc.queryForObject("SELECT count(*) FROM billing_usage_records"
                    + " WHERE user_id=? AND feature_id=?", Long.class, userId, featureId);
            return count == null ? 0 : count;
        }
        Long count = jdbc.queryForObject("SELECT count(*) FROM billing_usage_records"
                        + " WHERE user_id=? AND feature_id=? AND occurred_at>=?",
                Long.class, userId, featureId, java.sql.Timestamp.from(start));
        return count == null ? 0 : count;
    }

    private Instant periodStart(String period, Subscription subscription) {
        if (period == null || "NEVER".equals(period)) {
            return null;
        }
        if ("SUBSCRIPTION_PERIOD".equals(period)) {
            return subscription == null ? null : subscription.currentPeriodStart();
        }
        ZonedDateTime now = Instant.now().atZone(ZoneOffset.UTC);
        return switch (period) {
            case "DAY" -> now.toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant();
            case "WEEK" -> now.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                    .toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant();
            case "MONTH" -> now.withDayOfMonth(1).toLocalDate()
                    .atStartOfDay(ZoneOffset.UTC).toInstant();
            case "YEAR" -> now.withDayOfYear(1).toLocalDate()
                    .atStartOfDay(ZoneOffset.UTC).toInstant();
            default -> throw denied("FEATURE_NOT_ENTITLED");
        };
    }

    private boolean consumeGrant(UUID userId, UUID featureId, String idempotencyKey) {
        List<UUID> grants = jdbc.query("SELECT id FROM billing_entitlement_grants"
                        + " WHERE user_id=? AND feature_id=? AND status='ACTIVE'"
                        + " AND starts_at<=now() AND (expires_at IS NULL OR expires_at>now())"
                        + " ORDER BY created_at,id FOR UPDATE",
                (rs, i) -> rs.getObject("id", UUID.class), userId, featureId);
        for (UUID grantId : grants) {
            int updated = jdbc.update("UPDATE billing_entitlement_grants SET"
                    + " quantity_used=quantity_used+1,"
                    + " status=CASE WHEN quantity_granted IS NOT NULL"
                    + " AND quantity_used+1>=quantity_granted THEN 'EXHAUSTED' ELSE status END"
                    + " WHERE id=? AND (quantity_granted IS NULL OR quantity_used<quantity_granted)",
                    grantId);
            if (updated == 1) {
                insertUsage(userId, featureId, idempotencyKey);
                return true;
            }
        }
        return false;
    }

    private void insertUsage(UUID userId, UUID featureId, String idempotencyKey) {
        jdbc.update("INSERT INTO billing_usage_records(feature_id,user_id,quantity,idempotency_key)"
                + " VALUES(?,?,1,?) ON CONFLICT(user_id,idempotency_key) DO NOTHING",
                featureId, userId, idempotencyKey);
    }

    private boolean exists(String sql, Object... args) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(" + sql + ")",
                Boolean.class, args));
    }

    private static ResponseStatusException denied(String reason) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, reason);
    }

    private static ResponseStatusException badRequest() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_BILLING_COMMAND");
    }

    private record Feature(UUID id) {
    }

    private record Subscription(UUID planId, Instant currentPeriodStart) {
    }

    private record Entitlement(boolean enabled, Long quantityLimit, String resetPeriod) {
    }
}
