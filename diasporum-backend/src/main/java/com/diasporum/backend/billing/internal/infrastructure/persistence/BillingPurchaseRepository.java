package com.diasporum.backend.billing.internal.infrastructure.persistence;

import com.diasporum.backend.billing.internal.domain.BillingModels.BillingPaymentView;
import com.diasporum.backend.billing.internal.domain.BillingModels.PaymentProofView;
import com.diasporum.backend.billing.internal.domain.BillingModels.SubscriptionView;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Orders, payments, manual-verification proofs and subscription rows.
 *
 * <p>For a PREPAID subscription the {@code billing_orders} /
 * {@code billing_payments} rows carrying its {@code subscription_id} are the
 * term history: one order per purchased term, with the subscription row itself
 * carrying only the current period.
 */
@Repository
public class BillingPurchaseRepository {

    private static final String SUBSCRIPTION_SELECT = "SELECT s.id,s.user_id,s.plan_id,"
            + "pl.plan_key,s.status,s.billing_arrangement,s.source_type,s.country_id,"
            + "s.currency_code,s.current_period_start,s.current_period_end,"
            + "s.cancel_at_period_end,s.provider_key,s.provider_billing_id,s.source_order_id,"
            + "s.renewal_reminder_sent_at FROM billing_subscriptions s "
            + "JOIN billing_plans pl ON pl.id=s.plan_id";

    private static final String PAYMENT_SELECT = "SELECT id,order_id,subscription_id,"
            + "provider_key,provider_payment_id,status,amount,currency_code"
            + " FROM billing_payments";

    private static final String PROOF_SELECT = "SELECT id,payment_id,submitted_by_user_id,"
            + "proof_reference,media_object_id,notes,status,verified_by_user_id,verified_at,"
            + "rejection_reason,created_at FROM billing_payment_proofs";

    /** Statuses the entitlement resolver treats as granting a plan. */
    private static final String LIVE_STATUSES = "('TRIALING','ACTIVE','PAST_DUE','PAUSED')";

    private final JdbcTemplate jdbc;

    public BillingPurchaseRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ---- orders ----

    public UUID insertOrder(UUID userId, UUID countryId, String currencyCode, BigDecimal amount,
            String providerKey, UUID subscriptionId, UUID planPriceId, String idempotencyKey) {
        return jdbc.queryForObject("INSERT INTO billing_orders(user_id,country_id,status,"
                        + "currency_code,subtotal_amount,total_amount,provider_key,"
                        + "subscription_id,plan_price_id,idempotency_key)"
                        + " VALUES(?,?,'PENDING',?,?,?,?,?,?,?) RETURNING id", UUID.class,
                userId, countryId, currencyCode, amount, amount, providerKey, subscriptionId,
                planPriceId, idempotencyKey);
    }

    /** Order fields the activation path needs: what was bought and for whom. */
    public Optional<PaidOrder> order(UUID orderId) {
        return jdbc.query("SELECT id,user_id,status,subscription_id,plan_price_id,country_id,"
                        + "currency_code,total_amount FROM billing_orders WHERE id=?",
                (rs, i) -> new PaidOrder(rs.getObject("id", UUID.class),
                        rs.getObject("user_id", UUID.class), rs.getString("status"),
                        rs.getObject("subscription_id", UUID.class),
                        rs.getObject("plan_price_id", UUID.class),
                        rs.getObject("country_id", UUID.class), rs.getString("currency_code"),
                        rs.getBigDecimal("total_amount")), orderId).stream().findFirst();
    }

    /** Projection of an order for the checkout/activation state machine. */
    public record PaidOrder(UUID id, UUID userId, String status, UUID subscriptionId,
            UUID planPriceId, UUID countryId, String currencyCode, BigDecimal totalAmount) {
    }

    public Optional<UUID> orderByIdempotencyKey(UUID userId, String idempotencyKey) {
        return jdbc.query("SELECT id FROM billing_orders WHERE user_id=? AND idempotency_key=?",
                        (rs, i) -> rs.getObject("id", UUID.class), userId, idempotencyKey)
                .stream().findFirst();
    }

    public Optional<UUID> paymentOfOrder(UUID orderId) {
        return jdbc.query("SELECT id FROM billing_payments WHERE order_id=?"
                        + " ORDER BY created_at DESC LIMIT 1",
                (rs, i) -> rs.getObject("id", UUID.class), orderId).stream().findFirst();
    }

