package com.diasporum.backend.messaging;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.messaging.internal.application.MessagingService;
import com.diasporum.backend.messaging.internal.application.MessagingService.CreateConversationCommand;
import com.diasporum.backend.messaging.internal.realtime.AblyGateway;
import com.diasporum.backend.messaging.internal.realtime.AblyGateway.AblyPublishException;
import com.diasporum.backend.messaging.internal.realtime.OutboxDispatcher;
import com.diasporum.backend.messaging.internal.realtime.RealtimeTokenService;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * M3 realtime tests — transactional outbox durability, Ably publish, retry,
 * dedupe, concurrent claiming, token authorization, read/conversation events
 * and business fan-out. Ably is a {@link MockitoBean} — no real account.
 * Poll interval is pinned to 1 h so the scheduler never races the tests;
 * each test invokes {@link OutboxDispatcher#dispatch()} directly.
 */
@SpringBootTest
@Testcontainers
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "diasporum.ably.enabled=true",
        "diasporum.messaging.outbox.poll-interval=PT1H"})
class MessagingRealtimeIntegrationTest {

    private static final String ISSUER =
            "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired MessagingService service;
    @Autowired OutboxDispatcher dispatcher;
    @Autowired RealtimeTokenService tokens;
    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;

    @MockitoBean AblyGateway ably;

    private UUID u1, u2, u3;

    private UUID user(String sub) {
        return IdentityTestSupport.provision(ctx, ISSUER, sub);
    }

    private static CreateConversationCommand general(UUID recipient) {
        return new CreateConversationCommand("GENERAL", null, recipient, null,
                null, null, null);
    }

    private void allowAll(UUID user) {
        jdbc.update("UPDATE user_privacy_settings SET dm_permission='EVERYONE'"
                + " WHERE user_id=?", user);
    }

    private UsernamePasswordAuthenticationToken auth(UUID id) {
        return new UsernamePasswordAuthenticationToken(
                new DiasporumUserPrincipal(id, UUID.randomUUID(),
                        "t@t.com", List.of()), null, List.of());
    }

    @BeforeEach
    void clean() {
        Mockito.reset(ably);
        for (String t : new String[]{"direct_messages", "message_requests",
                "direct_conversations", "outbox_events",
                "user_follows", "user_blocks", "user_mutes",
                "user_privacy_settings", "external_identities", "profiles"}) {
            jdbc.update("DELETE FROM " + t);
        }
        jdbc.update("UPDATE business_accounts SET status='CLOSED'"
                + " WHERE status<>'CLOSED'");
        // users rows are reused across tests — reset any SUSPENDED status.
        jdbc.update("UPDATE users SET account_status='ACTIVE'");
        u1 = user("r1");
        u2 = user("r2");
        u3 = user("r3");
        jdbc.update("INSERT INTO user_privacy_settings(user_id)"
                + " SELECT id FROM profiles ON CONFLICT DO NOTHING");
    }

    // =================== outbox durability ===================

    @Test
    void messageCreatedEnqueuesDurableOutboxEvent() {
        allowAll(u2);
        var c = service.createConversation(u1, general(u2));
        var msg = service.sendMessage(u1, c.id(), "hello", null, null);
        var row = jdbc.queryForMap("SELECT event_type,destination,"
                        + "published_at,attempt_count,"
                        + "payload->>'messageId' AS message_id,"
                        + "payload->>'senderId' AS sender_id,"
                        + "payload->>'sequenceNo' AS seq,"
                        + "payload->>'createdAt' AS created_at"
                        + " FROM outbox_events WHERE aggregate_id=?",
                c.id());
        assertEquals("MESSAGE_CREATED", row.get("event_type"));
        assertEquals("ABLY", row.get("destination"));
        assertNull(row.get("published_at"));
        assertEquals(0, row.get("attempt_count"));
        assertEquals(msg.id().toString(), row.get("message_id"));
        assertEquals(u1.toString(), row.get("sender_id"));
        assertEquals(String.valueOf(msg.sequenceNo()), row.get("seq"));
        assertNotNull(row.get("created_at"));
    }

    @Test
    void dispatcherPublishesToBothParticipantChannels() {
        when(ably.isUsable()).thenReturn(true);
        allowAll(u2);
        var c = service.createConversation(u1, general(u2));
        service.sendMessage(u1, c.id(), "hi", null, null);
        dispatcher.dispatch();
        verify(ably).publish(eq("user:" + u1), eq("MESSAGE_CREATED"), anyMap());
        verify(ably).publish(eq("user:" + u2), eq("MESSAGE_CREATED"), anyMap());
        assertNotNull(jdbc.queryForObject(
                "SELECT published_at FROM outbox_events"
                        + " WHERE aggregate_id=?", java.sql.Timestamp.class,
                c.id()));
    }

