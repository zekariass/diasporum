package com.diasporum.backend.messaging.internal.application;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Messaging policy limits (v10.12 M2 abuse protection). All values are
 * configurable under {@code diasporum.messaging.*} with env-var overrides in
 * application.yaml; the compact constructor pins the documented defaults so an
 * unset property can never silently disable enforcement.
 *
 * <p>Quotas are keyed on the acting user id ({@code created_by}/
 * {@code sender_id}), so switching devices, sessions or acting through a
 * Business Account cannot bypass them — business sends are still recorded
 * under the member's user id.
 */
@ConfigurationProperties(prefix = "diasporum.messaging")
public record MessagingProperties(
        /** Max new conversations per acting user per rolling hour. 0/disabled
         * values fall back to the default. */
        int createPerHour,
        /** Max new conversations per acting user per rolling 24 h — the daily
         * new-conversation quota. */
        int createPerDay,
        /** Max messages per acting user per rolling minute, across all
         * conversations. */
        int sendPerMinute,
        /** Max outstanding outbound REQUESTED message requests per acting
         * user — caps request spam regardless of recipient. */
        int maxPendingRequests,
        /** Minimum delay before a declined GENERAL request may be re-issued
         * for the same conversation pair. Set very high to make decline
         * effectively permanent; {@code PT0S} disables the cooldown. */
        Duration declineCooldown,
        /** When true, a contextual recipient's personal {@code dm_permission}
         * must also allow the conversation. Default false: v10.12 treats
         * published-resource owners as contactable — {@code dm_permission}
         * governs GENERAL conversations only (blocks/mutes always apply). */
        boolean contextRespectsDmPermission) {

    public MessagingProperties {
        if (createPerHour <= 0) {
            createPerHour = 30;
        }
        if (createPerDay <= 0) {
            createPerDay = 100;
        }
        if (sendPerMinute <= 0) {
            sendPerMinute = 60;
        }
        if (maxPendingRequests <= 0) {
            maxPendingRequests = 25;
        }
        if (declineCooldown == null) {
            declineCooldown = Duration.ofDays(30);
        }
    }
}
