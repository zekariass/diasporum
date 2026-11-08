package com.diasporum.backend.community.internal.application;

import com.diasporum.backend.billing.BillingApi;
import com.diasporum.backend.billing.BillingApi.ActionEligibility;
import com.diasporum.backend.billing.BillingApi.ConsumptionCommand;
import com.diasporum.backend.community.CommunityApi.CommunityContext;
import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.taxonomy.TaxonomyApi;
import com.diasporum.backend.taxonomy.TaxonomyApi.CommunityView;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Single source of truth for Default/Extended modules and Extended action billing. */
@Service
public class CommunityAccessPolicyService {

    public static final String FEED = "FEED";
    public static final String REELS = "REELS";
    public static final String MATCHMAKING = "MATCHMAKING";
    public static final String COMMUNITY_HELP = "COMMUNITY_HELP";

    private static final List<String> MODULES = List.of(
            FEED, REELS, MATCHMAKING, COMMUNITY_HELP, "BUSINESS_DIRECTORY",
            "EVENTS", "JOBS", "SERVICE_MARKETPLACE", "SPARE_BAG", "PROPERTY",
            "VEHICLE", "SHOP_MARKETPLACE", "GENERAL_CHAT", "VOICE_ROOMS", "PEOPLE");
    private static final Set<String> EXTENDED_MODULES = Set.of(
            FEED, REELS, MATCHMAKING, COMMUNITY_HELP);
    private static final Map<String, String> ACTION_MODULES = Map.of(
            "EXTENDED_FEED_POST_PUBLISH", FEED,
            "EXTENDED_REEL_PUBLISH", REELS,
            "EXTENDED_MATCHMAKING_LIKE", MATCHMAKING,
            "EXTENDED_COMMUNITY_HELP_REQUEST_PUBLISH", COMMUNITY_HELP);

    private final JdbcTemplate jdbc;
    private final IdentityApi identity;
    private final TaxonomyApi taxonomy;
    private final CommunityService communities;
    private final BillingApi billing;

    public CommunityAccessPolicyService(JdbcTemplate jdbc, IdentityApi identity,
            TaxonomyApi taxonomy, CommunityService communities, BillingApi billing) {
        this.jdbc = jdbc;
        this.identity = identity;
        this.taxonomy = taxonomy;
        this.communities = communities;
        this.billing = billing;
    }

    public record MyAccessView(UUID defaultCommunityId, UUID activeCommunityId,
            List<CommunityContext> communities) {
    }

    public List<String> moduleKeys() {
        return MODULES;
    }

    static String moduleFlagKey(String module) {
        return "COMMUNITY_MODULE_" + module;
    }

    public CommunityContext context(UUID userId, UUID communityId) {
        var profile = identity.profileSummary(userId).orElseThrow(
                () -> failure(HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));
        if (!"ACTIVE".equals(profile.accountStatus())) {
            throw failure(HttpStatus.FORBIDDEN, "ACCOUNT_NOT_ACTIVE");
        }
        var community = taxonomy.findCommunityById(communityId).orElseThrow(
                () -> failure(HttpStatus.NOT_FOUND, "COMMUNITY_NOT_FOUND"));
        if (!community.active()) {
            throw failure(HttpStatus.FORBIDDEN, "COMMUNITY_INACTIVE");
        }
        if (!communities.isActiveMember(userId, communityId)) {
            throw failure(HttpStatus.FORBIDDEN, "NOT_A_MEMBER");
        }
        if (profile.originCountryId() == null
                || !profile.originCountryId().equals(community.originCountryId())) {
            throw failure(HttpStatus.FORBIDDEN, "COMMUNITY_ORIGIN_MISMATCH");
        }
        String accessType = community.destinationCountryId().equals(profile.currentCountryId())
                ? "DEFAULT" : "ORIGIN_EXTENDED";
        return new CommunityContext(community.id(), community.name(), accessType,
                community.originCountryId(), community.destinationCountryId(),
                modulesFor(community, accessType));
    }

    public CommunityContext activeContext(UUID userId) {
        UUID communityId = identity.activeCommunityId(userId).orElseThrow(
                () -> failure(HttpStatus.UNPROCESSABLE_ENTITY, "ACTIVE_COMMUNITY_REQUIRED"));
        return context(userId, communityId);
    }

    public CommunityContext requireModule(UUID userId, UUID communityId, String moduleKey) {
        String module = normalizeModule(moduleKey);
        var context = context(userId, communityId);
        if (!context.moduleEnabled(module)) {
            throw failure(HttpStatus.FORBIDDEN, "COMMUNITY_MODULE_NOT_AVAILABLE");
        }
        return context;
    }

    public CommunityContext requireActiveModule(UUID userId, String moduleKey) {
        var context = activeContext(userId);
        if (!context.moduleEnabled(normalizeModule(moduleKey))) {
            throw failure(HttpStatus.FORBIDDEN, "COMMUNITY_MODULE_NOT_AVAILABLE");
        }
        return context;
    }

