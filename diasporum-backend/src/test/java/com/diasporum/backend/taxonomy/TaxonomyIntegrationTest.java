package com.diasporum.backend.taxonomy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import java.util.List;
import java.util.UUID;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;


import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.taxonomy.internal.application.TaxonomyReferenceSeeder;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.context.ApplicationContext;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Taxonomy module against real migrated PostgreSQL; seed data is disposable. */
@SpringBootTest
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class TaxonomyIntegrationTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired TaxonomyApi api;
    @Autowired TaxonomyReferenceSeeder seeder;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired ApplicationContext ctx;

    @BeforeEach
    void clean() {
        for (String t : new String[]{"user_languages", "user_interests",
                "external_identities", "profiles", "communities", "interests",
                "languages", "countries"}) {
            jdbc.update("DELETE FROM " + t);
        }
    }

    private void seedAll() {
        seeder.seedCountries(List.of(
                new TaxonomyReferenceSeeder.CountrySeed("Portugal", "PT", "PRT",
                        "Portuguese", "PT"),
                new TaxonomyReferenceSeeder.CountrySeed("Germany", "DE", "DEU",
                        "German", "DE")));
        seeder.seedLanguages(List.of(
                new TaxonomyReferenceSeeder.LanguageSeed("en", "English", 1),
                new TaxonomyReferenceSeeder.LanguageSeed("pt", "Portuguese", 2)));
        seeder.seedInterests(List.of(
                new TaxonomyReferenceSeeder.InterestSeed("hiking", "Hiking",
                        "outdoors", 10)));
        UUID pt = api.findCountryByIso2("PT").orElseThrow().id();
        jdbc.update("INSERT INTO communities(name,slug,origin_country_id,"
                        + "destination_country_id) VALUES('PT in DE','pt-in-de',?,?)",
                pt, pt);
    }

    @Test
    void lookupsAndValidationWork() {
        seedAll();
        var pt = api.findCountryByIso2("pt").orElseThrow();   // case-insensitive input
        assertEquals("Portugal", pt.name());
        assertTrue(api.isCountryActive(pt.id()));
        assertFalse(api.isCountryActive(UUID.randomUUID()));
        assertTrue(api.findCountryById(pt.id()).isPresent());
        assertTrue(api.findLanguageByCode("EN").isPresent());
        assertTrue(api.isLanguageActive("pt"));
        assertFalse(api.isLanguageActive("xx"));
        var c = jdbc.queryForObject("SELECT id FROM communities", UUID.class);
        assertTrue(api.isCommunityActive(c));
        assertTrue(api.findCommunityById(c).isPresent());
        assertTrue(api.findInterestByKey("Hiking").isPresent());
        assertTrue(api.isInterestActive("hiking"));
    }

    @Test
    void seederIsIdempotentAndPreservesAdminFlags() {
        seedAll();
        UUID pt = api.findCountryByIso2("PT").orElseThrow().id();
        jdbc.update("UPDATE countries SET is_active=false WHERE id=?", pt);
        // re-running upserts display fields but does NOT flip is_active back
        seeder.seedCountries(List.of(
                new TaxonomyReferenceSeeder.CountrySeed("Portugal", "PT", "PRT",
                        "Portuguese", "PT")));
        assertFalse(api.isCountryActive(pt));
        Integer n = jdbc.queryForObject("SELECT count(*) FROM countries", Integer.class);
        assertEquals(2, n);   // upsert did not duplicate
    }

    @Test
    void searchAndPaginationWorkOverHttp() throws Exception {
        seedAll();
        String sub = "tax-http";
        UUID uid = IdentityTestSupport.provision(ctx, ISSUER, sub);
        mvc.perform(get("/api/v1/taxonomy/countries")
                        .with(authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(uid, UUID.randomUUID(), "test@test.com", List.of()), null, List.of())))
                        .param("search", "port").param("size", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[0].iso2").value("PT"));
        mvc.perform(get("/api/v1/taxonomy/communities")
                        .with(authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(uid, UUID.randomUUID(), "test@test.com", List.of()), null, List.of())))
                        .param("originCountryId",
                                api.findCountryByIso2("PT").orElseThrow().id().toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].slug").value("pt-in-de"));
        mvc.perform(get("/api/v1/taxonomy/interests")
                        .with(authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(uid, UUID.randomUUID(), "test@test.com", List.of()), null, List.of())))
                        .param("category", "outdoors"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[0].interestKey").value("hiking"));
        mvc.perform(get("/api/v1/taxonomy/countries/" + UUID.randomUUID())
                        .with(authentication(new UsernamePasswordAuthenticationToken(new DiasporumUserPrincipal(uid, UUID.randomUUID(), "test@test.com", List.of()), null, List.of()))))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/taxonomy/countries"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void identityCountryValidationUsesTaxonomyApi() {
        seedAll();
        UUID pt = api.findCountryByIso2("PT").orElseThrow().id();
        var uid = IdentityTestSupport.provision(ctx, ISSUER, "tax-ident");
        var req = new com.diasporum.backend.identity.internal.api.rest.UpdateProfileRequest(
                null, null, null, null, null, pt, null);
        var p = new com.diasporum.backend.identity.internal.application.ProfileService(
                jdbc, api).updateProfile(uid, req);
        assertEquals(pt, p.originCountryId());
    }
}