    @Test
    void failedPublishNeverLosesTheMessage() {
        when(ably.isUsable()).thenReturn(true);
        doThrow(new AblyPublishException("down", null))
                .when(ably).publish(anyString(), anyString(), anyMap());
        allowAll(u2);
        var c = service.createConversation(u1, general(u2));
        var msg = service.sendMessage(u1, c.id(), "safe", null, null);
        dispatcher.dispatch();
        // The durable message exists regardless of Ably.
        assertEquals(1, jdbc.queryForObject(
                "SELECT count(*) FROM direct_messages WHERE id=?",
                Integer.class, msg.id()));
        var row = jdbc.queryForMap("SELECT published_at,attempt_count,"
                        + "last_error,available_at > now() AS future"
                        + " FROM outbox_events WHERE aggregate_id=?", c.id());
        assertNull(row.get("published_at"));
        assertEquals(1, row.get("attempt_count"));
        assertTrue(String.valueOf(row.get("last_error")).contains("down"));
        assertEquals(Boolean.TRUE, row.get("future"));
    }

    @Test
    void failedEventRetriesThenPublishes() {
        when(ably.isUsable()).thenReturn(true);
        doThrow(new AblyPublishException("down", null))
                .when(ably).publish(anyString(), anyString(), anyMap());
        allowAll(u2);
        var c = service.createConversation(u1, general(u2));
        service.sendMessage(u1, c.id(), "retry", null, null);
        dispatcher.dispatch();
        assertEquals(1, jdbc.queryForObject(
                "SELECT attempt_count FROM outbox_events"
                        + " WHERE aggregate_id=?", Integer.class, c.id()));
        // Retry succeeds once the window is due again.
        Mockito.reset(ably);
        when(ably.isUsable()).thenReturn(true);
        jdbc.update("UPDATE outbox_events SET available_at=now()");
        dispatcher.dispatch();
        assertNotNull(jdbc.queryForObject(
                "SELECT published_at FROM outbox_events"
                        + " WHERE aggregate_id=?", java.sql.Timestamp.class,
                c.id()));
        verify(ably).publish(eq("user:" + u2), eq("MESSAGE_CREATED"),
                anyMap());
    }

    @Test
    void dedupeKeyPreventsDuplicateEvents() {
        allowAll(u2);
        var c = service.createConversation(u1, general(u2));
        // Same read cursor twice → one MESSAGE_READ row.
        service.markRead(u2, c.id(), null);
        service.markRead(u2, c.id(), 0L);
        int reads = jdbc.queryForObject("SELECT count(*) FROM outbox_events"
                        + " WHERE event_type='MESSAGE_READ'"
                        + " AND aggregate_id=?", Integer.class, c.id());
        assertEquals(1, reads);
    }

