package com.diasporum.backend.messaging.internal.application;

import java.time.Instant;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * M4 — In-memory presence tracker. Stores the last-seen timestamp for each
 * connected user. Presence is ephemeral: it is never written to PostgreSQL.
 *
 * <p>Thread-safe via {@link ConcurrentHashMap}. On a multi-instance
 * deployment each instance tracks its own connected users; a user is
 * considered online if ANY instance has seen a recent heartbeat. The
 * scheduled expiry task runs per instance — OFFLINE events may be published
 * by any instance that detects the timeout without a race condition because
 * they are idempotent from the receiver's perspective.
 */
@Component
public class PresenceTracker {

    /** userId → last heartbeat timestamp. */
    private final ConcurrentHashMap<UUID, Instant> lastSeen = new ConcurrentHashMap<>();

    /** Record or update a heartbeat. Returns true if the user was previously
     * absent (first heartbeat or returning after expiry). */
    public boolean heartbeat(UUID userId) {
        return lastSeen.put(userId, Instant.now()) == null;
    }

    /** Remove the user from the tracker and return true if they were tracked. */
    public boolean remove(UUID userId) {
        return lastSeen.remove(userId) != null;
    }

    /** Whether the user has a recorded heartbeat (regardless of age). */
    public boolean isTracked(UUID userId) {
        return lastSeen.containsKey(userId);
    }

    /** Returns userIds whose last heartbeat is older than {@code cutoff}. */
    public Set<UUID> expiredBefore(Instant cutoff) {
        Set<UUID> expired = new HashSet<>();
        for (Map.Entry<UUID, Instant> e : lastSeen.entrySet()) {
            if (e.getValue().isBefore(cutoff)) {
                expired.add(e.getKey());
            }
        }
        return expired;
    }

    /** All currently tracked user IDs (snapshot). */
    public Set<UUID> trackedUserIds() {
        return Set.copyOf(lastSeen.keySet());
    }
}
