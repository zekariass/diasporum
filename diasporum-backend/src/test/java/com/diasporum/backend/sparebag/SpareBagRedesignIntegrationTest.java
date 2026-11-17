package com.diasporum.backend.sparebag;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import com.diasporum.backend.sparebag.internal.application.v2.SenderRequestService;
import com.diasporum.backend.sparebag.internal.application.v2.SpareBagMatchService;
import com.diasporum.backend.sparebag.internal.application.v2.SpareBagPostingExpiryWorker;
import com.diasporum.backend.sparebag.internal.application.v2.SpareBagReferenceService;
import com.diasporum.backend.sparebag.internal.application.v2.TravellerJourneyService;
import com.diasporum.backend.sparebag.internal.application.v2.TravellerProfileService;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.CountryConfigInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.JourneyFilters;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.JourneyInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.MatchInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.MatchView;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.SenderItemInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.SenderRequestFilters;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.SenderRequestInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.TravellerProfileInput;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
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

/**
 * v10.15 Spare Bag (traveller profiles, journeys, sender requests, matching,
 * moderation, country rules, expiry) on real migrated PostgreSQL/PostGIS with
 * real module integrations. The legacy listing model keeps its own test class.
 */
@SpringBootTest(properties = {
    "diasporum.spare-bag.v2.moderation-mode=MANUAL",
    "diasporum.spare-bag.v2.expiry-interval=PT24H"
})
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class SpareBagRedesignIntegrationTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";
    private static final BigDecimal ONE = BigDecimal.ONE;

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired SpareBagReferenceService reference;
    @Autowired TravellerProfileService travellers;
    @Autowired TravellerJourneyService journeys;
    @Autowired SenderRequestService requests;
    @Autowired SpareBagMatchService matches;
    @Autowired SpareBagPostingExpiryWorker worker;
    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;

    private UUID et;
    private UUID de;
    private UUID gb;
    private UUID us;
    private UUID admin;

    @BeforeEach
    void setup() {
        jdbc.execute("TRUNCATE spare_bag_match_requests,spare_bag_sender_request_media,"
                + "spare_bag_sender_items,spare_bag_sender_requests,spare_bag_traveller_journeys,"
                + "spare_bag_traveller_profiles,spare_bag_country_config,moderation_queue,"
                + "moderation_actions,audit_logs,reports,direct_conversations,idempotency_keys,"
                + "notifications,outbox_events,media_objects,community_memberships,"
                + "global_user_roles CASCADE");
        et = country("ET");
        de = country("DE");
        gb = country("GB");
        us = country("US");
        admin = user("sb2-admin", et);
        jdbc.update("INSERT INTO global_user_roles(user_id,role_key,scope_type) "
                + "VALUES(?,'PLATFORM_ADMIN','GLOBAL')", admin);
    }

    // =================== fixtures ===================

    private UUID country(String iso2) {
        return jdbc.queryForObject("SELECT id FROM countries WHERE iso2=?", UUID.class, iso2);
    }

    private UUID user(String subject, UUID origin) {
        UUID id = IdentityTestSupport.provision(ctx, ISSUER, subject);
        jdbc.update("UPDATE profiles SET origin_country_id=?,current_country_id=? WHERE id=?",
                origin, origin, id);
        return id;
    }

    private UUID community(UUID origin, UUID destination) {
        jdbc.update("INSERT INTO communities(name,slug,origin_country_id,destination_country_id) "
                + "VALUES(?,?,?,?) ON CONFLICT (origin_country_id,destination_country_id) "
                + "DO UPDATE SET is_active=true", "sb2 " + origin + " " + destination,
                "sb2-" + origin + "-" + destination, origin, destination);
        return jdbc.queryForObject("SELECT id FROM communities WHERE origin_country_id=? "
                + "AND destination_country_id=?", UUID.class, origin, destination);
    }

    /** SECONDARY membership: the viewer's profile origin must match the community origin. */
    private void member(UUID user, UUID communityId) {
        jdbc.update("INSERT INTO community_memberships(community_id,user_id,membership_type) "
                + "VALUES(?,?,'SECONDARY')", communityId, user);
    }

    private RequestPostProcessor asUser(UUID userId) {
        return authentication(new UsernamePasswordAuthenticationToken(
                new DiasporumUserPrincipal(userId, UUID.randomUUID(),
                        userId + "@test.invalid", List.of()), null, List.of()));
    }

    private static String code(Executable call) {
        return assertThrows(ResponseStatusException.class, call).getReason();
    }

    private static SenderItemInput item(String name, String category) {
        return new SenderItemInput(name, null, category, ONE, "PIECE", null, null, null, null);
    }

    private static SenderRequestInput requestInput(UUID from, UUID to,
            List<SenderItemInput> items) {
        return new SenderRequestInput(from, "Frankfurt", to, "London", "Two parcels", null,
                items, List.of());
    }

    private static JourneyInput journeyInput(UUID from, UUID to, LocalDate date,
            List<String> categories) {
        return new JourneyInput(from, "Frankfurt", to, "London", null, null, null, null, date,
                null, new BigDecimal("10"), new BigDecimal("5"), new BigDecimal("8"), null,
                "EUR", categories, null, null);
    }

    private void traveller(UUID user) {
        travellers.upsert(user, new TravellerProfileInput("Traveller " + user, null, null, null));
    }

    private UUID publishedRequest(UUID owner, UUID from, UUID to, String category) {
        UUID id = requests.create(owner, requestInput(from, to,
                List.of(item("Parcel", category)))).request().id();
        requests.publish(owner, id);
        return requests.moderate(admin, id, "APPROVE", null).request().id();
    }

    private UUID publishedJourney(UUID owner, UUID from, UUID to, List<String> categories) {
        UUID id = journeys.create(owner, journeyInput(from, to, LocalDate.now().plusDays(10),
                categories)).journey().id();
        journeys.publish(owner, id);
        return journeys.moderate(admin, id, "APPROVE", null).journey().id();
    }

    private String requestStatus(UUID id) {
        return jdbc.queryForObject("SELECT status FROM spare_bag_sender_requests WHERE id=?",
                String.class, id);
    }

    private String journeyStatus(UUID id) {
        return jdbc.queryForObject("SELECT status FROM spare_bag_traveller_journeys WHERE id=?",
                String.class, id);
    }

    private String matchStatus(UUID id) {
        return jdbc.queryForObject("SELECT status FROM spare_bag_match_requests WHERE id=?",
                String.class, id);
    }

    private Set<UUID> requestIds(UUID viewer) {
        return requests.search(viewer, new SenderRequestFilters(null, null, null), null, null)
                .items().stream().map(v -> v.request().id()).collect(Collectors.toSet());
    }

    private Set<UUID> journeyIds(UUID viewer, boolean verifiedOnly) {
        return journeys.search(viewer, new JourneyFilters(null, null, null, null, null,
                verifiedOnly), null, null).items().stream().map(v -> v.journey().id())
                .collect(Collectors.toSet());
    }

    // =================== tests ===================

    @Test
    void senderRequestLifecycleModerationAndProhibitedCategories() throws Exception {
        UUID sender = user("sb2-life-sender", et);
        UUID other = user("sb2-life-other", et);
        UUID usModerator = user("sb2-life-us-mod", et);
        jdbc.update("INSERT INTO global_user_roles(user_id,role_key,scope_type,country_id) "
                + "VALUES(?,'PLATFORM_MODERATOR','COUNTRY',?)", usModerator, us);
        UUID viewer = user("sb2-life-viewer", et);
        member(viewer, community(et, gb));

        reference.upsertCountryConfig(admin, de,
                new CountryConfigInput(null, null, List.of("gifts"), "Customs rules apply"));
        assertEquals("PROHIBITED_CATEGORY", code(() -> requests.create(sender,
                requestInput(de, gb, List.of(item("Scarf", "GIFTS"))))));
        // schema CHECK (per-unit amount without its unit) surfaced as a 400, not re-implemented
        var unpaired = new SenderItemInput("Coffee", null, "OTHER", new BigDecimal("2"), "KG",
                new BigDecimal("5"), null, null, null);
        assertEquals("SENDER_ITEM_INVALID", code(() -> requests.create(sender,
                requestInput(de, gb, List.of(unpaired)))));
        assertEquals("INVALID_MEASUREMENT_UNIT", code(() -> requests.create(sender,
                requestInput(de, gb, List.of(new SenderItemInput("X", null, null, ONE, "TONNE",
                        null, null, null, null))))));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM spare_bag_sender_requests",
                Integer.class));

        // item disclosure: a draft may omit categories, publication may not
        UUID id = requests.create(sender, requestInput(de, gb, List.of(new SenderItemInput(
                "Box", "Kitchen things", null, ONE, "BOX", null, null, null, null))))
                .request().id();
        assertEquals("DRAFT", requestStatus(id));
        assertEquals("ITEM_DISCLOSURE_REQUIRED", code(() -> requests.publish(sender, id)));
        requests.update(sender, id, requestInput(de, gb, List.of(item("Books", "books"))));
        assertEquals("BOOKS", requests.items(id).get(0).categoryKey());

        var pending = requests.publish(sender, id);
        assertEquals("PENDING_REVIEW", pending.request().status());
        assertNotNull(pending.request().closesAt()); // default TTL applied
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM moderation_queue WHERE "
                + "content_type='SPARE_BAG_SENDER_REQUEST' AND content_id=? "
                + "AND queue_status='PENDING'", Integer.class, id));
        assertFalse(requestIds(viewer).contains(id));

        assertEquals("MODERATOR_REQUIRED", code(() -> requests.moderate(other, id, "APPROVE", null)));
        assertEquals("MODERATOR_REQUIRED", // country moderator for neither route end
                code(() -> requests.moderate(usModerator, id, "APPROVE", null)));
        assertEquals("REASON_REQUIRED", code(() -> requests.moderate(admin, id, "REJECT", " ")));
        assertEquals("DRAFT", requests.moderate(admin, id, "REJECT", "Describe the items")
                .request().status());
        assertEquals("REJECT", jdbc.queryForObject("SELECT decision FROM moderation_queue "
                + "WHERE content_id=? AND queue_status='RESOLVED'", String.class, id));
        assertEquals("REJECT_LISTING", jdbc.queryForObject("SELECT action_type::text FROM "
                + "moderation_actions WHERE target_id=?", String.class, id));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM audit_logs WHERE target_id=? "
                + "AND action_key='SPARE_BAG_REJECT'", Integer.class, id));

        assertEquals("PENDING_REVIEW", requests.publish(sender, id).request().status());
        var live = requests.moderate(admin, id, "APPROVE", null);
        assertEquals("PUBLISHED", live.request().status());
        assertNotNull(live.request().publishedAt());
        assertTrue(requestIds(viewer).contains(id));

        assertEquals("PAUSED", requests.pause(sender, id).request().status());
        assertFalse(requestIds(viewer).contains(id));
        assertEquals("PUBLISHED", requests.publish(sender, id).request().status()); // no re-review
        assertEquals("CLOSED", requests.close(sender, id).request().status());
        assertEquals("INVALID_SENDER_REQUEST_TRANSITION", code(() -> requests.pause(sender, id)));
        assertEquals("SENDER_REQUEST_NOT_EDITABLE", code(() -> requests.update(sender, id,
                requestInput(de, gb, List.of(item("Books", "BOOKS"))))));

        mvc.perform(get("/api/v1/spare-bag/v2/sender-requests/" + id).with(asUser(viewer)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SENDER_REQUEST_NOT_FOUND"));
        mvc.perform(get("/api/v1/spare-bag/v2/sender-requests/" + id).with(asUser(sender)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.request.status").value("CLOSED"))
                .andExpect(jsonPath("$.items[0].categoryKey").value("BOOKS"));
    }

    @Test
    void journeyPublishRequiresFutureTravelDate() {
        UUID owner = user("sb2-journey-owner", et);
        UUID fra = jdbc.queryForObject("SELECT id FROM airports WHERE iata_code='FRA'", UUID.class);
        UUID lhr = jdbc.queryForObject("SELECT id FROM airports WHERE iata_code='LHR'", UUID.class);
        assertEquals("TRAVELLER_PROFILE_REQUIRED", code(() -> journeys.create(owner,
                journeyInput(de, gb, LocalDate.now().plusDays(3), null))));
        traveller(owner);

        JourneyInput swapped = new JourneyInput(de, "Frankfurt", gb, "London", lhr, fra, null,
                null, LocalDate.now().plusDays(3), null, null, null, null, null, null, null,
                null, null);
        assertEquals("JOURNEY_AIRPORT_COUNTRY_MISMATCH", code(() -> journeys.create(owner, swapped)));
        JourneyInput withAirports = new JourneyInput(de, "Frankfurt", gb, "London", fra, lhr,
                null, null, LocalDate.now().plusDays(3), null, null, null, null, null, null,
                null, null, null);
        assertEquals(fra, journeys.create(owner, withAirports).journey().fromAirportId());
        // schema CHECK max_single_parcel_kg <= available_capacity_kg surfaced as JOURNEY_INVALID
        JourneyInput overweight = new JourneyInput(de, "Frankfurt", gb, "London", null, null,
                null, null, LocalDate.now().plusDays(3), null, new BigDecimal("5"),
                new BigDecimal("9"), null, null, null, null, null, null);
        assertEquals("JOURNEY_INVALID", code(() -> journeys.create(owner, overweight)));

        // a past-dated draft may exist, but can never be published
        UUID past = journeys.create(owner, journeyInput(de, gb, LocalDate.now().minusDays(1),
                null)).journey().id();
        assertEquals("JOURNEY_TRAVEL_DATE_PAST", code(() -> journeys.publish(owner, past)));
        assertEquals("DRAFT", journeyStatus(past));

        // the date passes while the journey waits in review: approval re-checks it
        UUID reviewed = journeys.create(owner, journeyInput(de, gb, LocalDate.now().plusDays(2),
                null)).journey().id();
        assertEquals("PENDING_REVIEW", journeys.publish(owner, reviewed).journey().status());
        jdbc.update("UPDATE spare_bag_traveller_journeys SET travel_date=CURRENT_DATE-1 "
                + "WHERE id=?", reviewed);
        assertEquals("JOURNEY_TRAVEL_DATE_PAST",
                code(() -> journeys.moderate(admin, reviewed, "APPROVE", null)));
        assertEquals("PENDING_REVIEW", journeyStatus(reviewed));

        // today is still allowed
        UUID today = journeys.create(owner, journeyInput(de, gb, LocalDate.now(), null))
                .journey().id();
        journeys.publish(owner, today);
        assertEquals("PUBLISHED", journeys.moderate(admin, today, "APPROVE", null)
                .journey().status());
        assertEquals("MODERATION_STATE_INVALID", code(() -> journeys.moderate(admin, today,
                "APPROVE", null)));
        assertEquals("JOURNEY_NOT_DELETABLE", code(() -> journeys.delete(owner, today)));
        journeys.delete(owner, past);
        assertEquals("JOURNEY_NOT_FOUND", code(() -> journeys.detail(owner, past)));
    }

    @Test
    void visibilityFollowsCommunityDestinationBothDirections() throws Exception {
        UUID sender = user("sb2-vis-sender", et);
        UUID carrier = user("sb2-vis-carrier", et);
        traveller(carrier);
        UUID request = publishedRequest(sender, de, gb, "DOCUMENTS");
        UUID journey = publishedJourney(carrier, de, gb, null);

        UUID fromSide = user("sb2-vis-from", et);      // community destination = DE = from
        member(fromSide, community(et, de));
        UUID toSide = user("sb2-vis-to", et);          // community destination = GB = to
        member(toSide, community(et, gb));
        UUID home = user("sb2-vis-home", de);          // home-country community DE -> DE
        member(home, community(de, de));
        UUID outsider = user("sb2-vis-outsider", et);  // destination US matches neither end
        member(outsider, community(et, us));
        UUID unaffiliated = user("sb2-vis-none", et);

        for (UUID viewer : List.of(fromSide, toSide, home)) {
            assertEquals(Set.of(request), requestIds(viewer));
            assertEquals(Set.of(journey), journeyIds(viewer, false));
            assertEquals(request, requests.detail(viewer, request).request().id());
            assertEquals(journey, journeys.detail(viewer, journey).journey().id());
        }
        for (UUID viewer : List.of(outsider, unaffiliated)) {
            assertTrue(requestIds(viewer).isEmpty());
            assertTrue(journeyIds(viewer, false).isEmpty());
            assertEquals("SENDER_REQUEST_NOT_FOUND", code(() -> requests.detail(viewer, request)));
            assertEquals("JOURNEY_NOT_FOUND", code(() -> journeys.detail(viewer, journey)));
        }

        // the reverse route GB -> DE is matched through the other end of each community
        UUID reverse = publishedRequest(sender, gb, de, "DOCUMENTS");
        assertTrue(requestIds(fromSide).contains(reverse));
        assertTrue(requestIds(toSide).contains(reverse));
        assertFalse(requestIds(outsider).contains(reverse));

        mvc.perform(get("/api/v1/spare-bag/v2/sender-requests").param("toCountryId", gb.toString())
                .with(asUser(toSide)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].request.id").value(request.toString()));
        mvc.perform(get("/api/v1/spare-bag/v2/journeys").with(asUser(outsider)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0));
    }

    @Test
    void matchAcceptLinksConversationAndMatchesRequest() throws Exception {
        UUID sender = user("sb2-match-sender", et);
        member(sender, community(et, gb));
        UUID carrier = user("sb2-match-carrier", et);
        member(carrier, community(et, gb));
        UUID rival = user("sb2-match-rival", et);
        member(rival, community(et, gb));
        traveller(carrier);
        traveller(rival);
        UUID request = publishedRequest(sender, de, gb, "BOOKS");
        UUID journey = publishedJourney(carrier, de, gb, null);
        UUID rivalJourney = publishedJourney(rival, de, gb, List.of("BOOKS", "DOCUMENTS"));
        UUID wrongRoute = publishedJourney(carrier, de, us, null);
        UUID docsOnly = publishedJourney(carrier, de, gb, List.of("DOCUMENTS"));

        assertEquals("ROUTE_MISMATCH", code(() -> matches.create(carrier,
                new MatchInput(request, wrongRoute, null, "k-route"))));
        assertEquals("CATEGORY_NOT_ACCEPTED", code(() -> matches.create(carrier,
                new MatchInput(request, docsOnly, null, "k-cat"))));
        assertEquals("NOT_POSTING_OWNER", code(() -> matches.create(rival,
                new MatchInput(request, journey, null, "k-x"))));

        MatchView first = matches.create(carrier, new MatchInput(request, journey,
                "I fly on the 10th", "k-1"));
        assertEquals("PENDING", first.match().status());
        assertTrue(matches.detail(sender, first.match().id()).incoming());
        // idempotent replay; same key with a different payload is rejected
        assertEquals(first.match().id(), matches.create(carrier, new MatchInput(request,
                journey, "I fly on the 10th", "k-1")).match().id());
        assertEquals("IDEMPOTENCY_KEY_REUSED", code(() -> matches.create(carrier,
                new MatchInput(request, journey, "changed", "k-1"))));
        // the sender may also initiate (towards the rival's journey)
        MatchView competing = matches.create(sender, new MatchInput(request, rivalJourney,
                null, "k-2"));

        assertEquals("REQUESTER_CANNOT_RESPOND",
                code(() -> matches.accept(carrier, first.match().id(), null)));
        MatchView accepted = matches.accept(sender, first.match().id(), "Great, thanks");
        assertEquals("ACCEPTED", accepted.match().status());
        UUID conversation = accepted.match().directConversationId();
        assertNotNull(conversation);
        assertEquals("MATCHED", requestStatus(request));
        assertEquals("PUBLISHED", journeyStatus(journey)); // journeys can carry for several senders
        assertEquals("EXPIRED", matchStatus(competing.match().id()));

        Map<String, Object> thread = jdbc.queryForMap("SELECT context_type,context_id,"
                + "participant_a_id,participant_b_id,status FROM direct_conversations WHERE id=?",
                conversation);
        assertEquals("SPARE_BAG_SENDER_REQUEST", thread.get("context_type"));
        assertEquals(request, thread.get("context_id"));
        assertEquals(Set.of(sender, carrier),
                Set.of(thread.get("participant_a_id"), thread.get("participant_b_id")));
        assertEquals(conversation,
                matches.openConversation(carrier, first.match().id()).match().directConversationId());

        // the matched request stays readable for the matched traveller only
        assertEquals("MATCHED", requests.detail(carrier, request).request().status());
        assertEquals("SENDER_REQUEST_NOT_FOUND", code(() -> requests.detail(rival, request)));
        assertEquals("SENDER_REQUEST_NOT_FOUND", code(() -> matches.create(rival,
                new MatchInput(request, rivalJourney, null, "k-late"))));
        // the matched traveller can still see it, but it is no longer matchable
        assertEquals("POSTING_NOT_AVAILABLE", code(() -> matches.create(carrier,
                new MatchInput(request, docsOnly, null, "k-late-2"))));

        // REST callers cannot open this module-only context type with an invented context
        mvc.perform(post("/api/v1/conversations").with(asUser(rival))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"contextType\":\"SPARE_BAG_SENDER_REQUEST\",\"contextId\":\""
                        + request + "\",\"recipientUserId\":\"" + sender + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_CONTEXT_TYPE"));

        // deal falls through: close the match, then the sender re-opens the request
        assertEquals("MATCH_STILL_ACCEPTED", code(() -> requests.reopen(sender, request)));
        assertEquals("CLOSED", matches.close(carrier, first.match().id()).match().status());
        assertEquals("PUBLISHED", requests.reopen(sender, request).request().status());

        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM notifications WHERE "
                + "recipient_user_id=? AND dedupe_key=?", Integer.class, carrier,
                "spare-bag-match-accepted:" + first.match().id()));
        mvc.perform(get("/api/v1/spare-bag/v2/match-requests").param("direction", "OUTGOING")
                .with(asUser(carrier)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].match.id").value(first.match().id().toString()));
    }

    @Test
    void disabledCountryBlocksPosting() throws Exception {
        UUID sender = user("sb2-gate-sender", et);
        UUID carrier = user("sb2-gate-carrier", et);
        traveller(carrier);
        UUID draft = requests.create(sender, requestInput(de, gb,
                List.of(item("Papers", "DOCUMENTS")))).request().id();

        assertEquals("PLATFORM_ADMIN_REQUIRED", code(() -> reference.upsertCountryConfig(sender,
                gb, new CountryConfigInput(false, null, null, null))));
        reference.upsertCountryConfig(admin, gb,
                new CountryConfigInput(false, null, null, "Spare Bag is paused for the UK"));

        assertEquals("SPARE_BAG_COUNTRY_DISABLED", code(() -> requests.create(sender,
                requestInput(de, gb, List.of(item("Papers", "DOCUMENTS"))))));
        assertEquals("SPARE_BAG_COUNTRY_DISABLED", code(() -> requests.create(sender,
                requestInput(gb, de, List.of(item("Papers", "DOCUMENTS"))))));
        assertEquals("SPARE_BAG_COUNTRY_DISABLED", code(() -> journeys.create(carrier,
                journeyInput(de, gb, LocalDate.now().plusDays(4), null))));
        assertEquals("SPARE_BAG_COUNTRY_DISABLED", code(() -> requests.publish(sender, draft)));
        assertEquals("DRAFT", requestStatus(draft));
        // other routes are unaffected
        assertEquals("DRAFT", requests.create(sender, requestInput(de, us,
                List.of(item("Papers", "DOCUMENTS")))).request().status());

        mvc.perform(get("/api/v1/spare-bag/v2/country-config/" + gb).with(asUser(sender)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(false))
                .andExpect(jsonPath("$.configured").value(true))
                .andExpect(jsonPath("$.legalNotice").value("Spare Bag is paused for the UK"));
        mvc.perform(get("/api/v1/spare-bag/v2/country-config/" + us).with(asUser(sender)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.requiresItemDisclosure").value(true))
                .andExpect(jsonPath("$.configured").value(false));
        mvc.perform(post("/api/v1/spare-bag/v2/sender-requests").with(asUser(sender))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"fromCountryId\":\"" + de + "\",\"fromCity\":\"Berlin\","
                        + "\"toCountryId\":\"" + gb + "\",\"toCity\":\"Leeds\",\"items\":[]}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SPARE_BAG_COUNTRY_DISABLED"));
    }

    @Test
    void expiryWorkerIsIdempotentUnderConcurrency() throws Exception {
        UUID sender = user("sb2-exp-sender", et);
        UUID carrier = user("sb2-exp-carrier", et);
        member(carrier, community(et, gb));
        traveller(carrier);
        UUID staleRequest = publishedRequest(sender, de, gb, "DOCUMENTS");
        jdbc.update("UPDATE spare_bag_sender_requests SET created_at=now()-interval '3 days',"
                + "closes_at=now()-interval '1 day' WHERE id=?", staleRequest);
        UUID pastJourney = publishedJourney(carrier, de, gb, null);
        jdbc.update("UPDATE spare_bag_traveller_journeys SET travel_date=CURRENT_DATE-1 "
                + "WHERE id=?", pastJourney);
        // a pending match whose journey is paused can no longer be accepted
        UUID liveRequest = publishedRequest(sender, de, gb, "DOCUMENTS");
        UUID pausedJourney = publishedJourney(carrier, de, gb, null);
        UUID pendingMatch = matches.create(carrier, new MatchInput(liveRequest, pausedJourney,
                null, "k-exp")).match().id();
        journeys.pause(carrier, pausedJourney);
        // a request withdrawn while in review leaves a stale queue row
        UUID withdrawn = requests.create(sender, requestInput(de, gb,
                List.of(item("Papers", "DOCUMENTS")))).request().id();
        requests.publish(sender, withdrawn);
        requests.close(sender, withdrawn);

        var pool = Executors.newFixedThreadPool(4);
        List<SpareBagPostingExpiryWorker.RunResult> results = new ArrayList<>();
        try {
            CountDownLatch ready = new CountDownLatch(4);
            CountDownLatch start = new CountDownLatch(1);
            List<Future<SpareBagPostingExpiryWorker.RunResult>> runs = new ArrayList<>();
            for (int i = 0; i < 4; i++) {
                runs.add(pool.submit(() -> {
                    ready.countDown();
                    start.await();
                    return worker.expire();
                }));
            }
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            start.countDown();
            for (var run : runs) {
                results.add(run.get(30, TimeUnit.SECONDS));
            }
        } finally {
            pool.shutdownNow();
        }

        // each row transitions exactly once across the concurrent runs
        assertEquals(1, results.stream().mapToInt(r -> r.requestsExpired()).sum());
        assertEquals(1, results.stream().mapToInt(r -> r.journeysExpired()).sum());
        assertEquals(1, results.stream().mapToInt(r -> r.matchesExpired()).sum());
        assertEquals("EXPIRED", requestStatus(staleRequest));
        assertEquals("EXPIRED", journeyStatus(pastJourney));
        assertEquals("EXPIRED", matchStatus(pendingMatch));
        assertEquals("PUBLISHED", requestStatus(liveRequest));
        assertEquals("PAUSED", journeyStatus(pausedJourney));
        assertEquals("AUTO_RESOLVED", jdbc.queryForObject("SELECT queue_status FROM "
                + "moderation_queue WHERE content_id=?", String.class, withdrawn));

        int notifications = jdbc.queryForObject("SELECT count(*) FROM notifications",
                Integer.class);
        var again = worker.expire();
        assertEquals(new SpareBagPostingExpiryWorker.RunResult(0, 0, 0, 0), again);
        assertEquals(notifications, jdbc.queryForObject("SELECT count(*) FROM notifications",
                Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM notifications WHERE "
                + "dedupe_key=?", Integer.class, "spare-bag-v2-expired:" + staleRequest));
    }

    @Test
    void travellerVerificationAdminFlow() throws Exception {
        UUID carrier = user("sb2-ver-carrier", et);
        UUID other = user("sb2-ver-other", et);
        member(other, community(et, gb));
        traveller(carrier);
        UUID profileId = travellers.mine(carrier).profile().id();
        UUID journey = publishedJourney(carrier, de, gb, null);

        assertEquals("PENDING", travellers.submitVerification(carrier).profile()
                .verificationStatus());
        assertEquals("VERIFICATION_NOT_SUBMITTABLE",
                code(() -> travellers.submitVerification(carrier)));
        assertEquals("PLATFORM_ADMIN_REQUIRED", code(() -> travellers.decideVerification(other,
                profileId, "VERIFIED", null)));
        assertEquals("VERIFICATION_REASON_REQUIRED", code(() -> travellers.decideVerification(
                admin, profileId, "REJECTED", null)));
        assertEquals("REJECTED", travellers.decideVerification(admin, profileId, "REJECTED",
                "Document unreadable").profile().verificationStatus());
        assertEquals("REJECT_LISTING", jdbc.queryForObject("SELECT action_type::text FROM "
                + "moderation_actions WHERE target_user_id=? AND target_type IS NULL",
                String.class, carrier)); // the journey approval is the other (typed) action

        travellers.submitVerification(carrier);
        assertEquals(1, travellers.pendingVerifications(admin, null, null).items().size());
        assertTrue(travellers.decideVerification(admin, profileId, "VERIFIED", null).verified());
        assertEquals(Set.of(journey), journeyIds(other, true));
        mvc.perform(get("/api/v1/spare-bag/v2/travellers/" + profileId).with(asUser(other)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(true))
                .andExpect(jsonPath("$.canManage").value(false));

        assertEquals("INVALID_VERIFICATION_TRANSITION", code(() -> travellers.decideVerification(
                admin, profileId, "VERIFIED", null)));
        mvc.perform(post("/api/v1/admin/spare-bag/traveller-profiles/" + profileId
                + "/verification").with(asUser(admin)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"REVOKED\",\"reason\":\"Fraud report upheld\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.profile.verificationStatus").value("REVOKED"));
        assertTrue(journeyIds(other, true).isEmpty());
        assertEquals(Set.of(journey), journeyIds(other, false)); // badge only, not a gate

        traveller(admin);
        UUID adminProfile = travellers.mine(admin).profile().id();
        travellers.submitVerification(admin);
        assertEquals("CANNOT_VERIFY_OWN_PROFILE", code(() -> travellers.decideVerification(
                admin, adminProfile, "VERIFIED", null)));
    }

    @Test
    void referenceDataEndpoints() throws Exception {
        UUID someone = user("sb2-ref-user", et);
        mvc.perform(get("/api/v1/spare-bag/v2/measurement-units").with(asUser(someone)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(8));
        mvc.perform(get("/api/v1/spare-bag/v2/categories").with(asUser(someone)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(6));
        mvc.perform(put("/api/v1/spare-bag/v2/me/traveller-profile").with(asUser(someone))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"displayName\":\"Abebe\",\"acceptedItemCategories\":[\"WEAPONS\"]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_CATEGORY"));
        mvc.perform(put("/api/v1/spare-bag/v2/me/traveller-profile").with(asUser(someone))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"displayName\":\"Abebe\",\"acceptedItemCategories\":[\"documents\"],"
                        + "\"regularRoutes\":[{\"fromCountryId\":\"" + de + "\",\"toCountryId\":\""
                        + et + "\"}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.profile.acceptedItemCategories[0]").value("DOCUMENTS"))
                .andExpect(jsonPath("$.profile.regularRoutes[0].toCountryId").value(et.toString()))
                .andExpect(jsonPath("$.profile.verificationStatus").value("NOT_VERIFIED"))
                .andExpect(jsonPath("$.canManage").value(true));
        mvc.perform(get("/api/v1/admin/spare-bag/moderation").param("type", "JOURNEY")
                .with(asUser(someone)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MODERATOR_REQUIRED"));
    }
}
