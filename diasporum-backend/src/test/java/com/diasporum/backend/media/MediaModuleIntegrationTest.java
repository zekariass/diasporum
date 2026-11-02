package com.diasporum.backend.media;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import java.util.List;
import java.util.UUID;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.media.internal.application.MediaService;
import com.diasporum.backend.media.internal.infrastructure.integration.storage.StorageClient;
import java.util.Map;
import java.util.UUID;
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

/** Media module on real PostgreSQL; StorageClient faked in-memory (no R2). */
@SpringBootTest(properties={"diasporum.media.r2.bucket=test-bucket","diasporum.media.r2.upload-url-ttl=PT5M","diasporum.media.r2.download-url-ttl=PT2M"})
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class MediaModuleIntegrationTest {

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
                public void delete(String k) {
                    objects.remove(k);
                }
            };
        }
    }

    @Autowired MediaApi api;
    @Autowired MediaService service;
    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;

    private UUID user(String sub) {
        return IdentityTestSupport.provision(ctx, ISSUER, sub);
    }

    private UUID u1;

    @BeforeEach
    void clean() {
        jdbc.update("DELETE FROM media_processing_jobs");
        jdbc.update("DELETE FROM media_objects");
        jdbc.update("DELETE FROM external_identities");
        jdbc.update("DELETE FROM profiles");
        u1 = user("m1");
    }

    @Test
    void initiateValidatesPurposeMimeAndSize() {
        var r = service.initiate(u1, "AVATAR", "image/png", 1000L);
        assertTrue(r.uploadUrl().contains("/put/"));
        var document = service.initiate(u1, "DOCUMENT",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                1000L);
        assertTrue(document.uploadUrl().contains("/put/"));
        assertThrows(ResponseStatusException.class,
                () -> service.initiate(u1, "NOPE", "image/png", null));
        assertThrows(ResponseStatusException.class,
                () -> service.initiate(u1, "AVATAR", "application/exe", null));
        assertThrows(ResponseStatusException.class,
                () -> service.initiate(u1, "AVATAR", "image/png",
                        26L * 1024 * 1024));
    }

    @Test
    void completeVerifiesObjectAndMarksReady() {
        var r = service.initiate(u1, "AVATAR", "image/png", 1000L);
        var a = service.complete(u1, r.assetId(), 1000L);
        assertEquals("READY", a.status());
        assertEquals(1024L, a.sizeBytes());
        assertTrue(api.isReady(r.assetId()));
        assertTrue(api.validateForAttach(r.assetId(), u1, "AVATAR"));
        // second complete is idempotent
        assertEquals("READY", service.complete(u1, r.assetId(), null).status());
        // other user cannot complete it
        assertThrows(ResponseStatusException.class,
                () -> service.complete(user("m2"), r.assetId(), null));
    }

    @Test
    void downloadUrlRequiresOwnerAndReady() {
        var r = service.initiate(u1, "AVATAR", "image/png", null);
        assertThrows(ResponseStatusException.class,
                () -> service.downloadUrl(u1, r.assetId()));   // not READY yet
        service.complete(u1, r.assetId(), null);
        assertTrue(service.downloadUrl(u1, r.assetId()).contains("/get/"));
        assertThrows(ResponseStatusException.class,
                () -> service.downloadUrl(user("m2"), r.assetId()));  // not owner
    }

    @Test
    void deleteIsOwnerOnlyAndIdempotent() {
        var r = service.initiate(u1, "AVATAR", "image/png", null);
        service.complete(u1, r.assetId(), null);
        service.delete(u1, r.assetId());
        assertEquals("DELETED", api.asset(r.assetId()).orElseThrow().status());
        service.delete(u1, r.assetId());                        // idempotent
        assertThrows(ResponseStatusException.class,
                () -> service.delete(user("m2"), r.assetId()));
    }

    @Test
    void sharedMediaLifecycleRemainsEnabledForAllConsumerPurposes() {
        var purposes = Map.of(
                "MESSAGE_IMAGE", "image/webp",
                "MESSAGE_DOCUMENT", "application/pdf",
                "JOB", "image/jpeg",
                "BUSINESS", "image/png",
                "PROPERTY", "image/webp",
                "SPARE_BAG_LISTING", "image/webp");

        for (var entry : purposes.entrySet()) {
            String purpose = entry.getKey();
            var initiated = service.initiate(u1, purpose, entry.getValue(), 1000L);
            assertTrue(initiated.uploadUrl().contains("/put/"));

            var completed = service.complete(u1, initiated.assetId(), 1000L);
            assertEquals(purpose, completed.purpose());
            assertEquals("READY", completed.status());
            assertTrue(api.validateForAttach(initiated.assetId(), u1, purpose));
            assertFalse(api.validateForAttach(initiated.assetId(), u1, "AVATAR"));
            assertTrue(service.downloadUrl(u1, initiated.assetId()).contains("/get/"));
            assertTrue(api.authorizedDownloadUrl(initiated.assetId()).contains("/get/"));

            UUID other = user("media-other-" + purpose);
            assertThrows(ResponseStatusException.class,
                    () -> service.downloadUrl(other, initiated.assetId()));
            assertThrows(ResponseStatusException.class,
                    () -> service.delete(other, initiated.assetId()));
            service.delete(u1, initiated.assetId());
            assertEquals("DELETED", api.asset(initiated.assetId()).orElseThrow().status());
        }
    }

    @Test
    void httpLifecycleWorks() throws Exception {
        var asU1 = authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(u1, UUID.randomUUID(), "m1@test.com", List.of()), null, List.of()));
        var res = mvc.perform(post("/api/v1/media/uploads").with(asU1)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"purpose\":\"AVATAR\",\"mimeType\":\"image/png\"}"))
                .andExpect(status().isOk()).andReturn().getResponse()
                .getContentAsString();
        String id = res.split("\"assetId\":\"")[1].split("\"")[0];
        mvc.perform(post("/api/v1/media/uploads/" + id + "/complete").with(asU1)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("READY"));
        mvc.perform(post("/api/v1/media/" + id + "/download-url").with(asU1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.downloadUrl").value(
                        org.hamcrest.Matchers.containsString("/get/")));
        mvc.perform(delete("/api/v1/media/" + id).with(asU1))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/media/uploads"))
                .andExpect(status().isUnauthorized());
    }
}
