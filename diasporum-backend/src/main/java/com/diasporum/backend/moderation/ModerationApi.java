package com.diasporum.backend.moderation;

import java.util.UUID;

/** Public report-creation boundary owned by the Moderation module. */
public interface ModerationApi {

    /** Create one OPEN report; duplicate active reports map to HTTP 409. */
    UUID createReport(CreateReportCommand command);

    record CreateReportCommand(UUID reporterId, UUID countryId, UUID communityId,
            String targetType, UUID targetId, String reason, String details) {
    }
}
