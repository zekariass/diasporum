package com.diasporum.backend.social;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import java.util.List;
import java.util.UUID;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.social.internal.application.SocialService;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Social module on real migrated PostgreSQL — v10.12: friendships are derived
 * from reciprocal user_follows via user_mutual_connections. */
@SpringBootTest
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class SocialModuleIntegrationTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired SocialApi api;
    @Autowired SocialService social;
    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;

    private UUID u1, u2, u3;

    private UUID user(String sub) {
        return IdentityTestSupport.provision(ctx, ISSUER, sub);
    }

    @BeforeEach
    void clean() {
        for (String t : new String[]{"user_follows", "user_blocks",
                "user_mutes", "user_privacy_settings",
                "external_identities", "profiles"}) {
            jdbc.update("DELETE FROM " + t);
        }
        u1 = user("s1");
        u2 = user("s2");
        u3 = user("s3");
    }

    @Test
    void followLifecycleAndDuplicateAndSelf() {
        social.follow(u1, u2);
        assertTrue(api.isFollowing(u1, u2));
        assertFalse(api.isFollowing(u2, u1));
        social.follow(u1, u2);                    // duplicate → idempotent
        assertEquals(1, social.followers(u2, 0, 10).size());
        assertThrows(ResponseStatusException.class, () -> social.follow(u1, u1));
        social.unfollow(u1, u2);
        assertFalse(api.isFollowing(u1, u2));
    }

    @Test
    void mutualFollowAndRelationshipView() {
        social.follow(u1, u2);
        social.follow(u2, u1);
        var r = api.relationship(u1, u2);
        assertTrue(r.following() && r.followedBy() && r.mutual());
        assertTrue(r.friends());                    // mutual follow IS the connection
    }

    @Test
    void followRespectsBlockAndPrivacy() {
        social.follow(u1, u2);
        social.block(u2, u1);                     // block severs follow edges
        assertFalse(api.isFollowing(u1, u2));
        assertThrows(ResponseStatusException.class, () -> social.follow(u1, u2));
        assertFalse(api.canInteract(u1, u2));
        social.unblock(u2, u1);
        jdbc.update("UPDATE user_privacy_settings SET allow_followers=false"
                + " WHERE user_id=?", u3);
        assertThrows(ResponseStatusException.class, () -> social.follow(u1, u3));
    }

    @Test
    void missingPrivacyRowFallsBackToSchemaDefault() {
        jdbc.update("DELETE FROM user_privacy_settings WHERE user_id=?", u2);
        social.follow(u1, u2);                    // allow_followers DEFAULT true
        assertTrue(api.isFollowing(u1, u2));
    }

    @Test
    void friendshipDirectAndMatchmaking() {
        // Direct: a friend intent follows the target; the connection only
        // materializes once the target follows back (v10.12 derived model).
        social.addFriend(u1, u2);
        assertFalse(api.isFriend(u1, u2));         // not yet mutual
        social.follow(u2, u1);
        assertTrue(api.isFriend(u1, u2));
        assertTrue(api.isFriend(u2, u1));         // unordered
        assertTrue(api.friendIds(u1).contains(u2));
        // Matchmaking: a mutual match establishes both edges at once.
        api.establishMatchmakingFriendship(u1, u3);
        api.establishMatchmakingFriendship(u1, u3);   // idempotent
        assertTrue(api.isFriend(u1, u3));
        Integer edges = jdbc.queryForObject(
                "SELECT count(*) FROM user_follows WHERE (follower_user_id=?::uuid"
                        + " AND followed_user_id=?::uuid) OR (follower_user_id=?::uuid"
                        + " AND followed_user_id=?::uuid)",
                Integer.class, u1, u3, u3, u1);
        assertEquals(2, edges);                   // both directions, exactly once
        api.dissolveMatchmakingFriendship(u1, u3);
        assertFalse(api.isFriend(u1, u3));
        assertTrue(api.isFriend(u1, u2));         // direct connection preserved
    }

    @Test
    void blockRestrictionsHistoryAndBlockerNotRevealed() {
        social.follow(u1, u2);
        social.follow(u2, u1);                     // mutual connection
        social.block(u1, u2);                      // severs both follow edges
        assertTrue(api.isBlockedByMe(u1, u2));
        assertFalse(api.isBlockedByMe(u2, u1));   // blocked user cannot learn of the block
        assertFalse(api.relationship(u2, u1).blockedByMe());
        assertFalse(api.canInteract(u2, u1));     // but enforcement still applies
        assertTrue(social.blocked(u1, 0, 10).contains(u2));
        assertFalse(api.isFriend(u1, u2));         // mutual connection dissolved
        social.unblock(u1, u2);
        assertFalse(api.isBlockedByMe(u1, u2));
        assertTrue(api.canInteract(u1, u2));
    }

    @Test
    void paginationAndNonexistentTarget() {
        for (int i = 0; i < 3; i++) {
            social.follow(u1, user("page" + i));
        }
        assertEquals(2, social.following(u1, 0, 2).size());
        assertEquals(1, social.following(u1, 1, 2).size());
        assertThrows(ResponseStatusException.class,
                () -> social.follow(u1, UUID.randomUUID()));
    }

    @Test
    void httpEndpointsResolveActorFromJwt() throws Exception {
        var asU1 = authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(u1, UUID.randomUUID(), "s1@test.com", List.of()), null, List.of()));
        mvc.perform(post("/api/v1/social/follows/" + u2).with(asU1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.following").value(true));
        assertTrue(api.isFollowing(u1, u2));
        mvc.perform(get("/api/v1/social/relationship/" + u2).with(asU1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.following").value(true));
        mvc.perform(post("/api/v1/social/follows/" + u1).with(asU1))
                .andExpect(status().isBadRequest());          // self-follow
        mvc.perform(post("/api/v1/social/follows/" + UUID.randomUUID()).with(asU1))
                .andExpect(status().isNotFound());
        mvc.perform(delete("/api/v1/social/follows/" + u2).with(asU1))
                .andExpect(status().isOk());
        assertFalse(api.isFollowing(u1, u2));
        mvc.perform(post("/api/v1/social/follows/" + u2))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void countsAndFollowerListSummaries() throws Exception {
        social.follow(u1, u2);
        social.follow(u3, u2);
        assertEquals(2, api.followerCount(u2));
        assertEquals(1, api.followingCount(u1));
        social.addFriend(u1, u3);
        social.follow(u3, u1);                     // reciprocal → mutual connection
        assertEquals(1, api.friendCount(u1));
        var asU2 = authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(u2, UUID.randomUUID(), "s2@test.com", List.of()), null, List.of()));
        mvc.perform(get("/api/v1/social/followers").with(asU2))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(2))
                .andExpect(jsonPath("$.items[0].id").exists())
                .andExpect(jsonPath("$.items[0].accountStatus").value("ACTIVE"));
    }

    @Test
    void concurrentMatchmakingFriendshipConvergesToOneConnection() throws Exception {
        var pool = java.util.concurrent.Executors.newFixedThreadPool(4);
        var latch = new java.util.concurrent.CountDownLatch(1);
        var futures = java.util.stream.IntStream.range(0, 4)
                .mapToObj(i -> pool.submit(() -> {
                    latch.await();
                    api.establishMatchmakingFriendship(u1, u2);
                    return null;
                })).toList();
        latch.countDown();
        for (var f : futures) {
            f.get();
        }
        pool.shutdown();
        Integer n = jdbc.queryForObject(
                "SELECT count(*) FROM user_mutual_connections WHERE"
                        + " (user_a_id=?::uuid AND user_b_id=?::uuid)"
                        + " OR (user_a_id=?::uuid AND user_b_id=?::uuid)",
                Integer.class, u1, u2, u2, u1);
        assertEquals(1, n);                       // race-safe: exactly one connection
        assertTrue(api.isFriend(u1, u2));
    }
}
