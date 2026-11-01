package com.diasporum.backend.messaging;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.messaging.internal.application.MessagingService;
import com.diasporum.backend.messaging.internal.application.MessagingService.CreateConversationCommand;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * M2 messaging policy tests — rate limits, request-spam cap, decline
 * cooldown, structured context errors and quota race safety. Runs under
 * deliberately tight limits via {@link TestPropertySource}; production
 * defaults live in application.yaml.
 */
@SpringBootTest
@Testcontainers
@TestPropertySource(properties = {
        "diasporum.messaging.create-per-hour=3",
        "diasporum.messaging.create-per-day=50",
        "diasporum.messaging.send-per-minute=3",
        "diasporum.messaging.max-pending-requests=2",
        "diasporum.messaging.decline-cooldown=PT1H"})
class MessagingPolicyIntegrationTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired MessagingService service;
    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;

    private UUID u1, u2, u3, u4;

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

    private UUID makeBusiness(UUID creator, String name) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO business_accounts(id,account_name,"
                + "created_by_user_id,updated_by_user_id) VALUES(?,?,?,?)",
                id, name, creator, creator);
        return id;
    }

    @BeforeEach
    void clean() {
        // Category links of published jobs are immutable to row-level DELETE
        // — TRUNCATE bypasses the row trigger for fixture cleanup.
        jdbc.execute("TRUNCATE job_listing_categories, job_listings CASCADE");
        for (String t : new String[]{"direct_messages", "message_requests",
                "direct_conversations", "outbox_events",
                "user_follows", "user_blocks", "user_mutes",
                "user_privacy_settings", "external_identities", "profiles"}) {
            jdbc.update("DELETE FROM " + t);
        }
        jdbc.update("UPDATE business_accounts SET status='CLOSED'"
                + " WHERE status<>'CLOSED'");
        u1 = user("p1");
        u2 = user("p2");
        u3 = user("p3");
        u4 = user("p4");
        jdbc.update("INSERT INTO user_privacy_settings(user_id)"
                + " SELECT id FROM profiles ON CONFLICT DO NOTHING");
    }

    // =================== rate limits ===================

    @Test
    void conversationCreateRateLimitPerHour() {
        // EVERYONE recipients → ACCEPTED — the pending-request cap can't
        // interfere with the create-window test.
        for (UUID r : new UUID[]{u2, u3, u4}) {
            allowAll(r);
        }
        service.createConversation(u1, general(u2));
        service.createConversation(u1, general(u3));
        service.createConversation(u1, general(u4));
        var e = assertThrows(ResponseStatusException.class,
                () -> service.createConversation(u1, general(user("p5"))));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, e.getStatusCode());
        assertEquals("CONVERSATION_CREATE_RATE_LIMIT", e.getReason());
        // Reusing an existing conversation is free — not counted.
        service.createConversation(u1, general(u2));
    }

    @Test
    void sendMessageRateLimit() {
        allowAll(u2);
        var c = service.createConversation(u1, general(u2));
        service.sendMessage(u1, c.id(), "m1", null, null);
        service.sendMessage(u1, c.id(), "m2", null, null);
        service.sendMessage(u1, c.id(), "m3", null, null);
        var e = assertThrows(ResponseStatusException.class,
                () -> service.sendMessage(u1, c.id(), "m4", null, null));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, e.getStatusCode());
        assertEquals("MESSAGE_SEND_RATE_LIMIT", e.getReason());
        // Quotas key on the acting user — the recipient is unaffected.
        service.sendMessage(u2, c.id(), "fine", null, null);
    }

    @Test
    void sendQuotaIsRaceSafe() throws Exception {
        allowAll(u2);
        var c = service.createConversation(u1, general(u2));
        int attempts = 5;
        var gate = new CountDownLatch(1);
        var ok = new AtomicInteger();
        var limited = new AtomicInteger();
        var pool = Executors.newFixedThreadPool(attempts);
        try {
            var futures = new ArrayList<Future<?>>();
            for (int i = 0; i < attempts; i++) {
                int n = i;
                futures.add(pool.submit(() -> {
                    try {
                        gate.await();
                        service.sendMessage(u1, c.id(), "burst-" + n,
                                "cm-" + n, null);
                        ok.incrementAndGet();
                    } catch (ResponseStatusException ex) {
                        if (ex.getStatusCode() == HttpStatus.TOO_MANY_REQUESTS) {
                            limited.incrementAndGet();
                        } else {
                            throw ex;
                        }
                    }
                    return null;
                }));
            }
            gate.countDown();
            for (var f : futures) {
                f.get(30, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }
        // Advisory lock serialises count-then-insert → exactly the limit.
        assertEquals(3, ok.get());
        assertEquals(2, limited.get());
    }

    // =================== request spam / decline cooldown ===================

    @Test
    void pendingRequestCapStopsRequestSpam() {
        // Default-privacy strangers → every create opens REQUESTED.
        assertEquals("REQUESTED",
                service.createConversation(u1, general(u2)).status());
        assertEquals("REQUESTED",
                service.createConversation(u1, general(u3)).status());
        var e = assertThrows(ResponseStatusException.class,
                () -> service.createConversation(u1, general(u4)));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, e.getStatusCode());
        assertEquals("MESSAGE_REQUEST_LIMIT", e.getReason());
    }

    @Test
    void declineCooldownBlocksThenExpires() {
        var c = service.createConversation(u1, general(u2));
        assertEquals("REQUESTED", c.status());
        var reqId = service.incomingRequests(u2).get(0).id();
        service.respondToRequest(u2, reqId, false);           // decline

        var e = assertThrows(ResponseStatusException.class,
                () -> service.createConversation(u1, general(u2)));
        assertEquals("MESSAGE_REQUEST_COOLDOWN", e.getReason());
        assertEquals(HttpStatus.FORBIDDEN, e.getStatusCode());

        // Cooldown elapsed → re-request allowed, fresh REQUESTED + new request.
        jdbc.update("UPDATE message_requests"
                + " SET responded_at=now()-interval '2 hours' WHERE id=?", reqId);
        var v2 = service.createConversation(u1, general(u2));
        assertEquals("REQUESTED", v2.status());
        assertEquals("OUTGOING", v2.pendingRequestDirection());
        assertEquals(1, service.incomingRequests(u2).size());
    }

    @Test
    void declinedRecipientCanReengage() {
        var c = service.createConversation(u1, general(u2));
        var reqId = service.incomingRequests(u2).get(0).id();
        service.respondToRequest(u2, reqId, false);

        // The declined recipient re-engaging is an implicit accept.
        var v = service.createConversation(u2, general(u1));
        assertEquals("ACCEPTED", v.status());
        service.sendMessage(u2, v.id(), "changed my mind", null, null);
    }

    // =================== structured context errors ===================

    @Test
    void contextErrorsAreStructuredAndNonLeaky() {
        // Missing vs unpublished must be indistinguishable — no existence oracle.
        var missing = assertThrows(ResponseStatusException.class,
                () -> service.createConversation(u1, new CreateConversationCommand(
                        "PROPERTY_LISTING", UUID.randomUUID(), u2, null, null,
                        null, null)));
        assertEquals("CONTEXT_NOT_AVAILABLE", missing.getReason());
        assertEquals(HttpStatus.FORBIDDEN, missing.getStatusCode());

        UUID country = jdbc.queryForObject("SELECT id FROM countries LIMIT 1",
                UUID.class);
        UUID draftJob = UUID.randomUUID();
        jdbc.update("INSERT INTO job_listings(id,country_id,visibility_scope,"
                + "source_type,employer_name,title,description,application_url,"
                + "status,owner_user_id,posted_by_user_id)"
                + " VALUES(?,?,'COUNTRY','EMPLOYER_DIRECT',"
                + "'Acme','Dev role','desc','https://x.example.com/j',"
                + "'DRAFT',?,?)", draftJob, country, u3, u3);
        var unpublished = assertThrows(ResponseStatusException.class,
                () -> service.createConversation(u1, new CreateConversationCommand(
                        "JOB_LISTING", draftJob, u3, null, null, null, null)));
        assertEquals("CONTEXT_NOT_AVAILABLE", unpublished.getReason());
        assertEquals(missing.getStatusCode(), unpublished.getStatusCode());
    }

    @Test
    void contextConversationBindsRecipientToResourceOwner() {
        UUID country = jdbc.queryForObject("SELECT id FROM countries LIMIT 1",
                UUID.class);
        UUID job = UUID.randomUUID();
        // Publish via DRAFT → category → UPDATE — the integrity trigger
        // requires a primary category before a row may enter PUBLISHED.
        // employer_user_id is the participant the context trigger binds.
        jdbc.update("INSERT INTO job_listings(id,country_id,visibility_scope,"
                + "source_type,employer_name,title,description,application_url,"
                + "status,employer_user_id,owner_user_id,posted_by_user_id)"
                + " VALUES(?,?,'COUNTRY','EMPLOYER_DIRECT',"
                + "'Acme','Dev role','desc','https://x.example.com/j',"
                + "'DRAFT',?,?,?)", job, country, u3, u3, u3);
        jdbc.update("INSERT INTO job_listing_categories(job_id,category_id,"
                + "is_primary) SELECT ?,id,true FROM job_categories LIMIT 1",
                job);
        jdbc.update("UPDATE job_listings SET status='PUBLISHED' WHERE id=?", job);

        // Recipient that is not the resource owner → structured 400.
        var e = assertThrows(ResponseStatusException.class,
                () -> service.createConversation(u1, new CreateConversationCommand(
                        "JOB_LISTING", job, u2, null, null, null, null)));
        assertEquals("CONTEXT_RECIPIENT_MISMATCH", e.getReason());
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatusCode());

        // Correct owner → contextual conversation opens ACCEPTED.
        var v = service.createConversation(u1, new CreateConversationCommand(
                "JOB_LISTING", job, u3, null, null, null, null));
        assertEquals("ACCEPTED", v.status());
    }

    // =================== business actor identity ===================

    @Test
    void businessActorCannotBypassSendQuota() {
        allowAll(u2);
        allowAll(u3);
        UUID biz = makeBusiness(u1, "Quota Shop");
        var c1 = service.createConversation(u1, general(u2));
        service.sendMessage(u1, c1.id(), "a", null, null);
        service.sendMessage(u1, c1.id(), "b", null, null);
        service.sendMessage(u1, c1.id(), "c", null, null);
        assertEquals(HttpStatus.TOO_MANY_REQUESTS,
                assertThrows(ResponseStatusException.class,
                        () -> service.sendMessage(u1, c1.id(), "d", null, null))
                        .getStatusCode());

        // Same actor speaking as a business — quotas key on the acting user.
        var c2 = service.createConversation(u1, new CreateConversationCommand(
                "GENERAL", null, u3, null, biz, null, null));
        var e = assertThrows(ResponseStatusException.class,
                () -> service.sendMessage(u1, c2.id(), "biz", null, null));
        assertEquals("MESSAGE_SEND_RATE_LIMIT", e.getReason());
    }
}
