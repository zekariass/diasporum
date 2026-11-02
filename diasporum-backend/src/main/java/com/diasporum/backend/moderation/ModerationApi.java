package com.diasporum.backend.moderation;

import java.util.UUID;

/**
 * Shared report intake. Callers authorize access to the target first.
 * Duplicate active reports map to HTTP 409.
 */
public interface ModerationApi {

    UUID report(UUID reporterUserId, String targetType, UUID targetId,
            UUID countryId, UUID communityId, String reason, String details);

    /**
     * Create one OPEN report from a validated command; duplicate active
     * reports map to HTTP 409.
     */
    UUID createReport(CreateReportCommand command);

    record CreateReportCommand(UUID reporterId, UUID countryId, UUID communityId,
            String targetType, UUID targetId, String reason, String details) {
    }
}
