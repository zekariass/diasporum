package com.diasporum.backend.billing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.diasporum.backend.billing.internal.application.BillingCheckoutService;
import com.diasporum.backend.billing.internal.application.BillingCheckoutService.CheckoutRequest;
import com.diasporum.backend.billing.internal.application.BillingCountryAdminService;
import com.diasporum.backend.billing.internal.application.BillingSubscriptionJobs;
import com.diasporum.backend.billing.internal.application.BillingSubscriptionService;
import com.diasporum.backend.identity.IdentityTestSupport;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * Country-based billing on real migrated PostgreSQL.
 *
 * <p>Covers the behaviours the architecture exists to guarantee: identical
 * entitlements whichever channel paid, capability-driven gating, prepaid term
 * arithmetic, and that a prepaid subscription is never auto-converted when its
 * country gains recurring support.
 *
 * <p>The seeded example countries from V36 are absent here: Flyway runs against
 * an empty database, so {@code countries} is populated later by the taxonomy
 * seeder. Each test therefore configures its own country policy through the
 * admin service, which exercises that path too.
 */
@SpringBootTest
@Testcontainers
class CountryBillingIntegrationTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired BillingCheckoutService checkout;
    @Autowired BillingCountryAdminService admin;
    @Autowired BillingSubscriptionService subscriptions;
    @Autowired BillingSubscriptionJobs jobs;
    @Autowired BillingApi billing;
    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;

    private UUID buyer;
    private UUID adminUser;
    private UUID ethiopia;
    private UUID britain;

    @BeforeEach
    void setup() {
        jdbc.update("DELETE FROM billing_payment_proofs");
        jdbc.update("DELETE FROM billing_payments");
        jdbc.update("DELETE FROM billing_orders");
        jdbc.update("DELETE FROM billing_subscriptions");
        jdbc.update("DELETE FROM billing_audit_events");
        jdbc.update("DELETE FROM notifications");
        jdbc.update("DELETE FROM billing_plan_prices WHERE billing_interval<>'NONE'");
        jdbc.update("DELETE FROM payment_provider_country_capabilities");
        jdbc.update("DELETE FROM country_billing_settings");
        jdbc.update("DELETE FROM global_user_roles");

        ethiopia = country("Ethiopia", "ET", "ETH");
        britain = country("United Kingdom of Testland", "GB", "GBR");

        buyer = IdentityTestSupport.provision(ctx, ISSUER, "billing-buyer");
        adminUser = IdentityTestSupport.provision(ctx, ISSUER, "billing-admin");
        jdbc.update("UPDATE profiles SET current_country_id=?,origin_country_id=? WHERE id=?",
                ethiopia, ethiopia, buyer);
        jdbc.update("INSERT INTO global_user_roles(user_id,role_key,scope_type)"
                + " VALUES(?,'PLATFORM_ADMIN','GLOBAL')", adminUser);

        // BANK_TRANSFER is the one provider with an adapter; give it the
        // account details it needs for Ethiopia.
        admin.updateProvider(adminUser, "BANK_TRANSFER", true,
                "{\"accounts\":{\"ET\":{\"bankName\":\"Test Bank\","
                        + "\"accountNumber\":\"1000123456\",\"instructions\":\"Transfer and keep the receipt.\"}}}");
    }

    private UUID country(String name, String iso2, String iso3) {
        var existing = jdbc.queryForList("SELECT id FROM countries WHERE iso2=?",
                UUID.class, iso2);
        if (!existing.isEmpty()) {
            jdbc.update("UPDATE countries SET is_active=true WHERE id=?", existing.get(0));
            return existing.get(0);
        }
        jdbc.update("INSERT INTO countries(name,iso2,iso3) VALUES(?,?,?)", name, iso2, iso3);
        return jdbc.queryForObject("SELECT id FROM countries WHERE iso2=?", UUID.class, iso2);
    }

    /** Ethiopia: prepaid-only, bank transfer with manual verification. */
    private void configureEthiopiaPrepaid() {
        admin.upsertCountrySettings(adminUser, ethiopia, true, true, "ETB", List.of("ETB"),
                false, true, true, true, null);
        admin.upsertCapability(adminUser, "BANK_TRANSFER", ethiopia, true, true, false, false,
                true, List.of("ETB"), List.of("BANK_TRANSFER"), null);
    }

    private UUID silverPrepaidPrice(UUID countryId, String currency, String interval,
            int count, String amount) {
        return admin.addPriceOption(adminUser, "SILVER", countryId, currency,
                new BigDecimal(amount), interval, count, "PREPAID");
    }

    private CheckoutRequest prepaidRequest(UUID priceId, String idempotencyKey) {
        return new CheckoutRequest(null, null, priceId, "PREPAID", null, null, null,
                "BANK_TRANSFER", "BANK_TRANSFER", idempotencyKey);
    }

    /** Runs the full manual flow: checkout, submit proof, admin verifies. */
    private BillingCheckoutService.CheckoutResult payManually(UUID priceId, String key) {
        var result = checkout.checkout(buyer, prepaidRequest(priceId, key));
        UUID proofId = checkout.submitPaymentProof(buyer, result.paymentId(), "TXN-" + key,
                null, null);
        admin.verifyPaymentProof(adminUser, proofId);
        return result;
    }

    private Instant periodEnd(UUID subscriptionId) {
        return jdbc.queryForObject("SELECT current_period_end FROM billing_subscriptions"
                + " WHERE id=?", java.sql.Timestamp.class, subscriptionId).toInstant();
    }

    @Test
    void optionsReflectCountryPolicyCapabilityAndImplementedAdapters() {
        configureEthiopiaPrepaid();
        silverPrepaidPrice(ethiopia, "ETB", "MONTH", 3, "900.00");

        var options = checkout.options(buyer, null);
        assertEquals("ETB", options.defaultCurrency());
        assertFalse(options.recurringBillingEnabled());
        assertEquals(1, options.options().size());
        var option = options.options().get(0);
        assertEquals("SILVER", option.planKey());
        assertEquals("PREPAID", option.billingArrangement());
        assertEquals("BANK_TRANSFER", option.providerKey());
        assertTrue(option.requiresManualVerification());
        assertEquals(3, option.intervalCount());

        // A capability row for a provider with no adapter is configuration
        // only and must not be offered as purchasable.
        admin.upsertCapability(adminUser, "TELEBIRR", ethiopia, true, true, false, false,
                true, List.of("ETB"), List.of("MOBILE_MONEY"), null);
        admin.updateProvider(adminUser, "TELEBIRR", true, null);
        assertEquals(1, checkout.options(buyer, null).options().size());
    }

    @Test
    void prepaidActivationSetsPeriodFromPurchasedTerm() {
        configureEthiopiaPrepaid();
        UUID priceId = silverPrepaidPrice(ethiopia, "ETB", "MONTH", 3, "900.00");

        var result = checkout.checkout(buyer, prepaidRequest(priceId, "checkout-1"));
        assertEquals("PENDING", result.status());
        assertEquals("Test Bank", result.details().get("bankName"));
        // Nothing is granted before the money is confirmed.
        assertEquals("INCOMPLETE", jdbc.queryForObject("SELECT status FROM billing_subscriptions"
                + " WHERE id=?", String.class, result.subscriptionId()));

        UUID proofId = checkout.submitPaymentProof(buyer, result.paymentId(), "TXN-123",
                null, "Paid at branch");
        admin.verifyPaymentProof(adminUser, proofId);

        var subscription = subscriptions.currentSubscription(buyer).orElseThrow();
        assertEquals("ACTIVE", subscription.status());
        assertEquals("PREPAID", subscription.billingArrangement());
        assertEquals("SILVER", subscription.planKey());
        assertEquals(ethiopia, subscription.countryId());
        assertEquals("ETB", subscription.currencyCode());
        assertNotNull(subscription.sourceOrderId());
        long days = ChronoUnit.DAYS.between(subscription.currentPeriodStart(),
                subscription.currentPeriodEnd());
        assertTrue(days >= 89 && days <= 93, "3 months, got " + days + " days");
        assertEquals("PAID", jdbc.queryForObject("SELECT status FROM billing_orders WHERE id=?",
                String.class, result.orderId()));
        assertEquals("SUCCEEDED", jdbc.queryForObject("SELECT status FROM billing_payments"
                + " WHERE id=?", String.class, result.paymentId()));
    }

    @Test
    void prepaidRenewalExtendsFromTheLaterOfPeriodEndAndNow() {
        configureEthiopiaPrepaid();
        UUID priceId = silverPrepaidPrice(ethiopia, "ETB", "MONTH", 1, "400.00");
        var first = payManually(priceId, "renew-first");
        UUID subscriptionId = first.subscriptionId();
        Instant firstEnd = periodEnd(subscriptionId);

        // Renewing early adds a term to the time remaining, on the same row.
        var renewal = checkout.renew(buyer, prepaidRequest(null, "renew-second"));
        assertEquals(subscriptionId, renewal.subscriptionId());
        UUID proofId = checkout.submitPaymentProof(buyer, renewal.paymentId(), "TXN-RENEW",
                null, null);
        admin.verifyPaymentProof(adminUser, proofId);

        Instant secondEnd = periodEnd(subscriptionId);
        long added = ChronoUnit.DAYS.between(firstEnd, secondEnd);
        assertTrue(added >= 28 && added <= 31, "a further month, got " + added + " days");
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM billing_subscriptions"
                + " WHERE user_id=?", Integer.class, buyer),
                "renewal must extend the same subscription row");
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM billing_orders"
                + " WHERE subscription_id=? AND status='PAID'", Integer.class, subscriptionId),
                "orders are the term history");

        // Renewing after a lapse starts the new term from now, not from the past.
        // current_period_start moves too: the baseline CHECK keeps the period ordered.
        jdbc.update("UPDATE billing_subscriptions SET current_period_start=now()"
                + "-interval '40 days',current_period_end=now()-interval '10 days'"
                + " WHERE id=?", subscriptionId);
        var late = checkout.renew(buyer, prepaidRequest(null, "renew-late"));
        admin.verifyPaymentProof(adminUser, checkout.submitPaymentProof(buyer,
                late.paymentId(), "TXN-LATE", null, null));
        Instant lateEnd = periodEnd(subscriptionId);
        assertTrue(lateEnd.isAfter(Instant.now().plus(Duration.ofDays(27))),
                "a lapsed renewal must measure the term from now");
    }

    @Test
    void recurringIsBlockedWhenCountryOrProviderDoesNotSupportIt() {
        configureEthiopiaPrepaid();
        UUID recurringPrice = admin.addPriceOption(adminUser, "SILVER", ethiopia, "ETB",
                new BigDecimal("400.00"), "MONTH", 1, "RECURRING");

        // The country does not allow recurring billing.
        var countryBlocked = assertThrows(ResponseStatusException.class,
                () -> checkout.checkout(buyer, new CheckoutRequest(null, null, recurringPrice,
                        "RECURRING", null, null, null, "BANK_TRANSFER", null, "rec-1")));
        assertEquals("BILLING_ARRANGEMENT_NOT_AVAILABLE", countryBlocked.getReason());

        // Country allows it, but the provider rail does not support recurring.
        admin.upsertCountrySettings(adminUser, ethiopia, true, true, "ETB", List.of("ETB"),
                true, true, true, true, null);
        var providerBlocked = assertThrows(ResponseStatusException.class,
                () -> checkout.checkout(buyer, new CheckoutRequest(null, null, recurringPrice,
                        "RECURRING", null, null, null, "BANK_TRANSFER", null, "rec-2")));
        assertEquals("PAYMENT_PROVIDER_ARRANGEMENT_UNSUPPORTED", providerBlocked.getReason());
    }

    @Test
    void prepaidSubscriptionIsNeverAutoConvertedWhenCountryGainsRecurringSupport() {
        configureEthiopiaPrepaid();
        UUID priceId = silverPrepaidPrice(ethiopia, "ETB", "MONTH", 3, "900.00");
        var bought = payManually(priceId, "no-convert");
        Instant endBefore = periodEnd(bought.subscriptionId());

        // The country gains recurring support and a recurring option appears.
        admin.upsertCountrySettings(adminUser, ethiopia, true, true, "ETB", List.of("ETB"),
                true, true, true, true, null);
        admin.upsertCapability(adminUser, "BANK_TRANSFER", ethiopia, true, true, true, false,
                true, List.of("ETB"), List.of("BANK_TRANSFER"), null);
        admin.addPriceOption(adminUser, "SILVER", ethiopia, "ETB", new BigDecimal("400.00"),
                "MONTH", 1, "RECURRING");
        jobs.expirePrepaidTerms();

        var unchanged = subscriptions.currentSubscription(buyer).orElseThrow();
        assertEquals("PREPAID", unchanged.billingArrangement());
        assertEquals(bought.subscriptionId(), unchanged.id());
        assertEquals(endBefore, periodEnd(unchanged.id()));
    }

    @Test
    void voluntarySwitchToRecurringKeepsPrepaidTimeAndSupersedesTheOldRow() {
        configureEthiopiaPrepaid();
        UUID prepaidPrice = silverPrepaidPrice(ethiopia, "ETB", "MONTH", 3, "900.00");
        var prepaid = payManually(prepaidPrice, "switch-prepaid");
        Instant prepaidEnd = periodEnd(prepaid.subscriptionId());

        admin.upsertCountrySettings(adminUser, ethiopia, true, true, "ETB", List.of("ETB"),
                true, true, true, true, null);
        admin.upsertCapability(adminUser, "BANK_TRANSFER", ethiopia, true, true, true, false,
                true, List.of("ETB"), List.of("BANK_TRANSFER"), null);
        UUID recurringPrice = admin.addPriceOption(adminUser, "SILVER", ethiopia, "ETB",
                new BigDecimal("400.00"), "MONTH", 1, "RECURRING");

        // Buying a recurring option creates a separate pending row; the live
        // prepaid subscription is untouched until that purchase is paid for.
        var switching = checkout.checkout(buyer, new CheckoutRequest(null, null, recurringPrice,
                "RECURRING", null, null, null, "BANK_TRANSFER", null, "switch-recurring"));
        assertFalse(switching.subscriptionId().equals(prepaid.subscriptionId()));
        assertEquals("PREPAID", subscriptions.currentSubscription(buyer).orElseThrow()
                .billingArrangement());

        admin.verifyPaymentProof(adminUser, checkout.submitPaymentProof(buyer,
                switching.paymentId(), "TXN-SWITCH", null, null));

        var now = subscriptions.currentSubscription(buyer).orElseThrow();
        assertEquals("RECURRING", now.billingArrangement());
        assertEquals(switching.subscriptionId(), now.id());
        assertEquals("CANCELED", jdbc.queryForObject("SELECT status FROM billing_subscriptions"
                + " WHERE id=?", String.class, prepaid.subscriptionId()));
        // Time already paid for is carried over rather than discarded.
        assertTrue(now.currentPeriodEnd().isAfter(prepaidEnd),
                "the new term must start where the prepaid term ended");
    }

    @Test
    void manualProofVerifyAndRejectPaths() {
        configureEthiopiaPrepaid();
        UUID priceId = silverPrepaidPrice(ethiopia, "ETB", "MONTH", 1, "400.00");
        var result = checkout.checkout(buyer, prepaidRequest(priceId, "proof-paths"));

        // Evidence is required, and only one claim may be queued at a time.
        assertEquals("BILLING_PROOF_EVIDENCE_REQUIRED",
                assertThrows(ResponseStatusException.class, () -> checkout.submitPaymentProof(
                        buyer, result.paymentId(), "  ", null, null)).getReason());
        UUID firstProof = checkout.submitPaymentProof(buyer, result.paymentId(), "TXN-A",
                null, null);
        assertEquals("BILLING_PROOF_ALREADY_SUBMITTED",
                assertThrows(ResponseStatusException.class, () -> checkout.submitPaymentProof(
                        buyer, result.paymentId(), "TXN-B", null, null)).getReason());

        // Rejection leaves the payment open so the customer can resubmit.
        admin.rejectPaymentProof(adminUser, firstProof, "Reference not found on statement");
        assertEquals("REJECTED", jdbc.queryForObject("SELECT status FROM billing_payment_proofs"
                + " WHERE id=?", String.class, firstProof));
        assertEquals("PENDING", jdbc.queryForObject("SELECT status FROM billing_payments"
                + " WHERE id=?", String.class, result.paymentId()));
        assertTrue(subscriptions.currentSubscription(buyer).isEmpty());
        assertEquals("BILLING_PROOF_NOT_PENDING",
                assertThrows(ResponseStatusException.class,
                        () -> admin.verifyPaymentProof(adminUser, firstProof)).getReason());

        UUID secondProof = checkout.submitPaymentProof(buyer, result.paymentId(), "TXN-C",
                null, null);
        admin.verifyPaymentProof(adminUser, secondProof);
        assertEquals("ACTIVE", subscriptions.currentSubscription(buyer).orElseThrow().status());
        // Verification is not replayable.
        assertThrows(ResponseStatusException.class,
                () -> admin.verifyPaymentProof(adminUser, secondProof));

        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM billing_audit_events"
                        + " WHERE action_key='BILLING_PAYMENT_PROOF_VERIFIED'", Integer.class),
                "manual verification must be audited");
    }

    @Test
    void existingSubscriptionRetainsPurchasedTermsWhenAdminRepricesThePlan() {
        configureEthiopiaPrepaid();
        UUID originalPrice = silverPrepaidPrice(ethiopia, "ETB", "MONTH", 3, "900.00");
        var bought = payManually(originalPrice, "reprice");
        Instant endBefore = periodEnd(bought.subscriptionId());

        // Retire the option and publish a dearer, shorter one.
        admin.retirePriceOption(adminUser, originalPrice);
        admin.addPriceOption(adminUser, "SILVER", ethiopia, "ETB", new BigDecimal("1500.00"),
                "MONTH", 1, "PREPAID");

        var subscription = subscriptions.currentSubscription(buyer).orElseThrow();
        assertEquals(endBefore, periodEnd(subscription.id()));
        assertEquals("ETB", subscription.currencyCode());
        assertEquals(new BigDecimal("900.00"),
                jdbc.queryForObject("SELECT total_amount FROM billing_orders WHERE id=?",
                        BigDecimal.class, bought.orderId()));
        // The retired option is no longer purchasable, but the order still
        // resolves the term that was actually sold.
        assertEquals("BILLING_PRICE_NOT_AVAILABLE",
                assertThrows(ResponseStatusException.class, () -> checkout.checkout(buyer,
                        prepaidRequest(originalPrice, "reprice-retired"))).getReason());
    }

    @Test
    void entitlementsAreIdenticalWhicheverChannelPaid() {
        configureEthiopiaPrepaid();
        UUID priceId = silverPrepaidPrice(ethiopia, "ETB", "MONTH", 1, "400.00");
        // Give SILVER a quota the resolver can report on.
        jdbc.update("INSERT INTO billing_plan_entitlements(plan_id,feature_id,enabled,"
                + "quantity_limit,reset_period) SELECT p.id,f.id,true,5,'MONTH'"
                + " FROM billing_plans p,billing_features f WHERE p.plan_key='SILVER'"
                + " AND f.feature_key='POST_CREATE'"
                + " ON CONFLICT(plan_id,feature_id) DO UPDATE SET enabled=true,"
                + "quantity_limit=5,reset_period='MONTH'");

        var free = billing.previewPersonalFeature(buyer, "POST_CREATE", null, null);
        payManually(priceId, "entitlement-parity");
        var viaBankTransfer = billing.previewPersonalFeature(buyer, "POST_CREATE", null, null);

        // A second user on the same plan, recorded as a provider-renewed
        // subscription rather than a manual prepaid purchase.
        UUID cardUser = IdentityTestSupport.provision(ctx, ISSUER, "billing-card-buyer");
        jdbc.update("UPDATE profiles SET current_country_id=? WHERE id=?", britain, cardUser);
        jdbc.update("INSERT INTO billing_subscriptions(plan_id,user_id,status,"
                + "billing_arrangement,source_type,country_id,currency_code,provider_key)"
                + " SELECT id,?,'ACTIVE','RECURRING','PURCHASE',?,'GBP','STRIPE'"
                + " FROM billing_plans WHERE plan_key='SILVER'", cardUser, britain);
        var viaCard = billing.previewPersonalFeature(cardUser, "POST_CREATE", null, null);

        assertEquals(viaCard.allowed(), viaBankTransfer.allowed());
        assertEquals(viaCard.source(), viaBankTransfer.source());
        assertEquals(viaCard.remainingFreeQuota(), viaBankTransfer.remainingFreeQuota());
        assertEquals(5L, viaBankTransfer.remainingFreeQuota());
        assertFalse(free.remainingFreeQuota() != null
                && free.remainingFreeQuota() == 5L && free.allowed(),
                "the paid plan must differ from the unsubscribed baseline");
    }

    @Test
    void expiryAndReminderJobsAreIdempotent() {
        configureEthiopiaPrepaid();
        UUID priceId = silverPrepaidPrice(ethiopia, "ETB", "MONTH", 1, "400.00");
        var bought = payManually(priceId, "jobs");

        // Inside the reminder window: reminded exactly once.
        jdbc.update("UPDATE billing_subscriptions SET current_period_end=now()+interval '2 days'"
                + " WHERE id=?", bought.subscriptionId());
        assertEquals(1, jobs.sendRenewalReminders());
        assertEquals(0, jobs.sendRenewalReminders());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM notifications"
                        + " WHERE recipient_user_id=? AND type='BILLING_RENEWAL_REMINDER'",
                Integer.class, buyer));

        // A new term re-arms the reminder.
        admin.verifyPaymentProof(adminUser, checkout.submitPaymentProof(buyer,
                checkout.renew(buyer, prepaidRequest(null, "jobs-renew")).paymentId(),
                "TXN-JOBS", null, null));
        assertEquals(null, jdbc.queryForObject("SELECT renewal_reminder_sent_at"
                        + " FROM billing_subscriptions WHERE id=?", java.sql.Timestamp.class,
                bought.subscriptionId()));

        // Elapsed terms expire, once.
        jdbc.update("UPDATE billing_subscriptions SET current_period_start=now()"
                + "-interval '31 days',current_period_end=now()-interval '1 day'"
                + " WHERE id=?", bought.subscriptionId());
        assertEquals(1, jobs.expirePrepaidTerms());
        assertEquals(0, jobs.expirePrepaidTerms());
        assertEquals("EXPIRED", jdbc.queryForObject("SELECT status FROM billing_subscriptions"
                + " WHERE id=?", String.class, bought.subscriptionId()));
        assertTrue(subscriptions.currentSubscription(buyer).isEmpty());
    }

    @Test
    void checkoutIsIdempotentAndFailsClosedOnUnconfiguredCountryOrProvider() {
        // No country policy yet.
        assertEquals("BILLING_COUNTRY_NOT_CONFIGURED",
                assertThrows(ResponseStatusException.class,
                        () -> checkout.options(buyer, null)).getReason());

        configureEthiopiaPrepaid();
        UUID priceId = silverPrepaidPrice(ethiopia, "ETB", "MONTH", 1, "400.00");

        // Same idempotency key must not create a second order or payment.
        var first = checkout.checkout(buyer, prepaidRequest(priceId, "idem-1"));
        var replay = checkout.checkout(buyer, prepaidRequest(priceId, "idem-1"));
        assertEquals(first.orderId(), replay.orderId());
        assertEquals(first.paymentId(), replay.paymentId());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM billing_orders"
                + " WHERE user_id=?", Integer.class, buyer));

        // An unimplemented provider is refused even when configured as enabled.
        admin.upsertCapability(adminUser, "STRIPE", ethiopia, true, true, false, true, false,
                List.of("ETB"), List.of("CARD"), null);
        admin.updateProvider(adminUser, "STRIPE", true, null);
        assertEquals("PAYMENT_PROVIDER_NOT_IMPLEMENTED",
                assertThrows(ResponseStatusException.class, () -> checkout.checkout(buyer,
                        new CheckoutRequest(null, null, priceId, "PREPAID", null, null, null,
                                "STRIPE", "CARD", "idem-stripe"))).getReason());
    }
}
