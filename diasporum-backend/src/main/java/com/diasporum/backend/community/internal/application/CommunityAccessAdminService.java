package com.diasporum.backend.community.internal.application;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Audited platform-admin configuration over the existing scoped feature flags. */
@Service
public class CommunityAccessAdminService {

    private final JdbcTemplate jdbc;
    private final CommunityAccessPolicyService accessPolicy;

    public CommunityAccessAdminService(JdbcTemplate jdbc,
            CommunityAccessPolicyService accessPolicy) {
        this.jdbc = jdbc;
        this.accessPolicy = accessPolicy;
    }

    public record ModuleFlagView(String moduleKey, String flagKey, UUID countryId,
            UUID communityId, boolean enabled, Instant updatedAt) {
    }

    public void requireGlobalAdmin(UUID actor) {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM global_user_roles"
                + " WHERE user_id=? AND role_key='PLATFORM_ADMIN'"
                + " AND scope_type='GLOBAL' AND revoked_at IS NULL",
                Integer.class, actor);
        if (count == null || count == 0) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "PLATFORM_ADMIN_REQUIRED");
        }
    }

    public List<ModuleFlagView> flags(UUID actor, UUID countryId, UUID communityId) {
        requireGlobalAdmin(actor);
        validateScope(countryId, communityId);
        return jdbc.query("SELECT flag_key,country_id,community_id,is_enabled,updated_at "
                        + "FROM feature_flags WHERE flag_key LIKE 'COMMUNITY_MODULE_%' "
                        + "AND country_id IS NOT DISTINCT FROM ? "
                        + "AND community_id IS NOT DISTINCT FROM ? ORDER BY flag_key",
                (rs, i) -> new ModuleFlagView(rs.getString("flag_key")
                                .substring("COMMUNITY_MODULE_".length()),
                        rs.getString("flag_key"), rs.getObject("country_id", UUID.class),
                        rs.getObject("community_id", UUID.class), rs.getBoolean("is_enabled"),
                        rs.getTimestamp("updated_at").toInstant()), countryId, communityId);
    }

    @Transactional
    public ModuleFlagView setModule(UUID actor, String moduleKey, boolean enabled,
            UUID countryId, UUID communityId) {
        requireGlobalAdmin(actor);
        validateScope(countryId, communityId);
        String module = moduleKey == null ? "" : moduleKey.trim().toUpperCase();
        if (!accessPolicy.moduleKeys().contains(module)) {
            throw bad("UNKNOWN_COMMUNITY_MODULE");
        }
        String flagKey = CommunityAccessPolicyService.moduleFlagKey(module);
        int updated = jdbc.update("UPDATE feature_flags SET is_enabled=?,updated_by=?,"
                + "updated_at=now() WHERE flag_key=? AND country_id IS NOT DISTINCT FROM ? "
                + "AND community_id IS NOT DISTINCT FROM ?",
                enabled, actor, flagKey, countryId, communityId);
        if (updated == 0) {
            jdbc.update("INSERT INTO feature_flags(flag_key,country_id,community_id,"
                    + "is_enabled,updated_by) VALUES(?,?,?,?,?)",
                    flagKey, countryId, communityId, enabled, actor);
        }
        audit(actor, "COMMUNITY_MODULE_FLAG_UPDATED", communityId == null ? countryId : communityId,
                flagKey, enabled);
        return flags(actor, countryId, communityId).stream()
                .filter(v -> v.moduleKey().equals(module)).findFirst().orElseThrow();
    }

    @Transactional
    public void setCommunityActive(UUID actor, UUID communityId, boolean active) {
        requireGlobalAdmin(actor);
        int updated = jdbc.update("UPDATE communities SET is_active=?,updated_at=now() WHERE id=?",
                active, communityId);
        if (updated == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "COMMUNITY_NOT_FOUND");
        }
        audit(actor, active ? "COMMUNITY_ACTIVATED" : "COMMUNITY_DEACTIVATED",
                communityId, active ? "ACTIVE" : "INACTIVE", active);
    }

    private void validateScope(UUID countryId, UUID communityId) {
        if (countryId != null && communityId != null) {
            throw bad("INVALID_CONFIGURATION_SCOPE");
        }
        if (countryId != null && !exists("countries", countryId)) {
            throw bad("COUNTRY_NOT_FOUND");
        }
        if (communityId != null && !exists("communities", communityId)) {
            throw bad("COMMUNITY_NOT_FOUND");
        }
    }

    private boolean exists(String table, UUID id) {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM " + table + " WHERE id=?",
                Integer.class, id);
        return count != null && count > 0;
    }

    private void audit(UUID actor, String action, UUID targetId, String key, boolean enabled) {
        jdbc.update("INSERT INTO audit_logs(actor_user_id,actor_type,action_key,target_type,"
                + "target_id,metadata) VALUES(?,'USER',?,'COMMUNITY_ACCESS',?,"
                + "jsonb_build_object('key',?,'enabled',?))",
                actor, action, targetId, key, enabled);
    }

    private static ResponseStatusException bad(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason);
    }
}
