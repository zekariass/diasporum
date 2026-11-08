package com.diasporum.backend.notifications.internal.application;

import com.diasporum.backend.notifications.NotificationsApi;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Durable notification writer; existing outbox work handles delivery. */
@Service
public class NotificationService implements NotificationsApi {

    private final JdbcTemplate jdbc;

    public NotificationService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    @Transactional
    public void create(NotificationCommand command) {
        notify(command.recipientUserId(), command.type(), command.title(), command.body(),
                command.targetType(), command.targetId(), command.dedupeKey());
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRED)
    public void notify(UUID recipientUserId, String type, String title,
            String body, String targetType, UUID targetId, String dedupeKey) {
        if (type.startsWith("MATCHMAKING_")) {
            boolean allowed = Boolean.TRUE.equals(jdbc.queryForObject(
                    "SELECT matchmaking_account_is_adult(?) AND NOT EXISTS ("
                            + " SELECT 1 FROM notification_preferences WHERE user_id=?"
                            + " AND category_key IN ('MATCHMAKING',?) AND NOT in_app_enabled)",
                    Boolean.class, recipientUserId, recipientUserId, type));
            if (!allowed || targetId == null) return;
            if ("MATCHMAKING_MATCH".equals(type)) {
                allowed = Boolean.TRUE.equals(jdbc.queryForObject(
                        "SELECT EXISTS (SELECT 1 FROM matchmaking_matches WHERE id=?"
                                + " AND ? IN (user_a_id,user_b_id) AND status='MATCHED'"
                                + " AND matchmaking_chat_is_accessible(id))", Boolean.class,
                        targetId, recipientUserId));
            } else {
                allowed = Boolean.TRUE.equals(jdbc.queryForObject(
                        "SELECT matchmaking_users_compatible(?,?) AND NOT EXISTS ("
                                + "SELECT 1 FROM user_blocks WHERE (blocker_user_id=? AND blocked_user_id=?)"
                                + " OR (blocker_user_id=? AND blocked_user_id=?))", Boolean.class,
                        recipientUserId, targetId, recipientUserId, targetId, targetId, recipientUserId));
            }
            if (!allowed) return;
        }
        jdbc.update("INSERT INTO notifications(recipient_user_id,type,title,body,"
                + "target_type,target_id,dedupe_key) VALUES(?,?::notification_type,"
                + "?,?,?,?,?) ON CONFLICT(recipient_user_id,dedupe_key) "
                + "WHERE dedupe_key IS NOT NULL DO NOTHING", recipientUserId, type,
                title, body, targetType, targetId, dedupeKey);
    }
}
