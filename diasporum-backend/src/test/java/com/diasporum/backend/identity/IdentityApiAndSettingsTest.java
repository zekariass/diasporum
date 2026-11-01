package com.diasporum.backend.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import java.util.List;
import java.util.UUID;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;


import com.diasporum.backend.identity.internal.application.SettingsService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.context.ApplicationContext;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * IdentityApi contract + settings/privacy endpoints against a real migrated DB.
 */
@SpringBootTest
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class IdentityApiAndSettingsTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired IdentityApi api;
    @Autowired SettingsService settings;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired ApplicationContext ctx;

    @BeforeEach
    void clean() {
        jdbc.update("DELETE FROM external_identities");
        jdbc.update("DELETE FROM profiles");
    }

    private UUID user(String sub) {
        return IdentityTestSupport.provision(ctx, ISSUER, sub);
    }

    @Test
    void identityApiFindsMappingWithoutProvisioning() {
        UUID id = user("sub-api");
        var view = api.findByExternalId(ISSUER, "sub-api");
        assertTrue(view.isPresent());
        assertEquals(id, view.get().profileId());
        // lookup for an unknown identity returns empty and creates nothing
        assertTrue(api.findByExternalId(ISSUER, "nope").isEmpty());
        Integer n = jdbc.queryForObject("SELECT count(*) FROM profiles", Integer.class);
        assertEquals(1, n);
    }

    @Test
    void identityApiProfileSummaryIsPublicSafe() {
        UUID id = user("sub-sum");
        var s = api.profileSummary(id);
        assertTrue(s.isPresent());
        assertEquals("ACTIVE", s.get().accountStatus());
        assertTrue(api.profileSummary(UUID.randomUUID()).isEmpty());
    }

    @Test
    void settingsRoundTripAndValidation() {
        UUID id = user("sub-set");
        var s = settings.getSettings(id);
        assertEquals("en", s.preferredLanguageCode());
        assertEquals("SYSTEM", s.theme());
        var up = settings.updateSettings(id,
                new com.diasporum.backend.identity.internal.api.rest.UpdateSettingsRequest(
                        "DARK", "pt", null, null));
        assertEquals("DARK", up.theme());
        assertEquals("pt", up.preferredLanguageCode());
        assertThrows(org.springframework.web.server.ResponseStatusException.class,
                () -> settings.updateSettings(id,
                        new com.diasporum.backend.identity.internal.api.rest.UpdateSettingsRequest(
                                null, null, UUID.randomUUID(), null)));
    }

    @Test
    void privacySettingsRoundTrip() {
        UUID id = user("sub-priv");
        var p = settings.getPrivacySettings(id);
        assertEquals(true, p.profileDiscoverable());
        assertEquals("INTERACTED_USERS", p.dmPermission());
        var up = settings.updatePrivacySettings(id,
                new com.diasporum.backend.identity.internal.api.rest.UpdatePrivacySettingsRequest(
                        false, null, null, null, null, null, "NONE", null, null));
        assertEquals(false, up.profileDiscoverable());
        assertEquals("NONE", up.dmPermission());
    }

    @Test
    void httpEndpointsServeOwnSettingsOnly() throws Exception {
        String sub = "sub-http-set";
        UUID id = user(sub);
        mvc.perform(get("/api/v1/me/settings").with(authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(id, UUID.randomUUID(), "test@test.com", List.of()), null, List.of()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.theme").value("SYSTEM"));
        mvc.perform(patch("/api/v1/me/settings").with(authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(id, UUID.randomUUID(), "test@test.com", List.of()), null, List.of())))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"theme\":\"DARK\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.theme").value("DARK"));
        mvc.perform(get("/api/v1/me/privacy-settings").with(authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(id, UUID.randomUUID(), "test@test.com", List.of()), null, List.of()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dmPermission").value("INTERACTED_USERS"));
        // invalid enum rejected
        mvc.perform(patch("/api/v1/me/privacy-settings").with(authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(id, UUID.randomUUID(), "test@test.com", List.of()), null, List.of())))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"dmPermission\":\"HACKED\"}"))
                .andExpect(status().isBadRequest());
        // unknown/protected field rejected
        mvc.perform(patch("/api/v1/me/settings").with(authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(id, UUID.randomUUID(), "test@test.com", List.of()), null, List.of())))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\":\"x\"}"))
                .andExpect(status().isBadRequest());
        // malformed value for a whitelisted key → 400, not 500
        mvc.perform(patch("/api/v1/me/settings").with(authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(id, UUID.randomUUID(), "test@test.com", List.of()), null, List.of())))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"activeCommunityId\":\"not-a-uuid\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(patch("/api/v1/me/profile").with(authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(id, UUID.randomUUID(), "test@test.com", List.of()), null, List.of())))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"dateOfBirth\":\"not-a-date\"}"))
                .andExpect(status().isBadRequest());
        // unauthenticated
        mvc.perform(get("/api/v1/me/settings")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/me/privacy-settings")).andExpect(status().isUnauthorized());
    }
}
