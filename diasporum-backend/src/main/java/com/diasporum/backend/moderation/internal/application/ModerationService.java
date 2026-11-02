package com.diasporum.backend.moderation.internal.application;

import com.diasporum.backend.moderation.ModerationApi;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Shared, target-agnostic report workflow over {@code reports}. */
@Service
public class ModerationService implements ModerationApi {

    private static final Set<String> REASONS = Set.of("SPAM", "SCAM",
            "HARASSMENT", "HATE", "SEXUAL_MISCONDUCT", "MISINFORMATION",
            "IMPERSONATION", "PRIVACY", "OTHER");

    private final JdbcTemplate jdbc;

    public ModerationService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    @Transactional
    public UUID report(UUID reporterUserId, String targetType, UUID targetId,
            UUID countryId, UUID communityId, String reason, String details) {
        if (reason == null || !REASONS.contains(reason)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "INVALID_REPORT_REASON");
        }
        if (details != null && details.length() > 4000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "REPORT_DETAILS_TOO_LONG");
        }
        Integer open = jdbc.queryForObject("SELECT count(*) FROM reports"
                        + " WHERE reporter_id=? AND target_type=?::report_target_type"
                        + " AND target_id=? AND status='OPEN'", Integer.class,
                reporterUserId, targetType, targetId);
        if (open != null && open > 0) {
            throw duplicate();
        }
        UUID id = UUID.randomUUID();
        try {
            jdbc.update("INSERT INTO reports(id,reporter_id,country_id,community_id,"
                            + "target_type,target_id,reason,details)"
                            + " VALUES(?,?,?,?,?::report_target_type,?,?,?)", id,
                    reporterUserId, countryId, communityId, targetType, targetId,
                    reason, details);
        } catch (DuplicateKeyException e) {
            throw duplicate();
        }
        return id;
    }

    private static ResponseStatusException duplicate() {
        return new ResponseStatusException(HttpStatus.CONFLICT, "REPORT_DUPLICATE");
    }
}
