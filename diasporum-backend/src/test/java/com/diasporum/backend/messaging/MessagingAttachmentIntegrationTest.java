package com.diasporum.backend.messaging;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.media.internal.infrastructure.integration.storage.StorageClient;
import com.diasporum.backend.messaging.internal.application.MessagingService;
import com.diasporum.backend.messaging.internal.application.MessagingService.CreateConversationCommand;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
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

/**
 * M4 attachment lifecycle tests: ownership, readiness, purpose, count limits,
 * transactional creation, idempotent resend, download URL authorization.
 */
@SpringBootTest
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class MessagingAttachmentIntegrationTest {

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
            return new StorageClient() {
                public String presignPut(String key, String contentType, java.time.Duration ttl) {
                    return "https://r2.test/put/" + key;
                }
                public String presignGet(String key, java.time.Duration ttl) {
                    return "https://r2.test/get/" + key;
                }
                public java.util.Optional<StorageClient.ObjectMeta> head(String key) {
                    return java.util.Optional.of(new StorageClient.ObjectMeta(1024, "image/png"));
                }
                public void delete(String key) {
                }
            };
        }
    }

    @Autowired MessagingService service;
    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;

    private UUID u1, u2;

    @BeforeEach
    void setUp() {
        u1 = user("att-u1-" + UUID.randomUUID());
        u2 = user("att-u2-" + UUID.randomUUID());
    }

    private UUID user(String sub) {
        return IdentityTestSupport.provision(ctx, ISSUER, sub);
    }

    private static UsernamePasswordAuthenticationToken auth(UUID userId) {
        return new UsernamePasswordAuthenticationToken(
                new DiasporumUserPrincipal(userId, UUID.randomUUID(),
                        userId + "@test.com", List.of()), null, List.of());
    }

    /** Creates an ACCEPTED conversation by inserting the row + accepting the
     * request - avoids the pending-request initial-message restriction. */
    private UUID createConversation(UUID actor, UUID recipient) {
        var cmd = new CreateConversationCommand(
                "GENERAL", null, recipient, null, null, "hi", null);
        var conv = service.createConversation(actor, cmd);
        // If it's still REQUESTED (new pair), accept the pending request.
        if ("REQUESTED".equals(conv.status()) && conv.pendingRequestId() != null) {
            service.respondToRequest(recipient, conv.pendingRequestId(), true);
        }
        return conv.id();
    }

    /** Insert a READY media_object owned by owner with the given purpose. */
    private UUID readyAsset(UUID owner, String purpose) {
        UUID id = UUID.randomUUID();
        String mime = "MESSAGE_IMAGE".equals(purpose) ? "image/jpeg" : "application/pdf";
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,"
                + "object_key,purpose,mime_type,status,size_bytes)"
                + " VALUES(?,?,'diasporum','key-' || ?::text,?,?,'READY',1024)",
                id, owner, id, purpose, mime);
        return id;
    }

    /** Insert a PENDING_UPLOAD asset (not complete). */
    private UUID pendingAsset(UUID owner) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,"
                + "object_key,purpose,mime_type,status,size_bytes)"
                + " VALUES(?,?,'diasporum','key-' || ?::text,'MESSAGE_IMAGE',"
                + "'image/jpeg','PENDING_UPLOAD',1024)",
                id, owner, id);
        return id;
    }

    // ── happy path ──────────────────────────────────────────────────────────

    @Test
    void sendWithImageAttachment_createsMediaMessage() {
        UUID convId = createConversation(u1, u2);
        UUID assetId = readyAsset(u1, "MESSAGE_IMAGE");

        var msg = service.sendMessage(u1, convId, null, null, null, List.of(assetId));

        assertEquals("MEDIA", msg.messageType());
        assertEquals(1, msg.attachments().size());
        assertEquals(assetId, msg.attachments().get(0).assetId());
        assertEquals("MESSAGE_IMAGE", msg.attachments().get(0).purpose());
    }

    @Test
    void sendWithDocumentAttachment_createsMediaMessage() {
        UUID convId = createConversation(u1, u2);
        UUID assetId = readyAsset(u1, "MESSAGE_DOCUMENT");

        var msg = service.sendMessage(u1, convId, null, null, null, List.of(assetId));

        assertEquals("MEDIA", msg.messageType());
        assertEquals("MESSAGE_DOCUMENT", msg.attachments().get(0).purpose());
    }

    @Test
    void sendWithBodyAndAttachment_captionIsPreserved() {
        UUID convId = createConversation(u1, u2);
        UUID assetId = readyAsset(u1, "MESSAGE_IMAGE");

        var msg = service.sendMessage(u1, convId, "look at this", null, null, List.of(assetId));

        assertEquals("MEDIA", msg.messageType());
        assertEquals("look at this", msg.body());
    }

    @Test
    void idempotentResend_doesNotDuplicate() {
        UUID convId = createConversation(u1, u2);
        UUID assetId = readyAsset(u1, "MESSAGE_IMAGE");
        String clientId = "idem-" + UUID.randomUUID();

        var first = service.sendMessage(u1, convId, null, clientId, null, List.of(assetId));
        var second = service.sendMessage(u1, convId, null, clientId, null, List.of(assetId));

        assertEquals(first.id(), second.id());
        int count = jdbc.queryForObject("SELECT count(*) FROM direct_message_media WHERE message_id=?",
                Integer.class, first.id());
        assertEquals(1, count, "attachment should not be duplicated on retry");
    }

    @Test
    void historyIncludesAttachments() {
        UUID convId = createConversation(u1, u2);
        UUID assetId = readyAsset(u1, "MESSAGE_IMAGE");
        service.sendMessage(u1, convId, null, null, null, List.of(assetId));

        var page = service.messages(u1, convId, null, 20);

        var mediaMsg = page.items().stream().filter(m -> "MEDIA".equals(m.messageType())).findFirst();
        assertTrue(mediaMsg.isPresent());
        assertFalse(mediaMsg.get().attachments().isEmpty());
        assertEquals(assetId, mediaMsg.get().attachments().get(0).assetId());
    }

    // ── authorization / validation ───────────────────────────────────────────

    @Test
    void attachmentOwnedByOtherUser_forbidden() {
        UUID convId = createConversation(u1, u2);
        UUID assetId = readyAsset(u2, "MESSAGE_IMAGE"); // owned by u2

        var ex = assertThrows(ResponseStatusException.class,
                () -> service.sendMessage(u1, convId, null, null, null, List.of(assetId)));
        assertEquals(HttpStatus.FORBIDDEN, ex.getStatusCode());
    }

    @Test
    void attachmentNotReady_badRequest() {
        UUID convId = createConversation(u1, u2);
        UUID assetId = pendingAsset(u1); // PENDING_UPLOAD

        var ex = assertThrows(ResponseStatusException.class,
                () -> service.sendMessage(u1, convId, null, null, null, List.of(assetId)));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatusCode());
        assertTrue(ex.getReason().startsWith("ATTACHMENT_NOT_READY"));
    }

    @Test
    void attachmentWrongPurpose_badRequest() {
        UUID convId = createConversation(u1, u2);
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,"
                + "object_key,purpose,mime_type,status,size_bytes)"
                + " VALUES(?,?,'diasporum','k' || ?::text,'AVATAR','image/jpeg','READY',1024)",
                id, u1, id);

        var ex = assertThrows(ResponseStatusException.class,
                () -> service.sendMessage(u1, convId, null, null, null, java.util.List.of(id)));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatusCode());
        assertTrue(ex.getReason().startsWith("ATTACHMENT_INVALID_PURPOSE"));
    }

    @Test
    void tooManyAttachments_badRequest() {
        UUID convId = createConversation(u1, u2);
        var ids = java.util.List.of(
                readyAsset(u1, "MESSAGE_IMAGE"), readyAsset(u1, "MESSAGE_IMAGE"),
                readyAsset(u1, "MESSAGE_IMAGE"), readyAsset(u1, "MESSAGE_IMAGE"),
                readyAsset(u1, "MESSAGE_IMAGE"));

        var ex = assertThrows(ResponseStatusException.class,
                () -> service.sendMessage(u1, convId, null, null, null, ids));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatusCode());
        assertEquals("TOO_MANY_ATTACHMENTS", ex.getReason());
    }

    @Test
    void nonParticipant_cannotDownloadAttachment() {
        UUID convId = createConversation(u1, u2);
        UUID assetId = readyAsset(u1, "MESSAGE_IMAGE");
        var msg = service.sendMessage(u1, convId, null, null, null, java.util.List.of(assetId));

        assertTrue(service.attachmentDownloadUrl(u2, convId, msg.id(), assetId)
                .endsWith("/get/key-" + assetId));
        UUID outsider = user("outsider-" + UUID.randomUUID());
        var ex = assertThrows(ResponseStatusException.class,
                () -> service.attachmentDownloadUrl(outsider, convId, msg.id(), assetId));
        // 404 not 403 - requireSide hides conversation existence.
        assertEquals(HttpStatus.NOT_FOUND, ex.getStatusCode());
    }

    @Test
    void conversationPresence_nonParticipant_forbidden() throws Exception {
        UUID convId = createConversation(u1, u2);
        UUID outsider = user("pr-out-" + UUID.randomUUID());
        mvc.perform(get("/api/v1/conversations/{id}/presence", convId)
                .with(authentication(auth(outsider))))
                .andExpect(status().isForbidden());
    }

    @Test
    void typingEndpoint_nonParticipant_forbidden() throws Exception {
        UUID convId = createConversation(u1, u2);
        UUID outsider = user("ty-out-" + UUID.randomUUID());
        mvc.perform(post("/api/v1/conversations/{id}/typing", convId)
                .with(authentication(auth(outsider)))
                .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .content("{\"typing\":true}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void presenceHeartbeat_returnsNoContent() throws Exception {
        mvc.perform(post("/api/v1/presence/heartbeat")
                .with(authentication(auth(u1))))
                .andExpect(status().isNoContent());
    }
}