    public int markOrderPaid(UUID orderId) {
        return jdbc.update("UPDATE billing_orders SET status='PAID',paid_at=now()"
                + " WHERE id=? AND status<>'PAID'", orderId);
    }

    public int linkOrderSubscription(UUID orderId, UUID subscriptionId) {
        return jdbc.update("UPDATE billing_orders SET subscription_id=? WHERE id=?",
                subscriptionId, orderId);
    }

    public Optional<UUID> orderSubscriptionId(UUID orderId) {
        return jdbc.query("SELECT subscription_id FROM billing_orders WHERE id=?",
                        (rs, i) -> rs.getObject("subscription_id", UUID.class), orderId)
                .stream().findFirst().filter(java.util.Objects::nonNull);
    }

    // ---- payments ----

    public UUID insertPayment(UUID orderId, UUID subscriptionId, String providerKey,
            BigDecimal amount, String currencyCode) {
        return jdbc.queryForObject("INSERT INTO billing_payments(order_id,subscription_id,"
                        + "provider_key,status,amount,currency_code)"
                        + " VALUES(?,?,?,'PENDING',?,?) RETURNING id", UUID.class,
                orderId, subscriptionId, providerKey, amount, currencyCode);
    }

    public Optional<BillingPaymentView> payment(UUID paymentId) {
        return jdbc.query(PAYMENT_SELECT + " WHERE id=?",
                BillingPurchaseRepository::paymentRow, paymentId).stream().findFirst();
    }

    /** Claims a PENDING payment as SUCCEEDED. Returns 0 when already settled. */
    public int markPaymentSucceeded(UUID paymentId, String providerPaymentId) {
        return jdbc.update("UPDATE billing_payments SET status='SUCCEEDED',settled_at=now(),"
                + "provider_payment_id=COALESCE(?,provider_payment_id)"
                + " WHERE id=? AND status='PENDING'", providerPaymentId, paymentId);
    }

    public int markPaymentFailed(UUID paymentId, String failureCode, String failureMessage) {
        return jdbc.update("UPDATE billing_payments SET status='FAILED',failure_code=?,"
                + "failure_message=? WHERE id=? AND status='PENDING'",
                failureCode, failureMessage, paymentId);
    }

    public int linkPaymentSubscription(UUID paymentId, UUID subscriptionId) {
        return jdbc.update("UPDATE billing_payments SET subscription_id=? WHERE id=?",
                subscriptionId, paymentId);
    }

    // ---- manual verification proofs ----

    public UUID insertProof(UUID paymentId, UUID submittedByUserId, String proofReference,
            UUID mediaObjectId, String notes) {
        return jdbc.queryForObject("INSERT INTO billing_payment_proofs(payment_id,"
                        + "submitted_by_user_id,proof_reference,media_object_id,notes)"
                        + " VALUES(?,?,?,?,?) RETURNING id", UUID.class,
                paymentId, submittedByUserId, proofReference, mediaObjectId, notes);
    }

    public Optional<PaymentProofView> proof(UUID proofId) {
        return jdbc.query(PROOF_SELECT + " WHERE id=?",
                BillingPurchaseRepository::proofRow, proofId).stream().findFirst();
    }

    public List<PaymentProofView> proofsByStatus(String status, int limit, int offset) {
        return jdbc.query(PROOF_SELECT + " WHERE status=? ORDER BY created_at LIMIT ? OFFSET ?",
                BillingPurchaseRepository::proofRow, status, limit, offset);
    }

