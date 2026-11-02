package com.diasporum.backend.billing.internal.application;

import com.diasporum.backend.billing.BillingApi;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Minimal shared entitlement engine. ACTIVE grants take precedence over a
 * subscription for the same account/feature, avoiding ambiguous double
 * counting between direct grants and plan allowances.
 */
@Service
public class BillingService implements BillingApi {

    private final JdbcTemplate jdbc;

    public BillingService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private record Feature(UUID id) {
    }

    private record Usage(UUID id, UUID featureId, long quantity, String targetType,
            UUID targetId) {
    }

    private record Grant(UUID id, Long quantityGranted, long quantityUsed) {
        Long remaining() {
            return quantityGranted == null ? null : quantityGranted - quantityUsed;
        }
    }

    private record Entitlement(Long quantityLimit, String resetPeriod,
            Instant subscriptionPeriodStart) {
    }

    private record Allowance(Grant grant, Entitlement entitlement, Long used) {
        boolean enabled() {
            return grant != null || entitlement != null;
        }

        boolean canConsume(long quantity) {
            if (grant != null) {
                return grant.remaining() == null || grant.remaining() >= quantity;
            }
            return entitlement != null && (entitlement.quantityLimit() == null
                    || used + quantity <= entitlement.quantityLimit());
        }
    }

    @Override
    @Transactional
    public ConsumptionResult consume(ConsumptionCommand command) {
        validate(command);
        String featureKey = command.featureKey().trim().toUpperCase(Locale.ROOT);
        boolean personal = command.userId() != null;
        UUID accountId = personal ? command.userId() : command.businessAccountId();

        // This stable advisory lock serializes allowance checks and ledger writes
        // even when an account has no subscription or grant row to lock yet.
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",
                Object.class, accountId + ":" + featureKey);
        Feature feature = jdbc.query("SELECT id FROM billing_features "
                        + "WHERE feature_key=? AND is_active FOR UPDATE",
                (rs, i) -> new Feature(rs.getObject("id", UUID.class)), featureKey)
                .stream().findFirst().orElseThrow(BillingService::notConfigured);

