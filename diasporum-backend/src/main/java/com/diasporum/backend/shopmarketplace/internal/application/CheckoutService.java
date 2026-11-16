package com.diasporum.backend.shopmarketplace.internal.application;

import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.badRequest;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.conflict;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.notFound;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.trim;

import com.diasporum.backend.shopmarketplace.internal.application.CartService.Line;
import com.diasporum.backend.shopmarketplace.internal.application.PaymentProvider.CheckoutLine;
import com.diasporum.backend.shopmarketplace.internal.application.PaymentProvider.HostedCheckout;
import com.diasporum.backend.shopmarketplace.internal.application.PaymentProvider.HostedCheckoutRequest;
import com.diasporum.backend.shopmarketplace.internal.application.ShippingProvider.Parcel;
import com.diasporum.backend.shopmarketplace.internal.application.ShippingQuoteService.ShipContext;
import com.diasporum.backend.shopmarketplace.internal.application.TaxProvider.LineTax;
import com.diasporum.backend.shopmarketplace.internal.application.TaxProvider.TaxLine;
import com.diasporum.backend.shopmarketplace.internal.application.TaxProvider.TaxResult;
import com.diasporum.backend.shopmarketplace.internal.application.TaxProvider.TaxShipping;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.AddressView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.CheckoutGroup;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.CheckoutQuote;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.CheckoutTotals;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Market;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Money;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.PlacedOrder;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.QuoteRequest;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Checkout quote and placement. Quotes are persisted (checkout_sessions/checkout_items) with
 * immutable prices, tax, shipping choices and the delivery-address snapshot; placement locks
 * the session, revalidates every item and price, creates ACTIVE inventory reservations and
 * splits the cart into one parent order plus one seller order per shop. Orders stay
 * PAYMENT_PENDING until a verified provider event arrives — a tapped button never pays.
 */
@Service
public class CheckoutService {
    private final JdbcTemplate jdbc;
    private final ShopSupport support;
    private final MarketService markets;
    private final CartService carts;
    private final DiscountService discounts;
    private final ShippingQuoteService shipping;
    private final TaxService tax;
    private final CommissionService commission;
    private final ShopProperties properties;
    private final PaymentProvider paymentProvider;
    private final OrderLifecycleService lifecycle;

    public CheckoutService(ShopSupport support, MarketService markets, CartService carts, DiscountService discounts,
            ShippingQuoteService shipping, TaxService tax, CommissionService commission, ShopProperties properties,
            List<PaymentProvider> paymentProviders, OrderLifecycleService lifecycle) {
        this.jdbc = support.jdbc();
        this.support = support;
        this.markets = markets;
        this.carts = carts;
        this.discounts = discounts;
        this.shipping = shipping;
        this.tax = tax;
        this.commission = commission;
        this.properties = properties;
        this.paymentProvider = paymentProviders.stream().filter(PaymentProvider::available).findFirst()
                .orElse(paymentProviders.isEmpty() ? null : paymentProviders.getFirst());
        this.lifecycle = lifecycle;
    }

    // ------------------------------------------------------------------ quote

