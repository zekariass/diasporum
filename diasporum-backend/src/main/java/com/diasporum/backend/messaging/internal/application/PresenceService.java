package com.diasporum.backend.messaging.internal.application;

import com.diasporum.backend.messaging.internal.realtime.AblyGateway;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * M4 — Online/offline presence. Clients send periodic POST heartbeats;
 * the backend tracks last-seen timestamps in memory and publishes
 * PRESENCE_ONLINE/PRESENCE_OFFLINE to conversation partners' personal
 * user channels. Presence is ephemeral — no PostgreSQL writes.
 *
 * <p>The scheduled expiry task runs every 30 s and evicts users whose
 * last heartbeat is older than {@code presenceTimeoutSeconds} (default 60 s).
 * PRESENCE_OFFLINE is published to all their accepted conversation partners
 * when they are evicted.
 */
@Service
public class PresenceService {

    private static final Logger log = LoggerFactory.getLogger(PresenceService.class);

    private final PresenceTracker tracker;
    private final AblyGateway ably;
    private final MessagingService messaging;
    private final MessagingProperties props;

    public PresenceService(PresenceTracker tracker, AblyGateway ably,
            MessagingService messaging, MessagingProperties props) {
        this.tracker = tracker;
        this.ably = ably;
        this.messaging = messaging;
        this.props = props;
    }

    /**
     * Records a heartbeat for the authenticated user. If the user was
     * previously absent (first heartbeat or returning after timeout), publishes
     * PRESENCE_ONLINE to all their accepted conversation partners.
     */
    public void heartbeat(UUID userId) {
        boolean wasAbsent = tracker.heartbeat(userId);
        if (wasAbsent && ably.isUsable()) {
            publishPresence(userId, true);
        }
    }

    /**
     * Explicit offline notification — called on sign-out or app background.
     * Removes the user from the tracker and publishes PRESENCE_OFFLINE.
     */
    public void goOffline(UUID userId) {
        boolean wasTracked = tracker.remove(userId);
        if (wasTracked && ably.isUsable()) {
            publishPresence(userId, false);
        }
    }

    /**
     * Returns whether the given user is currently tracked as online.
     * Used by the presence REST endpoint so mobile can query initial state.
     */
    public boolean isOnline(UUID userId) {
        return tracker.isTracked(userId);
    }

    /** Scheduled expiry: evict stale users and publish PRESENCE_OFFLINE. */
    @Scheduled(fixedDelayString = "${diasporum.messaging.presence-check-interval:PT30S}")
    public void expireStalePresence() {
        Instant cutoff = Instant.now().minusSeconds(props.presenceTimeoutSeconds());
        Set<UUID> expired = tracker.expiredBefore(cutoff);
        for (UUID userId : expired) {
            tracker.remove(userId);
            if (ably.isUsable()) {
                publishPresence(userId, false);
            }
        }
    }

    private void publishPresence(UUID userId, boolean online) {
        String eventName = online ? "PRESENCE_ONLINE" : "PRESENCE_OFFLINE";
        Map<String, Object> payload = Map.of(
                "type", eventName,
                "userId", userId.toString(),
                "online", online);
        Set<UUID> partners;
        try {
            partners = messaging.acceptedConversationPartnerIds(userId);
        } catch (Exception e) {
            log.warn("presence partner lookup failed for {}: {}", userId, e.getMessage());
            return;
        }
        for (UUID partnerId : partners) {
            try {
                ably.publish("user:" + partnerId, eventName, payload);
            } catch (AblyGateway.AblyPublishException e) {
                log.warn("presence publish to user:{} failed: {}", partnerId, e.getMessage());
            }
        }
    }
}
