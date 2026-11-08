package com.diasporum.backend.billing.internal.application;

import com.diasporum.backend.billing.BillingApi;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Platform-admin catalogue, plan allowance and launch-fallback configuration. */
@Service
public class BillingAdminService {

    private static final Set<String> EXTENDED_FEATURES = Set.of(
            "EXTENDED_FEED_POST_PUBLISH", "EXTENDED_REEL_PUBLISH",
            "EXTENDED_MATCHMAKING_LIKE", "EXTENDED_COMMUNITY_HELP_REQUEST_PUBLISH");
    private static final Set<String> RESET_PERIODS = Set.of(
            "DAY", "WEEK", "MONTH", "YEAR", "SUBSCRIPTION_PERIOD", "NEVER");

    private final JdbcTemplate jdbc;
    private final BillingApi billing;

    public BillingAdminService(JdbcTemplate jdbc, BillingApi billing) {
        this.jdbc = jdbc;
        this.billing = billing;
    }

    public record FeatureConfigurationView(String featureKey, String displayName,
            String quotaScope, boolean featureActive, boolean enabled,
            Long quantityLimit, String resetPeriod) {
    }

    public void requireGlobalAdmin(UUID actor) {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM global_user_roles"
                + " WHERE user_id=? AND role_key='PLATFORM_ADMIN'"
                + " AND scope_type='GLOBAL' AND revoked_at IS NULL", Integer.class, actor);
        if (count == null || count == 0) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "PLATFORM_ADMIN_REQUIRED");
        }
    }

    public List<FeatureConfigurationView> configurations(UUID actor, String planKey) {
        requireGlobalAdmin(actor);
        UUID planId = plan(planKey);
        return jdbc.query("SELECT f.feature_key,f.display_name,f.quota_scope,f.is_active,"
                        + "COALESCE(e.enabled,false),e.quantity_limit,e.reset_period "
                        + "FROM billing_features f LEFT JOIN billing_plan_entitlements e "
                        + "ON e.feature_id=f.id AND e.plan_id=? "
                        + "WHERE f.feature_key IN (?,?,?,?) ORDER BY f.feature_key",
                (rs, i) -> new FeatureConfigurationView(rs.getString("feature_key"),
                        rs.getString("display_name"), rs.getString("quota_scope"),
                        rs.getBoolean("is_active"), rs.getBoolean("enabled"),
                        rs.getObject("quantity_limit", Long.class), rs.getString("reset_period")),
                planId, "EXTENDED_FEED_POST_PUBLISH", "EXTENDED_REEL_PUBLISH",
                "EXTENDED_MATCHMAKING_LIKE", "EXTENDED_COMMUNITY_HELP_REQUEST_PUBLISH");
    }

    @Transactional
    public FeatureConfigurationView setEntitlement(UUID actor, String planKey, String featureKey,
            boolean enabled, Long quantityLimit, String resetPeriod) {
        requireGlobalAdmin(actor);
        String feature = normalizeFeature(featureKey);
        UUID planId = plan(planKey);
        String period = resetPeriod == null ? null : resetPeriod.trim().toUpperCase();
        if ((quantityLimit != null && (quantityLimit < 0 || period == null))
                || (period != null && !RESET_PERIODS.contains(period))) {
            throw bad("INVALID_ENTITLEMENT_QUOTA");
        }
        int updated = jdbc.update("UPDATE billing_plan_entitlements SET enabled=?,"
                + "quantity_limit=?,reset_period=? WHERE plan_id=? AND feature_id=("
                + "SELECT id FROM billing_features WHERE feature_key=?)",
                enabled, quantityLimit, period, planId, feature);
        if (updated == 0) {
            jdbc.update("INSERT INTO billing_plan_entitlements(plan_id,feature_id,enabled,"
                    + "quantity_limit,reset_period) SELECT ?,id,?,?,? FROM billing_features "
                    + "WHERE feature_key=?", planId, enabled, quantityLimit, period, feature);
        }
        audit(actor, "EXTENDED_BILLING_ENTITLEMENT_UPDATED", feature,
                "planKey=" + planKey + ",enabled=" + enabled);
        return configurations(actor, planKey).stream()
                .filter(v -> v.featureKey().equals(feature)).findFirst().orElseThrow();
    }

    @Transactional
    public void setUnconfiguredFree(UUID actor, String featureKey, boolean enabled,
            UUID countryId, UUID communityId) {
        requireGlobalAdmin(actor);
        String feature = normalizeFeature(featureKey);
        if (countryId != null && communityId != null) {
            throw bad("INVALID_CONFIGURATION_SCOPE");
        }
        int updated = jdbc.update("UPDATE feature_access_rules SET is_enabled=?,config=?::jsonb,"
                + "updated_by=?,updated_at=now() WHERE feature_key=? AND access_type='FREE' "
                + "AND country_id IS NOT DISTINCT FROM ? AND community_id IS NOT DISTINCT FROM ?",
                enabled, "{\"unconfiguredFree\":true}", actor, feature, countryId, communityId);
        if (updated == 0) {
            jdbc.update("INSERT INTO feature_access_rules(feature_key,access_type,country_id,"
                    + "community_id,is_enabled,config,updated_by) VALUES(?,'FREE',?,?,?,?::jsonb,?)",
                    feature, countryId, communityId, enabled, "{\"unconfiguredFree\":true}", actor);
        }
        audit(actor, "EXTENDED_BILLING_FALLBACK_UPDATED", feature, "enabled=" + enabled);
    }

    @Transactional
    public void reverse(UUID actor, UUID usageRecordId, String reason) {
        requireGlobalAdmin(actor);
        billing.reverseUsage(usageRecordId, actor, reason);
    }

    private UUID plan(String planKey) {
        String key = planKey == null ? "FREE" : planKey.trim().toUpperCase();
        return jdbc.query("SELECT id FROM billing_plans WHERE plan_key=? AND is_active=true",
                (rs, i) -> rs.getObject("id", UUID.class), key).stream().findFirst()
                .orElseThrow(() -> bad("BILLING_PLAN_NOT_FOUND"));
    }

    private static String normalizeFeature(String featureKey) {
        String key = featureKey == null ? "" : featureKey.trim().toUpperCase();
        if (!EXTENDED_FEATURES.contains(key)) {
            throw bad("UNKNOWN_EXTENDED_BILLING_FEATURE");
        }
        return key;
    }

    private void audit(UUID actor, String action, String feature, String detail) {
        jdbc.update("INSERT INTO audit_logs(actor_user_id,actor_type,action_key,target_type,"
                + "metadata) VALUES(?,'USER',?,'EXTENDED_BILLING',"
                + "jsonb_build_object('featureKey',?,'detail',?))", actor, action, feature, detail);
    }

    private static ResponseStatusException bad(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason);
    }
}
