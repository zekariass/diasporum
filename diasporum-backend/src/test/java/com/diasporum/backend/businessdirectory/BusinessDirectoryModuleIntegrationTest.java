package com.diasporum.backend.businessdirectory;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.diasporum.backend.businessaccounts.internal.application.BusinessAccountService;
import com.diasporum.backend.businessdirectory.internal.application.BusinessBranchService;
import com.diasporum.backend.businessdirectory.internal.application.BusinessDirectoryAdminService;
import com.diasporum.backend.businessdirectory.internal.application.BusinessDirectoryService;
import com.diasporum.backend.businessdirectory.internal.application.BusinessEngagementService;
import com.diasporum.backend.businessdirectory.internal.domain.DirectoryTypes.BusinessView;
import com.diasporum.backend.community.internal.application.CommunityService;
import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.media.internal.infrastructure.integration.storage.StorageClient;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import java.math.BigDecimal;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
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
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Directory behavior against the real migrated PostgreSQL/PostGIS schema. */
@SpringBootTest
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class BusinessDirectoryModuleIntegrationTest {

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

    @Autowired BusinessDirectoryService directory;
    @Autowired BusinessBranchService branches;
    @Autowired BusinessEngagementService engagement;
    @Autowired BusinessDirectoryAdminService admin;
    @Autowired BusinessAccountService accounts;
    @Autowired CommunityService communities;
    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;

    private UUID origin;
    private UUID destination;
    private UUID community;
    private UUID category;
    private UUID owner;
    private UUID reviewer;
    private UUID reviewer2;
    private UUID outsider;
    private UUID abroad;
    private UUID administrator;

    @BeforeEach
    void setup() {
        jdbc.execute("TRUNCATE business_listings,business_accounts,reports,"
                + "moderation_actions,audit_logs,direct_conversations CASCADE");
        jdbc.update("DELETE FROM global_user_roles");
        jdbc.update("DELETE FROM media_objects WHERE purpose='BUSINESS'");
        jdbc.update("DELETE FROM business_categories");
        jdbc.update("DELETE FROM addresses");
        for (String table : new String[]{"community_memberships", "external_identities",
                "profiles", "communities", "airports", "countries"}) {
            jdbc.update("DELETE FROM " + table);
        }
        jdbc.update("INSERT INTO countries(name,iso2,iso3) VALUES"
                + "('Ethiopia','ET','ETH'),('Germany','DE','DEU')");
        origin = country("ET");
        destination = country("DE");
        jdbc.update("INSERT INTO communities(name,slug,origin_country_id,"
                + "destination_country_id) VALUES('ET in DE','et-in-de',?,?)", origin,
                destination);
        community = jdbc.queryForObject("SELECT id FROM communities", UUID.class);
        jdbc.update("INSERT INTO business_categories(id,country_id,name,slug) VALUES"
                + "(?,NULL,'Restaurant','restaurant')", UUID.randomUUID());
        category = jdbc.queryForObject("SELECT id FROM business_categories", UUID.class);
        owner = user("bd-owner");
        reviewer = user("bd-reviewer");
        reviewer2 = user("bd-reviewer-two");
        outsider = user("bd-outsider");
        abroad = user("bd-abroad");
        administrator = user("bd-administrator");
        for (UUID user : new UUID[]{owner, reviewer, reviewer2, outsider, administrator}) {
            jdbc.update("UPDATE profiles SET origin_country_id=?,current_country_id=?"
                    + " WHERE id=?", origin, destination, user);
        }
        jdbc.update("UPDATE profiles SET origin_country_id=?,current_country_id=? WHERE id=?",
                origin, origin, abroad);
        for (UUID user : new UUID[]{owner, reviewer, reviewer2}) {
            communities.join(user, community);
        }
        jdbc.update("INSERT INTO global_user_roles(user_id,role_key,scope_type)"
                + " VALUES(?,'PLATFORM_ADMIN','GLOBAL')", administrator);
    }

    private UUID user(String subject) {
        return IdentityTestSupport.provision(ctx, ISSUER, subject);
    }

    private UUID country(String iso2) {
        return jdbc.queryForObject("SELECT id FROM countries WHERE iso2=?", UUID.class, iso2);
    }

    private RequestPostProcessor asUser(UUID userId) {
        return authentication(new UsernamePasswordAuthenticationToken(
                new DiasporumUserPrincipal(userId, UUID.randomUUID(), "directory@test.com",
                        List.of()), null, List.of()));
    }

    private BusinessView create(UUID actor, String name) {
        return directory.create(actor, new BusinessDirectoryService.CreateCommand(destination,
                null, category, name, "A directory integration test business", "+49 30 1234567",
                "hello@example.com", "https://example.com", "COUNTRY", null, null));
    }

    private BusinessView published(UUID actor, String name) {
        var business = create(actor, name);
        return directory.publish(actor, business.id());
    }

    private BusinessBranchService.AddressCommand address(String city, double latitude,
            double longitude) {
        return new BusinessBranchService.AddressCommand("Main street 1", null, city, null,
                "10115", null, latitude, longitude, false);
    }

    private BusinessBranchService.BranchCommand branch(String name, double latitude,
            double longitude, boolean primary) {
        return new BusinessBranchService.BranchCommand(name, null, primary, true,
                "Europe/Berlin", address("Berlin", latitude, longitude));
    }

    @Test
    void freshMigrationProvidesMessagingCompatibleDirectorySchemaAndSeparateTaxonomy() {
        assertEquals(3, jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history"
                + " WHERE version IN ('6','7','8') AND success", Integer.class));
        for (String column : new String[]{"is_active", "timezone"}) {
            assertTrue(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM information_schema.columns"
                    + " WHERE table_name='business_locations' AND column_name='" + column + "')",
                    Boolean.class));
        }
        assertTrue(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM information_schema.columns"
                + " WHERE table_name='business_media' AND column_name='is_logo')", Boolean.class));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM job_categories WHERE id=?",
                Integer.class, category));

        String mediaConstraint = jdbc.queryForObject("SELECT pg_get_constraintdef(oid)"
                + " FROM pg_constraint WHERE conname='media_objects_purpose_check'", String.class);
        assertTrue(mediaConstraint.contains("MESSAGE_IMAGE"));
        assertTrue(mediaConstraint.contains("MESSAGE_DOCUMENT"));
        assertTrue(mediaConstraint.contains("JOB"));
        assertTrue(mediaConstraint.contains("BUSINESS"));
    }

    @Test
    void directoryMigrationUpgradesDatabaseAtMessagingM4AndJobs() {
        try (PostgreSQLContainer upgraded = new PostgreSQLContainer(
                DockerImageName.parse("postgis/postgis:17-3.5")
                        .asCompatibleSubstituteFor("postgres"))) {
            upgraded.start();
            var dataSource = new DriverManagerDataSource(upgraded.getJdbcUrl(),
                    upgraded.getUsername(), upgraded.getPassword());
            Flyway.configure().dataSource(dataSource).target("7").load().migrate();
            var upgradeJdbc = new JdbcTemplate(dataSource);
            assertEquals(1, upgradeJdbc.queryForObject("SELECT count(*) FROM flyway_schema_history"
                    + " WHERE version='6' AND script='V6__messaging_m4_attachments.sql' AND success",
                    Integer.class));
            assertFalse(upgradeJdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM flyway_schema_history"
                    + " WHERE version='8')", Boolean.class));
            assertFalse(upgradeJdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM information_schema.columns"
                    + " WHERE table_name='business_locations' AND column_name='is_active')",
                    Boolean.class));
            assertEquals(1, upgradeJdbc.queryForObject("SELECT count(*)"
                    + " FROM flyway_schema_history WHERE version='7'"
                    + " AND script='V7__jobs_module.sql' AND success", Integer.class));
            assertTrue(upgradeJdbc.queryForObject("SELECT EXISTS(SELECT 1"
                    + " FROM information_schema.columns WHERE table_name='job_listings'"
                    + " AND column_name='deleted_at')", Boolean.class));

            Flyway.configure().dataSource(dataSource).load().migrate();

            assertEquals(1, upgradeJdbc.queryForObject("SELECT count(*) FROM flyway_schema_history"
                    + " WHERE version='8' AND script='V8__business_directory_operations.sql'"
                    + " AND success", Integer.class));
            assertTrue(upgradeJdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM information_schema.columns"
                    + " WHERE table_name='business_locations' AND column_name='is_active')",
                    Boolean.class));
            assertTrue(upgradeJdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM information_schema.columns"
                    + " WHERE table_name='business_media' AND column_name='is_logo')", Boolean.class));
            String mediaConstraint = upgradeJdbc.queryForObject("SELECT pg_get_constraintdef(oid)"
                    + " FROM pg_constraint WHERE conname='media_objects_purpose_check'", String.class);
            assertTrue(mediaConstraint.contains("MESSAGE_IMAGE"));
            assertTrue(mediaConstraint.contains("MESSAGE_DOCUMENT"));
            assertTrue(mediaConstraint.contains("JOB"));
            assertTrue(mediaConstraint.contains("BUSINESS"));
        }
    }

    @Test
    void personalProfileLifecycleAndVisibilityAreEnforced() {
        var draft = create(owner, "Lifecycle Restaurant");
        assertEquals("DRAFT", draft.status());
        assertTrue(draft.canManage());
        assertThrows(ResponseStatusException.class, () -> directory.detail(reviewer, draft.id()));

        var published = directory.publish(owner, draft.id());
        assertEquals("PUBLISHED", published.status());
        assertFalse(directory.detail(reviewer, draft.id()).canManage());
        assertThrows(ResponseStatusException.class, () -> directory.detail(abroad, draft.id()));
        assertEquals("DRAFT", directory.unpublish(owner, draft.id()).status());
        assertThrows(ResponseStatusException.class, () -> directory.detail(reviewer, draft.id()));
        assertThrows(ResponseStatusException.class, () -> directory.update(reviewer, draft.id(),
                new BusinessDirectoryService.UpdateCommand(null, false, "Stolen", null, null,
                        null, null, null, null, null)));

        directory.delete(owner, draft.id());
        assertThrows(ResponseStatusException.class, () -> directory.detail(owner, draft.id()));
    }

    @Test
    void accountRolesRevocationAndMultipleProfilesAreLive() {
        var workspace = accounts.create(owner, "Habesha Group");
        jdbc.update("INSERT INTO business_account_members(business_account_id,user_id,role_key,"
                        + "invited_by_user_id,updated_by_user_id,accepted_at)"
                        + " VALUES(?,?,'EDITOR',?,?,now())", workspace.id(), reviewer, owner, owner);
        jdbc.update("INSERT INTO business_account_members(business_account_id,user_id,role_key,"
                        + "invited_by_user_id,updated_by_user_id,accepted_at)"
                        + " VALUES(?,?,'LISTING_MANAGER',?,?,now())", workspace.id(), reviewer2,
                owner, owner);
        var command = new BusinessDirectoryService.CreateCommand(destination, workspace.id(),
                category, "Account Restaurant", "Business-owned directory profile", null, null,
                null, "COUNTRY", null, null);
        var first = directory.create(reviewer, command);
        var second = directory.create(reviewer, new BusinessDirectoryService.CreateCommand(
                destination, workspace.id(), category, "Account Travel", "Another public profile",
                null, null, null, "COUNTRY", null, null));
        assertEquals(2, directory.managed(reviewer, workspace.id(), null, 20).items().size());
        assertTrue(directory.canManage(owner, directory.requireViewable(owner, first.id())));
        assertThrows(ResponseStatusException.class, () -> directory.create(reviewer2, command));

        jdbc.update("UPDATE business_account_members SET revoked_at=now(),revoked_by_user_id=?"
                + " WHERE business_account_id=? AND user_id=?", owner, workspace.id(), reviewer);
        assertThrows(ResponseStatusException.class,
                () -> directory.unpublish(reviewer, first.id()));
        assertTrue(directory.canManage(owner, directory.requireViewable(owner, second.id())));
    }

    @Test
    void branchesPrimarySelectionHoursAndDeactivationWork() {
        var business = published(owner, "Branch Restaurant");
        var first = branches.create(owner, business.id(), branch("Mitte", 52.5200, 13.4050, false));
        var second = branches.create(owner, business.id(), branch("East", 52.5210, 13.4150, true));
        assertTrue(first.primary());
        assertTrue(second.primary());
        assertFalse(branches.list(owner, business.id()).stream()
                .filter(b -> b.id().equals(first.id())).findFirst().orElseThrow().primary());

        var hours = branches.replaceHours(owner, business.id(), first.id(), List.of(
                new BusinessBranchService.HourCommand(1, LocalTime.of(9, 0),
                        LocalTime.of(17, 30), false),
                new BusinessBranchService.HourCommand(7, null, null, true)));
        assertEquals(2, hours.size());
        assertTrue(hours.get(1).closed());
        assertEquals("Europe/Berlin", branches.list(reviewer, business.id()).get(0).timezone());
        assertThrows(ResponseStatusException.class, () -> branches.deactivate(reviewer,
                business.id(), first.id()));

        branches.deactivate(owner, business.id(), second.id());
        var remaining = branches.list(reviewer, business.id());
        assertEquals(1, remaining.size());
        assertTrue(remaining.get(0).primary());
        assertEquals(2, remaining.get(0).hours().size());
    }

    @Test
    void discoveryFiltersPostGisNearbyAndCursorPagination() {
        var near = published(owner, "Near Restaurant");
        var far = published(owner, "Far Restaurant");
        var other = published(owner, "Other Cafe");
        branches.create(owner, near.id(), branch("Near", 52.5200, 13.4050, true));
        branches.create(owner, far.id(), branch("Far", 52.5300, 13.4150, true));
        branches.create(owner, other.id(), branch("Other", 52.5400, 13.4250, true));
        jdbc.update("UPDATE business_listings SET verification_status='VERIFIED' WHERE id=?",
                near.id());

        var firstPage = directory.discover(reviewer, new BusinessDirectoryService.SearchCommand(
                destination, null, category, "Berlin", "restaurant", null, null, null, null,
                "newest", null, 1));
        assertEquals(1, firstPage.items().size());
        assertNotNull(firstPage.nextCursor());
        var secondPage = directory.discover(reviewer, new BusinessDirectoryService.SearchCommand(
                destination, null, category, "Berlin", "restaurant", null, null, null, null,
                "newest", firstPage.nextCursor(), 1));
        assertEquals(1, secondPage.items().size());
        assertFalse(firstPage.items().get(0).id().equals(secondPage.items().get(0).id()));

        var nearby = directory.discover(reviewer, new BusinessDirectoryService.SearchCommand(
                null, null, null, null, null, true, 52.5201, 13.4051, 5000,
                "distance", null, 10));
        assertEquals(1, nearby.items().size());
        assertEquals(near.id(), nearby.items().get(0).id());
        assertNotNull(nearby.items().get(0).distanceMeters());
        assertTrue(nearby.items().get(0).distanceMeters() < 100);
    }

    @Test
    void communityAndSelectedCommunityVisibilityUseMembership() {
        var communityBusiness = directory.create(owner,
                new BusinessDirectoryService.CreateCommand(destination, null, category,
                        "Community Restaurant", "Only for community members", null, null, null,
                        "COMMUNITY", community, null));
        directory.publish(owner, communityBusiness.id());
        assertTrue(directory.detail(reviewer, communityBusiness.id()).id()
                .equals(communityBusiness.id()));
        assertThrows(ResponseStatusException.class,
                () -> directory.detail(outsider, communityBusiness.id()));

        var selected = directory.create(owner, new BusinessDirectoryService.CreateCommand(
                destination, null, category, "Selected Restaurant", "Selected communities", null,
                null, null, "SELECTED_COMMUNITIES", null, List.of(community)));
        directory.publish(owner, selected.id());
        assertEquals(2, directory.discover(reviewer, new BusinessDirectoryService.SearchCommand(
                null, community, null, null, null, null, null, null, null, null, null, 20))
                .items().size());
        assertTrue(directory.discover(outsider, new BusinessDirectoryService.SearchCommand(
                null, null, null, null, null, null, null, null, null, null, null, 20))
                .items().isEmpty());
    }

    @Test
    void reviewsRatingsOwnershipResponsesAndReportsWork() {
        var business = published(owner, "Review Restaurant");
        assertThrows(ResponseStatusException.class,
                () -> engagement.createReview(owner, business.id(), 5, "Own business"));
        var first = engagement.createReview(reviewer, business.id(), 5, "Excellent");
        assertThrows(ResponseStatusException.class,
                () -> engagement.createReview(reviewer, business.id(), 4, "Duplicate"));
        engagement.createReview(reviewer2, business.id(), 3, "Good");
        assertEquals(0, engagement.rating(reviewer, business.id()).averageRating()
                .compareTo(new BigDecimal("4.00")));
        assertEquals(2, engagement.rating(reviewer, business.id()).reviewCount());
        assertThrows(ResponseStatusException.class, () -> engagement.updateReview(reviewer2,
                business.id(), first.id(), 1, "Changed"));
        engagement.updateReview(reviewer, business.id(), first.id(), 1, "Updated");
        assertEquals(0, engagement.rating(reviewer, business.id()).averageRating()
                .compareTo(new BigDecimal("2.00")));
        var response = engagement.respondToReview(owner, business.id(), first.id(), "Thank you");
        assertEquals("Thank you", response.ownerResponse());
        assertEquals(2, engagement.reviews(reviewer, business.id(), null, 20).items().size());

        UUID report = engagement.reportReview(reviewer2, business.id(), first.id(), "SPAM", null);
        assertNotNull(report);
        assertThrows(ResponseStatusException.class, () -> engagement.reportReview(reviewer2,
                business.id(), first.id(), "SPAM", null));
        engagement.deleteReview(reviewer, business.id(), first.id());
        assertEquals(1, engagement.rating(reviewer, business.id()).reviewCount());
    }

    @Test
    void savedBusinessesAreIdempotentVisibleAndPaginated() {
        var first = published(owner, "Saved One");
        var second = published(owner, "Saved Two");
        engagement.save(reviewer, first.id());
        engagement.save(reviewer, first.id());
        engagement.save(reviewer, second.id());
        var page = engagement.saved(reviewer, null, 1);
        assertEquals(1, page.items().size());
        assertTrue(page.items().get(0).saved());
        assertNotNull(page.nextCursor());
        assertEquals(1, engagement.saved(reviewer, page.nextCursor(), 1).items().size());
        directory.unpublish(owner, first.id());
        assertEquals(1, engagement.saved(reviewer, null, 20).items().size());
        engagement.unsave(reviewer, second.id());
        assertTrue(engagement.saved(reviewer, null, 20).items().isEmpty());
    }

    @Test
    void verificationRequiresStaffAndWritesAuditTrail() {
        var business = published(owner, "Verified Restaurant");
        assertThrows(ResponseStatusException.class,
                () -> admin.changeVerification(owner, business.id(), "VERIFIED", "Self approve"));
        assertEquals("PENDING", admin.requestVerification(owner, business.id()).status());
        assertThrows(ResponseStatusException.class,
                () -> admin.changeVerification(reviewer, business.id(), "VERIFIED", "No role"));
        assertEquals("VERIFIED", admin.changeVerification(administrator, business.id(),
                "VERIFIED", "Documents reviewed").status());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM moderation_actions"
                + " WHERE target_id=? AND action_type='APPROVE_CONTENT'", Integer.class,
                business.id()));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM audit_logs"
                + " WHERE target_id=? AND action_key='BUSINESS_VERIFICATION_VERIFIED'",
                Integer.class, business.id()));
        assertEquals("REVOKED", admin.changeVerification(administrator, business.id(),
                "REVOKED", "Information changed").status());
        assertEquals("PENDING", admin.requestVerification(owner, business.id()).status());
    }

    @Test
    void mediaPurposeOwnershipRolesAndMessagingIntegrationWork() {
        var business = published(owner, "Media Restaurant");
        UUID logo = UUID.randomUUID();
        UUID foreign = UUID.randomUUID();
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,object_key,purpose,"
                        + "mime_type,status,size_bytes) VALUES(?,?,'test','business/logo',"
                        + "'BUSINESS','image/png','READY',10)", logo, owner);
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,object_key,purpose,"
                        + "mime_type,status,size_bytes) VALUES(?,?,'test','business/foreign',"
                        + "'BUSINESS','image/png','READY',10)", foreign, reviewer);
        assertEquals("LOGO", directory.attachMedia(owner, business.id(), logo, 0, "LOGO").role());
        assertThrows(ResponseStatusException.class,
                () -> directory.attachMedia(owner, business.id(), foreign, 1, "GALLERY"));
        assertEquals(1, directory.media(reviewer, business.id()).size());
        assertTrue(directory.mediaDownloadUrl(reviewer, business.id(), logo)
                .endsWith("/get/business/logo"));
        assertThrows(ResponseStatusException.class,
                () -> directory.mediaDownloadUrl(abroad, business.id(), logo));
        assertThrows(ResponseStatusException.class,
                () -> directory.mediaDownloadUrl(reviewer, business.id(), foreign));

        UUID conversation = directory.contact(reviewer, business.id());
        assertNotNull(conversation);
        assertEquals(conversation, directory.contact(reviewer, business.id()));
        assertThrows(ResponseStatusException.class, () -> directory.contact(owner, business.id()));
    }

    @Test
    void httpEndpointsUsePrincipalAndValidation() throws Exception {
        mvc.perform(get("/api/v1/businesses")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/businesses").with(asUser(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/businesses").with(asUser(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"countryId\":\"" + destination + "\",\"categoryId\":\""
                                + category + "\",\"name\":\"HTTP Restaurant\","
                                + "\"description\":\"Created through the REST endpoint\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.canManage").value(true));
        mvc.perform(get("/api/v1/businesses/categories").with(asUser(reviewer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].slug").value("restaurant"));
    }
}
