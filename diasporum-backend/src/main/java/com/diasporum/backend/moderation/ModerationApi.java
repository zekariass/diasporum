package com.diasporum.backend.moderation;

import java.util.UUID;

/** Shared report intake. Callers authorize access to the target first. */
public interface ModerationApi {

    UUID report(UUID reporterUserId, String targetType, UUID targetId,
            UUID countryId, UUID communityId, String reason, String details);
}
