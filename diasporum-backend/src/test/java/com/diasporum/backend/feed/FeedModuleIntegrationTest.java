package com.diasporum.backend.feed;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import java.util.List;
import java.util.UUID;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.diasporum.backend.community.internal.application.CommunityService;
import com.diasporum.backend.feed.internal.application.FeedService;
import com.diasporum.backend.identity.IdentityTestSupport;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Feed module on real migrated PostgreSQL. */
@SpringBootTest
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class FeedModuleIntegrationTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired FeedService service;
    @Autowired FeedApi api;
    @Autowired CommunityService communityService;
    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;

    private UUID user(String sub) {
        return IdentityTestSupport.provision(ctx, ISSUER, sub);
    }

    private UUID origin, community, category;
    private UUID u1, u2;

    @BeforeEach
    void setup() {
        // feed_posts first — polls/options/votes/comments/reactions/help/
        // media/saves/shares all cascade from it (vote-withdrawal trigger
        // would otherwise block direct vote deletes).
        for (String t : new String[]{"user_follows", "user_blocks",
                "feed_posts", "media_objects", "user_content_views",
                "community_memberships", "external_identities", "profiles",
                "communities", "country_categories", "airports", "countries"}) {
            jdbc.update("DELETE FROM " + t);
        }
        jdbc.update("INSERT INTO countries(name,iso2,iso3) VALUES"
                + "('Ethiopia','ET','ETH'),('Germany','DE','DEU')");
        origin = jdbc.queryForObject("SELECT id FROM countries WHERE iso2='ET'",
                UUID.class);
        var dest = jdbc.queryForObject("SELECT id FROM countries WHERE iso2='DE'",
                UUID.class);
        jdbc.update("INSERT INTO communities(name,slug,origin_country_id,"
                + "destination_country_id) VALUES('ET in DE','et-in-de',?,?)",
                origin, dest);
        community = jdbc.queryForObject("SELECT id FROM communities", UUID.class);
        jdbc.update("INSERT INTO country_categories(id,country_id,name,slug)"
                + " VALUES(gen_random_uuid(),?,'General','general')", dest);
        category = jdbc.queryForObject("SELECT id FROM country_categories",
                UUID.class);
        jdbc.update("INSERT INTO country_category_modules(category_id,module_key)"
                + " VALUES(?,'FEED'),(?,'COMMUNITY_HELP'),(?,'EVENT')",
                category, category, category);
        u1 = user("f1");
        u2 = user("f2");
        for (UUID u : new UUID[]{u1, u2}) {
            jdbc.update("UPDATE profiles SET origin_country_id=?,"
                    + " current_country_id=? WHERE id=?", origin, dest, u);
            communityService.join(u, community);
        }
    }

    private UUID makePost(UUID author, String type) {
        return service.createPost(author, community, type, "t", "body", null,
                "COMMUNITY", category, null).id();
    }

    @Test
    void createAndReadPost() {
        UUID id = makePost(u1, "GENERAL");
        var p = service.getPost(u1, id);
        assertEquals("GENERAL", p.postType());
        assertEquals(u1, p.authorId());
        assertEquals("PUBLISHED", p.status());
        assertTrue(api.post(id).isPresent());
    }

    @Test
    void generalPostAcceptsDocumentMedia() {
        UUID mediaId = UUID.randomUUID();
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,"
                        + "object_key,purpose,status,mime_type)"
                        + " VALUES(?,?,?,?,'DOCUMENT','READY','application/pdf')",
                mediaId, u1, "test", "documents/" + mediaId);

        UUID postId = service.createPost(u1, community, "GENERAL", "Document",
                "See the attached document", null, "COMMUNITY", category,
                List.of(mediaId)).id();

        assertEquals(List.of(mediaId), service.mediaIds(postId));
    }

    @Test
    void announcementRequiresModerator() {
        assertThrows(ResponseStatusException.class,
                () -> makePost(u1, "ANNOUNCEMENT"));         // u1 is MEMBER
        jdbc.update("UPDATE community_memberships SET role='MODERATOR'"
                + " WHERE user_id=?", u1);
        assertEquals("ANNOUNCEMENT",
                service.getPost(u1, makePost(u1, "ANNOUNCEMENT")).postType());
    }

    @Test
    void editDeleteAuthorOnly() {
        UUID id = makePost(u1, "GENERAL");
        service.updatePost(u1, id, "new title", "new body", null);
        assertEquals("new title", service.getPost(u1, id).title());
        assertThrows(ResponseStatusException.class,
                () -> service.updatePost(u2, id, "x", "y", null));
        assertThrows(ResponseStatusException.class,
                () -> service.deletePost(u2, id));
        service.deletePost(u1, id);
        assertThrows(ResponseStatusException.class, () -> service.getPost(u1, id));
    }

    @Test
    void reactionsAndSaves() {
        UUID id = makePost(u1, "GENERAL");
        service.react(u2, id, "LIKE");
        service.react(u2, id, "LOVE");                   // change, not dup
        assertEquals(1, api.reactionCount(id));
        service.unreact(u2, id);
        assertEquals(0, api.reactionCount(id));
        assertThrows(ResponseStatusException.class,
                () -> service.react(u2, id, "NOPE"));
        service.save(u2, id);
        service.save(u2, id);                            // idempotent
        service.unsave(u2, id);
    }

    @Test
    void commentsWithCountsAndPermissions() {
        UUID id = makePost(u1, "GENERAL");
        var c = service.comment(u2, id, null, "first!");
        var reply = service.comment(u1, id, c.id(), "reply");
        assertEquals(2, api.commentCount(id));
        service.updateComment(u2, c.id(), "edited");
        assertThrows(ResponseStatusException.class,        // not comment author
                () -> service.deleteComment(u1, c.id()));
        var page = service.comments(u1, id, 0, 20);
        assertEquals(2, page.items().size());
        service.deleteComment(u2, c.id());
        assertEquals(1, api.commentCount(id));
    }

    @Test
    void communityHelpLifecycle() {
        var h = service.createHelpPost(u1, community, category, "REQUEST",
                "Need help", "moving boxes", null);
        var post = (FeedService.PostRow) h.get("post");
        assertEquals("COMMUNITY_HELP", post.postType());
        assertEquals("OPEN", h.get("helpStatus"));
        service.setHelpStatus(u1, post.id(), "RESOLVED");
        assertEquals("RESOLVED", service.helpStatus(post.id()).get("helpStatus"));
        assertThrows(ResponseStatusException.class,        // terminal
                () -> service.setHelpStatus(u1, post.id(), "OPEN"));
        assertThrows(ResponseStatusException.class,        // not author
                () -> service.setHelpStatus(u2, post.id(), "CLOSED"));
    }

    @Test
    void pollsCreateVoteResults() {
        var created = service.createPoll(u1, community, category, "Q?",
                List.of("Yes", "No"), null);
        assertEquals("POLL", service.getPost(u1, created.postId()).postType());
        var poll = service.poll(created.postId(), u2);
        assertEquals(2, poll.options().size());
        UUID optId = poll.options().get(0).id();
        service.vote(u2, optId, false);
        assertEquals(1, service.poll(created.postId(), u2).myVotes().size());
        assertThrows(ResponseStatusException.class,
                () -> service.vote(u2, poll.options().get(1).id(), false));
    }

    @Test
    void communityFeedRanksUnviewedFirst() {
        UUID a = makePost(u1, "GENERAL");
        UUID b = makePost(u1, "GENERAL");
        service.recordView(u2, "FEED_POST", a);           // a viewed
        var page = service.communityFeed(u2, community, null, null, null, 10);
        assertEquals(2, page.items().size());
        assertEquals("FEED_POST:" + b, page.items().get(0).itemId());  // unviewed 1st
        assertEquals("FEED_POST:" + a, page.items().get(1).itemId());
        assertFalse(page.items().get(0).viewed());
        assertTrue(page.items().get(1).viewed());
    }

    @Test
    void followingFeedFiltersAndBlocks() {
        socialFollow(u2, u1);
        UUID id = makePost(u1, "GENERAL");
        var page = service.followingFeed(u2, null, 10);
        assertEquals(1, page.items().size());
        blockUser(u2, u1);
        assertEquals(0, service.followingFeed(u2, null, 10).items().size());
    }

    @Test
    void communityFeedRequiresMembership() {
        UUID outsider = user("f3");
        assertThrows(ResponseStatusException.class,
                () -> service.communityFeed(outsider, community, null, null,
                        null, 10));
    }

    @Test
    void httpCreateAndFeed() throws Exception {
        var asU1 = authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(u1, UUID.randomUUID(), "f1@test.com", List.of()), null, List.of()));
        mvc.perform(post("/api/v1/feed/posts").with(asU1)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"communityId\":\"" + community
                                + "\",\"postType\":\"GENERAL\",\"body\":\"hi\","
                                + "\"categoryId\":\"" + category + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.postType").value("GENERAL"));
        mvc.perform(get("/api/v1/feed/community")
                        .param("communityId", community.toString()).with(asU1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].contentType").value("GENERAL"));
        mvc.perform(get("/api/v1/feed/community")
                        .param("communityId", community.toString()))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void directLookupCannotBypassVisibility() {
        UUID id = makePost(u1, "GENERAL");
        service.getPost(u2, id);                             // member OK
        UUID outsider = user("f3");
        assertThrows(ResponseStatusException.class,          // not a member
                () -> service.getPost(outsider, id));
        blockUser(u2, u1);
        assertThrows(ResponseStatusException.class,          // blocked
                () -> service.getPost(u2, id));
    }

    @Test
    void draftsHiddenFromOthers() {
        var created = service.createPoll(u1, community, category, "Q?",
                List.of("Yes", "No"), null);
        // DRAFT->published internally; simulate draft for the check:
        jdbc.update("UPDATE feed_posts SET status='DRAFT' WHERE id=?", created.postId());
        assertThrows(ResponseStatusException.class,
                () -> service.getPost(u2, created.postId()));  // author-only
        service.getPost(u1, created.postId());                 // author OK
    }

    @Test
    void cursorPaginationIsStable() {
        makePost(u1, "GENERAL");
        makePost(u1, "GENERAL");
        makePost(u1, "GENERAL");
        var p1 = service.communityFeed(u2, community, null, null, null, 2);
        assertEquals(2, p1.items().size());
        var p2 = service.communityFeed(u2, community, null, null,
                p1.nextCursor(), 2);
        assertEquals(1, p2.items().size());                  // no dupes/no skip
        var ids = new java.util.HashSet<String>();
        p1.items().forEach(i -> ids.add(i.itemId()));
        p2.items().forEach(i -> ids.add(i.itemId()));
        assertEquals(3, ids.size());
    }

    @Test
    void concurrentVoteIsIdempotent() throws Exception {
        var created = service.createPoll(u1, community, category, "Q?",
                List.of("Yes", "No"), null);
        UUID optId = service.poll(created.postId(), u2).options().get(0).id();
        var pool = java.util.concurrent.Executors.newFixedThreadPool(4);
        var latch = new java.util.concurrent.CountDownLatch(1);
        var outcomes = new java.util.concurrent.atomic.AtomicInteger();
        var futures = java.util.stream.IntStream.range(0, 4)
                .mapToObj(i -> pool.submit(() -> {
                    latch.await();
                    service.vote(u2, optId, false);
                    outcomes.incrementAndGet();
                    return null;
                })).toList();
        latch.countDown();
        for (var f : futures) {
            f.get();
        }
        pool.shutdown();
        assertEquals(4, outcomes.get());
        assertEquals(1, service.poll(created.postId(), u2).myVotes().size());
    }

    private void socialFollow(UUID a, UUID b) {
        jdbc.update("INSERT INTO user_follows(follower_user_id,followed_user_id)"
                + " VALUES(?,?)", a, b);
    }

    private void blockUser(UUID a, UUID b) {
        jdbc.update("INSERT INTO user_blocks(blocker_user_id,blocked_user_id)"
                + " VALUES(?,?)", a, b);
    }
}