    @Transactional
    public CheckoutQuote quote(UUID actor, QuoteRequest req) {
        support.requireActive(actor);
        if (req == null || req.marketCountryId() == null || req.shippingAddressId() == null) {
            throw badRequest("CHECKOUT_REQUEST_INCOMPLETE");
        }
        String recipient = trim(req.recipientName());
        if (recipient == null || recipient.length() > 180) {
            throw badRequest("RECIPIENT_NAME_REQUIRED");
        }
        if (req.phone() != null && !req.phone().matches("^\\+[0-9]{6,15}$")) {
            throw badRequest("INVALID_PHONE");
        }
        Market market = markets.requireBrowsable(req.marketCountryId());
        if (!market.buyerCheckoutEnabled()) {
            throw conflict("CHECKOUT_UNAVAILABLE_IN_MARKET");
        }
        if (!market.shippingEnabled()) {
            throw conflict("SHIPPING_UNAVAILABLE_IN_MARKET");
        }
        String currency = markets.currency(market, req.currencyCode());
        UUID cartId = carts.activeCartId(actor, currency);
        if (cartId == null) {
            throw badRequest("CART_EMPTY");
        }
        AddressView address = carts.ownedAddress(actor, req.shippingAddressId());
        if (!address.countryId().equals(market.countryId())) {
            throw badRequest("ADDRESS_MARKET_MISMATCH");
        }
        List<Line> lines = carts.lines(cartId, market.countryId(), currency);
        if (lines.isEmpty()) {
            throw badRequest("CART_EMPTY");
        }
        Map<UUID, List<Line>> byShop = new LinkedHashMap<>();
        lines.forEach(l -> byShop.computeIfAbsent(l.shopId(), k -> new ArrayList<>()).add(l));

        List<String> blocking = new ArrayList<>();
        lines.forEach(l -> {
            if (l.issue() != null) {
                blocking.add(l.issue() + ":" + l.productName());
            }
        });

        // At most one discount code per shop; codes owned by other shops are rejected.
        Map<UUID, String> codeByShop = new LinkedHashMap<>();
        if (req.discountCodes() != null) {
            for (String raw : req.discountCodes()) {
                if (trim(raw) == null) {
                    continue;
                }
                UUID codeShop = jdbc.query("SELECT shop_id FROM discount_codes WHERE code=? AND status='ACTIVE' "
                        + "AND starts_at<=now() AND ends_at>now()", rs -> rs.next() ? rs.getObject(1, UUID.class) : null,
                        raw.trim().toUpperCase());
                if (codeShop == null || !byShop.containsKey(codeShop)) {
                    throw badRequest("DISCOUNT_CODE_INVALID");
                }
                if (codeByShop.put(codeShop, raw) != null) {
                    throw badRequest("ONE_DISCOUNT_CODE_PER_SHOP");
                }
            }
        }

        UUID sessionId = UUID.randomUUID();
        Instant expiresAt = Instant.now().plus(properties.quoteTtl());
        jdbc.update("INSERT INTO checkout_sessions(id,user_id,cart_id,market_country_id,currency_code,status,expires_at) "
                + "VALUES(?,?,?,?,?,'OPEN',?)", sessionId, actor, cartId, market.countryId(), currency,
                java.sql.Timestamp.from(expiresAt));
        jdbc.update("UPDATE checkout_sessions SET status='EXPIRED',updated_at=now() WHERE user_id=? AND id<>? "
                + "AND status IN ('OPEN','QUOTED')", actor, sessionId);

        List<CheckoutGroup> groups = new ArrayList<>();
        List<ItemRow> itemRows = new ArrayList<>();
        String taxStatus = "NOT_REQUIRED";
        String taxProvider = null;
        long totalSubtotal = 0, totalDiscount = 0, totalShipping = 0, totalTax = 0;

        if (blocking.isEmpty()) {
            Map<UUID, ShopCalc> calc = new LinkedHashMap<>();
            for (Map.Entry<UUID, List<Line>> e : byShop.entrySet()) {
                UUID shopId = e.getKey();
                long subtotal = e.getValue().stream().mapToLong(l -> l.unitPrice() * l.quantity()).sum();
                long itemDiscount = 0;
                boolean freeShip = false;
                String code = codeByShop.get(shopId);
                if (code != null) {
                    freeShip = discounts.freeShippingCode(actor, shopId, code, subtotal, currency);
                    if (!freeShip) {
                        itemDiscount = discounts.apply(actor, shopId, code, subtotal, currency);
                    }
                }
                int weight = e.getValue().stream().mapToInt(l -> (l.weightGrams() == null ? 0 : l.weightGrams())
                        * l.quantity()).sum();
                try {
                    List<ShippingOption> options = shipping.optionsForShop(
                            new ShipContext(sessionId, market.countryId(), address, currency), shopId,
                            subtotal - itemDiscount, weight, parcelsFor(e.getValue(), shopId), freeShip);
                    if (options.isEmpty()) {
                        blocking.add("SHIPPING_UNAVAILABLE:" + e.getValue().getFirst().shopName());
                        continue;
                    }
                    String selectedKey = req.shippingSelections() == null ? null : req.shippingSelections().get(shopId);
                    ShippingOption selected = options.stream().filter(o -> o.optionKey().equals(selectedKey)).findFirst()
                            .orElseGet(() -> options.stream().min(Comparator.comparing(o -> o.amount().amountMinor()))
                                    .orElseThrow());
                    calc.put(shopId, new ShopCalc(subtotal, itemDiscount, freeShip, code, options, selected));
                } catch (ResponseStatusException ex) {
                    blocking.add((ex.getReason() == null ? "SHIPPING_UNAVAILABLE" : ex.getReason()) + ":"
                            + e.getValue().getFirst().shopName());
                }
            }

            if (blocking.isEmpty() && tax.taxRequired(market.countryId())) {
                List<TaxLine> taxLines = new ArrayList<>();
                List<TaxShipping> taxShipping = new ArrayList<>();
                Map<UUID, Long> lineDiscounts = new LinkedHashMap<>();
                for (Map.Entry<UUID, List<Line>> e : byShop.entrySet()) {
                    Map<UUID, Long> shares = discountShares(calc.get(e.getKey()).itemDiscount(), e.getValue());
                    lineDiscounts.putAll(shares);
                    for (Line l : e.getValue()) {
                        taxLines.add(new TaxLine(l.itemId().toString(),
                                l.unitPrice() * l.quantity() - shares.get(l.itemId()), l.quantity(),
                                taxCodeFor(l.categoryId())));
                    }
                    taxShipping.add(new TaxShipping(e.getKey().toString(),
                            calc.get(e.getKey()).selected().amount().amountMinor()));
                }
                try {
                    TaxResult result = tax.calculate(market.countryId(), currency, address, taxLines, taxShipping);
                    taxProvider = providerKeyFor(market.countryId());
                    taxStatus = "CALCULATED";
                    Map<String, LineTax> itemTaxes = result.lineTaxes();
                    Map<String, LineTax> shipTaxes = result.shippingTaxes();
                    for (Map.Entry<UUID, List<Line>> e : byShop.entrySet()) {
                        UUID shopId = e.getKey();
                        ShopCalc sc = calc.get(shopId);
                        List<com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.CheckoutLine> view =
                                new ArrayList<>();
                        long groupShipTax = shipTaxes.getOrDefault(shopId.toString(), new LineTax(0, null, null, null))
                                .taxMinor();
                        long groupTax = groupShipTax;
                        for (Line l : e.getValue()) {
                            long lineDiscount = lineDiscounts.get(l.itemId());
                            long lineTax = itemTaxes.getOrDefault(l.itemId().toString(),
                                    new LineTax(0, null, null, null)).taxMinor();
                            long lineTotal = l.unitPrice() * l.quantity() - lineDiscount + lineTax;
                            groupTax += lineTax;
                            view.add(new com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.CheckoutLine(
                                    l.variantId(), l.productId(), l.productName(), l.variantLabel(), l.imageId(), null,
                                    l.quantity(), Money.of(l.unitPrice(), currency), Money.of(lineDiscount, currency),
                                    Money.of(lineTax, currency), Money.of(lineTotal, currency)));
                            itemRows.add(new ItemRow(l, lineDiscount, lineTax, lineTotal, groupShipTax, sc));
                        }
                        long shippingAmount = sc.selected().amount().amountMinor();
                        long groupTotal = sc.subtotal() - sc.itemDiscount() + shippingAmount + groupTax;
                        groups.add(new CheckoutGroup(shopId, e.getValue().getFirst().shopName(), view,
                                Money.of(sc.subtotal(), currency), Money.of(sc.itemDiscount(), currency), sc.options(),
                                sc.selected().optionKey(), Money.of(shippingAmount, currency),
                                Money.of(groupTax, currency), Money.of(groupTotal, currency), sc.code(), List.of()));
                        totalSubtotal += sc.subtotal();
                        totalDiscount += sc.itemDiscount();
                        totalShipping += shippingAmount;
                        totalTax += groupTax;
                    }
                    long taxableSubtotal = totalSubtotal - totalDiscount;
                    tax.persist(sessionId, null, taxProvider, result, currency, taxableSubtotal, totalShipping);
                } catch (ResponseStatusException ex) {
                    taxStatus = "UNAVAILABLE";
                    blocking.add(ex.getReason() == null ? "TAX_UNAVAILABLE" : ex.getReason());
                }
            } else if (blocking.isEmpty()) {
                for (Map.Entry<UUID, List<Line>> e : byShop.entrySet()) {
                    UUID shopId = e.getKey();
                    ShopCalc sc = calc.get(shopId);
                    List<com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.CheckoutLine> view =
                            new ArrayList<>();
                    Map<UUID, Long> shares = discountShares(sc.itemDiscount(), e.getValue());
                    for (Line l : e.getValue()) {
                        long lineDiscount = shares.get(l.itemId());
                        long lineTotal = l.unitPrice() * l.quantity() - lineDiscount;
                        view.add(new com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.CheckoutLine(
                                l.variantId(), l.productId(), l.productName(), l.variantLabel(), l.imageId(), null,
                                l.quantity(), Money.of(l.unitPrice(), currency), Money.of(lineDiscount, currency),
                                Money.of(0, currency), Money.of(lineTotal, currency)));
                        itemRows.add(new ItemRow(l, lineDiscount, 0, lineTotal, sc));
                    }
                    long shippingAmount = sc.selected().amount().amountMinor();
                    long groupTotal = sc.subtotal() - sc.itemDiscount() + shippingAmount;
                    groups.add(new CheckoutGroup(shopId, e.getValue().getFirst().shopName(), view,
                            Money.of(sc.subtotal(), currency), Money.of(sc.itemDiscount(), currency), sc.options(),
                            sc.selected().optionKey(), Money.of(shippingAmount, currency), Money.of(0, currency),
                            Money.of(groupTotal, currency), sc.code(), List.of()));
                    totalSubtotal += sc.subtotal();
                    totalDiscount += sc.itemDiscount();
                    totalShipping += shippingAmount;
                }
            }
        }

        boolean canPlace = blocking.isEmpty() && !groups.isEmpty();
        jdbc.update("UPDATE checkout_sessions SET status=?,quoted_at=now(),subtotal_amount_minor=?,"
                + "shipping_amount_minor=?,discount_amount_minor=?,tax_amount_minor=?,total_amount_minor=? WHERE id=?",
                canPlace ? "QUOTED" : "OPEN", totalSubtotal, totalShipping, totalDiscount, totalTax,
                totalSubtotal + totalShipping - totalDiscount + totalTax, sessionId);
        for (ItemRow r : itemRows) {
            UUID shopId = r.line().shopId();
            ShopCalc sc = r.calc();
            Map<String, Object> snapshot = new HashMap<>();
            snapshot.put("cartItemId", r.line().itemId().toString());
            snapshot.put("shipOption", sc.selected().optionKey());
            snapshot.put("shipAmount", sc.selected().amount().amountMinor());
            snapshot.put("shipMethodId", sc.selected().methodId() == null ? "" : sc.selected().methodId().toString());
            snapshot.put("shipProvider", sc.selected().providerKey() == null ? "" : sc.selected().providerKey());
            snapshot.put("shipRateId", sc.selected().optionKey().startsWith("SHIPPO:")
                    ? sc.selected().optionKey().substring(7) : "");
            snapshot.put("shipName", sc.selected().name());
            snapshot.put("shipTax", r.shipTaxShare());
            snapshot.put("code", sc.code() == null ? "" : sc.code());
            snapshot.put("addr", Map.of("id", address.id().toString(), "line1", address.line1(),
                    "line2", address.line2() == null ? "" : address.line2(), "city", address.city(),
                    "region", address.region() == null ? "" : address.region(),
                    "postal", address.postalCode() == null ? "" : address.postalCode(),
                    "country", address.countryCode()));
            snapshot.put("recipient", recipient);
            snapshot.put("phone", req.phone() == null ? "" : req.phone());
            snapshot.put("shopId", shopId.toString());
            jdbc.update("INSERT INTO checkout_items(checkout_session_id,seller_id,shop_id,product_id,variant_id,"
                    + "product_name_snapshot,variant_label_snapshot,seller_sku_snapshot,quantity,currency_code,"
                    + "unit_price_minor,discount_amount_minor,tax_amount_minor,line_total_minor,attributes_snapshot) "
                    + "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb)", sessionId, r.line().sellerId(), shopId,
                    r.line().productId(), r.line().variantId(), r.line().productName(), r.line().variantLabel(),
                    r.line().sku(), r.line().quantity(), currency, r.line().unitPrice(), r.itemDiscount(), r.itemTax(),
                    r.lineTotal(), ShopSupport.json(snapshot));
        }
        return new CheckoutQuote(sessionId, market.countryId(), currency, canPlace ? "QUOTED" : "BLOCKED",
                withImages(groups), new CheckoutTotals(Money.of(totalSubtotal, currency), Money.of(totalDiscount, currency),
                        Money.of(totalShipping, currency), Money.of(totalTax, currency),
                        Money.of(totalSubtotal + totalShipping - totalDiscount + totalTax, currency)),
                taxStatus, taxProvider, blocking, canPlace, expiresAt, address);
    }

