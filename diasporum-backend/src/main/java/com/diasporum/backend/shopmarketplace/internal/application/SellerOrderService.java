package com.diasporum.backend.shopmarketplace.internal.application;

import static com.diasporum.backend.shopmarketplace.internal.application.SellerAccessPolicy.CATALOG_EDIT;
import static com.diasporum.backend.shopmarketplace.internal.application.SellerAccessPolicy.FINANCE;
import static com.diasporum.backend.shopmarketplace.internal.application.SellerAccessPolicy.ORDERS;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.badRequest;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.conflict;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.instant;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.notFound;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.placeholders;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.trim;

import com.diasporum.backend.shopmarketplace.internal.application.SellerAccessPolicy.Access;
import com.diasporum.backend.shopmarketplace.internal.application.ShippingProvider.Parcel;
import com.diasporum.backend.shopmarketplace.internal.application.ShippingProvider.PurchasedLabel;
import com.diasporum.backend.shopmarketplace.internal.application.ShippingProvider.ShipAddress;
import com.diasporum.backend.shopmarketplace.internal.application.ShippingProvider.TrackingUpdate;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Money;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.OrderAddress;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.OrderItemView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.PackageInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Page;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.RateView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ReturnRequestView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Review;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerOrderDetail;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerOrderSummary;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Shipment;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShipmentInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShipmentLineInput;
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
 * Seller-side fulfilment: sellers only ever see their own seller orders. Shipments support
 * multiple parcels, provider-bought labels (Shippo) and seller-managed external tracking.
 * Manual tracking is never presented as a provider label.
 */
@Service
public class SellerOrderService {
    private static final Set<String> FILTERS = Set.of("ALL", "PLACED", "ACCEPTED", "PROCESSING",
            "PARTIALLY_DISPATCHED", "DISPATCHED", "DELIVERED", "CANCEL_REQUESTED", "CANCELLED",
            "RETURN_REQUESTED", "PARTIALLY_RETURNED", "RETURNED", "PARTIALLY_REFUNDED", "REFUNDED");

    private final JdbcTemplate jdbc;
    private final ShopSupport support;
    private final SellerAccessPolicy policy;
    private final OrderService orders;
    private final OrderLifecycleService lifecycle;
    private final ShippingQuoteService quotes;
    private final List<ShippingProvider> providers;
    private final ShopProperties properties;

    public SellerOrderService(ShopSupport support, SellerAccessPolicy policy, OrderService orders,
            OrderLifecycleService lifecycle, ShippingQuoteService quotes, List<ShippingProvider> providers,
            ShopProperties properties) {
        this.jdbc = support.jdbc();
        this.support = support;
        this.policy = policy;
        this.orders = orders;
        this.lifecycle = lifecycle;
        this.quotes = quotes;
        this.providers = providers;
        this.properties = properties;
    }

    // ------------------------------------------------------------------ list / detail

    public Page<SellerOrderSummary> list(UUID actor, UUID shopId, String filter, String cursor, Integer size) {
        policy.requireShop(actor, shopId, ORDERS);
        String f = filter == null ? "ALL" : filter.toUpperCase();
        if (!FILTERS.contains(f)) {
            throw badRequest("INVALID_ORDER_FILTER");
        }
        int limit = ShopSupport.pageSize(size);
        List<Object> args = new ArrayList<>(List.of(shopId));
        StringBuilder sql = new StringBuilder("SELECT so.id,so.seller_order_number,so.status,so.currency_code::text,"
                + "so.subtotal_amount_minor,so.subtotal_amount_minor+so.shipping_amount_minor-so.discount_amount_minor"
                + "+so.tax_amount_minor AS total,so.created_at,o.customer_user_id,"
                + "(SELECT COALESCE(sum(oi.quantity),0) FROM order_items oi WHERE oi.seller_order_id=so.id) AS item_count "
                + "FROM seller_orders so JOIN orders o ON o.id=so.order_id WHERE so.shop_id=?");
        if (!"ALL".equals(f)) {
            sql.append(" AND so.status=?");
            args.add(f);
        }
        String[] c = ShopSupport.decodeCursor(cursor, "CREATED");
        if (c != null) {
            sql.append(" AND (so.created_at,so.id)<(?::timestamptz,?)");
            args.add(c[1]);
            args.add(UUID.fromString(c[2]));
        }
        sql.append(" ORDER BY so.created_at DESC,so.id DESC LIMIT ?");
        args.add(limit + 1);
        List<Object[]> raw = jdbc.query(sql.toString(), (rs, i) -> new Object[] {rs.getObject(1, UUID.class),
                rs.getString(2), rs.getString(3), rs.getString(4).trim(), rs.getLong(5), rs.getLong(6),
                instant(rs, "created_at"), rs.getObject(8, UUID.class), rs.getInt(9)}, args.toArray());
        String next = null;
        List<Object[]> page = raw;
        if (raw.size() > limit) {
            page = new ArrayList<>(raw.subList(0, limit));
            next = ShopSupport.cursor("CREATED", ((java.time.Instant) page.getLast()[6]).toString(), (UUID) page.getLast()[0]);
        }
        Map<UUID, String> names = support.displayNames(page.stream().map(r -> (UUID) r[7]).toList());
        return new Page<>(page.stream().map(r -> new SellerOrderSummary((UUID) r[0], (String) r[1], (String) r[2],
                Money.of((Long) r[4], (String) r[3]), Money.of((Long) r[5], (String) r[3]), (Integer) r[8],
                names.getOrDefault((UUID) r[7], "Customer"), (java.time.Instant) r[6])).toList(), next);
    }

