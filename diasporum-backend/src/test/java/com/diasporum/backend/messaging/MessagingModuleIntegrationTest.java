package com.diasporum.backend.messaging;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi;
import com.diasporum.backend.community.internal.application.CommunityService;
import com.diasporum.backend.feed.internal.application.FeedService;
import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.messaging.internal.application.MessagingService;
import com.diasporum.backend.messaging.internal.application.MessagingService.ConversationView;
import com.diasporum.backend.messaging.internal.application.MessagingService.CreateConversationCommand;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import com.diasporum.backend.social.internal.application.SocialService;
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
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Messaging module on real migrated PostgreSQL — v10.12 direct messaging. */
@SpringBootTest
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class MessagingModuleIntegrationTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired MessagingService service;
    @Autowired MessagingApi api;
    @Autowired SocialService social;
    @Autowired CommunityService communityService;
    @Autowired FeedService feedService;
    @Autowired BusinessAccountsApi businesses;
    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;

    private UUID u1, u2, u3;
    private UUID community, category;

    private UUID user(String sub) {
        return IdentityTestSupport.provision(ctx, ISSUER, sub);
    }

    private static UsernamePasswordAuthenticationToken auth(UUID userId) {
        return new UsernamePasswordAuthenticationToken(
                new DiasporumUserPrincipal(userId, UUID.randomUUID(),
                        userId + "@test.com", List.of()), null, List.of());
    }

    private static CreateConversationCommand general(UUID recipient,
            String initialMessage) {
        return new CreateConversationCommand("GENERAL", null, recipient, null,
                null, initialMessage, null);
    }

    @BeforeEach
    void clean() {
        // Help-metadata for published posts can't be hard-deleted; a
        // soft-deleted parent post unblocks the cascade from feed_posts.
        jdbc.update("UPDATE feed_posts SET deleted_at=now()"
                + " WHERE deleted_at IS NULL");
        for (String t : new String[]{"direct_messages", "message_requests",
                "direct_conversations", "outbox_events", "user_follows",
                "user_blocks", "user_mutes", "user_privacy_settings",
                "community_help_posts", "feed_posts", "community_memberships",
                "communities", "country_category_modules", "country_categories",
                "external_identities", "profiles"}) {
            jdbc.update("DELETE FROM " + t);
        }
        // Business accounts can't be hard-deleted once memberships exist
        // (the member-audit trigger inserts a row referencing the account
        // mid-cascade) — close them so stale memberships go inactive.
        jdbc.update("UPDATE business_accounts SET status='CLOSED'"
                + " WHERE status<>'CLOSED'");
        jdbc.update("INSERT INTO countries(name,iso2,iso3) SELECT"
                + " 'Ethiopia','ET','ETH' WHERE NOT EXISTS"
                + " (SELECT 1 FROM countries WHERE iso2='ET')");
        jdbc.update("INSERT INTO countries(name,iso2,iso3) SELECT"
                + " 'Germany','DE','DEU' WHERE NOT EXISTS"
                + " (SELECT 1 FROM countries WHERE iso2='DE')");
        var origin = jdbc.queryForObject(
                "SELECT id FROM countries WHERE iso2='ET'", UUID.class);
        var dest = jdbc.queryForObject(
                "SELECT id FROM countries WHERE iso2='DE'", UUID.class);
        jdbc.update("INSERT INTO communities(name,slug,origin_country_id,"
                + "destination_country_id) VALUES('ET in DE','et-in-de',?,?)",
                origin, dest);
        community = jdbc.queryForObject("SELECT id FROM communities",
                UUID.class);
        jdbc.update("INSERT INTO country_categories(id,country_id,name,slug)"
                + " VALUES(gen_random_uuid(),?,'General','general')", dest);
        category = jdbc.queryForObject("SELECT id FROM country_categories",
                UUID.class);
        jdbc.update("INSERT INTO country_category_modules(category_id,"
                + "module_key) VALUES(?,'FEED'),(?,'COMMUNITY_HELP')",
                category, category);
        u1 = user("m1");
        u2 = user("m2");
        u3 = user("m3");
        for (UUID u : new UUID[]{u1, u2, u3}) {
            jdbc.update("UPDATE profiles SET origin_country_id=?,"
                    + " current_country_id=? WHERE id=?", origin, dest, u);
            communityService.join(u, community);
        }
        // default privacy rows (trigger-created in prod; created here as the
        // fixture wiped the table).
        jdbc.update("INSERT INTO user_privacy_settings(user_id)"
                + " SELECT id FROM profiles ON CONFLICT DO NOTHING");
    }

    private void setDmPermission(UUID user, String permission,
            boolean allowRequests) {
        jdbc.update("UPDATE user_privacy_settings SET dm_permission=?,"
                + " allow_message_requests=? WHERE user_id=?",
                permission, allowRequests, user);
    }

    // =================== GENERAL request/accept lifecycle ===================

    @Test
    void requestAcceptSendFlow() {
        // u2 default INTERACTED_USERS; u1 is a stranger → REQUESTED + request.
        var v = service.createConversation(u1, general(u2, "hi there"));
        assertEquals("REQUESTED", v.status());
        assertEquals("OUTGOING", v.pendingRequestDirection());
        assertNotEquals(null, v.pendingRequestId());
        assertEquals(1, v.lastMessageSeq());            // one initial message

        // Exactly one initial message while REQUESTED.
        assertThrows(ResponseStatusException.class,
                () -> service.sendMessage(u1, v.id(), "second", null, null));
        // Recipient cannot reply until accepted.
        assertThrows(ResponseStatusException.class,
                () -> service.sendMessage(u2, v.id(), "reply", null, null));

        // Recipient sees the incoming request; sender does not.
        var requests = service.incomingRequests(u2);
        assertEquals(1, requests.size());
        assertEquals("hi there", requests.get(0).initialMessage());
        assertEquals(0, service.incomingRequests(u1).size());

        service.respondToRequest(u2, requests.get(0).id(), true);
        var c = service.conversations(u1, null, 10, false).items().get(0);
        assertEquals("ACCEPTED", c.status());

        var m2 = service.sendMessage(u2, v.id(), "hello back", null, null);
        var m3 = service.sendMessage(u1, v.id(), "great", null, null);
        assertEquals(2, m2.sequenceNo());
        assertEquals(3, m3.sequenceNo());

        // u1 has one unread (u2's message; own message excluded).
        var unread = service.unreadCount(u1);
        assertEquals(1, unread.messages());
        service.markRead(u1, v.id(), null);
        assertEquals(0, service.unreadCount(u1).messages());

        // History newest-first with cursor pagination.
        var page = service.messages(u1, v.id(), null, 2);
        assertEquals(2, page.items().size());
        assertEquals(3, page.items().get(0).sequenceNo());
        var older = service.messages(u1, v.id(),
                Long.parseLong(page.nextCursor()), 2);
        assertEquals(1, older.items().size());
        assertNull(older.nextCursor());
    }

    @Test
    void declineBlocksConversation() {
        var v = service.createConversation(u1, general(u2, "please"));
        var req = service.incomingRequests(u2).get(0);
        service.respondToRequest(u2, req.id(), false);
        var c = service.conversations(u1, null, 10, false);
        assertEquals(0, c.items().size());              // DECLINED hidden
        assertThrows(ResponseStatusException.class,
                () -> service.sendMessage(u1, v.id(), "more", null, null));
        assertThrows(ResponseStatusException.class,
                () -> service.sendMessage(u2, v.id(), "more", null, null));
    }

    // =================== uniqueness / reuse ===================

    @Test
    void conversationReusedForSamePairAndContext() {
        var first = service.createConversation(u1, general(u2, "one"));
        var second = service.createConversation(u2, general(u1, null));
        assertEquals(first.id(), second.id());
        assertEquals(1, countConversations());
    }

    private int countConversations() {
        Integer n = jdbc.queryForObject(
                "SELECT count(*) FROM direct_conversations", Integer.class);
        return n == null ? 0 : n;
    }

    // =================== privacy policy ===================

    @Test
    void everyonePermissionStartsAccepted() {
        setDmPermission(u2, "EVERYONE", true);
        var v = service.createConversation(u1, general(u2, null));
        assertEquals("ACCEPTED", v.status());
        assertNull(v.pendingRequestId());
        var m = service.sendMessage(u1, v.id(), "direct", null, null);
        assertEquals(1, m.sequenceNo());
    }

    @Test
    void mutualFollowersDirectVsStrangerRequest() {
        setDmPermission(u3, "MUTUAL_FOLLOWERS", true);
        // one-way follow is not enough
        social.follow(u1, u3);
        var req = service.createConversation(u1, general(u3, "knock"));
        assertEquals("REQUESTED", req.status());
        // mutual follow → direct ACCEPTED (fresh pair so no REQUESTED reuse)
        social.follow(u2, u3);
        social.follow(u3, u2);
        var v = service.createConversation(u2, general(u3, "hi"));
        assertEquals("ACCEPTED", v.status());
    }

    @Test
    void communityMembersPermission() {
        setDmPermission(u2, "COMMUNITY_MEMBERS", true);
        var v = service.createConversation(u1, general(u2, "hi"));
        assertEquals("ACCEPTED", v.status());           // same community
    }

    @Test
    void nonePermissionRejects() {
        setDmPermission(u2, "NONE", true);
        assertThrows(ResponseStatusException.class,
                () -> service.createConversation(u1, general(u2, null)));
    }

    @Test
    void requestsDisabledRejectsRequest() {
        setDmPermission(u2, "INTERACTED_USERS", false);
        assertThrows(ResponseStatusException.class,
                () -> service.createConversation(u1, general(u2, null)));
    }

    // =================== blocks ===================

    @Test
    void blockPreventsCreationAndSending() {
        social.block(u2, u1);
        assertThrows(ResponseStatusException.class,
                () -> service.createConversation(u1, general(u2, null)));
        social.unblock(u2, u1);

        setDmPermission(u2, "EVERYONE", true);
        var v = service.createConversation(u1, general(u2, null));
        social.block(u1, u2);
        assertThrows(ResponseStatusException.class,
                () -> service.sendMessage(u1, v.id(), "x", null, null));
    }

    // =================== participant authorization ===================

    @Test
    void nonParticipantCannotAccess() {
        setDmPermission(u2, "EVERYONE", true);
        var v = service.createConversation(u1, general(u2, null));
        assertThrows(ResponseStatusException.class,
                () -> service.conversationDetail(u3, v.id()));
        assertThrows(ResponseStatusException.class,
                () -> service.messages(u3, v.id(), null, 10));
        assertThrows(ResponseStatusException.class,
                () -> service.sendMessage(u3, v.id(), "sneak", null, null));
        assertThrows(ResponseStatusException.class,
                () -> service.markRead(u3, v.id(), null));
        assertFalse(api.canAccess(u3, v.id()));
        assertTrue(api.canAccess(u1, v.id()));
    }

    @Test
    void strangerCannotRespondToRequest() {
        var v = service.createConversation(u1, general(u2, "hey"));
        var req = service.incomingRequests(u2).get(0);
        assertThrows(ResponseStatusException.class,
                () -> service.respondToRequest(u3, req.id(), true));
    }

    // =================== read cursor / unread ===================

    @Test
    void readCursorMonotonicAndClamped() {
        setDmPermission(u2, "EVERYONE", true);
        var v = service.createConversation(u1, general(u2, null));
        service.sendMessage(u1, v.id(), "a", null, null);
        service.sendMessage(u1, v.id(), "b", null, null);
        // beyond last seq → clamped to last_message_seq
        var r = service.markRead(u2, v.id(), 99L);
        assertEquals(2L, r.get("lastReadSeq"));
        // backwards → rejected by trigger → 400
        assertThrows(ResponseStatusException.class,
                () -> service.markRead(u2, v.id(), 1L));
        assertEquals(0, service.unreadCount(u2).messages());
    }

    // =================== idempotency / delete ===================

    @Test
    void clientMessageIdIsIdempotent() {
        setDmPermission(u2, "EVERYONE", true);
        var v = service.createConversation(u1, general(u2, null));
        var m1 = service.sendMessage(u1, v.id(), "hi", "cm-1", null);
        var m2 = service.sendMessage(u1, v.id(), "hi", "cm-1", null);
        assertEquals(m1.id(), m2.id());
        Integer n = jdbc.queryForObject(
                "SELECT count(*) FROM direct_messages WHERE conversation_id=?",
                Integer.class, v.id());
        assertEquals(1, n);
    }

    @Test
    void deleteOwnMessageUpdatesPreview() {
        setDmPermission(u2, "EVERYONE", true);
        var v = service.createConversation(u1, general(u2, null));
        var m = service.sendMessage(u1, v.id(), "secret", null, null);
        assertThrows(ResponseStatusException.class,
                () -> service.deleteMessage(u2, v.id(), m.id()));
        service.deleteMessage(u1, v.id(), m.id());
        var c = service.conversations(u1, null, 10, false).items().get(0);
        assertEquals("[Message removed]", c.lastMessagePreview());
        assertEquals(0, service.messages(u1, v.id(), null, 10).items().size());
    }

    // =================== module API (matchmaking path) ===================

    @Test
    void ensureAcceptedGeneralConversationBypassesRequest() {
        UUID id = api.ensureAcceptedGeneralConversation(u1, u2);
        assertEquals(id, api.ensureAcceptedGeneralConversation(u2, u1)); // reuse
        var c = service.conversations(u1, null, 10, false).items().get(0);
        assertEquals("ACCEPTED", c.status());
        var m = service.sendMessage(u2, id, "match!", null, null);
        assertEquals(1, m.sequenceNo());
    }

    // =================== context conversations ===================

    @Test
    void communityHelpPostContext() {
        var h = feedService.createHelpPost(u2, community, category,
                "REQUEST", "Need boxes", "moving next week", null);
        var postRow = (FeedService.PostRow) h.get("post");
        var cmd = new CreateConversationCommand("COMMUNITY_HELP_POST",
                postRow.id(), null, null, null, "I can help", null);
        var v = service.createConversation(u1, cmd);
        assertEquals("ACCEPTED", v.status());           // context → direct
        assertEquals(u2, v.other().userId());           // author resolved
        var m = service.messages(u2, v.id(), null, 5);
        assertEquals("I can help", m.items().get(0).body());
        // Author cannot start a conversation with themselves on their own post
        assertThrows(ResponseStatusException.class,
                () -> service.createConversation(u2, cmd));
        // Close the post → new conversations rejected, existing still sendable
        feedService.setHelpStatus(u2, postRow.id(), "CLOSED");
        assertThrows(ResponseStatusException.class,
                () -> service.createConversation(u3,
                        new CreateConversationCommand("COMMUNITY_HELP_POST",
                                postRow.id(), null, null, null, null, null)));
        service.sendMessage(u2, v.id(), "thanks", null, null);
    }

    @Test
    void unsupportedContextResourceRejected() {
        // PROPERTY_LISTING has no listings yet — the schema trigger validates
        // the resource; nonexistent target surfaces as a clean rejection.
        assertThrows(ResponseStatusException.class,
                () -> service.createConversation(u1,
                        new CreateConversationCommand("PROPERTY_LISTING",
                                UUID.randomUUID(), u2, null, null, null,
                                null)));
    }

    // =================== business participants ===================

    private UUID makeBusiness(UUID creator, String name) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO business_accounts(id,account_name,"
                + "created_by_user_id,updated_by_user_id) VALUES(?,?,?,?)",
                id, name, creator, creator);
        return id;
    }

    @Test
    void userToBusinessConversation() {
        UUID biz = makeBusiness(u1, "Test Shop");
        assertTrue(businesses.isActiveMember(u1, biz));

        // u2 (stranger) contacts the business → ACCEPTED (businesses have no
        // personal dm_permission).
        var v = service.createConversation(u2,
                new CreateConversationCommand("GENERAL", null, null, biz,
                        null, "do you deliver?", null));
        assertEquals("ACCEPTED", v.status());
        assertTrue(v.other().business());
        assertEquals(biz, v.other().businessAccountId());
        assertEquals("Test Shop", v.other().displayName());

        // Owner u1 sees it in the business inbox and replies AS the business.
        var inbox = service.conversations(u1, null, 10, false);
        assertEquals(1, inbox.items().size());
        assertEquals("do you deliver?", inbox.items().get(0).lastMessagePreview());
        var reply = service.sendMessage(u1, v.id(), "yes we do", null, null);
        assertEquals(biz, reply.senderBusinessAccountId());
        assertEquals(u1, reply.senderId());

        // u2 sees one unread (the business reply).
        assertEquals(1, service.unreadCount(u2).messages());
    }

    @Test
    void businessActingSideAndRevokedMember() {
        // u3 owns the business; u1 is an accepted EDITOR (any active member
        // may act — revoking an EDITOR keeps the OWNER invariant intact).
        UUID biz = makeBusiness(u3, "Biz Co");
        jdbc.update("INSERT INTO business_account_members(business_account_id,"
                + "user_id,role_key,accepted_at) VALUES(?,?,'EDITOR',now())",
                biz, u1);
        setDmPermission(u2, "EVERYONE", true);

        // u1 acts as the business and messages u2 directly.
        var v = service.createConversation(u1,
                new CreateConversationCommand("GENERAL", null, u2, null, biz,
                        null, null));
        assertEquals("ACCEPTED", v.status());
        var m = service.sendMessage(u1, v.id(), "biz says hi", null, null);
        assertEquals(biz, m.senderBusinessAccountId());

        // A non-member cannot act as the business.
        UUID outsider = user("m4");
        assertThrows(ResponseStatusException.class,
                () -> service.createConversation(outsider,
                        new CreateConversationCommand("GENERAL", null, u2, null,
                                biz, null, null)));

        // Revoke u1's membership → loses access, history retained for u2.
        jdbc.update("UPDATE business_account_members SET revoked_at=now()"
                + " WHERE business_account_id=? AND user_id=?", biz, u1);
        assertThrows(ResponseStatusException.class,
                () -> service.sendMessage(u1, v.id(), "still here?", null,
                        null));
        assertFalse(api.canAccess(u1, v.id()));
        assertTrue(api.canAccess(u2, v.id()));
    }

    // =================== archive / mute ===================

    @Test
    void archiveAndMute() {
        setDmPermission(u2, "EVERYONE", true);
        var v = service.createConversation(u1, general(u2, null));
        service.setArchived(u1, v.id(), true);
        assertEquals(0, service.conversations(u1, null, 10, false)
                .items().size());
        assertEquals(1, service.conversations(u1, null, 10, true)
                .items().size());
        service.setArchived(u1, v.id(), false);
        assertEquals(1, service.conversations(u1, null, 10, false)
                .items().size());
        service.setMuted(u1, v.id(), 60);
        var c = service.conversations(u1, null, 10, false).items().get(0);
        assertNotEquals(null, c.mutedUntil());
        service.setMuted(u1, v.id(), null);
        c = service.conversations(u1, null, 10, false).items().get(0);
        assertNull(c.mutedUntil());
    }

    // =================== HTTP surface ===================

    @Test
    void httpEndpoints() throws Exception {
        setDmPermission(u2, "EVERYONE", true);
        var asU1 = authentication(auth(u1));
        var asU2 = authentication(auth(u2));

        var body = mvc.perform(post("/api/v1/conversations").with(asU1)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"recipientUserId\":\"" + u2 + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACCEPTED"))
                .andReturn().getResponse().getContentAsString();
        String id = com.jayway.jsonpath.JsonPath.read(body, "$.id");

        mvc.perform(post("/api/v1/conversations/" + id + "/messages")
                        .with(asU1).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"hello\",\"clientMessageId\":\"c1\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sequenceNo").value(1));
        // idempotent replay
        mvc.perform(post("/api/v1/conversations/" + id + "/messages")
                        .with(asU1).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"hello\",\"clientMessageId\":\"c1\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sequenceNo").value(1));

        mvc.perform(get("/api/v1/conversations/" + id + "/messages")
                        .with(asU2))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].body").value("hello"));
        mvc.perform(get("/api/v1/conversations/unread-count").with(asU2))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1));
        mvc.perform(post("/api/v1/conversations/" + id + "/read")
                        .with(asU2))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/conversations/unread-count").with(asU2))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(0));

        // unauthenticated → 401
        mvc.perform(get("/api/v1/conversations"))
                .andExpect(status().isUnauthorized());
        // non-participant → 404
        mvc.perform(get("/api/v1/conversations/" + id)
                        .with(authentication(auth(u3))))
                .andExpect(status().isNotFound());
    }

    @Test
    void pendingRequestDirectionAndUnreadCount() {
        var v = service.createConversation(u1, general(u2, "req msg"));
        // recipient inbox badge counts the pending request
        assertEquals(1, service.unreadCount(u2).pendingRequests());
        assertEquals(0, service.unreadCount(u1).pendingRequests());
        var c2 = service.conversations(u2, null, 10, false).items().get(0);
        assertEquals("INCOMING", c2.pendingRequestDirection());
        var c1 = service.conversations(u1, null, 10, false).items().get(0);
        assertEquals("OUTGOING", c1.pendingRequestDirection());
    }
}
