package com.diasporum.backend.shopmarketplace.internal.application;

import com.diasporum.backend.shopmarketplace.internal.application.ShippingProvider.TrackingUpdate;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Background maintenance for the marketplace:
 * <ul>
 *   <li>expired checkout sessions release their inventory reservations;</li>
 *   <li>payments left pending (webhook missed) are reconciled against the provider;</li>
 *   <li>open shipments poll the carrier for tracking updates (webhook fallback);</li>
 *   <li>pending seller transfers are retried.</li>
 * </ul>
 * All operations are idempotent: rows are claimed via status UPDATEs, so overlapping runs
 * are safe.
 */
@Component
public class MarketplaceJobs {
    private static final Logger log = LoggerFactory.getLogger(MarketplaceJobs.class);

    private final JdbcTemplate jdbc;
    private final OrderLifecycleService lifecycle;
    private final PaymentService payments;
    private final SellerOrderService sellerOrders;
    private final List<ShippingProvider> providers;

    public MarketplaceJobs(ShopSupport support, OrderLifecycleService lifecycle, PaymentService payments,
            SellerOrderService sellerOrders, List<ShippingProvider> providers) {
        this.jdbc = support.jdbc();
        this.lifecycle = lifecycle;
        this.payments = payments;
        this.sellerOrders = sellerOrders;
        this.providers = providers;
    }

    private ShippingProvider provider(String key) {
        return providers.stream().filter(p -> p.key().equals(key)).findFirst().orElse(null);
    }

    @Scheduled(fixedDelayString = "${diasporum.shop.jobs.expiry-interval:PT1M}")
    public void expireSessions() {
        int expired = lifecycle.expireStaleSessions();
        if (expired > 0) {
            log.info("Expired {} checkout sessions", expired);
        }
    }

    @Scheduled(fixedDelayString = "${diasporum.shop.jobs.payment-reconcile-interval:PT2M}")
    public void reconcilePayments() {
        List<UUID> pending = jdbc.queryForList("SELECT order_id FROM marketplace_payments WHERE status IN "
                + "('PENDING','PROCESSING') AND created_at < now() - interval '5 minutes' LIMIT 50", UUID.class);
        for (UUID orderId : pending) {
            try {
                payments.reconcilePayment(orderId);
            } catch (RuntimeException e) {
                log.warn("Payment reconcile failed for order {}: {}", orderId, e.getMessage());
            }
        }
    }

    @Scheduled(fixedDelayString = "${diasporum.shop.jobs.transfer-interval:PT5M}")
    public void transfers() {
        lifecycle.processPendingTransfers();
    }

    @Scheduled(fixedDelayString = "${diasporum.shop.jobs.tracking-interval:PT15M}")
    public void trackingSync() {
        ShippingProvider shippo = provider("SHIPPO");
        if (shippo == null || !shippo.available()) {
            return;
        }
        List<Object[]> open = jdbc.query("SELECT s.id,s.carrier_name,s.tracking_number FROM shipments s "
                + "WHERE s.provider_key='SHIPPO' AND s.tracking_number IS NOT NULL "
                + "AND s.status IN ('LABEL_CREATED','READY_TO_DISPATCH','IN_TRANSIT','OUT_FOR_DELIVERY') LIMIT 100",
                (rs, i) -> new Object[]{rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3)});
        for (Object[] row : open) {
            try {
                TrackingUpdate update = shippo.fetchTracking((String) row[1], (String) row[2]);
                if (update != null) {
                    sellerOrders.applyTrackingUpdate(update);
                }
            } catch (RuntimeException e) {
                log.warn("Tracking sync failed for shipment {}: {}", row[0], e.getMessage());
            }
        }
    }
}
