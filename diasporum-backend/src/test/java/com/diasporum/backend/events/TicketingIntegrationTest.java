package com.diasporum.backend.events;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.diasporum.backend.community.internal.application.CommunityService;
import com.diasporum.backend.events.internal.application.EventService;
import com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService;
import com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.PromoCodeCommand;
import com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.SettingsCommand;
import com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.TicketTypeCommand;
import com.diasporum.backend.events.internal.application.ticketing.OrganiserPayoutService;
import com.diasporum.backend.events.internal.application.ticketing.PayoutAccountService;
import com.diasporum.backend.events.internal.application.ticketing.PayoutAccountService.AccountCommand;
import com.diasporum.backend.events.internal.application.ticketing.TicketCheckInService;
import com.diasporum.backend.events.internal.application.ticketing.TicketCheckInService.Scan;
import com.diasporum.backend.events.internal.application.ticketing.TicketOrderService;
import com.diasporum.backend.events.internal.application.ticketing.TicketOrderService.OrderView;
import com.diasporum.backend.events.internal.application.ticketing.TicketPaymentGateway;
import com.diasporum.backend.events.internal.application.ticketing.TicketRefundService;
import com.diasporum.backend.events.internal.application.ticketing.TicketReservationService;
import com.diasporum.backend.events.internal.application.ticketing.TicketingJobs;
import com.diasporum.backend.events.internal.infrastructure.stripe.StripeWebhookVerifier;
import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
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
 * Event ticketing on real migrated PostgreSQL (V31 schema + V38): oversell race,
 * free and paid checkout, signed webhook dedup, fee models → ledger, refunds →
 * ledger adjustments, payout eligibility and approve→complete, check-in
 * idempotency + offline sync, expiry worker, promo validation, payout account
 * encryption. The Stripe gateway is an in-memory fake; signatures are real HMAC.
 */
