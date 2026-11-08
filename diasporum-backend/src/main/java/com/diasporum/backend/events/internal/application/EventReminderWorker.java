package com.diasporum.backend.events.internal.application;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Sends a one-shot reminder to GOING/INTERESTED participants ahead of each
 * published event's start. Idempotent by construction: the notification
 * dedupe key embeds the event's {@code starts_at} instant, so repeat scans of
 * the same event are no-ops, a rescheduled event re-reminds at its new time,
 * and a cancelled event leaves the window before any send. Runs inside one
 * transaction so a failed scan rolls back cleanly; the reminder window is
 * configurable per deployment.
 */
@Component
public class EventReminderWorker {

    private static final int SCAN_LIMIT = 500;

    private final JdbcTemplate jdbc;
    private final EventNotifications notifications;
    private final Duration reminderWindow;

    public EventReminderWorker(JdbcTemplate jdbc, EventNotifications notifications,
            @Value("${diasporum.events.reminder-window:PT24H}")
            Duration reminderWindow) {
        this.jdbc = jdbc;
        this.notifications = notifications;
        this.reminderWindow = reminderWindow;
    }

    @Scheduled(fixedDelayString = "${diasporum.events.reminder-interval:PT5M}")
    @Transactional
    public void sendReminders() {
        Instant now = Instant.now();
        Instant horizon = now.plus(reminderWindow);
        // Upcoming published events whose start falls inside the window.
        record Due(UUID id, String title, Instant startsAt) {
        }
        List<Due> due = jdbc.query("SELECT id,title,starts_at FROM events"
                        + " WHERE status='PUBLISHED' AND cancelled_at IS NULL"
                        + " AND starts_at > ? AND starts_at <= ?"
                        + " ORDER BY starts_at LIMIT ?",
                (rs, i) -> new Due(rs.getObject("id", UUID.class),
                        rs.getString("title"),
                        rs.getTimestamp("starts_at").toInstant()),
                java.sql.Timestamp.from(now), java.sql.Timestamp.from(horizon),
                SCAN_LIMIT);
        for (Due d : due) {
            List<UUID> recipients = jdbc.queryForList("SELECT user_id"
                            + " FROM event_rsvps WHERE event_id=?"
                            + " AND status IN ('GOING','INTERESTED')",
                    UUID.class, d.id());
            for (UUID userId : recipients) {
                notifications.reminder(userId, d.id(),
                        "Reminder: " + d.title(),
                        "This event is coming up soon — check the details.",
                        d.startsAt().toEpochMilli());
            }
        }
    }
}