    private record ShopCalc(long subtotal, long itemDiscount, boolean freeShip, String code,
            List<ShippingOption> options, ShippingOption selected) {
    }

    private record ItemRow(Line line, long itemDiscount, long itemTax, long lineTotal, long shipTaxShare, ShopCalc calc) {
        ItemRow(Line line, long itemDiscount, long itemTax, long lineTotal, ShopCalc calc) {
            this(line, itemDiscount, itemTax, lineTotal, 0L, calc);
        }
    }

    private List<CheckoutGroup> withImages(List<CheckoutGroup> groups) {
        List<UUID> mediaIds = groups.stream().flatMap(g -> g.items().stream())
                .map(com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.CheckoutLine::imageMediaId).toList();
        Map<UUID, String> urls = support.urls(mediaIds);
        return groups.stream().map(g -> new CheckoutGroup(g.shopId(), g.shopName(),
                g.items().stream().map(i -> new com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.CheckoutLine(
                        i.variantId(), i.productId(), i.productName(), i.variantLabel(), i.imageMediaId(),
                        urls.get(i.imageMediaId()), i.quantity(), i.unitPrice(), i.discount(), i.tax(), i.lineTotal()))
                        .toList(), g.subtotal(), g.discount(), g.shippingOptions(), g.selectedOptionKey(), g.shipping(),
                g.tax(), g.total(), g.appliedDiscountCode(), g.issues())).toList();
    }