        Usage existing = findUsage(personal, accountId, command.idempotencyKey());
        Allowance allowance = resolveAllowance(feature.id(), personal, accountId);
        if (existing != null) {
            if (!allowance.enabled()) {
                throw notConfigured();
            }
            verifyReplay(existing, feature.id(), command);
            return new ConsumptionResult(existing.id(), true);
        }
        if (!allowance.enabled()) {
            throw notConfigured();
        }
        if (!allowance.canConsume(command.quantity())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "ENTITLEMENT_QUOTA_EXCEEDED");
        }
        if (allowance.grant() != null && allowance.grant().quantityGranted() != null) {
            int updated = jdbc.update("UPDATE billing_entitlement_grants "
                            + "SET quantity_used=quantity_used+? WHERE id=? "
                            + "AND quantity_used+?<=quantity_granted",
                    command.quantity(), allowance.grant().id(), command.quantity());
            if (updated != 1) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "ENTITLEMENT_QUOTA_EXCEEDED");
            }
        }

        UUID usageId = UUID.randomUUID();
        jdbc.update("INSERT INTO billing_usage_records(id,feature_id,user_id,"
                        + "business_account_id,quantity,target_type,target_id,idempotency_key) "
                        + "VALUES(?,?,?,?,?,?,?,?)",
                usageId, feature.id(), command.userId(), command.businessAccountId(),
                command.quantity(), command.targetType(), command.targetId(),
                command.idempotencyKey());
        return new ConsumptionResult(usageId, false);
    }

    private Allowance resolveAllowance(UUID featureId, boolean personal, UUID accountId) {
        String accountColumn = personal ? "user_id" : "business_account_id";
        List<Grant> grants = jdbc.query("SELECT id,quantity_granted,quantity_used "
                        + "FROM billing_entitlement_grants WHERE feature_id=? AND "
                        + accountColumn + "=? AND status='ACTIVE' AND starts_at<=now() "
                        + "AND (expires_at IS NULL OR expires_at>now()) "
                        + "ORDER BY created_at,id FOR UPDATE",
                (rs, i) -> new Grant(rs.getObject("id", UUID.class),
                        rs.getObject("quantity_granted", Long.class),
                        rs.getLong("quantity_used")), featureId, accountId);
        if (!grants.isEmpty()) {
            Grant selected = grants.stream().filter(g -> g.remaining() == null
                    || g.remaining() > 0).findFirst().orElse(grants.getFirst());
            return new Allowance(selected, null, null);
        }

        Entitlement entitlement = jdbc.query("SELECT e.quantity_limit,e.reset_period,"
                        + "s.current_period_start FROM billing_subscriptions s "
                        + "JOIN billing_plans p ON p.id=s.plan_id AND p.is_active "
                        + "JOIN billing_plan_entitlements e ON e.plan_id=s.plan_id "
                        + "WHERE s." + accountColumn + "=? AND s.status IN ('ACTIVE','TRIALING') "
                        + "AND e.feature_id=? AND e.enabled FOR UPDATE",
                (rs, i) -> new Entitlement(rs.getObject("quantity_limit", Long.class),
                        rs.getString("reset_period"),
                        rs.getObject("current_period_start", Instant.class)),
                accountId, featureId).stream().findFirst().orElse(null);
        if (entitlement == null) {
            return new Allowance(null, null, null);
        }
        if (entitlement.quantityLimit() == null) {
            return new Allowance(null, entitlement, 0L);
        }
        Instant windowStart = windowStart(entitlement);
        if (entitlement.resetPeriod() == null || ("SUBSCRIPTION_PERIOD".equals(
                entitlement.resetPeriod()) && windowStart == null)) {
            throw notConfigured();
        }
        Long used = jdbc.queryForObject("SELECT COALESCE(sum(quantity),0) "
                        + "FROM billing_usage_records WHERE feature_id=? AND " + accountColumn
                        + "=?" + (windowStart == null ? "" : " AND occurred_at>=?"),
                Long.class, windowStart == null
                        ? new Object[]{featureId, accountId}
                        : new Object[]{featureId, accountId, windowStart});
        return new Allowance(null, entitlement, used == null ? 0 : used);
    }

    private static Instant windowStart(Entitlement entitlement) {
        if (entitlement.resetPeriod() == null || "NEVER".equals(entitlement.resetPeriod())) {
            return null;
        }
        if ("SUBSCRIPTION_PERIOD".equals(entitlement.resetPeriod())) {
            return entitlement.subscriptionPeriodStart();
        }
        var now = Instant.now().atZone(ZoneOffset.UTC);
        return switch (entitlement.resetPeriod()) {
            case "DAY" -> now.truncatedTo(java.time.temporal.ChronoUnit.DAYS).toInstant();
            case "WEEK" -> now.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                    .truncatedTo(java.time.temporal.ChronoUnit.DAYS).toInstant();
            case "MONTH" -> now.withDayOfMonth(1)
                    .truncatedTo(java.time.temporal.ChronoUnit.DAYS).toInstant();
            case "YEAR" -> now.withDayOfYear(1)
                    .truncatedTo(java.time.temporal.ChronoUnit.DAYS).toInstant();
            default -> throw notConfigured();
        };
    }

    private Usage findUsage(boolean personal, UUID accountId, String idempotencyKey) {
        String accountColumn = personal ? "user_id" : "business_account_id";
        return jdbc.query("SELECT id,feature_id,quantity,target_type,target_id "
                        + "FROM billing_usage_records WHERE " + accountColumn
                        + "=? AND idempotency_key=?",
                (rs, i) -> new Usage(rs.getObject("id", UUID.class),
                        rs.getObject("feature_id", UUID.class), rs.getLong("quantity"),
                        rs.getString("target_type"), rs.getObject("target_id", UUID.class)),
                accountId, idempotencyKey).stream().findFirst().orElse(null);
    }

    private static void verifyReplay(Usage existing, UUID featureId,
            ConsumptionCommand command) {
        if (!existing.featureId().equals(featureId) || existing.quantity() != command.quantity()
                || !java.util.Objects.equals(existing.targetType(), command.targetType())
                || !java.util.Objects.equals(existing.targetId(), command.targetId())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "IDEMPOTENCY_KEY_REUSED");
        }
    }

    private static void validate(ConsumptionCommand command) {
        if (command == null || (command.userId() == null) == (command.businessAccountId() == null)
                || command.featureKey() == null
                || !command.featureKey().matches("[A-Za-z0-9_]+")
                || command.quantity() <= 0 || command.idempotencyKey() == null
                || command.idempotencyKey().isBlank() || command.idempotencyKey().length() > 200) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "INVALID_CONSUMPTION_REQUEST");
        }
    }

    private static ResponseStatusException notConfigured() {
        return new ResponseStatusException(HttpStatus.FORBIDDEN,
                "ENTITLEMENT_NOT_CONFIGURED");
    }
}
