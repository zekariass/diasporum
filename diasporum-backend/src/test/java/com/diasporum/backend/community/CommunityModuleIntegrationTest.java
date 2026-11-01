package com.diasporum.backend.community;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import java.util.List;
import java.util.UUID;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.community.internal.application.CommunityService;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Community module on real migrated PostgreSQL. */
@SpringBootTest
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class CommunityModuleIntegrationTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired CommunityApi api;
    @Autowired CommunityService service;
    @Autowired IdentityApi identity;
    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;

    private UUID user(String sub) {
        return IdentityTestSupport.provision(ctx, ISSUER, sub);
    }

    private UUID origin, dest, community;
    private UUID u1, u2;

    @BeforeEach
    void setup() {
        for (String t : new String[]{"community_memberships", "external_identities",
                "profiles", "communities", "countries"}) {
            jdbc.update("DELETE FROM " + t);
        }
        jdbc.update("INSERT INTO countries(name,iso2,iso3) VALUES"
                + "('Ethiopia','ET','ETH'),('Germany','DE','DEU')");
        origin = jdbc.queryForObject("SELECT id FROM countries WHERE iso2='ET'",
                UUID.class);
        dest = jdbc.queryForObject("SELECT id FROM countries WHERE iso2='DE'",
                UUID.class);
        jdbc.update("INSERT INTO communities(name,slug,origin_country_id,"
                        + "destination_country_id) VALUES('ET in DE','et-in-de',?,?)",
                origin, dest);
        community = jdbc.queryForObject("SELECT id FROM communities", UUID.class);
        u1 = user("c1");
        u2 = user("c2");
        // give both profiles the matching origin country
        for (UUID u : new UUID[]{u1, u2}) {
            jdbc.update("UPDATE profiles SET origin_country_id=?,"
                    + " current_country_id=? WHERE id=?", origin, dest, u);
        }
    }

    @Test
    void joinIsIdempotentAndEligible() {
        var m = service.join(u1, community);
        assertEquals("ACTIVE", m.status());
        assertEquals("MEMBER", m.role());
        var m2 = service.join(u1, community);       // duplicate → same record
        assertEquals("ACTIVE", m2.status());
        assertEquals(1, api.activeMemberCount(community));
    }

    @Test
    void joinRejectsWrongOriginAndInactiveCommunity() {
        UUID wrong = user("c3");
        jdbc.update("UPDATE profiles SET origin_country_id=? WHERE id=?",
                dest, wrong);
        assertThrows(ResponseStatusException.class,
                () -> service.join(wrong, community));   // DB trigger would also reject
        jdbc.update("UPDATE communities SET is_active=false WHERE id=?", community);
        assertThrows(ResponseStatusException.class,
                () -> service.join(u1, community));
    }

    @Test
    void leaveRestorableAndActiveCleared() {
        service.join(u1, community);
        service.setActiveCommunity(u1, community);
        service.leave(u1, community);
        var m = api.membershipOf(u1, community).orElseThrow();
        assertEquals("LEFT", m.status());
        assertTrue(api.activeCommunityId(u1).isEmpty());   // auto-cleared
        var back = service.join(u1, community);            // re-join restores
        assertEquals("ACTIVE", back.status());
    }

    @Test
    void activeCommunityRequiresMembership() {
        assertThrows(ResponseStatusException.class,
                () -> service.setActiveCommunity(u1, community));   // not a member
        service.join(u1, community);
        service.setActiveCommunity(u1, community);
        assertEquals(community, api.activeCommunityId(u1).orElseThrow());
        service.setActiveCommunity(u1, null);                       // clear
        assertTrue(api.activeCommunityId(u1).isEmpty());
    }

    @Test
    void memberListRequiresMembershipAndCounts() {
        service.join(u1, community);
        service.join(u2, community);
        var page = service.members(u1, community, 0, 20);
        assertEquals(2, page.size());
        assertEquals(2, api.activeMemberCount(community));
        UUID outsider = user("c4");
        assertThrows(ResponseStatusException.class,
                () -> service.members(outsider, community, 0, 20));
    }

    @Test
    void roleChangesAndLastAdminProtection() {
        service.join(u1, community);
        service.join(u2, community);
        jdbc.update("UPDATE community_memberships SET role='COMMUNITY_ADMIN'"
                + " WHERE user_id=?", u1);
        assertTrue(api.isCommunityAdmin(u1, community));
        assertFalse(api.isCommunityAdmin(u2, community));
        // admin promotes u2
        service.changeRole(u1, community, u2, "MODERATOR");
        assertTrue(api.isModeratorOrAbove(u2, community));
        // demoting sole admin is blocked
        assertThrows(ResponseStatusException.class,
                () -> service.changeRole(u1, community, u1, "MEMBER"));
        // non-admin cannot change roles
        assertThrows(ResponseStatusException.class,
                () -> service.changeRole(u2, community, u1, "MEMBER"));
        // non-admin cannot remove
        assertThrows(ResponseStatusException.class,
                () -> service.removeMember(u2, community, u1));
    }

    @Test
    void httpEndpointsWork() throws Exception {
        var asU1 = authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(u1, UUID.randomUUID(), "c1@test.com", List.of()), null, List.of()));
        mvc.perform(post("/api/v1/communities/" + community + "/join").with(asU1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"));
        mvc.perform(get("/api/v1/me/communities").with(asU1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].communityId").value(community.toString()));
        mvc.perform(put("/api/v1/me/active-community").with(asU1)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"communityId\":\"" + community + "\"}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/me/active-community").with(asU1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.communityId").value(community.toString()));
        mvc.perform(get("/api/v1/communities/" + community + "/members").with(asU1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1));
        mvc.perform(get("/api/v1/me/communities/available").with(asU1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value(community.toString()));
        mvc.perform(delete("/api/v1/communities/" + community + "/membership")
                        .with(asU1)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/me/communities").with(asU1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0));
        mvc.perform(get("/api/v1/me/communities"))
                .andExpect(status().isUnauthorized());
    }
}
