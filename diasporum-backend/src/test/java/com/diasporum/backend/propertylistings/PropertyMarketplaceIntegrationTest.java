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
import com.diasporum.backend.businessdirectory.internal.application.BusinessDirectoryService;
import com.diasporum.backend.community.internal.application.CommunityService;
import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.propertylistings.internal.application.PropertyDiscoveryService;
import com.diasporum.backend.propertylistings.internal.application.PropertyEngagementService;
import com.diasporum.backend.propertylistings.internal.application.PropertyExpiryWorker;
import com.diasporum.backend.propertylistings.internal.application.PropertyLifecycleService;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.AddressInput;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.BrowseOptions;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.ContactInput;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PropertyCommand;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PropertyDetail;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.SearchCriteria;
import com.diasporum.backend.propertylistings.internal.application.PropertyQueryService;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import java.math.BigDecimal;
import java.time.Instant;
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
    @Autowired PropertyExpiryWorker expiryWorker;
    @Autowired BusinessAccountService businessService;
    @Autowired BusinessDirectoryService directory;
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
                null, null, null, null, null, null, null, null, 52.52, 13.40, 10.0, null),
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
        assertEquals(3, discovery.mine(owner, null, null, null, null, 20).items().size());
        assertEquals(1, discovery.mine(owner, "PUBLISHED", null, null, null, 1).items().size());
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
    void cityOnlyListingPublishesWithoutDiscoveryPoint() {
        PropertyDetail draft = lifecycle.create(owner, command(owner, null,
                "City only flat", new BigDecimal("800"), 1, null, null));
        UUID id = draft.item().property().id();
        assertNull(draft.item().location().latitude());
        assertEquals("Berlin", draft.item().location().city());
        lifecycle.attachMedia(owner, id, media(owner, "city"));
        PropertyDetail pub = lifecycle.publish(owner, id);
        assertEquals("PUBLISHED", pub.item().property().status());
        assertNull(pub.item().location().latitude());
        assertEquals(1, discovery.discover(member,
                criteria("Berlin", "RENT", null, null, null), null, 20).items().size());
        assertEquals(0, discovery.discover(member, new SearchCriteria(null, null, null,
                null, null, null, null, null, null, null, null, null, 52.52, 13.40,
                50.0, null), null, 20).items().size());
    }

    @Test
    void privateAddressAndAudienceOnlyVisibleToManagers() {
        PropertyDetail listing = published(owner, null, "Private flat",
                new BigDecimal("900"), 1, 52.520008, 13.404954);
        UUID id = listing.item().property().id();
        PropertyDetail managerView = query.detail(owner, id);
        assertEquals("1 Private Street", managerView.privateAddress().addressLine1());
        assertEquals("10115", managerView.privateAddress().postalCode());
        assertEquals(52.520008, managerView.privateAddress().latitude());
        assertNull(query.detail(member, id).privateAddress());
        assertTrue(query.detail(member, id).communityIds().isEmpty());

        PropertyDetail audience = lifecycle.create(owner, new PropertyCommand(destination,
                null, null, null, propertyType, "SELECTED_COMMUNITIES", "RENT", "Audience flat",
                "Integration property description", Map.of(), new BigDecimal("700"),
                "EUR", "MONTH", new AddressInput(null, null, "Berlin", null, null, null,
                null, null), 1, 1, 1, new BigDecimal("40"), "SQM", null, null, null,
                null, null, null, null, List.of(community), List.of(), null));
        UUID audienceId = audience.item().property().id();
        lifecycle.attachMedia(owner, audienceId, media(owner, "audience"));
        lifecycle.publish(owner, audienceId);
        assertEquals(List.of(community), query.detail(owner, audienceId).communityIds());
        assertTrue(query.detail(member, audienceId).communityIds().isEmpty());
    }

    @Test
    void expiryTransitionsAndReopen() {
        PropertyDetail listing = published(owner, null, "Expiring flat",
                new BigDecimal("950"), 1, 52.52, 13.40);
        UUID id = listing.item().property().id();
        jdbc.update("UPDATE property_listings SET expires_at=now()-interval '1 hour'"
                + " WHERE id=?", id);
        // Lazy expiry on first touch: public viewers no longer see the listing.
        assertThrows(ResponseStatusException.class, () -> query.detail(member, id));
        assertEquals("EXPIRED", jdbc.queryForObject("SELECT status FROM property_listings"
                + " WHERE id=?", String.class, id));
        assertEquals("EXPIRED", query.detail(owner, id).item().property().status());
        PropertyDetail reopened = lifecycle.reopen(owner, id);
        assertEquals("PUBLISHED", reopened.item().property().status());
        assertTrue(reopened.item().property().expiresAt().isAfter(Instant.now()));

        // Scheduled worker sweeps untouched expired rows.
        jdbc.update("UPDATE property_listings SET expires_at=now()-interval '1 hour'"
                + " WHERE id=?", id);
        assertEquals(1, expiryWorker.expire());
        assertEquals("EXPIRED", jdbc.queryForObject("SELECT status FROM property_listings"
                + " WHERE id=?", String.class, id));
    }

    @Test
    void terminalSaleAndRentalOutcomes() {
        PropertyDetail rent = published(owner, null, "Rental outcome",
                new BigDecimal("1000"), 1, 52.52, 13.40);
        UUID rentId = rent.item().property().id();
        assertThrows(ResponseStatusException.class, () -> lifecycle.sold(owner, rentId));
        assertEquals("RENTED", lifecycle.rented(owner, rentId).item().property().status());
        assertEquals("RENTED", lifecycle.rented(owner, rentId).item().property().status());
        assertThrows(ResponseStatusException.class, () -> lifecycle.update(owner, rentId,
                command(owner, null, "No edits", new BigDecimal("1000"), 1, 52.52, 13.40)));
        assertThrows(ResponseStatusException.class, () -> lifecycle.close(owner, rentId));
        assertThrows(ResponseStatusException.class, () -> lifecycle.pause(owner, rentId));
        assertThrows(ResponseStatusException.class, () -> lifecycle.reopen(owner, rentId));
        assertThrows(ResponseStatusException.class, () -> query.detail(member, rentId));

        PropertyDetail sale = lifecycle.create(owner, new PropertyCommand(destination,
                null, null, null, propertyType, "COUNTRY", "SALE", "Sale outcome",
                "Integration property description", Map.of(), new BigDecimal("250000"),
                "EUR", "TOTAL", new AddressInput("2 Sale Street", null, "Berlin",
                "Berlin", "10116", null, 52.51, 13.41), 3, 2, 1, new BigDecimal("90"),
                "SQM", null, null, null, null, null, "FREEHOLD", "GOOD", null,
                List.of(), null));
        UUID saleId = sale.item().property().id();
        lifecycle.attachMedia(owner, saleId, media(owner, "sale"));
        lifecycle.publish(owner, saleId);
        assertThrows(ResponseStatusException.class,
                () -> lifecycle.rented(owner, saleId));
        assertEquals("SOLD", lifecycle.sold(owner, saleId).item().property().status());
        assertEquals("SOLD", lifecycle.sold(owner, saleId).item().property().status());
    }

    @Test
    void enquiryNotifiesOwnerOnce() {
        PropertyDetail listing = published(owner, null, "Notify me",
                new BigDecimal("800"), 1, 52.52, 13.40);
        UUID id = listing.item().property().id();
        engagement.enquiry(member, id);
        engagement.enquiry(member, id); // reused conversation must not re-notify
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM notifications"
                + " WHERE recipient_user_id=? AND type='PROPERTY_ENQUIRY'"
                + " AND target_id=?", Integer.class, owner, id));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM notifications"
                + " WHERE recipient_user_id=? AND type='PROPERTY_ENQUIRY'",
                Integer.class, member));
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

    @Test
    void priceSortUsesStableCursorsAndCountsBeforePagination() {
        published(owner, null, "Low", new BigDecimal("900"), 1, null, null);
        published(owner, null, "Tie one", new BigDecimal("1200"), 2, null, null);
        published(owner, null, "Tie two", new BigDecimal("1200"), 2, null, null);
        published(owner, null, "High", new BigDecimal("1800"), 3, null, null);
        for (String sort : List.of("NEWEST", "PRICE_ASC", "PRICE_DESC")) {
            var options = sortOptions(sort);
            var expected = discovery.discover(member, null, null, 20, options).items();
            var ids = new java.util.ArrayList<UUID>();
            String cursor = null;
            do {
                var page = discovery.discover(member, null, cursor, 1, options);
                assertEquals(4L, page.totalCount());
                page.items().forEach(item -> ids.add(item.property().id()));
                cursor = page.nextCursor();
                assertTrue(ids.size() <= 4, "Cursor must advance across tied prices");
            } while (cursor != null);
            assertEquals(expected.stream().map(item -> item.property().id()).toList(), ids);
            assertEquals(4, new java.util.HashSet<>(ids).size());
            if ("PRICE_ASC".equals(sort)) assertEquals("Low", expected.getFirst().property().title());
            if ("PRICE_DESC".equals(sort)) assertEquals("High", expected.getFirst().property().title());
        }
        var filtered = discovery.discover(member, criteria(null, null, new BigDecimal("1200"), null, null), null, 1);
        assertEquals(3L, filtered.totalCount());
        assertEquals(0L, discovery.discover(member, criteria(null, null, null, null, "Missing"), null, 1).totalCount());
        var first = discovery.discover(member, null, null, 1, sortOptions("PRICE_ASC"));
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ResponseStatusException.class,
                () -> discovery.discover(member, null, first.nextCursor(), 1, sortOptions("PRICE_DESC"))).getStatusCode());
    }

    @Test
    void advancedFiltersAndLocationSearchUseTheSameCountPredicate() throws Exception {
        UUID match = published(owner, null, "Matching", new BigDecimal("1000"), 2, null, null).item().property().id();
        UUID other = published(owner, null, "Other", new BigDecimal("1500"), 3, null, null).item().property().id();
        jdbc.update("UPDATE property_listings SET currency_code='USD',floor_area=100,"
                + "rental_deposit=900,bills_included=false,minimum_tenancy_months=12,bathrooms=2 WHERE id=?", other);
        mvc.perform(get("/api/v1/properties").with(as(member))
                        .param("listingPurpose", "RENT").param("sort", "PRICE_ASC")
                        .param("currencyCode", "EUR").param("pricePeriod", "MONTH")
                        .param("minFloorArea", "50").param("maxFloorArea", "60").param("floorAreaUnit", "SQM")
                        .param("availableBy", LocalDate.now().plusDays(10).toString())
                        .param("maxDeposit", "500").param("billsIncluded", "true")
                        .param("maxTenancyMonths", "6").param("maxBathrooms", "1")
                        .param("conditionKey", "GOOD").param("tenure", "assured_shorthold"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalCount").value(1))
                .andExpect(jsonPath("$.items[0].property.id").value(match.toString()));
        mvc.perform(get("/api/v1/properties").with(as(member)).param("billsIncluded", "false"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalCount").value(1))
                .andExpect(jsonPath("$.items[0].property.id").value(other.toString()));
        assertEquals(2L, discovery.discover(member, criteria(null, null, null, null, "berlin"), null, 20).totalCount());
        assertEquals(2L, discovery.discover(member, criteria("ber", null, null, null, null), null, 20).totalCount());
        assertEquals(0L, discovery.discover(member, criteria(null, null, null, null, "Private Street"), null, 20).totalCount());
        for (var parameter : Map.of("sort", "UNSUPPORTED", "minFloorArea", "20", "currencyCode", "bad",
                "maxDeposit", "-1", "maxBathrooms", "-1", "cursor", "malformed", "availableBy", "not-a-date").entrySet()) {
            mvc.perform(get("/api/v1/properties").with(as(member)).param(parameter.getKey(), parameter.getValue()))
                    .andExpect(status().isBadRequest());
        }
    }

    @Test
    void countryBoundaryAppliesToEveryPublicScopeAndEntryPoint() throws Exception {
        for (String scope : List.of("COUNTRY", "COMMUNITY", "SELECTED_COMMUNITIES")) {
            UUID id = published(owner, null, scope, new BigDecimal("1000"), 2, null, null).item().property().id();
            jdbc.update("UPDATE property_listings SET visibility_scope=?::visibility_scope,community_id=? WHERE id=?",
                    scope, "COMMUNITY".equals(scope) ? community : null, id);
            if ("SELECTED_COMMUNITIES".equals(scope)) {
                jdbc.update("INSERT INTO property_listing_communities(property_listing_id,community_id) VALUES(?,?)", id, community);
            }
            engagement.save(member, id);
        }
        assertEquals(3L, discovery.discover(member, null, null, 20).totalCount());
        assertEquals(3, discovery.saved(member, null, 20).items().size());
        jdbc.update("UPDATE profiles SET current_country_id=? WHERE id=?", origin, member);
        // Membership deliberately remains active after moving country.
        assertEquals(0L, discovery.discover(member, null, null, 20).totalCount());
        mvc.perform(get("/api/v1/properties").with(as(member)).param("communityId", community.toString()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalCount").value(0));
        assertTrue(discovery.saved(member, null, 20).items().isEmpty());
        for (UUID id : jdbc.queryForList("SELECT id FROM property_listings", UUID.class)) {
            assertPublicAccessDenied(member, id);
            assertNotNull(query.detail(owner, id));
        }
    }

    @Test
    void revokedMembershipAndInactiveCommunityCannotLeakListingsOrSavedItems() throws Exception {
        UUID id = published(owner, null, "Community only", new BigDecimal("1000"), 2, null, null).item().property().id();
        jdbc.update("UPDATE property_listings SET visibility_scope='COMMUNITY',community_id=? WHERE id=?", community, id);
        engagement.save(member, id);
        communities.leave(member, community);
        assertEquals(0L, discovery.discover(member, null, null, 20).totalCount());
        assertTrue(discovery.saved(member, null, 20).items().isEmpty());
        assertPublicAccessDenied(member, id);
        communities.join(member, community);
        jdbc.update("UPDATE communities SET is_active=false WHERE id=?", community);
        assertEquals(0L, discovery.discover(member, null, null, 20).totalCount());
        assertTrue(discovery.saved(member, null, 20).items().isEmpty());
        assertPublicAccessDenied(member, id);
    }

    @Test
    void disabledContactsAndExactAddressAreAbsentFromPublicPayload() throws Exception {
        UUID id = published(owner, null, "Private contacts", new BigDecimal("900"), 1, 52.520008, 13.404954).item().property().id();
        jdbc.update("UPDATE property_listing_contacts SET phone='+491234',whatsapp='+495678',"
                + "show_phone=false,show_whatsapp=false WHERE property_listing_id=?", id);
        mvc.perform(get("/api/v1/properties/" + id).with(as(member)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.contact.phone").doesNotExist())
                .andExpect(jsonPath("$.contact.whatsapp").doesNotExist())
                .andExpect(jsonPath("$.contact.email").value(owner + "@example.com"))
                .andExpect(jsonPath("$.privateAddress").doesNotExist())
                .andExpect(jsonPath("$.item.location.countryName").value("Germany"))
                .andExpect(jsonPath("$.item.location.latitude").value(52.52))
                .andExpect(jsonPath("$.item.location.longitude").value(13.40));
        assertEquals("+491234", query.detail(owner, id).contact().phone());
    }

    @Test
    void individualAdvertiserUsesPublicAvatarProjection() throws Exception {
        UUID id = published(owner, null, "Advertiser photo", new BigDecimal("900"), 1, null, null).item().property().id();
        UUID avatar = media(owner, "avatar");
        jdbc.update("UPDATE media_objects SET purpose='AVATAR' WHERE id=?", avatar);
        jdbc.update("INSERT INTO profile_media(user_id,media_id,variant) VALUES(?,?,'AVATAR')", owner, avatar);
        mvc.perform(get("/api/v1/properties/" + id).with(as(member)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.owner.avatarMediaId").value(avatar.toString()));
        jdbc.update("UPDATE users SET account_status='SUSPENDED' WHERE id=?", owner);
        try {
            assertNull(query.detail(member, id).owner().avatarMediaId());
        } finally {
            jdbc.update("UPDATE users SET account_status='ACTIVE' WHERE id=?", owner);
        }
    }

    @Test
    void businessAdvertiserLogoRespectsProfileVisibilityAndLifecycle() throws Exception {
        var account = businessService.create(owner, "Property agency");
        UUID category = UUID.randomUUID();
        jdbc.update("INSERT INTO business_categories(id,country_id,name,slug) VALUES(?,?,'Property agency','property-agency')", category, destination);
        var business = directory.create(owner, new BusinessDirectoryService.CreateCommand(destination,
                account.id(), category, "Local agency", "Property agency profile", null, null, null,
                "COUNTRY", null, List.of()));
        UUID logo = media(owner, "logo");
        jdbc.update("UPDATE media_objects SET purpose='BUSINESS' WHERE id=?", logo);
        directory.attachMedia(owner, business.id(), logo, 0, "LOGO");
        directory.publish(owner, business.id());
        UUID id = published(owner, account.id(), "Agency property", new BigDecimal("1200"), 2, null, null).item().property().id();
        jdbc.update("UPDATE property_listings SET business_listing_id=? WHERE id=?", business.id(), id);
        mvc.perform(get("/api/v1/properties/" + id).with(as(member)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.listedBy.logoMediaId").value(logo.toString()));
        assertNull(query.detail(member, id).owner().avatarMediaId());
        for (String scope : List.of("COMMUNITY", "SELECTED_COMMUNITIES")) {
            jdbc.update("UPDATE business_listings SET visibility_scope=?::visibility_scope,community_id=? WHERE id=?",
                    scope, "COMMUNITY".equals(scope) ? community : null, business.id());
            if ("SELECTED_COMMUNITIES".equals(scope)) {
                jdbc.update("INSERT INTO business_listing_communities(business_listing_id,community_id) VALUES(?,?)", business.id(), community);
            }
            assertEquals(logo, query.detail(member, id).listedBy().logoMediaId());
            assertNull(query.detail(outsider, id).listedBy());
            communities.leave(member, community);
            assertNull(query.detail(member, id).listedBy());
            communities.join(member, community);
            jdbc.update("UPDATE communities SET is_active=false WHERE id=?", community);
            assertNull(query.detail(member, id).listedBy());
            jdbc.update("UPDATE communities SET is_active=true WHERE id=?", community);
        }
        directory.unpublish(owner, business.id());
        assertNull(query.detail(member, id).listedBy());
    }

    private void assertPublicAccessDenied(UUID viewer, UUID id) throws Exception {
        UUID mediaId = jdbc.queryForObject("SELECT media_id FROM property_listing_media WHERE property_listing_id=?", UUID.class, id);
        mvc.perform(get("/api/v1/properties/" + id).with(as(viewer))).andExpect(status().isNotFound());
        mvc.perform(put("/api/v1/properties/" + id + "/save").with(as(viewer))).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/properties/" + id + "/media/" + mediaId + "/download-url").with(as(viewer))).andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/properties/" + id + "/enquiry").with(as(viewer))).andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/properties/" + id + "/report").with(as(viewer))
                .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"SCAM\"}")).andExpect(status().isNotFound());
    }

    private BrowseOptions sortOptions(String sort) {
        return new BrowseOptions(sort, null, null, null, null, null, null, null, null, null, null, null, null);
    }

    private PropertyDetail published(UUID actor, UUID business, String title, BigDecimal price,
            int bedrooms, Double lat, Double lng) {
        PropertyDetail draft = lifecycle.create(actor, command(actor, business, title, price,
                bedrooms, lat, lng));
        UUID id = draft.item().property().id();
        lifecycle.attachMedia(actor, id, media(actor, title));
        return lifecycle.publish(actor, id);
    }

    private PropertyCommand command(UUID actor, UUID business, String title, BigDecimal price,
            int bedrooms, Double lat, Double lng) {
        return new PropertyCommand(destination, null, business, null, propertyType, "COUNTRY", "RENT",
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
                null, null, city, search, null, null, null, null);
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
