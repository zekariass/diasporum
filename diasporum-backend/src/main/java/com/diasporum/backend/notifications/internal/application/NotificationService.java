package com.diasporum.backend.notifications.internal.application;

import com.diasporum.backend.notifications.NotificationsApi;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Minimal durable notification writer; delivery remains existing outbox work. */
@Service
public class NotificationService implements NotificationsApi {

    private final JdbcTemplate jdbc;

    public NotificationService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRED)
    public void notify(UUID recipientUserId, String type, String title,
            String body, String targetType, UUID targetId, String dedupeKey) {
        jdbc.update("INSERT INTO notifications(recipient_user_id,type,title,body,"
                + "target_type,target_id,dedupe_key) VALUES(?,?::notification_type,"
                + "?,?,?,?,?) ON CONFLICT(recipient_user_id,dedupe_key) "
                + "WHERE dedupe_key IS NOT NULL DO NOTHING", recipientUserId, type,
                title, body, targetType, targetId, dedupeKey);
    }
}
