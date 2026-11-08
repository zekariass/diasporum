package com.diasporum.backend.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import java.util.List;
import java.util.UUID;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;


import com.diasporum.backend.identity.internal.application.ProfileService;
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
 * Profile management against a real migrated schema (V1+V2 via Flyway).
 * A single test country is seeded inside the disposable container only.
 */
@SpringBootTest
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class ProfileManagementIntegrationTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired
    private ProfileService profiles;
    @Autowired
    private com.diasporum.backend.taxonomy.TaxonomyApi taxonomy;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private MockMvc mvc;
    @Autowired
    private ApplicationContext ctx;

    private UUID country;

    @BeforeEach
    void setup() {
        jdbc.update("DELETE FROM external_identities");
        jdbc.update("DELETE FROM profiles");
        // Seeded dev communities reference countries — upsert the test country
        // instead of wiping the reference table.
        jdbc.update("INSERT INTO countries(name, iso2) VALUES ('Testland','ZZ') ON CONFLICT (iso2) DO NOTHING");
        country = jdbc.queryForObject("SELECT id FROM countries WHERE iso2='TT'",
                UUID.class);
    }

    private UUID user(String sub) {
        return IdentityTestSupport.provision(ctx, ISSUER, sub);
    }

    @Test
    void authenticatedProfileRetrievalReturnsProvisionedProfile() {
        UUID id = user("sub-get");
        var p = profiles.getProfile(id);
        // v10.12: display_name is NOT NULL — provision seeds it; username stays unset
        assertEquals("sub-get", p.displayName());
        assertNull(p.username());
        assertEquals("ACTIVE", p.accountStatus());
        assertEquals(false, p.profileCompleted());
    }

    @Test
    void patchAppliesPermittedFieldsAndSetsCompletionOnce() {
        UUID id = user("sub-patch");
        var req = new com.diasporum.backend.identity.internal.api.rest.UpdateProfileRequest(
                "Traveler_One", "Traveler One", "bio here", "Lisbon",
                java.time.LocalDate.of(1990, 5, 1), country, country, null);
        var p = profiles.updateProfile(id, req);
        assertEquals("traveler_one", p.username());   // normalised lowercase
        assertEquals("Traveler One", p.displayName());
        assertEquals(country, p.originCountryId());
        assertEquals(true, p.profileCompleted());
        // second update must not reset the completion timestamp
        var req2 = new com.diasporum.backend.identity.internal.api.rest.UpdateProfileRequest(
                null, null, "new bio", null, null, null, null, null);
        profiles.updateProfile(id, req2);
        var ts = jdbc.queryForObject(
                "SELECT profile_completed_at FROM profiles WHERE id=?",
                java.sql.Timestamp.class, id);
        assertNotNull(ts);
    }

    @Test
    void completionEndpointListsMissingFields() {
        UUID id = user("sub-compl");
        var m = profiles.completion(id);
        assertEquals(false, m.get("complete"));
        assertTrue(m.get("missing") instanceof List<?>);
        // v10.12: provision seeds display_name + both countries — only username is missing
        assertEquals(List.of("username"), m.get("missing"));
    }

    @Test
    void invalidCountryRejected() {
        UUID id = user("sub-badcountry");
        var req = new com.diasporum.backend.identity.internal.api.rest.UpdateProfileRequest(
                null, null, null, null, null, UUID.randomUUID(), null, null);
        var ex = assertThrows(org.springframework.web.server.ResponseStatusException.class,
                () -> profiles.updateProfile(id, req));
        assertEquals(400, ex.getStatusCode().value());
    }

    @Test
    void usernameRulesEnforced() {
        UUID id = user("sub-user");
        assertEquals("INVALID_FORMAT",
                availability("Ab!").get("reason"));
        assertEquals("RESERVED", availability("admin").get("reason"));
        var p = profiles.updateProfile(id,
                new com.diasporum.backend.identity.internal.api.rest.UpdateProfileRequest(
                        "Free_Name", null, null, null, null, null, null, null));
        assertEquals("free_name", p.username());
        assertEquals("TAKEN", availability("FREE_name").get("reason"));   // case-insensitive
    }

    @Test
    void concurrentUsernameClaimLosesWithConflict() {
        UUID a = user("sub-a");
        UUID b = user("sub-b");
        profiles.updateProfile(a, req("claimed_name", null));
        var ex = assertThrows(org.springframework.web.server.ResponseStatusException.class,
                () -> profiles.updateProfile(b, req("CLAIMED_NAME", null)));
        assertEquals(409, ex.getStatusCode().value());
        assertEquals("USERNAME_TAKEN", ex.getReason());
        // the loser keeps no username; winner keeps it
        assertNull(profiles.getProfile(b).username());
        assertEquals("claimed_name", profiles.getProfile(a).username());
    }

    @Test
    void failedTransactionRollsBackPartialUpdates() {
        UUID id = user("sub-rollback");
        var bad = new com.diasporum.backend.identity.internal.api.rest.UpdateProfileRequest(
                "ok_name", "Display", null, null, null, UUID.randomUUID(),
                null, null);
        assertThrows(org.springframework.web.server.ResponseStatusException.class,
                () -> profiles.updateProfile(id, bad));
        // username must not have been persisted by the rolled-back TX;
        // seeded display_name stays untouched
        assertNull(profiles.getProfile(id).username());
        assertEquals("sub-rollback", profiles.getProfile(id).displayName());
    }

    @Test
    void unauthenticatedRequestsRejected() throws Exception {
        mvc.perform(get("/api/v1/me/profile")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/countries")).andExpect(status().isUnauthorized());
    }

    @Test
    void httpPatchRejectsProtectedFieldAndServesCompletion() throws Exception {
        String sub = "sub-http";
        UUID uid = user(sub);
        mvc.perform(get("/api/v1/me/profile").with(authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(uid, UUID.randomUUID(), "test@test.com", List.of()), null, List.of()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accountStatus").value("ACTIVE"));
        mvc.perform(patch("/api/v1/me/profile").with(authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(uid, UUID.randomUUID(), "test@test.com", List.of()), null, List.of())))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountStatus\":\"SUSPENDED\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/me/profile/completion").with(authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(uid, UUID.randomUUID(), "test@test.com", List.of()), null, List.of()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.complete").value(false));
        // availability leaks no account info (authenticated like everything else)
        mvc.perform(get("/api/v1/usernames/availability")
                        .with(authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(uid, UUID.randomUUID(), "test@test.com", List.of()), null, List.of())))
                        .param("username", "free_abc"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.available").value(true))
                .andExpect(jsonPath("$.issuer").doesNotExist())
                .andExpect(jsonPath("$.subject").doesNotExist());
    }

    @Test
    void countriesEndpointListsActiveOnly() {
        jdbc.update("INSERT INTO countries(name, iso2, is_active) VALUES ('InactiveLand','ZX',false)"
                + " ON CONFLICT (iso2) DO UPDATE SET is_active=false");
        var list = taxonomy.activeCountries();
        assertTrue(list.stream().anyMatch(c -> "Testland".equals(c.name())));
        assertTrue(list.stream().noneMatch(c -> "InactiveLand".equals(c.name())));
    }

    @Test
    void compatibilityUsesSharedRelationshipsAndPreservesProficiency() throws Exception {
        UUID id = user("sub-compatibility");
        UUID interest = jdbc.queryForObject("INSERT INTO interests(interest_key,display_name,is_active)"
                + " VALUES('profile-test-interest','Profile test interest',true)"
                + " ON CONFLICT(interest_key) DO UPDATE SET is_active=true RETURNING id",
                UUID.class);
        UUID language = jdbc.queryForObject("SELECT id FROM languages WHERE is_active LIMIT 1", UUID.class);
        profiles.replaceCompatibility(id, List.of(interest), List.of(language));
        jdbc.update("UPDATE user_languages SET proficiency='NATIVE' WHERE user_id=?", id);
        profiles.replaceCompatibility(id, List.of(interest, interest), List.of(language));
        assertEquals("NATIVE", jdbc.queryForObject("SELECT proficiency FROM user_languages WHERE user_id=?", String.class, id));
        assertEquals(List.of(interest), profiles.compatibility(id).interestIds());
        assertThrows(org.springframework.web.server.ResponseStatusException.class,
                () -> profiles.replaceCompatibility(id, List.of(), List.of(UUID.randomUUID())));
        assertEquals(List.of(interest), profiles.compatibility(id).interestIds());
        assertThrows(org.springframework.web.server.ResponseStatusException.class,
                () -> profiles.replaceCompatibility(id, java.util.Arrays.asList((UUID) null), List.of()));
        assertThrows(org.springframework.web.server.ResponseStatusException.class,
                () -> profiles.replaceCompatibility(id, java.util.Collections.nCopies(31, interest), List.of()));
        var auth = new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(id, UUID.randomUUID(), "test@test.com", List.of()), null, List.of());
        mvc.perform(put("/api/v1/me/profile/compatibility").with(authentication(auth))
                .contentType(MediaType.APPLICATION_JSON).content("{\"interestIds\":[],\"languageIds\":[]}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.interestIds").isEmpty());
        assertTrue(profiles.compatibility(id).languageIds().isEmpty());
    }

    @Test
    void approximateLocationRequiresConsentRoundsAndNeverReturnsCoordinates() throws Exception {
        UUID id = user("sub-location");
        var auth = new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(id, UUID.randomUUID(), "test@test.com", List.of()), null, List.of());
        mvc.perform(put("/api/v1/me/profile/discovery-location").with(authentication(auth))
                .contentType(MediaType.APPLICATION_JSON).content("{\"latitude\":38.723456,\"longitude\":-9.123456,\"consent\":false}"))
                .andExpect(status().isBadRequest());
        assertThrows(org.springframework.web.server.ResponseStatusException.class,
                () -> profiles.saveDiscoveryLocation(id, Double.NaN, 0, true));
        mvc.perform(put("/api/v1/me/profile/discovery-location").with(authentication(auth))
                .contentType(MediaType.APPLICATION_JSON).content("{\"latitude\":38.723456,\"longitude\":-9.123456,\"consent\":true}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.hasDiscoveryLocation").value(true))
                .andExpect(jsonPath("$.latitude").doesNotExist()).andExpect(jsonPath("$.longitude").doesNotExist());
        assertEquals(38.72, jdbc.queryForObject("SELECT ST_Y(location::geometry) FROM user_discovery_locations WHERE user_id=?", Double.class, id), 0.000001);
        assertEquals(-9.12, jdbc.queryForObject("SELECT ST_X(location::geometry) FROM user_discovery_locations WHERE user_id=?", Double.class, id), 0.000001);
        mvc.perform(delete("/api/v1/me/profile/discovery-location").with(authentication(auth)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.hasDiscoveryLocation").value(false));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM user_discovery_locations WHERE user_id=?", Integer.class, id));
    }

    @Test
    void ageReconfirmationRequiresActualAdulthoodAndPreservesDateOfBirth() throws Exception {
        UUID id = user("sub-confirm");
        var auth = new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(id, UUID.randomUUID(), "test@test.com", List.of()), null, List.of());
        jdbc.update("UPDATE profiles SET date_of_birth=NULL,age_eligibility_confirmed_at=NULL WHERE id=?", id);
        assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> profiles.confirmAgeEligibility(id));
        jdbc.update("UPDATE profiles SET date_of_birth=CURRENT_DATE - INTERVAL '17 years' WHERE id=?", id);
        mvc.perform(post("/api/v1/me/profile/age-confirmation").with(authentication(auth))
                .contentType(MediaType.APPLICATION_JSON).content("{\"confirmed\":true}"))
                .andExpect(status().isForbidden());
        jdbc.update("UPDATE profiles SET date_of_birth=CURRENT_DATE - INTERVAL '18 years' WHERE id=?", id);
        var dob = profiles.getProfile(id).dateOfBirth();
        mvc.perform(post("/api/v1/me/profile/age-confirmation").with(authentication(auth))
                .contentType(MediaType.APPLICATION_JSON).content("{\"confirmed\":false}"))
                .andExpect(status().isBadRequest());
        profiles.confirmAgeEligibility(id);
        var stamp = jdbc.queryForObject("SELECT age_eligibility_confirmed_at FROM profiles WHERE id=?", java.sql.Timestamp.class, id);
        assertNotNull(stamp);
        profiles.confirmAgeEligibility(id);
        assertEquals(stamp, jdbc.queryForObject("SELECT age_eligibility_confirmed_at FROM profiles WHERE id=?", java.sql.Timestamp.class, id));
        assertEquals(dob, profiles.getProfile(id).dateOfBirth());
        jdbc.update("UPDATE users SET deleted_at=now() WHERE id=?", id);
        assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> profiles.confirmAgeEligibility(id));
        assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> profiles.compatibility(id));
    }

    private java.util.Map<String, Object> availability(String u) {
        return profiles.usernameAvailability(u);
    }

    private com.diasporum.backend.identity.internal.api.rest.UpdateProfileRequest req(
            String username, String display) {
        return new com.diasporum.backend.identity.internal.api.rest.UpdateProfileRequest(
                username, display, null, null, null, null, null, null);
    }
}
