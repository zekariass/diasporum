package com.diasporum.backend.shopmarketplace.internal.application;

import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.ADDRESS_COLS;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.badRequest;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.conflict;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.instant;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.notFound;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.placeholders;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.trim;

import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.CheckoutTotals;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Money;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.OrderAddress;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.OrderDetail;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.OrderItemView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.OrderSummary;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Page;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.PackageView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.RefundView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ReturnItemView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ReturnRequestView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Review;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerOrderView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Shipment;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShipmentItemView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.TrackingEvent;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Buyer-side orders: one parent order per checkout containing independent seller orders, plus
 * return requests and verified-purchase reviews. Sellers see only their own slice — parent
 * status is always derived from the seller orders, never the reverse.
 */
@Service
public class OrderService {
    private static final Set<String> BUYER_FILTERS = Set.of("ALL", "PAYMENT_PENDING", "PLACED", "PARTIALLY_FULFILLED",
            "FULFILLED", "CANCELLED", "RETURNED", "PARTIALLY_RETURNED", "PARTIALLY_REFUNDED", "REFUNDED", "PAYMENT_FAILED");

    private final JdbcTemplate jdbc;
    private final ShopSupport support;
    private final PaymentService payments;
    private final OrderLifecycleService lifecycle;
    private final ShopProperties properties;
    private final SellerAccessPolicy policy;

    public OrderService(ShopSupport support, PaymentService payments, OrderLifecycleService lifecycle,
            ShopProperties properties, SellerAccessPolicy policy) {
        this.jdbc = support.jdbc();
        this.support = support;
        this.payments = payments;
        this.lifecycle = lifecycle;
        this.properties = properties;
        this.policy = policy;
    }

    // ------------------------------------------------------------------ list / detail

    public Page<OrderSummary> list(UUID actor, String filter, String cursor, Integer size) {
        String f = filter == null ? "ALL" : filter.toUpperCase();
        if (!BUYER_FILTERS.contains(f)) {
            throw badRequest("INVALID_ORDER_FILTER");
        }
        int limit = ShopSupport.pageSize(size);
        List<Object> args = new ArrayList<>(List.of(actor));
        StringBuilder sql = new StringBuilder("SELECT o.id,o.order_number,o.status,o.currency_code::text,o.total_amount_minor,"
                + "o.placed_at,o.created_at,(SELECT COALESCE(sum(oi.quantity),0) FROM order_items oi JOIN seller_orders so "
                + "ON so.id=oi.seller_order_id WHERE so.order_id=o.id) AS item_count,"
                + "(SELECT count(*) FROM seller_orders so WHERE so.order_id=o.id) AS seller_orders,"
                + "(SELECT array_agg(pm.media_id) FROM (SELECT DISTINCT pm.media_id FROM order_items oi JOIN seller_orders so "
                + "ON so.id=oi.seller_order_id JOIN product_media pm ON pm.product_id=oi.product_id AND pm.display_order=0 "
                + "WHERE so.order_id=o.id LIMIT 4) pm) AS previews FROM orders o WHERE o.customer_user_id=?");
        if (!"ALL".equals(f)) {
            sql.append(" AND o.status=?");
            args.add(f);
        }
        String[] c = ShopSupport.decodeCursor(cursor, "CREATED");
        if (c != null) {
            sql.append(" AND (o.created_at,o.id)<(?::timestamptz,?)");
            args.add(c[1]);
            args.add(UUID.fromString(c[2]));
        }
        sql.append(" ORDER BY o.created_at DESC,o.id DESC LIMIT ?");
        args.add(limit + 1);
        List<OrderSummary> rows = jdbc.query(sql.toString(), (rs, i) -> {
            java.sql.Array arr = rs.getArray("previews");
            List<UUID> previews = arr == null ? List.of()
                    : java.util.Arrays.stream((UUID[]) arr.getArray()).toList();
            return new OrderSummary(rs.getObject("id", UUID.class), rs.getString("order_number"), rs.getString("status"),
                    Money.of(rs.getLong("total_amount_minor"), rs.getString("currency_code").trim()),
                    instant(rs, "placed_at"), instant(rs, "created_at"), rs.getInt("item_count"),
                    rs.getInt("seller_orders"), previews, List.of());
        }, args.toArray());
        String next = null;
        if (rows.size() > limit) {
            rows = new ArrayList<>(rows.subList(0, limit));
            next = ShopSupport.cursor("CREATED", rows.getLast().createdAt().toString(), rows.getLast().id());
        }
        Map<UUID, String> urls = support.urls(rows.stream().flatMap(r -> r.previewMediaIds().stream()).toList());
        return new Page<>(rows.stream().map(r -> new OrderSummary(r.id(), r.orderNumber(), r.status(), r.total(),
                r.placedAt(), r.createdAt(), r.itemCount(), r.sellerOrderCount(), r.previewMediaIds(),
                r.previewMediaIds().stream().map(urls::get).toList())).toList(), next);
    }

