package com.diasporum.backend.social.internal.application;

import com.diasporum.backend.social.SocialApi;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** Delegating implementation of {@link SocialApi}. */
@Service
public class SocialApiImpl implements SocialApi {

    /** Upper bound on id lists returned to other modules in one call. */
    static final int MAX_ID_LIST = 1000;

    private final SocialService service;

    public SocialApiImpl(SocialService service) {
        this.service = service;
    }

    @Override
    public boolean canInteract(UUID viewer, UUID target) {
        return service.canInteract(viewer, target);
    }

    @Override
    public boolean isFollowing(UUID follower, UUID followed) {
        return service.isFollowing(follower, followed);
    }

    @Override
    public boolean isFriend(UUID a, UUID b) {
        return service.isFriend(a, b);
    }

    @Override
    public boolean isBlockedByMe(UUID viewer, UUID target) {
        return service.isBlockedByMe(viewer, target);
    }

    @Override
    public java.util.Set<UUID> blockedWith(UUID viewer, java.util.Collection<UUID> candidates) {
        return service.blockedWith(viewer, candidates);
    }

    @Override
    public java.util.List<UUID> followingIds(UUID viewer) {
        return service.followingIds(viewer);
    }

    @Override
    public RelationshipView relationship(UUID viewer, UUID target) {
        return service.relationship(viewer, target);
    }

    @Override
    public List<UUID> friendIds(UUID userId) {
        return service.friends(userId, 0, MAX_ID_LIST);
    }

    @Override
    public int followerCount(UUID userId) {
        return service.followerCount(userId);
    }

    @Override
    public int followingCount(UUID userId) {
        return service.followingCount(userId);
    }

    @Override
    public int friendCount(UUID userId) {
        return service.friendCount(userId);
    }

    @Override
    public List<UUID> followerIds(UUID userId, int limit) {
        return service.followers(userId, 0, clamp(limit));
    }

    @Override
    public List<UUID> followingIds(UUID userId, int limit) {
        return service.following(userId, 0, clamp(limit));
    }

    @Override
    public List<UUID> blockedIds(UUID userId) {
        return service.blocked(userId, 0, MAX_ID_LIST);
    }

    @Override
    public void establishMatchmakingFriendship(UUID a, UUID b) {
        service.establishMatchmakingFriendship(a, b);
    }

    private static int clamp(int limit) {
        return limit <= 0 ? MAX_ID_LIST : Math.min(limit, MAX_ID_LIST);
    }
}