    /** Proportional share of a shop-level discount per line; rounding remainder on the last line. */
    private static Map<UUID, Long> discountShares(long groupDiscount, List<Line> lines) {
        Map<UUID, Long> shares = new LinkedHashMap<>();
        if (groupDiscount <= 0) {
            lines.forEach(l -> shares.put(l.itemId(), 0L));
            return shares;
        }
        long subtotal = lines.stream().mapToLong(l -> l.unitPrice() * l.quantity()).sum();
        long allocated = 0;
        for (int i = 0; i < lines.size(); i++) {
            Line l = lines.get(i);
            long share = i == lines.size() - 1 ? groupDiscount - allocated
                    : groupDiscount * l.unitPrice() * l.quantity() / subtotal;
            allocated += share;
            shares.put(l.itemId(), share);
        }
        return shares;
    }

    private List<Parcel> parcelsFor(List<Line> lines, UUID shopId) {
        Object[] d = jdbc.query("SELECT default_package_weight_grams,default_package_length_mm,default_package_width_mm,"
                + "default_package_height_mm FROM shop_shipping_profiles WHERE shop_id=? AND status='ACTIVE' "
                + "ORDER BY is_default DESC LIMIT 1", rs -> rs.next() ? new Object[] {rs.getObject(1, Integer.class),
                        rs.getObject(2, Integer.class), rs.getObject(3, Integer.class), rs.getObject(4, Integer.class)}
                : null, shopId);
        int weight = d != null && d[0] != null ? (Integer) d[0] : 500;
        int length = d != null && d[1] != null ? (Integer) d[1] : 200;
        int width = d != null && d[2] != null ? (Integer) d[2] : 200;
        int height = d != null && d[3] != null ? (Integer) d[3] : 100;
        List<Parcel> parcels = new ArrayList<>();
        for (Line l : lines) {
            int w = l.weightGrams() != null ? l.weightGrams() : weight;
            for (int i = 0; i < l.quantity(); i++) {
                parcels.add(new Parcel(w, length, width, height));
            }
        }
        return parcels;
    }

