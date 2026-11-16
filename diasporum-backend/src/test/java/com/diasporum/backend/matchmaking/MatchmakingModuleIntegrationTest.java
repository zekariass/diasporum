package com.diasporum.backend.matchmaking;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.diasporum.backend.billing.BillingApi;
import com.diasporum.backend.community.internal.application.CommunityService;
import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.matchmaking.internal.application.CancelLikeService;
import com.diasporum.backend.matchmaking.internal.application.DiscoveryService;
import com.diasporum.backend.matchmaking.internal.application.MatchService;
import com.diasporum.backend.matchmaking.internal.application.MatchmakingPhotoService;
import com.diasporum.backend.matchmaking.internal.application.MatchmakingProfileService;
import com.diasporum.backend.matchmaking.internal.application.PreferenceService;
import com.diasporum.backend.matchmaking.internal.application.RecordSwipeService;
import com.diasporum.backend.matchmaking.internal.application.RewindSwipeService;
import com.diasporum.backend.matchmaking.internal.application.UnmatchService;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PreferenceCommand;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ProfileCommand;
import com.diasporum.backend.media.internal.infrastructure.integration.storage.StorageClient;
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
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
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

    @TestConfiguration
    static class FakeStorage {
        @Bean
        @Primary
        StorageClient storageClient() {
            var metas = new ConcurrentHashMap<String, StorageClient.ObjectMeta>();
            var bytes = new ConcurrentHashMap<String, byte[]>();
            return new StorageClient() {
                public String presignPut(String k, String ct, java.time.Duration t) {
                    metas.put(k, new StorageClient.ObjectMeta(1024, ct));
                    return "https://r2.test/put/" + k;
                }
                public String presignGet(String k, java.time.Duration t) {
                    return "https://r2.test/get/" + k;
                }
                public java.util.Optional<StorageClient.ObjectMeta> head(String k) {
                    return java.util.Optional.ofNullable(metas.get(k));
                }
                public java.util.Optional<byte[]> get(String k) {
                    return java.util.Optional.ofNullable(bytes.get(k));
                }
                public void put(String k, byte[] data, String contentType) {
                    bytes.put(k, data);
                    metas.put(k, new StorageClient.ObjectMeta(data.length, contentType));
                }
                public void delete(String k) {
                    metas.remove(k);
                    bytes.remove(k);
                }
            };
        }
    }

    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired StorageClient storage;
    @Autowired MatchmakingProfileService profiles;
    @Autowired MatchmakingPhotoService photoService;
    @Autowired PreferenceService preferences;
    @Autowired DiscoveryService discovery;
    @Autowired RecordSwipeService swipes;
    @Autowired CancelLikeService cancelLikes;
    @Autowired RewindSwipeService rewinds;
    @Autowired MatchService matches;
    @Autowired UnmatchService unmatches;
    @Autowired MessagingService messagingService;
    @Autowired ConversationMatchProjection matchProjection;
    @Autowired CommunityService communityService;
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
                + " (SELECT id FROM billing_features WHERE feature_key='MATCHMAKING_INTERACT'"
                + " OR feature_key LIKE 'EXTENDED_%')");
        jdbc.update("INSERT INTO billing_plan_entitlements(plan_id,feature_id,enabled,"
                + "quantity_limit,reset_period) SELECT p.id,f.id,true,NULL,'MONTH'"
                + " FROM billing_plans p,billing_features f WHERE p.plan_key='FREE'"
                + " AND f.feature_key='MATCHMAKING_INTERACT'");
        u1 = user("mm1");
        u2 = user("mm2");
        u3 = user("mm3");
        // Module-gated calls (requireActiveModule) need an active community:
        // onboard all three into the seeded ET→DE community — current country
        // equals the destination, so they get DEFAULT access with all modules.
        UUID origin = jdbc.queryForObject("SELECT id FROM countries WHERE iso2='ET'",
                UUID.class);
        UUID dest = jdbc.queryForObject("SELECT id FROM countries WHERE iso2='DE'",
                UUID.class);
        for (UUID u : new UUID[]{u1, u2, u3}) {
            jdbc.update("UPDATE profiles SET origin_country_id=?,"
                    + " current_country_id=? WHERE id=?", origin, dest, u);
            communityService.completeOnboarding(u);
        }
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
        seedPhoto(userId);
        preferences.replace(userId, preference());
        profiles.save(userId, profile(gender, "ACTIVE"));
    }

    /** READY original in the gallery — activation requires a primary photo. */
    private UUID seedPhoto(UUID userId) {
        UUID media = UUID.randomUUID();
        String key = "mm-test/" + media + ".png";
        try {
            storage.put(key, testPng(), "image/png");
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,object_key,"
                + "purpose,mime_type,status,size_bytes,detected_mime_type,uploaded_at)"
                + " VALUES(?,?,'test-bucket',?,'MATCHMAKING_PROFILE_PHOTO','image/png',"
                + "'READY',?,'image/png',now())", media, userId, key, 64 * 64);
        photoService.add(userId, media);
        return media;
    }

    private static ProfileCommand profile(String gender, String status) {
        return profile(gender, false, false, status);
    }

    private static ProfileCommand profile(String gender, boolean blurPhotos,
            boolean hideName, String status) {
        return new ProfileCommand(gender, null, null, null, null, null, null, null,
                false, "UNSURE", "NO", "NO", "MODERATE", 170, null, false,
                "NOT_IMPORTANT", false, blurPhotos, hideName, "Member", status);
    }

    private static byte[] testPng() throws Exception {
        var image = new java.awt.image.BufferedImage(64, 64,
                java.awt.image.BufferedImage.TYPE_INT_RGB);
        for (int x = 0; x < 64; x++) {
            for (int y = 0; y < 64; y++) {
                image.setRGB(x, y, (x * y) % 256 << 16 | (x + y) % 256);
            }
        }
        var out = new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(image, "png", out);
        return out.toByteArray();
    }

    private static PreferenceCommand preference() {
        return new PreferenceCommand(18, 110, null, false, "ANY", "ANY",
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
        profiles.save(u1, profile("FEMALE", "DRAFT"));
        assertThrows(ResponseStatusException.class,
                () -> profiles.save(u1, profile("FEMALE", "ACTIVE")));
        preferences.replace(u1, preference());
        assertThrows(ResponseStatusException.class,
                () -> profiles.save(u1, profile("FEMALE", "ACTIVE")));
        seedPhoto(u1);
        profiles.save(u1, profile("FEMALE", "ACTIVE"));
        assertEquals("ACTIVE", profiles.profile(u1).status());
        profiles.save(u1, profile("FEMALE", "PAUSED"));
        assertFalse(discoveryEligible(u1));
        profiles.delete(u1);
        assertEquals("DELETED", profiles.profile(u1).status());

        jdbc.update("UPDATE profiles SET date_of_birth=? WHERE id=?",
                Date.valueOf(LocalDate.now().minusYears(17)), u2);
        assertThrows(ResponseStatusException.class, () -> profiles.save(u2, profile("MALE", "DRAFT")));
        assertThrows(ResponseStatusException.class, () -> preferences.replace(u2, preference()));
        assertThrows(ResponseStatusException.class,
                () -> profiles.save(u2, profile("MALE", "ACTIVE")));
    }

    private boolean discoveryEligible(UUID userId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT matchmaking_user_is_eligible(?)", Boolean.class, userId));
    }

    @Test
    void reciprocalDiscoveryAndSafeRestProjection() throws Exception {
        activate(u1, "FEMALE");
        activate(u2, "MALE");
        activate(u3, "FEMALE");
        // Automatic opposite-gender discovery — u1 only ever sees MALE profiles.
        var all = discovery.discover(u1, null, 20).items();
        assertEquals(1, all.size());
        assertEquals(u2, all.get(0).userId());
        var page = discovery.discover(u1, null, 1);
        assertEquals(1, page.items().size());
        assertNull(page.nextCursor());

        preferences.replace(u1, preference());
        var compatible = discovery.discover(u1, null, 1);
        assertEquals(1, compatible.items().size());
        assertEquals(u2, compatible.items().get(0).userId());

        mvc.perform(get("/api/v1/matchmaking/discover").with(authentication(auth(u1))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].userId").value(u2.toString()))
                .andExpect(jsonPath("$.items[0].dateOfBirth").doesNotExist())
                .andExpect(jsonPath("$.items[0].addressId").doesNotExist())
                .andExpect(jsonPath("$.items[0].photoMediaId").doesNotExist())
                .andExpect(jsonPath("$.items[0].photos").isArray());
    }

    @Test
    void blurredPhotosRevealPrimaryOnIncomingLikeAndGalleryOnMatch() throws Exception {
        profiles.save(u1, profile("FEMALE", true, true, "DRAFT"));
        UUID first = seedPhoto(u1);
        UUID second = seedPhoto(u1);
        preferences.replace(u1, preference());
        profiles.save(u1, profile("FEMALE", true, true, "ACTIVE"));
        activate(u2, "MALE");
        profiles.save(u2, profile("MALE", true, true, "ACTIVE"));

        // Derivative is generated eagerly at attach, owned by the same user,
        // under a deterministic key derived from the source — never the source
        // key itself.
        String originalKey = jdbc.queryForObject(
                "SELECT object_key FROM media_objects WHERE id=?", String.class, first);
        String blurredKey = "derivatives/" + UUID.nameUUIDFromBytes(
                ("MATCHMAKING_PROFILE_BLURRED:" + originalKey)
                        .getBytes(java.nio.charset.StandardCharsets.UTF_8)) + ".jpg";
        assertNotNull(jdbc.queryForObject(
                "SELECT id FROM media_objects WHERE object_key=?"
                        + " AND purpose='MATCHMAKING_PROFILE_BLURRED' AND owner_user_id=?",
                UUID.class, blurredKey, u1));
        assertFalse(blurredKey.contains(originalKey));
        assertNotNull(javax.imageio.ImageIO.read(
                new java.io.ByteArrayInputStream(storage.get(blurredKey).orElseThrow())));

        // Discovery: blurred renditions + alias — originals never exposed.
        var card = discovery.profile(u2, u1);
        assertEquals("Member", card.displayName());
        assertFalse(card.nameRevealed());
        assertEquals("https://r2.test/get/" + blurredKey, card.photoUrl());
        assertEquals(2, card.photos().size());
        assertTrue(card.photos().stream().allMatch(p -> "BLURRED".equals(p.rendition())));
        assertTrue(card.photos().stream().allMatch(p -> p.url() != null
                && !p.url().contains(originalKey)));

        // Incoming LIKE reveals ONLY the primary photo — the rest stay blurred
        // and the hidden name stays behind the alias.
        swipes.record(u1, u2, "LIKE");
        var incoming = discovery.receivedLikes(u2, null, 20).items().getFirst();
        assertEquals("Member", incoming.displayName());
        assertEquals("https://r2.test/get/" + originalKey, incoming.photoUrl());
        assertEquals("ORIGINAL", incoming.photos().stream()
                .filter(p -> p.isPrimary()).findFirst().orElseThrow().rendition());
        assertEquals("BLURRED", incoming.photos().stream()
                .filter(p -> !p.isPrimary()).findFirst().orElseThrow().rendition());
        // The sender gains nothing in return — u2 has protected settings.
        var sentView = discovery.profile(u1, u2);
        assertEquals("Member", sentView.displayName());
        assertTrue(sentView.photos().stream().allMatch(p -> "BLURRED".equals(p.rendition())));

        // Mutual match: full name + gallery originals for both directions.
        swipes.record(u2, u1, "LIKE");
        var matchedView = discovery.profile(u2, u1);
        assertTrue(matchedView.nameRevealed());
        assertTrue(matchedView.photos().stream()
                .allMatch(p -> "ORIGINAL".equals(p.rendition())
                        && p.url().contains("mm-test/")));

        // Blur off: originals are served during normal discovery, before any
        // relationship exists.
        profiles.save(u3, profile("FEMALE", false, false, "DRAFT"));
        UUID third = seedPhoto(u3);
        preferences.replace(u3, preference());
        profiles.save(u3, profile("FEMALE", false, false, "ACTIVE"));
        String thirdKey = jdbc.queryForObject(
                "SELECT object_key FROM media_objects WHERE id=?", String.class, third);
        var visible = discovery.profile(u2, u3);
        assertEquals("https://r2.test/get/" + thirdKey, visible.photoUrl());
    }

    @Test
    void photoGalleryManagementEnforcesLimitPrimaryAndOwnership() throws Exception {
        profiles.save(u1, profile("FEMALE", "DRAFT"));
        var ids = new java.util.ArrayList<UUID>();
        for (int i = 0; i < 6; i++) {
            ids.add(seedPhoto(u1));
        }
        var view = photoService.photos(u1);
        assertEquals(6, view.photos().size());
        assertEquals(6, view.maxPhotos());
        assertTrue(view.photos().get(0).isPrimary());

        // The configured limit is enforced server-side.
        UUID extra = UUID.randomUUID();
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,object_key,"
                + "purpose,mime_type,status,uploaded_at) VALUES(?,?,'test-bucket',?,"
                + "'MATCHMAKING_PROFILE_PHOTO','image/png','READY',now())",
                extra, u1, "mm-test/" + extra);
        assertThrows(ResponseStatusException.class, () -> photoService.add(u1, extra));

        // Foreign media is rejected, even when owned by another active member.
        profiles.save(u2, profile("MALE", "DRAFT"));
        assertThrows(ResponseStatusException.class, () -> photoService.add(u2, ids.get(0)));

        // Duplicate attachments to the same profile are rejected.
        photoService.delete(u1, view.photos().get(0).id());
        assertThrows(ResponseStatusException.class, () -> photoService.add(u1, ids.get(1)));

        // Deleting the primary promotes the next photo in sort order.
        var afterDelete = photoService.photos(u1);
        assertTrue(afterDelete.photos().get(0).isPrimary());
        assertEquals(ids.get(1), afterDelete.photos().get(0).mediaId());

        // Primary selection and deterministic reorder.
        UUID targetId = afterDelete.photos().get(3).id();
        var reprioritized = photoService.setPrimary(u1, targetId);
        assertEquals(1, reprioritized.photos().stream().filter(p -> p.isPrimary()).count());
        var reorderedIds = reprioritized.photos().stream()
                .map(p -> p.id()).toList().reversed();
        var reordered = photoService.reorder(u1, reorderedIds);
        assertEquals(reorderedIds, reordered.photos().stream().map(p -> p.id()).toList());
        assertTrue(reordered.photos().stream().filter(p -> p.isPrimary())
                .findFirst().orElseThrow().id().equals(targetId));

        // The owner view returns presigned original URLs only for READY media.
        assertTrue(photoService.photos(u1).photos().stream()
                .allMatch(p -> p.url() != null && p.url().startsWith("https://r2.test/get/")));
    }

    @Test
    void cancelLikeAndLatestOnlyRewindAppendHistory() {
        activate(u1, "FEMALE");
        activate(u2, "MALE");
        activate(u3, "MALE");
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
    void mutualMatchCreatesOnlyConversationAndUnmatchClosesItWithoutLosingHistory() {
        activate(u1, "FEMALE");
        activate(u2, "MALE");
        assertFalse(swipes.record(u1, u2, "LIKE").matched());
        var result = swipes.record(u2, u1, "LIKE");
        assertTrue(result.matched());
        assertNotNull(result.conversationId());
        assertEquals(1, count("matchmaking_matches"));
        assertEquals(0, count("friendships"));
        assertEquals(0, count("user_follows"));
        assertEquals(1, count("direct_conversations"));
        assertEquals(2, count("billing_usage_records"));
        assertEquals(4, count("notifications"));
        assertFalse(social.isFriend(u1, u2));
        assertTrue(matchProjection.isMatched(result.conversationId()));

        messagingService.sendMessage(u1, result.conversationId(), "Hello before unmatch", null, null);
        jdbc.update("INSERT INTO user_follows(follower_user_id,followed_user_id) VALUES(?,?)", u1, u2);
        profiles.save(u1, profile("FEMALE", "PAUSED"));
        assertEquals(1, matches.matches(u1, null, 20).items().size());
        var detail = unmatches.unmatch(u1, result.matchId(), null);
        assertEquals("UNMATCHED", detail.status());
        assertFalse(social.isFriend(u1, u2));
        assertFalse(matchProjection.isMatched(result.conversationId()));
        assertEquals("CLOSED", jdbc.queryForObject("SELECT status::text FROM direct_conversations"
                + " WHERE id=?", String.class, result.conversationId()));
        assertThrows(ResponseStatusException.class, () -> messagingService.sendMessage(
                u1, result.conversationId(), "Should not send", null, null));
        assertEquals(1, count("direct_messages"));
        assertEquals(1, count("user_follows"));
        assertNull(detail.conversationId());
        assertTrue(matches.matches(u1, null, 20).items().isEmpty());
        int outbox = count("outbox_events");
        unmatches.unmatch(u2, result.matchId(), null);
        assertEquals(outbox, count("outbox_events"));
        assertThrows(ResponseStatusException.class, () -> swipes.record(u1, u2, "LIKE"));
    }

    @Test
    void concurrentOppositeLikesConvergeWithoutDuplicateSideEffects() throws Exception {
        activate(u1, "FEMALE");
        activate(u2, "MALE");
        var pool = Executors.newFixedThreadPool(2);
        var latch = new CountDownLatch(1);
        var first = pool.submit(() -> { latch.await(); return swipes.record(u1, u2, "LIKE"); });
        var second = pool.submit(() -> { latch.await(); return swipes.record(u2, u1, "LIKE"); });
        latch.countDown();
        assertTrue(first.get().matched() || second.get().matched());
        pool.shutdown();
        assertEquals(1, count("matchmaking_matches"));
        assertEquals(0, count("friendships"));
        assertEquals(1, count("direct_conversations"));
        assertEquals(2, count("billing_usage_records"));
        assertEquals(4, count("notifications"));
    }

    @Test
    void matchIntegrationFailureRollsBackSecondSwipeAndAllMatchSideEffects() {
        activate(u1, "FEMALE");
        activate(u2, "MALE");
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
        activate(u1, "FEMALE");
        activate(u2, "MALE");
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

        activate(u1, "FEMALE");
        activate(u2, "MALE");
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
    void eligibilityEndpointResolvesEveryEntryState() throws Exception {
        // No profile → NO_PROFILE; client shows the Dating intro screen
        mvc.perform(get("/api/v1/matchmaking/eligibility").with(authentication(auth(u1))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.eligible").value(false))
                .andExpect(jsonPath("$.reason").value("NO_PROFILE"))
                .andExpect(jsonPath("$.profileStatus").isEmpty());

        // Draft → PROFILE_INCOMPLETE; client continues setup
        profiles.save(u1, profile("FEMALE", "DRAFT"));
        mvc.perform(get("/api/v1/matchmaking/eligibility").with(authentication(auth(u1))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reason").value("PROFILE_INCOMPLETE"))
                .andExpect(jsonPath("$.profileStatus").value("DRAFT"));

        // Active + adult + opt-in + preferences → ELIGIBLE
        activate(u1, "FEMALE");
        mvc.perform(get("/api/v1/matchmaking/eligibility").with(authentication(auth(u1))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.eligible").value(true))
                .andExpect(jsonPath("$.reason").value("ELIGIBLE"))
                .andExpect(jsonPath("$.hasPreferences").value(true))
                .andExpect(jsonPath("$.adult").value(true))
                .andExpect(jsonPath("$.discoveryOptIn").value(true));

        // Opt-in off → DISCOVERY_OPT_IN_REQUIRED despite the ACTIVE profile
        jdbc.update("UPDATE user_privacy_settings SET allow_matchmaking_discovery=false"
                + " WHERE user_id=?", u1);
        mvc.perform(get("/api/v1/matchmaking/eligibility").with(authentication(auth(u1))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.eligible").value(false))
                .andExpect(jsonPath("$.reason").value("DISCOVERY_OPT_IN_REQUIRED"));
        jdbc.update("UPDATE user_privacy_settings SET allow_matchmaking_discovery=true"
                + " WHERE user_id=?", u1);

        // Paused → PROFILE_PAUSED; suspended → PROFILE_SUSPENDED; both ineligible
        profiles.save(u1, profile("FEMALE", "PAUSED"));
        mvc.perform(get("/api/v1/matchmaking/eligibility").with(authentication(auth(u1))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reason").value("PROFILE_PAUSED"));
        jdbc.update("UPDATE matchmaking_profiles SET status='SUSPENDED' WHERE user_id=?", u1);
        mvc.perform(get("/api/v1/matchmaking/eligibility").with(authentication(auth(u1))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reason").value("PROFILE_SUSPENDED"));

        // Underage → NOT_ADULT even for a completed draft
        jdbc.update("UPDATE profiles SET date_of_birth=? WHERE id=?",
                Date.valueOf(LocalDate.now().minusYears(17)), u2);
        mvc.perform(get("/api/v1/matchmaking/eligibility").with(authentication(auth(u2))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reason").value("NOT_ADULT"))
                .andExpect(jsonPath("$.adult").value(false));
    }

    @Test
    void savingBirthDateStampsAdultEligibilityConfirmation() throws Exception {
        // Provisioned user with no DOB — eligibility must route them to the
        // DOB collection form (DOB_REQUIRED), never the adults restriction.
        UUID dob = IdentityTestSupport.provision(ctx, ISSUER, "mm-dob");
        mvc.perform(get("/api/v1/matchmaking/eligibility").with(authentication(auth(dob))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reason").value("DOB_REQUIRED"))
                .andExpect(jsonPath("$.hasDateOfBirth").value(false))
                .andExpect(jsonPath("$.adult").value(false));

        // Even draft writes require confirmed adulthood.
        assertThrows(ResponseStatusException.class, () -> profiles.save(dob, profile("FEMALE", "DRAFT")));
        mvc.perform(get("/api/v1/matchmaking/eligibility").with(authentication(auth(dob))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reason").value("DOB_REQUIRED"));

        // Saving DOB through the real profile-update path stamps
        // age_eligibility_confirmed_at — required by matchmaking_account_is_adult().
        mvc.perform(patch("/api/v1/me/profile").with(authentication(auth(dob)))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"dateOfBirth\":\"1990-01-01\"}"))
                .andExpect(status().isOk());
        assertEquals(Boolean.TRUE, jdbc.queryForObject(
                "SELECT age_eligibility_confirmed_at IS NOT NULL FROM profiles WHERE id=?",
                Boolean.class, dob));
        profiles.save(dob, profile("FEMALE", "DRAFT"));
        mvc.perform(get("/api/v1/matchmaking/eligibility").with(authentication(auth(dob))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reason").value("PROFILE_INCOMPLETE"))
                .andExpect(jsonPath("$.hasDateOfBirth").value(true))
                .andExpect(jsonPath("$.adult").value(true));
    }

    @Test
    void birthDateIsOneTimeValidatedAndAgeGatedServerSide() throws Exception {
        // Under-18 submission: stored once, then permanently NOT_ADULT.
        UUID minor = IdentityTestSupport.provision(ctx, ISSUER, "mm-minor");
        mvc.perform(patch("/api/v1/me/profile").with(authentication(auth(minor)))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"dateOfBirth\":\"" + LocalDate.now().minusYears(17) + "\"}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/matchmaking/eligibility").with(authentication(auth(minor))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reason").value("NOT_ADULT"))
                .andExpect(jsonPath("$.hasDateOfBirth").value(true))
                .andExpect(jsonPath("$.adult").value(false));

        // Exactly 18 today counts — eligible on the 18th birthday itself.
        UUID adult = IdentityTestSupport.provision(ctx, ISSUER, "mm-just-18");
        mvc.perform(patch("/api/v1/me/profile").with(authentication(auth(adult)))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"dateOfBirth\":\"" + LocalDate.now().minusYears(18) + "\"}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/matchmaking/eligibility").with(authentication(auth(adult))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.adult").value(true))
                .andExpect(jsonPath("$.reason").value("NO_PROFILE"));

        // A second submission cannot overwrite the stored DOB — the atomic
        // IS NULL predicate makes the loser fail with 409, value untouched.
        mvc.perform(patch("/api/v1/me/profile").with(authentication(auth(adult)))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"dateOfBirth\":\"1980-01-01\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("DATE_OF_BIRTH_ALREADY_SET"));
        assertEquals(LocalDate.now().minusYears(18), jdbc.queryForObject(
                "SELECT date_of_birth FROM profiles WHERE id=?", LocalDate.class, adult));

        // Future dates are rejected by @Past validation — nothing is stored.
        UUID future = IdentityTestSupport.provision(ctx, ISSUER, "mm-future");
        mvc.perform(patch("/api/v1/me/profile").with(authentication(auth(future)))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"dateOfBirth\":\"" + LocalDate.now().plusDays(1) + "\"}"))
                .andExpect(status().isBadRequest());
        assertNull(jdbc.queryForObject(
                "SELECT date_of_birth FROM profiles WHERE id=?", LocalDate.class, future));

        // An under-18 account still cannot activate a Dating profile — the
        // write path enforces adult eligibility independently of the UI.
        assertThrows(ResponseStatusException.class, () -> profiles.save(minor, profile("FEMALE", "DRAFT")));
        assertThrows(ResponseStatusException.class, () -> preferences.replace(minor, preference()));
        assertThrows(ResponseStatusException.class,
                () -> profiles.save(minor, profile("FEMALE", "ACTIVE")));
    }

    @Test
    void retriesAndReversedDecisionsKeepOneCurrentStateAndAppendOnlyHistory() {
        activate(u1, "FEMALE");
        activate(u2, "MALE");
        swipes.record(u1, u2, "LIKE");
        swipes.record(u1, u2, "LIKE");
        assertEquals(1, count("billing_usage_records"));
        assertEquals(1, count("matchmaking_swipe_history"));
        assertEquals(u2, discovery.sentLikes(u1, null, 20).items().getFirst().userId());
        cancelLikes.cancel(u1, u2);
        assertEquals(u2, discovery.discover(u1, null, 20).items().getFirst().userId());
        swipes.record(u1, u2, "PASS");
        rewinds.rewind(u1);
        swipes.record(u1, u2, "LIKE");
        var matched = swipes.record(u2, u1, "LIKE");
        assertEquals(matched.matchId(), swipes.record(u2, u1, "LIKE").matchId());
        assertEquals(1, count("matchmaking_matches"));
        assertEquals(1, count("direct_conversations"));
        assertEquals(6, count("matchmaking_swipe_history"));
    }

    @Test
    void safePreviewAndMissingConfirmationAreEnforcedAcrossReadsAndChat() throws Exception {
        activate(u1, "FEMALE");
        activate(u2, "MALE");
        jdbc.update("UPDATE profiles SET bio='A real biography',city='Private City' WHERE id=?", u2);
        var preview = discovery.preview(u2);
        assertEquals("A real biography", preview.bio());
        assertTrue(preview.publicLocation() == null || !preview.publicLocation().contains("Private City"));
        assertNotNull(preview.photoUrl());
        swipes.record(u1, u2, "LIKE");
        var matched = swipes.record(u2, u1, "LIKE");
        jdbc.update("UPDATE profiles SET age_eligibility_confirmed_at=NULL WHERE id=?", u2);
        for (String path : List.of("profile", "profile/preview", "preferences", "discover", "matches", "reference-data")) {
            mvc.perform(get("/api/v1/matchmaking/" + path).with(authentication(auth(u2))))
                    .andExpect(status().isForbidden());
        }
        assertFalse(messagingService.canAccess(u1, matched.conversationId()));
        assertFalse(messagingService.canAccess(u2, matched.conversationId()));
        assertThrows(ResponseStatusException.class,
                () -> messagingService.sendMessage(u2, matched.conversationId(), "Denied", null, null));
    }

    @Test
    void staleDraftCannotOverwriteActivatedProfileAndReportsWorkAfterBlock() throws Exception {
        activate(u1, "FEMALE");
        activate(u2, "MALE");
        assertThrows(ResponseStatusException.class, () -> profiles.save(u1, profile("FEMALE", "DRAFT")));
        mvc.perform(post("/api/v1/social/blocks/{id}", u2).with(authentication(auth(u1))))
                .andExpect(status().isOk());
        assertNotNull(matches.reportProfile(u1, u2, "HARASSMENT", "Please investigate"));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM reports WHERE target_id=?",
                Integer.class, u2));
    }

    @Test
    void errorEnvelopeCarriesMachineReadableReasonCodes() throws Exception {
        // u2 has no Dating profile — discovery must 403 with the real reason code
        mvc.perform(get("/api/v1/matchmaking/discover").with(authentication(auth(u2))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MATCHMAKING_NOT_ELIGIBLE"))
                .andExpect(jsonPath("$.message").value("MATCHMAKING_NOT_ELIGIBLE"));
        mvc.perform(get("/api/v1/matchmaking/profile").with(authentication(auth(u1))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("MATCHMAKING_PROFILE_NOT_FOUND"));
    }

    @Test
    void extendedDiscoveryAndConcurrentLastLikeQuotaAreCommunityScoped() throws Exception {
        UUID passTarget = user("mm-extended-pass");
        UUID outsider = user("mm-default-outsider");
        jdbc.update("UPDATE profiles SET origin_country_id=(SELECT id FROM countries WHERE iso2='ET'),"
                + "current_country_id=(SELECT id FROM countries WHERE iso2='DE') WHERE id IN (?,?)",
                passTarget, outsider);
        communityService.completeOnboarding(passTarget);
        communityService.completeOnboarding(outsider);
        for (UUID user : new UUID[]{u1, u2, u3, passTarget, outsider}) {
            activate(user, user.equals(u1) ? "FEMALE" : "MALE");
        }

        jdbc.update("INSERT INTO countries(name,iso2,iso3) VALUES('France','FR','FRA')"
                + " ON CONFLICT(iso2) DO NOTHING");
        UUID france = jdbc.queryForObject("SELECT id FROM countries WHERE iso2='FR'", UUID.class);
        jdbc.update("INSERT INTO communities(name,slug,origin_country_id,destination_country_id)"
                + " VALUES('Matchmaking ET in FR','mm-et-in-fr',"
                + "(SELECT id FROM countries WHERE iso2='ET'),?) ON CONFLICT(slug) DO NOTHING", france);
        UUID extended = jdbc.queryForObject("SELECT id FROM communities WHERE slug='mm-et-in-fr'",
                UUID.class);
        for (UUID user : new UUID[]{u1, u2, u3, passTarget}) {
            communityService.join(user, extended);
            communityService.setActiveCommunity(user, extended);
        }

        var discovered = discovery.discover(u1, null, 20).items().stream()
                .map(item -> item.userId()).toList();
        assertEquals(3, discovered.size());
        assertTrue(discovered.containsAll(List.of(u2, u3, passTarget)));
        assertFalse(discovered.contains(outsider));
        assertEquals("MATCHMAKING_PROFILE_NOT_FOUND", assertThrows(ResponseStatusException.class,
                () -> swipes.record(u1, outsider, "LIKE")).getReason());

        jdbc.update("INSERT INTO billing_plan_entitlements(plan_id,feature_id,enabled,"
                + "quantity_limit,reset_period) SELECT p.id,f.id,true,1,'MONTH'"
                + " FROM billing_plans p,billing_features f WHERE p.plan_key='FREE'"
                + " AND f.feature_key='EXTENDED_MATCHMAKING_LIKE'"
                + " ON CONFLICT(plan_id,feature_id) DO UPDATE SET enabled=true,"
                + "quantity_limit=1,reset_period='MONTH'");
        swipes.record(u1, passTarget, "PASS");
        assertEquals(0, count("billing_usage_records"));

        try (var pool = Executors.newFixedThreadPool(2)) {
            var latch = new CountDownLatch(1);
            var first = pool.submit(() -> {
                latch.await();
                try {
                    swipes.record(u1, u2, "LIKE");
                    return u2;
                } catch (ResponseStatusException e) {
                    return e;
                }
            });
            var second = pool.submit(() -> {
                latch.await();
                try {
                    swipes.record(u1, u3, "LIKE");
                    return u3;
                } catch (ResponseStatusException e) {
                    return e;
                }
            });
            latch.countDown();
            Object firstOutcome = first.get();
            Object secondOutcome = second.get();
            assertTrue(firstOutcome instanceof UUID ^ secondOutcome instanceof UUID);
            Object denied = firstOutcome instanceof UUID ? secondOutcome : firstOutcome;
            assertTrue(denied instanceof ResponseStatusException);
            assertEquals("ENTITLEMENT_QUOTA_EXCEEDED",
                    ((ResponseStatusException) denied).getReason());
            UUID chargedTarget = firstOutcome instanceof UUID ? u2 : u3;
            swipes.record(u1, chargedTarget, "LIKE");
        }

        assertEquals(1, count("billing_usage_records"));
        assertEquals(extended, jdbc.queryForObject("SELECT target_id FROM billing_usage_records",
                UUID.class));
        assertEquals(2, count("matchmaking_swipes"));
        assertEquals(2, count("matchmaking_swipe_history"));
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM matchmaking_swipe_history"
                + " WHERE community_id=?", Integer.class, extended));
    }

    @Test
    void restEndpointsUsePrincipalAndReturnMatchIdentifiers() throws Exception {
        activate(u1, "FEMALE");
        activate(u2, "MALE");
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
