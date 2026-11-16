package com.diasporum.backend.shopmarketplace.internal.application;

import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.ADDRESS_COLS;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.badRequest;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.conflict;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.notFound;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.placeholders;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.trim;

import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.AddressInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.AddressView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Cart;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.CartGroup;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.CartItem;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.CurrencyCount;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Market;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Money;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ProductCard;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Customer cart (one ACTIVE cart per customer and currency), wishlist and marketplace address
 * book. Every read revalidates product status, market eligibility, explicit price and stock;
 * client-cached prices are never trusted.
 */
@Service
public class CartService {
    private static final int MAX_QUANTITY = 99;

    private final JdbcTemplate jdbc;
    private final ShopSupport support;
    private final MarketService markets;
    private final CatalogQueryService catalog;
    private final SellerService sellers;

    public CartService(ShopSupport support, MarketService markets, CatalogQueryService catalog, SellerService sellers) {
        this.jdbc = support.jdbc();
        this.support = support;
        this.markets = markets;
        this.catalog = catalog;
        this.sellers = sellers;
    }

    /** One revalidated cart line before grouping. */
    record Line(UUID itemId, UUID shopId, String shopName, UUID sellerId, UUID logoId, UUID productId, UUID variantId,
            UUID categoryId, String productName, String variantLabel, String sku, String condition, UUID imageId,
            int quantity, Long unitPrice, Long compareAt, int available, Integer weightGrams, String issue) {
    }

    List<Line> lines(UUID cartId, UUID marketCountryId, String currency) {
        return jdbc.query("SELECT ci.id AS item_id,ci.quantity,v.id AS variant_id,v.variant_label,v.seller_sku,v.status AS variant_status,"
                + "v.weight_grams,p.id AS product_id,p.name,p.condition,p.status AS product_status,p.category_id,p.deleted_at,"
                + "s.id AS shop_id,s.name AS shop_name,s.seller_id,s.status AS shop_status,ms.status AS seller_status,"
                + "(SELECT media_id FROM shop_media WHERE shop_id=s.id AND media_role='LOGO') AS logo_id,"
                + "(SELECT pm.media_id FROM product_media pm WHERE pm.product_id=p.id ORDER BY display_order LIMIT 1) AS image_id,"
                + CatalogQueryService.MARKET_ENABLED + " AS market_enabled,price.amount_minor,price.compare_at_amount_minor,"
                + String.format(CatalogQueryService.AVAILABLE_FOR_VARIANT, "v.id") + " AS available "
                + "FROM shopping_cart_items ci JOIN product_variants v ON v.id=ci.variant_id JOIN products p ON p.id=v.product_id "
                + "JOIN shops s ON s.id=p.shop_id JOIN marketplace_sellers ms ON ms.id=s.seller_id "
                + "LEFT JOIN LATERAL (" + String.format(CatalogQueryService.PRICE_FOR_VARIANT, "v.id") + ") price ON true "
                + "WHERE ci.cart_id=? ORDER BY s.name,ci.added_at", (rs, i) -> {
                    Long price = rs.getObject("amount_minor", Long.class);
                    int available = (int) Math.max(rs.getLong("available"), 0);
                    int qty = rs.getInt("quantity");
                    boolean productOk = rs.getObject("deleted_at") == null
                            && ("PUBLISHED".equals(rs.getString("product_status")) || "OUT_OF_STOCK".equals(rs.getString("product_status")))
                            && "ACTIVE".equals(rs.getString("variant_status")) && "ACTIVE".equals(rs.getString("shop_status"))
                            && "ACTIVE".equals(rs.getString("seller_status"));
                    String issue = !productOk ? "PRODUCT_UNAVAILABLE" : !rs.getBoolean("market_enabled") ? "NOT_AVAILABLE_IN_MARKET"
                            : price == null ? "PRICE_UNAVAILABLE" : available == 0 ? "OUT_OF_STOCK"
                            : qty > available ? "INSUFFICIENT_STOCK" : null;
                    return new Line(rs.getObject("item_id", UUID.class), rs.getObject("shop_id", UUID.class),
                            rs.getString("shop_name"), rs.getObject("seller_id", UUID.class), rs.getObject("logo_id", UUID.class),
                            rs.getObject("product_id", UUID.class), rs.getObject("variant_id", UUID.class),
                            rs.getObject("category_id", UUID.class), rs.getString("name"), rs.getString("variant_label"),
                            rs.getString("seller_sku"), rs.getString("condition"), rs.getObject("image_id", UUID.class), qty, price,
                            rs.getObject("compare_at_amount_minor", Long.class), available,
                            rs.getObject("weight_grams", Integer.class), issue);
                }, marketCountryId, marketCountryId, currency, cartId);
    }

