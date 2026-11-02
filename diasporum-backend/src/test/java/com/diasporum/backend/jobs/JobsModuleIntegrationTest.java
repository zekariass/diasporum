package com.diasporum.backend.jobs;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.diasporum.backend.businessaccounts.internal.application.BusinessAccountService;
import com.diasporum.backend.community.internal.application.CommunityService;
import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.jobs.internal.application.JobApplicationService;
import com.diasporum.backend.jobs.internal.application.JobService;
import com.diasporum.backend.jobs.internal.application.JobService.CreateJobCommand;
import com.diasporum.backend.jobs.internal.application.JobService.JobDetail;
import com.diasporum.backend.jobs.internal.application.JobService.JobFilters;
import com.diasporum.backend.jobs.internal.application.JobService.UpdateJobCommand;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
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

/** Jobs on migrated PostgreSQL: lifecycle, visibility, applications and HTTP security. */
@SpringBootTest
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class JobsModuleIntegrationTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";
    private static final JobFilters NO_FILTERS = new JobFilters(null, null, null, null,
            null, null, null, null, null, null, null, null);

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5").asCompatibleSubstituteFor("postgres"));

    @Autowired JobService jobs;
    @Autowired JobApplicationService applications;
    @Autowired CommunityService communities;
    @Autowired BusinessAccountService businessService;
    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;

    private UUID origin, dest, community, categoryId;
    private UUID owner, member, member2, outsider, abroad;

    private UUID user(String subject) {
        return IdentityTestSupport.provision(ctx, ISSUER, subject);
    }

    private RequestPostProcessor asUser(UUID id) {
        return authentication(new UsernamePasswordAuthenticationToken(
                new DiasporumUserPrincipal(id, UUID.randomUUID(), "jobs@example.test", List.of()),
                null, List.of()));
    }

    @BeforeEach
    void setup() {
        jdbc.update("DELETE FROM reports WHERE target_type='JOB'");
        jdbc.update("DELETE FROM job_saves");
        jdbc.update("DELETE FROM job_applications");
        jdbc.update("DELETE FROM job_media");
        jdbc.update("UPDATE job_listings SET status='PAUSED' WHERE status='PUBLISHED'");
        jdbc.update("DELETE FROM job_listing_categories");
        jdbc.update("DELETE FROM job_listings");
        jdbc.update("DELETE FROM media_processing_jobs");
        jdbc.update("DELETE FROM media_objects");
        jdbc.update("DELETE FROM business_account_audit_events");
        jdbc.update("DELETE FROM business_account_members");
        jdbc.update("DELETE FROM business_accounts");
        jdbc.update("DELETE FROM addresses");
        for (String table : new String[]{"community_memberships", "external_identities",
                "profiles", "communities", "countries"}) {
            jdbc.update("DELETE FROM " + table);
        }
        jdbc.update("INSERT INTO countries(name,iso2,iso3) VALUES"
                + "('Ethiopia','ET','ETH'),('Germany','DE','DEU')");
        origin = jdbc.queryForObject("SELECT id FROM countries WHERE iso2='ET'", UUID.class);
        dest = jdbc.queryForObject("SELECT id FROM countries WHERE iso2='DE'", UUID.class);
        jdbc.update("INSERT INTO communities(name,slug,origin_country_id,destination_country_id)"
                + " VALUES('ET in DE','et-in-de',?,?)", origin, dest);
        community = jdbc.queryForObject("SELECT id FROM communities", UUID.class);
        categoryId = jdbc.queryForObject("SELECT id FROM job_categories"
                + " WHERE category_key='INFORMATION_TECHNOLOGY'", UUID.class);
        owner = user("job-owner");
        member = user("job-member");
        member2 = user("job-member-2");
        outsider = user("job-outsider");
        abroad = user("job-abroad");
        for (UUID id : new UUID[]{owner, member, member2}) {
            jdbc.update("UPDATE profiles SET origin_country_id=?,current_country_id=? WHERE id=?",
                    origin, dest, id);
            communities.join(id, community);
        }
        communities.setActiveCommunity(member, community);
        communities.setActiveCommunity(member2, community);
        jdbc.update("UPDATE profiles SET origin_country_id=?,current_country_id=? WHERE id=?",
                dest, dest, outsider);
        jdbc.update("UPDATE profiles SET origin_country_id=?,current_country_id=? WHERE id=?",
                origin, origin, abroad);
    }

    private CreateJobCommand command(String title, String scope, String method) {
        return new CreateJobCommand(community, scope, List.of(categoryId), "Diasporum Ltd", title,
                "Build a welcoming community platform with Java and PostgreSQL", "PERMANENT",
                "FULL_TIME", "DAY", "HYBRID", "Berlin", "Berlin", "Berlin, Germany",
                new BigDecimal("40000.00"), new BigDecimal("60000.00"), "EUR", method,
                "EXTERNAL".equals(method) ? "https://example.org/jobs/apply" : null,
                Instant.now().plus(30, ChronoUnit.DAYS), null, "EMPLOYER_DIRECT", null,
                null, List.of(), false);
    }

    private JobDetail create(String title) {
        return jobs.create(owner, command(title, "COMMUNITY", "INTERNAL"));
    }

    private UpdateJobCommand emptyUpdate() {
        return new UpdateJobCommand(null, null, null, null, null, null, null, null, false,
                null, null, null, null, false, null, null, null, false, null, null,
                null, false, null, null, null, null);
    }

    private UpdateJobCommand titleUpdate(String title) {
        return new UpdateJobCommand(null, null, null, title, null, null, null, null, false,
                null, null, null, null, false, null, null, null, false, null, null,
                null, false, null, null, null, null);
    }

    @Test
    void freshMigrationProvidesM4AndJobsSchema() {
        assertTrue(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM information_schema.columns"
                + " WHERE table_name='job_listings' AND column_name='business_account_id')",
                Boolean.class));
        assertTrue(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM information_schema.columns"
                + " WHERE table_name='job_listings' AND column_name='deleted_at')", Boolean.class));
        assertTrue(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM pg_indexes"
                + " WHERE indexname='ux_job_reports_open_reporter_target')", Boolean.class));
        assertTrue(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM pg_indexes"
                + " WHERE indexname='ix_job_listings_discovery')", Boolean.class));
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history"
                + " WHERE version IN ('6','7') AND success", Integer.class));
        String mediaConstraint = jdbc.queryForObject("SELECT pg_get_constraintdef(oid)"
                + " FROM pg_constraint WHERE conname='media_objects_purpose_check'", String.class);
        assertTrue(mediaConstraint.contains("MESSAGE_IMAGE"));
        assertTrue(mediaConstraint.contains("MESSAGE_DOCUMENT"));
        assertTrue(mediaConstraint.contains("JOB"));
    }

    @Test
    void jobsMigrationUpgradesDatabaseAlreadyAtMessagingM4() {
        try (PostgreSQLContainer upgraded = new PostgreSQLContainer(
                DockerImageName.parse("postgis/postgis:17-3.5")
                        .asCompatibleSubstituteFor("postgres"))) {
            upgraded.start();
            var dataSource = new DriverManagerDataSource(upgraded.getJdbcUrl(),
                    upgraded.getUsername(), upgraded.getPassword());
            Flyway.configure().dataSource(dataSource).target("6").load().migrate();
            var upgradeJdbc = new JdbcTemplate(dataSource);
            assertFalse(upgradeJdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM flyway_schema_history"
                    + " WHERE version='7')", Boolean.class));
            assertFalse(upgradeJdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM information_schema.columns"
                    + " WHERE table_name='job_listings' AND column_name='deleted_at')", Boolean.class));

            Flyway.configure().dataSource(dataSource).load().migrate();

            assertEquals(1, upgradeJdbc.queryForObject("SELECT count(*) FROM flyway_schema_history"
                    + " WHERE version='7' AND script='V7__jobs_module.sql' AND success", Integer.class));
            assertTrue(upgradeJdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM information_schema.columns"
                    + " WHERE table_name='job_listings' AND column_name='deleted_at')", Boolean.class));
            String mediaConstraint = upgradeJdbc.queryForObject("SELECT pg_get_constraintdef(oid)"
                    + " FROM pg_constraint WHERE conname='media_objects_purpose_check'", String.class);
            assertTrue(mediaConstraint.contains("MESSAGE_IMAGE"));
            assertTrue(mediaConstraint.contains("MESSAGE_DOCUMENT"));
            assertTrue(mediaConstraint.contains("JOB"));
        }
    }

    @Test
    void lifecycleCreateDraftPublishCloseExpireAndSoftDelete() {
        var published = create("Platform engineer");
        assertEquals("PUBLISHED", published.job().status());
        assertEquals(owner, published.job().employerUserId());
        assertEquals("INFORMATION_TECHNOLOGY", published.categories().get(0).categoryKey());
        assertEquals("Berlin", published.location().city());
        assertTrue(published.canManage());

        var draftCommand = new CreateJobCommand(community, "COMMUNITY", List.of(categoryId),
                "Diasporum Ltd", "Draft engineer", "A complete draft description", "CONTRACT",
                "PART_TIME", null, "REMOTE", null, null, null, null, null, null,
                "INTERNAL", null, Instant.now().plus(5, ChronoUnit.DAYS), null,
                "EMPLOYER_DIRECT", null, null, List.of(), true);
        var draft = jobs.create(owner, draftCommand);
        assertEquals("DRAFT", draft.job().status());
        assertThrows(ResponseStatusException.class, () -> jobs.detail(member, draft.job().id()));
        assertEquals("PUBLISHED", jobs.publish(owner, draft.job().id()).job().status());
        assertEquals("CLOSED", jobs.close(owner, draft.job().id()).job().status());
        assertThrows(ResponseStatusException.class, () -> jobs.publish(owner, draft.job().id()));

        jdbc.update("UPDATE job_listings SET closes_at=now()-interval '1 hour' WHERE id=?",
                published.job().id());
        assertThrows(ResponseStatusException.class, () -> jobs.detail(member, published.job().id()));
        assertEquals("EXPIRED", jobs.detail(owner, published.job().id()).job().status());
        jobs.delete(owner, published.job().id());
        assertNotNull(jdbc.queryForObject("SELECT deleted_at FROM job_listings WHERE id=?",
                Instant.class, published.job().id()));
        assertThrows(ResponseStatusException.class, () -> jobs.detail(owner, published.job().id()));
        assertEquals("EXPIRED", jdbc.queryForObject("SELECT status::text FROM job_listings WHERE id=?",
                String.class, published.job().id()));
    }

    @Test
    void validationRejectsUnsafeUrlsSalaryAndCategories() {
        var badUrl = command("Bad URL", "COMMUNITY", "EXTERNAL");
        badUrl = new CreateJobCommand(badUrl.communityId(), badUrl.visibilityScope(),
                badUrl.categoryIds(), badUrl.employerName(), badUrl.title(), badUrl.description(),
                badUrl.employmentType(), badUrl.workHoursType(), badUrl.workSchedule(),
                badUrl.workplaceType(), badUrl.city(), badUrl.region(), badUrl.formattedAddress(),
                badUrl.salaryMin(), badUrl.salaryMax(), badUrl.salaryCurrency(),
                badUrl.applicationMethod(), "javascript:alert(1)", badUrl.closesAt(), null,
                badUrl.sourceType(), null, null, List.of(), false);
        var unsafeCommand = badUrl;
        var ex = assertThrows(ResponseStatusException.class, () -> jobs.create(owner, unsafeCommand));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatusCode());
        assertThrows(ResponseStatusException.class, () -> jobs.create(owner,
                new CreateJobCommand(community, "COMMUNITY", List.of(UUID.randomUUID()),
                        "Employer", "Bad category", "Description", null, null, null, "REMOTE",
                        null, null, null, null, null, null, "INTERNAL", null, null, null,
                        null, null, null, List.of(), false)));
        assertThrows(ResponseStatusException.class, () -> jobs.create(owner,
                new CreateJobCommand(community, "COMMUNITY", List.of(categoryId), "Employer",
                        "Bad salary", "Description", null, null, null, "REMOTE", null, null,
                        null, new BigDecimal("100"), new BigDecimal("50"), "EUR", "INTERNAL",
                        null, null, null, null, null, null, List.of(), false)));
    }

    @Test
    void visibilityUsesMembershipActiveCommunityAndCurrentCountry() {
        var communityJob = create("Members only");
        var countryJob = jobs.create(owner, command("Country role", "COUNTRY", "EXTERNAL"));
        assertThrows(ResponseStatusException.class, () -> jobs.detail(outsider, communityJob.job().id()));
        assertEquals("Country role", jobs.detail(outsider, countryJob.job().id()).job().title());
        assertThrows(ResponseStatusException.class, () -> jobs.detail(abroad, countryJob.job().id()));
        assertEquals(2, jobs.discover(member, NO_FILTERS, null, 20).items().size());
        assertEquals(1, jobs.discover(outsider, NO_FILTERS, null, 20).items().size());
        assertEquals(0, jobs.discover(abroad, NO_FILTERS, null, 20).items().size());
        assertThrows(ResponseStatusException.class, () -> jobs.discover(outsider,
                new JobFilters(community, null, null, null, null, null, null, null, null,
                        null, null, null), null, 20));
    }

    @Test
    void discoverySearchFiltersAndCursorPaginateWithoutDuplicates() {
        for (int i = 1; i <= 5; i++) {
            var created = create("Backend engineer " + i);
            jdbc.update("UPDATE job_listings SET published_at=now()-interval '" + i + " minutes'"
                    + " WHERE id=?", created.job().id());
        }
        var first = jobs.discover(member, NO_FILTERS, null, 2);
        assertEquals(2, first.items().size());
        assertNotNull(first.nextCursor());
        var second = jobs.discover(member, NO_FILTERS, first.nextCursor(), 2);
        assertEquals(2, second.items().size());
        var third = jobs.discover(member, NO_FILTERS, second.nextCursor(), 2);
        assertEquals(1, third.items().size());
        assertNull(third.nextCursor());
        assertEquals(5, java.util.stream.Stream.concat(first.items().stream(),
                java.util.stream.Stream.concat(second.items().stream(), third.items().stream()))
                .map(i -> i.job().id()).distinct().count());
        assertEquals(5, jobs.discover(member, new JobFilters(null, null, categoryId,
                "PERMANENT", "HYBRID", "Berlin", new BigDecimal("30000"),
                new BigDecimal("65000"), null, null, "PostgreSQL", "NEWEST"), null, 20)
                .items().size());
        assertEquals(5, jobs.discover(member, new JobFilters(null, null, null, null,
                null, null, null, null, null, null, null, "CLOSING"), null, 20).items().size());
    }

    @Test
    void onlyOwnersCanManageAndOwnedCursorUsesCreatedAt() {
        var one = create("Owned one");
        var two = create("Owned two");
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException.class,
                () -> jobs.update(member, one.job().id(), titleUpdate("Stolen"))).getStatusCode());
        assertThrows(ResponseStatusException.class, () -> jobs.close(member, one.job().id()));
        assertThrows(ResponseStatusException.class, () -> jobs.delete(member, one.job().id()));
        assertEquals("Renamed", jobs.update(owner, one.job().id(), titleUpdate("Renamed")).job().title());
        var page = jobs.myJobs(owner, null, 1);
        assertEquals(1, page.items().size());
        assertNotNull(page.nextCursor());
        assertEquals(1, jobs.myJobs(owner, page.nextCursor(), 1).items().size());
        assertEquals(2, java.util.stream.Stream.of(one, two).map(j -> j.job().id()).distinct().count());
    }

    @Test
    void businessRolesAndRevocationAreRechecked() {
        var account = businessService.create(owner, "Jobs Business");
        jdbc.update("INSERT INTO business_account_members(business_account_id,user_id,role_key,accepted_at)"
                + " VALUES(?,?,'LISTING_MANAGER',now()),(? ,?,'BILLING_MANAGER',now())",
                account.id(), member, account.id(), member2);
        var businessCommand = new CreateJobCommand(community, "COMMUNITY", List.of(categoryId),
                "Jobs Business", "Business role", "Business description", "PERMANENT", "FULL_TIME",
                "DAY", "REMOTE", null, null, null, null, null, null, "INTERNAL", null,
                Instant.now().plus(5, ChronoUnit.DAYS), account.id(), "EMPLOYER_DIRECT",
                null, null, List.of(), false);
        var created = jobs.create(member, businessCommand);
        assertEquals(account.id(), created.job().businessAccountId());
        assertEquals("Jobs Business", created.businessAccountName());
        assertThrows(ResponseStatusException.class, () -> jobs.create(member2, businessCommand));
        jdbc.update("UPDATE business_account_members SET revoked_at=now() WHERE business_account_id=?"
                + " AND user_id=?", account.id(), member);
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException.class,
                () -> jobs.update(member, created.job().id(), titleUpdate("Revoked"))).getStatusCode());
        assertTrue(jobs.canManage(owner, created.job()));
    }

    @Test
    void jobAndResumeMediaRequireOwnershipPurposeAndReadiness() {
        UUID image = UUID.randomUUID();
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,object_key,purpose,mime_type,status)"
                + " VALUES(?,?,?,?,?,'image/jpeg','READY')", image, owner, "test", "job/" + image, "JOB");
        var base = command("Media job", "COMMUNITY", "INTERNAL");
        var withMedia = new CreateJobCommand(base.communityId(), base.visibilityScope(), base.categoryIds(),
                base.employerName(), base.title(), base.description(), base.employmentType(),
                base.workHoursType(), base.workSchedule(), base.workplaceType(), base.city(), base.region(),
                base.formattedAddress(), base.salaryMin(), base.salaryMax(), base.salaryCurrency(),
                base.applicationMethod(), base.applicationUrl(), base.closesAt(), null, base.sourceType(),
                null, null, List.of(image), false);
        assertEquals(List.of(image), jobs.create(owner, withMedia).mediaIds());
        assertThrows(ResponseStatusException.class, () -> jobs.create(member, withMedia));
    }

    @Test
    void internalApplicationsEnforcePrivacyDuplicatesTransitionsAndWithdrawal() {
        var job = create("Apply here");
        var submitted = applications.apply(member, job.job().id(), "I am interested", null);
        assertEquals("SUBMITTED", submitted.application().status());
        assertEquals(HttpStatus.CONFLICT, assertThrows(ResponseStatusException.class,
                () -> applications.apply(member, job.job().id(), null, null)).getStatusCode());
        assertEquals(HttpStatus.NOT_FOUND, assertThrows(ResponseStatusException.class,
                () -> applications.detail(member2, submitted.application().id())).getStatusCode());
        assertEquals(1, applications.forJob(owner, job.job().id(), null, null, 20).items().size());
        assertEquals("VIEWED", applications.updateStatus(owner, submitted.application().id(), "VIEWED")
                .application().status());
        assertEquals("SHORTLISTED", applications.updateStatus(owner, submitted.application().id(),
                "SHORTLISTED").application().status());
        assertEquals("HIRED", applications.updateStatus(owner, submitted.application().id(), "HIRED")
                .application().status());
        assertThrows(ResponseStatusException.class,
                () -> applications.withdraw(member, submitted.application().id()));
        var second = applications.apply(member2, job.job().id(), null, null);
        assertEquals("WITHDRAWN", applications.withdraw(member2, second.application().id())
                .application().status());
        assertEquals(2, applications.myApplications(member2, null, 20).items().size()
                + applications.myApplications(member, null, 20).items().size());
        assertThrows(ResponseStatusException.class, () -> applications.apply(owner, job.job().id(), null, null));
        var external = jobs.create(owner, command("External", "COMMUNITY", "EXTERNAL"));
        assertThrows(ResponseStatusException.class,
                () -> applications.apply(member, external.job().id(), null, null));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM job_applications WHERE job_id=?",
                Integer.class, external.job().id()));
    }

    @Test
    void applicationResumeAndEmployerCursorStayAuthorized() {
        var job = create("Resume job");
        UUID resume = UUID.randomUUID();
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,object_key,purpose,mime_type,status)"
                + " VALUES(?,?,?,?,?,'application/pdf','READY')", resume, member, "test",
                "document/" + resume, "DOCUMENT");
        var first = applications.apply(member, job.job().id(), "With resume", resume);
        assertThrows(ResponseStatusException.class, () -> applications.resumeDownloadUrl(member2,
                first.application().id()));
        applications.apply(member2, job.job().id(), null, null);
        UUID third = user("job-third");
        jdbc.update("UPDATE profiles SET origin_country_id=?,current_country_id=? WHERE id=?",
                origin, dest, third);
        communities.join(third, community);
        applications.apply(third, job.job().id(), null, null);
        var page = applications.forJob(owner, job.job().id(), null, null, 2);
        assertEquals(2, page.items().size());
        assertNotNull(page.nextCursor());
        assertEquals(1, applications.forJob(owner, job.job().id(), null, page.nextCursor(), 2)
                .items().size());
        assertThrows(ResponseStatusException.class,
                () -> applications.forJob(member2, job.job().id(), null, null, 20));
    }

    @Test
    void savesAreIdempotentVisibleAndReportsPreventDuplicateOpenRows() {
        var job = create("Save me");
        jobs.save(member, job.job().id());
        jobs.save(member, job.job().id());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM job_saves WHERE job_id=? AND user_id=?",
                Integer.class, job.job().id(), member));
        assertEquals(1, jobs.savedJobs(member, null, 20).items().size());
        jobs.unsave(member, job.job().id());
        assertEquals(0, jobs.savedJobs(member, null, 20).items().size());
        UUID report = jobs.report(member, job.job().id(), "SCAM", "Suspicious listing");
        assertNotNull(report);
        assertEquals(HttpStatus.CONFLICT, assertThrows(ResponseStatusException.class,
                () -> jobs.report(member, job.job().id(), "SCAM", null)).getStatusCode());
        assertEquals("JOB", jdbc.queryForObject("SELECT target_type::text FROM reports WHERE id=?",
                String.class, report));
        assertThrows(ResponseStatusException.class, () -> jobs.report(outsider, job.job().id(), "SPAM", null));
    }

    @Test
    void httpRequiresAuthenticationAndPreventsIdor() throws Exception {
        var job = create("HTTP job");
        mvc.perform(get("/api/v1/jobs")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/jobs/{id}", job.job().id()).with(asUser(member)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.job.title").value("HTTP job"));
        mvc.perform(patch("/api/v1/jobs/{id}", job.job().id()).with(asUser(member))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"Stolen\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/jobs/{id}", job.job().id()).with(asUser(outsider)))
                .andExpect(status().isNotFound());
    }
}
