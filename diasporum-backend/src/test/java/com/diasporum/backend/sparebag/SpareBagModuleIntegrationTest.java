package com.diasporum.backend.sparebag;

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

import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import com.diasporum.backend.sparebag.internal.application.SpareBagContactService;
import com.diasporum.backend.sparebag.internal.application.SpareBagExpiryWorker;
import com.diasporum.backend.sparebag.internal.application.SpareBagListingService;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.ContactInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.DiscoveryFilters;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.ListingInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.ListingView;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Spare Bag on real migrated PostgreSQL/PostGIS and real module integrations. */
@SpringBootTest
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class SpareBagModuleIntegrationTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired SpareBagListingService listings;
    @Autowired SpareBagContactService contacts;
    @Autowired SpareBagExpiryWorker expiryWorker;
    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired Flyway flyway;

    private UUID add;
    private UUID lhr;
    private UUID ethiopia;

    @BeforeEach
    void setup() {
        jdbc.execute("TRUNCATE spare_bag_contact_requests,spare_bag_listing_saves,"
                + "spare_bag_listing_media,spare_bag_listing_categories,spare_bag_listings,"
                + "direct_conversations,idempotency_keys,notifications,outbox_events,reports,"
                + "addresses,media_objects,billing_usage_records,billing_subscriptions CASCADE");
        jdbc.update("UPDATE billing_plan_entitlements SET enabled=false,quantity_limit=NULL,"
                + "reset_period=NULL WHERE feature_id=(SELECT id FROM billing_features "
                + "WHERE feature_key='SPARE_BAG_LISTING_PUBLISH')");
        add = airport("ADD");
        lhr = airport("LHR");
        ethiopia = jdbc.queryForObject("SELECT country_id FROM airports WHERE id=?",
                UUID.class, add);
    }

    private UUID user(String subject) {
        UUID id = IdentityTestSupport.provision(ctx, ISSUER, subject);
        jdbc.update("UPDATE profiles SET origin_country_id=?,current_country_id=? WHERE id=?",
                ethiopia, ethiopia, id);
        return id;
    }

    private UUID airport(String iata) {
        return jdbc.queryForObject("SELECT id FROM airports WHERE iata_code=?", UUID.class, iata);
    }

    private RequestPostProcessor asUser(UUID userId) {
        return authentication(new UsernamePasswordAuthenticationToken(
                new DiasporumUserPrincipal(userId, UUID.randomUUID(),
                        userId + "@test.invalid", List.of()), null, List.of()));
    }

    private void freeEntitlement(long limit) {
        jdbc.update("UPDATE billing_plan_entitlements SET enabled=true,quantity_limit=?,"
                + "reset_period='MONTH' WHERE plan_id=(SELECT id FROM billing_plans "
                + "WHERE plan_key='FREE') AND feature_id=(SELECT id FROM billing_features "
                + "WHERE feature_key='SPARE_BAG_LISTING_PUBLISH')", limit);
    }

    private void entitlement(UUID userId, long limit) {
        freeEntitlement(limit);
        jdbc.update("DELETE FROM billing_subscriptions WHERE user_id=?", userId);
        jdbc.update("INSERT INTO billing_subscriptions(user_id,plan_id,status,current_period_start) "
                + "SELECT ?,id,'ACTIVE',now() FROM billing_plans WHERE plan_key='FREE'", userId);
    }

    private ListingInput input(String type) {
        return input(type, LocalDate.now().plusDays(30), new BigDecimal("12.50"),
                List.of(), null);
    }

    private ListingInput input(String type, LocalDate start, BigDecimal price,
            List<UUID> mediaIds, UUID addressId) {
        boolean sender = "SENDER_REQUEST".equals(type);
        return new ListingInput(type, null, "COUNTRY", add, lhr,
                sender ? "Documents to London" : "Spare capacity to London",
                "Truthful parcel contents and travel details.", start, start.plusDays(2),
                sender ? new BigDecimal("5.00") : null, sender ? 1 : null,
                sender ? null : new BigDecimal("10.00"), sender ? null : 2,
                sender ? null : new BigDecimal("5.00"), price, "PER_KG", "USD",
                "Addis Ababa central collection", addressId, "Heathrow public meeting point",
                null, "No restricted items.", List.of("DOCUMENTS"), mediaIds);
    }

    private ListingView published(UUID owner, ListingInput input) {
        ListingView draft = listings.create(owner, input);
        return listings.publish(owner, draft.listing().id());
    }

    @Test
    void approvedAirportAndCategoryReferenceDataIsMigrated() {
        flyway.validate();
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history"
                + " WHERE version='10' AND script='V10__spare_bag_airport_seed.sql' AND success",
                Integer.class));
        assertAirportSeed(jdbc);
        assertMigratedSpareBagSchema(jdbc);
        assertEquals(6, listings.categories().size());
        assertEquals("ADD", listings.airports("Bole", null, 20).getFirst().iataCode());
        assertEquals("ADD", listings.airports("Ethiopia", null, 20).getFirst().iataCode());
    }

    private void assertAirportSeed(JdbcTemplate database) {
        assertEquals(7, database.queryForObject("SELECT count(*) FROM airports", Integer.class));
        assertEquals(7, database.queryForObject("SELECT count(DISTINCT iata_code) FROM airports",
                Integer.class));
        assertEquals(Set.of("ADD", "LHR", "IAD", "FRA", "YYZ", "SYD", "ARN"),
                Set.copyOf(database.queryForList("SELECT iata_code FROM airports", String.class)));
        Map<String, String> expectedCountries = Map.of(
                "ADD", "ET", "LHR", "GB", "IAD", "US", "FRA", "DE",
                "YYZ", "CA", "SYD", "AU", "ARN", "SE");
        expectedCountries.forEach((iata, iso2) -> assertEquals(iso2, database.queryForObject(
                "SELECT c.iso2 FROM airports a JOIN countries c ON c.id=a.country_id"
                        + " WHERE a.iata_code=?", String.class, iata)));
    }

    private void assertMigratedSpareBagSchema(JdbcTemplate database) {
        String mediaConstraint = database.queryForObject("SELECT pg_get_constraintdef(oid)"
                + " FROM pg_constraint WHERE conname='media_objects_purpose_check'", String.class);
        for (String purpose : new String[]{"MESSAGE_IMAGE", "MESSAGE_DOCUMENT", "JOB",
                "BUSINESS", "PROPERTY", "SPARE_BAG_LISTING"}) {
            assertTrue(mediaConstraint.contains(purpose), purpose);
        }
        for (String index : new String[]{"ix_airports_country_city", "ix_spare_bag_route_dates",
                "ux_spare_bag_pending_contact_pair"}) {
            assertTrue(database.queryForObject("SELECT EXISTS(SELECT 1 FROM pg_indexes"
                    + " WHERE indexname=?)", Boolean.class, index), index);
        }
        assertTrue(database.queryForObject("SELECT EXISTS(SELECT 1 FROM pg_constraint"
                + " WHERE conrelid='airports'::regclass AND confrelid='countries'::regclass"
                + " AND contype='f')", Boolean.class));
        assertEquals(2, database.queryForObject("SELECT count(DISTINCT kcu.column_name)"
                + " FROM information_schema.table_constraints tc"
                + " JOIN information_schema.key_column_usage kcu"
                + " ON tc.constraint_name=kcu.constraint_name"
                + " AND tc.table_schema=kcu.table_schema"
                + " JOIN information_schema.constraint_column_usage ccu"
                + " ON tc.constraint_name=ccu.constraint_name"
                + " AND tc.table_schema=ccu.table_schema"
                + " WHERE tc.table_name='spare_bag_listings' AND tc.constraint_type='FOREIGN KEY'"
                + " AND ccu.table_name='airports' AND kcu.column_name IN"
                + " ('origin_airport_id','destination_airport_id')", Integer.class));
        assertTrue(database.queryForObject("SELECT count(*) FROM pg_constraint"
                + " WHERE conrelid='spare_bag_listings'::regclass AND contype='c'",
                Integer.class) >= 6);
    }

    @Test
    void spareBagMigrationUpgradesLatestMainAndSeedCanBeReappliedSafely() throws Exception {
        try (PostgreSQLContainer upgraded = new PostgreSQLContainer(
                DockerImageName.parse("postgis/postgis:17-3.5")
                        .asCompatibleSubstituteFor("postgres"))) {
            upgraded.start();
            var dataSource = new DriverManagerDataSource(upgraded.getJdbcUrl(),
                    upgraded.getUsername(), upgraded.getPassword());
            Flyway.configure().dataSource(dataSource).target("8").load().migrate();
            var upgradeJdbc = new JdbcTemplate(dataSource);
            assertEquals(1, upgradeJdbc.queryForObject("SELECT count(*)"
                    + " FROM flyway_schema_history WHERE version='8'"
                    + " AND script='V8__business_directory_operations.sql' AND success",
                    Integer.class));
            assertFalse(upgradeJdbc.queryForObject("SELECT EXISTS(SELECT 1"
                    + " FROM flyway_schema_history WHERE version='10')", Boolean.class));
            assertEquals(0, upgradeJdbc.queryForObject("SELECT count(*) FROM airports",
                    Integer.class));

            Flyway.configure().dataSource(dataSource).load().migrate();

            assertEquals(1, upgradeJdbc.queryForObject("SELECT count(*)"
                    + " FROM flyway_schema_history WHERE version='10'"
                    + " AND script='V10__spare_bag_airport_seed.sql' AND success", Integer.class));
            assertAirportSeed(upgradeJdbc);
            assertMigratedSpareBagSchema(upgradeJdbc);
            upgradeJdbc.update("UPDATE airports SET is_active=false WHERE iata_code='ADD'");
            try (var connection = dataSource.getConnection()) {
                ScriptUtils.executeSqlScript(connection, new ClassPathResource(
                        "db/migration/V10__spare_bag_airport_seed.sql"));
            }
            assertFalse(upgradeJdbc.queryForObject("SELECT is_active FROM airports"
                    + " WHERE iata_code='ADD'", Boolean.class));
            assertAirportSeed(upgradeJdbc);
            assertEquals(0, Flyway.configure().dataSource(dataSource).load().migrate()
                    .migrationsExecuted);
        }
    }

    @Test
    void createValidatesTypeOwnershipAndDraftPrivacy() {
        UUID owner = user("sb-create-owner");
        UUID other = user("sb-create-other");
        ListingView draft = listings.create(owner, input("SENDER_REQUEST"));
        assertEquals("DRAFT", draft.listing().status());
        assertEquals(owner, draft.owner().id());
        assertTrue(draft.canManage());
        assertEquals("LISTING_NOT_FOUND", assertThrows(ResponseStatusException.class,
                () -> listings.detail(other, draft.listing().id())).getReason());
        assertEquals("NOT_LISTING_OWNER", assertThrows(ResponseStatusException.class,
                () -> listings.update(other, draft.listing().id(), input("SENDER_REQUEST")))
                .getReason());

        ListingInput invalid = new ListingInput("PASSENGER_OFFER", null, "COUNTRY",
                add, add, "Bad", "Bad", LocalDate.now().plusDays(1), null,
                null, null, new BigDecimal("2"), null, null,
                BigDecimal.ONE, "PER_KG", "USD", "Place", null,
                null, null, null, List.of(), List.of());
        assertEquals("AIRPORTS_MUST_DIFFER", assertThrows(ResponseStatusException.class,
                () -> listings.create(owner, invalid)).getReason());
        assertEquals("CLOSED", listings.close(owner, draft.listing().id()).listing().status());
    }

    @Test
    void publicationFailsClosedThenConsumesOnlyInitialPublish() {
        UUID owner = user("sb-billing-owner");
        ListingView draft = listings.create(owner, input("SENDER_REQUEST"));
        ResponseStatusException disabled = assertThrows(ResponseStatusException.class,
                () -> listings.publish(owner, draft.listing().id()));
        assertEquals(HttpStatus.FORBIDDEN, disabled.getStatusCode());
        assertEquals("ENTITLEMENT_NOT_CONFIGURED", disabled.getReason());

        entitlement(owner, 2);
        ListingView published = listings.publish(owner, draft.listing().id());
        assertEquals("PUBLISHED", published.listing().status());
        assertNotNull(published.listing().publishedAt());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM billing_usage_records",
                Integer.class));
        listings.pause(owner, draft.listing().id());
        assertEquals("PUBLISHED", listings.publish(owner, draft.listing().id()).listing().status());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM billing_usage_records",
                Integer.class));
        listings.close(owner, draft.listing().id());
        assertEquals("INVALID_LISTING_TRANSITION", assertThrows(ResponseStatusException.class,
                () -> listings.publish(owner, draft.listing().id())).getReason());

        ListingView second = listings.create(owner, input("PASSENGER_OFFER"));
        entitlement(owner, 2);
        listings.publish(owner, second.listing().id());
        listings.pause(owner, second.listing().id());
        assertEquals("CLOSED", listings.close(owner, second.listing().id()).listing().status());
        ListingView third = listings.create(owner, input("SENDER_REQUEST"));
        assertEquals("QUOTA_EXCEEDED", assertThrows(ResponseStatusException.class,
                () -> listings.publish(owner, third.listing().id())).getReason());
    }

    @Test
    void freePlanQuotaAppliesToUsersWithoutSubscription() {
        UUID owner = user("sb-free-owner");
        freeEntitlement(1);
        ListingView draft = listings.create(owner, input("SENDER_REQUEST"));
        assertEquals("PUBLISHED", listings.publish(owner, draft.listing().id())
                .listing().status());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM billing_usage_records",
                Integer.class));
        ListingView second = listings.create(owner, input("PASSENGER_OFFER"));
        assertEquals("QUOTA_EXCEEDED", assertThrows(ResponseStatusException.class,
                () -> listings.publish(owner, second.listing().id())).getReason());
    }

    @Test
    void discoveryFiltersAndCursorAreStableAndExcludeDrafts() {
        UUID owner = user("sb-discovery-owner");
        UUID viewer = user("sb-discovery-viewer");
        entitlement(owner, 10);
        ListingView first = published(owner, input("SENDER_REQUEST", LocalDate.now().plusDays(5),
                new BigDecimal("8"), List.of(), null));
        ListingView second = published(owner, input("PASSENGER_OFFER", LocalDate.now().plusDays(8),
                new BigDecimal("10"), List.of(), null));
        ListingView third = published(owner, input("SENDER_REQUEST", LocalDate.now().plusDays(12),
                new BigDecimal("15"), List.of(), null));
        listings.create(owner, input("SENDER_REQUEST"));

        var filters = new DiscoveryFilters(null, null, null, null, null, null,
                null, null, null, null, null, null, null, null);
        var page1 = listings.discover(viewer, filters, null, 2);
        assertEquals(2, page1.items().size());
        assertNotNull(page1.nextCursor());
        var page2 = listings.discover(viewer, filters, page1.nextCursor(), 2);
        assertEquals(1, page2.items().size());
        Set<UUID> ids = new java.util.HashSet<>();
        page1.items().forEach(v -> ids.add(v.listing().id()));
        page2.items().forEach(v -> ids.add(v.listing().id()));
        assertEquals(Set.of(first.listing().id(), second.listing().id(), third.listing().id()), ids);
        assertEquals(first.listing().id(), page1.items().getFirst().listing().id());

        var passengerCheap = new DiscoveryFilters("PASSENGER_OFFER", null, null,
                null, add, lhr, LocalDate.now().plusDays(6), LocalDate.now().plusDays(10),
                new BigDecimal("10"), new BigDecimal("8"), "USD", "DOCUMENTS",
                null, null);
        var filtered = listings.discover(viewer, passengerCheap, null, 20);
        assertEquals(List.of(second.listing().id()), filtered.items().stream()
                .map(v -> v.listing().id()).toList());
    }

    @Test
    void discoverySortWeightFilterAndCountsAreHonest() {
        UUID owner = user("sb-sort-owner");
        UUID viewer = user("sb-sort-viewer");
        entitlement(owner, 10);
        ListingView firstPublished = published(owner, input("SENDER_REQUEST",
                LocalDate.now().plusDays(20), new BigDecimal("8"), List.of(), null));
        ListingView secondPublished = published(owner, input("SENDER_REQUEST",
                LocalDate.now().plusDays(6), new BigDecimal("10"), List.of(), null));
        ListingView thirdPublished = published(owner, input("PASSENGER_OFFER",
                LocalDate.now().plusDays(10), new BigDecimal("12"), List.of(), null));

        var newestFirst = new DiscoveryFilters(null, null, null, null, null, null,
                null, null, null, null, null, null, null, "NEWEST");
        var sorted = listings.discover(viewer, newestFirst, null, 1);
        assertEquals(thirdPublished.listing().id(),
                sorted.items().getFirst().listing().id());
        var sortedPage2 = listings.discover(viewer, newestFirst,
                sorted.nextCursor(), 1);
        assertEquals(secondPublished.listing().id(),
                sortedPage2.items().getFirst().listing().id());
        var sortedPage3 = listings.discover(viewer, newestFirst,
                sortedPage2.nextCursor(), 1);
        assertEquals(firstPublished.listing().id(),
                sortedPage3.items().getFirst().listing().id());

        var heavy = new DiscoveryFilters("SENDER_REQUEST", null, null, null, null,
                null, null, null, null, null, null, null,
                new BigDecimal("1"), null);
        assertEquals(0, listings.discover(viewer, heavy, null, 20).items().size());

        var counts = listings.countDiscover(viewer, new DiscoveryFilters(null, null,
                null, null, null, null, null, null, null, null, null, null,
                null, null));
        assertEquals(1, counts.passengerOffers());
        assertEquals(2, counts.senderRequests());

        assertEquals("INVALID_DISCOVERY_FILTERS",
                assertThrows(ResponseStatusException.class, () -> listings.discover(
                        viewer, new DiscoveryFilters(null, null, null, null, null,
                                null, null, null, null, null, null, null, null,
                                "POPULAR"), null, 20)).getReason());
    }

    @Test
    void savedCollectionIsPrivateAndIdempotent() {
        UUID owner = user("sb-save-owner");
        UUID viewer = user("sb-save-viewer");
        UUID outsider = user("sb-save-outsider");
        entitlement(owner, 1);
        ListingView published = published(owner, input("SENDER_REQUEST"));
        listings.save(viewer, published.listing().id());
        listings.save(viewer, published.listing().id());
        assertEquals(1, listings.saved(viewer, null, 20).items().size());
        assertTrue(listings.detail(viewer, published.listing().id()).saved());
        assertEquals(0, listings.saved(outsider, null, 20).items().size());
        listings.unsave(viewer, published.listing().id());
        assertEquals(0, listings.saved(viewer, null, 20).items().size());
    }

    @Test
    void mediaOwnershipPurposeAndReadinessAreValidated() {
        UUID owner = user("sb-media-owner");
        UUID other = user("sb-media-other");
        UUID ready = media(owner, "SPARE_BAG_LISTING", "READY");
        ListingView withMedia = listings.create(owner, input("SENDER_REQUEST",
                LocalDate.now().plusDays(20), BigDecimal.ONE, List.of(ready), null));
        assertEquals(List.of(ready), withMedia.mediaIds());
        UUID pending = media(owner, "SPARE_BAG_LISTING", "PENDING_UPLOAD");
        assertEquals("MEDIA_NOT_READY", assertThrows(ResponseStatusException.class,
                () -> listings.create(owner, input("SENDER_REQUEST", LocalDate.now().plusDays(20),
                        BigDecimal.ONE, List.of(pending), null))).getReason());
        UUID stolen = media(other, "SPARE_BAG_LISTING", "READY");
        assertEquals("MEDIA_NOT_ATTACHABLE", assertThrows(ResponseStatusException.class,
                () -> listings.create(owner, input("SENDER_REQUEST", LocalDate.now().plusDays(20),
                        BigDecimal.ONE, List.of(stolen), null))).getReason());
    }

    private UUID media(UUID owner, String purpose, String status) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,object_key,purpose,"
                + "status,mime_type,size_bytes,detected_mime_type) VALUES(?,?,?,?,?,?::media_status,?,100,?)",
                id, owner, "test", id.toString(), purpose, status, "image/jpeg", "image/jpeg");
        return id;
    }

    @Test
    void contactAcceptanceCreatesContextConversationAndRevealsAddressesOnlyAfterAcceptance() {
        UUID sender = user("sb-contact-sender");
        UUID passenger = user("sb-contact-passenger");
        entitlement(sender, 1);
        entitlement(passenger, 1);
        UUID addressId = UUID.randomUUID();
        jdbc.update("INSERT INTO addresses(id,owner_user_id,country_id,address_line_1,city,"
                + "visibility) VALUES(?,?,?,'1 Private Road','Addis Ababa','PRIVATE')",
                addressId, sender, ethiopia);
        ListingView senderDraft = listings.create(sender, input("SENDER_REQUEST",
                LocalDate.now().plusDays(20), new BigDecimal("10"), List.of(), addressId));
        ListingView senderListing = listings.publish(sender, senderDraft.listing().id());
        ListingView passengerListing = published(passenger, input("PASSENGER_OFFER",
                LocalDate.now().plusDays(20), new BigDecimal("10"), List.of(), null));
        assertNull(listings.detail(passenger, senderListing.listing().id()).collectionAddress());
        assertNotNull(listings.detail(sender, senderListing.listing().id()).collectionAddress());

        ContactInput command = new ContactInput(senderListing.listing().id(),
                passengerListing.listing().id(), new BigDecimal("4"), new BigDecimal("40"),
                "PER_KG", "USD", "Can you help?", "client-contact-1");
        var created = contacts.create(sender, command);
        assertEquals("PENDING", created.contact().status());
        assertEquals(created.contact().id(), contacts.create(sender, command).contact().id());
        UUID outsider = user("sb-contact-outsider");
        assertEquals("CONTACT_REQUEST_NOT_FOUND", assertThrows(ResponseStatusException.class,
                () -> contacts.detail(outsider, created.contact().id())).getReason());
        assertEquals("CONTACT_REQUEST_NOT_FOUND", assertThrows(ResponseStatusException.class,
                () -> contacts.accept(outsider, created.contact().id(), null)).getReason());
        assertEquals("REQUESTER_CANNOT_RESPOND", assertThrows(ResponseStatusException.class,
                () -> contacts.accept(sender, created.contact().id(), null)).getReason());

        var accepted = contacts.accept(passenger, created.contact().id(), "Accepted");
        assertEquals("ACCEPTED", accepted.contact().status());
        assertNotNull(accepted.contact().directConversationId());
        assertEquals("MATCHED", listings.detail(sender, senderListing.listing().id()).listing().status());
        assertEquals("MATCHED", listings.detail(passenger, passengerListing.listing().id()).listing().status());
        assertNotNull(listings.detail(passenger, senderListing.listing().id()).collectionAddress());
        assertEquals("SPARE_BAG_CONTACT", jdbc.queryForObject("SELECT context_type "
                + "FROM direct_conversations WHERE id=?", String.class,
                accepted.contact().directConversationId()));
        assertEquals(created.contact().id(), jdbc.queryForObject("SELECT context_id "
                + "FROM direct_conversations WHERE id=?", UUID.class,
                accepted.contact().directConversationId()));
        assertEquals(accepted.contact().directConversationId(), contacts.openConversation(sender,
                created.contact().id()).contact().directConversationId());
        assertTrue(jdbc.queryForObject("SELECT count(*) FROM notifications "
                + "WHERE type='SPARE_BAG_CONTACT_REQUEST'", Integer.class) >= 2);

        contacts.close(passenger, created.contact().id());
        assertNull(contacts.detail(passenger, created.contact().id())
                .senderListing().collectionAddress());
        assertEquals("CLOSED", listings.close(sender, senderListing.listing().id())
                .listing().status());
    }

    @Test
    void contactRequiresCompatibleEligibleListingsAndSupportsIncomingOutgoing() {
        UUID sender = user("sb-pair-sender");
        UUID passenger = user("sb-pair-passenger");
        entitlement(sender, 2);
        entitlement(passenger, 2);
        ListingView senderPublished = published(sender, input("SENDER_REQUEST"));
        ListingView passengerPublished = published(passenger, input("PASSENGER_OFFER"));
        ListingView otherSender = published(sender, input("SENDER_REQUEST"));
        assertEquals("INCOMPATIBLE_LISTING_PAIR", assertThrows(ResponseStatusException.class,
                () -> contacts.create(sender, new ContactInput(otherSender.listing().id(),
                        senderPublished.listing().id(), null, null, null, null,
                        null, "same-type"))).getReason());
        var created = contacts.create(sender, new ContactInput(senderPublished.listing().id(),
                passengerPublished.listing().id(), null, null, null, null,
                "Hello", "direction-1"));
        assertEquals(1, contacts.list(sender, "OUTGOING", null, 20).items().size());
        assertEquals(0, contacts.list(sender, "INCOMING", null, 20).items().size());
        assertEquals(1, contacts.list(passenger, "INCOMING", null, 20).items().size());
        contacts.cancel(sender, created.contact().id());
        assertEquals("CANCELLED", contacts.detail(sender, created.contact().id()).contact().status());
        var declined = contacts.create(sender, new ContactInput(senderPublished.listing().id(),
                passengerPublished.listing().id(), null, null, null, null,
                null, "direction-2"));
        assertEquals("DECLINED", contacts.decline(passenger, declined.contact().id(), "No")
                .contact().status());
    }

    @Test
    void reportsAreValidatedAndDeduplicated() {
        UUID owner = user("sb-report-owner");
        UUID reporter = user("sb-report-reporter");
        entitlement(owner, 1);
        ListingView published = published(owner, input("SENDER_REQUEST"));
        UUID report = listings.report(reporter, published.listing().id(), "SCAM", "Details");
        assertNotNull(report);
        assertEquals("REPORT_DUPLICATE", assertThrows(ResponseStatusException.class,
                () -> listings.report(reporter, published.listing().id(), "SCAM", null))
                .getReason());
    }

    @Test
    void expiryWorkerIsIdempotentForListingsAndPendingContacts() throws Exception {
        UUID sender = user("sb-expiry-sender");
        UUID passenger = user("sb-expiry-passenger");
        entitlement(sender, 1);
        entitlement(passenger, 1);
        ListingView senderPublished = published(sender, input("SENDER_REQUEST"));
        ListingView passengerPublished = published(passenger, input("PASSENGER_OFFER"));
        var contact = contacts.create(sender, new ContactInput(senderPublished.listing().id(),
                passengerPublished.listing().id(), null, null, null, null,
                null, "expiry-contact"));
        listings.pause(passenger, passengerPublished.listing().id());
        expiryWorker.expire();
        assertEquals("EXPIRED", contacts.detail(sender, contact.contact().id()).contact().status());
        jdbc.update("UPDATE spare_bag_listings SET travel_date_start=CURRENT_DATE-3,"
                + "travel_date_end=CURRENT_DATE-2 WHERE id IN (?,?)",
                senderPublished.listing().id(), passengerPublished.listing().id());
        expiryWorker.expire();
        assertEquals("EXPIRED", listings.detail(sender, senderPublished.listing().id()).listing().status());
        assertEquals("EXPIRED", listings.detail(passenger, passengerPublished.listing().id())
                .listing().status());
        int notificationCount = jdbc.queryForObject("SELECT count(*) FROM notifications",
                Integer.class);

        var executor = Executors.newFixedThreadPool(4);
        try {
            CountDownLatch ready = new CountDownLatch(4);
            CountDownLatch start = new CountDownLatch(1);
            List<java.util.concurrent.Future<?>> runs = new ArrayList<>();
            for (int i = 0; i < 4; i++) {
                runs.add(executor.submit(() -> {
                    ready.countDown();
                    start.await();
                    expiryWorker.expire();
                    return null;
                }));
            }
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            start.countDown();
            for (var run : runs) {
                run.get(20, TimeUnit.SECONDS);
            }
        } finally {
            executor.shutdownNow();
        }
        assertEquals("EXPIRED", contacts.detail(sender, contact.contact().id()).contact().status());
        assertEquals("EXPIRED", listings.detail(sender, senderPublished.listing().id()).listing().status());
        assertEquals(notificationCount, jdbc.queryForObject("SELECT count(*) FROM notifications",
                Integer.class));
    }

    @Test
    void acceptingAndExpiringContactRequestHasOneConsistentTerminalState() throws Exception {
        UUID sender = user("sb-race-sender");
        UUID passenger = user("sb-race-passenger");
        entitlement(sender, 1);
        entitlement(passenger, 1);
        ListingView senderPublished = published(sender, input("SENDER_REQUEST"));
        ListingView passengerPublished = published(passenger, input("PASSENGER_OFFER"));
        var contact = contacts.create(sender, new ContactInput(senderPublished.listing().id(),
                passengerPublished.listing().id(), null, null, null, null,
                null, "expiry-accept-race"));
        UUID contactId = contact.contact().id();
        jdbc.update("UPDATE spare_bag_contact_requests SET expires_at=now()-interval '1 second'"
                + " WHERE id=?", contactId);

        var executor = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch ready = new CountDownLatch(2);
            CountDownLatch start = new CountDownLatch(1);
            var accepted = executor.submit(() -> {
                ready.countDown();
                start.await();
                return contacts.accept(passenger, contactId, "Accepted");
            });
            var expired = executor.submit(() -> {
                ready.countDown();
                start.await();
                expiryWorker.expire();
                return null;
            });
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            start.countDown();
            try {
                accepted.get(20, TimeUnit.SECONDS);
            } catch (ExecutionException e) {
                assertTrue(e.getCause() instanceof ResponseStatusException);
                assertEquals("INVALID_CONTACT_TRANSITION",
                        ((ResponseStatusException) e.getCause()).getReason());
            }
            expired.get(20, TimeUnit.SECONDS);
        } finally {
            executor.shutdownNow();
        }

        String status = contacts.detail(sender, contactId).contact().status();
        assertTrue(Set.of("ACCEPTED", "EXPIRED").contains(status));
        String expectedListingStatus = "ACCEPTED".equals(status) ? "MATCHED" : "PUBLISHED";
        assertEquals(expectedListingStatus,
                listings.detail(sender, senderPublished.listing().id()).listing().status());
        assertEquals(expectedListingStatus,
                listings.detail(passenger, passengerPublished.listing().id()).listing().status());
        if ("ACCEPTED".equals(status)) {
            assertNotNull(contacts.detail(sender, contactId).contact().directConversationId());
        } else {
            assertNull(contacts.detail(sender, contactId).contact().directConversationId());
        }
        int notificationCount = jdbc.queryForObject("SELECT count(*) FROM notifications",
                Integer.class);
        expiryWorker.expire();
        assertEquals(status, contacts.detail(sender, contactId).contact().status());
        assertEquals(notificationCount, jdbc.queryForObject("SELECT count(*) FROM notifications",
                Integer.class));
    }

    @Test
    void httpEndpointsUsePrincipalAndExplicitDtos() throws Exception {
        UUID owner = user("sb-http-owner");
        String body = ("{\"listingType\":\"SENDER_REQUEST\",\"visibilityScope\":\"COUNTRY\","
                + "\"originAirportId\":\"" + add + "\",\"destinationAirportId\":\"" + lhr + "\","
                + "\"title\":\"Documents\",\"description\":\"Documents only\","
                + "\"travelDateStart\":\"" + LocalDate.now().plusDays(15) + "\","
                + "\"requestedWeightKg\":2,\"priceAmount\":10,\"priceUnit\":\"PER_KG\","
                + "\"priceCurrency\":\"USD\",\"collectionPlace\":\"Central station\","
                + "\"categoryKeys\":[\"DOCUMENTS\"],\"mediaIds\":[]}");
        mvc.perform(post("/api/v1/spare-bag/listings").with(asUser(owner))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.ownerUserId").value(owner.toString()))
                .andExpect(jsonPath("$.collectionAddress").doesNotExist());
        mvc.perform(get("/api/v1/spare-bag/airports").with(asUser(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(7));
    }
}