    private String taxCodeFor(UUID categoryId) {
        return jdbc.query("SELECT provider_tax_category_key FROM product_categories WHERE id=?",
                rs -> rs.next() ? rs.getString(1) : null, categoryId);
    }

    private String providerKeyFor(UUID marketCountryId) {
        return jdbc.query("SELECT provider_key FROM tax_provider_configurations WHERE is_enabled AND environment=? "
                + "AND (country_id=? OR country_id IS NULL) ORDER BY (country_id IS NOT NULL) DESC LIMIT 1",
                rs -> rs.next() ? rs.getString(1) : null, properties.taxEnvironment(), marketCountryId);
    }

    // ------------------------------------------------------------------ place

    @Transactional
    public PlacedOrder place(UUID actor, UUID sessionId) {
        support.requireActive(actor);
        Object[] session = jdbc.query("SELECT user_id,status,cart_id,market_country_id,currency_code::text,expires_at,"
                + "subtotal_amount_minor,shipping_amount_minor,discount_amount_minor,tax_amount_minor,total_amount_minor "
                + "FROM checkout_sessions WHERE id=? FOR UPDATE", rs -> rs.next() ? new Object[] {rs.getObject(1, UUID.class),
                        rs.getString(2), rs.getObject(3, UUID.class), rs.getObject(4, UUID.class), rs.getString(5).trim(),
                        rs.getTimestamp(6).toInstant(), rs.getLong(7), rs.getLong(8), rs.getLong(9), rs.getLong(10),
                        rs.getLong(11)} : null, sessionId);
        if (session == null || !actor.equals(session[0])) {
            throw notFound("CHECKOUT_NOT_FOUND");
        }
        UUID existing = jdbc.query("SELECT o.id FROM orders o WHERE o.checkout_session_id=?",
                rs -> rs.next() ? rs.getObject(1, UUID.class) : null, sessionId);
        if (existing != null) {
            return placedView(existing);
        }
        if (!"QUOTED".equals(session[1])) {
            throw conflict("CHECKOUT_NOT_QUOTED");
        }
        if (((Instant) session[5]).isBefore(Instant.now())) {
            jdbc.update("UPDATE checkout_sessions SET status='EXPIRED',updated_at=now() WHERE id=?", sessionId);
            throw conflict("CHECKOUT_EXPIRED");
        }
        if (paymentProvider == null || !paymentProvider.available()) {
            throw conflict("PAYMENT_PROVIDER_UNAVAILABLE");
        }
        UUID marketCountryId = (UUID) session[3];
        String currency = (String) session[4];
        List<ItemSnapshot> items = jdbc.query("SELECT id,seller_id,shop_id,product_id,variant_id,product_name_snapshot,"
                + "variant_label_snapshot,seller_sku_snapshot,quantity,unit_price_minor,discount_amount_minor,"
                + "tax_amount_minor,line_total_minor,attributes_snapshot::text FROM checkout_items "
                + "WHERE checkout_session_id=? ORDER BY shop_id,created_at", (rs, i) -> new ItemSnapshot(
                        rs.getObject(1, UUID.class), rs.getObject(2, UUID.class), rs.getObject(3, UUID.class),
                        rs.getObject(4, UUID.class), rs.getObject(5, UUID.class), rs.getString(6), rs.getString(7),
                        rs.getString(8), rs.getInt(9), rs.getLong(10), rs.getLong(11), rs.getLong(12), rs.getLong(13),
                        ShopSupport.map(rs.getString(14))), sessionId);
        if (items.isEmpty()) {
            throw conflict("CHECKOUT_EMPTY");
        }
        revalidate(items, sessionId, marketCountryId, currency);
        reserve(items, sessionId);
        UUID orderId = createOrder(actor, sessionId, session, items, marketCountryId, currency);
        jdbc.update("UPDATE checkout_sessions SET status='PAYMENT_PENDING',updated_at=now() WHERE id=?", sessionId);
        return placedView(orderId);
    }

