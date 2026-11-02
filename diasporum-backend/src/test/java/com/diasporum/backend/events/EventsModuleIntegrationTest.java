package com.diasporum.backend.events;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi;
import com.diasporum.backend.businessaccounts.internal.application.BusinessAccountService;
import com.diasporum.backend.community.internal.application.CommunityService;
import com.diasporum.backend.events.internal.application.EventService;
import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Events module on real migrated PostgreSQL: lifecycle, authorization,
 * discovery/pagination, RSVP/capacity/waitlist, concurrency, cancellation,
 * business-account management and HTTP endpoints. */
@SpringBootTest
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class EventsModuleIntegrationTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired EventService service;
    @Autowired CommunityService communities;
    @Autowired BusinessAccountService businessService;
    @Autowired BusinessAccountsApi businessApi;
    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;

    private UUID origin, dest, community, categoryId;
    private UUID organizer, member, member2, outsider, abroad;

    private UUID user(String sub) {
        return IdentityTestSupport.provision(ctx, ISSUER, sub);
    }

    private RequestPostProcessor asUser(UUID userId, String email) {
        return authentication(new UsernamePasswordAuthenticationToken(
                new DiasporumUserPrincipal(userId, UUID.randomUUID(), email,
                        List.of()), null, List.of()));
    }

    private Instant inHours(long h) {
        return Instant.now().plus(h, ChronoUnit.HOURS).truncatedTo(ChronoUnit.MINUTES);
    }

    @BeforeEach
    void setup() {
        jdbc.execute("TRUNCATE reports,event_saves,event_rsvps,event_media,"
                + "events CASCADE");
        for (String t : new String[]{"community_memberships", "external_identities",
                "profiles", "communities", "airports", "countries"}) {
            jdbc.update("DELETE FROM " + t);
        }
        jdbc.update("INSERT INTO countries(name,iso2,iso3) VALUES"
                + "('Ethiopia','ET','ETH'),('Germany','DE','DEU')");
        origin = jdbc.queryForObject(
                "SELECT id FROM countries WHERE iso2='ET'", UUID.class);
        dest = jdbc.queryForObject(
                "SELECT id FROM countries WHERE iso2='DE'", UUID.class);
        jdbc.update("INSERT INTO communities(name,slug,origin_country_id,"
                + "destination_country_id) VALUES('ET in DE','et-in-de',?,?)",
                origin, dest);
        community = jdbc.queryForObject("SELECT id FROM communities", UUID.class);
        categoryId = jdbc.queryForObject(
                "SELECT id FROM event_categories WHERE category_key='WORKSHOP'"
                        + " AND country_id IS NULL", UUID.class);
        organizer = user("ev-organizer");
        member = user("ev-member");
        member2 = user("ev-member2");
        outsider = user("ev-outsider");
        abroad = user("ev-abroad");
        for (UUID u : new UUID[]{organizer, member, member2}) {
            jdbc.update("UPDATE profiles SET origin_country_id=?,"
                    + " current_country_id=? WHERE id=?", origin, dest, u);
            communities.join(u, community);
        }
        // outsider: same destination country but NOT a community member
        jdbc.update("UPDATE profiles SET origin_country_id=?,current_country_id=?"
                + " WHERE id=?", dest, dest, outsider);
        // abroad: neither member nor matching current country
        jdbc.update("UPDATE profiles SET origin_country_id=?,current_country_id=?"
                + " WHERE id=?", origin, origin, abroad);
    }

    private EventService.EventItem createSimple(UUID actor, String title,
            Instant startsAt, Integer capacity) {
        return service.create(actor, community, "COMMUNITY", categoryId, null,
                title, "Integration test event", "IN_PERSON", startsAt, null,
                "Europe/Berlin", "Community hall", null, capacity, null, null,
                false);
    }

    // =================== creation + validation ===================

    @Test
    void createPublishesAndValidates() {
        var e = createSimple(organizer, "Workshop", inHours(24), 30);
        assertEquals("PUBLISHED", e.event().status());
        assertEquals("COMMUNITY", e.event().visibilityScope());
        assertEquals("IN_PERSON", e.event().eventMode());
        assertEquals(30, e.event().capacity());
        assertEquals("WORKSHOP", e.category().categoryKey());
        assertTrue(e.canManage());
        assertNotNull(e.event().publishedAt());

        // draft lifecycle
        var draft = service.create(organizer, community, "COMMUNITY", categoryId,
                null, "Draft event", "Body", "ONLINE_EXTERNAL", inHours(48), null,
                "UTC", null, "https://example.org/event", null, null, null, true);
        assertEquals("DRAFT", draft.event().status());
        assertEquals("PUBLISHED", service.publish(organizer,
                draft.event().id()).event().status());

        // validation failures — ONLINE_VOICE has a dedicated code while the
        // Voice Rooms milestone is pending
        var voice = assertThrows(ResponseStatusException.class,
                () -> service.create(organizer, community, "COMMUNITY", categoryId,
                        null, "Voice", "Body", "ONLINE_VOICE", inHours(24), null,
                        "UTC", null, null, null, null, null, false));
        assertEquals(HttpStatus.BAD_REQUEST, voice.getStatusCode());
        assertEquals("ONLINE_VOICE_NOT_SUPPORTED", voice.getReason());
        assertThrows(ResponseStatusException.class, () -> service.create(organizer,
                community, "COMMUNITY", categoryId, null, "Bad mode", "Body",
                "ONLINE_VOICE", inHours(24), null, "UTC", null, null, null, null,
                null, false));
        assertThrows(ResponseStatusException.class, () -> service.create(organizer,
                community, "COMMUNITY", categoryId, null, "Past", "Body",
                "IN_PERSON", Instant.now().minusSeconds(60), null, "UTC", "X",
                null, null, null, null, false));
        assertThrows(ResponseStatusException.class, () -> service.create(organizer,
                community, "COMMUNITY", categoryId, null, "No location", "Body",
                "IN_PERSON", inHours(24), null, "UTC", null, null, null, null,
                null, false));
        assertThrows(ResponseStatusException.class, () -> service.create(organizer,
                community, "COMMUNITY", categoryId, null, "Bad url", "Body",
                "ONLINE_EXTERNAL", inHours(24), null, "UTC", null,
                "ftp://nope", null, null, null, false));
        assertThrows(ResponseStatusException.class, () -> service.create(organizer,
                community, "COMMUNITY", categoryId, null, "Bad tz", "Body",
                "IN_PERSON", inHours(24), null, "Not/Zone", "X", null, null,
                null, null, false));
        assertThrows(ResponseStatusException.class, () -> service.create(organizer,
                community, "COMMUNITY", UUID.randomUUID(), null, "Bad cat",
                "Body", "IN_PERSON", inHours(24), null, "UTC", "X", null, null,
                null, null, false));
    }

    @Test
    void coverImageAttachesThroughMediaModule() {
        UUID asset = UUID.randomUUID();
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,"
                + "object_key,purpose,mime_type,status) VALUES(?,?,?,?,?,?,"
                + "'READY')",
                asset, organizer, "test-bucket", organizer + "/event/" + asset,
                "EVENT", "image/jpeg");
        var e = service.create(organizer, community, "COMMUNITY", categoryId, null,
                "With cover", "Body", "IN_PERSON", inHours(24), null, "UTC",
                "Hall", null, null, asset, null, false);
        Integer covers = jdbc.queryForObject(
                "SELECT count(*) FROM event_media WHERE event_id=? AND is_cover",
                Integer.class, e.event().id());
        assertEquals(1, covers);

        // foreign / wrong-purpose media rejected
        UUID foreign = UUID.randomUUID();
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,"
                + "object_key,purpose,mime_type,status) VALUES(?,?,?,?,?,?,"
                + "'READY')",
                foreign, member, "test-bucket", member + "/event/" + foreign,
                "EVENT", "image/jpeg");
        assertThrows(ResponseStatusException.class, () -> service.create(organizer,
                community, "COMMUNITY", categoryId, null, "Bad cover", "Body",
                "IN_PERSON", inHours(24), null, "UTC", "Hall", null, null,
                foreign, null, false));
    }

    // =================== authorization ===================

    @Test
    void nonMemberCannotCreateAndViewCommunityEvent() {
        var ex = assertThrows(ResponseStatusException.class, () -> createSimple(
                outsider, "Outsider event", inHours(24), null));
        assertEquals(HttpStatus.FORBIDDEN, ex.getStatusCode());

        var e = createSimple(organizer, "Members only", inHours(24), null);
        var denied = assertThrows(ResponseStatusException.class,
                () -> service.detail(outsider, e.event().id()));
        assertEquals(HttpStatus.NOT_FOUND, denied.getStatusCode());
        var denied2 = assertThrows(ResponseStatusException.class,
                () -> service.detail(abroad, e.event().id()));
        assertEquals(HttpStatus.NOT_FOUND, denied2.getStatusCode());
        assertEquals("Members only", service.detail(member, e.event().id())
                .event().title());
    }

    @Test
    void countryScopeVisibleToMatchingCurrentCountry() {
        var e = service.create(organizer, community, "COUNTRY", categoryId, null,
                "Country-wide", "Body", "IN_PERSON", inHours(24), null, "UTC",
                "Berlin hall", null, null, null, null, false);
        assertEquals("COUNTRY", e.event().visibilityScope());
        // outsider (current country DE) sees it even without membership
        assertEquals("Country-wide", service.detail(outsider, e.event().id())
                .event().title());
        // abroad (current country ET) does not
        assertThrows(ResponseStatusException.class,
                () -> service.detail(abroad, e.event().id()));
    }

    @Test
    void onlyManagerEditsCancelsDeletes() {
        var e = createSimple(organizer, "Owned", inHours(24), null);
        var denied = assertThrows(ResponseStatusException.class,
                () -> service.update(member, e.event().id(), null, "Hacked", null,
                        null, null, null, null, null, null, null, null,
                        null, null, false));
        assertEquals(HttpStatus.FORBIDDEN, denied.getStatusCode());
        assertThrows(ResponseStatusException.class,
                () -> service.cancel(member, e.event().id(), null));
        assertThrows(ResponseStatusException.class,
                () -> service.delete(member, e.event().id()));

        var updated = service.update(organizer, e.event().id(), null, "Renamed",
                null, null, null, null, null, null, null, null, null, null,
                null, false);
        assertEquals("Renamed", updated.event().title());
    }

    // =================== visibility switching ===================

    @Test
    void visibilityChangeBetweenCommunityAndCountry() {
        var e = createSimple(organizer, "Scope switch", inHours(24), null);
        assertEquals("COMMUNITY", e.event().visibilityScope());
        // non-manager cannot change visibility
        var denied = assertThrows(ResponseStatusException.class,
                () -> service.update(member, e.event().id(), "COUNTRY", null,
                        null, null, null, null, null, null, null, null, null,
                        null, null, false));
        assertEquals(HttpStatus.FORBIDDEN, denied.getStatusCode());
        // invalid target scope
        var invalid = assertThrows(ResponseStatusException.class,
                () -> service.update(organizer, e.event().id(), "EVERYONE", null,
                        null, null, null, null, null, null, null, null, null,
                        null, null, false));
        assertEquals(HttpStatus.BAD_REQUEST, invalid.getStatusCode());

        // organizer widens to COUNTRY — same-country non-member gains access
        var widened = service.update(organizer, e.event().id(), "COUNTRY", null,
                null, null, null, null, null, null, null, null, null, null,
                null, false);
        assertEquals("COUNTRY", widened.event().visibilityScope());
        assertEquals("Scope switch", service.detail(outsider, e.event().id())
                .event().title());
        // other countries still cannot see it
        assertThrows(ResponseStatusException.class,
                () -> service.detail(abroad, e.event().id()));

        // a manager who lost community membership cannot re-narrow
        jdbc.update("DELETE FROM community_memberships WHERE user_id=?"
                + " AND community_id=?", organizer, community);
        var exMember = assertThrows(ResponseStatusException.class,
                () -> service.update(organizer, e.event().id(), "COMMUNITY", null,
                        null, null, null, null, null, null, null, null, null,
                        null, null, false));
        assertEquals(HttpStatus.FORBIDDEN, exMember.getStatusCode());
        communities.join(organizer, community);

        // narrowing back to COMMUNITY removes the outsider's access
        service.update(organizer, e.event().id(), "COMMUNITY", null, null, null,
                null, null, null, null, null, null, null, null, null, false);
        assertThrows(ResponseStatusException.class,
                () -> service.detail(outsider, e.event().id()));
        assertEquals("Scope switch", service.detail(member, e.event().id())
                .event().title());

        // visibility cannot change once the event has started
        var started = createSimple(organizer, "Started switch", inHours(24), null);
        jdbc.update("UPDATE events SET starts_at=now()-interval '1 hour'"
                + " WHERE id=?", started.event().id());
        var tooLate = assertThrows(ResponseStatusException.class,
                () -> service.update(organizer, started.event().id(), "COUNTRY",
                        null, null, null, null, null, null, null, null, null,
                        null, null, null, false));
        assertEquals(HttpStatus.CONFLICT, tooLate.getStatusCode());
    }

    // =================== discovery + pagination ===================

    @Test
    void discoveryPaginatesWithCursorAndFilters() {
        for (int i = 1; i <= 5; i++) {
            createSimple(organizer, "Event " + i, inHours(10 + i), null);
        }
        var page1 = service.discover(member, null, null, null, null, null, null,
                null, null, 2);
        assertEquals(2, page1.items().size());
        assertEquals("Event 1", page1.items().get(0).event().title());
        assertNotNull(page1.nextCursor());
        var page2 = service.discover(member, null, null, null, null, null, null,
                null, page1.nextCursor(), 2);
        assertEquals(2, page2.items().size());
        assertEquals("Event 3", page2.items().get(0).event().title());
        var page3 = service.discover(member, null, null, null, null, null, null,
                null, page2.nextCursor(), 2);
        assertEquals(1, page3.items().size());
        assertEquals(null, page3.nextCursor());

        // search + category filter + community listing
        var found = service.discover(member, null, null, categoryId, null, null,
                null, "Event 3", null, 10);
        assertEquals(1, found.items().size());
        var communityPage = service.communityEvents(member, community, null, 10);
        assertEquals(5, communityPage.items().size());
        // outsider cannot list a community's events
        assertThrows(ResponseStatusException.class,
                () -> service.communityEvents(outsider, community, null, 10));
        // past events are not discovered by default
        jdbc.update("UPDATE events SET starts_at=now()-interval '2 hours'"
                + " WHERE title='Event 1'");
        var upcoming = service.discover(member, null, null, null, null, null,
                null, null, null, 10);
        assertEquals(4, upcoming.items().size());
    }

    @Test
    void discoveryRespectsVisibilityForOutsiders() {
        createSimple(organizer, "Community event", inHours(24), null);
        service.create(organizer, community, "COUNTRY", categoryId, null,
                "Country event", "Body", "IN_PERSON", inHours(25), null, "UTC",
                "Hall", null, null, null, null, false);
        // member sees both
        assertEquals(2, service.discover(member, null, null, null, null, null,
                null, null, null, 10).items().size());
        // outsider (no memberships, current=DE) sees only the country event
        var forOutsider = service.discover(outsider, null, null, null, null,
                null, null, null, null, 10);
        assertEquals(1, forOutsider.items().size());
        assertEquals("Country event", forOutsider.items().get(0).event().title());
        // abroad sees nothing
        assertEquals(0, service.discover(abroad, null, null, null, null, null,
                null, null, null, 10).items().size());
    }

    // =================== RSVP + capacity + waitlist ===================

    @Test
    void rsvpTransitionsKeepSingleRecord() {
        var e = createSimple(organizer, "RSVP flow", inHours(24), null);
        assertEquals("GOING", service.setRsvp(member, e.event().id(), "GOING")
                .status());
        assertEquals("INTERESTED", service.setRsvp(member, e.event().id(),
                "INTERESTED").status());
        assertEquals("NOT_GOING", service.setRsvp(member, e.event().id(),
                "NOT_GOING").status());
        Integer rows = jdbc.queryForObject(
                "SELECT count(*) FROM event_rsvps WHERE event_id=? AND user_id=?",
                Integer.class, e.event().id(), member);
        assertEquals(1, rows);                       // duplicate prevention
        service.removeRsvp(member, e.event().id());
        Integer after = jdbc.queryForObject(
                "SELECT count(*) FROM event_rsvps WHERE event_id=? AND user_id=?",
                Integer.class, e.event().id(), member);
        assertEquals(0, after);
        assertThrows(ResponseStatusException.class, () -> service.setRsvp(member,
                e.event().id(), "WAITLISTED"));      // not client-settable
    }

    @Test
    void capacityEnforcedWithWaitlistAndPromotion() {
        var e = createSimple(organizer, "Small event", inHours(24), 2);
        assertEquals("GOING", service.setRsvp(organizer, e.event().id(), "GOING")
                .status());
        assertEquals("GOING", service.setRsvp(member, e.event().id(), "GOING")
                .status());
        // full → waitlisted
        var waitlisted = service.setRsvp(member2, e.event().id(), "GOING");
        assertEquals("WAITLISTED", waitlisted.status());
        assertEquals(2, waitlisted.counts().going());
        assertEquals(1, waitlisted.counts().waitlisted());
        // a GOING participant declines → earliest waitlisted promoted
        var declined = service.setRsvp(organizer, e.event().id(), "NOT_GOING");
        assertEquals(2, declined.counts().going());
        assertEquals(0, declined.counts().waitlisted());
        assertEquals(member2, declined.promotedUserId());
        assertEquals("GOING", jdbc.queryForObject(
                "SELECT status::text FROM event_rsvps WHERE event_id=? AND"
                        + " user_id=?", String.class, e.event().id(), member2));
        // waitlisted participant stays on the list when space remains occupied
        assertEquals("WAITLISTED", service.setRsvp(organizer, e.event().id(),
                "GOING").status());
        // capacity cannot be reduced below current GOING count
        var ex = assertThrows(ResponseStatusException.class,
                () -> service.update(organizer, e.event().id(), null, null, null,
                        null, null, null, null, null, null, 1, null, null, null,
                        false));
        assertEquals(HttpStatus.CONFLICT, ex.getStatusCode());
    }

    @Test
    void capacityIncreasePromotesWaitlistInFifoOrder() {
        var e = createSimple(organizer, "Growing event", inHours(24), 1);
        service.setRsvp(organizer, e.event().id(), "GOING");
        service.setRsvp(member, e.event().id(), "GOING");   // waitlisted 1st
        service.setRsvp(member2, e.event().id(), "GOING");  // waitlisted 2nd
        assertEquals(1, service.counts(e.event().id()).going());
        assertEquals(2, service.counts(e.event().id()).waitlisted());

        // one extra seat → only the earliest waitlisted participant promotes
        service.update(organizer, e.event().id(), null, null, null, null, null,
                null, null, null, null, 2, null, null, null, false);
        var counts = service.counts(e.event().id());
        assertEquals(2, counts.going());
        assertEquals(1, counts.waitlisted());
        assertEquals("GOING", rsvpStatusOf(e.event().id(), member));
        assertEquals("WAITLISTED", rsvpStatusOf(e.event().id(), member2));

        // enough seats for everyone → the rest of the waitlist drains
        service.update(organizer, e.event().id(), null, null, null, null, null,
                null, null, null, null, 5, null, null, null, false);
        assertEquals(3, service.counts(e.event().id()).going());
        assertEquals(0, service.counts(e.event().id()).waitlisted());
        assertEquals("GOING", rsvpStatusOf(e.event().id(), member2));

        // raising capacity still promotes after the event has started
        var late = createSimple(organizer, "Late growth", inHours(24), 1);
        service.setRsvp(organizer, late.event().id(), "GOING");
        service.setRsvp(member, late.event().id(), "GOING");  // waitlisted
        jdbc.update("UPDATE events SET starts_at=now()-interval '1 hour'"
                + " WHERE id=?", late.event().id());
        service.update(organizer, late.event().id(), null, null, null, null,
                null, null, null, null, null, 2, null, null, null, false);
        assertEquals("GOING", rsvpStatusOf(late.event().id(), member));
        // lowering capacity after start remains blocked
        var tooLate = assertThrows(ResponseStatusException.class,
                () -> service.update(organizer, late.event().id(), null, null,
                        null, null, null, null, null, null, null, 1, null,
                        null, null, false));
        assertEquals(HttpStatus.CONFLICT, tooLate.getStatusCode());
    }

    @Test
    void concurrentCapacityIncreaseAndRsvpNeverOversell() throws Exception {
        var e = createSimple(organizer, "Contested growth", inHours(24), 1);
        service.setRsvp(organizer, e.event().id(), "GOING");  // event is full
        UUID extra1 = user("ev-growth-1");
        UUID extra2 = user("ev-growth-2");
        UUID extra3 = user("ev-growth-3");
        UUID extra4 = user("ev-growth-4");
        for (UUID u : new UUID[]{extra1, extra2, extra3, extra4}) {
            jdbc.update("UPDATE profiles SET origin_country_id=?,"
                    + " current_country_id=? WHERE id=?", origin, dest, u);
            communities.join(u, community);
        }
        ExecutorService pool = Executors.newFixedThreadPool(5);
        try {
            Future<?> raise = pool.submit(() -> service.update(organizer,
                    e.event().id(), null, null, null, null, null, null, null,
                    null, null, 5, null, null, null, false));
            Future<String> r1 = pool.submit(() -> service.setRsvp(extra1,
                    e.event().id(), "GOING").status());
            Future<String> r2 = pool.submit(() -> service.setRsvp(extra2,
                    e.event().id(), "GOING").status());
            Future<String> r3 = pool.submit(() -> service.setRsvp(extra3,
                    e.event().id(), "GOING").status());
            Future<String> r4 = pool.submit(() -> service.setRsvp(extra4,
                    e.event().id(), "GOING").status());
            // Join every task before asserting — a mid-flight transaction
            // holding row locks would deadlock the next test's TRUNCATE setup.
            RuntimeException failure = null;
            for (Future<?> f : new Future<?>[]{raise, r1, r2, r3, r4}) {
                try {
                    f.get(10, TimeUnit.SECONDS);
                } catch (ExecutionException ex) {
                    if (failure == null) {
                        failure = ex.getCause() instanceof RuntimeException re
                                ? re : new IllegalStateException(ex.getCause());
                    }
                }
            }
            if (failure != null) {
                throw failure;
            }
            // 5 seats, 5 participants: whether RSVPs landed before or after
            // the capacity raise, the final state must be 5 GOING / 0 WAITLISTED
            var counts = service.counts(e.event().id());
            assertEquals(5, counts.going());
            assertEquals(0, counts.waitlisted());
            Integer rows = jdbc.queryForObject(
                    "SELECT count(*) FROM event_rsvps WHERE event_id=?",
                    Integer.class, e.event().id());
            assertEquals(5, rows);                    // capacity never oversold
        } finally {
            pool.shutdownNow();
        }
    }

    private String rsvpStatusOf(UUID eventId, UUID userId) {
        return jdbc.queryForObject("SELECT status::text FROM event_rsvps"
                + " WHERE event_id=? AND user_id=?", String.class, eventId,
                userId);
    }

    @Test
    void concurrentRsvpNeverOversellsCapacity() throws Exception {
        var e = createSimple(organizer, "Contested", inHours(24), 1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<String> a = pool.submit(() -> service.setRsvp(organizer,
                    e.event().id(), "GOING").status());
            Future<String> b = pool.submit(() -> service.setRsvp(member,
                    e.event().id(), "GOING").status());
            String ra = a.get(10, TimeUnit.SECONDS);
            String rb = b.get(10, TimeUnit.SECONDS);
            assertTrue(("GOING".equals(ra) && "WAITLISTED".equals(rb))
                    || ("WAITLISTED".equals(ra) && "GOING".equals(rb)));
            Integer going = jdbc.queryForObject(
                    "SELECT count(*) FROM event_rsvps WHERE event_id=? AND"
                            + " status='GOING'", Integer.class, e.event().id());
            assertEquals(1, going);                  // capacity never oversold
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void participantsVisibleToViewersWithCounts() {
        var e = createSimple(organizer, "Participants", inHours(24), null);
        service.setRsvp(organizer, e.event().id(), "GOING");
        service.setRsvp(member, e.event().id(), "INTERESTED");
        var page = service.participants(member, e.event().id(), null, 0, 20);
        assertEquals(2, page.items().size());
        assertEquals(1, page.counts().going());
        assertEquals(1, page.counts().interested());
        var goingOnly = service.participants(member, e.event().id(), "GOING",
                0, 20);
        assertEquals(1, goingOnly.items().size());
        // non-viewer cannot list participants
        assertThrows(ResponseStatusException.class, () -> service.participants(
                abroad, e.event().id(), null, 0, 20));
    }

    // =================== saves / my events ===================

    @Test
    void savesAndMyEvents() {
        var e = createSimple(organizer, "Saved target", inHours(24), null);
        service.save(member, e.event().id());
        service.save(member, e.event().id());        // idempotent
        var saved = service.savedEvents(member, 0, 20);
        assertEquals(1, ((List<?>) saved.get("items")).size());
        service.unsave(member, e.event().id());
        assertEquals(0, ((List<?>) service.savedEvents(member, 0, 20)
                .get("items")).size());

        service.setRsvp(member, e.event().id(), "GOING");
        var participating = service.myEvents(member, "participating", 0, 20);
        assertEquals(1, ((List<?>) participating.get("items")).size());
        var organized = service.myEvents(organizer, "organized", 0, 20);
        assertEquals(1, ((List<?>) organized.get("items")).size());
        assertEquals(0, ((List<?>) service.myEvents(member, "organized", 0, 20)
                .get("items")).size());
    }

    // =================== cancellation / deletion lifecycle ===================

    @Test
    void cancellationBlocksRsvpAndEditing() {
        var e = createSimple(organizer, "To cancel", inHours(24), null);
        service.setRsvp(member, e.event().id(), "GOING");
        var cancelled = service.cancel(organizer, e.event().id(), "Venue lost");
        assertNotNull(cancelled.event().cancelledAt());
        assertEquals("Venue lost", cancelled.event().cancelReason());
        // RSVP after cancellation → 409
        var ex = assertThrows(ResponseStatusException.class,
                () -> service.setRsvp(member2, e.event().id(), "GOING"));
        assertEquals(HttpStatus.CONFLICT, ex.getStatusCode());
        // editing a cancelled event → 409
        assertThrows(ResponseStatusException.class, () -> service.update(organizer,
                e.event().id(), null, "Too late", null, null, null, null, null,
                null, null, null, null, null, null, false));
        // has GOING participants → delete forbidden
        assertThrows(ResponseStatusException.class,
                () -> service.delete(organizer, e.event().id()));
        // removing the last participant allows delete
        service.removeRsvp(member, e.event().id());
        service.delete(organizer, e.event().id());
        assertThrows(ResponseStatusException.class,
                () -> service.detail(organizer, e.event().id()));
    }

    // =================== business account events ===================

    @Test
    void businessAccountEventManagement() {
        var account = businessService.create(organizer, "Event Workspace");
        UUID editor = member;
        UUID listingManager = member2;
        jdbc.update("INSERT INTO business_account_members(business_account_id,"
                + "user_id,role_key,invited_by_user_id,updated_by_user_id,"
                + "accepted_at) VALUES(?,?,'EDITOR',?,?,now())",
                account.id(), editor, organizer, organizer);
        jdbc.update("INSERT INTO business_account_members(business_account_id,"
                + "user_id,role_key,invited_by_user_id,updated_by_user_id,"
                + "accepted_at) VALUES(?,?,'LISTING_MANAGER',?,?,now())",
                account.id(), listingManager, organizer, organizer);
        assertTrue(businessApi.membership(editor, account.id()).isPresent());

        // EDITOR may create on behalf of the account
        var e = service.create(editor, community, "COMMUNITY", categoryId, null,
                "Business event", "Body", "IN_PERSON", inHours(24), null, "UTC",
                "Hall", null, null, null, account.id(), false);
        assertEquals(account.id(), e.event().businessAccountId());
        assertEquals(editor, e.event().organizerId());
        assertTrue(e.canManage());
        // OWNER may manage too
        assertTrue(service.canManage(organizer, service.detail(organizer,
                e.event().id()).event()));
        // LISTING_MANAGER may not create or manage events
        assertThrows(ResponseStatusException.class, () -> service.create(
                listingManager, community, "COMMUNITY", categoryId, null,
                "No role", "Body", "IN_PERSON", inHours(24), null, "UTC", "Hall",
                null, null, null, account.id(), false));
        assertFalse(service.canManage(listingManager, e.event()));
        // business event appears in the organized list for both OWNER and EDITOR
        assertEquals(1, ((List<?>) service.myEvents(editor, "organized", 0, 20)
                .get("items")).size());
        assertEquals(1, ((List<?>) service.myEvents(organizer, "organized", 0, 20)
                .get("items")).size());
    }

    // =================== reporting ===================

    @Test
    void eventReporting() {
        var e = createSimple(organizer, "Reportable", inHours(24), null);
        UUID reportId = service.report(member, e.event().id(), "SPAM",
                "Looks like spam");
        assertNotNull(reportId);
        Integer stored = jdbc.queryForObject(
                "SELECT count(*) FROM reports WHERE id=? AND target_type='EVENT'"
                        + " AND target_id=?", Integer.class, reportId,
                e.event().id());
        assertEquals(1, stored);
        // duplicate open report → 409
        var ex = assertThrows(ResponseStatusException.class, () -> service.report(
                member, e.event().id(), "OTHER", null));
        assertEquals(HttpStatus.CONFLICT, ex.getStatusCode());
        // invalid reason → 400
        assertThrows(ResponseStatusException.class, () -> service.report(member2,
                e.event().id(), "NOT_A_REASON", null));
        // non-viewer cannot report
        assertThrows(ResponseStatusException.class, () -> service.report(abroad,
                e.event().id(), "SPAM", null));
    }

    // =================== HTTP endpoints ===================

    @Test
    void httpEndpointsWork() throws Exception {
        var asOrganizer = asUser(organizer, "ev-organizer@test.com");
        var asMember = asUser(member, "ev-member@test.com");
        String body = """
                {"communityId":"%s","categoryId":"%s","title":"HTTP event",
                 "description":"Created over HTTP","eventMode":"IN_PERSON",
                 "startsAt":"%s","timezone":"Europe/Berlin",
                 "locationName":"Test hall","capacity":10}
                """.formatted(community, categoryId,
                        inHours(30).toString());
        mvc.perform(post("/api/v1/events").with(asOrganizer)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.event.title").value("HTTP event"))
                .andExpect(jsonPath("$.event.status").value("PUBLISHED"))
                .andExpect(jsonPath("$.canManage").value(true))
                .andExpect(jsonPath("$.counts.going").value(0));
        UUID eventId = jdbc.queryForObject(
                "SELECT id FROM events WHERE title='HTTP event'", UUID.class);

        mvc.perform(put("/api/v1/events/" + eventId + "/rsvp").with(asMember)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"GOING\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("GOING"))
                .andExpect(jsonPath("$.counts.going").value(1));

        // PATCH visibility switch over HTTP — organizer only
        mvc.perform(patch("/api/v1/events/" + eventId).with(asMember)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"visibilityScope\":\"COUNTRY\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(patch("/api/v1/events/" + eventId).with(asOrganizer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"visibilityScope\":\"COUNTRY\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.event.visibilityScope").value("COUNTRY"));
        mvc.perform(patch("/api/v1/events/" + eventId).with(asOrganizer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"visibilityScope\":\"COMMUNITY\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.event.visibilityScope").value("COMMUNITY"));

        mvc.perform(get("/api/v1/events/" + eventId).with(asMember))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.myRsvp").value("GOING"))
                .andExpect(jsonPath("$.counts.going").value(1));

        mvc.perform(get("/api/v1/events/" + eventId + "/participants").with(asMember))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1));

        mvc.perform(get("/api/v1/events?size=10").with(asMember))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1));

        mvc.perform(get("/api/v1/communities/" + community + "/events")
                        .with(asMember))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1));

        mvc.perform(get("/api/v1/events/categories").with(asMember))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].categoryKey").exists());

        mvc.perform(put("/api/v1/events/" + eventId + "/save").with(asMember))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/me/events/saved").with(asMember))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1));

        mvc.perform(get("/api/v1/me/events?role=participating").with(asMember))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1));

        mvc.perform(post("/api/v1/events/" + eventId + "/report").with(asMember)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"SPAM\"}"))
                .andExpect(status().isCreated());

        mvc.perform(get("/api/v1/events")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/events/" + eventId)).andExpect(
                status().isUnauthorized());
    }
}
