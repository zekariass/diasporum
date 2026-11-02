package com.diasporum.backend.social;

import java.util.List;
import java.util.UUID;

/**
 * Public API of the social module: follow/friendship/block/mute relationships
 * and interaction policy queries. Other modules consume this interface only —
 * never {@code social.internal.*}. All IDs are internal Diasporum profile UUIDs.
 */
public interface SocialApi {

    /** Whether {@code viewer} may interact with {@code target} — fails if a
     * block exists in EITHER direction. Use for DM/feed/visibility checks. */
    boolean canInteract(UUID viewer, UUID target);

    boolean isFollowing(UUID follower, UUID followed);

    boolean isFriend(UUID userA, UUID userB);

    /** True only if {@code viewer} has blocked {@code target}. The reverse
     * direction is deliberately not queryable, so a blocker is never revealed
     * to the blocked user; use {@link #canInteract} for enforcement. */
    boolean isBlockedByMe(UUID viewer, UUID target);

    /**
     * From {@code candidates}, returns the subset blocked in EITHER direction
     * with {@code viewer}. Use to hide those users from lists the viewer sees
     * without exposing who blocked whom — the caller only receives ids.
     */
    java.util.Set<UUID> blockedWith(UUID viewer, java.util.Collection<UUID> candidates);

    /** Ids of users {@code viewer} follows — for following-scoped content. */
    java.util.List<UUID> followingIds(UUID viewer);

    /** Relationship flags between the viewer and another user. Blocked-BY
     * direction is deliberately not exposed to the viewer. */
    RelationshipView relationship(UUID viewer, UUID target);

    List<UUID> friendIds(UUID userId);

    int followerCount(UUID userId);

    int followingCount(UUID userId);

    int friendCount(UUID userId);

    List<UUID> followerIds(UUID userId, int limit);

    List<UUID> followingIds(UUID userId, int limit);

    List<UUID> blockedIds(UUID userId);

    /**
     * Establish the durable friendship for a matchmaking match. This is
     * idempotent, race-safe and independent of directional follow edges.
     * Unmatching deliberately has no friendship-dissolution operation.
     */
    void establishMatchmakingFriendship(UUID userA, UUID userB);

    record RelationshipView(boolean following, boolean followedBy,
            boolean mutual, boolean friends, boolean blockedByMe) {
    }
}