    private record ItemSnapshot(UUID checkoutItemId, UUID sellerId, UUID shopId, UUID productId, UUID variantId,
            String productName, String variantLabel, String sku, int quantity, long unitPrice, long discount, long tax,
            long lineTotal, Map<String, Object> snapshot) {
    }

    /** Revalidates live purchasability and that the quoted unit price is still the live price. */
    private void revalidate(List<ItemSnapshot> items, UUID sessionId, UUID marketCountryId, String currency) {
        for (ItemSnapshot item : items) {
            Object[] live = jdbc.query("SELECT p.status,v.status,s.status,ms.status,(p.deleted_at IS NULL),"
                    + CatalogQueryService.MARKET_ENABLED + ",price.amount_minor FROM product_variants v JOIN products p "
                    + "ON p.id=v.product_id JOIN shops s ON s.id=p.shop_id JOIN marketplace_sellers ms ON ms.id=s.seller_id "
                    + "LEFT JOIN LATERAL (" + String.format(CatalogQueryService.PRICE_FOR_VARIANT, "v.id") + ") price ON true "
                    + "WHERE v.id=?", rs -> rs.next() ? new Object[] {rs.getString(1), rs.getString(2), rs.getString(3),
                            rs.getString(4), rs.getBoolean(5), rs.getBoolean(6), rs.getObject(7, Long.class)} : null,
                    marketCountryId, marketCountryId, currency, item.variantId());
            boolean ok = live != null && (Boolean) live[4] && (Boolean) live[5] && live[6] != null
                    && (Long) live[6] == item.unitPrice()
                    && "ACTIVE".equals(live[1]) && "ACTIVE".equals(live[2]) && "ACTIVE".equals(live[3])
                    && ("PUBLISHED".equals(live[0]) || "OUT_OF_STOCK".equals(live[0]));
            if (!ok) {
                jdbc.update("UPDATE checkout_sessions SET status='EXPIRED',updated_at=now() WHERE id=?", sessionId);
                throw conflict("CHECKOUT_STALE_REQUOTE");
            }
        }
        for (UUID shopId : items.stream().map(ItemSnapshot::shopId).distinct().toList()) {
            Boolean ready = jdbc.queryForObject("SELECT ms.status='ACTIVE' AND s.status='ACTIVE' "
                    + "AND COALESCE(pa.charges_enabled,false) FROM shops s JOIN marketplace_sellers ms ON ms.id=s.seller_id "
                    + "LEFT JOIN seller_payment_accounts pa ON pa.seller_id=ms.id AND pa.provider_key='STRIPE' WHERE s.id=?",
                    Boolean.class, shopId);
            if (!Boolean.TRUE.equals(ready)) {
                throw conflict("SELLER_CANNOT_RECEIVE_PAYMENT");
            }
        }
    }

    /** Reserves stock per checkout item across the shop's active locations, most-available first. */
    private void reserve(List<ItemSnapshot> items, UUID sessionId) {
        for (ItemSnapshot item : items) {
            int remaining = item.quantity();
            List<Object[]> buckets = jdbc.query("SELECT ii.id,ii.quantity_on_hand-" + InventoryService.RESERVED + " AS available "
                    + "FROM inventory_items ii JOIN inventory_locations l ON l.id=ii.inventory_location_id "
                    + "WHERE ii.variant_id=? AND l.status='ACTIVE' ORDER BY available DESC,ii.id FOR UPDATE OF ii",
                    (rs, i) -> new Object[] {rs.getObject(1, UUID.class), rs.getInt(2)}, item.variantId());
            List<Object[]> taken = new ArrayList<>();
            for (Object[] bucket : buckets) {
                if (remaining <= 0) {
                    break;
                }
                int take = Math.min(remaining, Math.max((Integer) bucket[1], 0));
                if (take > 0) {
                    taken.add(new Object[] {bucket[0], take});
                    remaining -= take;
                }
            }
            if (remaining > 0) {
                throw conflict("OUT_OF_STOCK:" + item.productName());
            }
            for (Object[] t : taken) {
                jdbc.update("INSERT INTO inventory_reservations(checkout_session_id,checkout_item_id,inventory_item_id,"
                        + "quantity,status,expires_at) VALUES(?,?,?,?,'ACTIVE',now()+? * interval '1 second')", sessionId,
                        item.checkoutItemId(), t[0], t[1], properties.reservationTtl().toSeconds());
            }
        }
    }

