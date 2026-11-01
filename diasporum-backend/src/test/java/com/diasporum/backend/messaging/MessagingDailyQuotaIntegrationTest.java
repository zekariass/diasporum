package com.diasporum.backend.messaging;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.messaging.internal.application.MessagingService;
import com.diasporum.backend.messaging.internal.application.MessagingService.CreateConversationCommand;
import java.util.UUID;
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

/** Daily new-conversation quota — needs the hourly window to not bind first. */
@SpringBootTest
@Testcontainers
@TestPropertySource(properties = {
        "diasporum.messaging.create-per-hour=50",
        "diasporum.messaging.create-per-day=2"})
class MessagingDailyQuotaIntegrationTest {

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

    @BeforeEach
    void clean() {
        for (String t : new String[]{"direct_messages", "message_requests",
                "direct_conversations", "user_privacy_settings",
                "external_identities", "profiles"}) {
            jdbc.update("DELETE FROM " + t);
        }
        u1 = user("q1");
        u2 = user("q2");
        u3 = user("q3");
        u4 = user("q4");
        jdbc.update("INSERT INTO user_privacy_settings(user_id)"
                + " SELECT id FROM profiles ON CONFLICT DO NOTHING");
        for (UUID r : new UUID[]{u2, u3, u4}) {
            jdbc.update("UPDATE user_privacy_settings"
                    + " SET dm_permission='EVERYONE' WHERE user_id=?", r);
        }
    }

    @Test
    void dailyConversationQuotaIsEnforced() {
        service.createConversation(u1, general(u2));
        service.createConversation(u1, general(u3));
        var e = assertThrows(ResponseStatusException.class,
                () -> service.createConversation(u1, general(u4)));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, e.getStatusCode());
        assertEquals("CONVERSATION_DAILY_QUOTA_EXCEEDED", e.getReason());

        // Backdating yesterday's conversations frees today's quota — the
        // window is rolling 24 h, not a fixed calendar day.
        jdbc.update("UPDATE direct_conversations"
                + " SET created_at=now()-interval '25 hours'"
                + " WHERE created_by=?", u1);
        service.createConversation(u1, general(u4));
    }
}