@SpringBootTest(properties = {
    "diasporum.events.ticketing.stripe.webhook-secret=" + TicketingIntegrationTest.WEBHOOK_SECRET,
    "diasporum.events.ticketing.payout-data-key=" + TicketingIntegrationTest.PAYOUT_KEY,
    "diasporum.events.ticketing.expiry-interval=PT24H"
})
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class TicketingIntegrationTest {

    static final String WEBHOOK_SECRET = "whsec_test_ticketing";
    static final String PAYOUT_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5").asCompatibleSubstituteFor("postgres"));

    @TestConfiguration
    static class FakeGatewayConfig {
        @Bean
        @Primary
        FakeTicketPaymentGateway fakeTicketPaymentGateway() {
            return new FakeTicketPaymentGateway();
        }
    }

    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired EventService events;
    @Autowired CommunityService communities;
    @Autowired EventTicketingSetupService setup;
    @Autowired TicketReservationService reservations;
    @Autowired TicketOrderService orders;
    @Autowired TicketRefundService refunds;
    @Autowired TicketCheckInService checkIns;
    @Autowired PayoutAccountService payoutAccounts;
    @Autowired OrganiserPayoutService payouts;
    @Autowired TicketingJobs jobs;
    @Autowired TicketPaymentGateway gateway;

    private FakeTicketPaymentGateway fake;
    private UUID dest, community, categoryId;
    private UUID organizer, buyer, buyer2, outsider, admin;
    private UUID eventId;

    @BeforeEach
    void setup() {
        fake = (FakeTicketPaymentGateway) gateway;
        fake.reset();
        jdbc.execute("TRUNCATE ticket_payment_events,ticket_check_ins,ticket_refunds,"
                + "ticket_organiser_ledger,ticket_organiser_payouts,issued_tickets,"
                + "ticket_order_status_history,ticket_order_items,ticket_orders,ticket_reservations,"
                + "event_ticket_promo_codes,event_ticket_types,event_organiser_payout_accounts,"
                + "ticket_fee_configurations,payout_account_field_requirements,notifications,"
                + "event_rsvps,events CASCADE");
        jdbc.update("DELETE FROM global_user_roles");
        for (String t : new String[]{"community_memberships", "external_identities", "profiles",
            "communities", "airports", "countries"}) {
            jdbc.update("DELETE FROM " + t);
        }
        jdbc.update("INSERT INTO countries(name,iso2,iso3) VALUES('Ethiopia','ET','ETH'),"
                + "('Germany','DE','DEU')");
        UUID origin = jdbc.queryForObject("SELECT id FROM countries WHERE iso2='ET'", UUID.class);
        dest = jdbc.queryForObject("SELECT id FROM countries WHERE iso2='DE'", UUID.class);
        jdbc.update("INSERT INTO communities(name,slug,origin_country_id,destination_country_id)"
                + " VALUES('ET in DE','et-in-de',?,?)", origin, dest);
        community = jdbc.queryForObject("SELECT id FROM communities", UUID.class);
        categoryId = jdbc.queryForObject("SELECT id FROM event_categories WHERE"
                + " category_key='WORKSHOP' AND country_id IS NULL", UUID.class);
        organizer = user("tk-organizer");
        buyer = user("tk-buyer");
        buyer2 = user("tk-buyer2");
        outsider = user("tk-outsider");
        admin = user("tk-admin");
        for (UUID u : new UUID[]{organizer, buyer, buyer2, outsider}) {
            jdbc.update("UPDATE profiles SET origin_country_id=?,current_country_id=? WHERE id=?",
                    origin, dest, u);
        }
        for (UUID u : new UUID[]{organizer, buyer, buyer2}) {
            communities.join(u, community);
        }
        jdbc.update("INSERT INTO global_user_roles(user_id,role_key,scope_type)"
                + " VALUES(?,'PLATFORM_ADMIN','GLOBAL')", admin);
        // Settlement rule for DE: 10% + €0.50 per ticket, buyer pays, €10 minimum, 3-day delay.
        jdbc.update("INSERT INTO ticket_fee_configurations(country_id,commission_rate_bps,"
                + "fixed_fee_minor,currency_code,fee_model,min_payout_amount,payout_delay_days)"
                + " VALUES(?,1000,50,'EUR','BUYER_PAYS',10.00,3)", dest);
        jdbc.update("INSERT INTO payout_account_field_requirements(country_id,payout_method,"
                + "required_fields,optional_fields,field_patterns) VALUES(?,'BANK_ACCOUNT',"
                + "ARRAY['iban'],ARRAY['swift_code'],'{\"iban\":\"^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$\"}')",
                dest);
        eventId = events.create(organizer, community, "COMMUNITY", categoryId, null, "Gala night",
                "Ticketed integration event", "IN_PERSON", inHours(72), inHours(76),
                "Europe/Berlin", "Hall", null, null, null, null, false).event().id();
        setup.updateSettings(organizer, eventId,
                new SettingsCommand(true, "EUR", null, "ORGANISER_DISCRETION", null));
    }

    // =================== helpers ===================

    private UUID user(String sub) {
        return IdentityTestSupport.provision(ctx, ISSUER, sub);
    }

    private static Instant inHours(long h) {
        return Instant.now().plus(h, ChronoUnit.HOURS).truncatedTo(ChronoUnit.MINUTES);
    }

    private RequestPostProcessor as(UUID userId) {
        return authentication(new UsernamePasswordAuthenticationToken(
                new DiasporumUserPrincipal(userId, UUID.randomUUID(), userId + "@example.org",
                        List.of()), null, List.of()));
    }

    private UUID ticketType(String price, int quantity) {
        return setup.createTicketType(organizer, eventId, new TicketTypeCommand("Type " + price,
                null, new BigDecimal(price), "EUR", quantity, 5, null, null, null, null)).id();
    }

    private OrderView buy(UUID who, UUID typeId, int qty, String promo) {
        var r = reservations.reserve(who, eventId, typeId, qty);
        return orders.create(who, r.id(), promo, UUID.randomUUID().toString());
    }

    private String webhook(String eventType, String objectId, boolean expectOk) throws Exception {
        String payload = "{\"id\":\"evt_" + UUID.randomUUID() + "\",\"type\":\"" + eventType
                + "\",\"data\":{\"object\":{\"id\":\"" + objectId + "\"}}}";
        return deliver(payload, expectOk);
    }

    private String deliver(String payload, boolean expectOk) throws Exception {
        String sig = StripeWebhookVerifier.signatureHeader(WEBHOOK_SECRET,
                Instant.now().getEpochSecond(), payload);
        var res = mvc.perform(post("/api/v1/webhooks/ticket-payments")
                .contentType(MediaType.APPLICATION_JSON).header("Stripe-Signature", sig)
                .content(payload));
        if (expectOk) {
            res.andExpect(status().isOk());
        }
        return res.andReturn().getResponse().getContentAsString();
    }

    private BigDecimal ledgerSum(String type, String column) {
        return jdbc.queryForObject("SELECT coalesce(sum(" + column + "),0) FROM ticket_organiser_ledger"
                + " WHERE event_id=? AND entry_type=?", BigDecimal.class, eventId, type);
    }

    private BigDecimal balance() {
        return jdbc.queryForObject("SELECT coalesce(sum(credit_amount-debit_amount),0)"
                + " FROM ticket_organiser_ledger WHERE event_id=?", BigDecimal.class, eventId);
    }

    private static void assertMoney(String expected, BigDecimal actual) {
        assertEquals(0, new BigDecimal(expected).compareTo(actual),
                "expected " + expected + " but was " + actual);
    }

    private static String code(Runnable r) {
        return assertThrows(ResponseStatusException.class, r::run).getReason();
    }

    private OrderView payViaWebhook(OrderView order) throws Exception {
        String pi = jdbc.queryForObject("SELECT payment_provider_id FROM ticket_orders WHERE id=?",
                String.class, order.id());
        fake.setStatus(pi, "succeeded");
        webhook("payment_intent.succeeded", pi, true);
        return orders.order(jdbc.queryForObject("SELECT buyer_user_id FROM ticket_orders WHERE id=?",
                UUID.class, order.id()), order.id());
    }

    // =================== inventory ===================

    @Test
    void concurrentReservesNeverOversellTheLastTicket() throws Exception {
        UUID type = ticketType("15.00", 1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Callable<String>> tasks = List.of(buyer, buyer2).stream()
                    .<Callable<String>>map(u -> () -> {
                        ready.countDown();
                        start.await();
                        try {
                            reservations.reserve(u, eventId, type, 1);
                            return "OK";
                        } catch (ResponseStatusException e) {
                            return e.getReason();
                        }
                    }).toList();
            List<Future<String>> futures = tasks.stream().map(pool::submit).toList();
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            start.countDown();
            List<String> results = futures.stream().map(f -> {
                try {
                    return f.get(10, TimeUnit.SECONDS);
                } catch (Exception e) {
                    throw new IllegalStateException(e);
                }
            }).sorted().toList();
            assertEquals(List.of("OK", "TICKETS_SOLD_OUT"), results);
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, jdbc.queryForObject("SELECT quantity_reserved FROM event_ticket_types"
                + " WHERE id=?", Integer.class, type));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM ticket_reservations"
                + " WHERE ticket_type_id=? AND status='ACTIVE'", Integer.class, type));
    }

    @Test
    void organiserSetupIsAuthorizedAndValidated() {
        assertEquals("NOT_EVENT_ORGANIZER", code(() -> setup.createTicketType(buyer, eventId,
                new TicketTypeCommand("X", null, BigDecimal.TEN, "EUR", 5, 2, null, null, null, null))));
        assertEquals("TICKET_CURRENCY_MISMATCH", code(() -> setup.createTicketType(organizer, eventId,
                new TicketTypeCommand("X", null, BigDecimal.TEN, "USD", 5, 2, null, null, null, null))));
        UUID type = ticketType("10.00", 3);
        assertEquals("MAX_PER_ORDER_EXCEEDED", code(() -> reservations.reserve(buyer, eventId, type, 6)));
        reservations.reserve(buyer, eventId, type, 2);
        assertEquals("TICKET_QUANTITY_BELOW_SOLD", code(() -> setup.updateTicketType(organizer,
                eventId, type, new TicketTypeCommand(null, null, null, null, 1, null, null, null,
                        null, null))));
        assertEquals("TICKET_CURRENCY_LOCKED", code(() -> setup.updateSettings(organizer, eventId,
                new SettingsCommand(true, "USD", null, null, null))));
        // outsider cannot even see the community event
        assertEquals("EVENT_NOT_FOUND", code(() -> reservations.reserve(outsider, eventId, type, 1)));
    }

    // =================== checkout ===================

    @Test
    void freeTicketsArePaidAndIssuedWithoutPayment() {
        UUID type = ticketType("0.00", 10);
        OrderView order = buy(buyer, type, 2, null);
        assertEquals("PAID", order.status());
        assertMoney("0", order.totalAmount());
        assertEquals(2, order.tickets().size());
        assertEquals(0, fake.createCalls.get());
        assertNull(order.paymentProvider());
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM ticket_organiser_ledger",
                Integer.class));
        assertEquals(2, jdbc.queryForObject("SELECT quantity_sold FROM event_ticket_types WHERE id=?",
                Integer.class, type));
        assertEquals(0, jdbc.queryForObject("SELECT quantity_reserved FROM event_ticket_types"
                + " WHERE id=?", Integer.class, type));
        assertEquals("CONFIRMED", jdbc.queryForObject("SELECT status FROM ticket_reservations"
                + " WHERE confirmed_order_id=?", String.class, order.id()));
        order.tickets().forEach(t -> {
            assertTrue(t.ticketCode().startsWith("TK-"));
            assertTrue(t.qrPayload().length() >= 43);
            assertEquals("VALID", t.status());
        });
        assertEquals(2, orders.myTickets(buyer, eventId, "VALID").size());
    }

    @Test
    void orderCreationIsIdempotentPerBuyerKey() {
        UUID type = ticketType("0.00", 10);
        var r = reservations.reserve(buyer, eventId, type, 1);
        OrderView first = orders.create(buyer, r.id(), null, "key-1");
        OrderView again = orders.create(buyer, r.id(), null, "key-1");
        assertEquals(first.id(), again.id());
        var r2 = reservations.reserve(buyer, eventId, ticketType("0.00", 5), 1);
        assertEquals("IDEMPOTENCY_KEY_REUSED", code(() -> orders.create(buyer, r2.id(), null, "key-1")));
        // the same raw key from another buyer is a different namespace
        var r3 = reservations.reserve(buyer2, eventId, type, 1);
        assertTrue(!orders.create(buyer2, r3.id(), null, "key-1").id().equals(first.id()));
    }

    @Test
    void paidCheckoutConfirmedBySignedWebhookUnderEachFeeModel() throws Exception {
        UUID type = ticketType("20.00", 50);

        // BUYER_PAYS: fee 10% of 20 + 0.50 = 2.50 per ticket, charged to the buyer.
        OrderView order = buy(buyer, type, 2, null);
        assertEquals("PAYMENT_PENDING", order.status());
        assertNotNull(order.clientSecret());
        assertMoney("40.00", order.subtotalAmount());
        assertMoney("5.00", order.platformFeeAmount());
        assertMoney("45.00", order.totalAmount());
        String pi = jdbc.queryForObject("SELECT payment_provider_id FROM ticket_orders WHERE id=?",
                String.class, order.id());
        assertEquals(4500, fake.retrieve(pi).amountMinor());
        fake.setStatus(pi, "succeeded");
        String payload = "{\"id\":\"evt_paid_1\",\"type\":\"payment_intent.succeeded\","
                + "\"data\":{\"object\":{\"id\":\"" + pi + "\",\"amount\":1}}}";
        assertTrue(deliver(payload, true).contains("PROCESSED"));
        OrderView paid = orders.order(buyer, order.id());
        assertEquals("PAID", paid.status());
        assertEquals(2, paid.tickets().size());
        assertMoney("40.00", ledgerSum("TICKET_SALE", "credit_amount"));
        assertMoney("0", ledgerSum("PLATFORM_FEE", "debit_amount"));
        assertEquals("20.00", jdbc.queryForObject("SELECT unit_price::text FROM ticket_order_items"
                + " WHERE order_id=?", String.class, order.id()));

        // duplicate delivery: IGNORED, nothing posted twice
        assertTrue(deliver(payload, true).contains("IGNORED"));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM ticket_payment_events",
                Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM ticket_organiser_ledger"
                + " WHERE entry_type='TICKET_SALE'", Integer.class));
        assertTrue(jdbc.queryForObject("SELECT signature_verified FROM ticket_payment_events",
                Boolean.class));

        // ORGANISER_ABSORBS: buyer pays 40, organiser is debited the 5.00 fee.
        setup.updateSettings(organizer, eventId,
                new SettingsCommand(true, "EUR", "ORGANISER_ABSORBS", null, null));
        OrderView absorbed = buy(buyer2, type, 2, null);
        assertMoney("40.00", absorbed.totalAmount());
        assertMoney("0", absorbed.platformFeeAmount());
        assertEquals("ORGANISER_ABSORBS", absorbed.feePaidBy());
        payViaWebhook(absorbed);
        assertMoney("5.00", ledgerSum("PLATFORM_FEE", "debit_amount"));

        // SPLIT 50/50: 1.25 each per ticket.
        jdbc.update("UPDATE ticket_fee_configurations SET fee_model='SPLIT',organiser_split_bps=5000");
        setup.updateSettings(organizer, eventId, new SettingsCommand(true, "EUR", "SPLIT", null, null));
        OrderView split = buy(buyer, type, 2, null);
        assertMoney("42.50", split.totalAmount());
        assertMoney("2.50", split.platformFeeAmount());
        payViaWebhook(split);
        assertMoney("7.50", ledgerSum("PLATFORM_FEE", "debit_amount"));
        assertMoney("120.00", ledgerSum("TICKET_SALE", "credit_amount"));
        assertMoney("112.50", balance());
    }

    @Test
    void webhookRejectsBadSignaturesAndPersistsNothing() throws Exception {
        String payload = "{\"id\":\"evt_forged\",\"type\":\"payment_intent.succeeded\","
                + "\"data\":{\"object\":{\"id\":\"pi_x\"}}}";
        mvc.perform(post("/api/v1/webhooks/ticket-payments").contentType(MediaType.APPLICATION_JSON)
                .header("Stripe-Signature", "t=" + Instant.now().getEpochSecond() + ",v1=deadbeef")
                .content(payload)).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("WEBHOOK_SIGNATURE_INVALID"));
        // valid signature for a different body (tampered payload)
        String sig = StripeWebhookVerifier.signatureHeader(WEBHOOK_SECRET,
                Instant.now().getEpochSecond(), payload);
        mvc.perform(post("/api/v1/webhooks/ticket-payments").contentType(MediaType.APPLICATION_JSON)
                .header("Stripe-Signature", sig).content(payload.replace("pi_x", "pi_y")))
                .andExpect(status().isBadRequest());
        // missing header, and a stale timestamp outside the tolerance
        mvc.perform(post("/api/v1/webhooks/ticket-payments").contentType(MediaType.APPLICATION_JSON)
                .content(payload)).andExpect(status().isBadRequest());
        String stale = StripeWebhookVerifier.signatureHeader(WEBHOOK_SECRET,
                Instant.now().minusSeconds(3600).getEpochSecond(), payload);
        mvc.perform(post("/api/v1/webhooks/ticket-payments").contentType(MediaType.APPLICATION_JSON)
                .header("Stripe-Signature", stale).content(payload)).andExpect(status().isBadRequest());
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM ticket_payment_events",
                Integer.class));
        // a verified but unknown event type is stored and IGNORED
        assertTrue(webhook("customer.created", "cus_1", true).contains("IGNORED"));
        assertEquals("IGNORED", jdbc.queryForObject("SELECT status FROM ticket_payment_events",
                String.class));
    }

    @Test
    void promoCodesAreValidatedAtOrderTime() {
        UUID vip = ticketType("40.00", 20);
        UUID general = ticketType("10.00", 20);
        setup.createPromoCode(organizer, eventId, new PromoCodeCommand("vip50", "PERCENTAGE",
                new BigDecimal("50"), 2, 1, List.of(vip), null, null, null));
        setup.createPromoCode(organizer, eventId, new PromoCodeCommand("LATE", "FIXED_AMOUNT",
                new BigDecimal("5"), null, null, null, Instant.now().minusSeconds(7200),
                Instant.now().minusSeconds(3600), null));

        assertEquals("PROMO_CODE_NOT_APPLICABLE", code(() -> buy(buyer, general, 1, "VIP50")));
        assertEquals("PROMO_CODE_INVALID", code(() -> buy(buyer, vip, 1, "LATE")));
        assertEquals("PROMO_CODE_INVALID", code(() -> buy(buyer, vip, 1, "NOPE")));

        OrderView discounted = buy(buyer, vip, 2, "vip50");
        assertMoney("80.00", discounted.subtotalAmount());
        assertMoney("40.00", discounted.discountAmount());
        // fee on the discounted price: 10% of 20 + 0.50 = 2.50 per ticket
        assertMoney("45.00", discounted.totalAmount());
        assertEquals("PROMO_USER_LIMIT_REACHED", code(() -> buy(buyer, vip, 1, "VIP50")));
        buy(buyer2, vip, 1, "VIP50");
        UUID third = user("tk-third");
        jdbc.update("UPDATE profiles SET current_country_id=? WHERE id=?", dest, third);
        communities.join(third, community);
        assertEquals("PROMO_CODE_EXHAUSTED", code(() -> buy(third, vip, 1, "VIP50")));
        assertEquals(2, jdbc.queryForObject("SELECT used_count FROM event_ticket_promo_codes"
                + " WHERE code='VIP50'", Integer.class));
    }

    // =================== refunds ===================

    @Test
    void refundsAppendLedgerAdjustmentsAndNeverMutateRows() throws Exception {
        setup.updateSettings(organizer, eventId,
                new SettingsCommand(true, "EUR", "ORGANISER_ABSORBS", null, null));
        UUID type = ticketType("20.00", 10);
        OrderView order = payViaWebhook(buy(buyer, type, 2, null));
        assertEquals("PAID", order.status());
        assertMoney("35.00", balance()); // 40 sale − 5 organiser-borne fee

        UUID first = order.tickets().get(0).id();
        UUID second = order.tickets().get(1).id();
        var requested = refunds.requestByBuyer(buyer, order.id(), List.of(first), "Can't attend");
        assertEquals("PENDING", requested.get(0).status());
        assertMoney("20.00", requested.get(0).refundAmount()); // booking fee not returned to buyer
        assertEquals("REFUND_REQUESTED", orders.order(buyer, order.id()).status());
        assertEquals("NOT_EVENT_FINANCE_MANAGER",
                code(() -> refunds.approve(buyer2, requested.get(0).id())));
        assertEquals("REFUND_ALREADY_REQUESTED",
                code(() -> refunds.requestByBuyer(buyer, order.id(), List.of(first), "again")));

        var processed = refunds.approve(organizer, requested.get(0).id());
        assertEquals("PROCESSED", processed.status());
        assertNotNull(processed.providerRefundId());
        assertMoney("20.00", ledgerSum("REFUND_DEDUCTION", "debit_amount"));
        assertMoney("2.50", ledgerSum("FEE_REFUND", "credit_amount"));
        assertMoney("17.50", balance());
        assertEquals("REFUNDED", jdbc.queryForObject("SELECT status FROM issued_tickets WHERE id=?",
                String.class, first));
        assertEquals("PARTIALLY_REFUNDED", orders.order(buyer, order.id()).status());
        assertEquals(1, jdbc.queryForObject("SELECT quantity_sold FROM event_ticket_types WHERE id=?",
                Integer.class, type));

        // organiser-initiated refund that settles asynchronously via refund.updated webhook
        fake.nextRefundStatus = "PENDING";
        var pending = refunds.createByOrganiser(organizer, eventId, order.id(), List.of(second),
                "ORGANISER_INITIATED", "Venue change");
        assertEquals("PROCESSING", pending.get(0).status());
        fake.setRefundStatus(pending.get(0).providerRefundId(), "SUCCEEDED");
        webhook("refund.updated", pending.get(0).providerRefundId(), true);
        assertEquals("PROCESSED", refunds.view(pending.get(0).id()).status());
        webhook("refund.updated", pending.get(0).providerRefundId(), true); // replay: no double post
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM ticket_organiser_ledger"
                + " WHERE entry_type='REFUND_DEDUCTION'", Integer.class));
        assertEquals("REFUNDED", orders.order(buyer, order.id()).status());
        assertMoney("0", balance());

        // the ledger is append-only at the database level
        assertThrows(Exception.class, () -> jdbc.update(
                "UPDATE ticket_organiser_ledger SET credit_amount=credit_amount+1"));
        assertThrows(Exception.class, () -> jdbc.update("DELETE FROM ticket_organiser_ledger"));
    }

    @Test
    void refundPolicyIsEnforcedForBuyers() throws Exception {
        UUID type = ticketType("20.00", 10);
        OrderView order = payViaWebhook(buy(buyer, type, 1, null));
        setup.updateSettings(organizer, eventId, new SettingsCommand(true, "EUR", null,
                "NO_REFUNDS", null));
        assertEquals("REFUND_NOT_ALLOWED",
                code(() -> refunds.requestByBuyer(buyer, order.id(), null, "please")));
        setup.updateSettings(organizer, eventId, new SettingsCommand(true, "EUR", null,
                "REFUND_UNTIL_CUTOFF", 96));
        assertEquals("REFUND_WINDOW_CLOSED",
                code(() -> refunds.requestByBuyer(buyer, order.id(), null, "please")));
        // admin override bypasses the policy and also returns the buyer's booking fee
        var r = refunds.createByAdmin(admin, order.id(), null, "Goodwill");
        assertEquals("PROCESSED", r.get(0).status());
        assertMoney("22.50", r.get(0).refundAmount());
        assertMoney("2.50", r.get(0).platformFeeRefund());
        assertEquals("PLATFORM_ADMIN_REQUIRED",
                code(() -> refunds.createByAdmin(organizer, order.id(), null, "x")));
    }

    // =================== payouts ===================

    @Test
    void payoutEligibilityAndManualLifecycle() throws Exception {
        UUID type = ticketType("20.00", 10);
        payViaWebhook(buy(buyer, type, 2, null)); // BUYER_PAYS → ledger +40.00
        var account = payoutAccounts.create(organizer, new AccountCommand(null, "BANK_ACCOUNT",
                dest, "EUR", "Gala Org", null, "DE89370400440532013000", null,
                Map.of("swift_code", "COBADEFFXXX"), null, null, null, true));

        // event not over yet
        assertEquals("PAYOUT_NOT_YET_ELIGIBLE",
                code(() -> payouts.request(organizer, eventId, account.id(), "p-1")));
        // ended 2 days ago with a 3-day delay: still held
        moveEventEnd(2);
        assertEquals("PAYOUT_NOT_YET_ELIGIBLE",
                code(() -> payouts.request(organizer, eventId, account.id(), "p-1")));
        moveEventEnd(4);
        jdbc.update("UPDATE ticket_fee_configurations SET min_payout_amount=100");
        assertEquals("PAYOUT_BELOW_MINIMUM",
                code(() -> payouts.request(organizer, eventId, account.id(), "p-1")));
        jdbc.update("UPDATE ticket_fee_configurations SET min_payout_amount=10");
        assertEquals("NOT_EVENT_FINANCE_MANAGER",
                code(() -> payouts.request(buyer, eventId, account.id(), "p-x")));

        // two concurrent requests for the same balance: exactly one payout
        ExecutorService pool = Executors.newFixedThreadPool(2);
        List<String> results;
        try {
            List<Future<String>> fs = List.of("p-a", "p-b").stream().map(k -> pool.submit(() -> {
                try {
                    return payouts.request(organizer, eventId, account.id(), k).status();
                } catch (ResponseStatusException e) {
                    return e.getReason();
                }
            })).toList();
            results = fs.stream().map(f -> {
                try {
                    return f.get(15, TimeUnit.SECONDS);
                } catch (Exception e) {
                    throw new IllegalStateException(e);
                }
            }).sorted().toList();
        } finally {
            pool.shutdownNow();
        }
        assertEquals(List.of("PAYOUT_BELOW_MINIMUM", "PENDING"), results);
        var payout = payouts.eventPayouts(organizer, eventId).get(0);
        assertMoney("40.00", payout.netPayoutAmount());
        assertMoney("40.00", payout.grossRevenue());
        assertEquals("MANUAL", payout.disbursementMethod());
        assertEquals(organizer, payout.requestedByUserId());
        var summary = payouts.summary(organizer, eventId);
        assertMoney("40.00", summary.payout().ledgerBalance());
        assertMoney("40.00", summary.payout().pendingPayouts());
        assertMoney("0", summary.payout().availableBalance());
        // idempotent replay returns the same payout
        String winningKey = jdbc.queryForObject("SELECT idempotency_key FROM ticket_organiser_payouts",
                String.class).split(":", 2)[1];
        assertEquals(payout.id(), payouts.request(organizer, eventId, account.id(), winningKey).id());

        // admin lifecycle; the DB CHECK rejects completion without approval
        assertEquals("PLATFORM_ADMIN_REQUIRED", code(() -> payouts.approve(organizer, payout.id())));
        assertEquals("PAYOUT_STATE_INVALID",
                code(() -> payouts.complete(admin, payout.id(), "TRX-1")));
        assertEquals("PAYOUT_ACCOUNT_NOT_VERIFIED", code(() -> payouts.approve(admin, payout.id())));
        payoutAccounts.adminVerify(admin, account.id(), true, "IBAN checked");
        var approved = payouts.approve(admin, payout.id());
        assertEquals("PROCESSING", approved.status());
        assertEquals(admin, approved.approvedByUserId());
        assertNotNull(approved.approvedAt());
        var done = payouts.complete(admin, payout.id(), "SEPA-REF-123");
        assertEquals("COMPLETED", done.status());
        assertEquals("SEPA-REF-123", done.transferReference());
        assertEquals(admin, done.transferredByUserId());
        assertNotNull(done.completedAt());
        assertMoney("40.00", ledgerSum("PAYOUT", "debit_amount"));
        assertMoney("0", balance());
        assertEquals("PAYOUT_STATE_INVALID", code(() -> payouts.complete(admin, payout.id(), "again")));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM ticket_organiser_ledger"
                + " WHERE entry_type='PAYOUT'", Integer.class));
        assertEquals("PAYOUT_BELOW_MINIMUM",
                code(() -> payouts.request(organizer, eventId, account.id(), "p-2")));
    }

    private void moveEventEnd(int daysAgo) {
        jdbc.update("UPDATE events SET starts_at=now()-make_interval(days=>?)-interval '4 hours',"
                + "ends_at=now()-make_interval(days=>?) WHERE id=?", daysAgo, daysAgo, eventId);
    }

    @Test
    void payoutAccountsAreValidatedEncryptedAndMasked() {
        assertEquals("PAYOUT_ACCOUNT_FIELDS_INVALID", code(() -> payoutAccounts.create(organizer,
                new AccountCommand(null, "BANK_ACCOUNT", dest, "EUR", "Org", null, null, "12345678",
                        null, null, null, null, false))));
        assertEquals("PAYOUT_ACCOUNT_FIELDS_INVALID", code(() -> payoutAccounts.create(organizer,
                new AccountCommand(null, "BANK_ACCOUNT", dest, "EUR", "Org", null, "not-an-iban",
                        null, null, null, null, null, false))));
        assertEquals("PAYOUT_METHOD_NOT_SUPPORTED_IN_COUNTRY", code(() -> payoutAccounts.create(
                organizer, new AccountCommand(null, "MOBILE_MONEY", dest, "EUR", "Org", null, null,
                        null, null, "M-Pesa", "+254700000000", null, false))));
        var created = payoutAccounts.create(organizer, new AccountCommand(null, "BANK_ACCOUNT", dest,
                "EUR", "Org", null, "DE89370400440532013000", null, Map.of("swift_code", "COBADEFFXXX"),
                null, null, null, true));
        assertEquals("****3000", created.iban());
        assertEquals("****FXXX", created.bankDetails().get("swift_code"));
        assertTrue(created.masked());
        String stored = jdbc.queryForObject("SELECT iban FROM event_organiser_payout_accounts"
                + " WHERE id=?", String.class, created.id());
        assertTrue(stored.startsWith("v1:"));
        assertFalse(stored.contains("3000"));
        String details = jdbc.queryForObject("SELECT bank_details::text FROM"
                + " event_organiser_payout_accounts WHERE id=?", String.class, created.id());
        assertFalse(details.contains("COBADEFF"));
        assertEquals("DE89370400440532013000", payoutAccounts.adminView(admin, created.id()).iban());
        assertEquals("PLATFORM_ADMIN_REQUIRED",
                code(() -> payoutAccounts.adminView(organizer, created.id())));
        assertEquals("PAYOUT_ACCOUNT_NOT_FOUND", code(() -> payoutAccounts.update(buyer, created.id(),
                new AccountCommand(null, "OTHER", dest, "EUR", "x", null, null, null, null, null,
                        null, Map.of("k", "v"), false))));
    }

    // =================== check-in ===================

    @Test
    void checkInIsIdempotentAndEveryScanIsLogged() {
        UUID type = ticketType("0.00", 10);
        OrderView order = buy(buyer, type, 3, null);
        var t1 = order.tickets().get(0);
        var r1 = checkIns.checkIn(organizer, new Scan(t1.qrPayload(), null, eventId, "door-1",
                null, null, null, null));
        assertEquals("VALID", r1.scanResult());
        var again = checkIns.checkIn(organizer, new Scan(null, t1.ticketCode(), eventId, "door-2",
                null, null, null, null));
        assertEquals("ALREADY_CHECKED_IN", again.scanResult());
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM ticket_check_ins"
                + " WHERE issued_ticket_id=?", Integer.class, t1.id()));
        assertEquals("NOT_EVENT_ORGANIZER", code(() -> checkIns.checkIn(buyer,
                new Scan(order.tickets().get(1).qrPayload(), null, null, null, null, null, null, null))));
        var unknown = checkIns.checkIn(organizer, new Scan("not-a-real-payload-xxxxxxxx", null,
                eventId, null, null, null, null, null));
        assertEquals("INVALID", unknown.scanResult());
        assertFalse(unknown.logged());

        // offline batch arrives out of order: the earliest device scan wins
        var t2 = order.tickets().get(1);
        Instant early = Instant.now().minusSeconds(600).truncatedTo(ChronoUnit.SECONDS);
        Instant late = early.plusSeconds(120);
        var synced = checkIns.syncOffline(organizer, List.of(
                new Scan(t2.qrPayload(), null, eventId, "door-3", null, null, late, null),
                new Scan(t2.qrPayload(), null, eventId, "door-4", null, null, early, null)));
        assertEquals(List.of("VALID", "ALREADY_CHECKED_IN"),
                synced.stream().map(s -> s.scanResult()).toList());
        assertEquals(early, synced.get(0).checkedInAt());
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM ticket_check_ins WHERE"
                + " issued_ticket_id=? AND is_offline_scan AND synced_at IS NOT NULL", Integer.class,
                t2.id()));
    }

    @Test
    void checkInHttpReturnsLoggedResultNotError() throws Exception {
        UUID type = ticketType("0.00", 5);
        var ticket = buy(buyer, type, 1, null).tickets().get(0);
        String body = "{\"qrPayload\":\"" + ticket.qrPayload() + "\"}";
        mvc.perform(post("/api/v1/tickets/check-in").with(as(organizer))
                .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk()).andExpect(jsonPath("$.scanResult").value("VALID"));
        mvc.perform(post("/api/v1/tickets/check-in").with(as(organizer))
                .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scanResult").value("ALREADY_CHECKED_IN"));
    }

    // =================== expiry worker ===================

    @Test
    void expiryWorkerReleasesHoldsExpiresOrdersAndReconcilesPayments() {
        UUID type = ticketType("20.00", 10);
        // 1. abandoned reservation
        var hold = reservations.reserve(buyer2, eventId, type, 3);
        jdbc.update("UPDATE ticket_reservations SET created_at=now()-interval '1 hour',"
                + "expires_at=now()-interval '1 minute' WHERE id=?", hold.id());
        // 2. unpaid order past its window (intent never paid) with a promo use
        setup.createPromoCode(organizer, eventId, new PromoCodeCommand("TEN", "PERCENTAGE",
                BigDecimal.TEN, 5, null, null, null, null, null));
        OrderView unpaid = buy(buyer, type, 2, "TEN");
        // 3. order whose payment succeeded but whose webhook never arrived
        OrderView missedWebhook = buy(buyer, ticketType("5.00", 5), 1, null);
        String paidPi = jdbc.queryForObject("SELECT payment_provider_id FROM ticket_orders WHERE id=?",
                String.class, missedWebhook.id());
        fake.setStatus(paidPi, "succeeded");
        for (UUID id : List.of(unpaid.id(), missedWebhook.id())) {
            jdbc.update("UPDATE ticket_orders SET expires_at=now()-interval '1 minute' WHERE id=?", id);
            jdbc.update("UPDATE ticket_reservations SET created_at=now()-interval '1 hour',"
                    + "expires_at=now()-interval '1 minute' WHERE id=(SELECT reservation_id"
                    + " FROM ticket_orders WHERE id=?)", id);
        }
        assertEquals(5, jdbc.queryForObject("SELECT quantity_reserved FROM event_ticket_types"
                + " WHERE id=?", Integer.class, type));

        var run = jobs.run();
        assertEquals(1, run.reservationsReleased());
        assertEquals(1, run.ordersExpired());
        assertEquals(1, run.ordersConfirmed());
        assertEquals("RELEASED", jdbc.queryForObject("SELECT status FROM ticket_reservations"
                + " WHERE id=?", String.class, hold.id()));
        assertEquals("EXPIRED", orders.order(buyer, unpaid.id()).status());
        String unpaidPi = jdbc.queryForObject("SELECT payment_provider_id FROM ticket_orders"
                + " WHERE id=?", String.class, unpaid.id());
        assertEquals("canceled", fake.retrieve(unpaidPi).status());
        assertEquals("PAID", orders.order(buyer, missedWebhook.id()).status());
        assertEquals(0, jdbc.queryForObject("SELECT quantity_reserved FROM event_ticket_types"
                + " WHERE id=?", Integer.class, type));
        assertEquals(0, jdbc.queryForObject("SELECT used_count FROM event_ticket_promo_codes"
                + " WHERE code='TEN'", Integer.class));

        // idempotent re-run
        var second = jobs.run();
        assertEquals(0, second.reservationsReleased() + second.ordersExpired() + second.ordersConfirmed());
        assertEquals(0, jdbc.queryForObject("SELECT quantity_reserved FROM event_ticket_types"
                + " WHERE id=?", Integer.class, type));

        // a payment landing after expiry is refunded, never fulfilled
        fake.setStatus(unpaidPi, "succeeded");
        assertEquals("LATE_PAYMENT_REFUND_QUEUED", lateWebhookOutcome(unpaidPi));
        assertEquals("EXPIRED", orders.order(buyer, unpaid.id()).status());
        jdbc.update("UPDATE ticket_refunds SET approved_at=now()-interval '5 minutes'");
        jobs.run();
        assertEquals("PROCESSED", jdbc.queryForObject("SELECT status FROM ticket_refunds"
                + " WHERE order_id=?", String.class, unpaid.id()));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM issued_tickets t JOIN"
                + " ticket_order_items i ON i.id=t.order_item_id WHERE i.order_id=?", Integer.class,
                unpaid.id()));
    }

    private String lateWebhookOutcome(String pi) {
        try {
            webhook("payment_intent.succeeded", pi, true);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        return jdbc.queryForObject("SELECT error_detail FROM ticket_payment_events"
                + " ORDER BY received_at DESC LIMIT 1", String.class);
    }
}