    UUID activeCartId(UUID userId, String currency) {
        return jdbc.query("SELECT id FROM shopping_carts WHERE user_id=? AND currency_code=? AND status='ACTIVE'",
                rs -> rs.next() ? rs.getObject(1, UUID.class) : null, userId, currency);
    }

    public Cart cart(UUID actor, UUID marketCountryId, String currencyCode) {
        Market market = markets.requireBrowsable(marketCountryId);
        String currency = markets.currency(market, currencyCode);
        UUID cartId = activeCartId(actor, currency);
        List<Line> lines = cartId == null ? List.of() : lines(cartId, market.countryId(), currency);
        List<UUID> media = new ArrayList<>();
        lines.forEach(l -> {
            media.add(l.imageId());
            media.add(l.logoId());
        });
        Map<UUID, String> urls = support.urls(media);
        Map<UUID, List<Line>> byShop = new LinkedHashMap<>();
        lines.forEach(l -> byShop.computeIfAbsent(l.shopId(), k -> new ArrayList<>()).add(l));
        List<CartGroup> groups = new ArrayList<>();
        long total = 0;
        int count = 0;
        boolean issues = false;
        for (List<Line> shopLines : byShop.values()) {
            long subtotal = 0;
            List<CartItem> items = new ArrayList<>();
            for (Line l : shopLines) {
                Money unit = l.unitPrice() == null ? null : Money.of(l.unitPrice(), currency);
                long lineTotal = l.unitPrice() == null ? 0 : l.unitPrice() * l.quantity();
                if (l.issue() == null) {
                    subtotal += lineTotal;
                } else {
                    issues = true;
                }
                count += l.quantity();
                items.add(new CartItem(l.itemId(), l.productId(), l.variantId(), l.productName(), l.variantLabel(), l.imageId(),
                        urls.get(l.imageId()), l.quantity(), unit, unit == null ? null : Money.of(lineTotal, currency),
                        l.available(), l.issue()));
            }
            total += subtotal;
            Line first = shopLines.getFirst();
            groups.add(new CartGroup(first.shopId(), first.shopName(), first.logoId(), urls.get(first.logoId()), items,
                    Money.of(subtotal, currency)));
        }
        List<CurrencyCount> others = jdbc.query("SELECT c.currency_code,COALESCE(sum(ci.quantity),0) FROM shopping_carts c "
                + "JOIN shopping_cart_items ci ON ci.cart_id=c.id WHERE c.user_id=? AND c.status='ACTIVE' AND c.currency_code<>? "
                + "GROUP BY c.currency_code", (rs, i) -> new CurrencyCount(rs.getString(1).trim(), rs.getInt(2)), actor, currency);
        return new Cart(cartId, market.countryId(), currency, groups, count, Money.of(total, currency), issues, others);
    }

    public int count(UUID actor) {
        Integer n = jdbc.queryForObject("SELECT COALESCE(sum(ci.quantity),0) FROM shopping_carts c JOIN shopping_cart_items ci "
                + "ON ci.cart_id=c.id WHERE c.user_id=? AND c.status='ACTIVE'", Integer.class, actor);
        return n == null ? 0 : n;
    }

