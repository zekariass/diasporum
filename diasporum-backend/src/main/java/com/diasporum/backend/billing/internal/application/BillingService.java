package com.diasporum.backend.billing.internal.application;

import com.diasporum.backend.billing.BillingApi;
import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Provider-neutral entitlement and durable usage accounting. */
@Service
public class BillingService implements BillingApi {

    private final JdbcTemplate jdbc;

    public BillingService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    @Transactional
    public EntitlementDecision consumePersonalQuota(UUID userId,
            String featureKey, String targetType, UUID targetId,
            String idempotencyKey) {
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",
                Object.class, userId + ":" + featureKey);
        UUID previousTarget = jdbc.query("SELECT target_id FROM billing_usage_records"
                        + " WHERE user_id=? AND idempotency_key=?",
                rs -> rs.next() ? rs.getObject(1, UUID.class) : null,
                userId, idempotencyKey);
        if (previousTarget != null) {
            return new EntitlementDecision(previousTarget.equals(targetId),
                    previousTarget.equals(targetId) ? "OK" : "IDEMPOTENCY_CONFLICT", 0);
        }

        var rows = jdbc.query("SELECT f.id AS feature_id,bpe.quantity_limit,"
                + "bpe.reset_period,s.current_period_start "
                + "FROM billing_subscriptions s "
                + "JOIN billing_plans p ON p.id=s.plan_id AND p.is_active=true "
                + "JOIN billing_plan_entitlements bpe ON bpe.plan_id=p.id "
                + "JOIN billing_features f ON f.id=bpe.feature_id AND f.is_active=true "
                + "WHERE s.user_id=? AND s.status IN ('TRIALING','ACTIVE') "
                + "AND p.account_type='PERSONAL' AND f.feature_key=? "
                + "AND bpe.enabled=true", (rs, i) -> new Config(
                        rs.getObject("feature_id", UUID.class),
                        rs.getObject("quantity_limit", Long.class),
                        rs.getString("reset_period"),
                        rs.getTimestamp("current_period_start").toInstant()),
                userId, featureKey);
        if (rows.size() != 1) {
            return new EntitlementDecision(false, "ENTITLEMENT_NOT_CONFIGURED", 0);
        }
        Config config = rows.getFirst();
        if (config.limit() == null || config.resetPeriod() == null) {
            return new EntitlementDecision(false, "ENTITLEMENT_NOT_CONFIGURED", 0);
        }
        Instant from = periodStart(config.resetPeriod(), config.subscriptionStart());
        if (from == null) {
            return new EntitlementDecision(false, "ENTITLEMENT_NOT_CONFIGURED", 0);
        }
        long used = jdbc.queryForObject("SELECT COALESCE(SUM(quantity),0) "
                + "FROM billing_usage_records WHERE user_id=? AND feature_id=? "
                + "AND occurred_at>=?", Long.class, userId, config.featureId(), Timestamp.from(from));
        if (used >= config.limit()) {
            return new EntitlementDecision(false, "QUOTA_EXCEEDED", 0);
        }
        jdbc.update("INSERT INTO billing_usage_records(feature_id,user_id,quantity,"
                + "target_type,target_id,idempotency_key) VALUES(?,?,1,?,?,?)",
                config.featureId(), userId, targetType, targetId, idempotencyKey);
        return new EntitlementDecision(true, "OK", config.limit() - used - 1);
    }

    private Instant periodStart(String resetPeriod, Instant subscriptionStart) {
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        return switch (resetPeriod) {
            case "DAY" -> today.atStartOfDay().toInstant(ZoneOffset.UTC);
            case "WEEK" -> today.with(DayOfWeek.MONDAY).atStartOfDay()
                    .toInstant(ZoneOffset.UTC);
            case "MONTH" -> today.withDayOfMonth(1).atStartOfDay()
                    .toInstant(ZoneOffset.UTC);
            case "YEAR" -> today.withDayOfYear(1).atStartOfDay()
                    .toInstant(ZoneOffset.UTC);
            case "NEVER" -> Instant.EPOCH;
            case "SUBSCRIPTION_PERIOD" -> subscriptionStart;
            default -> null;
        };
    }

    private record Config(UUID featureId, Long limit, String resetPeriod,
            Instant subscriptionStart) {
    }
}
