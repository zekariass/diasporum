package com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Shared moderation tables used by the v2 Spare Bag gate: {@code moderation_queue}
 * (V31; no Java owner exists, so the module records its own submissions),
 * {@code moderation_actions}, {@code audit_logs} and the {@code global_user_roles}
 * checks copied from the shop/ticketing precedents.
 */
@Repository
public class SpareBagModerationRepository {

    private static final String OPEN = "('PENDING','ASSIGNED','IN_REVIEW','ESCALATED')";
    private static final String ENQUEUE = "INSERT INTO moderation_queue(content_type,"
            + "content_id,submitted_by,queue_status) SELECT ?,?,'SYSTEM','PENDING' "
            + "WHERE NOT EXISTS(SELECT 1 FROM moderation_queue WHERE content_type=? "
            + "AND content_id=? AND queue_status IN " + OPEN + ")";
    private static final String RESOLVE = "UPDATE moderation_queue SET queue_status='RESOLVED',"
            + "decision=?,decision_reason=?,decided_by_user_id=?,decided_at=now(),"
            + "updated_at=now() WHERE content_type=? AND content_id=? "
            + "AND queue_status IN " + OPEN;
    private static final String AUTO_RESOLVE_STALE = "UPDATE moderation_queue q "
            + "SET queue_status='AUTO_RESOLVED',updated_at=now() "
            + "WHERE q.queue_status IN " + OPEN + " AND ("
            + "(q.content_type='SPARE_BAG_SENDER_REQUEST' AND NOT EXISTS(SELECT 1 FROM "
            + "spare_bag_sender_requests r WHERE r.id=q.content_id "
            + "AND r.status='PENDING_REVIEW' AND r.deleted_at IS NULL)) OR "
            + "(q.content_type='SPARE_BAG_TRAVELLER_JOURNEY' AND NOT EXISTS(SELECT 1 FROM "
            + "spare_bag_traveller_journeys j WHERE j.id=q.content_id "
            + "AND j.status='PENDING_REVIEW' AND j.deleted_at IS NULL)))";
    private static final String ACTION = "INSERT INTO moderation_actions(moderator_id,"
            + "target_user_id,country_id,target_type,target_id,action_type,reason,metadata) "
            + "VALUES(?,?,?,?::report_target_type,?,?::moderation_action_type,?,"
            + "jsonb_build_object('module','SPARE_BAG','decision',?::text))";
    private static final String AUDIT = "INSERT INTO audit_logs(actor_user_id,actor_type,"
            + "action_key,target_type,target_id) VALUES(?,'ADMIN',?,?,?)";
    private static final String IS_PLATFORM_ADMIN = "SELECT count(*) FROM global_user_roles "
            + "WHERE user_id=? AND role_key='PLATFORM_ADMIN' AND scope_type='GLOBAL' "
            + "AND revoked_at IS NULL";
    private static final String IS_GLOBAL_MODERATOR = "SELECT count(*) FROM global_user_roles "
            + "WHERE user_id=? AND role_key IN ('PLATFORM_ADMIN','PLATFORM_MODERATOR') "
            + "AND scope_type='GLOBAL' AND revoked_at IS NULL";
    private static final String MODERATOR_COUNTRIES = "SELECT country_id FROM global_user_roles "
            + "WHERE user_id=? AND role_key IN ('PLATFORM_ADMIN','PLATFORM_MODERATOR') "
            + "AND scope_type='COUNTRY' AND country_id IS NOT NULL AND revoked_at IS NULL";

    private final JdbcTemplate jdbc;

    public SpareBagModerationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Adds a PENDING queue row unless one is already open for this content. */
    public void enqueue(String contentType, UUID contentId) {
        jdbc.update(ENQUEUE, contentType, contentId, contentType, contentId);
    }

    public int resolve(String contentType, UUID contentId, String decision, String reason,
            UUID moderator) {
        return jdbc.update(RESOLVE, decision, reason, moderator, contentType, contentId);
    }

    public int autoResolveStale() {
        return jdbc.update(AUTO_RESOLVE_STALE);
    }

    public void action(UUID moderator, UUID targetUser, UUID countryId, String targetType,
            UUID targetId, String actionType, String reason, String decision) {
        jdbc.update(ACTION, moderator, targetUser, countryId, targetType, targetId,
                actionType, reason, decision);
    }

    public void audit(UUID actor, String actionKey, String targetType, UUID targetId) {
        jdbc.update(AUDIT, actor, actionKey, targetType, targetId);
    }

    public boolean isPlatformAdmin(UUID userId) {
        Integer n = jdbc.queryForObject(IS_PLATFORM_ADMIN, Integer.class, userId);
        return n != null && n > 0;
    }

    public boolean isGlobalModerator(UUID userId) {
        Integer n = jdbc.queryForObject(IS_GLOBAL_MODERATOR, Integer.class, userId);
        return n != null && n > 0;
    }

    public Set<UUID> moderatorCountries(UUID userId) {
        List<UUID> ids = jdbc.query(MODERATOR_COUNTRIES,
                (rs, i) -> rs.getObject(1, UUID.class), userId);
        return new HashSet<>(ids);
    }
}