    public SellerOrderDetail detail(UUID actor, UUID shopId, UUID sellerOrderId) {
        Access access = policy.requireShop(actor, shopId, null);
        Object[] so = jdbc.query("SELECT so.order_id,so.status,so.currency_code::text,so.subtotal_amount_minor,"
                + "so.shipping_amount_minor,so.discount_amount_minor,so.tax_amount_minor,so.commission_amount_minor,"
                + "so.seller_net_amount_minor,so.seller_order_number,so.created_at,o.customer_user_id FROM seller_orders so "
                + "JOIN orders o ON o.id=so.order_id WHERE so.id=? AND so.shop_id=?",
                rs -> rs.next() ? new Object[] {rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3).trim(),
                        rs.getLong(4), rs.getLong(5), rs.getLong(6), rs.getLong(7), rs.getLong(8), rs.getLong(9),
                        rs.getString(10), instant(rs, "created_at"), rs.getObject(12, UUID.class)} : null,
                sellerOrderId, shopId);
        if (so == null) {
            throw notFound("SELLER_ORDER_NOT_FOUND");
        }
        boolean finance = access.has(FINANCE);
        String currency = (String) so[2];
        List<OrderItemView> items = orders.sellerOrders(actor, (UUID) so[0], currency, true).stream()
                .filter(v -> v.id().equals(sellerOrderId)).flatMap(v -> v.items().stream()).toList();
        OrderAddress address = jdbc.query("SELECT recipient_name,address_line_1,address_line_2,city,region,postal_code,"
                + "country_code,phone_e164 FROM order_addresses WHERE seller_order_id=? AND address_type='SHIPPING' "
                + "LIMIT 1", (rs, i) -> new OrderAddress(rs.getString(1), rs.getString(2), rs.getString(3),
                        rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7), rs.getString(8)),
                sellerOrderId).stream().findFirst().orElse(null);
        List<Shipment> shipments = orders.shipments(List.of(sellerOrderId)).getOrDefault(sellerOrderId, List.of());
        List<ReturnRequestView> returns = returnsOf(sellerOrderId);
        String shipName = jdbc.query("SELECT ci.attributes_snapshot->>'shipName' FROM checkout_items ci "
                + "WHERE ci.attributes_snapshot->>'sellerOrderId'=? LIMIT 1", rs -> rs.next() ? rs.getString(1) : null,
                sellerOrderId.toString());
        List<String> actions = new ArrayList<>();
        String status = (String) so[1];
        if ("PLACED".equals(status)) {
            actions.add("ACCEPT");
            actions.add("CANCEL");
        }
        if (Set.of("PLACED", "ACCEPTED", "PROCESSING", "PARTIALLY_DISPATCHED").contains(status)) {
            actions.add("CREATE_SHIPMENT");
        }
        if (Set.of("DELIVERED", "RETURN_REQUESTED", "PARTIALLY_RETURNED").contains(status)) {
            actions.add("HANDLE_RETURNS");
        }
        return new SellerOrderDetail(sellerOrderId, (UUID) so[0], (String) so[9], status, items,
                Money.of((Long) so[3], currency), Money.of((Long) so[5], currency), Money.of((Long) so[4], currency),
                Money.of((Long) so[6], currency), finance ? Money.of((Long) so[7], currency) : null,
                finance ? Money.of((Long) so[8], currency) : null, finance, shipName, address,
                support.displayNames(List.of((UUID) so[11])).getOrDefault((UUID) so[11], "Customer"), (UUID) so[11],
                shipments, returns, actions, (java.time.Instant) so[10]);
    }

    private List<ReturnRequestView> returnsOf(UUID sellerOrderId) {
        return orders.sellerOrders(jdbc.queryForObject("SELECT customer_user_id FROM orders o JOIN seller_orders so "
                + "ON so.order_id=o.id WHERE so.id=?", UUID.class, sellerOrderId),
                jdbc.queryForObject("SELECT order_id FROM seller_orders WHERE id=?", UUID.class, sellerOrderId),
                jdbc.queryForObject("SELECT currency_code::text FROM seller_orders WHERE id=?", String.class,
                        sellerOrderId).trim(), true)
                .stream().filter(v -> v.id().equals(sellerOrderId)).flatMap(v -> v.returns().stream()).toList();
    }

    // ------------------------------------------------------------------ actions

    @Transactional
    public SellerOrderDetail accept(UUID actor, UUID shopId, UUID sellerOrderId) {
        policy.requireShop(actor, shopId, ORDERS);
        if (jdbc.update("UPDATE seller_orders SET status='ACCEPTED',accepted_at=now(),updated_at=now() WHERE id=? "
                + "AND shop_id=? AND status='PLACED'", sellerOrderId, shopId) == 0) {
            throw conflict("SELLER_ORDER_NOT_ACCEPTABLE");
        }
        jdbc.update("INSERT INTO seller_order_status_history(seller_order_id,from_status,to_status,actor_user_id) "
                + "VALUES(?,'PLACED','ACCEPTED',?)", sellerOrderId, actor);
        return detail(actor, shopId, sellerOrderId);
    }

    @Transactional
    public SellerOrderDetail markProcessing(UUID actor, UUID shopId, UUID sellerOrderId) {
        policy.requireShop(actor, shopId, ORDERS);
        if (jdbc.update("UPDATE seller_orders SET status='PROCESSING',updated_at=now() WHERE id=? AND shop_id=? "
                + "AND status='ACCEPTED'", sellerOrderId, shopId) == 0) {
            throw conflict("SELLER_ORDER_NOT_PROCESSABLE");
        }
        jdbc.update("INSERT INTO seller_order_status_history(seller_order_id,from_status,to_status,actor_user_id) "
                + "VALUES(?,'ACCEPTED','PROCESSING',?)", sellerOrderId, actor);
        return detail(actor, shopId, sellerOrderId);
    }

    /** Seller-cancel only before anything shipped; fully refunds the seller order. */
    @Transactional
    public SellerOrderDetail cancel(UUID actor, UUID shopId, UUID sellerOrderId, String reason) {
        policy.requireShop(actor, shopId, ORDERS);
        Object[] so = jdbc.query("SELECT status,currency_code::text,subtotal_amount_minor+shipping_amount_minor"
                + "-discount_amount_minor+tax_amount_minor FROM seller_orders WHERE id=? AND shop_id=? FOR UPDATE",
                rs -> rs.next() ? new Object[] {rs.getString(1), rs.getString(2).trim(), rs.getLong(3)} : null,
                sellerOrderId, shopId);
        if (so == null) {
            throw notFound("SELLER_ORDER_NOT_FOUND");
        }
        boolean shipped = jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM shipments WHERE seller_order_id=? "
                + "AND status NOT IN ('CANCELLED','FAILED'))", Boolean.class, sellerOrderId);
        if (shipped || !Set.of("PLACED", "ACCEPTED", "PROCESSING").contains(so[0])) {
            throw conflict("SELLER_ORDER_NOT_CANCELLABLE");
        }
        lifecycle.refundSellerOrder(sellerOrderId, (Long) so[2],
                "SELLER_CANCELLED" + (trim(reason) == null ? "" : ":" + reason.trim()), actor);
        jdbc.update("UPDATE seller_orders SET status='CANCELLED',updated_at=now() WHERE id=?", sellerOrderId);
        jdbc.update("INSERT INTO seller_order_status_history(seller_order_id,to_status,reason,actor_user_id) "
                + "VALUES(?,'CANCELLED',?,?)", sellerOrderId, trim(reason), actor);
        lifecycle.refreshParentStatus(jdbc.queryForObject("SELECT order_id FROM seller_orders WHERE id=?", UUID.class,
                sellerOrderId));
        return detail(actor, shopId, sellerOrderId);
    }

    // ------------------------------------------------------------------ shipments

    private Object[] shippable(UUID actor, UUID shopId, UUID sellerOrderId) {
        policy.requireShop(actor, shopId, ORDERS);
        Object[] so = jdbc.query("SELECT so.status,so.order_id,so.currency_code::text FROM seller_orders so "
                + "WHERE so.id=? AND so.shop_id=? FOR UPDATE", rs -> rs.next() ? new Object[] {rs.getString(1),
                        rs.getObject(2, UUID.class), rs.getString(3).trim()} : null, sellerOrderId, shopId);
        if (so == null) {
            throw notFound("SELLER_ORDER_NOT_FOUND");
        }
        if (!Set.of("PLACED", "ACCEPTED", "PROCESSING", "PARTIALLY_DISPATCHED").contains(so[0])) {
            throw conflict("SELLER_ORDER_NOT_SHIPPABLE");
        }
        return so;
    }

    @Transactional
    public Shipment createShipment(UUID actor, UUID shopId, UUID sellerOrderId, ShipmentInput in) {
        Object[] so = shippable(actor, shopId, sellerOrderId);
        String mode = in == null || in.mode() == null ? "EXTERNAL" : in.mode().toUpperCase();
        if (!Set.of("EXTERNAL", "SHIPPO").contains(mode)) {
            throw badRequest("INVALID_SHIPMENT_MODE");
        }
        if (in.items() == null || in.items().isEmpty()) {
            throw badRequest("SHIPMENT_ITEMS_REQUIRED");
        }
        Map<UUID, Integer> shipped = new HashMap<>();
        for (ShipmentLineInput line : in.items()) {
            if (line.quantity() < 1) {
                throw badRequest("SHIPMENT_QUANTITY_INVALID");
            }
            Integer remaining = jdbc.query("SELECT oi.quantity-COALESCE((SELECT sum(si.quantity) FROM shipment_items si "
                    + "JOIN shipments sh ON sh.id=si.shipment_id WHERE si.order_item_id=oi.id "
                    + "AND sh.status<>'CANCELLED'),0) FROM order_items oi WHERE oi.id=? AND oi.seller_order_id=?",
                    rs -> rs.next() ? rs.getInt(1) : null, line.orderItemId(), sellerOrderId);
            if (remaining == null) {
                throw notFound("ORDER_ITEM_NOT_FOUND");
            }
            if (line.quantity() > remaining) {
                throw conflict("SHIPMENT_EXCEEDS_UNSHIPPED");
            }
            shipped.merge(line.orderItemId(), line.quantity(), Integer::sum);
        }
        List<PackageInput> packages = in.packages() == null || in.packages().isEmpty()
                ? List.of(new PackageInput(500, 200, 200, 100)) : in.packages();
        for (PackageInput p : packages) {
            if (p.weightGrams() <= 0 || p.lengthMm() <= 0 || p.widthMm() <= 0 || p.heightMm() <= 0) {
                throw badRequest("PACKAGE_DIMENSIONS_INVALID");
            }
        }
        if ("EXTERNAL".equals(mode) && trim(in.carrierName()) == null) {
            throw badRequest("CARRIER_NAME_REQUIRED");
        }
        UUID locationId = in.inventoryLocationId();
        if (locationId != null && !Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM "
                + "inventory_locations WHERE id=? AND shop_id=? AND status='ACTIVE')", Boolean.class, locationId, shopId))) {
            throw badRequest("INVALID_DISPATCH_LOCATION");
        }
        UUID shipmentId = UUID.randomUUID();
        jdbc.update("INSERT INTO shipments(id,seller_order_id,inventory_location_id,shipment_type,provider_key,"
                + "carrier_name,service_name,tracking_number,tracking_url,status) VALUES(?,?,?,'OUTBOUND',?,?,?,?,?,?)",
                shipmentId, sellerOrderId, locationId, "SHIPPO".equals(mode) ? "SHIPPO" : "MANUAL",
                trim(in.carrierName()), trim(in.serviceName()), trim(in.trackingNumber()), trim(in.trackingUrl()),
                "SHIPPO".equals(mode) ? "LABEL_PENDING"
                        : trim(in.trackingNumber()) == null ? "READY_TO_DISPATCH" : "READY_TO_DISPATCH");
        int number = 1;
        for (PackageInput p : packages) {
            jdbc.update("INSERT INTO shipment_packages(shipment_id,package_number,weight_grams,length_mm,width_mm,"
                    + "height_mm) VALUES(?,?,?,?,?,?)", shipmentId, number++, p.weightGrams(), p.lengthMm(),
                    p.widthMm(), p.heightMm());
        }
        for (Map.Entry<UUID, Integer> e : shipped.entrySet()) {
            jdbc.update("INSERT INTO shipment_items(shipment_id,order_item_id,quantity) VALUES(?,?,?)", shipmentId,
                    e.getKey(), e.getValue());
        }
        refreshDispatchState(sellerOrderId);
        return orders.shipments(List.of(sellerOrderId)).getOrDefault(sellerOrderId, List.of()).stream()
                .filter(s -> s.id().equals(shipmentId)).findFirst().orElseThrow();
    }

    /** Shippo rates for a LABEL_PENDING shipment — the provider is backend-only. */
    public List<RateView> labelRates(UUID actor, UUID shopId, UUID sellerOrderId, UUID shipmentId) {
        policy.requireShop(actor, shopId, ORDERS);
        Object[] shipment = jdbc.query("SELECT provider_key,status FROM shipments WHERE id=? AND seller_order_id=?",
                rs -> rs.next() ? new Object[] {rs.getString(1), rs.getString(2)} : null, shipmentId, sellerOrderId);
        if (shipment == null || !"SHIPPO".equals(shipment[0]) || !"LABEL_PENDING".equals(shipment[1])) {
            throw conflict("SHIPMENT_NOT_LABELABLE");
        }
        ShippingProvider shippo = quotes.provider("SHIPPO");
        if (shippo == null || !shippo.available()) {
            throw conflict("SHIPPING_PROVIDER_UNAVAILABLE");
        }
        ShipAddress[] addresses = addresses(sellerOrderId, shopId);
        List<Parcel> parcels = jdbc.query("SELECT weight_grams,length_mm,width_mm,height_mm FROM shipment_packages "
                + "WHERE shipment_id=? ORDER BY package_number", (rs, i) -> new Parcel(rs.getInt(1), rs.getInt(2),
                        rs.getInt(3), rs.getInt(4)), shipmentId);
        return shippo.rates(addresses[0], addresses[1], parcels).stream()
                .map(r -> new RateView(r.rateId(), "SHIPPO", r.carrier(), r.serviceName(),
                        Money.of(r.amountMinor(), r.currency().toUpperCase()), r.estimatedDays())).toList();
    }

    private ShipAddress[] addresses(UUID sellerOrderId, UUID shopId) {
        OrderAddress to = jdbc.query("SELECT recipient_name,address_line_1,address_line_2,city,region,postal_code,"
                + "country_code,phone_e164 FROM order_addresses WHERE seller_order_id=? AND address_type='SHIPPING' "
                + "LIMIT 1", (rs, i) -> new OrderAddress(rs.getString(1), rs.getString(2), rs.getString(3),
                        rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7), rs.getString(8)),
                sellerOrderId).stream().findFirst().orElse(null);
        if (to == null) {
            throw conflict("SHIPPING_ADDRESS_MISSING");
        }
        com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.AddressView from = jdbc.query(
                "SELECT " + ShopSupport.ADDRESS_COLS + " FROM shop_shipping_profiles sp JOIN addresses a "
                        + "ON a.id=sp.origin_address_id JOIN countries c ON c.id=a.country_id WHERE sp.shop_id=? "
                        + "AND sp.status='ACTIVE' ORDER BY sp.is_default DESC,sp.created_at LIMIT 1",
                (rs, i) -> ShopSupport.address(rs), shopId).stream().findFirst()
                .orElseThrow(() -> conflict("SHOP_SHIPPING_PROFILE_REQUIRED"));
        String shopName = jdbc.queryForObject("SELECT name FROM shops WHERE id=?", String.class, shopId);
        return new ShipAddress[] {
                new ShipAddress(shopName, from.line1(), from.line2(), from.city(), from.region(), from.postalCode(),
                        from.countryCode(), null),
                new ShipAddress(to.recipientName(), to.line1(), to.line2(), to.city(), to.region(), to.postalCode(),
                        to.countryCode(), to.phone())};
    }

    /** Purchases the selected provider rate. Idempotent on the shipment — never two labels. */
    @Transactional
    public Shipment buyLabel(UUID actor, UUID shopId, UUID sellerOrderId, UUID shipmentId, String rateId) {
        policy.requireShop(actor, shopId, ORDERS);
        Object[] shipment = jdbc.query("SELECT provider_key,status FROM shipments WHERE id=? AND seller_order_id=? "
                + "FOR UPDATE", rs -> rs.next() ? new Object[] {rs.getString(1), rs.getString(2)} : null,
                shipmentId, sellerOrderId);
        if (shipment == null || !"SHIPPO".equals(shipment[0])) {
            throw notFound("SHIPMENT_NOT_FOUND");
        }
        if (!"LABEL_PENDING".equals(shipment[1])) {
            throw conflict("LABEL_ALREADY_PURCHASED");
        }
        ShippingProvider shippo = quotes.provider("SHIPPO");
        if (shippo == null || !shippo.available()) {
            throw conflict("SHIPPING_PROVIDER_UNAVAILABLE");
        }
        UUID packageId = jdbc.queryForObject("SELECT id FROM shipment_packages WHERE shipment_id=? ORDER BY "
                + "package_number LIMIT 1", UUID.class, shipmentId);
        PurchasedLabel label = shippo.purchaseLabel(rateId, "label-" + shipmentId + "-" + UUID.randomUUID());
        if (!"PURCHASED".equals(label.status())) {
            throw conflict("LABEL_PURCHASE_FAILED:" + (label.failureMessage() == null ? "PROVIDER" : label.failureMessage()));
        }
        jdbc.update("INSERT INTO shipping_labels(shipment_package_id,provider_key,provider_label_id,"
                + "provider_transaction_id,carrier_name,service_name,label_cost_minor,currency_code,status,purchased_at) "
                + "VALUES(?,'SHIPPO',?,?,?,?,?,?,?,'PURCHASED',now())", packageId, label.providerLabelId(),
                label.providerTransactionId(), label.carrier(), label.serviceName(), label.costMinor(),
                label.currency() == null ? null : label.currency().toUpperCase());
        jdbc.update("UPDATE shipments SET status='LABEL_CREATED',carrier_name=?,service_name=?,tracking_number=?,"
                + "tracking_url=?,updated_at=now() WHERE id=?", label.carrier(), label.serviceName(),
                label.trackingNumber(), label.trackingUrl(), shipmentId);
        return orders.shipments(List.of(sellerOrderId)).getOrDefault(sellerOrderId, List.of()).stream()
                .filter(s -> s.id().equals(shipmentId)).findFirst().orElseThrow();
    }

    /** Fresh label URL on demand; provider URLs are treated as non-permanent. */
    public String labelUrl(UUID actor, UUID shopId, UUID sellerOrderId, UUID shipmentId) {
        policy.requireShop(actor, shopId, ORDERS);
        String transaction = jdbc.query("SELECT l.provider_transaction_id FROM shipping_labels l JOIN shipment_packages p "
                + "ON p.id=l.shipment_package_id WHERE p.shipment_id=? AND l.status='PURCHASED' "
                + "ORDER BY l.purchased_at DESC LIMIT 1", rs -> rs.next() ? rs.getString(1) : null, shipmentId);
        if (transaction == null) {
            throw notFound("LABEL_NOT_FOUND");
        }
        ShippingProvider shippo = quotes.provider("SHIPPO");
        return shippo == null ? null : shippo.labelUrl(transaction);
    }

    @Transactional
    public Shipment voidLabel(UUID actor, UUID shopId, UUID sellerOrderId, UUID shipmentId) {
        policy.requireShop(actor, shopId, ORDERS);
        Object[] label = jdbc.query("SELECT l.id,l.provider_transaction_id FROM shipping_labels l JOIN shipment_packages p "
                + "ON p.id=l.shipment_package_id WHERE p.shipment_id=? AND l.status='PURCHASED' LIMIT 1",
                rs -> rs.next() ? new Object[] {rs.getObject(1, UUID.class), rs.getString(2)} : null, shipmentId);
        if (label == null) {
            throw notFound("LABEL_NOT_FOUND");
        }
        String status = jdbc.queryForObject("SELECT status FROM shipments WHERE id=?", String.class, shipmentId);
        if (!"LABEL_CREATED".equals(status)) {
            throw conflict("LABEL_NOT_VOIDABLE");
        }
        ShippingProvider shippo = quotes.provider("SHIPPO");
        if (shippo == null || !shippo.voidLabel((String) label[1])) {
            throw conflict("LABEL_VOID_FAILED");
        }
        jdbc.update("UPDATE shipping_labels SET status='VOIDED' WHERE id=?", label[0]);
        jdbc.update("UPDATE shipments SET status='LABEL_PENDING',tracking_number=NULL,tracking_url=NULL,updated_at=now() "
                + "WHERE id=?", shipmentId);
        return orders.shipments(List.of(sellerOrderId)).getOrDefault(sellerOrderId, List.of()).stream()
                .filter(s -> s.id().equals(shipmentId)).findFirst().orElseThrow();
    }

    /** Marks a shipment dispatched; derives DISPATCHED/PARTIALLY_DISPATCHED on the seller order. */
    @Transactional
    public SellerOrderDetail dispatch(UUID actor, UUID shopId, UUID sellerOrderId, UUID shipmentId) {
        policy.requireShop(actor, shopId, ORDERS);
        String status = jdbc.query("SELECT status FROM shipments WHERE id=? AND seller_order_id=? FOR UPDATE",
                rs -> rs.next() ? rs.getString(1) : null, shipmentId, sellerOrderId);
        if (status == null) {
            throw notFound("SHIPMENT_NOT_FOUND");
        }
        if (!Set.of("READY_TO_DISPATCH", "LABEL_CREATED", "IN_TRANSIT").contains(status)) {
            throw conflict("SHIPMENT_NOT_DISPATCHABLE");
        }
        jdbc.update("UPDATE shipments SET status='IN_TRANSIT',shipped_at=COALESCE(shipped_at,now()),updated_at=now() "
                + "WHERE id=?", shipmentId);
        jdbc.update("INSERT INTO shipping_tracking_events(shipment_id,provider_key,event_code,description,occurred_at) "
                + "VALUES(?,COALESCE((SELECT provider_key FROM shipments WHERE id=?),'MANUAL'),'DISPATCHED',"
                + "'Shipment dispatched',now()) ON CONFLICT DO NOTHING", shipmentId, shipmentId);
        refreshDispatchState(sellerOrderId);
        lifecycle.refreshParentStatus(jdbc.queryForObject("SELECT order_id FROM seller_orders WHERE id=?", UUID.class,
                sellerOrderId));
        UUID customer = jdbc.queryForObject("SELECT o.customer_user_id FROM orders o JOIN seller_orders so "
                + "ON so.order_id=o.id WHERE so.id=?", UUID.class, sellerOrderId);
        support.notify(customer, "MARKETPLACE_SHIPMENT_UPDATE", "Order shipped",
                "Your order is on its way.", "SHOP_ORDER", sellerOrderId, "dispatched:" + shipmentId);
        return detail(actor, shopId, sellerOrderId);
    }

    private void refreshDispatchState(UUID sellerOrderId) {
        Integer unshipped = jdbc.queryForObject("SELECT COALESCE(sum(oi.quantity),0)-COALESCE((SELECT sum(si.quantity) "
                + "FROM shipment_items si JOIN shipments sh ON sh.id=si.shipment_id WHERE si.order_item_id IN "
                + "(SELECT id FROM order_items WHERE seller_order_id=?) AND sh.status NOT IN ('CANCELLED','FAILED')),0) "
                + "FROM order_items oi WHERE oi.seller_order_id=?", Integer.class, sellerOrderId, sellerOrderId);
        boolean anyShipped = jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM shipments WHERE seller_order_id=? "
                + "AND status IN ('IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED'))", Boolean.class, sellerOrderId);
        String current = jdbc.queryForObject("SELECT status FROM seller_orders WHERE id=?", String.class, sellerOrderId);
        if (!Set.of("PLACED", "ACCEPTED", "PROCESSING", "PARTIALLY_DISPATCHED", "DISPATCHED").contains(current)) {
            return;
        }
        if (unshipped != null && unshipped <= 0) {
            String next = jdbc.queryForObject("SELECT NOT EXISTS(SELECT 1 FROM shipments WHERE seller_order_id=? "
                    + "AND status NOT IN ('DELIVERED','CANCELLED','FAILED','RETURNED_TO_SENDER'))",
                    Boolean.class, sellerOrderId) ? "DELIVERED" : "DISPATCHED";
            jdbc.update("UPDATE seller_orders SET status=?,dispatched_at=COALESCE(dispatched_at,now()),"
                    + "delivered_at=CASE WHEN ?='DELIVERED' THEN now() ELSE delivered_at END,updated_at=now() WHERE id=?",
                    next, next, sellerOrderId);
        } else if (anyShipped) {
            jdbc.update("UPDATE seller_orders SET status='PARTIALLY_DISPATCHED',updated_at=now() WHERE id=?",
                    sellerOrderId);
        }
        jdbc.update("INSERT INTO seller_order_status_history(seller_order_id,from_status,to_status) "
                + "SELECT ?,?,status FROM seller_orders WHERE id=? AND status<>?", sellerOrderId, current,
                sellerOrderId, current);
    }

    /** Seller-recorded tracking event for external/manual shipments. */
    @Transactional
    public Shipment addTrackingEvent(UUID actor, UUID shopId, UUID sellerOrderId, UUID shipmentId, String eventCode,
            String description) {
        policy.requireShop(actor, shopId, ORDERS);
        String provider = jdbc.query("SELECT provider_key,status FROM shipments WHERE id=? AND seller_order_id=?",
                rs -> rs.next() ? rs.getString(1) : null, shipmentId, sellerOrderId);
        if (provider == null) {
            throw notFound("SHIPMENT_NOT_FOUND");
        }
        if ("SHIPPO".equals(provider)) {
            throw conflict("TRACKING_PROVIDER_MANAGED");
        }
        String code = eventCode == null ? "UPDATE" : eventCode.toUpperCase();
        jdbc.update("INSERT INTO shipping_tracking_events(shipment_id,provider_key,provider_event_id,event_code,"
                + "description,occurred_at) VALUES(?,'MANUAL',?,?,?,now())", shipmentId,
                "manual-" + UUID.randomUUID(), code, description == null ? code : description);
        String mapped = switch (code) {
            case "IN_TRANSIT" -> "IN_TRANSIT";
            case "OUT_FOR_DELIVERY" -> "OUT_FOR_DELIVERY";
            case "DELIVERED" -> "DELIVERED";
            case "RETURNED" -> "RETURNED_TO_SENDER";
            case "LOST" -> "LOST";
            default -> null;
        };
        if (mapped != null) {
            jdbc.update("UPDATE shipments SET status=?,delivered_at=CASE WHEN 'DELIVERED'=? THEN now() ELSE delivered_at END,"
                    + "updated_at=now() WHERE id=?", mapped, mapped, shipmentId);
            refreshDispatchState(sellerOrderId);
            lifecycle.refreshParentStatus(jdbc.queryForObject("SELECT order_id FROM seller_orders WHERE id=?",
                    UUID.class, sellerOrderId));
            if ("DELIVERED".equals(mapped)) {
                UUID customer = jdbc.queryForObject("SELECT o.customer_user_id FROM orders o JOIN seller_orders so "
                        + "ON so.order_id=o.id WHERE so.id=?", UUID.class, sellerOrderId);
                support.notify(customer, "MARKETPLACE_SHIPMENT_UPDATE", "Order delivered",
                        "Your order was delivered.", "SHOP_ORDER", sellerOrderId, "delivered:" + shipmentId);
            }
        }
        return orders.shipments(List.of(sellerOrderId)).getOrDefault(sellerOrderId, List.of()).stream()
                .filter(s -> s.id().equals(shipmentId)).findFirst().orElseThrow();
    }

    // ------------------------------------------------------------------ tracking webhook

    /**
     * Applies a verified provider tracking update. Events are deduplicated on
     * (provider_key, provider_event_id); shipment state is derived from the newest status.
     */
    @Transactional
    public void applyTrackingUpdate(TrackingUpdate update) {
        UUID shipmentId = jdbc.query("SELECT id FROM shipments WHERE provider_key='SHIPPO' AND tracking_number=?",
                rs -> rs.next() ? rs.getObject(1, UUID.class) : null, update.trackingNumber());
        if (shipmentId == null) {
            return; // tracking number not ours — ignore, do not error the webhook
        }
        for (ShippingProvider.TrackingEvent e : update.events()) {
            jdbc.update("INSERT INTO shipping_tracking_events(shipment_id,provider_key,provider_event_id,event_code,"
                    + "description,location,occurred_at) VALUES(?,'SHIPPO',?,?,?,?,?) "
                    + "ON CONFLICT(provider_key,provider_event_id) DO NOTHING", shipmentId, e.providerEventId(),
                    e.status(), e.description(), e.location(),
                    e.occurredAt() == null ? java.sql.Timestamp.from(java.time.Instant.now())
                            : java.sql.Timestamp.from(e.occurredAt()));
        }
        String mapped = switch (update.status() == null ? "" : update.status().toUpperCase()) {
            case "TRANSIT" -> "IN_TRANSIT";
            case "DELIVERED" -> "DELIVERED";
            case "OUT_FOR_DELIVERY" -> "OUT_FOR_DELIVERY";
            case "FAILURE", "RETURNED", "RETURNED_TO_SENDER" -> "RETURNED_TO_SENDER";
            case "UNKNOWN" -> null;
            default -> null;
        };
        if (mapped != null) {
            jdbc.update("UPDATE shipments SET status=?,delivered_at=CASE WHEN ?='DELIVERED' THEN COALESCE(delivered_at,now()) "
                    + "ELSE delivered_at END,updated_at=now() WHERE id=? AND status<>'CANCELLED'", mapped, mapped, shipmentId);
            UUID sellerOrderId = jdbc.queryForObject("SELECT seller_order_id FROM shipments WHERE id=?", UUID.class,
                    shipmentId);
            refreshDispatchState(sellerOrderId);
            lifecycle.refreshParentStatus(jdbc.queryForObject("SELECT order_id FROM seller_orders WHERE id=?",
                    UUID.class, sellerOrderId));
            if ("DELIVERED".equals(mapped)) {
                UUID customer = jdbc.queryForObject("SELECT o.customer_user_id FROM orders o JOIN seller_orders so "
                        + "ON so.order_id=o.id WHERE so.id=?", UUID.class, sellerOrderId);
                support.notify(customer, "MARKETPLACE_SHIPMENT_UPDATE", "Order delivered",
                        "Your order was delivered.", "SHOP_ORDER", sellerOrderId, "delivered:" + shipmentId);
            }
        }
    }

    // ------------------------------------------------------------------ returns & reviews

    @Transactional
    public ReturnRequestView decideReturn(UUID actor, UUID shopId, UUID returnId, boolean approve, String decisionReason) {
        policy.requireShop(actor, shopId, ORDERS);
        Object[] r = jdbc.query("SELECT rr.seller_order_id,rr.status FROM return_requests rr JOIN seller_orders so "
                + "ON so.id=rr.seller_order_id WHERE rr.id=? AND so.shop_id=? FOR UPDATE",
                rs -> rs.next() ? new Object[] {rs.getObject(1, UUID.class), rs.getString(2)} : null, returnId, shopId);
        if (r == null) {
            throw notFound("RETURN_NOT_FOUND");
        }
        if (!Set.of("REQUESTED", "UNDER_REVIEW").contains(r[1])) {
            throw conflict("RETURN_ALREADY_DECIDED");
        }
        if (!approve && trim(decisionReason) == null) {
            throw badRequest("DECISION_REASON_REQUIRED");
        }
        String next = approve ? "AWAITING_RETURN" : "REJECTED";
        jdbc.update("UPDATE return_requests SET status=?,decision_reason=?,decided_at=now(),updated_at=now() WHERE id=?",
                next, trim(decisionReason), returnId);
        jdbc.update("INSERT INTO return_status_history(return_request_id,from_status,to_status,actor_user_id) "
                + "VALUES(?,?,?,?)", returnId, r[1], next, actor);
        UUID sellerOrderId = (UUID) r[0];
        if (approve) {
            jdbc.update("UPDATE seller_orders SET status='PARTIALLY_RETURNED',updated_at=now() WHERE id=? "
                    + "AND status IN ('DELIVERED','RETURN_REQUESTED')", sellerOrderId);
        } else {
            boolean open = jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM return_requests WHERE seller_order_id=? "
                    + "AND status IN ('REQUESTED','UNDER_REVIEW','AWAITING_RETURN','RETURN_IN_TRANSIT'))",
                    Boolean.class, sellerOrderId);
            if (!open) {
                jdbc.update("UPDATE seller_orders SET status='DELIVERED',updated_at=now() WHERE id=? "
                        + "AND status='RETURN_REQUESTED'", sellerOrderId);
            }
        }
        UUID customer = jdbc.queryForObject("SELECT customer_user_id FROM return_requests WHERE id=?", UUID.class, returnId);
        support.notify(customer, "MARKETPLACE_RETURN_UPDATE", approve ? "Return approved" : "Return rejected",
                approve ? "Your return was approved." : "Your return was rejected.",
                "SHOP_ORDER", sellerOrderId, "return-decision:" + returnId);
        return returnsOf(sellerOrderId).stream().filter(v -> v.id().equals(returnId)).findFirst().orElseThrow();
    }

    /** Confirms receipt and issues the refund for returned items (REFUND resolution only). */
    @Transactional
    public ReturnRequestView receiveReturn(UUID actor, UUID shopId, UUID returnId, Long refundAmountMinor) {
        policy.requireShop(actor, shopId, ORDERS);
        Object[] r = jdbc.query("SELECT rr.seller_order_id,rr.status FROM return_requests rr JOIN seller_orders so "
                + "ON so.id=rr.seller_order_id WHERE rr.id=? AND so.shop_id=? FOR UPDATE",
                rs -> rs.next() ? new Object[] {rs.getObject(1, UUID.class), rs.getString(2)} : null, returnId, shopId);
        if (r == null) {
            throw notFound("RETURN_NOT_FOUND");
        }
        if (!Set.of("AWAITING_RETURN", "RETURN_IN_TRANSIT", "RECEIVED", "INSPECTED").contains(r[1])) {
            throw conflict("RETURN_NOT_RECEIVABLE");
        }
        UUID sellerOrderId = (UUID) r[0];
        long refund = refundAmountMinor != null ? refundAmountMinor
                : jdbc.queryForObject("SELECT COALESCE(sum(oi.line_total_minor*ri.quantity/oi.quantity),0) FROM "
                        + "return_request_items ri JOIN order_items oi ON oi.id=ri.order_item_id "
                        + "WHERE ri.return_request_id=? AND ri.requested_resolution='REFUND'", Long.class, returnId);
        jdbc.update("UPDATE return_requests SET status='REFUND_PENDING',resolved_at=now(),updated_at=now() WHERE id=?",
                returnId);
        jdbc.update("INSERT INTO return_status_history(return_request_id,from_status,to_status,actor_user_id) "
                + "VALUES(?,?,'REFUND_PENDING',?)", returnId, r[1], actor);
        if (refund > 0) {
            lifecycle.refundSellerOrder(sellerOrderId, refund, "RETURN:" + returnId, actor);
        }
        String outcome = refund > 0 ? "REFUNDED" : "CLOSED";
        jdbc.update("UPDATE return_requests SET status=?,resolved_at=now(),updated_at=now() WHERE id=?", outcome, returnId);
        jdbc.update("INSERT INTO return_status_history(return_request_id,from_status,to_status,actor_user_id) "
                + "VALUES(?,'REFUND_PENDING',?,?)", returnId, outcome, actor);
        boolean open = jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM return_requests WHERE seller_order_id=? "
                + "AND status NOT IN ('REFUNDED','REJECTED','CLOSED'))", Boolean.class, sellerOrderId);
        if (!open) {
            boolean allReturned = jdbc.queryForObject("SELECT NOT EXISTS(SELECT 1 FROM order_items oi WHERE "
                    + "oi.seller_order_id=? AND oi.quantity>(SELECT COALESCE(sum(ri.quantity),0) FROM "
                    + "return_request_items ri JOIN return_requests rr ON rr.id=ri.return_request_id "
                    + "WHERE ri.order_item_id=oi.id AND rr.status NOT IN ('REJECTED','CLOSED')))", Boolean.class,
                    sellerOrderId);
            jdbc.update("UPDATE seller_orders SET status=?,updated_at=now() WHERE id=? AND status IN "
                    + "('PARTIALLY_RETURNED','RETURN_REQUESTED','DELIVERED')", allReturned ? "RETURNED"
                    : "PARTIALLY_RETURNED", sellerOrderId);
        }
        lifecycle.refreshParentStatus(jdbc.queryForObject("SELECT order_id FROM seller_orders WHERE id=?",
                UUID.class, sellerOrderId));
        UUID customer = jdbc.queryForObject("SELECT customer_user_id FROM return_requests WHERE id=?", UUID.class, returnId);
        support.notify(customer, "MARKETPLACE_RETURN_UPDATE", "Return refunded",
                "Your return was received and refunded.", "SHOP_ORDER", sellerOrderId, "return-refunded:" + returnId);
        return returnsOf(sellerOrderId).stream().filter(v -> v.id().equals(returnId)).findFirst().orElseThrow();
    }

    /** Seller response to a published shop review. */
    @Transactional
    public void respondToReview(UUID actor, UUID shopId, UUID reviewId, String response) {
        policy.requireShop(actor, shopId, ORDERS);
        if (trim(response) == null || response.length() > 5000) {
            throw badRequest("INVALID_REVIEW_RESPONSE");
        }
        if (jdbc.update("UPDATE shop_reviews SET seller_response=?,responded_at=now(),updated_at=now() WHERE id=? "
                + "AND shop_id=? AND status='PUBLISHED'", response.trim(), reviewId, shopId) == 0) {
            throw notFound("REVIEW_NOT_FOUND");
        }
    }

    public List<Review> shopReviews(UUID actor, UUID shopId) {
        policy.requireShop(actor, shopId, null);
        return jdbc.query("SELECT r.id,r.shop_id,r.reviewer_user_id,r.rating,r.review_text,r.status,r.seller_response,"
                + "r.responded_at,r.created_at FROM shop_reviews r WHERE r.shop_id=? ORDER BY r.created_at DESC LIMIT 100",
                (rs, i) -> new Review(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class),
                        rs.getObject(3, UUID.class), null, rs.getInt(4), rs.getString(5), rs.getString(6),
                        rs.getString(7), instant(rs, "responded_at"), instant(rs, "created_at"), null), shopId);
    }
}
