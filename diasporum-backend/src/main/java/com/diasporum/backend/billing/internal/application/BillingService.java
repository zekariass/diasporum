package com.diasporum.backend.billing.internal.application;

import com.diasporum.backend.billing.BillingApi;
import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** JDBC entitlement resolver with durable grant and quota usage accounting. */
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

    private record Grant(UUID id, Long granted, long used) {
    }

    @Override
    @Transactional
    public ConsumptionResult consume(UUID userId, UUID businessAccountId,
            String featureKey, String targetType, UUID targetId,
            String idempotencyKey) {
        if ((userId == null) == (businessAccountId == null)) {
            throw new IllegalArgumentException("Exactly one billing owner is required");
        }
        String ownerColumn = userId == null ? "business_account_id" : "user_id";
        UUID ownerId = userId == null ? businessAccountId : userId;
        var featureIds = jdbc.queryForList(
                "SELECT id FROM billing_features WHERE feature_key=? AND is_active",
                UUID.class, featureKey);
        if (featureIds.isEmpty()) {
            return ConsumptionResult.NOT_CONFIGURED;
        }
        UUID featureId = featureIds.get(0);
        Integer prior = jdbc.queryForObject("SELECT count(*) FROM billing_usage_records"
                + " WHERE " + ownerColumn + "=? AND idempotency_key=?",
                Integer.class, ownerId, idempotencyKey);
        if (prior != null && prior > 0) {
            return ConsumptionResult.ALREADY_CONSUMED;
        }

        List<Grant> grants = jdbc.query("SELECT id,quantity_granted,quantity_used"
                        + " FROM billing_entitlement_grants WHERE feature_id=? AND "
                        + ownerColumn + "=? AND status='ACTIVE' AND starts_at<=now()"
                        + " AND (expires_at IS NULL OR expires_at>now())"
                        + " AND (quantity_granted IS NULL OR quantity_used<quantity_granted)"
                        + " ORDER BY expires_at NULLS LAST,created_at,id FOR UPDATE",
                (rs, i) -> new Grant(rs.getObject("id", UUID.class),
                        rs.getObject("quantity_granted", Long.class),
                        rs.getLong("quantity_used")), featureId, ownerId);
        if (grants.isEmpty()) {
            return isConfigured(featureId, ownerColumn, ownerId)
                    ? ConsumptionResult.ENTITLEMENT_REQUIRED
                    : ConsumptionResult.NOT_CONFIGURED;
        }

        Grant grant = grants.get(0);
        jdbc.update("UPDATE billing_entitlement_grants SET quantity_used=quantity_used+1,"
                + "status=CASE WHEN quantity_granted IS NOT NULL"
                + " AND quantity_used+1>=quantity_granted THEN 'EXHAUSTED'"
                + " ELSE status END WHERE id=?", grant.id());
        jdbc.update("INSERT INTO billing_usage_records(id,feature_id," + ownerColumn
                        + ",quantity,target_type,target_id,idempotency_key)"
                        + " VALUES(?,?,?,1,?,?,?)", UUID.randomUUID(), featureId,
                ownerId, targetType, targetId, idempotencyKey);
        return ConsumptionResult.CONSUMED;
    }

    private boolean isConfigured(UUID featureId, String ownerColumn, UUID ownerId) {
        Integer grants = jdbc.queryForObject("SELECT count(*)"
                + " FROM billing_entitlement_grants WHERE feature_id=? AND "
                + ownerColumn + "=? AND status IN ('ACTIVE','EXHAUSTED')",
                Integer.class, featureId, ownerId);
        if (grants != null && grants > 0) {
            return true;
        }
        Integer plans = jdbc.queryForObject("SELECT count(*)"
                + " FROM billing_plan_entitlements e"
                + " JOIN billing_subscriptions s ON s.plan_id=e.plan_id"
                + " WHERE e.feature_id=? AND e.enabled AND s." + ownerColumn
                + "=? AND s.status IN ('TRIALING','ACTIVE','PAST_DUE','PAUSED')",
                Integer.class, featureId, ownerId);
        return plans != null && plans > 0;
    }

    // ---- command-based consumption (vehicles marketplace) ----

    private record VFeature(UUID id) {
    }

    private record VUsage(UUID id, UUID featureId, long quantity, String targetType,
            UUID targetId) {
    }

    private record VGrant(UUID id, Long quantityGranted, long quantityUsed) {
        Long remaining() {
            return quantityGranted == null ? null : quantityGranted - quantityUsed;
        }
    }

    private record VEntitlement(Long quantityLimit, String resetPeriod,
            Instant subscriptionPeriodStart) {
    }

    private record VAllowance(VGrant grant, VEntitlement entitlement, Long used) {
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
    public QuotaConsumption consume(ConsumptionCommand command) {
        validateCommand(command);
        String featureKey = command.featureKey().trim().toUpperCase(Locale.ROOT);
        boolean personal = command.userId() != null;
        UUID accountId = personal ? command.userId() : command.businessAccountId();

        // This stable advisory lock serializes allowance checks and ledger writes
        // even when an account has no subscription or grant row to lock yet.
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",
                Object.class, accountId + ":" + featureKey);
        VFeature feature = jdbc.query("SELECT id FROM billing_features "
                        + "WHERE feature_key=? AND is_active FOR UPDATE",
                (rs, i) -> new VFeature(rs.getObject("id", UUID.class)), featureKey)
                .stream().findFirst().orElseThrow(BillingService::notConfigured);

        VUsage existing = findUsage(personal, accountId, command.idempotencyKey());
        VAllowance allowance = resolveAllowance(feature.id(), personal, accountId);
        if (existing != null) {
            if (!allowance.enabled()) {
                throw notConfigured();
            }
            verifyReplay(existing, feature.id(), command);
            return new QuotaConsumption(existing.id(), true);
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
        return new QuotaConsumption(usageId, false);
    }

    private VAllowance resolveAllowance(UUID featureId, boolean personal, UUID accountId) {
        String accountColumn = personal ? "user_id" : "business_account_id";
        List<VGrant> grants = jdbc.query("SELECT id,quantity_granted,quantity_used "
                        + "FROM billing_entitlement_grants WHERE feature_id=? AND "
                        + accountColumn + "=? AND status='ACTIVE' AND starts_at<=now() "
                        + "AND (expires_at IS NULL OR expires_at>now()) "
                        + "ORDER BY created_at,id FOR UPDATE",
                (rs, i) -> new VGrant(rs.getObject("id", UUID.class),
                        rs.getObject("quantity_granted", Long.class),
                        rs.getLong("quantity_used")), featureId, accountId);
        if (!grants.isEmpty()) {
            VGrant selected = grants.stream().filter(g -> g.remaining() == null
                    || g.remaining() > 0).findFirst().orElse(grants.getFirst());
            return new VAllowance(selected, null, null);
        }

        VEntitlement entitlement = jdbc.query("SELECT e.quantity_limit,e.reset_period,"
                        + "s.current_period_start FROM billing_subscriptions s "
                        + "JOIN billing_plans p ON p.id=s.plan_id AND p.is_active "
                        + "JOIN billing_plan_entitlements e ON e.plan_id=s.plan_id "
                        + "WHERE s." + accountColumn + "=? AND s.status IN ('ACTIVE','TRIALING') "
                        + "AND e.feature_id=? AND e.enabled FOR UPDATE",
                (rs, i) -> new VEntitlement(rs.getObject("quantity_limit", Long.class),
                        rs.getString("reset_period"),
                        rs.getTimestamp("current_period_start") == null ? null
                                : rs.getTimestamp("current_period_start").toInstant()),
                accountId, featureId).stream().findFirst().orElse(null);
        if (entitlement == null) {
            return new VAllowance(null, null, null);
        }
        if (entitlement.quantityLimit() == null) {
            return new VAllowance(null, entitlement, 0L);
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
                        : new Object[]{featureId, accountId, Timestamp.from(windowStart)});
        return new VAllowance(null, entitlement, used == null ? 0 : used);
    }

    private static Instant windowStart(VEntitlement entitlement) {
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

    private VUsage findUsage(boolean personal, UUID accountId, String idempotencyKey) {
        String accountColumn = personal ? "user_id" : "business_account_id";
        return jdbc.query("SELECT id,feature_id,quantity,target_type,target_id "
                        + "FROM billing_usage_records WHERE " + accountColumn
                        + "=? AND idempotency_key=?",
                (rs, i) -> new VUsage(rs.getObject("id", UUID.class),
                        rs.getObject("feature_id", UUID.class), rs.getLong("quantity"),
                        rs.getString("target_type"), rs.getObject("target_id", UUID.class)),
                accountId, idempotencyKey).stream().findFirst().orElse(null);
    }

    private static void verifyReplay(VUsage existing, UUID featureId,
            ConsumptionCommand command) {
        if (!existing.featureId().equals(featureId) || existing.quantity() != command.quantity()
                || !java.util.Objects.equals(existing.targetType(), command.targetType())
                || !java.util.Objects.equals(existing.targetId(), command.targetId())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "IDEMPOTENCY_KEY_REUSED");
        }
    }

    private static void validateCommand(ConsumptionCommand command) {
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
