package com.diasporum.backend.notifications.internal.application;

import com.diasporum.backend.notifications.NotificationsApi;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Durable notification writer; existing triggers enqueue delivery work. */
@Service
public class NotificationService implements NotificationsApi {

    private final JdbcTemplate jdbc;

    public NotificationService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    @Transactional
    public void create(NotificationCommand command) {
        jdbc.update("INSERT INTO notifications(recipient_user_id,type,title,body,"
                + "target_type,target_id,dedupe_key) VALUES(?,?::notification_type,?,?,?,?,?)"
                + " ON CONFLICT(recipient_user_id,dedupe_key) WHERE dedupe_key IS NOT NULL"
                + " DO NOTHING", command.recipientUserId(), command.type(), command.title(),
                command.body(), command.targetType(), command.targetId(), command.dedupeKey());
    }
}