    public OrderDetail detail(UUID actor, UUID orderId) {
        payments.reconcilePayment(orderId); // pull a late-paid or expired hosted checkout state
        Object[] o = jdbc.query("SELECT customer_user_id,order_number,status,currency_code::text,subtotal_amount_minor,"
                + "shipping_amount_minor,discount_amount_minor,tax_amount_minor,total_amount_minor,placed_at,created_at "
                + "FROM orders WHERE id=?", rs -> rs.next() ? new Object[] {rs.getObject(1, UUID.class), rs.getString(2),
                        rs.getString(3), rs.getString(4).trim(), rs.getLong(5), rs.getLong(6), rs.getLong(7), rs.getLong(8),
                        rs.getLong(9), instant(rs, "placed_at"), instant(rs, "created_at")} : null, orderId);
        if (o == null || !actor.equals(o[0])) {
            throw notFound("ORDER_NOT_FOUND");
        }
        String currency = (String) o[3];
        Object[] payment = jdbc.query("SELECT status,failure_message,provider_payment_intent_id FROM marketplace_payments "
                + "WHERE order_id=? ORDER BY created_at DESC LIMIT 1", rs -> rs.next() ? new Object[] {rs.getString(1),
                        rs.getString(2), rs.getString(3)} : null, orderId);
        String paymentUrl = jdbc.query("SELECT t.metadata->>'hostedUrl' FROM marketplace_payment_transactions t JOIN "
                + "marketplace_payments mp ON mp.id=t.payment_id WHERE mp.order_id=? AND mp.status IN "
                + "('CREATED','REQUIRES_ACTION','PROCESSING') AND t.transaction_type='AUTHORIZATION' "
                + "ORDER BY t.occurred_at DESC LIMIT 1", rs -> rs.next() ? rs.getString(1) : null, orderId);
        OrderAddress address = jdbc.query("SELECT recipient_name,address_line_1,address_line_2,city,region,postal_code,"
                + "country_code,phone_e164 FROM order_addresses WHERE order_id=? AND address_type='SHIPPING' "
                + "AND seller_order_id IS NULL LIMIT 1", (rs, i) -> new OrderAddress(rs.getString(1), rs.getString(2),
                        rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7), rs.getString(8)),
                orderId).stream().findFirst().orElse(null);
        List<SellerOrderView> sellerOrders = sellerOrders(actor, orderId, currency, false);
        return new OrderDetail(orderId, (String) o[1], (String) o[2],
                new CheckoutTotals(Money.of((Long) o[4], currency), Money.of((Long) o[6], currency),
                        Money.of((Long) o[5], currency), Money.of((Long) o[7], currency), Money.of((Long) o[8], currency)),
                (java.time.Instant) o[9], (java.time.Instant) o[10],
                payment == null ? null : (String) payment[0], payment == null ? null : (String) payment[1], paymentUrl,
                address, sellerOrders);
    }

    /**
     * Builds the seller-order views of one parent order. For the buyer this shows every seller;
     * for a seller actor ({@code sellerSlice}) only their own shop's slice.
     */
    List<SellerOrderView> sellerOrders(UUID actor, UUID orderId, String currency, boolean sellerSlice) {
        List<Object[]> rows = jdbc.query("SELECT so.id,so.seller_order_number,so.shop_id,s.name,so.seller_id,so.status,"
                + "so.subtotal_amount_minor,so.shipping_amount_minor,so.discount_amount_minor,so.tax_amount_minor,"
                + "so.seller_net_amount_minor,so.commission_amount_minor,so.created_at,ms.owner_user_id,"
                + "ms.business_account_id,(SELECT media_id FROM shop_media WHERE shop_id=s.id AND media_role='LOGO') AS logo "
                + "FROM seller_orders so JOIN shops s ON s.id=so.shop_id JOIN marketplace_sellers ms ON ms.id=so.seller_id "
                + "WHERE so.order_id=? ORDER BY so.created_at", (rs, i) -> new Object[] {rs.getObject(1, UUID.class),
                        rs.getString(2), rs.getObject(3, UUID.class), rs.getString(4), rs.getObject(5, UUID.class),
                        rs.getString(6), rs.getLong(7), rs.getLong(8), rs.getLong(9), rs.getLong(10), rs.getLong(11),
                        rs.getLong(12), instant(rs, "created_at"), rs.getObject(14, UUID.class),
                        rs.getObject(15, UUID.class), rs.getObject(16, UUID.class)}, orderId);
        if (rows.isEmpty()) {
            return List.of();
        }
        List<UUID> soIds = rows.stream().map(r -> (UUID) r[0]).toList();
        Map<UUID, List<OrderItemView>> items = orderItems(actor, soIds, currency);
        Map<UUID, List<Shipment>> shipments = shipments(soIds);
        Map<UUID, List<ReturnRequestView>> returns = returns(soIds);
        Map<UUID, List<RefundView>> refunds = refunds(soIds);
        Map<UUID, String> urls = support.urls(rows.stream().map(r -> (UUID) r[15]).toList());
        Map<UUID, String> shipNames = shippingNames(soIds);
        List<SellerOrderView> views = new ArrayList<>();
        for (Object[] r : rows) {
            UUID soId = (UUID) r[0];
            UUID sellerUser = (UUID) r[13];
            UUID sellerBusiness = (UUID) r[14];
            List<ReturnRequestView> soReturns = returns.getOrDefault(soId, List.of());
            boolean delivered = "DELIVERED".equals(r[5]) || "PARTIALLY_RETURNED".equals(r[5])
                    || "RETURNED".equals(r[5]) || "PARTIALLY_REFUNDED".equals(r[5]) || "REFUNDED".equals(r[5]);
            boolean canReturn = delivered && items.getOrDefault(soId, List.of()).stream()
                    .anyMatch(i -> i.returnableQuantity() > 0);
            boolean reviewed = jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM shop_reviews WHERE seller_order_id=?)",
                    Boolean.class, soId);
            views.add(new SellerOrderView(soId, (String) r[1], (UUID) r[2], (String) r[3], (UUID) r[15], urls.get(r[15]),
                    (String) r[5], items.getOrDefault(soId, List.of()), Money.of((Long) r[6], currency),
                    Money.of((Long) r[8], currency), Money.of((Long) r[7], currency), Money.of((Long) r[9], currency),
                    Money.of((Long) r[6] - (Long) r[8] + (Long) r[7] + (Long) r[9], currency), shipNames.get(soId),
                    shipments.getOrDefault(soId, List.of()), soReturns, refunds.getOrDefault(soId, List.of()), canReturn,
                    delivered && !reviewed, reviewed, sellerUser, sellerBusiness, (java.time.Instant) r[12]));
        }
        return views;
    }

    private Map<UUID, String> shippingNames(List<UUID> soIds) {
        Map<UUID, String> names = new HashMap<>();
        if (soIds.isEmpty()) {
            return names;
        }
        jdbc.query("SELECT DISTINCT ci.attributes_snapshot->>'shipName',so.id FROM checkout_items ci JOIN order_items oi "
                + "ON oi.checkout_item_id=ci.id JOIN seller_orders so ON so.id=oi.seller_order_id WHERE so.id IN ("
                + placeholders(soIds.size()) + ")", rs -> {
                    names.put(rs.getObject(2, UUID.class), rs.getString(1));
                }, soIds.toArray());
        return names;
    }

    /** Items with per-item shipped/returnable/reviewed derivations. */
    private Map<UUID, List<OrderItemView>> orderItems(UUID actor, List<UUID> soIds, String currency) {
        Map<UUID, List<OrderItemView>> result = new HashMap<>();
        if (soIds.isEmpty()) {
            return result;
        }
        List<OrderItemView> items = jdbc.query("SELECT oi.id,oi.seller_order_id,oi.product_id,oi.variant_id,"
                + "oi.product_name_snapshot,oi.variant_label_snapshot,oi.product_condition_snapshot,oi.quantity,"
                + "oi.unit_price_minor,oi.discount_amount_minor,oi.tax_amount_minor,oi.line_total_minor,"
                + "(SELECT pm.media_id FROM product_media pm WHERE pm.product_id=oi.product_id ORDER BY pm.display_order "
                + "LIMIT 1) AS image,"
                + "(SELECT COALESCE(sum(si.quantity),0) FROM shipment_items si JOIN shipments sh ON sh.id=si.shipment_id "
                + "WHERE si.order_item_id=oi.id AND sh.status<>'CANCELLED') AS shipped,"
                + "(SELECT COALESCE(sum(ri.quantity),0) FROM return_request_items ri JOIN return_requests rr "
                + "ON rr.id=ri.return_request_id WHERE ri.order_item_id=oi.id AND rr.status NOT IN ('REJECTED','CLOSED')) "
                + "AS in_return,"
                + "EXISTS(SELECT 1 FROM product_reviews pr WHERE pr.order_item_id=oi.id) AS reviewed "
                + "FROM order_items oi WHERE oi.seller_order_id IN (" + placeholders(soIds.size())
                + ") ORDER BY oi.created_at", (rs, i) -> {
                    int shipped = rs.getInt("shipped");
                    int inReturn = rs.getInt("in_return");
                    return new OrderItemView(rs.getObject("id", UUID.class), rs.getObject("seller_order_id", UUID.class),
                            rs.getObject("product_id", UUID.class), rs.getObject("variant_id", UUID.class),
                            rs.getString("product_name_snapshot"), rs.getString("variant_label_snapshot"),
                            rs.getString("product_condition_snapshot"), rs.getInt("quantity"),
                            Money.of(rs.getLong("unit_price_minor"), currency),
                            Money.of(rs.getLong("discount_amount_minor"), currency),
                            Money.of(rs.getLong("tax_amount_minor"), currency),
                            Money.of(rs.getLong("line_total_minor"), currency), rs.getObject("image", UUID.class), null,
                            rs.getBoolean("reviewed"), Math.max(shipped - inReturn, 0), shipped);
                }, soIds.toArray());
        Map<UUID, String> urls = support.urls(items.stream().map(OrderItemView::imageMediaId).toList());
        for (OrderItemView item : items) {
            result.computeIfAbsent(item.sellerOrderId(), k -> new ArrayList<>()).add(new OrderItemView(item.id(),
                    item.sellerOrderId(), item.productId(), item.variantId(), item.productName(), item.variantLabel(),
                    item.condition(), item.quantity(), item.unitPrice(), item.discount(), item.tax(), item.lineTotal(),
                    item.imageMediaId(), urls.get(item.imageMediaId()), item.reviewed(), item.returnableQuantity(),
                    item.shippedQuantity()));
        }
        return result;
    }

    /** Shipments with packages, items and tracking events; deduped by provider event id. */
    Map<UUID, List<Shipment>> shipments(List<UUID> soIds) {
        Map<UUID, List<Shipment>> result = new HashMap<>();
        if (soIds.isEmpty()) {
            return result;
        }
        List<Object[]> rows = jdbc.query("SELECT id,seller_order_id,shipment_type,provider_key,carrier_name,service_name,"
                + "tracking_number,tracking_url,status,shipped_at,delivered_at FROM shipments WHERE seller_order_id IN ("
                + placeholders(soIds.size()) + ") ORDER BY created_at", (rs, i) -> new Object[] {
                        rs.getObject(1, UUID.class), rs.getObject(2, UUID.class), rs.getString(3), rs.getString(4),
                        rs.getString(5), rs.getString(6), rs.getString(7), rs.getString(8), rs.getString(9),
                        instant(rs, "shipped_at"), instant(rs, "delivered_at")}, soIds.toArray());
        List<UUID> shipmentIds = rows.stream().map(r -> (UUID) r[0]).toList();
        Map<UUID, List<PackageView>> packages = packages(shipmentIds);
        Map<UUID, List<ShipmentItemView>> items = shipmentItems(shipmentIds);
        Map<UUID, List<TrackingEvent>> events = tracking(shipmentIds);
        for (Object[] r : rows) {
            UUID id = (UUID) r[0];
            result.computeIfAbsent((UUID) r[1], k -> new ArrayList<>()).add(new Shipment(id, (UUID) r[1],
                    (String) r[2], (String) r[3], (String) r[4], (String) r[5], (String) r[6], (String) r[7],
                    (String) r[8], (java.time.Instant) r[9], (java.time.Instant) r[10],
                    items.getOrDefault(id, List.of()), packages.getOrDefault(id, List.of()),
                    events.getOrDefault(id, List.of())));
        }
        return result;
    }

    private Map<UUID, List<PackageView>> packages(List<UUID> shipmentIds) {
        Map<UUID, List<PackageView>> result = new HashMap<>();
        if (shipmentIds.isEmpty()) {
            return result;
        }
        jdbc.query("SELECT p.id,p.shipment_id,p.package_number,p.weight_grams,p.length_mm,p.width_mm,p.height_mm,"
                + "l.status,l.carrier_name,l.service_name,l.provider_transaction_id FROM shipment_packages p "
                + "LEFT JOIN shipping_labels l ON l.shipment_package_id=p.id WHERE p.shipment_id IN ("
                + placeholders(shipmentIds.size()) + ") ORDER BY p.package_number", rs -> {
                    boolean labelAvailable = rs.getString(12) != null && "PURCHASED".equals(rs.getString(8));
                    result.computeIfAbsent(rs.getObject(2, UUID.class), k -> new ArrayList<>())
                            .add(new PackageView(rs.getObject(1, UUID.class), rs.getInt(3), rs.getInt(4), rs.getInt(5),
                                    rs.getInt(6), rs.getInt(7), rs.getString(8), rs.getString(9), rs.getString(10),
                                    labelAvailable));
                }, shipmentIds.toArray());
        return result;
    }

    private Map<UUID, List<ShipmentItemView>> shipmentItems(List<UUID> shipmentIds) {
        Map<UUID, List<ShipmentItemView>> result = new HashMap<>();
        if (shipmentIds.isEmpty()) {
            return result;
        }
        jdbc.query("SELECT si.shipment_id,si.order_item_id,oi.product_name_snapshot,si.quantity FROM shipment_items si "
                + "JOIN order_items oi ON oi.id=si.order_item_id WHERE si.shipment_id IN ("
                + placeholders(shipmentIds.size()) + ")", rs -> {
                    result.computeIfAbsent(rs.getObject(1, UUID.class), k -> new ArrayList<>())
                            .add(new ShipmentItemView(rs.getObject(2, UUID.class), rs.getString(3), rs.getInt(4)));
                }, shipmentIds.toArray());
        return result;
    }

    private Map<UUID, List<TrackingEvent>> tracking(List<UUID> shipmentIds) {
        Map<UUID, List<TrackingEvent>> result = new HashMap<>();
        if (shipmentIds.isEmpty()) {
            return result;
        }
        jdbc.query("SELECT shipment_id,event_code,description,location,occurred_at FROM shipping_tracking_events "
                + "WHERE shipment_id IN (" + placeholders(shipmentIds.size()) + ") ORDER BY occurred_at DESC", rs -> {
                    result.computeIfAbsent(rs.getObject(1, UUID.class), k -> new ArrayList<>())
                            .add(new TrackingEvent(rs.getString(2), rs.getString(3), rs.getString(4),
                                    instant(rs, "occurred_at")));
                }, shipmentIds.toArray());
        return result;
    }

    private Map<UUID, List<ReturnRequestView>> returns(List<UUID> soIds) {
        Map<UUID, List<ReturnRequestView>> result = new HashMap<>();
        if (soIds.isEmpty()) {
            return result;
        }
        List<Object[]> rows = jdbc.query("SELECT rr.id,rr.seller_order_id,so.seller_order_number,so.shop_id,s.name,"
                + "rr.reason_code,rr.description,rr.status,rr.decision_reason,rr.requested_at,rr.decided_at,"
                + "rr.customer_user_id FROM return_requests rr JOIN seller_orders so ON so.id=rr.seller_order_id "
                + "JOIN shops s ON s.id=so.shop_id WHERE rr.seller_order_id IN (" + placeholders(soIds.size())
                + ") ORDER BY rr.requested_at DESC", (rs, i) -> new Object[] {rs.getObject(1, UUID.class),
                        rs.getObject(2, UUID.class), rs.getString(3), rs.getObject(4, UUID.class), rs.getString(5),
                        rs.getString(6), rs.getString(7), rs.getString(8), rs.getString(9), instant(rs, "requested_at"),
                        instant(rs, "decided_at"), rs.getObject(12, UUID.class)}, soIds.toArray());
        List<UUID> ids = rows.stream().map(r -> (UUID) r[0]).toList();
        Map<UUID, List<ReturnItemView>> items = returnItems(ids);
        Map<UUID, List<UUID>> media = returnMedia(ids);
        Map<UUID, List<RefundView>> refunds = new HashMap<>();
        jdbc.query("SELECT id,seller_order_id,currency_code::text,amount_minor,status,reason,created_at "
                + "FROM marketplace_refunds WHERE seller_order_id IN (" + placeholders(soIds.size()) + ")",
                rs -> {
                    refunds.computeIfAbsent(rs.getObject(2, UUID.class), k -> new ArrayList<>())
                            .add(new RefundView(rs.getObject(1, UUID.class),
                                    Money.of(rs.getLong(4), rs.getString(3).trim()), rs.getString(5), rs.getString(6),
                                    instant(rs, "created_at")));
                }, soIds.toArray());
        Map<UUID, String> names = support.displayNames(rows.stream().map(r -> (UUID) r[11]).toList());
        for (Object[] r : rows) {
            UUID id = (UUID) r[0];
            result.computeIfAbsent((UUID) r[1], k -> new ArrayList<>()).add(new ReturnRequestView(id, (UUID) r[1],
                    (String) r[2], (UUID) r[3], (String) r[4], (String) r[5], (String) r[6], (String) r[7], (String) r[8],
                    (java.time.Instant) r[9], (java.time.Instant) r[10], items.getOrDefault(id, List.of()),
                    media.getOrDefault(id, List.of()), refunds.getOrDefault(r[1], List.of()),
                    names.getOrDefault((UUID) r[11], "Customer")));
        }
        return result;
    }

    private Map<UUID, List<ReturnItemView>> returnItems(List<UUID> returnIds) {
        Map<UUID, List<ReturnItemView>> result = new HashMap<>();
        if (returnIds.isEmpty()) {
            return result;
        }
        jdbc.query("SELECT ri.return_request_id,ri.order_item_id,oi.product_name_snapshot,ri.quantity,"
                + "ri.requested_resolution,ri.reason_code FROM return_request_items ri JOIN order_items oi "
                + "ON oi.id=ri.order_item_id WHERE ri.return_request_id IN (" + placeholders(returnIds.size()) + ")",
                rs -> {
                    result.computeIfAbsent(rs.getObject(1, UUID.class), k -> new ArrayList<>())
                            .add(new ReturnItemView(rs.getObject(2, UUID.class), rs.getString(3), rs.getInt(4),
                                    rs.getString(5), rs.getString(6)));
                }, returnIds.toArray());
        return result;
    }

    private Map<UUID, List<UUID>> returnMedia(List<UUID> returnIds) {
        Map<UUID, List<UUID>> result = new HashMap<>();
        if (returnIds.isEmpty()) {
            return result;
        }
        jdbc.query("SELECT return_request_id,media_id FROM return_request_media WHERE return_request_id IN ("
                + placeholders(returnIds.size()) + ")", rs -> {
                    result.computeIfAbsent(rs.getObject(1, UUID.class), k -> new ArrayList<>())
                            .add(rs.getObject(2, UUID.class));
                }, returnIds.toArray());
        return result;
    }

    private Map<UUID, List<RefundView>> refunds(List<UUID> soIds) {
        Map<UUID, List<RefundView>> result = new HashMap<>();
        if (soIds.isEmpty()) {
            return result;
        }
        jdbc.query("SELECT id,seller_order_id,currency_code::text,amount_minor,status,reason,created_at "
                + "FROM marketplace_refunds WHERE seller_order_id IN (" + placeholders(soIds.size())
                + ") ORDER BY created_at DESC", rs -> {
                    result.computeIfAbsent(rs.getObject(2, UUID.class), k -> new ArrayList<>())
                            .add(new RefundView(rs.getObject(1, UUID.class),
                                    Money.of(rs.getLong(4), rs.getString(3).trim()), rs.getString(5), rs.getString(6),
                                    instant(rs, "created_at")));
                }, soIds.toArray());
        return result;
    }

    // ------------------------------------------------------------------ cancel

    @Transactional
    public void cancelOrder(UUID actor, UUID orderId) {
        Object[] o = jdbc.query("SELECT customer_user_id,status FROM orders WHERE id=? FOR UPDATE",
                rs -> rs.next() ? new Object[] {rs.getObject(1, UUID.class), rs.getString(2)} : null, orderId);
        if (o == null || !actor.equals(o[0])) {
            throw notFound("ORDER_NOT_FOUND");
        }
        if (!"PAYMENT_PENDING".equals(o[1])) {
            throw conflict("ORDER_NOT_CANCELLABLE");
        }
        UUID paymentId = jdbc.query("SELECT id FROM marketplace_payments WHERE order_id=? ORDER BY created_at DESC "
                + "LIMIT 1", rs -> rs.next() ? rs.getObject(1, UUID.class) : null, orderId);
        if (paymentId != null) {
            String providerId = jdbc.queryForObject("SELECT provider_payment_intent_id FROM marketplace_payments "
                    + "WHERE id=?", String.class, paymentId);
            if (payments.provider() != null && providerId != null) {
                payments.provider().expireHostedCheckout(providerId);
            }
            lifecycle.finalizeFailed(paymentId, "CUSTOMER_CANCELLED", null);
        }
        jdbc.update("UPDATE orders SET status='CANCELLED',updated_at=now() WHERE id=?", orderId);
        jdbc.update("INSERT INTO order_status_history(order_id,from_status,to_status,actor_user_id) "
                + "VALUES(?,'PAYMENT_PENDING','CANCELLED',?)", orderId, actor);
    }

    // ------------------------------------------------------------------ returns

    public record ReturnItemInput(UUID orderItemId, int quantity, String resolution) {
    }

    @Transactional
    public ReturnRequestView requestReturn(UUID actor, UUID sellerOrderId, String reasonCode, String description,
            List<ReturnItemInput> items, List<UUID> mediaIds) {
        Object[] so = jdbc.query("SELECT so.status,o.customer_user_id FROM seller_orders so JOIN orders o "
                + "ON o.id=so.order_id WHERE so.id=? FOR UPDATE", rs -> rs.next() ? new Object[] {rs.getString(1),
                        rs.getObject(2, UUID.class)} : null, sellerOrderId);
        if (so == null || !actor.equals(so[1])) {
            throw notFound("SELLER_ORDER_NOT_FOUND");
        }
        if (!List.of("DELIVERED", "PARTIALLY_RETURNED", "DISPATCHED", "PARTIALLY_REFUNDED").contains(so[0])) {
            throw conflict("RETURN_NOT_ELIGIBLE");
        }
        if (trim(reasonCode) == null || reasonCode.length() > 60) {
            throw badRequest("RETURN_REASON_REQUIRED");
        }
        if (items == null || items.isEmpty()) {
            throw badRequest("RETURN_ITEMS_REQUIRED");
        }
        UUID returnId = UUID.randomUUID();
        jdbc.update("INSERT INTO return_requests(id,seller_order_id,customer_user_id,reason_code,description) "
                + "VALUES(?,?,?,?,?)", returnId, sellerOrderId, actor, reasonCode.trim().toUpperCase(),
                trim(description));
        for (ReturnItemInput item : items) {
            if (item.quantity() < 1) {
                throw badRequest("RETURN_QUANTITY_INVALID");
            }
            String resolution = item.resolution() == null ? "REFUND" : item.resolution().toUpperCase();
            if (!List.of("REFUND", "REPLACEMENT", "EXCHANGE").contains(resolution)) {
                throw badRequest("RETURN_RESOLUTION_INVALID");
            }
            Integer returnable = jdbc.query("SELECT oi.quantity-COALESCE((SELECT sum(ri.quantity) FROM "
                    + "return_request_items ri JOIN return_requests rr ON rr.id=ri.return_request_id "
                    + "WHERE ri.order_item_id=oi.id AND rr.status NOT IN ('REJECTED','CLOSED')),0) FROM order_items oi "
                    + "WHERE oi.id=? AND oi.seller_order_id=?", rs -> rs.next() ? rs.getInt(1) : null,
                    item.orderItemId(), sellerOrderId);
            if (returnable == null) {
                throw notFound("ORDER_ITEM_NOT_FOUND");
            }
            if (item.quantity() > returnable) {
                throw conflict("RETURN_QUANTITY_EXCEEDS_AVAILABLE");
            }
            jdbc.update("INSERT INTO return_request_items(return_request_id,order_item_id,quantity,requested_resolution) "
                    + "VALUES(?,?,?,?)", returnId, item.orderItemId(), item.quantity(), resolution);
        }
        for (UUID mediaId : mediaIds == null ? List.<UUID>of() : mediaIds.stream().distinct().limit(5).toList()) {
            support.requireMedia(mediaId, actor, "OTHER");
            jdbc.update("INSERT INTO return_request_media(return_request_id,media_id) VALUES(?,?)", returnId, mediaId);
        }
        jdbc.update("UPDATE seller_orders SET status='RETURN_REQUESTED',updated_at=now() WHERE id=? AND status IN "
                + "('DELIVERED','PARTIALLY_RETURNED','DISPATCHED','PARTIALLY_REFUNDED')", sellerOrderId);
        jdbc.update("INSERT INTO return_status_history(return_request_id,to_status,actor_user_id) "
                + "VALUES(?,'REQUESTED',?)", returnId, actor);
        jdbc.update("INSERT INTO seller_order_status_history(seller_order_id,to_status,reason,actor_user_id) "
                + "VALUES(?,'RETURN_REQUESTED','Customer return request',?)", sellerOrderId, actor);
        UUID sellerId = jdbc.queryForObject("SELECT seller_id FROM seller_orders WHERE id=?", UUID.class, sellerOrderId);
        for (UUID recipient : policy.sellerRecipients(sellerId)) {
            support.notify(recipient, "MARKETPLACE_RETURN_UPDATE", "Return requested",
                    "A customer requested a return.", "SHOP_ORDER", sellerOrderId,
                    "return-requested:" + returnId + ":" + recipient);
        }
        lifecycle.refreshParentStatus(jdbc.queryForObject("SELECT order_id FROM seller_orders WHERE id=?", UUID.class,
                sellerOrderId));
        return returns(List.of(sellerOrderId)).getOrDefault(sellerOrderId, List.of()).stream()
                .filter(r -> r.id().equals(returnId)).findFirst().orElseThrow();
    }

    // ------------------------------------------------------------------ reviews

    @Transactional
    public Review reviewProduct(UUID actor, UUID orderItemId, int rating, String text, List<UUID> mediaIds) {
        if (rating < 1 || rating > 5 || (text != null && text.length() > 5000)) {
            throw badRequest("INVALID_REVIEW");
        }
        Object[] item = jdbc.query("SELECT oi.product_id,oi.seller_order_id,o.customer_user_id,so.status FROM order_items oi "
                + "JOIN seller_orders so ON so.id=oi.seller_order_id JOIN orders o ON o.id=so.order_id WHERE oi.id=?",
                rs -> rs.next() ? new Object[] {rs.getObject(1, UUID.class), rs.getObject(2, UUID.class),
                        rs.getObject(3, UUID.class), rs.getString(4)} : null, orderItemId);
        if (item == null || !actor.equals(item[2])) {
            throw notFound("ORDER_ITEM_NOT_FOUND");
        }
        if (!List.of("DELIVERED", "PARTIALLY_RETURNED", "RETURNED", "PARTIALLY_REFUNDED", "REFUNDED").contains(item[3])) {
            throw conflict("REVIEW_REQUIRES_DELIVERY");
        }
        UUID id = UUID.randomUUID();
        try {
            jdbc.update("INSERT INTO product_reviews(id,product_id,order_item_id,reviewer_user_id,rating,review_text,status) "
                    + "VALUES(?,?,?,?,?,?,?)", id, item[0], orderItemId, actor, rating, trim(text),
                    properties.reviewsAutoPublish() ? "PUBLISHED" : "PENDING_REVIEW");
        } catch (org.springframework.dao.DuplicateKeyException e) {
            throw conflict("REVIEW_ALREADY_SUBMITTED");
        }
        for (UUID mediaId : mediaIds == null ? List.<UUID>of() : mediaIds.stream().distinct().limit(5).toList()) {
            support.requireMedia(mediaId, actor, "PRODUCT");
            jdbc.update("INSERT INTO product_review_media(review_id,media_id) VALUES(?,?)", id, mediaId);
        }
        return new Review(id, (UUID) item[0], actor, null, rating, trim(text),
                properties.reviewsAutoPublish() ? "PUBLISHED" : "PENDING_REVIEW", null, null, java.time.Instant.now(),
                null);
    }

    @Transactional
    public Review reviewShop(UUID actor, UUID sellerOrderId, int rating, String text) {
        if (rating < 1 || rating > 5 || (text != null && text.length() > 5000)) {
            throw badRequest("INVALID_REVIEW");
        }
        Object[] so = jdbc.query("SELECT so.shop_id,so.status,o.customer_user_id FROM seller_orders so JOIN orders o "
                + "ON o.id=so.order_id WHERE so.id=?", rs -> rs.next() ? new Object[] {rs.getObject(1, UUID.class),
                        rs.getString(2), rs.getObject(3, UUID.class)} : null, sellerOrderId);
        if (so == null || !actor.equals(so[2])) {
            throw notFound("SELLER_ORDER_NOT_FOUND");
        }
        if (!List.of("DELIVERED", "PARTIALLY_RETURNED", "RETURNED", "PARTIALLY_REFUNDED", "REFUNDED").contains(so[1])) {
            throw conflict("REVIEW_REQUIRES_DELIVERY");
        }
        UUID id = UUID.randomUUID();
        try {
            jdbc.update("INSERT INTO shop_reviews(id,shop_id,seller_order_id,reviewer_user_id,rating,review_text,status) "
                    + "VALUES(?,?,?,?,?,?,?)", id, so[0], sellerOrderId, actor, rating, trim(text),
                    properties.reviewsAutoPublish() ? "PUBLISHED" : "PENDING_REVIEW");
        } catch (org.springframework.dao.DuplicateKeyException e) {
            throw conflict("REVIEW_ALREADY_SUBMITTED");
        }
        return new Review(id, (UUID) so[0], actor, null, rating, trim(text),
                properties.reviewsAutoPublish() ? "PUBLISHED" : "PENDING_REVIEW", null, null,
                java.time.Instant.now(), null);
    }
}
