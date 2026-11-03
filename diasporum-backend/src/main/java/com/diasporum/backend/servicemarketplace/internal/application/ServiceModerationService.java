package com.diasporum.backend.servicemarketplace.internal.application;

import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.badRequest;
import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.forbidden;
import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.notFound;

import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Cursor;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Page;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Report;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceCursor;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceEngagementRepository;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Scoped moderator queue and audited Service Marketplace actions. */
@Service
public class ServiceModerationService {
    private static final Set<String> ACTIONS = Set.of("WARN", "HIDE", "REMOVE",
            "RESTORE", "SUSPEND_PROVIDER", "DISMISS_REPORT");

    private final ServiceEngagementRepository repository;
    private final JdbcTemplate jdbc;

    public ServiceModerationService(ServiceEngagementRepository repository, JdbcTemplate jdbc) {
        this.repository = repository;
        this.jdbc = jdbc;
    }

    public Page<Report> reports(UUID actorUserId, String status, String targetType,
            UUID countryId, String encodedCursor, Integer size) {
        requireModerator(actorUserId, countryId);
        if (status != null && !Set.of("OPEN", "ACTIONED", "DISMISSED").contains(status)) {
            throw badRequest("INVALID_REPORT_STATUS");
        }
        if (targetType != null && !Set.of("SERVICE_REQUEST", "SERVICE_PROVIDER", "SERVICE_REVIEW").contains(targetType)) {
            throw badRequest("INVALID_REPORT_TARGET");
        }
        int limit = ServiceCursor.pageSize(size);
        String fingerprint = ServiceCursor.fingerprint("moderation:" + status + ":" + targetType + ":" + countryId);
        Cursor cursor = ServiceCursor.decode(encodedCursor, "NEWEST", fingerprint);
        List<Report> rows = repository.reports(status, targetType, countryId, cursor, limit);
        String next = null;
        if (rows.size() > limit) {
            Report last = rows.get(limit - 1);
            next = ServiceCursor.encode(new Cursor("NEWEST", fingerprint,
                    last.createdAt().toString(), null, last.id()));
        }
        return new Page<>(rows.stream().limit(limit).toList(), next);
    }

    public Report report(UUID actorUserId, UUID reportId) {
        Report report = repository.findReport(reportId).orElseThrow(() -> notFound("REPORT_NOT_FOUND"));
        requireModerator(actorUserId, reportCountry(report));
        return report;
    }

    @Transactional
    public Report moderate(UUID actorUserId, String targetType, UUID targetId,
            String action, String reason, UUID reportId) {
        if (targetType == null || targetId == null || !ACTIONS.contains(action)
                || !Set.of("SERVICE_REQUEST", "SERVICE_PROVIDER", "SERVICE_REVIEW").contains(targetType)) {
            throw badRequest("INVALID_MODERATION_ACTION");
        }
        Report report = reportId == null ? null : repository.findReport(reportId)
                .orElseThrow(() -> notFound("REPORT_NOT_FOUND"));
        UUID countryId = report == null ? targetCountry(targetType, targetId) : reportCountry(report);
        requireModerator(actorUserId, countryId);
        if ("DISMISS_REPORT".equals(action) && report == null) {
            throw badRequest("REPORT_REQUIRED");
        }
        repository.moderationAction(UUID.randomUUID(), actorUserId, targetType, targetId, action, reason);
        if (!"DISMISS_REPORT".equals(action)) {
            repository.moderateTarget(targetType, targetId, action);
        }
        if (report != null) {
            repository.resolveReport(report.id(), "DISMISS_REPORT".equals(action) ? "DISMISSED" : "ACTIONED",
                    actorUserId, reason);
            return repository.findReport(report.id()).orElseThrow();
        }
        return null;
    }

    private UUID targetCountry(String targetType, UUID targetId) {
        if ("SERVICE_PROVIDER".equals(targetType)) {
            return null;
        }
        String sql = "SERVICE_REQUEST".equals(targetType)
                ? "SELECT country_id FROM service_requests WHERE id=?"
                : "SELECT sr.country_id FROM service_reviews r JOIN service_requests sr "
                        + "ON sr.id=r.service_request_id WHERE r.id=?";
        return jdbc.query(sql, rs -> rs.next() ? rs.getObject(1, UUID.class) : null, targetId);
    }

    private UUID reportCountry(Report report) {
        return targetCountry(report.targetType(), report.targetId());
    }

    private void requireModerator(UUID actorUserId, UUID countryId) {
        Boolean global = jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM global_user_roles WHERE user_id=? "
                + "AND role_key IN('PLATFORM_ADMIN','PLATFORM_MODERATOR') AND scope_type='GLOBAL' "
                + "AND revoked_at IS NULL)", Boolean.class, actorUserId);
        if (Boolean.TRUE.equals(global)) {
            return;
        }
        if (countryId != null) {
            Boolean scoped = jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM global_user_roles "
                    + "WHERE user_id=? AND country_id=? AND scope_type='COUNTRY' "
                    + "AND role_key IN('PLATFORM_ADMIN','PLATFORM_MODERATOR') AND revoked_at IS NULL)",
                    Boolean.class, actorUserId, countryId);
            if (Boolean.TRUE.equals(scoped)) {
                return;
            }
        }
        throw forbidden("MODERATOR_REQUIRED");
    }
}
