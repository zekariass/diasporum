package com.diasporum.backend.events.internal.application.ticketing;

import com.diasporum.backend.events.internal.application.ticketing.TicketPaymentGateway.Intent;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Ticketing expiry + reconciliation worker. Idempotent: every change is a
 * guarded conditional update, so overlapping or repeated runs change nothing
 * twice.
 *
 * <ol>
 *   <li>ACTIVE reservations past expires_at with no live order → RELEASED,
 *       inventory restored (batch, {@code FOR UPDATE SKIP LOCKED}).</li>
 *   <li>RESERVED / PAYMENT_PENDING orders past expires_at: the intent is checked
 *       first — succeeded → confirmed (missed webhook), processing → left alone,
 *       otherwise cancelled at the provider and the order → EXPIRED with its hold
 *       released. An order is never expired while its money may still land.</li>
 *   <li>Refunds stuck APPROVED (crash before the provider call) are resent and
 *       ones pending at the provider are polled.</li>
 * </ol>
 */
@Component
public class TicketingJobs {
    private static final Logger log = LoggerFactory.getLogger(TicketingJobs.class);
    private static final int BATCH = 200;

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final TicketOrderStore store;
    private final TicketOrderService orders;
    private final TicketFulfilmentService fulfilment;
    private final TicketRefundService refunds;
    private final TicketPaymentGateway gateway;

    public TicketingJobs(JdbcTemplate jdbc, org.springframework.transaction.PlatformTransactionManager txManager, TicketOrderStore store,
            TicketOrderService orders, TicketFulfilmentService fulfilment,
            TicketRefundService refunds, TicketPaymentGateway gateway) {
        this.jdbc = jdbc;
        this.tx = new TransactionTemplate(txManager);
        this.store = store;
        this.orders = orders;
        this.fulfilment = fulfilment;
        this.refunds = refunds;
        this.gateway = gateway;
    }

    public record RunResult(int reservationsReleased, int ordersExpired, int ordersConfirmed,
            int refundsReconciled) {
    }

    @Scheduled(fixedDelayString = "${diasporum.events.ticketing.expiry-interval:PT1M}")
    public void scheduled() {
        RunResult r = run();
        if (r.reservationsReleased() + r.ordersExpired() + r.ordersConfirmed()
                + r.refundsReconciled() > 0) {
            log.info("Ticketing jobs: {}", r);
        }
    }

    public RunResult run() {
        int released = expireReservations();
        int[] orderCounts = expireOrders();
        int reconciled = reconcileRefunds();
        return new RunResult(released, orderCounts[0], orderCounts[1], reconciled);
    }

    int expireReservations() {
        Integer n = tx.execute(s -> {
            List<UUID> ids = jdbc.queryForList("SELECT r.id FROM ticket_reservations r"
                    + " WHERE r.status='ACTIVE' AND r.expires_at < now() AND NOT EXISTS ("
                    + "SELECT 1 FROM ticket_orders o WHERE o.reservation_id=r.id"
                    + " AND o.status IN ('RESERVED','PAYMENT_PENDING'))"
                    + " ORDER BY r.expires_at LIMIT " + BATCH + " FOR UPDATE OF r SKIP LOCKED", UUID.class);
            int count = 0;
            for (UUID id : ids) {
                count += store.releaseReservation(id) ? 1 : 0;
            }
            return count;
        });
        return n == null ? 0 : n;
    }

    /** @return [expired, confirmed] */
    int[] expireOrders() {
        List<Map<String, Object>> due = jdbc.queryForList("SELECT id,payment_provider_id"
                + " FROM ticket_orders WHERE status IN ('RESERVED','PAYMENT_PENDING')"
                + " AND expires_at < now() ORDER BY expires_at LIMIT " + BATCH);
        int expired = 0;
        int confirmed = 0;
        for (Map<String, Object> row : due) {
            UUID orderId = (UUID) row.get("id");
            String intentId = (String) row.get("payment_provider_id");
            try {
                if (intentId != null) {
                    Intent intent = gateway.retrieve(intentId);
                    if (!intent.succeeded() && !intent.processing() && !intent.canceled()) {
                        intent = gateway.cancel(intentId);
                    }
                    if (intent.succeeded()) {
                        fulfilment.confirmPaid(orderId, "SYSTEM", null);
                        confirmed++;
                        continue;
                    }
                    if (intent.processing()) {
                        continue; // money may still land; the webhook or next run decides
                    }
                }
                Boolean closed = tx.execute(s -> orders.closeUnpaid(orderId, "EXPIRED", null,
                        "SYSTEM", "Checkout window expired"));
                expired += Boolean.TRUE.equals(closed) ? 1 : 0;
            } catch (RuntimeException ex) {
                log.warn("Ticket order {} expiry deferred: {}", orderId, ex.toString());
            }
        }
        return new int[]{expired, confirmed};
    }

    int reconcileRefunds() {
        int n = 0;
        for (UUID refundId : refunds.stuck(50)) {
            try {
                refunds.reconcile(refundId);
                n++;
            } catch (RuntimeException ex) {
                log.warn("Ticket refund {} reconciliation deferred: {}", refundId, ex.toString());
            }
        }
        return n;
    }
}