    private UUID createOrder(UUID actor, UUID sessionId, Object[] session, List<ItemSnapshot> items, UUID marketCountryId,
            String currency) {
        UUID orderId = UUID.randomUUID();
        String orderNumber = orderNumber();
        jdbc.update("INSERT INTO orders(id,order_number,checkout_session_id,customer_user_id,market_country_id,currency_code,"
                + "subtotal_amount_minor,shipping_amount_minor,discount_amount_minor,tax_amount_minor,total_amount_minor,"
                + "status) VALUES(?,?,?,?,?,?,?,?,?,?,?,'PAYMENT_PENDING')", orderId, orderNumber, sessionId, actor,
                marketCountryId, currency, session[6], session[7], session[8], session[9], session[10]);
        jdbc.update("INSERT INTO order_status_history(order_id,to_status,actor_user_id) VALUES(?,'PAYMENT_PENDING',?)",
                orderId, actor);

        Map<String, Object> ctx = items.getFirst().snapshot();
        @SuppressWarnings("unchecked")
        Map<String, String> addr = (Map<String, String>) ctx.get("addr");
        String recipient = String.valueOf(ctx.get("recipient"));
        String phone = String.valueOf(ctx.get("phone")).isEmpty() ? null : String.valueOf(ctx.get("phone"));
        insertOrderAddress(orderId, null, addr, recipient, phone);

        Map<UUID, List<ItemSnapshot>> byShop = new LinkedHashMap<>();
        items.forEach(i -> byShop.computeIfAbsent(i.shopId(), k -> new ArrayList<>()).add(i));
        Map<UUID, UUID> sellerOrderIds = new LinkedHashMap<>();
        int seq = 1;
        for (Map.Entry<UUID, List<ItemSnapshot>> e : byShop.entrySet()) {
            UUID shopId = e.getKey();
            UUID sellerId = e.getValue().getFirst().sellerId();
            Map<String, Object> groupCtx = e.getValue().getFirst().snapshot();
            long subtotal = e.getValue().stream().mapToLong(i -> i.unitPrice() * i.quantity()).sum();
            long discount = e.getValue().stream().mapToLong(ItemSnapshot::discount).sum();
            long itemTax = e.getValue().stream().mapToLong(ItemSnapshot::tax).sum();
            long shippingAmount = longOf(groupCtx.get("shipAmount"));
            long shipTax = longOf(groupCtx.get("shipTax"));
            long taxAmount = itemTax + shipTax;
            long gross = subtotal - discount + shippingAmount + taxAmount;
            long commissionAmount = commission.commission(shopId, subtotal - discount + shippingAmount, currency);
            UUID sellerOrderId = UUID.randomUUID();
            String policies = jdbc.queryForObject("SELECT COALESCE(jsonb_object_agg(policy_type,policy_text),'{}'::jsonb) FROM "
                    + "(SELECT DISTINCT ON (policy_type) policy_type,policy_text FROM shop_policies WHERE shop_id=? "
                    + "ORDER BY policy_type,effective_from DESC) p", String.class, shopId);
            jdbc.update("INSERT INTO seller_orders(id,order_id,seller_id,shop_id,seller_order_number,currency_code,"
                    + "subtotal_amount_minor,shipping_amount_minor,discount_amount_minor,tax_amount_minor,"
                    + "commission_amount_minor,seller_net_amount_minor,status,shop_policy_snapshot) "
                    + "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'PAYMENT_PENDING',?::jsonb)", sellerOrderId, orderId, sellerId, shopId,
                    orderNumber + "-" + seq++, currency, subtotal, shippingAmount, discount, taxAmount, commissionAmount,
                    gross - commissionAmount, policies);
            jdbc.update("INSERT INTO seller_order_status_history(seller_order_id,to_status) VALUES(?,'PAYMENT_PENDING')",
                    sellerOrderId);
            sellerOrderIds.put(shopId, sellerOrderId);
            insertOrderAddress(orderId, sellerOrderId, addr, recipient, phone);
            jdbc.update("UPDATE checkout_items SET attributes_snapshot=attributes_snapshot||?::jsonb "
                    + "WHERE checkout_session_id=? AND shop_id=?", ShopSupport.json(Map.of("sellerOrderId",
                            sellerOrderId.toString(), "shipName", String.valueOf(groupCtx.get("shipName")))),
                    sessionId, shopId);
        }
        for (ItemSnapshot item : items) {
            jdbc.update("INSERT INTO order_items(seller_order_id,checkout_item_id,product_id,variant_id,"
                    + "product_name_snapshot,variant_label_snapshot,seller_sku_snapshot,product_condition_snapshot,"
                    + "quantity,currency_code,unit_price_minor,discount_amount_minor,tax_amount_minor,line_total_minor) "
                    + "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", sellerOrderIds.get(item.shopId()), item.checkoutItemId(),
                    item.productId(), item.variantId(), item.productName(), item.variantLabel(), item.sku(),
                    conditionOf(item.productId()), item.quantity(), currency, item.unitPrice(), item.discount(),
                    item.tax(), item.lineTotal());
        }
        UUID paymentId = UUID.randomUUID();
        List<CheckoutLine> lines = new ArrayList<>();
        for (Map.Entry<UUID, UUID> e : sellerOrderIds.entrySet()) {
            String shopName = jdbc.queryForObject("SELECT name FROM shops WHERE id=?", String.class, e.getKey());
            long total = jdbc.queryForObject("SELECT subtotal_amount_minor+shipping_amount_minor-discount_amount_minor"
                    + "+tax_amount_minor FROM seller_orders WHERE id=?", Long.class, e.getValue());
            lines.add(new CheckoutLine("Diasporum order from " + shopName, total, 1));
        }
        HostedCheckout hosted = paymentProvider.createHostedCheckout(new HostedCheckoutRequest("checkout-" + orderId,
                currency, lines, "order-" + orderId, properties.paymentReturnUrl(), properties.paymentCancelUrl(),
                Instant.now().plus(properties.reservationTtl()), Map.of("orderId", orderId.toString(),
                        "orderNumber", orderNumber)));
        jdbc.update("INSERT INTO marketplace_payments(id,order_id,provider_key,provider_payment_intent_id,currency_code,"
                + "amount_minor,status) VALUES(?,?,'STRIPE',?,?,?,'CREATED')", paymentId, orderId,
                hosted.providerCheckoutId(), currency, session[10]);
        jdbc.update("INSERT INTO marketplace_payment_transactions(payment_id,transaction_type,provider_key,"
                + "provider_transaction_id,amount_minor,currency_code,status,metadata) "
                + "VALUES(?,'AUTHORIZATION','STRIPE',?,?,?,'PENDING',?::jsonb)", paymentId, hosted.providerCheckoutId(),
                session[10], currency, ShopSupport.json(Map.of("hostedUrl", hosted.url())));
        lifecycle.linkTax(orderId, sessionId);
        return orderId;
    }

