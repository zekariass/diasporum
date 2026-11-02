package com.diasporum.backend.notifications;

import java.util.UUID;

/** Public durable-notification entry point; delivery remains existing outbox work. */
public interface NotificationsApi {

    void create(NotificationCommand command);

    record NotificationCommand(UUID recipientUserId, String type, String title,
            String body, String targetType, UUID targetId, String dedupeKey) {
    }
}