    @Transactional
    public Cart add(UUID actor, UUID variantId, int quantity, UUID marketCountryId, String currencyCode) {
        support.requireActive(actor);
        if (quantity < 1 || quantity > MAX_QUANTITY) {
            throw badRequest("INVALID_QUANTITY");
        }
        Market market = markets.requireBrowsable(marketCountryId);
        String currency = markets.currency(market, currencyCode);
        Object[] v = jdbc.query("SELECT p.status,v.status,s.status,ms.status,p.deleted_at IS NULL," + CatalogQueryService.MARKET_ENABLED
                + ",price.amount_minor," + String.format(CatalogQueryService.AVAILABLE_FOR_VARIANT, "v.id") + ",ms.owner_user_id "
                + "FROM product_variants v JOIN products p ON p.id=v.product_id JOIN shops s ON s.id=p.shop_id "
                + "JOIN marketplace_sellers ms ON ms.id=s.seller_id LEFT JOIN LATERAL ("
                + String.format(CatalogQueryService.PRICE_FOR_VARIANT, "v.id") + ") price ON true WHERE v.id=?",
                rs -> rs.next() ? new Object[] {rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getBoolean(5), rs.getBoolean(6), rs.getObject(7, Long.class), rs.getLong(8),
                        rs.getObject(9, UUID.class)} : null, market.countryId(), market.countryId(), currency, variantId);
        if (v == null) {
            throw notFound("VARIANT_NOT_FOUND");
        }
        if (!"PUBLISHED".equals(v[0]) && !"OUT_OF_STOCK".equals(v[0]) || !"ACTIVE".equals(v[1]) || !"ACTIVE".equals(v[2])
                || !"ACTIVE".equals(v[3]) || !(Boolean) v[4]) {
            throw conflict("PRODUCT_UNAVAILABLE");
        }
        if (actor.equals(v[8])) {
            throw conflict("CANNOT_BUY_OWN_PRODUCT");
        }
        if (!(Boolean) v[5]) {
            throw conflict("NOT_AVAILABLE_IN_MARKET");
        }
        if (v[6] == null) {
            throw conflict("PRICE_UNAVAILABLE");
        }
        jdbc.update("INSERT INTO shopping_carts(user_id,currency_code) VALUES(?,?) ON CONFLICT (user_id,currency_code) "
                + "WHERE status='ACTIVE' DO NOTHING", actor, currency);
        UUID cartId = activeCartId(actor, currency);
        jdbc.queryForList("SELECT id FROM shopping_carts WHERE id=? FOR UPDATE", UUID.class, cartId);
        Integer existing = jdbc.query("SELECT quantity FROM shopping_cart_items WHERE cart_id=? AND variant_id=?",
                rs -> rs.next() ? rs.getInt(1) : 0, cartId, variantId);
        int next = Math.min(existing + quantity, MAX_QUANTITY);
        if (next > (Long) v[7]) {
            throw conflict((Long) v[7] == 0 ? "OUT_OF_STOCK" : "INSUFFICIENT_STOCK");
        }
        jdbc.update("INSERT INTO shopping_cart_items(cart_id,variant_id,quantity) VALUES(?,?,?) ON CONFLICT(cart_id,variant_id) "
                + "DO UPDATE SET quantity=EXCLUDED.quantity,updated_at=now()", cartId, variantId, next);
        jdbc.update("UPDATE shopping_carts SET updated_at=now() WHERE id=?", cartId);
        return cart(actor, market.countryId(), currency);
    }

    private String ownedItemCurrency(UUID actor, UUID itemId) {
        String currency = jdbc.query("SELECT c.currency_code FROM shopping_cart_items ci JOIN shopping_carts c ON c.id=ci.cart_id "
                + "WHERE ci.id=? AND c.user_id=? AND c.status='ACTIVE'", rs -> rs.next() ? rs.getString(1).trim() : null, itemId, actor);
        if (currency == null) {
            throw notFound("CART_ITEM_NOT_FOUND");
        }
        return currency;
    }

    @Transactional
    public Cart updateQuantity(UUID actor, UUID itemId, int quantity, UUID marketCountryId) {
        String currency = ownedItemCurrency(actor, itemId);
        if (quantity < 1 || quantity > MAX_QUANTITY) {
            throw badRequest("INVALID_QUANTITY");
        }
        jdbc.update("UPDATE shopping_cart_items SET quantity=?,updated_at=now() WHERE id=?", quantity, itemId);
        return cart(actor, marketCountryId, currency);
    }