    private static long longOf(Object value) {
        return value instanceof Number n ? n.longValue() : 0;
    }

    private String conditionOf(UUID productId) {
        return jdbc.query("SELECT condition FROM products WHERE id=?", rs -> rs.next() ? rs.getString(1) : null, productId);
    }

    private void insertOrderAddress(UUID orderId, UUID sellerOrderId, Map<String, String> addr, String recipient,
            String phone) {
        jdbc.update("INSERT INTO order_addresses(order_id,seller_order_id,address_type,recipient_name,address_line_1,"
                + "address_line_2,city,region,postal_code,country_code,phone_e164) VALUES(?,?,'SHIPPING',?,?,?,?,?,?,?,?)",
                orderId, sellerOrderId, recipient, addr.get("line1"), nvl(addr.get("line2")), addr.get("city"),
                nvl(addr.get("region")), nvl(addr.get("postal")), addr.get("country"), phone);
    }

    private static String nvl(String value) {
        return value == null || value.isEmpty() ? null : value;
    }

    private String orderNumber() {
        return "SO-" + UUID.randomUUID().toString().replace("-", "").substring(0, 12).toUpperCase();
    }

    PlacedOrder placedView(UUID orderId) {
        Object[] o = jdbc.query("SELECT o.order_number,o.status,mp.status FROM orders o LEFT JOIN marketplace_payments mp "
                + "ON mp.order_id=o.id WHERE o.id=? ORDER BY mp.created_at DESC LIMIT 1",
                rs -> rs.next() ? new Object[] {rs.getString(1), rs.getString(2), rs.getString(3)} : null, orderId);
        String url = jdbc.query("SELECT metadata->>'hostedUrl' FROM marketplace_payment_transactions t JOIN "
                + "marketplace_payments mp ON mp.id=t.payment_id WHERE mp.order_id=? AND t.transaction_type='AUTHORIZATION' "
                + "ORDER BY t.occurred_at DESC LIMIT 1", rs -> rs.next() ? rs.getString(1) : null, orderId);
        return new PlacedOrder(orderId, (String) o[0], (String) o[1], o[2] == null ? null : (String) o[2], url);
    }
}
