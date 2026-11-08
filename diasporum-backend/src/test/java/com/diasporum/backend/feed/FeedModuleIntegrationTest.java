package com.diasporum.backend.feed;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
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
import com.diasporum.backend.media.internal.infrastructure.integration.storage.StorageClient;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
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

    @TestConfiguration
    static class FakeStorage {
        @Bean
        @Primary
        StorageClient storageClient() {
            var objects = new ConcurrentHashMap<String, StorageClient.ObjectMeta>();
            var bytes = new ConcurrentHashMap<String, byte[]>();
            return new StorageClient() {
                public String presignPut(String k, String ct, java.time.Duration t) {
                    objects.put(k, new StorageClient.ObjectMeta(1024, ct));
                    return "https://r2.test/put/" + k;
                }
                public String presignGet(String k, java.time.Duration t) {
                    return "https://r2.test/get/" + k;
                }
                public java.util.Optional<StorageClient.ObjectMeta> head(String k) {
                    return java.util.Optional.ofNullable(objects.get(k));
                }
                public java.util.Optional<byte[]> get(String k) {
                    return java.util.Optional.ofNullable(bytes.get(k));
                }
                public void put(String k, byte[] data, String contentType) {
                    bytes.put(k, data);
                    objects.put(k, new StorageClient.ObjectMeta(data.length, contentType));
                }
                public void delete(String k) {
                    objects.remove(k);
                    bytes.remove(k);
                }
            };
        }
    }

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
        for (String t : new String[]{"idempotency_keys", "user_follows", "user_blocks",
                "feed_posts", "feed_tags", "media_objects", "user_content_views",
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
    void postWithoutCategoryIsAllowed() {
        var p = service.createPost(u1, community, "GENERAL", "t", "body", null,
                "COMMUNITY", null, null);
        assertNull(p.categoryId());
        assertEquals("PUBLISHED", p.status());
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
        service.comment(u1, id, c.id(), "reply");
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
                "Need help", "moving boxes", null, null,
                List.of("VisaAdvice"));
        var post = (FeedService.PostRow) h.get("post");
        assertEquals("COMMUNITY_HELP", post.postType());
        assertEquals("OPEN", h.get("helpStatus"));
        assertEquals(List.of("VisaAdvice"),
                service.postDetail(u1, post.id()).tags());
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
        makePost(u1, "GENERAL");
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
    void httpPublicationReplayReturnsOriginalResponseAndRollbackLeavesNoSuccessRecord()
            throws Exception {
        var asU1 = authentication(new UsernamePasswordAuthenticationToken(
                new DiasporumUserPrincipal(u1, UUID.randomUUID(), "f1@test.com", List.of()),
                null, List.of()));
        String postRequest = "{\"communityId\":\"" + community
                + "\",\"postType\":\"GENERAL\",\"categoryId\":\"" + category
                + "\",\"body\":\"retry me\",\"idempotencyKey\":\"feed-retry-post\"}";
        var first = mvc.perform(post("/api/v1/feed/posts").with(asU1)
                        .contentType(MediaType.APPLICATION_JSON).content(postRequest))
                .andExpect(status().isOk()).andExpect(jsonPath("$.id").exists()).andReturn();
        String firstId = com.jayway.jsonpath.JsonPath.read(
                first.getResponse().getContentAsString(), "$.id");
        var replay = mvc.perform(post("/api/v1/feed/posts").with(asU1)
                        .contentType(MediaType.APPLICATION_JSON).content(postRequest))
                .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(firstId))
                .andReturn();
        assertEquals(first.getResponse().getContentAsString(),
                replay.getResponse().getContentAsString());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM feed_posts", Integer.class));

        mvc.perform(post("/api/v1/feed/posts").with(asU1)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(postRequest.replace("retry me", "changed")))
                .andExpect(status().isConflict());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM feed_posts", Integer.class));

        String helpRequest = "{\"communityId\":\"" + community
                + "\",\"categoryId\":\"" + category
                + "\",\"helpKind\":\"REQUEST\",\"title\":\"Need a hand\","
                + "\"body\":\"Moving boxes\",\"idempotencyKey\":\"feed-retry-help\"}";
        var help = mvc.perform(post("/api/v1/feed/community-help").with(asU1)
                        .contentType(MediaType.APPLICATION_JSON).content(helpRequest))
                .andExpect(status().isOk()).andReturn();
        String helpId = com.jayway.jsonpath.JsonPath.read(
                help.getResponse().getContentAsString(), "$.post.id");
        mvc.perform(post("/api/v1/feed/community-help").with(asU1)
                        .contentType(MediaType.APPLICATION_JSON).content(helpRequest))
                .andExpect(status().isOk()).andExpect(jsonPath("$.post.id").value(helpId))
                .andExpect(jsonPath("$.helpKind").value("REQUEST"))
                .andExpect(jsonPath("$.helpStatus").value("OPEN"));
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM feed_posts", Integer.class));
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM idempotency_keys",
                Integer.class));

        String failedRequest = "{\"communityId\":\"" + community
                + "\",\"postType\":\"REEL\",\"body\":\"no video\","
                + "\"idempotencyKey\":\"feed-retry-failed\"}";
        mvc.perform(post("/api/v1/feed/posts").with(asU1)
                        .contentType(MediaType.APPLICATION_JSON).content(failedRequest))
                .andExpect(status().isBadRequest());
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM idempotency_keys"
                + " WHERE operation_key='feed-post-create:feed-retry-failed'", Integer.class));
        mvc.perform(post("/api/v1/feed/posts").with(asU1)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(failedRequest.replace("REEL", "GENERAL")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.postType").value("GENERAL"));
        assertEquals(3, jdbc.queryForObject("SELECT count(*) FROM feed_posts", Integer.class));
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

    @Test
    void myPostsScopesToAuthorAndCountsTotal() {
        makePost(u1, "GENERAL");
        makePost(u1, "GENERAL");
        makePost(u2, "GENERAL");                             // other author
        var mine = service.myPosts(u1, null, false, null, 20);
        assertEquals(2, mine.total());
        assertEquals(2, mine.items().size());
        assertTrue(mine.items().stream()
                .allMatch(i -> i.itemId().startsWith("FEED_POST:")));
        assertEquals(1, service.myPosts(u2, null, false, null, 20).total());
    }

    @Test
    void myPostsFiltersByPostType() {
        makePost(u1, "GENERAL");
        service.createPoll(u1, community, category, "Q?",
                List.of("Yes", "No"), null);
        var polls = service.myPosts(u1, "POLL", false, null, 20);
        assertEquals(1, polls.total());
        assertEquals("POLL", polls.items().get(0).contentType());
        assertTrue(polls.items().get(0).payload().containsKey("poll"));
        assertEquals(2, service.myPosts(u1, null, false, null, 20).total());
        assertThrows(ResponseStatusException.class,
                () -> service.myPosts(u1, "NOPE", false, null, 20));
    }

    @Test
    void myPostsFiltersByMediaPresence() {
        UUID mediaId = UUID.randomUUID();
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,"
                        + "object_key,purpose,status,mime_type)"
                        + " VALUES(?,?,?,?,'FEED_IMAGE','READY','image/jpeg')",
                mediaId, u1, "test", "images/" + mediaId);
        service.createPost(u1, community, "GENERAL", "with photo", "b", null,
                "COMMUNITY", category, List.of(mediaId));
        makePost(u1, "GENERAL");                             // no media
        var withMedia = service.myPosts(u1, null, true, null, 20);
        assertEquals(1, withMedia.total());
        assertEquals(List.of(mediaId),
                withMedia.items().get(0).mediaIds());
    }

    @Test
    void myPostsCursorPaginationIsStable() {
        makePost(u1, "GENERAL");
        makePost(u1, "GENERAL");
        makePost(u1, "GENERAL");
        var p1 = service.myPosts(u1, null, false, null, 2);
        var p2 = service.myPosts(u1, null, false, p1.nextCursor(), 2);
        assertEquals(2, p1.items().size());
        assertEquals(1, p2.items().size());
        assertEquals(3, p2.total());                         // total is cursor-free
        var ids = new java.util.HashSet<String>();
        p1.items().forEach(i -> ids.add(i.itemId()));
        p2.items().forEach(i -> ids.add(i.itemId()));
        assertEquals(3, ids.size());                         // no dupes/no skip
    }

    @Test
    void httpMineReturnsOwnPosts() throws Exception {
        var asU1 = authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(u1, UUID.randomUUID(), "f1@test.com", List.of()), null, List.of()));
        var asU2 = authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(u2, UUID.randomUUID(), "f2@test.com", List.of()), null, List.of()));
        makePost(u1, "GENERAL");
        mvc.perform(get("/api/v1/feed/mine").with(asU1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[0].contentType").value("GENERAL"));
        mvc.perform(get("/api/v1/feed/mine").with(asU2))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(0));
        mvc.perform(get("/api/v1/feed/mine"))
                .andExpect(status().isUnauthorized());
    }

    // ---- hashtags ----

    @Test
    void tagsNormalizeDedupeAndExtract() {
        var p = service.createPost(u1, community, "GENERAL", "t",
                "hello #VisaAdvice world", null, "COMMUNITY", category, null,
                List.of("#Leeds", "leeds", " ETHIOPIA "));
        var detail = service.postDetail(u2, p.id());
        // explicit tags first (deduped, display case preserved), then body tokens
        assertEquals(List.of("Leeds", "ETHIOPIA", "VisaAdvice"), detail.tags());
        assertEquals(3, jdbc.queryForObject(
                "SELECT count(*) FROM feed_tags", Integer.class));
        assertEquals(1, jdbc.queryForObject(
                "SELECT post_count FROM feed_tags WHERE tag_key='leeds'",
                Integer.class));
        var feed = service.communityFeed(u2, community, "LATEST", null, null, 10);
        assertEquals(List.of("Leeds", "ETHIOPIA", "VisaAdvice"),
                feed.items().get(0).tags());
    }

    @Test
    void tagValidationAndCaps() {
        assertThrows(ResponseStatusException.class,                 // bad chars
                () -> service.createPost(u1, community, "GENERAL", "t", "b",
                        null, "COMMUNITY", category, null, List.of("bad tag!")));
        assertThrows(ResponseStatusException.class,                 // too short
                () -> service.createPost(u1, community, "GENERAL", "t", "b",
                        null, "COMMUNITY", category, null, List.of("x")));
        var eleven = java.util.stream.IntStream.range(0, 11)
                .mapToObj(i -> "tag" + i).toList();
        assertThrows(ResponseStatusException.class,                 // cap = 10
                () -> service.createPost(u1, community, "GENERAL", "t", "b",
                        null, "COMMUNITY", category, null, eleven));
    }

    @Test
    void tagSuggestionsRankByUsage() {
        service.createPost(u1, community, "GENERAL", "a", "b", null,
                "COMMUNITY", category, null, List.of("leeds"));
        service.createPost(u1, community, "GENERAL", "b", "b", null,
                "COMMUNITY", category, null, List.of("leeds", "leicester"));
        var s = service.suggestTags("le", 10);
        assertEquals("leeds", s.get(0).tagKey());                  // 2 uses > 1
        assertTrue(s.stream().anyMatch(t -> t.tagKey().equals("leicester")));
        assertTrue(service.suggestTags("zzz", 10).isEmpty());
    }

    @Test
    void tagFeedIsCommunityScopedAndRespectsVisibility() {
        var tagged = service.createPost(u1, community, "GENERAL", "t", "b",
                null, "COMMUNITY", category, null, List.of("leeds")).id();
        makePost(u1, "GENERAL");                                  // untagged
        var page = service.tagFeed(u2, community, "Leeds", null, 10);
        assertEquals(1, page.items().size());
        assertEquals("FEED_POST:" + tagged, page.items().get(0).itemId());
        assertEquals(List.of("leeds"), page.items().get(0).tags());
        UUID outsider = user("f3");
        assertThrows(ResponseStatusException.class,               // membership
                () -> service.tagFeed(outsider, community, "leeds", null, 10));
        blockUser(u2, u1);
        assertEquals(0, service.tagFeed(u2, community, "leeds", null, 10)
                .items().size());                                 // blocked hidden
        jdbc.update("DELETE FROM user_blocks");
        service.deletePost(u1, tagged);
        assertEquals(0, service.tagFeed(u2, community, "leeds", null, 10)
                .items().size());                                 // deleted hidden
        assertEquals(0, jdbc.queryForObject(
                "SELECT post_count FROM feed_tags WHERE tag_key='leeds'",
                Integer.class));
        assertThrows(ResponseStatusException.class,
                () -> service.tagFeed(u2, community, "bad tag!", null, 10));
    }

    @Test
    void communityFeedCombinesCategoryAndTag() {
        var p = service.createPost(u1, community, "GENERAL", "t", "b", null,
                "COMMUNITY", category, null, List.of("leeds")).id();
        makePost(u1, "GENERAL");
        var page = service.communityFeed(u2, community, "LATEST", category,
                "leeds", null, 10);
        assertEquals(1, page.items().size());
        assertEquals("FEED_POST:" + p, page.items().get(0).itemId());
        assertEquals(0, service.communityFeed(u2, community, "LATEST", category,
                "nope", null, 10).items().size());
    }

    @Test
    void updatePostResyncsTagsAndValidatesCategory() {
        var id = service.createPost(u1, community, "GENERAL", "t", "b", null,
                "COMMUNITY", category, null, List.of("alpha")).id();
        service.updatePost(u1, id, null, "new body #Beta", null);
        var tags = service.postDetail(u1, id).tags();
        assertTrue(tags.containsAll(List.of("alpha", "Beta")));   // union on edit
        service.updatePost(u1, id, null, null, null, null, List.of("gamma"));
        tags = service.postDetail(u1, id).tags();
        assertTrue(tags.contains("gamma") && tags.contains("Beta")
                && !tags.contains("alpha"));                      // explicit replace
        UUID other = UUID.randomUUID();                           // wrong country
        assertThrows(ResponseStatusException.class,
                () -> service.updatePost(u1, id, null, null, null, other, null));
    }

    // ---- audio + media attachments ----

    private UUID readyMedia(UUID owner, String purpose, String mime,
            Long durationMs) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,"
                        + "object_key,purpose,status,mime_type,duration_ms)"
                        + " VALUES(?,?,?,?,?,'READY',?,?)",
                id, owner, "test", "obj/" + id, purpose, mime, durationMs);
        return id;
    }

    @Test
    void audioAttachLifecycleAndMetadata() {
        UUID audio = readyMedia(u1, "FEED_AUDIO", "audio/mpeg", 12_000L);
        var p = service.createPost(u1, community, "GENERAL", "voice note", "b",
                null, "COMMUNITY", category, List.of(audio));
        assertEquals(List.of(audio), service.mediaIds(p.id()));
        var detail = service.postDetail(u2, p.id());
        assertEquals(1, detail.media().size());
        assertEquals("FEED_AUDIO", detail.media().get(0).purpose());
        assertEquals(12_000L, detail.media().get(0).durationMs());
        var feed = service.communityFeed(u2, community, "LATEST", null, null, 10);
        assertEquals("FEED_AUDIO", feed.items().get(0).media().get(0).purpose());
    }

    @Test
    void audioAttachValidation() {
        UUID foreign = readyMedia(u2, "FEED_AUDIO", "audio/mpeg", 1000L);
        assertThrows(ResponseStatusException.class,               // not owner
                () -> service.createPost(u1, community, "GENERAL", "t", "b",
                        null, "COMMUNITY", category, List.of(foreign)));
        UUID audio = readyMedia(u1, "FEED_AUDIO", "audio/mpeg", 1000L);
        // Reels publish draft-first, so the service-level attach check rejects
        // a non-FEED_VIDEO asset with a 4xx before the DB trigger sees it.
        assertThrows(ResponseStatusException.class,
                () -> service.createPost(u1, community, "REEL", "t", "b",
                        null, "COMMUNITY", category, List.of(audio)));
        UUID pending = UUID.randomUUID();
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,"
                        + "object_key,purpose,status,mime_type)"
                        + " VALUES(?,?,?,?,'FEED_AUDIO','PENDING_UPLOAD','audio/mpeg')",
                pending, u1, "test", "obj/" + pending);
        assertThrows(ResponseStatusException.class,               // not READY
                () -> service.createPost(u1, community, "GENERAL", "t", "b",
                        null, "COMMUNITY", category, List.of(pending)));
        var many = java.util.stream.IntStream.range(0, 11)
                .mapToObj(i -> readyMedia(u1, "FEED_IMAGE", "image/jpeg", null))
                .toList();
        assertThrows(ResponseStatusException.class,               // cap = 10
                () -> service.createPost(u1, community, "GENERAL", "t", "b",
                        null, "COMMUNITY", category, many));
    }

    @Test
    void reelPublishesAfterVideoAttaches() {
        assertThrows(ResponseStatusException.class,               // video required
                () -> service.createPost(u1, community, "REEL", null, "cap",
                        null, "COMMUNITY", category, null));
        UUID video = readyMedia(u1, "FEED_VIDEO", "video/mp4", 30_000L);
        var p = service.createPost(u1, community, "REEL", null, "cap", null,
                "COMMUNITY", null, List.of(video));               // no category
        assertEquals("PUBLISHED", p.status());
        assertNotNull(p.publishedAt());
        assertEquals(List.of(video), service.mediaIds(p.id()));
    }

    @Test
    void reusedReelVideoUsesAnyViewableParent() {
        UUID video = readyMedia(u1, "FEED_VIDEO", "video/mp4", 10_000L);
        var deleted = service.createPost(u1, community, "REEL", null, "old", null,
                "COMMUNITY", null, List.of(video));
        var visible = service.createPost(u1, community, "REEL", null, "new", null,
                "COMMUNITY", null, List.of(video));
        service.deletePost(u1, deleted.id());
        assertTrue(service.mediaDownloadUrl(u2, video).startsWith("https://r2.test/get/"));
        service.deletePost(u1, visible.id());
        assertThrows(ResponseStatusException.class, () -> service.mediaDownloadUrl(u2, video));
    }

    @Test
    void reelEngagementPersistsInSharedFeedContracts() {
        UUID video = readyMedia(u1, "FEED_VIDEO", "video/mp4", 10_000L);
        var reel = service.createPost(u1, community, "REEL", null, "caption", null,
                "COMMUNITY", null, List.of(video));
        service.react(u2, reel.id(), "LIKE");
        service.save(u2, reel.id());
        var comment = service.comment(u2, reel.id(), null, "Great video");
        var detail = service.postDetail(u2, reel.id());
        assertTrue(detail.saved());
        assertEquals("LIKE", detail.viewerReaction());
        assertEquals(1, detail.post().reactionCount());
        assertEquals(1, detail.post().commentCount());
        service.unreact(u2, reel.id());
        service.unsave(u2, reel.id());
        service.deleteComment(u2, comment.id());
        detail = service.postDetail(u2, reel.id());
        assertFalse(detail.saved());
        assertNull(detail.viewerReaction());
        assertEquals(0, detail.post().reactionCount());
        assertEquals(0, detail.post().commentCount());
    }

    @Test
    void feedMediaUrlIsParentAuthorized() {
        UUID audio = readyMedia(u1, "FEED_AUDIO", "audio/mpeg", 1000L);
        service.createPost(u1, community, "GENERAL", "t", "b", null,
                "COMMUNITY", category, List.of(audio));
        var url = service.mediaDownloadUrl(u2, audio);            // member OK
        assertTrue(url.startsWith("https://r2.test/get/"));
        UUID outsider = user("f3");
        assertThrows(ResponseStatusException.class,               // not a member
                () -> service.mediaDownloadUrl(outsider, audio));
        blockUser(u2, u1);
        assertThrows(ResponseStatusException.class,               // blocked
                () -> service.mediaDownloadUrl(u2, audio));
        jdbc.update("DELETE FROM user_blocks");
        UUID orphan = readyMedia(u1, "FEED_AUDIO", "audio/mpeg", 1000L);
        assertThrows(ResponseStatusException.class,               // unattached
                () -> service.mediaDownloadUrl(u2, orphan));
    }

    @Test
    void httpTagEndpoints() throws Exception {
        var asU2 = authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(u2, UUID.randomUUID(), "f2@test.com", List.of()), null, List.of()));
        service.createPost(u1, community, "GENERAL", "t", "b #Leeds", null,
                "COMMUNITY", category, null, null);
        mvc.perform(get("/api/v1/feed/tags/suggest")
                        .param("q", "lee").with(asU2))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].tagKey").value("leeds"));
        mvc.perform(get("/api/v1/feed/tags/leeds/posts")
                        .param("communityId", community.toString()).with(asU2))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].tags[0]").value("Leeds"));
        mvc.perform(get("/api/v1/feed/tags/leeds/posts")
                        .param("communityId", community.toString()))
                .andExpect(status().isUnauthorized());
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
