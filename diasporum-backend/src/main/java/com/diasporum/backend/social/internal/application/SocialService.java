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

/** Follow/block logic over user_follows and user_blocks. Mutual connections
 * ("friends") are derived from reciprocal follows per the v10.12 schema —
 * no separate friendship edge is stored. */
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

    // ---- mutual connections ("friends" — derived from reciprocal follows) ----

    /** Expresses a friend intent by following the target. The connection only
     * materializes once the target follows back — v10.12 stores no unilateral
     * friendship edge. */
    @Transactional
    public void addFriend(UUID actor, UUID target) {
        follow(actor, target);
    }

    /** Removes the actor's follow edge, breaking the mutual connection. The
     * target's own follow edge (if any) can only be severed by them or by a
     * block. */
    @Transactional
    public void removeFriend(UUID actor, UUID target) {
        unfollow(actor, target);
    }

    public boolean isFriend(UUID a, UUID b) {
        return isFollowing(a, b) && isFollowing(b, a);
    }

    public List<UUID> friends(UUID userId, int page, int size) {
        return jdbc.queryForList("SELECT CASE WHEN user_a_id=? THEN user_b_id"
                + " ELSE user_a_id END FROM user_mutual_connections"
                + " WHERE user_a_id=? OR user_b_id=? ORDER BY mutual_since DESC"
                + " LIMIT ? OFFSET ?",
                UUID.class, userId, userId, userId, size, page * size);
    }

    public int friendCount(UUID userId) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM user_mutual_connections"
                + " WHERE user_a_id=? OR user_b_id=?", Integer.class, userId, userId);
        return n == null ? 0 : n;
    }

    /** A mutual matchmaking match creates reciprocal follow edges — that IS the
     * connection record under v10.12. Idempotent and race-safe. */
    @Transactional
    public void establishMatchmakingFriendship(UUID a, UUID b) {
        requireNotSelf(a, b, "FRIEND");
        insertFollow(a, b);
        insertFollow(b, a);
    }

    /** Unmatching removes the reciprocal follow edges created by the match. */
    @Transactional
    public void dissolveMatchmakingFriendship(UUID a, UUID b) {
        jdbc.update("DELETE FROM user_follows WHERE (follower_user_id=? AND"
                + " followed_user_id=?) OR (follower_user_id=? AND"
                + " followed_user_id=?)", a, b, b, a);
    }

    // ---- blocks ----

    @Transactional
    public void block(UUID actor, UUID target) {
        requireNotSelf(actor, target, "BLOCK");
        requireTarget(target);
        jdbc.update("INSERT INTO user_blocks(blocker_user_id,blocked_user_id)"
                + " VALUES(?,?) ON CONFLICT DO NOTHING", actor, target);
        // Blocking severs visible follow edges in both directions; friendship
        // history is preserved per approved semantics (documented in report).
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
        return new RelationshipView(f, fb, f && fb, f && fb,
                isBlockedByMe(viewer, target));
    }
}