    @Transactional
    public Cart remove(UUID actor, UUID itemId, UUID marketCountryId) {
        String currency = ownedItemCurrency(actor, itemId);
        jdbc.update("DELETE FROM shopping_cart_items WHERE id=?", itemId);
        return cart(actor, marketCountryId, currency);
    }

    // ------------------------------------------------------------------ wishlist

    UUID wishlistId(UUID actor) {
        UUID id = jdbc.query("SELECT id FROM wishlists WHERE user_id=? ORDER BY created_at LIMIT 1",
                rs -> rs.next() ? rs.getObject(1, UUID.class) : null, actor);
        if (id == null) {
            id = jdbc.queryForObject("INSERT INTO wishlists(user_id) VALUES(?) RETURNING id", UUID.class, actor);
        }
        return id;
    }

    @Transactional
    public void addToWishlist(UUID actor, UUID productId) {
        if (!Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM products p JOIN shops s ON s.id=p.shop_id "
                + "WHERE p.id=? AND p.status IN ('PUBLISHED','OUT_OF_STOCK') AND p.deleted_at IS NULL AND s.status='ACTIVE')",
                Boolean.class, productId))) {
            throw notFound("PRODUCT_NOT_FOUND");
        }
        jdbc.update("INSERT INTO wishlist_items(wishlist_id,product_id) VALUES(?,?) ON CONFLICT DO NOTHING", wishlistId(actor), productId);
    }

    @Transactional
    public void removeFromWishlist(UUID actor, UUID productId) {
        jdbc.update("DELETE FROM wishlist_items WHERE product_id=? AND wishlist_id IN (SELECT id FROM wishlists WHERE user_id=?)",
                productId, actor);
    }

    /** Saved products in the market; unavailable items stay listed with available=false and no price. */
    public List<ProductCard> wishlist(UUID actor, UUID marketCountryId, String currencyCode) {
        Market market = markets.requireBrowsable(marketCountryId);
        String currency = markets.currency(market, currencyCode);
        List<UUID> ids = jdbc.queryForList("SELECT wi.product_id FROM wishlist_items wi JOIN wishlists w ON w.id=wi.wishlist_id "
                + "WHERE w.user_id=? ORDER BY wi.created_at DESC LIMIT 200", UUID.class, actor);
        if (ids.isEmpty()) {
            return List.of();
        }
        List<Object> args = new ArrayList<>(List.of(market.countryId(), market.countryId(), currency));
        args.addAll(ids);
        List<ProductCard> cards = jdbc.query("SELECT p.id,p.shop_id,s.name AS shop_name,p.name,p.brand,p.condition,p.published_at,"
                + "price.amount_minor,price.compare_at_amount_minor,(SELECT pm.media_id FROM product_media pm WHERE pm.product_id=p.id "
                + "ORDER BY display_order LIMIT 1) AS image_id,(SELECT count(*) FROM wishlist_items wi WHERE wi.product_id=p.id) AS fav_count,"
                + "true AS favourited,NULL::text AS variant_summary,"
                + "(SELECT COALESCE(sum(" + String.format(CatalogQueryService.AVAILABLE_FOR_VARIANT, "v.id") + "),0) "
                + "FROM product_variants v WHERE v.product_id=p.id AND v.status='ACTIVE') AS available_qty,"
                + "(p.status='PUBLISHED' AND p.deleted_at IS NULL AND s.status='ACTIVE' AND ms.status='ACTIVE' AND "
                + CatalogQueryService.MARKET_ENABLED + ") AS visible "
                + "FROM products p JOIN shops s ON s.id=p.shop_id JOIN marketplace_sellers ms ON ms.id=s.seller_id "
                + "LEFT JOIN LATERAL (SELECT pr.amount_minor,pr.compare_at_amount_minor FROM product_variant_prices pr "
                + "JOIN product_variants v ON v.id=pr.variant_id AND v.status='ACTIVE' WHERE v.product_id=p.id AND "
                + "pr.market_country_id=? AND pr.currency_code=? AND pr.status='ACTIVE' AND pr.effective_from<=now() AND "
                + "(pr.effective_until IS NULL OR pr.effective_until>now()) ORDER BY pr.amount_minor LIMIT 1) price ON true "
                + "WHERE p.id IN (" + placeholders(ids.size()) + ")", (rs, i) -> {
                    boolean visible = rs.getBoolean("visible");
                    Long amount = rs.getObject("amount_minor", Long.class);
                    Long compare = rs.getObject("compare_at_amount_minor", Long.class);
                    return new ProductCard(rs.getObject("id", UUID.class), rs.getObject("shop_id", UUID.class),
                            rs.getString("shop_name"), rs.getString("name"), rs.getString("brand"), rs.getString("condition"),
                            rs.getObject("image_id", UUID.class), null, visible && amount != null ? Money.of(amount, currency) : null,
                            visible && compare != null ? Money.of(compare, currency) : null, null, rs.getLong("fav_count"), true,
                            visible && amount != null && rs.getLong("available_qty") > 0,
                            ShopSupport.instant(rs, "published_at"));
                }, args.toArray());
        Map<UUID, ProductCard> byId = new LinkedHashMap<>();
        cards.forEach(c -> byId.put(c.id(), c));
        return catalog.withImages(ids.stream().map(byId::get).filter(java.util.Objects::nonNull).toList());
    }

    // ------------------------------------------------------------------ addresses

    public List<AddressView> addresses(UUID actor) {
        return jdbc.query("SELECT " + ADDRESS_COLS + " FROM addresses a JOIN countries c ON c.id=a.country_id "
                + "WHERE a.owner_user_id=? AND a.visibility='PRIVATE' AND a.address_line_1 IS NOT NULL AND a.city IS NOT NULL "
                + "AND NOT EXISTS(SELECT 1 FROM inventory_locations l WHERE l.address_id=a.id) "
                + "AND NOT EXISTS(SELECT 1 FROM shop_shipping_profiles sp WHERE sp.origin_address_id=a.id) "
                + "ORDER BY a.updated_at DESC LIMIT 50", (rs, i) -> ShopSupport.address(rs), actor);
    }

    @Transactional
    public AddressView createAddress(UUID actor, AddressInput input) {
        support.requireActive(actor);
        return sellers.addressView(sellers.insertAddress(actor, input));
    }

    @Transactional
    public AddressView updateAddress(UUID actor, UUID addressId, AddressInput in) {
        if (in == null || in.countryId() == null || trim(in.line1()) == null || trim(in.city()) == null) {
            throw badRequest("ADDRESS_INCOMPLETE");
        }
        int updated = jdbc.update("UPDATE addresses SET country_id=?,address_line_1=?,address_line_2=?,city=?,region=?,postal_code=?,"
                + "formatted_address=?,updated_at=now() WHERE id=? AND owner_user_id=? AND visibility='PRIVATE'", in.countryId(),
                trim(in.line1()), trim(in.line2()), trim(in.city()), trim(in.region()), trim(in.postalCode()),
                String.join(", ", java.util.stream.Stream.of(trim(in.line1()), trim(in.line2()), trim(in.city()),
                        trim(in.region()), trim(in.postalCode())).filter(java.util.Objects::nonNull).toList()), addressId, actor);
        if (updated == 0) {
            throw notFound("ADDRESS_NOT_FOUND");
        }
        return sellers.addressView(addressId);
    }

    @Transactional
    public void deleteAddress(UUID actor, UUID addressId) {
        try {
            if (jdbc.update("DELETE FROM addresses WHERE id=? AND owner_user_id=? AND visibility='PRIVATE'", addressId, actor) == 0) {
                throw notFound("ADDRESS_NOT_FOUND");
            }
        } catch (DataIntegrityViolationException e) {
            throw conflict("ADDRESS_IN_USE");
        }
    }

    AddressView ownedAddress(UUID actor, UUID addressId) {
        return jdbc.query("SELECT " + ADDRESS_COLS + " FROM addresses a JOIN countries c ON c.id=a.country_id WHERE a.id=? "
                + "AND a.owner_user_id=? AND a.visibility='PRIVATE'", (rs, i) -> ShopSupport.address(rs), addressId, actor)
                .stream().findFirst().orElseThrow(() -> notFound("ADDRESS_NOT_FOUND"));
    }
}
