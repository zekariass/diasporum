package com.diasporum.backend.moderation.internal.application;

import com.diasporum.backend.moderation.ModerationApi;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Generic report persistence; consuming modules authorize target visibility. */
@Service
public class ModerationService implements ModerationApi {

    private static final Set<String> REASONS = Set.of("SPAM", "SCAM", "HARASSMENT",
            "HATE", "SEXUAL_MISCONDUCT", "MISINFORMATION", "IMPERSONATION",
            "PRIVACY", "OTHER");
    private static final Set<String> TARGET_TYPES = Set.of("USER", "FEED_POST",
            "FEED_COMMENT", "CHAT_MESSAGE", "DIRECT_MESSAGE", "VOICE_ROOM",
            "VOICE_ROOM_MESSAGE", "BUSINESS", "BUSINESS_REVIEW", "EVENT", "JOB",
            "MATCHMAKING_PROFILE", "MATCHMAKING_MATCH", "SPARE_BAG_LISTING",
            "SPARE_BAG_CONTACT_REQUEST", "VEHICLE");

    private final JdbcTemplate jdbc;

    public ModerationService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    @Transactional
    public UUID createReport(CreateReportCommand command) {
        if (command == null || command.reporterId() == null || command.targetId() == null) {
            throw bad("INVALID_REPORT");
        }
        String targetType = upper(command.targetType());
        String reason = upper(command.reason());
        if (!TARGET_TYPES.contains(targetType)) {
            throw bad("INVALID_REPORT_TARGET");
        }
        if (!REASONS.contains(reason)) {
            throw bad("INVALID_REPORT_REASON");
        }
        if (command.details() != null && command.details().length() > 4000) {
            throw bad("REPORT_DETAILS_TOO_LONG");
        }
        UUID id = UUID.randomUUID();
        try {
            jdbc.update("INSERT INTO reports(id,reporter_id,country_id,community_id,"
                            + "target_type,target_id,reason,details) "
                            + "VALUES(?,?,?,?,?::report_target_type,?,?,?)",
                    id, command.reporterId(), command.countryId(), command.communityId(),
                    targetType, command.targetId(), reason, command.details());
        } catch (DuplicateKeyException e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "REPORT_DUPLICATE");
        }
        return id;
    }

    private static String upper(String value) {
        return value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
    }

    private static ResponseStatusException bad(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason);
    }
}