    public MyAccessView myAccess(UUID userId) {
        UUID defaultId = defaultCommunityId(userId).orElse(null);
        var contexts = communities.membershipsOf(userId).stream().map(m -> {
            try {
                return context(userId, m.communityId());
            } catch (ResponseStatusException e) {
                return null;
            }
        }).filter(java.util.Objects::nonNull).toList();
        UUID activeId = identity.activeCommunityId(userId)
                .filter(id -> contexts.stream().anyMatch(c -> c.communityId().equals(id)))
                .orElse(null);
        return new MyAccessView(defaultId, activeId, contexts);
    }

    public Optional<UUID> defaultCommunityId(UUID userId) {
        return jdbc.query("SELECT c.id FROM communities c "
                        + "JOIN profiles p ON p.origin_country_id=c.origin_country_id "
                        + "AND p.current_country_id=c.destination_country_id "
                        + "JOIN community_memberships m ON m.community_id=c.id "
                        + "AND m.user_id=p.id AND m.status='ACTIVE' "
                        + "WHERE p.id=? AND c.is_active=true",
                (rs, i) -> rs.getObject("id", UUID.class), userId)
                .stream().findFirst();
    }

    public ActionEligibility actionEligibility(UUID userId, String actionKey) {
        String featureKey = normalizeAction(actionKey);
        var context = requireActiveModule(userId, ACTION_MODULES.get(featureKey));
        if (context.isDefault()) {
            return new ActionEligibility(true, false, false, 1,
                    null, null, "DEFAULT_COMMUNITY", "OK");
        }
        var decision = billing.previewPersonalFeature(userId, featureKey,
                "COMMUNITY", context.communityId());
        if (!decision.allowed() && "ENTITLEMENT_NOT_CONFIGURED".equals(decision.reason())
                && unconfiguredFree(featureKey, context)) {
            return new ActionEligibility(true, false, false, 1,
                    null, null, "UNCONFIGURED_FREE", "OK");
        }
        return decision;
    }

    @Transactional
    public void consumeExtendedAction(UUID userId, UUID communityId, String actionKey,
            String idempotencyKey) {
        String featureKey = normalizeAction(actionKey);
        var context = requireModule(userId, communityId, ACTION_MODULES.get(featureKey));
        if (context.isDefault()) {
            return;
        }
        try {
            billing.consume(new ConsumptionCommand(userId, null, featureKey, 1,
                    "COMMUNITY", communityId, idempotencyKey));
        } catch (ResponseStatusException e) {
            if (e.getStatusCode() == HttpStatus.FORBIDDEN
                    && "ENTITLEMENT_NOT_CONFIGURED".equals(e.getReason())
                    && unconfiguredFree(featureKey, context)) {
                return;
            }
            throw e;
        }
    }

    private Map<String, Boolean> modulesFor(CommunityView community, String accessType) {
        var result = new LinkedHashMap<String, Boolean>();
        for (String module : MODULES) {
            boolean base = "DEFAULT".equals(accessType) || EXTENDED_MODULES.contains(module);
            result.put(module, base && rolloutEnabled(community, module));
        }
        return Map.copyOf(result);
    }

    private boolean rolloutEnabled(CommunityView community, String module) {
        Boolean enabled = jdbc.query("SELECT is_enabled FROM feature_flags "
                        + "WHERE flag_key=? AND (community_id=? OR (community_id IS NULL "
                        + "AND (country_id=? OR country_id IS NULL))) "
                        + "ORDER BY CASE WHEN community_id IS NOT NULL THEN 0 "
                        + "WHEN country_id IS NOT NULL THEN 1 ELSE 2 END LIMIT 1",
                rs -> rs.next() ? rs.getBoolean(1) : null,
                moduleFlagKey(module), community.id(),
                community.destinationCountryId());
        return enabled == null || enabled;
    }

    private boolean unconfiguredFree(String featureKey, CommunityContext context) {
        Boolean free = jdbc.query("SELECT is_enabled AND access_type='FREE' "
                        + "AND COALESCE((config->>'unconfiguredFree')::boolean,false) "
                        + "FROM feature_access_rules WHERE feature_key=? "
                        + "AND (community_id=? OR (community_id IS NULL "
                        + "AND (country_id=? OR country_id IS NULL))) "
                        + "ORDER BY CASE WHEN community_id IS NOT NULL THEN 0 "
                        + "WHEN country_id IS NOT NULL THEN 1 ELSE 2 END LIMIT 1",
                rs -> rs.next() ? rs.getBoolean(1) : null, featureKey,
                context.communityId(), context.destinationCountryId());
        return Boolean.TRUE.equals(free);
    }

    private static String normalizeAction(String actionKey) {
        String key = actionKey == null ? "" : actionKey.trim().toUpperCase();
        if (!ACTION_MODULES.containsKey(key)) {
            throw failure(HttpStatus.BAD_REQUEST, "UNKNOWN_COMMUNITY_ACTION");
        }
        return key;
    }

    private static String normalizeModule(String moduleKey) {
        String key = moduleKey == null ? "" : moduleKey.trim().toUpperCase();
        if (!MODULES.contains(key)) {
            throw failure(HttpStatus.BAD_REQUEST, "UNKNOWN_COMMUNITY_MODULE");
        }
        return key;
    }

    private static ResponseStatusException failure(HttpStatus status, String reason) {
        return new ResponseStatusException(status, reason);
    }
}
