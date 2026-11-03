package com.diasporum.backend.feed;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.diasporum.backend.community.internal.application.CommunityService;
import com.diasporum.backend.feed.internal.api.rest.PollResponses.PollResponse;
import com.diasporum.backend.feed.internal.application.FeedService;
import com.diasporum.backend.feed.internal.domain.PollRules;
import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest(properties = {
        "diasporum.feed.polls.create-per-hour=2",
        "diasporum.feed.polls.vote-per-minute=2"
})
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class PollModuleIntegrationTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired FeedService service;
    @Autowired CommunityService communityService;
    @Autowired ApplicationContext context;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;

    private UUID community;
    private UUID category;
    private UUID author;
    private UUID voter;
    private UUID other;

    @BeforeEach
    void setup() {
        for (String table : new String[]{"reports", "user_follows", "user_blocks",
                "feed_posts", "media_objects", "user_content_views",
                "community_memberships", "external_identities", "profiles",
                "communities", "country_categories", "airports", "countries"}) {
            jdbc.update("DELETE FROM " + table);
        }
        jdbc.update("INSERT INTO countries(name,iso2,iso3) VALUES"
                + "('Ethiopia','ET','ETH'),('Germany','DE','DEU')");
        UUID origin = jdbc.queryForObject("SELECT id FROM countries WHERE iso2='ET'",
                UUID.class);
        UUID destination = jdbc.queryForObject(
                "SELECT id FROM countries WHERE iso2='DE'", UUID.class);
        jdbc.update("INSERT INTO communities(name,slug,origin_country_id,"
                + "destination_country_id) VALUES('ET in DE','et-in-de',?,?)",
                origin, destination);
        community = jdbc.queryForObject("SELECT id FROM communities", UUID.class);
        jdbc.update("INSERT INTO country_categories(id,country_id,name,slug)"
                + " VALUES(gen_random_uuid(),?,'General','general')", destination);
        category = jdbc.queryForObject("SELECT id FROM country_categories", UUID.class);
        jdbc.update("INSERT INTO country_category_modules(category_id,module_key)"
                + " VALUES(?,'FEED')", category);
        author = user("poll-author");
        voter = user("poll-voter");
        other = user("poll-other");
        for (UUID user : List.of(author, voter, other)) {
            jdbc.update("UPDATE profiles SET origin_country_id=?,current_country_id=?"
                    + " WHERE id=?", origin, destination, user);
            communityService.join(user, community);
        }
    }

    private UUID user(String subject) {
        return IdentityTestSupport.provision(context, ISSUER, subject);
    }

    private PollResponse create() {
        return service.createPoll(author, community, category, "Choose",
                List.of("A", "B", "C"), null);
    }

    private PollResponse create(boolean multiple, boolean change, boolean withdraw,
            String visibility) {
        return service.createPoll(author, community, category, "Choose",
                List.of("A", "B", "C"), 10, null, multiple, change, withdraw,
                true, visibility);
    }

    private ResponseStatusException failure(Runnable operation) {
        return assertThrows(ResponseStatusException.class, operation::run);
    }

    private UsernamePasswordAuthenticationToken auth(UUID user) {
        return new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(
                user, UUID.randomUUID(), user + "@test.com", List.of()), null, List.of());
    }

    @Test
    void creationIsTransactionalAndFeedContainsTypedPollPayload() {
        long before = jdbc.queryForObject("SELECT count(*) FROM feed_posts", Long.class);
        assertEquals(HttpStatus.BAD_REQUEST, failure(() -> service.createPoll(author,
                community, category, "Duplicate", List.of("Yes", " yes "), null))
                .getStatusCode());
        assertEquals(before, jdbc.queryForObject(
                "SELECT count(*) FROM feed_posts", Long.class));
        assertEquals(HttpStatus.BAD_REQUEST, failure(() -> service.createPost(author,
                community, "POLL", null, "Incomplete", null, "COMMUNITY",
                category, null)).getStatusCode());

        PollResponse created = create(false, false, false, "IMMEDIATE");
        assertEquals(10, created.maxOptions());
        assertEquals(PollRules.Status.ACTIVE, created.status());
        assertEquals(0L, created.totalVoters());
        assertEquals(new BigDecimal("0.0"), created.options().get(0).percentage());
        var feed = service.communityFeed(voter, community, "LATEST", null, null, 20);
        assertInstanceOf(PollResponse.class, feed.items().get(0).payload().get("poll"));
    }

    @Test
    void preVoteEditingPreservesIdsAndPoliciesLockAfterVoting() {
        PollResponse created = create();
        List<UUID> originalIds = created.options().stream().map(o -> o.id()).toList();
        PollResponse edited = service.updatePoll(author, created.postId(), "Edited",
                List.of("First", "Second", "Third", "Fourth"), 12, null,
                true, true, true, false, "IMMEDIATE");
        assertEquals("Edited", edited.question());
        assertEquals(4, edited.options().size());
        assertEquals(originalIds, edited.options().subList(0, 3).stream()
                .map(o -> o.id()).toList());
        assertTrue(edited.allowMultiple());
        assertTrue(edited.anonymousVoting() == false);

        service.vote(voter, edited.options().get(0).id(), false);
        assertEquals(HttpStatus.CONFLICT, failure(() -> service.updatePoll(author,
                created.postId(), null, List.of("No", "Change"), null, null,
                null, null, null, null, null)).getStatusCode());
        assertEquals(HttpStatus.CONFLICT, failure(() -> service.updatePoll(author,
                created.postId(), null, null, null, null, false,
                null, null, null, null)).getStatusCode());
        PollResponse questionOnly = service.updatePoll(author, created.postId(),
                "Question remains editable", null, null, null, null,
                null, null, null, null);
        assertEquals("Question remains editable", questionOnly.question());
        assertEquals("Trimmed parent question", service.updatePost(author,
                created.postId(), null, "  Trimmed parent question  ", null).body());
        assertEquals(HttpStatus.BAD_REQUEST, failure(() -> service.updatePost(author,
                created.postId(), null, "   ", null)).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST, failure(() -> service.updatePost(author,
                created.postId(), null, "x".repeat(20_001), null)).getStatusCode());
    }

    @Test
    void singleChoiceChangesAreAtomicAndIndependentOfWithdrawal() {
        PollResponse created = create(false, true, false, "IMMEDIATE");
        UUID first = created.options().get(0).id();
        UUID second = created.options().get(1).id();
        service.vote(voter, first, false);
        PollResponse changed = service.vote(voter, second, false);
        assertEquals(List.of(second), changed.myVotes());
        assertEquals(1L, changed.totalVotes());
        assertEquals(HttpStatus.CONFLICT,
                failure(() -> service.vote(voter, second, true)).getStatusCode());
    }

    @Test
    void multipleChoiceUsesDistinctVotersForTotalsAndPercentages() {
        PollResponse created = create(true, false, true, "IMMEDIATE");
        UUID first = created.options().get(0).id();
        UUID second = created.options().get(1).id();
        service.vote(voter, first, false);
        service.vote(voter, second, false);
        PollResponse results = service.vote(other, first, false);
        assertEquals(2L, results.totalVoters());
        assertEquals(3L, results.totalVotes());
        assertEquals(new BigDecimal("100.0"), results.options().get(0).percentage());
        assertEquals(new BigDecimal("50.0"), results.options().get(1).percentage());
        PollResponse withdrawn = service.vote(voter, second, true);
        assertEquals(2L, withdrawn.totalVoters());
        assertEquals(2L, withdrawn.totalVotes());
        assertFalse(withdrawn.myVotes().contains(second));
    }

    @Test
    void visibilityAppliesToCreatorsAndExpiryUsesDatabaseState() {
        PollResponse created = create(false, false, false, "AFTER_VOTING");
        service.vote(voter, created.options().get(0).id(), false);
        assertTrue(service.poll(created.postId(), voter).resultsVisible());
        PollResponse creatorView = service.poll(created.postId(), author);
        assertFalse(creatorView.resultsVisible());
        assertNull(creatorView.totalVoters());
        assertNull(creatorView.options().get(0).voteCount());
        assertNull(creatorView.options().get(0).percentage());

        PollResponse closing = create(false, false, false, "AFTER_CLOSE");
        assertFalse(service.poll(closing.postId(), author).resultsVisible());
        jdbc.update("UPDATE feed_polls SET created_at=now()-interval '2 hours',"
                + "closes_at=now()-interval '1 hour' WHERE post_id=?", closing.postId());
        PollResponse expired = service.poll(closing.postId(), author);
        assertEquals(PollRules.Status.EXPIRED, expired.status());
        assertTrue(expired.resultsVisible());
        assertEquals(0L, expired.totalVotes());
        assertEquals(HttpStatus.CONFLICT, failure(() -> service.vote(voter,
                closing.options().get(0).id(), false)).getStatusCode());
    }

    @Test
    void earlyCloseIsIdempotentAndTerminal() {
        PollResponse created = create();
        PollResponse closed = service.closePoll(author, created.postId());
        assertEquals(PollRules.Status.CLOSED, closed.status());
        assertEquals(closed.closedAt(), service.closePoll(author, created.postId()).closedAt());
        assertEquals(HttpStatus.CONFLICT, failure(() -> service.vote(voter,
                created.options().get(0).id(), false)).getStatusCode());
        assertEquals(HttpStatus.CONFLICT, failure(() -> service.updatePoll(author,
                created.postId(), null, null, null,
                java.time.Instant.now().plusSeconds(3600), null, null,
                null, null, null)).getStatusCode());
        service.deletePost(author, created.postId());
        assertEquals(HttpStatus.NOT_FOUND,
                failure(() -> service.poll(created.postId(), author)).getStatusCode());
    }

    @Test
    void membershipLossDeniesAccessAndRejoinRestoresOwnVotes() {
        PollResponse created = create(false, false, false, "IMMEDIATE");
        UUID option = created.options().get(0).id();
        service.vote(voter, option, false);
        jdbc.update("UPDATE community_memberships SET status='LEFT'"
                + " WHERE user_id=? AND community_id=?", voter, community);
        assertEquals(HttpStatus.FORBIDDEN,
                failure(() -> service.poll(created.postId(), voter)).getStatusCode());
        assertEquals(HttpStatus.FORBIDDEN,
                failure(() -> service.vote(voter, option, false)).getStatusCode());
        jdbc.update("UPDATE community_memberships SET status='ACTIVE'"
                + " WHERE user_id=? AND community_id=?", voter, community);
        assertEquals(List.of(option), service.poll(created.postId(), voter).myVotes());
    }

    @Test
    void reportsUseSharedFeedPostModerationAndRejectDuplicates() {
        PollResponse created = create();
        UUID report = service.reportPost(other, created.postId(), "SPAM", "details");
        assertEquals("FEED_POST", jdbc.queryForObject(
                "SELECT target_type::text FROM reports WHERE id=?", String.class, report));
        assertEquals(HttpStatus.CONFLICT, failure(() -> service.reportPost(other,
                created.postId(), "SPAM", null)).getStatusCode());
    }

    @Test
    void configuredCreationAndNewVoteLimitsReturn429() {
        create();
        create();
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, failure(this::create).getStatusCode());
    }

    @Test
    void voteLimitDoesNotRejectIdempotentRetries() {
        PollResponse created = create(true, false, false, "IMMEDIATE");
        service.vote(voter, created.options().get(0).id(), false);
        service.vote(voter, created.options().get(1).id(), false);
        assertEquals(2, service.vote(voter, created.options().get(1).id(), false)
                .myVotes().size());
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, failure(() -> service.vote(voter,
                created.options().get(2).id(), false)).getStatusCode());
    }

    @Test
    void concurrentSingleChoiceChangesLeaveOneCurrentVote() throws Exception {
        PollResponse created = create(false, true, false, "IMMEDIATE");
        service.vote(voter, created.options().get(0).id(), false);
        var executor = Executors.newFixedThreadPool(4);
        var latch = new CountDownLatch(1);
        var futures = java.util.stream.IntStream.range(0, 4).mapToObj(i ->
                executor.submit(() -> {
                    latch.await();
                    service.vote(voter, created.options().get(1 + i % 2).id(), false);
                    return null;
                })).toList();
        latch.countDown();
        for (var future : futures) {
            future.get();
        }
        executor.shutdown();
        PollResponse response = service.poll(created.postId(), voter);
        assertEquals(1, response.myVotes().size());
        assertEquals(1L, response.totalVotes());
    }

    @Test
    void closeVersusVoteHasAConsistentFinalState() throws Exception {
        PollResponse created = create(false, false, false, "IMMEDIATE");
        var executor = Executors.newFixedThreadPool(2);
        var latch = new CountDownLatch(1);
        var voteFailed = new AtomicBoolean();
        var vote = executor.submit(() -> {
            latch.await();
            try {
                service.vote(voter, created.options().get(0).id(), false);
            } catch (ResponseStatusException e) {
                voteFailed.set(true);
            }
            return null;
        });
        var close = executor.submit(() -> {
            latch.await();
            return service.closePoll(author, created.postId());
        });
        latch.countDown();
        vote.get();
        close.get();
        executor.shutdown();
        PollResponse response = service.poll(created.postId(), voter);
        assertEquals(PollRules.Status.CLOSED, response.status());
        assertEquals(voteFailed.get() ? 0L : 1L, response.totalVotes());
        assertEquals(response.myVotes().size(), response.totalVotes().intValue());
    }

    @Test
    void httpContractUses201ValidationAndNoVoterIdentityLeakage() throws Exception {
        String body = "{\"communityId\":\"" + community + "\",\"categoryId\":\""
                + category + "\",\"question\":\"HTTP poll\",\"options\":[\"A\",\"B\"],"
                + "\"resultsVisibility\":\"IMMEDIATE\"}";
        mvc.perform(post("/api/v1/feed/polls").with(authentication(auth(author)))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.postId").isNotEmpty())
                .andExpect(jsonPath("$.maxOptions").value(10));
        mvc.perform(post("/api/v1/feed/polls").with(authentication(auth(author)))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"communityId\":\"" + community
                                + "\",\"question\":\"Missing category\",\"options\":[\"A\",\"B\"]}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/feed/polls").contentType(MediaType.APPLICATION_JSON)
                        .content(body)).andExpect(status().isUnauthorized());

        UUID postId = jdbc.queryForObject("SELECT id FROM feed_posts"
                + " WHERE post_type='POLL' ORDER BY created_at DESC LIMIT 1", UUID.class);
        PollResponse poll = service.poll(postId, author);
        service.vote(voter, poll.options().get(0).id(), false);
        String response = mvc.perform(get("/api/v1/feed/polls/{id}", postId)
                        .with(authentication(auth(author))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.options[0].voteCount").value(1))
                .andExpect(jsonPath("$.totalVoters").value(1))
                .andReturn().getResponse().getContentAsString();
        assertFalse(response.contains(voter.toString()));
    }
}
