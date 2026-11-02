package com.diasporum.backend.propertylistings;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.diasporum.backend.businessaccounts.internal.application.BusinessAccountService;
import com.diasporum.backend.community.internal.application.CommunityService;
import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.propertylistings.internal.application.PropertyDiscoveryService;
import com.diasporum.backend.propertylistings.internal.application.PropertyEngagementService;
import com.diasporum.backend.propertylistings.internal.application.PropertyLifecycleService;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.AddressInput;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.ContactInput;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PropertyCommand;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PropertyDetail;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.SearchCriteria;
import com.diasporum.backend.propertylistings.internal.application.PropertyQueryService;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
import org.springframework.dao.DataIntegrityViolationException;
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

/** Real migrated PostgreSQL/PostGIS coverage for the Property Marketplace. */
@SpringBootTest
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class PropertyMarketplaceIntegrationTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired PropertyLifecycleService lifecycle;
    @Autowired PropertyQueryService query;
    @Autowired PropertyDiscoveryService discovery;
    @Autowired PropertyEngagementService engagement;
    @Autowired BusinessAccountService businessService;
    @Autowired CommunityService communities;
    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;

    private UUID origin;
    private UUID destination;
    private UUID community;
    private UUID propertyType;
    private UUID amenity;
    private UUID owner;
    private UUID member;
    private UUID outsider;
    private UUID abroad;

    @BeforeEach
    void setup() {
        jdbc.execute("TRUNCATE reports,direct_messages,direct_conversations,"
                + "property_listing_saves,property_listing_media,property_listing_amenities,"
                + "property_listing_communities,property_listing_contacts,property_listings,"
                + "media_objects,billing_usage_records,billing_entitlement_grants,"
                + "business_account_members,business_accounts,community_memberships,"
                + "external_identities,profiles,communities,addresses,countries CASCADE");
        jdbc.update("INSERT INTO countries(name,iso2,iso3) VALUES"
                + "('Ethiopia','ET','ETH'),('Germany','DE','DEU')");
        origin = country("ET");
        destination = country("DE");
        jdbc.update("INSERT INTO communities(name,slug,origin_country_id,"
                + "destination_country_id) VALUES('ET in DE','et-in-de',?,?)", origin,
                destination);
        community = jdbc.queryForObject("SELECT id FROM communities", UUID.class);
        jdbc.update("INSERT INTO country_property_types(country_id,property_type_id,local_name,"
                + "sort_order) SELECT ?,id,default_name,sort_order FROM property_types"
                + " ON CONFLICT DO NOTHING", destination);
        propertyType = jdbc.queryForObject("SELECT id FROM property_types"
                + " WHERE type_key='APARTMENT'", UUID.class);
        amenity = jdbc.queryForObject("SELECT id FROM property_amenities"
                + " WHERE amenity_key='PARKING'", UUID.class);
        owner = user("property-owner");
        member = user("property-member");
        outsider = user("property-outsider");
        abroad = user("property-abroad");
        for (UUID id : new UUID[]{owner, member, outsider, abroad}) {
            jdbc.update("UPDATE profiles SET origin_country_id=?,current_country_id=?"
                    + " WHERE id=?", origin, destination, id);
        }
        communities.join(owner, community);
        communities.join(member, community);
        jdbc.update("UPDATE profiles SET current_country_id=? WHERE id=?", origin, abroad);
    }

    @Test
    void freshMigrationProvidesPropertySchemaAfterMainMigrations() {
        assertEquals(4, jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history"
                + " WHERE version IN ('6','7','8','9') AND success", Integer.class));
        assertPropertySchema(jdbc);
    }

    @Test
    void propertyMigrationUpgradesDatabaseAtBusinessDirectoryV8() {
        try (PostgreSQLContainer upgraded = new PostgreSQLContainer(
                DockerImageName.parse("postgis/postgis:17-3.5")
                        .asCompatibleSubstituteFor("postgres"))) {
            upgraded.start();
            var dataSource = new DriverManagerDataSource(upgraded.getJdbcUrl(),
                    upgraded.getUsername(), upgraded.getPassword());
            Flyway.configure().dataSource(dataSource).target("8").load().migrate();
            var upgradeJdbc = new JdbcTemplate(dataSource);
            assertEquals(3, upgradeJdbc.queryForObject("SELECT count(*)"
                    + " FROM flyway_schema_history WHERE version IN ('6','7','8')"
                    + " AND success", Integer.class));
            assertFalse(upgradeJdbc.queryForObject("SELECT EXISTS(SELECT 1"
                    + " FROM flyway_schema_history WHERE version='9')", Boolean.class));
            assertFalse(upgradeJdbc.queryForObject("SELECT EXISTS(SELECT 1"
                    + " FROM information_schema.columns WHERE table_name='property_listings'"
                    + " AND column_name='closed_at')", Boolean.class));
            upgradeJdbc.update("INSERT INTO countries(name,iso2,iso3)"
                    + " VALUES('Germany','DE','DEU')");

            Flyway.configure().dataSource(dataSource).load().migrate();

            assertEquals(1, upgradeJdbc.queryForObject("SELECT count(*)"
                    + " FROM flyway_schema_history WHERE version='9'"
                    + " AND script='V9__property_marketplace.sql' AND success", Integer.class));
            assertTrue(upgradeJdbc.queryForObject("SELECT EXISTS(SELECT 1"
                    + " FROM information_schema.columns WHERE table_name='job_listings'"
                    + " AND column_name='deleted_at')", Boolean.class));
            assertTrue(upgradeJdbc.queryForObject("SELECT EXISTS(SELECT 1"
                    + " FROM information_schema.columns WHERE table_name='business_locations'"
                    + " AND column_name='is_active')", Boolean.class));
            assertPropertySchema(upgradeJdbc);
        }
    }

    private static void assertPropertySchema(JdbcTemplate database) {
        assertTrue(database.queryForObject("SELECT EXISTS(SELECT 1"
                + " FROM information_schema.columns WHERE table_name='property_listings'"
                + " AND column_name='closed_at')", Boolean.class));
        assertTrue(database.queryForObject("SELECT EXISTS(SELECT 1 FROM pg_constraint"
                + " WHERE conname='ck_property_listing_closed_at')", Boolean.class));
        String statusConstraint = database.queryForObject("SELECT pg_get_constraintdef(oid)"
                + " FROM pg_constraint WHERE conname='property_listings_status_check'",
                String.class);
        assertTrue(statusConstraint.contains("CLOSED"));
        for (String index : new String[]{"ix_property_owner_user_management",
                "ix_property_owner_business_management", "ix_property_discovery_cursor",
                "ix_property_bedrooms_price", "ux_reports_open_reporter_target"}) {
            assertTrue(database.queryForObject("SELECT EXISTS(SELECT 1 FROM pg_indexes"
                    + " WHERE indexname=?)", Boolean.class, index));
        }
        assertTrue(database.queryForObject("SELECT EXISTS(SELECT 1 FROM pg_enum e"
                + " JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='report_target_type'"
                + " AND e.enumlabel='PROPERTY_LISTING')", Boolean.class));
        assertEquals(9, database.queryForObject("SELECT count(*) FROM property_types",
                Integer.class));
        assertEquals(12, database.queryForObject("SELECT count(*) FROM property_amenities",
                Integer.class));
        assertTrue(database.queryForObject("SELECT count(*)>=9 FROM country_property_types",
                Boolean.class));
        String mediaConstraint = database.queryForObject("SELECT pg_get_constraintdef(oid)"
                + " FROM pg_constraint WHERE conname='media_objects_purpose_check'", String.class);
        for (String purpose : new String[]{"MESSAGE_IMAGE", "MESSAGE_DOCUMENT", "JOB",
                "BUSINESS", "PROPERTY"}) {
            assertTrue(mediaConstraint.contains(purpose));
        }
    }

    @Test
    void lifecycleMediaAndPrivateAddressProtection() {
        PropertyDetail draft = lifecycle.create(owner, command(owner, null, "Berlin flat",
                new BigDecimal("1200"), 2, 52.520008, 13.404954));
        assertEquals("DRAFT", draft.item().property().status());
        assertEquals(52.52, draft.item().location().latitude());
        assertEquals(13.40, draft.item().location().longitude());
        UUID id = draft.item().property().id();
        assertThrows(ResponseStatusException.class, () -> lifecycle.publish(owner, id));

        UUID first = media(owner, "first");
        UUID second = media(owner, "second");
        lifecycle.attachMedia(owner, id, first);
        lifecycle.attachMedia(owner, id, second);
        PropertyDetail reordered = lifecycle.reorderMedia(owner, id, List.of(second, first),
                second);
        assertEquals(second, reordered.media().get(0).mediaId());
        assertTrue(reordered.media().get(0).cover());

        PropertyDetail published = lifecycle.publish(owner, id);
        assertEquals("PUBLISHED", published.item().property().status());
        assertNotNull(published.item().property().publishedAt());
        assertEquals("PAUSED", lifecycle.pause(owner, id).item().property().status());
        assertEquals("PUBLISHED", lifecycle.reopen(owner, id).item().property().status());
        PropertyDetail closed = lifecycle.close(owner, id);
        assertEquals("CLOSED", closed.item().property().status());
        assertNotNull(closed.item().property().closedAt());
        assertThrows(DataIntegrityViolationException.class,
                () -> jdbc.update("UPDATE property_listings SET closed_at=NULL WHERE id=?", id));
        assertThrows(ResponseStatusException.class, () -> lifecycle.reopen(owner, id));
        assertThrows(ResponseStatusException.class, () -> lifecycle.update(owner, id,
                command(owner, null, "Cannot edit", new BigDecimal("1200"), 2,
                        52.520008, 13.404954)));

        String response = jdbc.queryForObject("SELECT row_to_json(p)::text FROM"
                + " (SELECT address_id FROM property_listings WHERE id=?) p", String.class, id);
        assertNotNull(response); // internal reference exists but is not part of the API DTO
        assertNull(closed.item().property().additionalAttributes().get("addressLine1"));
    }

    @Test
    void discoveryFiltersCursorSpatialAndSaves() {
        PropertyDetail one = published(owner, null, "Sunny Berlin apartment",
                new BigDecimal("1000"), 2, 52.5200, 13.4050);
        published(owner, null, "Large Berlin apartment", new BigDecimal("1800"), 4,
                52.5300, 13.4100);
        published(owner, null, "Hamburg apartment", new BigDecimal("900"), 1,
                53.5511, 9.9937);

        var first = discovery.discover(member, criteria(null, null, null, null, null),
                null, 2);
        assertEquals(2, first.items().size());
        assertNotNull(first.nextCursor());
        var second = discovery.discover(member, criteria(null, null, null, null, null),
                first.nextCursor(), 2);
        assertEquals(1, second.items().size());
        assertTrue(first.items().stream().noneMatch(a -> second.items().stream()
                .anyMatch(b -> b.property().id().equals(a.property().id()))));

        var filtered = discovery.discover(member, criteria("Berlin", "RENT",
                new BigDecimal("1500"), 3, null), null, 20);
        assertEquals(1, filtered.items().size());
        assertEquals("Large Berlin apartment", filtered.items().get(0).property().title());
        var nearby = discovery.discover(member, new SearchCriteria(null, null, null, null,
                null, null, null, null, null, null, null, null, 52.52, 13.40, 10.0),
                null, 20);
        assertEquals(2, nearby.items().size());
        assertEquals(0, discovery.discover(abroad, criteria(null, null, null, null, null),
                null, 20).items().size());

        UUID id = one.item().property().id();
        engagement.save(member, id);
        engagement.save(member, id);
        assertEquals(1, discovery.saved(member, null, 20).items().size());
        engagement.unsave(member, id);
        engagement.unsave(member, id);
        assertEquals(0, discovery.saved(member, null, 20).items().size());
        assertEquals(3, discovery.mine(owner, null, null, null, 20).items().size());
        assertEquals(1, discovery.mine(owner, "PUBLISHED", null, null, 1).items().size());
    }

    @Test
    void businessRolesAndRevocationAreLive() {
        var account = businessService.create(owner, "Property Workspace");
        jdbc.update("INSERT INTO business_account_members(business_account_id,user_id,"
                + "role_key,invited_by_user_id,updated_by_user_id,accepted_at)"
                + " VALUES(?,?,'LISTING_MANAGER',?,?,now())", account.id(), member, owner,
                owner);
        jdbc.update("INSERT INTO business_account_members(business_account_id,user_id,"
                + "role_key,invited_by_user_id,updated_by_user_id,accepted_at)"
                + " VALUES(?,?,'EDITOR',?,?,now())", account.id(), outsider, owner, owner);
        PropertyDetail listing = lifecycle.create(member, command(member, account.id(),
                "Business listing", new BigDecimal("2000"), 3, 52.52, 13.40));
        assertThrows(ResponseStatusException.class, () -> lifecycle.create(outsider,
                command(outsider, account.id(), "Editor listing", new BigDecimal("1000"),
                        1, 52.52, 13.40)));
        UUID id = listing.item().property().id();
        jdbc.update("UPDATE business_account_members SET revoked_at=now()"
                + " WHERE business_account_id=? AND user_id=?", account.id(), member);
        ResponseStatusException revoked = assertThrows(ResponseStatusException.class,
                () -> lifecycle.close(member, id));
        assertEquals(HttpStatus.FORBIDDEN, revoked.getStatusCode());
        assertEquals("CLOSED", lifecycle.close(owner, id).item().property().status());
    }

    @Test
    void configuredBillingIsAtomicAndIdempotent() {
        PropertyDetail unconfigured = published(owner, null, "Unconfigured",
                new BigDecimal("1000"), 1, 52.52, 13.40);
        assertEquals("PUBLISHED", unconfigured.item().property().status());
        UUID feature = jdbc.queryForObject("SELECT id FROM billing_features"
                + " WHERE feature_key='PROPERTY_LISTING_PUBLISH'", UUID.class);
        jdbc.update("INSERT INTO billing_entitlement_grants(feature_id,user_id,source_type,"
                + "quantity_granted) VALUES(?,?,'ADMIN_GRANT',1)", feature, owner);
        PropertyDetail charged = published(owner, null, "Charged", new BigDecimal("1000"),
                1, 52.52, 13.40);
        lifecycle.publish(owner, charged.item().property().id());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM billing_usage_records"
                + " WHERE user_id=?", Integer.class, owner));
        assertEquals(1, jdbc.queryForObject("SELECT quantity_used FROM"
                + " billing_entitlement_grants WHERE user_id=?", Integer.class, owner));
        PropertyDetail blocked = lifecycle.create(owner, command(owner, null, "Blocked",
                new BigDecimal("1000"), 1, 52.52, 13.40));
        lifecycle.attachMedia(owner, blocked.item().property().id(), media(owner, "blocked"));
        ResponseStatusException required = assertThrows(ResponseStatusException.class,
                () -> lifecycle.publish(owner, blocked.item().property().id()));
        assertEquals(HttpStatus.PAYMENT_REQUIRED, required.getStatusCode());
        assertEquals("DRAFT", query.detail(owner, blocked.item().property().id())
                .item().property().status());
    }

    @Test
    void enquiryAndSharedReporting() {
        PropertyDetail listing = published(owner, null, "Contact me",
                new BigDecimal("1000"), 1, 52.52, 13.40);
        UUID id = listing.item().property().id();
        UUID conversation = engagement.enquiry(member, id);
        assertEquals(conversation, engagement.enquiry(member, id));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM direct_conversations"
                + " WHERE context_type='PROPERTY_LISTING' AND context_id=?", Integer.class, id));
        assertNotNull(engagement.report(member, id, "SPAM", "Duplicate listing"));
        ResponseStatusException duplicate = assertThrows(ResponseStatusException.class,
                () -> engagement.report(member, id, "OTHER", null));
        assertEquals(HttpStatus.CONFLICT, duplicate.getStatusCode());
        assertThrows(ResponseStatusException.class, () -> engagement.enquiry(owner, id));
        assertThrows(ResponseStatusException.class, () -> engagement.report(abroad, id,
                "SPAM", null));
    }

    @Test
    void httpCreateDiscoveryAndValidation() throws Exception {
        String body = """
                {"countryId":"%s","propertyTypeId":"%s","visibilityScope":"COUNTRY",
                 "listingPurpose":"RENT","title":"HTTP property","description":"HTTP draft",
                 "additionalAttributes":{"yearBuilt":2020},"priceAmount":1200,
                 "currencyCode":"EUR","pricePeriod":"MONTH","bedrooms":2,"bathrooms":1,
                 "floorArea":55.5,"floorAreaUnit":"SQM","furnishedStatus":"FURNISHED",
                 "address":{"addressLine1":"1 Private Street","city":"Berlin",
                 "postalCode":"10115","latitude":52.520008,"longitude":13.404954},
                 "amenityIds":["%s"]}
                """.formatted(destination, propertyType, amenity);
        mvc.perform(post("/api/v1/properties").with(as(owner)).contentType(MediaType.APPLICATION_JSON)
                        .content(body)).andExpect(status().isCreated())
                .andExpect(jsonPath("$.item.property.status").value("DRAFT"))
                .andExpect(jsonPath("$.item.location.latitude").value(52.52))
                .andExpect(jsonPath("$.item.property.addressLine1").doesNotExist())
                .andExpect(jsonPath("$.item.property.addressId").doesNotExist());
        UUID id = jdbc.queryForObject("SELECT id FROM property_listings WHERE title=?"
                , UUID.class, "HTTP property");
        mvc.perform(get("/api/v1/properties/types").with(as(member))
                        .param("countryId", destination.toString())).andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].typeKey").exists());
        mvc.perform(get("/api/v1/properties/" + id).with(as(member)))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/properties").with(as(member))).andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0));
        mvc.perform(put("/api/v1/properties/" + id + "/save").with(as(member)))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/properties")).andExpect(status().isUnauthorized());
    }

    private PropertyDetail published(UUID actor, UUID business, String title, BigDecimal price,
            int bedrooms, double lat, double lng) {
        PropertyDetail draft = lifecycle.create(actor, command(actor, business, title, price,
                bedrooms, lat, lng));
        UUID id = draft.item().property().id();
        lifecycle.attachMedia(actor, id, media(actor, title));
        return lifecycle.publish(actor, id);
    }

    private PropertyCommand command(UUID actor, UUID business, String title, BigDecimal price,
            int bedrooms, double lat, double lng) {
        return new PropertyCommand(destination, null, business, propertyType, "COUNTRY", "RENT",
                title, "Integration property description", Map.of("yearBuilt", 2020), price,
                "EUR", "MONTH", new AddressInput("1 Private Street", null, "Berlin", "Berlin",
                "10115", null, lat, lng), bedrooms, 1, 1, new BigDecimal("55.5"), "SQM",
                "FURNISHED", new BigDecimal("500"), true, 6, LocalDate.now().plusDays(7),
                "ASSURED_SHORTHOLD", "GOOD", null, List.of(amenity),
                new ContactInput(null, null, actor + "@example.com", "EMAIL", false, false,
                        true));
    }

    private SearchCriteria criteria(String city, String purpose, BigDecimal minPrice,
            Integer minBedrooms, String search) {
        return new SearchCriteria(null, null, null, purpose, minPrice, null, minBedrooms, null,
                null, null, city, search, null, null, null);
    }

    private UUID media(UUID actor, String key) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,object_key,purpose,"
                + "mime_type,status) VALUES(?,?,?,?,?,'image/jpeg','READY')", id, actor,
                "test", actor + "/property/" + key + "/" + id, "PROPERTY");
        return id;
    }

    private UUID user(String subject) {
        return IdentityTestSupport.provision(ctx, ISSUER, subject);
    }

    private UUID country(String iso2) {
        return jdbc.queryForObject("SELECT id FROM countries WHERE iso2=?", UUID.class, iso2);
    }

    private RequestPostProcessor as(UUID userId) {
        return authentication(new UsernamePasswordAuthenticationToken(
                new DiasporumUserPrincipal(userId, UUID.randomUUID(), userId + "@test.com",
                        List.of()), null, List.of()));
    }
}
