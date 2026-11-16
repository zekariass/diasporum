package com.diasporum.backend.events.internal.application.ticketing;

import com.diasporum.backend.notifications.NotificationsApi;
import java.math.BigDecimal;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Ticketing notifications over {@link NotificationsApi}. Created inside the
 * caller's transaction with deterministic dedupe keys, so replays never
 * duplicate inbox rows.
 */
@Component
class TicketNotifications {

    private final NotificationsApi notifications;

    TicketNotifications(NotificationsApi notifications) {
        this.notifications = notifications;
    }

    void purchased(UUID buyer, UUID eventId, String eventTitle, UUID orderId, int quantity) {
        if (buyer == null) {
            return;
        }
        notifications.notify(buyer, "EVENT_TICKET_PURCHASED", "Your tickets for " + eventTitle,
                quantity == 1 ? "1 ticket is ready in your wallet." : quantity + " tickets are ready in your wallet.",
                "EVENT", eventId, "ticket-order:" + orderId + ":paid");
    }

    void payoutCompleted(UUID recipient, UUID eventId, String eventTitle, UUID payoutId,
            BigDecimal amount, String currency) {
        if (recipient == null) {
            return;
        }
        notifications.notify(recipient, "EVENT_PAYOUT", "Payout sent for " + eventTitle,
                amount.toPlainString() + " " + currency + " has been transferred.",
                "EVENT", eventId, "ticket-payout:" + payoutId + ":completed");
    }

    void payoutRejected(UUID recipient, UUID eventId, String eventTitle, UUID payoutId,
            String status) {
        if (recipient == null) {
            return;
        }
        notifications.notify(recipient, "EVENT_PAYOUT", "Payout " + status.toLowerCase()
                + " for " + eventTitle, "Your payout request was not completed.",
                "EVENT", eventId, "ticket-payout:" + payoutId + ":" + status);
    }
}
