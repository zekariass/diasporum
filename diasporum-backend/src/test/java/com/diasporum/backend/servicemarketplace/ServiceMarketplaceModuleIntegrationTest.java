package com.diasporum.backend.servicemarketplace;

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
import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import com.diasporum.backend.servicemarketplace.ServiceMarketplaceApi.ServiceConversationContext;
import com.diasporum.backend.servicemarketplace.internal.application.ServiceModerationService;
import com.diasporum.backend.servicemarketplace.internal.application.ServiceProviderService;
import com.diasporum.backend.servicemarketplace.internal.application.ServiceRequestService;
import com.diasporum.backend.servicemarketplace.internal.application.ServiceResponseService;
import com.diasporum.backend.servicemarketplace.internal.application.ServiceReviewService;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.LeadInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Provider;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ProviderInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ProviderSearch;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ReportInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.RequestInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.RequestSearch;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ResponseInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ReviewInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ServiceRequest;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
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

/** Service Marketplace on migrated PostgreSQL/PostGIS and real module integrations. */
@SpringBootTest
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class ServiceMarketplaceModuleIntegrationTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5").asCompatibleSubstituteFor("postgres"));

    @Autowired ServiceProviderService providers;
    @Autowired ServiceRequestService requests;
    @Autowired ServiceResponseService responses;
    @Autowired ServiceReviewService reviews;
    @Autowired ServiceModerationService moderation;
    @Autowired ServiceMarketplaceApi marketplaceApi;
    @Autowired BusinessAccountService businessService;
    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;

    private UUID country;
    private UUID category;
    private UUID customer;
    private UUID providerOwner;
    private UUID outsider;

    @BeforeEach
    void setup() {
        jdbc.execute("TRUNCATE service_moderation_actions,service_reports,service_reviews,"
                + "service_lead_access,service_request_responses,service_request_media,service_requests,"
                + "service_provider_services,service_providers,service_category_translations,"
                + "service_categories,notifications,outbox_events,media_processing_jobs,media_objects,"
                + "billing_usage_records,billing_subscriptions,business_account_audit_events,"
                + "business_account_members,business_accounts,global_user_roles,external_identities,"
                + "profiles,users,addresses,countries CASCADE");
        jdbc.update("INSERT INTO countries(name,iso2,iso3) VALUES('Germany','DE','DEU')");
        country = jdbc.queryForObject("SELECT id FROM countries WHERE iso2='DE'", UUID.class);
        jdbc.update("INSERT INTO service_categories(category_key,sort_order) VALUES('TEST_SERVICE',1)");
        category = jdbc.queryForObject("SELECT id FROM service_categories WHERE category_key='TEST_SERVICE'",
                UUID.class);
        jdbc.update("INSERT INTO service_category_translations(service_category_id,language_id,display_name) "
                + "SELECT ?,id,'Test service' FROM languages WHERE language_code='en'", category);
        customer = user("service-customer");
        providerOwner = user("service-provider");
        outsider = user("service-outsider");
    }

    private UUID user(String subject) {
        UUID id = IdentityTestSupport.provision(ctx, ISSUER, subject);
        jdbc.update("UPDATE profiles SET username=?,origin_country_id=?,current_country_id=?,"
                + "profile_completed_at=now() WHERE id=?", subject, country, country, id);
        return id;
    }

    private RequestPostProcessor asUser(UUID id) {
        return authentication(new UsernamePasswordAuthenticationToken(
                new DiasporumUserPrincipal(id, UUID.randomUUID(), "service@example.test", List.of()),
                null, List.of()));
    }

    private ProviderInput providerInput(String name) {
        return new ProviderInput(null, name, "Local test provider", 52.52, 13.405,
                new BigDecimal("50"), List.of(category));
    }

    private Provider provider(UUID owner, String name) {
        return providers.create(owner, providerInput(name));
    }

    private RequestInput requestInput(String title, List<UUID> mediaIds) {
        return new RequestInput(category, country, null, 52.521, 13.41, title,
                "A detailed service request for integration testing", new BigDecimal("100"),
                new BigDecimal("200"), "EUR", null, Instant.now().plus(7, ChronoUnit.DAYS), mediaIds);
    }

    private RequestInput safeEditInput(ServiceRequest request, String title) {
        return new RequestInput(request.serviceCategoryId(), request.countryId(), request.addressId(),
                request.latitude(), request.longitude(), title, "Updated safe request description",
                new BigDecimal("125"), new BigDecimal("225"), "EUR",
                java.time.LocalDate.now().plusDays(3), Instant.now().plus(10, ChronoUnit.DAYS), List.of());
    }

    private ServiceRequest draft(String title) {
        return requests.create(customer, requestInput(title, List.of()));
    }

    private ServiceRequest openRequest(String title) {
        ServiceRequest request = draft(title);
        entitlement(customer, "SERVICE_JOB_POST", 20);
        return requests.publish(customer, request.id());
    }

    private void entitlement(UUID userId, String featureKey, long limit) {
        jdbc.update("UPDATE billing_plan_entitlements SET enabled=true,quantity_limit=?,reset_period='MONTH' "
                + "WHERE plan_id=(SELECT id FROM billing_plans WHERE plan_key='FREE') "
                + "AND feature_id=(SELECT id FROM billing_features WHERE feature_key=?)", limit, featureKey);
        jdbc.update("DELETE FROM billing_subscriptions WHERE user_id=?", userId);
        jdbc.update("INSERT INTO billing_subscriptions(user_id,plan_id,status,current_period_start) "
                + "SELECT ?,id,'ACTIVE',now() FROM billing_plans WHERE plan_key='FREE'", userId);
    }

    private ResponseInput responseInput(UUID providerId) {
        return new ResponseInput(providerId, "INTEREST", "I can help with this request", null, null);
    }

    private RequestSearch allRequests(UUID providerId) {
        return new RequestSearch(providerId, null, null, null, null, null,
                null, null, null, null, "NEWEST");
    }

    @Test
    void migrationAddsIntegrationsWithoutSeedingCategoriesAndUpgradesFromV12() {
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history "
                + "WHERE version='13' AND success", Integer.class));
        String mediaConstraint = jdbc.queryForObject("SELECT pg_get_constraintdef(oid) "
                + "FROM pg_constraint WHERE conname='media_objects_purpose_check'", String.class);
        assertTrue(mediaConstraint.contains("SERVICE_REQUEST"));
        assertTrue(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM pg_enum e "
                + "JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='notification_type' "
                + "AND e.enumlabel='SERVICE_RESPONSE')", Boolean.class));
        assertTrue(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM pg_indexes "
                + "WHERE indexname='ix_service_requests_open_cursor')", Boolean.class));

        try (PostgreSQLContainer upgraded = new PostgreSQLContainer(
                DockerImageName.parse("postgis/postgis:17-3.5").asCompatibleSubstituteFor("postgres"))) {
            upgraded.start();
            var dataSource = new DriverManagerDataSource(upgraded.getJdbcUrl(),
                    upgraded.getUsername(), upgraded.getPassword());
            Flyway.configure().dataSource(dataSource).target("12").load().migrate();
            var upgradeJdbc = new JdbcTemplate(dataSource);
            assertFalse(upgradeJdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM flyway_schema_history "
                    + "WHERE version='13')", Boolean.class));
            assertEquals(0, upgradeJdbc.queryForObject("SELECT count(*) FROM service_categories", Integer.class));

            Flyway.configure().dataSource(dataSource).load().migrate();

            assertEquals(1, upgradeJdbc.queryForObject("SELECT count(*) FROM flyway_schema_history "
                    + "WHERE version='13' AND script='V13__service_marketplace_integration.sql' AND success",
                    Integer.class));
            assertEquals(0, upgradeJdbc.queryForObject("SELECT count(*) FROM service_categories", Integer.class));
            String upgradedConstraint = upgradeJdbc.queryForObject("SELECT pg_get_constraintdef(oid) "
                    + "FROM pg_constraint WHERE conname='media_objects_purpose_check'", String.class);
            assertTrue(upgradedConstraint.contains("SERVICE_REQUEST"));
        }
    }

    @Test
    void providerLifecycleDiscoveryAndBusinessRolesStayCanonical() {
        Provider provider = provider(providerOwner, "Provider one");
        assertEquals("ACTIVE", provider.status());
        assertEquals("PAUSED", providers.pause(providerOwner, provider.id()).status());
        assertEquals("ACTIVE", providers.resume(providerOwner, provider.id()).status());
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException.class,
                () -> providers.pause(outsider, provider.id())).getStatusCode());
        assertEquals("CLOSED", providers.close(providerOwner, provider.id()).status());
        assertEquals(HttpStatus.NOT_FOUND, assertThrows(ResponseStatusException.class,
                () -> providers.get(outsider, provider.id())).getStatusCode());

        var account = businessService.create(providerOwner, "Service Business");
        jdbc.update("INSERT INTO business_account_members(business_account_id,user_id,role_key,accepted_at) "
                + "VALUES(?,?,'LISTING_MANAGER',now())", account.id(), outsider);
        Provider businessProvider = providers.create(outsider, new ProviderInput(account.id(),
                "Business provider", "Managed provider", 52.52, 13.405, new BigDecimal("25"), List.of(category)));
        assertEquals(account.id(), businessProvider.businessAccountId());
        jdbc.update("UPDATE business_account_members SET revoked_at=now() WHERE business_account_id=? AND user_id=?",
                account.id(), outsider);
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException.class,
                () -> providers.pause(outsider, businessProvider.id())).getStatusCode());
    }

    @Test
    void providerAndRequestCursorsAreDeterministicAndFilterBound() {
        UUID secondOwner = user("provider-two");
        UUID thirdOwner = user("provider-three");
        Provider first = provider(providerOwner, "Alpha provider");
        Provider second = provider(secondOwner, "Beta provider");
        Provider third = provider(thirdOwner, "Gamma provider");
        for (var entry : List.of(first, second, third)) {
            jdbc.update("UPDATE service_providers SET created_at=now()-interval '1 minute' WHERE id=?", entry.id());
        }
        var search = new ProviderSearch(null, null, null, null, null, "NEWEST");
        var page1 = providers.discover(customer, search, null, 2);
        assertEquals(2, page1.items().size());
        assertNotNull(page1.nextCursor());
        var page2 = providers.discover(customer, search, page1.nextCursor(), 2);
        assertEquals(1, page2.items().size());
        assertNull(page2.nextCursor());
        assertEquals(3, java.util.stream.Stream.concat(page1.items().stream(), page2.items().stream())
                .map(Provider::id).distinct().count());
        assertThrows(ResponseStatusException.class, () -> providers.discover(customer,
                new ProviderSearch(category, null, null, null, null, "NEWEST"), page1.nextCursor(), 2));

        for (int i = 1; i <= 3; i++) {
            ServiceRequest request = openRequest("Page request " + i);
            jdbc.update("UPDATE service_requests SET published_at=now()-interval '" + i + " minutes' WHERE id=?",
                    request.id());
        }
        var requestSearch = allRequests(first.id());
        var requests1 = requests.discover(providerOwner, requestSearch, null, 2);
        var requests2 = requests.discover(providerOwner, requestSearch, requests1.nextCursor(), 2);
        assertEquals(2, requests1.items().size());
        assertEquals(1, requests2.items().size());
        assertNull(requests2.nextCursor());
        assertEquals(3, java.util.stream.Stream.concat(requests1.items().stream(), requests2.items().stream())
                .map(ServiceRequest::id).distinct().count());
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ResponseStatusException.class,
                () -> requests.discover(providerOwner, new RequestSearch(first.id(), null, null, null,
                        null, null, null, null, null, null, "PRICE_ASC"), null, 2)).getStatusCode());
    }

    @Test
    void providerJobDiscoveryRequiresManagementAndEnforcesCategoryRadiusAndSelfExclusion() {
        Provider provider = provider(providerOwner, "Discovery provider");
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ResponseStatusException.class,
                () -> requests.discover(providerOwner, allRequests(null), null, 20)).getStatusCode());
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException.class,
                () -> requests.discover(outsider, allRequests(provider.id()), null, 20)).getStatusCode());

        ServiceRequest matching = openRequest("Matching request");
        jdbc.update("INSERT INTO service_categories(category_key,sort_order) VALUES('OTHER_SERVICE',2)");
        UUID otherCategory = jdbc.queryForObject("SELECT id FROM service_categories "
                + "WHERE category_key='OTHER_SERVICE'", UUID.class);
        ServiceRequest otherCategoryRequest = requests.create(customer, new RequestInput(otherCategory,
                country, null, 52.521, 13.41, "Other category", "A request outside the provider categories",
                new BigDecimal("100"), new BigDecimal("200"), "EUR", null,
                Instant.now().plus(7, ChronoUnit.DAYS), List.of()));
        entitlement(customer, "SERVICE_JOB_POST", 20);
        requests.publish(customer, otherCategoryRequest.id());
        ServiceRequest outOfRange = openRequest("Out of range request");
        jdbc.update("UPDATE service_requests SET location=ST_SetSRID(ST_MakePoint(11.582,48.135),4326)"
                + "::geography WHERE id=?", outOfRange.id());
        ServiceRequest ownRequest = requests.create(providerOwner, requestInput("Own request", List.of()));
        entitlement(providerOwner, "SERVICE_JOB_POST", 20);
        requests.publish(providerOwner, ownRequest.id());

        var discovered = requests.discover(providerOwner, allRequests(provider.id()), null, 20);
        assertEquals(List.of(matching.id()), discovered.items().stream().map(ServiceRequest::id).toList());

        var account = businessService.create(providerOwner, "Discovery Business");
        jdbc.update("INSERT INTO business_account_members(business_account_id,user_id,role_key,accepted_at) "
                + "VALUES(?,?,'EDITOR',now())", account.id(), customer);
        Provider businessProvider = providers.create(providerOwner, new ProviderInput(account.id(),
                "Business discovery provider", "Managed provider", 52.52, 13.405,
                new BigDecimal("50"), List.of(category)));
        assertTrue(requests.discover(providerOwner, allRequests(businessProvider.id()), null, 20)
                .items().isEmpty());
    }

    @Test
    void requestLifecycleBillingMediaAndSoftDeletionWork() {
        ServiceRequest request = draft("Lifecycle request");
        assertEquals("DRAFT", request.status());
        assertThrows(ResponseStatusException.class, () -> requests.publish(customer, request.id()));
        entitlement(customer, "SERVICE_JOB_POST", 2);
        assertEquals("OPEN", requests.publish(customer, request.id()).status());
        assertEquals("OPEN", requests.publish(customer, request.id()).status());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM billing_usage_records WHERE user_id=?",
                Integer.class, customer));
        assertEquals("PAUSED", requests.pause(customer, request.id()).status());
        assertEquals(HttpStatus.NOT_FOUND, assertThrows(ResponseStatusException.class,
                () -> requests.get(providerOwner, request.id())).getStatusCode());
        assertEquals("OPEN", requests.resume(customer, request.id()).status());
        assertEquals("CLOSED", requests.close(customer, request.id()).status());
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException.class,
                () -> requests.pause(providerOwner, request.id())).getStatusCode());

        UUID mediaId = UUID.randomUUID();
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,object_key,purpose,mime_type,status) "
                + "VALUES(?,?,?,?,?,'image/jpeg','READY')", mediaId, customer, "test",
                "service/" + mediaId, "SERVICE_REQUEST");
        ServiceRequest withMedia = requests.create(customer, requestInput("Media request", List.of(mediaId)));
        assertEquals(List.of(mediaId), withMedia.mediaIds());
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ResponseStatusException.class,
                () -> requests.create(providerOwner, requestInput("Stolen media", List.of(mediaId)))).getStatusCode());

        ServiceRequest deleted = draft("Delete draft");
        requests.delete(customer, deleted.id());
        assertEquals("REMOVED", jdbc.queryForObject("SELECT status FROM service_requests WHERE id=?",
                String.class, deleted.id()));
        assertNotNull(jdbc.queryForObject("SELECT deleted_at FROM service_requests WHERE id=?",
                Instant.class, deleted.id()));
        assertFalse(requests.owned(customer, null, null, 20).items().stream()
                .anyMatch(item -> item.id().equals(deleted.id())));
    }

    @Test
    void publishedRequestsAllowSafeEditsButLockReferencesLocationAndLimitMedia() {
        List<UUID> tooManyImages = java.util.stream.Stream.generate(UUID::randomUUID).limit(6).toList();
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ResponseStatusException.class,
                () -> requests.create(customer, requestInput("Too many images", tooManyImages))).getStatusCode());

        ServiceRequest request = openRequest("Published safe edit");
        ServiceRequest updated = requests.update(customer, request.id(), safeEditInput(request, "Updated open request"));
        assertEquals("Updated open request", updated.title());
        assertEquals(0, new BigDecimal("125").compareTo(updated.budgetMin()));
        assertEquals("OPEN", updated.status());

        ServiceRequest paused = requests.pause(customer, request.id());
        ServiceRequest pausedUpdate = requests.update(customer, paused.id(),
                safeEditInput(paused, "Updated paused request"));
        assertEquals("Updated paused request", pausedUpdate.title());
        assertEquals("PAUSED", pausedUpdate.status());

        RequestInput moved = new RequestInput(pausedUpdate.serviceCategoryId(), pausedUpdate.countryId(),
                pausedUpdate.addressId(), pausedUpdate.latitude() + 0.001, pausedUpdate.longitude(),
                pausedUpdate.title(), pausedUpdate.description(), pausedUpdate.budgetMin(), pausedUpdate.budgetMax(),
                pausedUpdate.currencyCode(), pausedUpdate.preferredDate(), pausedUpdate.expiresAt(), pausedUpdate.mediaIds());
        assertEquals(HttpStatus.CONFLICT, assertThrows(ResponseStatusException.class,
                () -> requests.update(customer, paused.id(), moved)).getStatusCode());

        jdbc.update("INSERT INTO service_categories(category_key,sort_order) VALUES('EDIT_CATEGORY',2)");
        UUID otherCategory = jdbc.queryForObject("SELECT id FROM service_categories "
                + "WHERE category_key='EDIT_CATEGORY'", UUID.class);
        RequestInput recategorized = new RequestInput(otherCategory, pausedUpdate.countryId(), pausedUpdate.addressId(),
                pausedUpdate.latitude(), pausedUpdate.longitude(), pausedUpdate.title(), pausedUpdate.description(),
                pausedUpdate.budgetMin(), pausedUpdate.budgetMax(), pausedUpdate.currencyCode(),
                pausedUpdate.preferredDate(), pausedUpdate.expiresAt(), pausedUpdate.mediaIds());
        assertEquals(HttpStatus.CONFLICT, assertThrows(ResponseStatusException.class,
                () -> requests.update(customer, paused.id(), recategorized)).getStatusCode());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM billing_usage_records WHERE user_id=?",
                Integer.class, customer));

        requests.close(customer, paused.id());
        assertEquals(HttpStatus.CONFLICT, assertThrows(ResponseStatusException.class,
                () -> requests.update(customer, paused.id(), safeEditInput(pausedUpdate, "Closed edit"))).getStatusCode());
    }

    @Test
    void responsesRejectQuotesEnforceOwnershipAndTransitionOnlyFromSent() {
        ServiceRequest request = openRequest("Response request");
        Provider provider = provider(providerOwner, "Response provider");
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException.class,
                () -> responses.respond(outsider, request.id(), responseInput(provider.id()))).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ResponseStatusException.class,
                () -> responses.respond(providerOwner, request.id(), new ResponseInput(provider.id(), "QUOTE",
                        "Quote", new BigDecimal("50"), "EUR"))).getStatusCode());
        var response = responses.respond(providerOwner, request.id(), responseInput(provider.id()));
        assertEquals("SENT", response.status());
        assertEquals(HttpStatus.CONFLICT, assertThrows(ResponseStatusException.class,
                () -> responses.respond(providerOwner, request.id(), responseInput(provider.id()))).getStatusCode());
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException.class,
                () -> responses.acceptResponse(outsider, response.id())).getStatusCode());
        assertEquals("SENT", responses.updateResponse(providerOwner, response.id(),
                responseInput(provider.id())).status());
        assertEquals("ACCEPTED", responses.acceptResponse(customer, response.id()).status());
        assertEquals(HttpStatus.CONFLICT, assertThrows(ResponseStatusException.class,
                () -> responses.declineResponse(customer, response.id())).getStatusCode());
        assertEquals(1, responses.responsesForRequest(customer, request.id(), null, 20).items().size());
        assertEquals(1, responses.ownResponses(providerOwner, provider.id(), null, 20).items().size());
        assertEquals(0, responses.ownResponses(outsider, null, null, 20).items().size());

        UUID secondOwner = user("withdraw-provider");
        Provider second = provider(secondOwner, "Second provider");
        var withdrawn = responses.respond(secondOwner, request.id(), responseInput(second.id()));
        assertEquals("WITHDRAWN", responses.withdrawResponse(secondOwner, withdrawn.id()).status());
        assertEquals(HttpStatus.CONFLICT, assertThrows(ResponseStatusException.class,
                () -> responses.withdrawResponse(secondOwner, withdrawn.id())).getStatusCode());
    }

    @Test
    void leadAccessIsIdempotentPrivateAndRevalidatedForMessaging() throws Exception {
        UUID addressId = UUID.randomUUID();
        jdbc.update("INSERT INTO addresses(id,country_id,address_line_1,city,owner_user_id,location) "
                + "VALUES(?,?,'Exact private street 1','Berlin',?,"
                + "ST_SetSRID(ST_MakePoint(13.5,52.6),4326)::geography)", addressId, country, customer);
        ServiceRequest request = requests.create(customer, new RequestInput(category, country, addressId,
                52.521, 13.41, "Private lead", "Request with a private exact address", null, null,
                null, null, Instant.now().plus(7, ChronoUnit.DAYS), List.of()));
        entitlement(customer, "SERVICE_JOB_POST", 2);
        requests.publish(customer, request.id());
        Provider provider = provider(providerOwner, "Lead provider");
        entitlement(providerOwner, "SERVICE_LEAD_ACCESS", 2);

        var chat = responses.accessLead(providerOwner, request.id(), new LeadInput(provider.id(), true, false));
        assertTrue(chat.chatEnabled());
        assertFalse(chat.contactDetailsUnlocked());
        assertNull(chat.contactAddress());
        var upgraded = responses.accessLead(providerOwner, request.id(), new LeadInput(provider.id(), true, true));
        assertTrue(upgraded.contactDetailsUnlocked());
        assertEquals("Exact private street 1", upgraded.contactAddress().addressLine1());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM billing_usage_records WHERE user_id=?",
                Integer.class, providerOwner));
        assertEquals(upgraded.id(), responses.getRequestLead(customer, request.id(), provider.id()).id());
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException.class,
                () -> responses.getRequestLead(outsider, request.id(), provider.id())).getStatusCode());

        var context = new ServiceConversationContext(UUID.randomUUID(), request.id(), customer, null,
                providerOwner, null);
        assertTrue(marketplaceApi.canAccessServiceConversation(customer, context));
        assertTrue(marketplaceApi.canAccessServiceConversation(providerOwner, context));
        assertFalse(marketplaceApi.canAccessServiceConversation(outsider, context));
        assertFalse(marketplaceApi.canAccessServiceConversation(customer,
                new ServiceConversationContext(context.conversationId(), request.id(), outsider, null,
                        providerOwner, null)));
        jdbc.update("UPDATE service_lead_access SET status='REVOKED',revoked_at=now() WHERE id=?", upgraded.id());
        assertFalse(marketplaceApi.canAccessServiceConversation(providerOwner, context));
        assertEquals(HttpStatus.CONFLICT, assertThrows(ResponseStatusException.class,
                () -> responses.accessLead(providerOwner, request.id(),
                        new LeadInput(provider.id(), true, true))).getStatusCode());
    }

    @Test
    void concurrentLeadAccessCreatesOneGrantAndOneBillingRecord() throws Exception {
        ServiceRequest request = openRequest("Concurrent lead");
        Provider provider = provider(providerOwner, "Concurrent provider");
        entitlement(providerOwner, "SERVICE_LEAD_ACCESS", 2);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> responses.accessLead(providerOwner, request.id(),
                    new LeadInput(provider.id(), true, false)));
            var second = executor.submit(() -> responses.accessLead(providerOwner, request.id(),
                    new LeadInput(provider.id(), true, true)));
            assertEquals(first.get().id(), second.get().id());
        }
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM service_lead_access", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM billing_usage_records WHERE user_id=?",
                Integer.class, providerOwner));
    }

    @Test
    void reviewsReportsAndModerationUseCanonicalSchemaAndAuthorization() {
        ServiceRequest request = openRequest("Moderated request");
        Provider provider = provider(providerOwner, "Reviewed provider");
        assertEquals(HttpStatus.CONFLICT, assertThrows(ResponseStatusException.class,
                () -> reviews.createReview(customer, request.id(), new ReviewInput(provider.id(), 5, "Great")))
                .getStatusCode());
        responses.respond(providerOwner, request.id(), responseInput(provider.id()));
        var review = reviews.createReview(customer, request.id(), new ReviewInput(provider.id(), 5, "Great"));
        assertEquals("Thank you", reviews.respondToReview(providerOwner, review.id(), "Thank you").providerResponse());
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException.class,
                () -> reviews.respondToReview(outsider, review.id(), "No")).getStatusCode());
        assertEquals(HttpStatus.CONFLICT, assertThrows(ResponseStatusException.class,
                () -> reviews.report(customer, new ReportInput("SERVICE_REQUEST", request.id(),
                        "OTHER", "Cannot report my own request"))).getStatusCode());
        var report = reviews.report(providerOwner, new ReportInput("SERVICE_REQUEST", request.id(),
                "OTHER", "Requires moderator review"));
        assertEquals(HttpStatus.CONFLICT, assertThrows(ResponseStatusException.class,
                () -> reviews.report(providerOwner, new ReportInput("SERVICE_REQUEST", request.id(),
                        "OTHER", "Duplicate report"))).getStatusCode());
        UUID moderator = user("service-moderator");
        jdbc.update("INSERT INTO global_user_roles(user_id,role_key,scope_type) "
                + "VALUES(?,'PLATFORM_MODERATOR','GLOBAL')", moderator);
        assertEquals("ACTIONED", moderation.moderate(moderator, "SERVICE_REQUEST", request.id(),
                "HIDE", "Confirmed violation", report.id()).status());
        assertEquals("REMOVED", jdbc.queryForObject("SELECT status FROM service_requests WHERE id=?",
                String.class, request.id()));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM service_moderation_actions "
                + "WHERE actor_user_id=? AND action_key='HIDE'", Integer.class, moderator));
    }

    @Test
    void httpRequiresAuthenticationAndPreventsIdor() throws Exception {
        ServiceRequest request = openRequest("HTTP request");
        mvc.perform(get("/api/v1/service/requests/{id}", request.id())).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/service/requests/{id}", request.id()).with(asUser(providerOwner)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.title").value("HTTP request"));
        mvc.perform(post("/api/v1/service/requests/{id}/pause", request.id()).with(asUser(providerOwner)))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/service/responses/me").with(asUser(providerOwner))
                        .param("serviceProviderId", UUID.randomUUID().toString()))
                .andExpect(status().isNotFound());
    }
}