    public boolean hasPendingProof(UUID paymentId) {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM billing_payment_proofs"
                + " WHERE payment_id=? AND status='PENDING'", Integer.class, paymentId);
        return count != null && count > 0;
    }

    /** Claims a PENDING proof as VERIFIED. Returns 0 when already decided. */
    public int verifyProof(UUID proofId, UUID adminUserId) {
        return jdbc.update("UPDATE billing_payment_proofs SET status='VERIFIED',"
                + "verified_by_user_id=?,verified_at=now()"
                + " WHERE id=? AND status='PENDING'", adminUserId, proofId);
    }

    public int rejectProof(UUID proofId, UUID adminUserId, String reason) {
        return jdbc.update("UPDATE billing_payment_proofs SET status='REJECTED',"
                + "verified_by_user_id=?,rejection_reason=?"
                + " WHERE id=? AND status='PENDING'", adminUserId, reason, proofId);
    }

    // ---- subscriptions ----

    public Optional<SubscriptionView> liveSubscription(UUID userId) {
        return jdbc.query(SUBSCRIPTION_SELECT + " WHERE s.user_id=? AND s.status IN "
                        + LIVE_STATUSES + " ORDER BY s.created_at DESC LIMIT 1",
                BillingPurchaseRepository::subscriptionRow, userId).stream().findFirst();
    }

    public Optional<SubscriptionView> subscription(UUID subscriptionId) {
        return jdbc.query(SUBSCRIPTION_SELECT + " WHERE s.id=?",
                BillingPurchaseRepository::subscriptionRow, subscriptionId).stream().findFirst();
    }

    /** Most recent pending (INCOMPLETE) subscription, e.g. an unconfirmed switch. */
    public Optional<SubscriptionView> pendingSubscription(UUID userId) {
        return jdbc.query(SUBSCRIPTION_SELECT + " WHERE s.user_id=? AND s.status='INCOMPLETE'"
                        + " ORDER BY s.created_at DESC LIMIT 1",
                BillingPurchaseRepository::subscriptionRow, userId).stream().findFirst();
    }

    /**
     * Creates a subscription in INCOMPLETE, which the partial unique indexes
     * for "one live subscription per owner" deliberately exclude, so a pending
     * purchase can coexist with the subscription it will replace.
     */
    public UUID insertIncompleteSubscription(UUID userId, UUID planId, String billingArrangement,
            String sourceType, UUID countryId, String currencyCode, String providerKey,
            UUID sourceOrderId) {
        return jdbc.queryForObject("INSERT INTO billing_subscriptions(plan_id,user_id,status,"
                        + "billing_arrangement,source_type,country_id,currency_code,provider_key,"
                        + "source_order_id) VALUES(?,?,'INCOMPLETE',?,?,?,?,?,?) RETURNING id",
                UUID.class, planId, userId, billingArrangement, sourceType, countryId,
                currencyCode, providerKey, sourceOrderId);
    }

    /**
     * Activates a term starting now. {@code years}/{@code months} carry the
     * term length so the period end is computed in the database.
     *
     * <p>{@code anchor} is the point the term is measured from when it is
     * later than now: used when a subscription supersedes one that still has
     * paid time left, so switching arrangement never discards time already
     * bought. Null anchors the term at now.
     */
    public int activateTerm(UUID subscriptionId, int years, int months, Instant anchor,
            UUID sourceOrderId, String providerBillingId) {
        return jdbc.update("UPDATE billing_subscriptions SET status='ACTIVE',"
                        + "current_period_start=now(),"
                        + "current_period_end=GREATEST(COALESCE(?,now()),now())"
                        + "+make_interval(years => ?,months => ?),"
                        + "source_order_id=COALESCE(?,source_order_id),"
                        + "provider_billing_id=COALESCE(?,provider_billing_id),"
                        + "renewal_reminder_sent_at=NULL,updated_at=now()"
                        + " WHERE id=? AND status<>'ACTIVE'",
                anchor == null ? null : java.sql.Timestamp.from(anchor),
                years, months, sourceOrderId, providerBillingId, subscriptionId);
    }

    /**
     * Extends a prepaid term: {@code GREATEST(current_period_end, now())} plus
     * the purchased term, so renewing early adds to the remaining time and
     * renewing late starts from now. Clears the reminder flag so the next term
     * can be reminded exactly once.
     */
    public int extendTerm(UUID subscriptionId, int years, int months, UUID sourceOrderId) {
        return jdbc.update("UPDATE billing_subscriptions SET status='ACTIVE',"
                        + "current_period_end=GREATEST(COALESCE(current_period_end,now()),now())"
                        + "+make_interval(years => ?,months => ?),"
                        + "source_order_id=COALESCE(?,source_order_id),"
                        + "renewal_reminder_sent_at=NULL,updated_at=now() WHERE id=?",
                years, months, sourceOrderId, subscriptionId);
    }

    /**
     * Supersedes the live subscription of an owner when a different row takes
     * over, so the "one live subscription per owner" index is never violated.
     */
    public int supersede(UUID subscriptionId) {
        return jdbc.update("UPDATE billing_subscriptions SET status='CANCELED',"
                + "canceled_at=now(),updated_at=now() WHERE id=? AND status IN "
                + LIVE_STATUSES, subscriptionId);
    }

    // ---- scheduled lifecycle ----

    public int expireElapsedPrepaidTerms() {
        return jdbc.update("UPDATE billing_subscriptions SET status='EXPIRED',updated_at=now()"
                + " WHERE billing_arrangement='PREPAID' AND status='ACTIVE'"
                + " AND current_period_end IS NOT NULL AND current_period_end<now()");
    }

    /**
     * Personal subscriptions whose term ends within {@code days} and that have
     * not been reminded for the current term. Business-owned subscriptions are
     * excluded: in-app notifications address a user, not an account.
     */
    public List<SubscriptionView> remindableSubscriptions(int days, int limit) {
        return jdbc.query(SUBSCRIPTION_SELECT + " WHERE s.user_id IS NOT NULL"
                        + " AND s.status='ACTIVE'"
                        + " AND (s.billing_arrangement='PREPAID' OR s.cancel_at_period_end)"
                        + " AND s.current_period_end IS NOT NULL"
                        + " AND s.current_period_end<=now()+make_interval(days => ?)"
                        + " AND s.current_period_end>now()"
                        + " AND s.renewal_reminder_sent_at IS NULL"
                        + " ORDER BY s.current_period_end LIMIT ?",
                BillingPurchaseRepository::subscriptionRow, days, limit);
    }

    /** Claims the reminder for one subscription. Returns 0 when already sent. */
    public int markReminderSent(UUID subscriptionId) {
        return jdbc.update("UPDATE billing_subscriptions SET renewal_reminder_sent_at=now(),"
                + "updated_at=now() WHERE id=? AND renewal_reminder_sent_at IS NULL",
                subscriptionId);
    }

    // ---- audit ----

    public void audit(UUID actorUserId, String actionKey, String targetType, UUID targetId,
            String metadataJson) {
        jdbc.update("INSERT INTO billing_audit_events(actor_user_id,action_key,target_type,"
                + "target_id,metadata) VALUES(?,?,?,?,COALESCE(?::jsonb,'{}'::jsonb))",
                actorUserId, actionKey, targetType, targetId, metadataJson);
    }

    // ---- row mappers ----

    private static SubscriptionView subscriptionRow(ResultSet rs, int i) throws SQLException {
        return new SubscriptionView(rs.getObject("id", UUID.class),
                rs.getObject("user_id", UUID.class), rs.getObject("plan_id", UUID.class),
                rs.getString("plan_key"), rs.getString("status"),
                rs.getString("billing_arrangement"), rs.getString("source_type"),
                rs.getObject("country_id", UUID.class), rs.getString("currency_code"),
                instant(rs, "current_period_start"), instant(rs, "current_period_end"),
                rs.getBoolean("cancel_at_period_end"), rs.getString("provider_key"),
                rs.getString("provider_billing_id"), rs.getObject("source_order_id", UUID.class),
                instant(rs, "renewal_reminder_sent_at"));
    }

    private static BillingPaymentView paymentRow(ResultSet rs, int i) throws SQLException {
        return new BillingPaymentView(rs.getObject("id", UUID.class),
                rs.getObject("order_id", UUID.class),
                rs.getObject("subscription_id", UUID.class), rs.getString("provider_key"),
                rs.getString("provider_payment_id"), rs.getString("status"),
                rs.getBigDecimal("amount"), rs.getString("currency_code"));
    }

    private static PaymentProofView proofRow(ResultSet rs, int i) throws SQLException {
        return new PaymentProofView(rs.getObject("id", UUID.class),
                rs.getObject("payment_id", UUID.class),
                rs.getObject("submitted_by_user_id", UUID.class),
                rs.getString("proof_reference"), rs.getObject("media_object_id", UUID.class),
                rs.getString("notes"), rs.getString("status"),
                rs.getObject("verified_by_user_id", UUID.class), instant(rs, "verified_at"),
                rs.getString("rejection_reason"), instant(rs, "created_at"));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        java.sql.Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }
}
