package com.diasporum.backend.notifications;

import java.util.UUID;

/** Public durable in-app notification boundary for consumer modules. */
public interface NotificationsApi {

    /** Creates a deduplicated notification and its existing outbox work atomically. */
    void notify(UUID recipientUserId, String type, String title, String body,
            String targetType, UUID targetId, String dedupeKey);
}
