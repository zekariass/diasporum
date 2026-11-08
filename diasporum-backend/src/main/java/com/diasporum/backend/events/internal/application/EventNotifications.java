package com.diasporum.backend.events.internal.application;

import com.diasporum.backend.events.internal.application.EventService.EventRow;
import com.diasporum.backend.notifications.NotificationsApi;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Event notification fan-out over the shared {@link NotificationsApi} durable
 * inbox. Every call carries a deterministic dedupe key so retries, double
 * submissions and repeated worker scans never produce duplicate inbox rows:
 * the notifications table's (recipient, dedupe_key) unique index is the
 * idempotency boundary. All notifications are created inside the caller's
 * transaction (REQUIRED propagation), so they commit or roll back with the
 * state change they describe.
 */
@Component
public class EventNotifications {

    private static final String TYPE_UPDATE = "EVENT_UPDATE";
    private static final String TARGET = "EVENT";

    private final NotificationsApi notifications;

    public EventNotifications(NotificationsApi notifications) {
        this.notifications = notifications;
    }

    /** RSVP confirmation to the participant + organizer update on a new
     * positive RSVP. NOT_GOING and removals stay silent. */
    void rsvpChanged(EventRow e, UUID userId, String previous, String assigned,
            String participantName) {
        if (!List.of("GOING", "INTERESTED", "WAITLISTED").contains(assigned)) {
            return;
        }
        String title = switch (assigned) {
            case "GOING" -> "You're going to " + e.title();
            case "INTERESTED" -> "You're interested in " + e.title();
            default -> "You're on the waitlist for " + e.title();
        };
        notifications.notify(userId, TYPE_UPDATE, title,
                rsvpBody(assigned, e), TARGET, e.id(),
                "event:" + e.id() + ":rsvp:" + userId + ":" + assigned);
        // Organizer update on a newly positive RSVP (not on status flips the
        // organizer made about their own attendance).
        boolean newlyPositive = !"GOING".equals(previous)
                && !"WAITLISTED".equals(previous)
                && List.of("GOING", "WAITLISTED").contains(assigned)
                && !userId.equals(e.organizerId());
        if (newlyPositive && e.organizerId() != null) {
            notifications.notify(e.organizerId(), TYPE_UPDATE,
                    "New attendee for " + e.title(),
                    participantName + ("GOING".equals(assigned)
                            ? " is going." : " joined the waitlist."),
                    TARGET, e.id(),
                    "event:" + e.id() + ":org-rsvp:" + userId + ":" + assigned);
        }
    }

    /** Waitlist → GOING promotion: "a spot opened up". */
    void promoted(EventRow e, Collection<UUID> userIds) {
        if (userIds == null) {
            return;
        }
        for (UUID userId : userIds) {
            notifications.notify(userId, TYPE_UPDATE,
                    "A spot opened up — you're going to " + e.title(),
                    "You were promoted from the waitlist.", TARGET, e.id(),
                    "event:" + e.id() + ":promoted:" + userId);
        }
    }

    /** Cancellation broadcast to every active participant. */
    void cancelled(EventRow e, List<UUID> participantIds, String reason) {
        String body = reason == null || reason.isBlank()
                ? "The organizer cancelled this event."
                : "The organizer cancelled this event: " + reason.trim();
        for (UUID userId : participantIds) {
            notifications.notify(userId, TYPE_UPDATE,
                    "Cancelled: " + e.title(), body, TARGET, e.id(),
                    "event:" + e.id() + ":cancelled");
        }
    }

    /** Significant schedule/venue/mode change on a published event. */
    void detailsChanged(EventRow e, List<UUID> participantIds, String changeKey) {
        for (UUID userId : participantIds) {
            notifications.notify(userId, TYPE_UPDATE,
                    "Updated: " + e.title(),
                    "Time, location or format details changed — check the event.",
                    TARGET, e.id(), changeKey);
        }
    }

    /** Event reminder — dedupe key includes the start instant so a rescheduled
     * event legitimately re-reminds at its new time. */
    void reminder(UUID userId, UUID eventId, String title, String body,
            long startsAtMillis) {
        notifications.notify(userId, "EVENT_REMINDER", title, body, TARGET,
                eventId, "event:" + eventId + ":remind:" + userId + ":"
                        + startsAtMillis);
    }

    private static String rsvpBody(String assigned, EventRow e) {
        return switch (assigned) {
            case "GOING" -> "See you there — add it to your calendar.";
            case "INTERESTED" -> "You can switch to Going anytime before it starts.";
            default -> e.capacity() != null
                    ? "This event is full — you'll be promoted if a spot opens."
                    : "You'll be promoted if a spot opens.";
        };
    }
}
