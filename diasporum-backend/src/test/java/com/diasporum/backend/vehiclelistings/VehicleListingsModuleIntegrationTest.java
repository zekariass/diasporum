package com.diasporum.backend.vehiclelistings;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.diasporum.backend.billing.BillingApi;
import com.diasporum.backend.community.internal.application.CommunityService;
import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.media.internal.infrastructure.integration.storage.StorageClient;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import com.diasporum.backend.vehiclelistings.internal.application.VehiclePolicies;
import com.diasporum.backend.vehiclelistings.internal.application.VehicleService;
import com.diasporum.backend.vehiclelistings.internal.domain.VehicleInput;
import com.diasporum.backend.vehiclelistings.internal.domain.VehicleSearch;
import com.diasporum.backend.vehiclelistings.internal.domain.VehicleView;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Vehicles on real migrated PostgreSQL, including integrations and HTTP security. */
@SpringBootTest
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class VehicleListingsModuleIntegrationTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5").asCompatibleSubstituteFor("postgres"));

    @TestConfiguration
    static class PolicyFixtures {
        @Bean
        @Primary
        VehiclePolicies vehiclePolicies() {
            return new VehiclePolicies(Map.of("CAR", new VehiclePolicies.Category(
                    List.of("modelYear", "mileage", "priceAmount"), List.of("modelYear"),
                    List.of("AIR_CONDITIONING"), Map.of("TOW_CAPACITY",
                    new VehiclePolicies.Attribute("NUMBER", false, 0.0, 5000.0,
                            List.of(), true)))));
        }
    }

    @Autowired VehicleService vehicles;
    @Autowired CommunityService communities;
    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @MockitoBean StorageClient storage;

    private UUID origin, destination, community, category, make, model, variant, feature;
    private UUID owner, buyer, other, abroad;

    @BeforeEach
    void setup() {
        jdbc.update("DELETE FROM direct_conversations WHERE context_type='VEHICLE_LISTING'");
        jdbc.update("DELETE FROM reports WHERE target_type='VEHICLE'");
        jdbc.update("DELETE FROM vehicle_listing_saves");
        jdbc.update("DELETE FROM vehicle_listing_media");
        jdbc.update("DELETE FROM vehicle_listing_features");
        jdbc.update("DELETE FROM vehicle_listing_communities");
        jdbc.update("DELETE FROM billing_usage_records WHERE target_type='VEHICLE_LISTING'");
        jdbc.update("DELETE FROM billing_entitlement_grants WHERE feature_id IN "
                + "(SELECT id FROM billing_features WHERE feature_key='VEHICLE_LISTING_PUBLISH')");
        jdbc.update("DELETE FROM vehicle_listings");
        jdbc.update("DELETE FROM media_processing_jobs");
        jdbc.update("DELETE FROM media_objects");
        jdbc.update("UPDATE business_accounts SET status='CLOSED'");
        jdbc.update("DELETE FROM business_account_members");
        jdbc.update("DELETE FROM business_account_audit_events");
        jdbc.update("DELETE FROM business_accounts");
        jdbc.update("DELETE FROM addresses");
        jdbc.update("DELETE FROM user_blocks");
        for (String table : new String[]{"community_memberships", "external_identities",
                "profiles", "communities", "vehicle_variants", "vehicle_models", "vehicle_makes",
                "vehicle_features", "vehicle_categories", "countries"}) {
            jdbc.update("DELETE FROM " + table);
        }
        jdbc.update("INSERT INTO countries(name,iso2,iso3) VALUES"
                + "('Ethiopia','ET','ETH'),('Germany','DE','DEU')");
        origin = country("ET");
        destination = country("DE");
        jdbc.update("INSERT INTO communities(name,slug,origin_country_id,destination_country_id) "
                + "VALUES('ET in DE','et-in-de',?,?)", origin, destination);
        community = jdbc.queryForObject("SELECT id FROM communities", UUID.class);
        category = UUID.randomUUID(); make = UUID.randomUUID(); model = UUID.randomUUID();
        variant = UUID.randomUUID(); feature = UUID.randomUUID();
        jdbc.update("INSERT INTO vehicle_categories(id,category_key,display_name) VALUES(?,?,?)",
                category, "CAR", "Car");
        jdbc.update("INSERT INTO vehicle_makes(id,make_key,display_name) VALUES(?,?,?)",
                make, "TEST_MAKE", "Test Make");
        jdbc.update("INSERT INTO vehicle_models(id,make_id,model_key,display_name) VALUES(?,?,?,?)",
                model, make, "TEST_MODEL", "Test Model");
        jdbc.update("INSERT INTO vehicle_variants(id,model_id,variant_key,display_name) VALUES(?,?,?,?)",
                variant, model, "BASE", "Base");
        jdbc.update("INSERT INTO vehicle_features(id,feature_key,display_name) VALUES(?,?,?)",
                feature, "AIR_CONDITIONING", "Air conditioning");
        owner = user("vehicle-owner"); buyer = user("vehicle-buyer");
        other = user("vehicle-other"); abroad = user("vehicle-abroad");
        for (UUID id : new UUID[]{owner, buyer, other}) {
            jdbc.update("UPDATE profiles SET origin_country_id=?,current_country_id=? WHERE id=?",
                    origin, destination, id);
            communities.join(id, community);
        }
        jdbc.update("UPDATE profiles SET origin_country_id=?,current_country_id=? WHERE id=?",
                origin, origin, abroad);
        lenient().when(storage.presignGet(anyString(), org.mockito.ArgumentMatchers.any()))
                .thenAnswer(invocation -> "https://media.test/" + invocation.getArgument(0));
        lenient().when(storage.presignPut(anyString(), anyString(), org.mockito.ArgumentMatchers.any()))
                .thenReturn("https://upload.test/signed");
    }

    private UUID user(String subject) {
        return IdentityTestSupport.provision(ctx, ISSUER, subject);
    }

    private UUID country(String iso2) {
        return jdbc.queryForObject("SELECT id FROM countries WHERE iso2=?", UUID.class, iso2);
    }

    private VehicleInput input() {
        return new VehicleInput(null, "COUNTRY", null, List.of(), "SALE", category, make, model,
                variant, "Reliable test car", "A well maintained vehicle used for integration tests",
                2022, 12000, "KM", "HYBRID", "AUTOMATIC", "AWD", "SUV", 1998, "Blue", 5, 5,
                "GOOD", 2023, 1, Map.of(), null, "FULL", new BigDecimal("12500.00"), "EUR", "TOTAL",
                null, null, null, new VehicleInput.LocationInput("Berlin", "Berlin",
                "Berlin, Germany", 52.52, 13.405), List.of(feature),
                Instant.now().plus(30, ChronoUnit.DAYS), false, false, Set.of());
    }

    private VehicleInput businessInput(UUID accountId) {
        VehicleInput v = input();
        return new VehicleInput(accountId, v.visibilityScope(), v.communityId(), v.selectedCommunityIds(),
                v.listingPurpose(), v.categoryId(), v.makeId(), v.modelId(), v.variantId(), v.title(),
                v.description(), v.modelYear(), v.mileage(), v.mileageUnit(), v.fuelType(), v.transmission(),
                v.driveType(), v.bodyType(), v.engineSizeCc(), v.colour(), v.doors(), v.seats(), v.condition(),
                v.registrationYear(), v.previousOwners(), v.additionalAttributes(), v.motExpiry(),
                v.serviceHistory(), v.priceAmount(), v.currencyCode(), v.pricePeriod(), v.rentalDeposit(),
                v.mileageAllowance(), v.rentalConditions(), v.location(), v.featureIds(), v.expiresAt(),
                false, false, Set.of());
    }

    private VehicleView published() {
        VehicleView listing = vehicles.create(owner, input());
        grant(owner, null, 10);
        return vehicles.publish(owner, listing.listing().id());
    }

    private void grant(UUID userId, UUID businessId, long quantity) {
        jdbc.update("INSERT INTO billing_entitlement_grants(feature_id,user_id,business_account_id,"
                + "source_type,quantity_granted) SELECT id,?,?,'ADMIN_GRANT',? FROM billing_features "
                + "WHERE feature_key='VEHICLE_LISTING_PUBLISH'", userId, businessId, quantity);
    }

    private UUID business(UUID creator, String role) {
        UUID id = UUID.randomUUID();
        UUID accountOwner = "OWNER".equals(role) ? creator : other;
        jdbc.update("INSERT INTO business_accounts(id,account_name,created_by_user_id) VALUES(?,?,?)",
                id, "Vehicle Test Ltd", accountOwner);
        if (!"OWNER".equals(role)) {
            jdbc.update("INSERT INTO business_account_members(business_account_id,user_id,role_key,accepted_at) "
                    + "VALUES(?,?,?,now())", id, creator, role);
        }
        return id;
    }

    private RequestPostProcessor asUser(UUID id) {
        return authentication(new UsernamePasswordAuthenticationToken(
                new DiasporumUserPrincipal(id, UUID.randomUUID(), "vehicles@example.test", List.of()),
                null, List.of()));
    }

    @Test
    void v11WorksOnFreshAndPreVehicleDatabases() {
        String constraint = jdbc.queryForObject("SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                + "WHERE conname='media_objects_purpose_check'", String.class);
        assertTrue(constraint.contains("VEHICLE"));
        assertTrue(constraint.contains("MESSAGE_DOCUMENT"));
        assertTrue(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM pg_indexes "
                + "WHERE indexname='ux_vehicle_reports_open_reporter_target')", Boolean.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history "
                + "WHERE version='11' AND success", Integer.class));

        try (PostgreSQLContainer upgraded = new PostgreSQLContainer(DockerImageName.parse(
                "postgis/postgis:17-3.5").asCompatibleSubstituteFor("postgres"))) {
            upgraded.start();
            var dataSource = new DriverManagerDataSource(upgraded.getJdbcUrl(),
                    upgraded.getUsername(), upgraded.getPassword());
            Flyway.configure().dataSource(dataSource).target("7").load().migrate();
            Flyway.configure().dataSource(dataSource).load().migrate();
            var upgradeJdbc = new JdbcTemplate(dataSource);
            assertTrue(upgradeJdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM pg_indexes "
                    + "WHERE indexname='ux_vehicle_reports_open_reporter_target')", Boolean.class));
            assertTrue(upgradeJdbc.queryForObject("SELECT 'VEHICLE'::report_target_type IS NOT NULL",
                    Boolean.class));
        }
    }

    @Test
    void draftPublishIsDefaultDeniedThenConsumptionIsIdempotent() {
        VehicleView draft = vehicles.create(owner, input());
        assertEquals("DRAFT", draft.listing().status());
        assertThrows(ResponseStatusException.class, () -> vehicles.detail(buyer, draft.listing().id()));
        ResponseStatusException denied = assertThrows(ResponseStatusException.class,
                () -> vehicles.publish(owner, draft.listing().id()));
        assertEquals(HttpStatus.FORBIDDEN, denied.getStatusCode());
        grant(owner, null, 1);
        UUID id = draft.listing().id();
        assertEquals("PUBLISHED", vehicles.publish(owner, id).listing().status());
        assertEquals("PAUSED", vehicles.pause(owner, id).listing().status());
        assertEquals("PUBLISHED", vehicles.publish(owner, id).listing().status());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM billing_usage_records "
                + "WHERE target_id=?", Integer.class, id));
        assertEquals("SOLD", vehicles.sold(owner, id).listing().status());
        assertThrows(ResponseStatusException.class, () -> vehicles.pause(owner, id));
        assertThrows(ResponseStatusException.class, () -> vehicles.remove(owner, id));
        assertEquals("SOLD", jdbc.queryForObject("SELECT status FROM vehicle_listings WHERE id=?",
                String.class, id));
    }

    @Test
    void lifecycleExpiryAndRentRulesAreEnforced() {
        VehicleView draft = vehicles.create(owner, input());
        grant(owner, null, 2);
        vehicles.publish(owner, draft.listing().id());
        jdbc.update("UPDATE vehicle_listings SET expires_at=now()-interval '1 hour' WHERE id=?",
                draft.listing().id());
        assertEquals("EXPIRED", vehicles.detail(owner, draft.listing().id()).listing().status());
        assertThrows(ResponseStatusException.class, () -> vehicles.publish(owner, draft.listing().id()));
        jdbc.update("UPDATE vehicle_listings SET expires_at=now()+interval '1 day' WHERE id=?",
                draft.listing().id());
        assertEquals("PUBLISHED", vehicles.publish(owner, draft.listing().id()).listing().status());

        VehicleInput sale = input();
        VehicleInput invalidRent = new VehicleInput(null, "COUNTRY", null, List.of(), "RENT",
                category, make, model, variant, "Rental", "A rental listing with valid description",
                2022, 1, "KM", "ELECTRIC", "AUTOMATIC", "FWD", "SUV", null, null, 5, 5,
                "GOOD", 2022, 0, Map.of(), null, null, BigDecimal.TEN, "EUR", "TOTAL",
                null, null, null, sale.location(), List.of(), null, false, false, Set.of());
        assertThrows(ResponseStatusException.class, () -> vehicles.create(owner, invalidRent));
    }

    @Test
    void categoryAttributesAndCatalogueRelationshipsAreValidated() {
        VehicleInput base = input();
        VehicleInput attributes = new VehicleInput(null, "COUNTRY", null, List.of(), "SALE",
                category, make, model, variant, base.title(), base.description(), base.modelYear(),
                base.mileage(), base.mileageUnit(), base.fuelType(), base.transmission(), base.driveType(),
                base.bodyType(), base.engineSizeCc(), base.colour(), base.doors(), base.seats(), base.condition(),
                base.registrationYear(), base.previousOwners(), Map.of("TOW_CAPACITY", 1500), base.motExpiry(),
                base.serviceHistory(), base.priceAmount(), base.currencyCode(), base.pricePeriod(),
                base.rentalDeposit(), base.mileageAllowance(), base.rentalConditions(), base.location(),
                base.featureIds(), base.expiresAt(), false, false, Set.of());
        assertEquals(1500, vehicles.create(owner, attributes).listing().additionalAttributes()
                .get("TOW_CAPACITY"));
        VehicleInput wrongModel = new VehicleInput(null, "COUNTRY", null, List.of(), "SALE",
                category, make, UUID.randomUUID(), variant, base.title(), base.description(), base.modelYear(),
                base.mileage(), base.mileageUnit(), base.fuelType(), base.transmission(), base.driveType(),
                base.bodyType(), base.engineSizeCc(), base.colour(), base.doors(), base.seats(), base.condition(),
                base.registrationYear(), base.previousOwners(), Map.of("UNKNOWN", 1), base.motExpiry(),
                base.serviceHistory(), base.priceAmount(), base.currencyCode(), base.pricePeriod(),
                base.rentalDeposit(), base.mileageAllowance(), base.rentalConditions(), base.location(),
                base.featureIds(), base.expiresAt(), false, false, Set.of());
        assertThrows(ResponseStatusException.class, () -> vehicles.create(owner, wrongModel));
    }

    @Test
    void businessRolesAndMembershipAreRecheckedLive() {
        for (String role : new String[]{"OWNER", "ADMINISTRATOR", "EDITOR", "LISTING_MANAGER"}) {
            UUID account = business(owner, role);
            VehicleView created = vehicles.create(owner, businessInput(account));
            assertEquals(account, created.listing().businessAccountId());
            jdbc.update("DELETE FROM vehicle_listing_features WHERE vehicle_listing_id=?",
                    created.listing().id());
            jdbc.update("DELETE FROM vehicle_listings WHERE id=?", created.listing().id());
            jdbc.update("UPDATE business_accounts SET status='CLOSED' WHERE id=?", account);
            jdbc.update("DELETE FROM business_account_members WHERE business_account_id=?", account);
            jdbc.update("DELETE FROM business_account_audit_events WHERE business_account_id=?", account);
            jdbc.update("DELETE FROM business_accounts WHERE id=?", account);
        }
        UUID billingOnly = business(owner, "BILLING_MANAGER");
        assertThrows(ResponseStatusException.class, () -> vehicles.create(owner, businessInput(billingOnly)));
        UUID account = business(owner, "LISTING_MANAGER");
        VehicleView created = vehicles.create(owner, businessInput(account));
        jdbc.update("UPDATE business_account_members SET revoked_at=now() WHERE business_account_id=? "
                + "AND user_id=?", account, owner);
        assertThrows(ResponseStatusException.class, () -> vehicles.pause(owner, created.listing().id()));
    }

    @Test
    void discoveryFiltersPostgisPaginationBlockingAndExpiry() {
        VehicleView listing = published();
        var found = vehicles.discover(buyer, search(null, null, null, "NEWEST"), null, 20);
        assertEquals(1, found.items().size());
        assertFalse(found.items().getFirst().listing().location().formattedAddress().contains("13.405"));
        var nearby = vehicles.discover(buyer, new VehicleSearch(null, null, null, null, null, null,
                null, null, null, null, null, null, null, null, null, null, null, null, null, null,
                null, null, null, 52.521, 13.404, 5000.0, Map.of(), "DISTANCE"), null, 20);
        assertEquals(1, nearby.items().size());
        var filtered = vehicles.discover(buyer, search("HYBRID", new BigDecimal("12000"),
                new BigDecimal("13000"), "PRICE_ASC"), null, 1);
        assertEquals(1, filtered.items().size());
        assertThrows(ResponseStatusException.class, () -> vehicles.discover(buyer,
                search(null, new BigDecimal("13000"), new BigDecimal("12000"), "PRICE_ASC"),
                null, 20));
        jdbc.update("INSERT INTO user_blocks(blocker_user_id,blocked_user_id) VALUES(?,?)", buyer, owner);
        assertTrue(vehicles.discover(buyer, search(null, null, null, "NEWEST"), null, 20)
                .items().isEmpty());
        jdbc.update("DELETE FROM user_blocks");
        jdbc.update("UPDATE vehicle_listings SET expires_at=now()-interval '1 minute' WHERE id=?",
                listing.listing().id());
        assertTrue(vehicles.discover(buyer, search(null, null, null, "NEWEST"), null, 20)
                .items().isEmpty());
    }

    private VehicleSearch search(String fuel, BigDecimal min, BigDecimal max, String sort) {
        return new VehicleSearch(null, null, null, null, null, null, null, null, null, null,
                min, max, min == null && max == null && !sort.startsWith("PRICE") ? null : "EUR",
                fuel, null, null, null, null, null, null, null, null, null, null, null, null,
                Map.of(), sort);
    }

    @Test
    void communityFilterIncludesSelectedCommunitiesListings() {
        VehicleView draft = vehicles.create(owner, new VehicleInput(null, "SELECTED_COMMUNITIES",
                null, List.of(community), "SALE", category, make, model, variant, "Shared car",
                "A car visible only to selected communities", 2021, 8000, "KM", "PETROL",
                "MANUAL", "FWD", "HATCHBACK", null, null, 5, 5, "GOOD", 2021, 0, Map.of(),
                null, null, new BigDecimal("9000.00"), "EUR", "TOTAL", null, null, null,
                new VehicleInput.LocationInput("Berlin", "Berlin", "Berlin, Germany", null, null),
                List.of(), null, false, false, Set.of()));
        grant(owner, null, 1);
        vehicles.publish(owner, draft.listing().id());
        var found = vehicles.discover(buyer, new VehicleSearch(null, null, null, null, null,
                null, null, null, null, null, null, null, null, null, null, null, null, null,
                null, null, community, null, null, null, null, null, Map.of(), "NEWEST"),
                null, 20);
        assertEquals(1, found.items().size());
    }

    @Test
    void mediaPurposeReadinessOwnershipCoverAndBatchUrlsAreEnforced() {
        VehicleView draft = vehicles.create(owner, input());
        UUID first = media(owner, "VEHICLE", "READY");
        UUID second = media(owner, "VEHICLE", "READY");
        VehicleView updated = vehicles.replaceMedia(owner, draft.listing().id(),
                List.of(first, second), second);
        assertEquals(2, updated.media().size());
        assertEquals(second, updated.media().get(1).id());
        assertTrue(updated.media().get(1).cover());
        assertTrue(updated.media().get(0).downloadUrl().startsWith("https://media.test/"));
        UUID wrongPurpose = media(owner, "JOB", "READY");
        assertThrows(ResponseStatusException.class, () -> vehicles.replaceMedia(owner,
                draft.listing().id(), List.of(wrongPurpose), null));
        UUID otherUsers = media(other, "VEHICLE", "READY");
        assertThrows(ResponseStatusException.class, () -> vehicles.replaceMedia(owner,
                draft.listing().id(), List.of(otherUsers), null));
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM vehicle_listing_media "
                + "WHERE vehicle_listing_id=?", Integer.class, draft.listing().id()));
    }

    private UUID media(UUID ownerId, String purpose, String status) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,object_key,purpose,"
                + "mime_type,status) VALUES(?,?,?,?,?,'image/jpeg',?::media_status)",
                id, ownerId, "test", ownerId + "/" + id, purpose, status);
        return id;
    }

    @Test
    void savesReportsAndContactArePrivateIdempotentAndServerResolved() {
        VehicleView listing = published();
        vehicles.save(buyer, listing.listing().id());
        vehicles.save(buyer, listing.listing().id());
        assertEquals(1, vehicles.saved(buyer, null, 20).items().size());
        UUID conversation = vehicles.contact(buyer, listing.listing().id(), null);
        assertNotNull(conversation);
        assertEquals(conversation, vehicles.contact(buyer, listing.listing().id(), null));
        UUID report = vehicles.report(buyer, listing.listing().id(), "SCAM", "Suspicious price");
        assertNotNull(report);
        assertThrows(ResponseStatusException.class, () -> vehicles.report(buyer,
                listing.listing().id(), "SCAM", null));
        vehicles.pause(owner, listing.listing().id());
        assertTrue(vehicles.saved(buyer, null, 20).items().isEmpty());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM vehicle_listing_saves "
                + "WHERE vehicle_listing_id=?", Integer.class, listing.listing().id()));
        vehicles.unsave(buyer, listing.listing().id());
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM vehicle_listing_saves "
                + "WHERE vehicle_listing_id=?", Integer.class, listing.listing().id()));
    }

    @Test
    void httpRoutesRequireAuthenticationAndPreserveVehicleErrorCodes() throws Exception {
        mvc.perform(get("/api/v1/vehicles")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/vehicles/categories").with(asUser(buyer)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].category.key").value("CAR"));
        VehicleView draft = vehicles.create(owner, input());
        mvc.perform(post("/api/v1/vehicles/{id}/publish", draft.listing().id()).with(asUser(owner)))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code")
                .value("ENTITLEMENT_NOT_CONFIGURED"));
        mvc.perform(post("/api/v1/vehicles").with(asUser(owner)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"bad\"}")).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").exists());
    }
}
