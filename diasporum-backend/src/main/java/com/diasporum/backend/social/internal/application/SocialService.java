package com.diasporum.backend.social.internal.application;

import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.social.SocialApi.RelationshipView;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Follow, durable friendship and block logic. Mutual-follow state remains
 * independent from the canonical friendships pair. */
@Service
public class SocialService {

    private final JdbcTemplate jdbc;
    private final IdentityApi identity;

    public SocialService(JdbcTemplate jdbc, IdentityApi identity) {
        this.jdbc = jdbc;
        this.identity = identity;
    }

    private boolean exists(String sql, Object... args) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(" + sql + ")",
                Boolean.class, args));
    }

    private void requireTarget(UUID target) {
        identity.profileSummary(target).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));
    }

    private boolean blockedEither(UUID a, UUID b) {
        return exists("SELECT 1 FROM user_blocks WHERE"
                + " (blocker_user_id=? AND blocked_user_id=?)"
                + " OR (blocker_user_id=? AND blocked_user_id=?)", a, b, b, a);
    }

    private void requireNotBlocked(UUID actor, UUID target, String op) {
        if (blockedEither(actor, target)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, op + "_BLOCKED");
        }
    }

    private void requireNotSelf(UUID a, UUID b, String op) {
        if (a.equals(b)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, op + "_SELF");
        }
    }

    // Privacy row is trigger-created; a missing row falls back to the schema
    // default (allow_followers DEFAULT true) rather than making the user unfollowable.
    private void requireFollowersAllowed(UUID target) {
        List<Boolean> rows = jdbc.queryForList(
                "SELECT allow_followers FROM user_privacy_settings WHERE user_id=?",
                Boolean.class, target);
        if (!rows.isEmpty() && Boolean.FALSE.equals(rows.get(0))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FOLLOW_NOT_ALLOWED");
        }
    }

    // ---- follows ----

    @Transactional
    public void follow(UUID actor, UUID target) {
        requireNotSelf(actor, target, "FOLLOW");
        requireTarget(target);
        requireNotBlocked(actor, target, "FOLLOW");
        requireFollowersAllowed(target);
        insertFollow(actor, target);
    }

    private void insertFollow(UUID follower, UUID followed) {
        // ON CONFLICT keeps the transaction healthy — a caught duplicate-key
        // error would abort the whole PostgreSQL transaction (25P02).
        jdbc.update("INSERT INTO user_follows(follower_user_id,followed_user_id)"
                + " VALUES(?,?) ON CONFLICT DO NOTHING", follower, followed);
    }

    public void unfollow(UUID actor, UUID target) {
        jdbc.update("DELETE FROM user_follows WHERE follower_user_id=?"
                + " AND followed_user_id=?", actor, target);
    }

    public boolean isFollowing(UUID a, UUID b) {
        return exists("SELECT 1 FROM user_follows WHERE follower_user_id=?"
                + " AND followed_user_id=?", a, b);
    }

    public List<UUID> followers(UUID userId, int page, int size) {
        return jdbc.queryForList("SELECT follower_user_id FROM user_follows WHERE"
                + " followed_user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                UUID.class, userId, size, page * size);
    }

    public List<UUID> following(UUID userId, int page, int size) {
        return jdbc.queryForList("SELECT followed_user_id FROM user_follows WHERE"
                + " follower_user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                UUID.class, userId, size, page * size);
    }

    public int followerCount(UUID userId) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM user_follows WHERE"
                + " followed_user_id=?", Integer.class, userId);
        return n == null ? 0 : n;
    }

    public int followingCount(UUID userId) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM user_follows WHERE"
                + " follower_user_id=?", Integer.class, userId);
        return n == null ? 0 : n;
    }

    // ---- durable friendships and independent mutual-follow state ----

    /** Legacy friend-intent endpoint: it remains a directional follow action. */
    @Transactional
    public void addFriend(UUID actor, UUID target) {
        follow(actor, target);
    }

    /** Legacy removal endpoint: it removes only the actor's follow edge. */
    @Transactional
    public void removeFriend(UUID actor, UUID target) {
        unfollow(actor, target);
    }

    public boolean isFriend(UUID a, UUID b) {
        return exists("SELECT 1 FROM friendships WHERE user_a_id=least(?::uuid,?::uuid)"
                + " AND user_b_id=greatest(?::uuid,?::uuid)", a, b, a, b);
    }

    public List<UUID> friends(UUID userId, int page, int size) {
        return jdbc.queryForList("SELECT CASE WHEN user_a_id=? THEN user_b_id"
                + " ELSE user_a_id END FROM friendships"
                + " WHERE user_a_id=? OR user_b_id=? ORDER BY created_at DESC"
                + " LIMIT ? OFFSET ?",
                UUID.class, userId, userId, userId, size, page * size);
    }

    public int friendCount(UUID userId) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM friendships"
                + " WHERE user_a_id=? OR user_b_id=?", Integer.class, userId, userId);
        return n == null ? 0 : n;
    }

    /** Creates exactly one durable pair without creating or removing follows. */
    @Transactional
    public void establishMatchmakingFriendship(UUID a, UUID b) {
        requireNotSelf(a, b, "FRIEND");
        requireTarget(a);
        requireTarget(b);
        requireNotBlocked(a, b, "FRIEND");
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended("
                + "least(?::text,?::text)||':'||greatest(?::text,?::text),0))", rs -> null,
                a.toString(), b.toString(), a.toString(), b.toString());
        jdbc.update("INSERT INTO friendships(user_a_id,user_b_id)"
                + " VALUES(least(?::uuid,?::uuid),greatest(?::uuid,?::uuid))"
                + " ON CONFLICT(user_a_id,user_b_id) DO NOTHING", a, b, a, b);
    }

    // ---- blocks ----

    @Transactional
    public void block(UUID actor, UUID target) {
        requireNotSelf(actor, target, "BLOCK");
        requireTarget(target);
        jdbc.update("INSERT INTO user_blocks(blocker_user_id,blocked_user_id)"
                + " VALUES(?,?) ON CONFLICT DO NOTHING", actor, target);
        // The database block trigger also severs follows and durable friendship.
        jdbc.update("DELETE FROM user_follows WHERE (follower_user_id=? AND"
                + " followed_user_id=?) OR (follower_user_id=? AND followed_user_id=?)",
                actor, target, target, actor);
    }

    public void unblock(UUID actor, UUID target) {
        jdbc.update("DELETE FROM user_blocks WHERE blocker_user_id=?"
                + " AND blocked_user_id=?", actor, target);
    }

    public boolean isBlockedByMe(UUID viewer, UUID target) {
        return exists("SELECT 1 FROM user_blocks WHERE blocker_user_id=?"
                + " AND blocked_user_id=?", viewer, target);
    }

    public List<UUID> blocked(UUID userId, int page, int size) {
        return jdbc.queryForList("SELECT blocked_user_id FROM user_blocks WHERE"
                + " blocker_user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                UUID.class, userId, size, page * size);
    }

    // ---- queries ----

    public boolean canInteract(UUID a, UUID b) {
        return !blockedEither(a, b);
    }

    public java.util.Set<UUID> blockedWith(UUID viewer, java.util.Collection<UUID> candidates) {
        if (candidates == null || candidates.isEmpty()) {
            return java.util.Set.of();
        }
        String ph = String.join(",", java.util.Collections.nCopies(candidates.size(), "?::uuid"));
        var args = new java.util.ArrayList<Object>(candidates.size() * 2 + 3);
        args.add(viewer);
        args.add(viewer);
        args.add(viewer);
        args.addAll(candidates);
        args.addAll(candidates);
        return new java.util.HashSet<>(jdbc.queryForList(
                "SELECT DISTINCT CASE WHEN blocker_user_id=? THEN blocked_user_id"
                        + " ELSE blocker_user_id END AS other FROM user_blocks"
                        + " WHERE (blocker_user_id=? OR blocked_user_id=?)"
                        + " AND (blocker_user_id IN (" + ph + ") OR blocked_user_id IN (" + ph + "))",
                UUID.class, args.toArray()));
    }

    public java.util.List<UUID> followingIds(UUID viewer) {
        return following(viewer, 0, 1000);
    }

    public RelationshipView relationship(UUID viewer, UUID target) {
        boolean f = isFollowing(viewer, target);
        boolean fb = isFollowing(target, viewer);
        return new RelationshipView(f, fb, f && fb, isFriend(viewer, target),
                isBlockedByMe(viewer, target));
    }
}


