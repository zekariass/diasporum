package com.diasporum.backend.matchmaking;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.diasporum.backend.billing.BillingApi;
import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.matchmaking.internal.application.CancelLikeService;
import com.diasporum.backend.matchmaking.internal.application.DiscoveryService;
import com.diasporum.backend.matchmaking.internal.application.MatchService;
import com.diasporum.backend.matchmaking.internal.application.MatchmakingProfileService;
import com.diasporum.backend.matchmaking.internal.application.PreferenceService;
import com.diasporum.backend.matchmaking.internal.application.RecordSwipeService;
import com.diasporum.backend.matchmaking.internal.application.RewindSwipeService;
import com.diasporum.backend.matchmaking.internal.application.UnmatchService;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PreferenceCommand;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ProfileCommand;
import com.diasporum.backend.messaging.MessagingApi;
import com.diasporum.backend.messaging.internal.application.ConversationMatchProjection;
import com.diasporum.backend.messaging.internal.application.MessagingService;
import com.diasporum.backend.notifications.NotificationsApi;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import com.diasporum.backend.social.SocialApi;
import java.sql.Date;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Matchmaking workflows on the real migrated PostgreSQL/PostGIS schema. */
@SpringBootTest
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class MatchmakingModuleIntegrationTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired MatchmakingProfileService profiles;
    @Autowired PreferenceService preferences;
    @Autowired DiscoveryService discovery;
    @Autowired RecordSwipeService swipes;
    @Autowired CancelLikeService cancelLikes;
    @Autowired RewindSwipeService rewinds;
    @Autowired MatchService matches;
    @Autowired UnmatchService unmatches;
    @Autowired MessagingService messagingService;
    @Autowired ConversationMatchProjection matchProjection;
    @MockitoSpyBean SocialApi social;
    @MockitoSpyBean MessagingApi messaging;
    @MockitoSpyBean BillingApi billing;
    @MockitoSpyBean NotificationsApi notifications;

    private UUID u1, u2, u3;

    @BeforeEach
    void clean() {
        for (String table : new String[]{"direct_messages", "message_requests",
                "direct_conversations", "notifications", "outbox_events",
                "billing_usage_records", "billing_entitlement_grants", "billing_subscriptions",
                "matchmaking_swipe_history", "matchmaking_swipes", "matchmaking_matches",
                "friendships", "user_follows", "user_blocks", "user_mutes",
                "matchmaking_profiles", "user_privacy_settings", "external_identities", "profiles"}) {
            jdbc.update("DELETE FROM " + table);
        }
        jdbc.update("DELETE FROM billing_plan_entitlements WHERE feature_id IN"
                + " (SELECT id FROM billing_features WHERE feature_key='MATCHMAKING_INTERACT')");
        jdbc.update("INSERT INTO billing_plan_entitlements(plan_id,feature_id,enabled,"
                + "quantity_limit,reset_period) SELECT p.id,f.id,true,NULL,'MONTH'"
                + " FROM billing_plans p,billing_features f WHERE p.plan_key='FREE'"
                + " AND f.feature_key='MATCHMAKING_INTERACT'");
        u1 = user("mm1");
        u2 = user("mm2");
        u3 = user("mm3");
    }

    private UUID user(String subject) {
        UUID id = IdentityTestSupport.provision(ctx, ISSUER, subject);
        jdbc.update("UPDATE profiles SET date_of_birth=?,age_eligibility_confirmed_at=now()"
                + " WHERE id=?", Date.valueOf(LocalDate.of(1990, 1, 1)), id);
        jdbc.update("INSERT INTO user_privacy_settings(user_id,allow_matchmaking_discovery)"
                + " VALUES(?,true) ON CONFLICT(user_id) DO UPDATE SET"
                + " allow_matchmaking_discovery=true", id);
        return id;
    }

    private void activate(UUID userId, String gender) {
        profiles.save(userId, profile(gender, "DRAFT"));
        preferences.replace(userId, preference(List.of()));
        profiles.save(userId, profile(gender, "ACTIVE"));
    }

    private static ProfileCommand profile(String gender, String status) {
        return new ProfileCommand(gender, null, null, null, null, null, null, null,
                false, "UNSURE", "NO", "NO", "MODERATE", 170, null, false,
                "NOT_IMPORTANT", false, null, null, "VISIBLE", "HIDDEN", "Member", status);
    }

    private static PreferenceCommand preference(List<String> genders) {
        return new PreferenceCommand(18, 110, null, false, "ANY", "ANY", genders,
                List.of(), List.of());
    }

    private int count(String table) {
        Integer value = jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
        return value == null ? 0 : value;
    }

    private static UsernamePasswordAuthenticationToken auth(UUID userId) {
        return new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(userId,
                UUID.randomUUID(), userId + "@test.com", List.of()), null, List.of());
    }

    @Test
    void profileLifecycleRequiresAdultOptInAndPreferences() {
        profiles.save(u1, profile("WOMAN", "DRAFT"));
        assertThrows(ResponseStatusException.class,
                () -> profiles.save(u1, profile("WOMAN", "ACTIVE")));
        preferences.replace(u1, preference(List.of("MAN")));
        profiles.save(u1, profile("WOMAN", "ACTIVE"));
        assertEquals("ACTIVE", profiles.profile(u1).status());
        profiles.save(u1, profile("WOMAN", "PAUSED"));
        assertFalse(discoveryEligible(u1));
        profiles.delete(u1);
        assertEquals("DELETED", profiles.profile(u1).status());

        jdbc.update("UPDATE profiles SET date_of_birth=? WHERE id=?",
                Date.valueOf(LocalDate.now().minusYears(17)), u2);
        profiles.save(u2, profile("MAN", "DRAFT"));
        preferences.replace(u2, preference(List.of()));
        assertThrows(ResponseStatusException.class,
                () -> profiles.save(u2, profile("MAN", "ACTIVE")));
    }

    private boolean discoveryEligible(UUID userId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT matchmaking_user_is_eligible(?)", Boolean.class, userId));
    }

    @Test
    void reciprocalDiscoveryAndSafeRestProjection() throws Exception {
        activate(u1, "WOMAN");
        activate(u2, "MAN");
        activate(u3, "WOMAN");
        assertEquals(2, discovery.discover(u1, null, 20).items().size());
        var page = discovery.discover(u1, null, 1);
        assertEquals(1, page.items().size());
        assertNotNull(page.nextCursor());
        assertEquals(1, discovery.discover(u1, page.nextCursor(), 1).items().size());

        preferences.replace(u1, preference(List.of("MAN")));
        var compatible = discovery.discover(u1, null, 1);
        assertEquals(1, compatible.items().size());
        assertEquals(u2, compatible.items().get(0).userId());

        mvc.perform(get("/api/v1/matchmaking/discover").with(authentication(auth(u1))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].userId").value(u2.toString()))
                .andExpect(jsonPath("$.items[0].dateOfBirth").doesNotExist())
                .andExpect(jsonPath("$.items[0].addressId").doesNotExist())
                .andExpect(jsonPath("$.items[0].photoMediaId").doesNotExist());
    }

    @Test
    void cancelLikeAndLatestOnlyRewindAppendHistory() {
        activate(u1, "WOMAN");
        activate(u2, "MAN");
        activate(u3, "MAN");
        swipes.record(u1, u2, "LIKE");
        assertEquals("WITHDRAWN", cancelLikes.cancel(u1, u2).status());
        assertEquals(2, count("matchmaking_swipe_history"));
        assertThrows(ResponseStatusException.class, () -> rewinds.rewind(u1));

        swipes.record(u1, u3, "PASS");
        assertEquals("REWOUND", rewinds.rewind(u1).status());
        assertEquals(4, count("matchmaking_swipe_history"));
        assertEquals("REWOUND", jdbc.queryForObject("SELECT status::text FROM matchmaking_swipes"
                + " WHERE swiper_user_id=? AND target_user_id=?", String.class, u1, u3));
        assertThrows(ResponseStatusException.class, () -> rewinds.rewind(u1));
    }

    @Test
    void mutualMatchCreatesDurableFriendshipAndSurvivesUnmatch() {
        activate(u1, "WOMAN");
        activate(u2, "MAN");
        assertFalse(swipes.record(u1, u2, "LIKE").matched());
        var result = swipes.record(u2, u1, "LIKE");
        assertTrue(result.matched());
        assertNotNull(result.conversationId());
        assertEquals(1, count("matchmaking_matches"));
        assertEquals(1, count("friendships"));
        assertEquals(0, count("user_follows"));
        assertEquals(1, count("direct_conversations"));
        assertEquals(2, count("billing_usage_records"));
        assertEquals(4, count("notifications"));
        assertTrue(social.isFriend(u1, u2));
        assertTrue(matchProjection.isMatched(result.conversationId()));

        profiles.save(u1, profile("WOMAN", "PAUSED"));
        assertEquals(1, matches.matches(u1, null, 20).items().size());
        var detail = unmatches.unmatch(u1, result.matchId(), null);
        assertEquals("UNMATCHED", detail.status());
        assertTrue(social.isFriend(u1, u2));
        assertFalse(matchProjection.isMatched(result.conversationId()));
        assertEquals("ACCEPTED", jdbc.queryForObject("SELECT status::text FROM direct_conversations"
                + " WHERE id=?", String.class, result.conversationId()));
        messagingService.sendMessage(u1, result.conversationId(), "Still connected", null, null);
        assertEquals(1, count("direct_messages"));
        int outbox = count("outbox_events");
        unmatches.unmatch(u2, result.matchId(), null);
        assertEquals(outbox, count("outbox_events"));
        assertThrows(ResponseStatusException.class, () -> swipes.record(u1, u2, "LIKE"));
    }

    @Test
    void concurrentOppositeLikesConvergeWithoutDuplicateSideEffects() throws Exception {
        activate(u1, "WOMAN");
        activate(u2, "MAN");
        var pool = Executors.newFixedThreadPool(2);
        var latch = new CountDownLatch(1);
        var first = pool.submit(() -> { latch.await(); return swipes.record(u1, u2, "LIKE"); });
        var second = pool.submit(() -> { latch.await(); return swipes.record(u2, u1, "LIKE"); });
        latch.countDown();
        assertTrue(first.get().matched() || second.get().matched());
        pool.shutdown();
        assertEquals(1, count("matchmaking_matches"));
        assertEquals(1, count("friendships"));
        assertEquals(1, count("direct_conversations"));
        assertEquals(2, count("billing_usage_records"));
        assertEquals(4, count("notifications"));
    }

    @Test
    void matchIntegrationFailureRollsBackSecondSwipeAndAllMatchSideEffects() {
        activate(u1, "WOMAN");
        activate(u2, "MAN");
        swipes.record(u1, u2, "LIKE");
        org.mockito.Mockito.doThrow(new IllegalStateException("forced-notification-failure"))
                .when(notifications).create(org.mockito.ArgumentMatchers.argThat(
                        command -> "MATCHMAKING_MATCH".equals(command.type())));
        assertThrows(IllegalStateException.class, () -> swipes.record(u2, u1, "LIKE"));
        assertEquals(0, count("matchmaking_matches"));
        assertEquals(0, count("friendships"));
        assertEquals(0, count("direct_conversations"));
        assertEquals(1, count("billing_usage_records"));
        assertEquals(1, count("matchmaking_swipes"));
        assertEquals(1, count("notifications"));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM outbox_events"
                + " WHERE event_type='MATCHMAKING_MATCHED'", Integer.class));
    }

    @Test
    void configuredQuotaDeniesWithoutRecordingSwipe() {
        activate(u1, "WOMAN");
        activate(u2, "MAN");
        jdbc.update("UPDATE billing_plan_entitlements SET quantity_limit=0"
                + " WHERE feature_id IN (SELECT id FROM billing_features"
                + " WHERE feature_key='MATCHMAKING_INTERACT')");
        assertThrows(ResponseStatusException.class, () -> swipes.record(u1, u2, "PASS"));
        assertEquals(0, count("matchmaking_swipes"));
        assertEquals(0, count("matchmaking_swipe_history"));
        assertEquals(0, count("billing_usage_records"));
    }

    @Test
    void referenceDataIsOwnerSafeAndMatchReportsUseSharedQueue() throws Exception {
        UUID country = UUID.randomUUID();
        UUID address = UUID.randomUUID();
        jdbc.update("INSERT INTO countries(id,name,iso2,iso3) VALUES(?,?,?,?)",
                country, "Reference Testland", "ZZ", "ZZZ");
        jdbc.update("INSERT INTO addresses(id,country_id,city,latitude,longitude,owner_user_id,"
                + "visibility) VALUES(?,?,?,?,?,?,'PRIVATE')",
                address, country, "Private City", 9.01, 38.75, u1);

        mvc.perform(get("/api/v1/matchmaking/reference-data").with(authentication(auth(u1))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.genders[0].id").exists())
                .andExpect(jsonPath("$.addresses[0].id").value(address.toString()))
                .andExpect(jsonPath("$.addresses[0].label").value("Private City"))
                .andExpect(jsonPath("$.addresses[0].countryId").value(country.toString()))
                .andExpect(jsonPath("$.addresses[0].latitude").doesNotExist())
                .andExpect(jsonPath("$.addresses[0].longitude").doesNotExist());
        mvc.perform(get("/api/v1/matchmaking/reference-data").with(authentication(auth(u2))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.addresses").isEmpty());

        activate(u1, "WOMAN");
        activate(u2, "MAN");
        swipes.record(u1, u2, "LIKE");
        UUID matchId = swipes.record(u2, u1, "LIKE").matchId();
        mvc.perform(post("/api/v1/matchmaking/matches/{matchId}/report", matchId)
                        .with(authentication(auth(u1))).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"harassment\",\"details\":\"Unsafe behavior\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").exists());
        mvc.perform(post("/api/v1/matchmaking/matches/{matchId}/report", matchId)
                        .with(authentication(auth(u1))).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"HARASSMENT\"}"))
                .andExpect(status().isConflict());
        mvc.perform(post("/api/v1/matchmaking/matches/{matchId}/report", matchId)
                        .with(authentication(auth(u3))).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"SPAM\"}"))
                .andExpect(status().isNotFound());
        assertEquals("MATCHMAKING_MATCH", jdbc.queryForObject("SELECT target_type::text"
                + " FROM reports WHERE target_id=?", String.class, matchId));
    }

    @Test
    void restEndpointsUsePrincipalAndReturnMatchIdentifiers() throws Exception {
        activate(u1, "WOMAN");
        activate(u2, "MAN");
        mvc.perform(get("/api/v1/matchmaking/profile").with(authentication(auth(u1))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value(u1.toString()));
        mvc.perform(post("/api/v1/matchmaking/swipes").with(authentication(auth(u1)))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"targetUserId\":\"" + u2 + "\",\"action\":\"LIKE\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matched").value(false));
        mvc.perform(post("/api/v1/matchmaking/swipes").with(authentication(auth(u2)))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"targetUserId\":\"" + u1 + "\",\"action\":\"LIKE\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matched").value(true))
                .andExpect(jsonPath("$.matchId").exists())
                .andExpect(jsonPath("$.conversationId").exists());
        assertEquals(1, count("matchmaking_matches"));
    }
}