    @Test
    void concurrentWorkersClaimDisjointBatches() throws Exception {
        when(ably.isUsable()).thenReturn(true);
        for (int i = 0; i < 6; i++) {
            UUID r = user("cw" + i);
            allowAll(r);
            var c = service.createConversation(u1, general(r));
            service.sendMessage(u1, c.id(), "m" + i, null, null);
        }
        Set<UUID> first = new HashSet<>();
        Set<UUID> second = new HashSet<>();
        var gate = new CountDownLatch(1);
        var pool = Executors.newFixedThreadPool(2);
        try {
            var f1 = pool.submit(() -> {
                try {
                    gate.await();
                } catch (InterruptedException ignored) {
                }
                dispatcher.claimBatch().forEach(e -> first.add(e.id()));
            });
            var f2 = pool.submit(() -> {
                try {
                    gate.await();
                } catch (InterruptedException ignored) {
                }
                dispatcher.claimBatch().forEach(e -> second.add(e.id()));
            });
            gate.countDown();
            f1.get(30, TimeUnit.SECONDS);
            f2.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
        // SKIP LOCKED — no row is claimed by both workers.
        assertTrue(first.stream().noneMatch(second::contains));
        assertEquals(6, first.size() + second.size());
    }

    // =================== event types ===================

    @Test
    void markReadEnqueuesAndPublishesReadEvent() {
        when(ably.isUsable()).thenReturn(true);
        allowAll(u2);
        var c = service.createConversation(u1, general(u2));
        service.sendMessage(u1, c.id(), "seen?", null, null);
        service.markRead(u2, c.id(), null);
        dispatcher.dispatch();
        verify(ably).publish(eq("user:" + u1), eq("MESSAGE_READ"),
                org.mockito.ArgumentMatchers.argThat(d ->
                        d.get("readerId").equals(u2.toString())
                                && "1".equals(String.valueOf(
                                d.get("lastReadSeq")))));
    }

    @Test
    void requestAndAcceptEnqueueConversationUpdated() {
        when(ably.isUsable()).thenReturn(true);
        // u2 requires requests (MUTUAL_FOLLOWERS, not followed by u1).
        jdbc.update("UPDATE user_privacy_settings"
                + " SET dm_permission='MUTUAL_FOLLOWERS' WHERE user_id=?", u2);
        var c = service.createConversation(u1, general(u2));
        var reqId = jdbc.queryForObject(
                "SELECT id FROM message_requests WHERE conversation_id=?",
                UUID.class, c.id());
        var types = jdbc.queryForList(
                "SELECT payload::text FROM outbox_events"
                        + " WHERE event_type='CONVERSATION_UPDATED'"
                        + " AND aggregate_id=?", String.class, c.id());
        assertTrue(types.stream().anyMatch(p -> p.contains("REQUESTED")));
        service.respondToRequest(u2, reqId, true);
        types = jdbc.queryForList(
                "SELECT payload::text FROM outbox_events"
                        + " WHERE event_type='CONVERSATION_UPDATED'"
                        + " AND aggregate_id=?", String.class, c.id());
        assertTrue(types.stream().anyMatch(p -> p.contains("ACCEPTED")));
    }

    @Test
    void businessConversationFansOutToAllActiveMembers() {
        when(ably.isUsable()).thenReturn(true);
        allowAll(u1);
        UUID biz = UUID.randomUUID();
        // u3 owns the business; u1 is a member (not owner — see M1 notes on
        // the owner-invariant for member deletion).
        jdbc.update("INSERT INTO business_accounts(id,account_name,"
                        + "created_by_user_id,updated_by_user_id)"
                        + " VALUES(?,?,?,?)", biz, "BizCo", u3, u3);
        jdbc.update("INSERT INTO business_account_members"
                        + "(business_account_id,user_id,role_key,accepted_at)"
                        + " VALUES(?,?,'EDITOR',now())", biz, u1);
        var c = service.createConversation(u2,
                new CreateConversationCommand("GENERAL", null, null, biz,
                        null, null, null));
        service.sendMessage(u2, c.id(), "biz hello", null, null);
        dispatcher.dispatch();
        // Both owner and member receive the event on their own channels.
        verify(ably).publish(eq("user:" + u3), eq("MESSAGE_CREATED"),
                anyMap());
        verify(ably).publish(eq("user:" + u1), eq("MESSAGE_CREATED"),
                anyMap());
        verify(ably).publish(eq("user:" + u2), eq("MESSAGE_CREATED"),
                anyMap());
    }

    // =================== token auth ===================

    @Test
    void tokenRequestScopesToCallersOwnChannelOnly() {
        when(ably.isUsable()).thenReturn(true);
        when(ably.createTokenRequest(anyString(), anyString(),
                org.mockito.ArgumentMatchers.anyLong()))
                .thenAnswer(inv -> Map.of(
                        "keyName", "app.keyId",
                        "capability", inv.getArgument(1),
                        "clientId", inv.getArgument(0),
                        "ttl", inv.getArgument(2),
                        "nonce", "n", "mac", "m", "timestamp", 1L));
        Map<String, Object> tr = tokens.tokenRequest(u1);
        assertEquals(u1.toString(), tr.get("clientId"));
        String cap = String.valueOf(tr.get("capability"));
        assertTrue(cap.contains("user:" + u1));
        assertTrue(cap.contains("subscribe"));
        // No publish capability, no other channel, no wildcard.
        assertTrue(!cap.contains("publish"));
        assertTrue(!cap.contains("*"));
        assertTrue(!cap.contains(u2.toString()));
    }

    @Test
    void tokenEndpointReturnsServiceUnavailableWhenAblyNotConfigured() {
        when(ably.isUsable()).thenReturn(false);
        var e = assertThrows(ResponseStatusException.class,
                () -> tokens.tokenRequest(u1));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.getStatusCode());
        assertEquals("REALTIME_UNAVAILABLE", e.getReason());
    }

    @Test
    void tokenEndpointRequiresAuthentication() throws Exception {
        mvc.perform(post("/api/v1/realtime/token"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void tokenEndpointIssuesScopedTokenForActiveUser() throws Exception {
        when(ably.isUsable()).thenReturn(true);
        when(ably.createTokenRequest(anyString(), anyString(),
                org.mockito.ArgumentMatchers.anyLong()))
                .thenReturn(Map.of("keyName", "app.keyId",
                        "capability", "{\"user:" + u1
                                + "\":[\"subscribe\"]}",
                        "clientId", u1.toString(), "ttl", 3600000L,
                        "nonce", "n", "mac", "m", "timestamp", 1L));
        mvc.perform(post("/api/v1/realtime/token").with(authentication(auth(u1))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.clientId").value(u1.toString()))
                .andExpect(jsonPath("$.capability")
                        .value("{\"user:" + u1 + "\":[\"subscribe\"]}"));
    }

    @Test
    void suspendedUserCannotObtainToken() {
        when(ably.isUsable()).thenReturn(true);
        jdbc.update("UPDATE users SET account_status='SUSPENDED'"
                + " WHERE id=?", u1);
        var e = assertThrows(ResponseStatusException.class,
                () -> tokens.tokenRequest(u1));
        assertEquals(HttpStatus.FORBIDDEN, e.getStatusCode());
        verify(ably, never()).createTokenRequest(anyString(), anyString(),
                org.mockito.ArgumentMatchers.anyLong());
    }
}
