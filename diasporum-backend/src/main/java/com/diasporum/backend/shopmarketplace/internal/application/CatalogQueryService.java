package com.diasporum.backend.shopmarketplace.internal.application;

import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.badRequest;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.instant;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.notFound;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.placeholders;

import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.AttributeDefinition;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.AttributeOption;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.AttributeValueView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Category;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Market;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.MarketAvailability;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.MediaItem;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Money;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Page;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ProductCard;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ProductDetail;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Review;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SearchFilters;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerBadge;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingMethodSummary;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingSummary;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShopDetail;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.VariantAxis;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.VariantView;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Buyer catalogue discovery: categories, attribute filters, search and product/shop detail. */
@Service
public class CatalogQueryService {
    static final Set<String> CONDITIONS = Set.of("NEW", "LIKE_NEW", "USED_GOOD", "USED_FAIR", "REFURBISHED", "OTHER");
    static final Set<String> SORTS = Set.of("RELEVANCE", "NEWEST", "PRICE_ASC", "PRICE_DESC", "POPULAR");

    /** Visible, purchasable-catalogue predicate shared by search, wishlist and cart. */
    static final String VISIBLE_SHOP = "s.status='ACTIVE' AND ms.status='ACTIVE'";
    static final String CATEGORY_TREE = "WITH RECURSIVE tree AS (SELECT id FROM product_categories WHERE id=? "
            + "UNION ALL SELECT c.id FROM product_categories c JOIN tree ON c.parent_id=tree.id) SELECT id FROM tree";
    static final String AVAILABLE_FOR_VARIANT = "(SELECT COALESCE(sum(GREATEST(ii.quantity_on_hand-COALESCE((SELECT sum(r.quantity) "
            + "FROM inventory_reservations r WHERE r.inventory_item_id=ii.id AND r.status='ACTIVE' AND r.expires_at>now()),0),0)),0) "
            + "FROM inventory_items ii JOIN inventory_locations il ON il.id=ii.inventory_location_id AND il.status='ACTIVE' "
            + "WHERE ii.variant_id=%s)";
    static final String PRICE_FOR_VARIANT = "SELECT pr.amount_minor,pr.compare_at_amount_minor FROM product_variant_prices pr "
            + "WHERE pr.variant_id=%s AND pr.market_country_id=? AND pr.currency_code=? AND pr.status='ACTIVE' "
            + "AND pr.effective_from<=now() AND (pr.effective_until IS NULL OR pr.effective_until>now()) "
            + "ORDER BY pr.effective_from DESC LIMIT 1";
    static final String MARKET_ENABLED = "EXISTS(SELECT 1 FROM product_market_availability pma WHERE pma.product_id=p.id "
            + "AND pma.country_id=? AND pma.availability_status='ENABLED' AND pma.effective_from<=now() "
            + "AND (pma.effective_until IS NULL OR pma.effective_until>now()))";

    private final JdbcTemplate jdbc;
    private final ShopSupport support;
    private final MarketService markets;
    private final SellerAccessPolicy policy;

    public CatalogQueryService(ShopSupport support, MarketService markets, SellerAccessPolicy policy) {
        this.jdbc = support.jdbc();
        this.support = support;
        this.markets = markets;
        this.policy = policy;
    }

    // ------------------------------------------------------------------ categories

    public List<Category> categories(String languageCode, UUID parentId, boolean all) {
        String lang = languageCode == null || languageCode.isBlank() ? "en" : languageCode.trim().toLowerCase();
        String where = all ? "" : parentId == null ? " AND c.parent_id IS NULL" : " AND c.parent_id=?";
        List<Object> args = new ArrayList<>(List.of(lang));
        if (!all && parentId != null) {
            args.add(parentId);
        }
        return jdbc.query("SELECT c.id,c.parent_id,c.category_key,c.sort_order,"
                + "COALESCE(req.name,en.name,c.category_key) AS name,COALESCE(req.description,en.description) AS description,"
                + "EXISTS(SELECT 1 FROM product_categories ch WHERE ch.parent_id=c.id AND ch.is_active) AS has_children "
                + "FROM product_categories c "
                + "LEFT JOIN product_category_translations en ON en.category_id=c.id AND en.language_code='en' "
                + "LEFT JOIN product_category_translations req ON req.category_id=c.id AND req.language_code=? "
                + "WHERE c.is_active" + where + " ORDER BY c.sort_order,name", (rs, i) -> category(rs), args.toArray());
    }

    public Category category(UUID id) {
        return jdbc.query("SELECT c.id,c.parent_id,c.category_key,c.sort_order,COALESCE(en.name,c.category_key) AS name,"
                + "en.description,EXISTS(SELECT 1 FROM product_categories ch WHERE ch.parent_id=c.id AND ch.is_active) AS has_children "
                + "FROM product_categories c LEFT JOIN product_category_translations en ON en.category_id=c.id "
                + "AND en.language_code='en' WHERE c.id=?", (rs, i) -> category(rs), id)
                .stream().findFirst().orElseThrow(() -> notFound("CATEGORY_NOT_FOUND"));
    }

    private static Category category(ResultSet rs) throws SQLException {
        return new Category(rs.getObject("id", UUID.class), rs.getObject("parent_id", UUID.class),
                rs.getString("category_key"), rs.getString("name"), rs.getString("description"),
                rs.getInt("sort_order"), rs.getBoolean("has_children"));
    }

    /** Active attribute definitions of the category and all its ancestors (inherited). */
    public List<AttributeDefinition> attributes(UUID categoryId) {
        List<AttributeDefinition> defs = jdbc.query("WITH RECURSIVE up AS (SELECT id,parent_id,0 AS depth "
                + "FROM product_categories WHERE id=? UNION ALL SELECT c.id,c.parent_id,up.depth+1 FROM product_categories c "
                + "JOIN up ON c.id=up.parent_id) SELECT d.id,d.category_id,d.attribute_key,d.display_name,d.data_type,"
                + "d.is_required,d.is_filterable,d.is_variant_level,d.validation_config::text AS cfg,d.sort_order "
                + "FROM product_attribute_definitions d JOIN up ON up.id=d.category_id WHERE d.is_active "
                + "ORDER BY up.depth DESC,d.sort_order,d.attribute_key", (rs, i) -> new AttributeDefinition(
                        rs.getObject("id", UUID.class), rs.getObject("category_id", UUID.class),
                        rs.getString("attribute_key"), rs.getString("display_name"), rs.getString("data_type"),
                        rs.getBoolean("is_required"), rs.getBoolean("is_filterable"), rs.getBoolean("is_variant_level"),
                        ShopSupport.map(rs.getString("cfg")), rs.getInt("sort_order"), new ArrayList<>()), categoryId);
        if (defs.isEmpty()) {
            return defs;
        }
        Map<UUID, List<AttributeOption>> options = new HashMap<>();
        jdbc.query("SELECT id,attribute_definition_id,option_key,display_value,sort_order FROM product_attribute_options "
                + "WHERE is_active AND attribute_definition_id IN (" + placeholders(defs.size()) + ") ORDER BY sort_order,display_value",
                rs -> {
                    options.computeIfAbsent(rs.getObject("attribute_definition_id", UUID.class), k -> new ArrayList<>())
                            .add(new AttributeOption(rs.getObject("id", UUID.class), rs.getString("option_key"),
                                    rs.getString("display_value"), rs.getInt("sort_order")));
                }, defs.stream().map(AttributeDefinition::id).toArray());
        return defs.stream().map(d -> new AttributeDefinition(d.id(), d.categoryId(), d.attributeKey(), d.displayName(),
                d.dataType(), d.required(), d.filterable(), d.variantLevel(), d.validationConfig(), d.sortOrder(),
                options.getOrDefault(d.id(), List.of()))).toList();
    }

    // ------------------------------------------------------------------ search

    public Page<ProductCard> search(UUID actor, SearchFilters f, String cursor, Integer size) {
        Market market = markets.requireBrowsable(f.marketCountryId());
        String currency = markets.currency(market, f.currencyCode());
        String sort = f.sort() == null ? (f.q() == null || f.q().isBlank() ? "NEWEST" : "RELEVANCE") : f.sort().toUpperCase();
        if (!SORTS.contains(sort)) {
            throw badRequest("INVALID_SORT");
        }
        if ("RELEVANCE".equals(sort) && (f.q() == null || f.q().isBlank())) {
            sort = "NEWEST";
        }
        int limit = ShopSupport.pageSize(size);
        String q = ShopSupport.trim(f.q());
        String doc = "to_tsvector('english',coalesce(p.name,'') || ' ' || coalesce(p.description,''))";
        String sortExpr = switch (sort) {
            case "PRICE_ASC", "PRICE_DESC" -> "price.amount_minor::double precision";
            case "POPULAR" -> "(SELECT count(*) FROM wishlist_items wi WHERE wi.product_id=p.id)::double precision";
            case "RELEVANCE" -> "ts_rank(" + doc + ",websearch_to_tsquery('english',?))::double precision";
            default -> "extract(epoch FROM p.published_at)::double precision";
        };
        List<Object> args = new ArrayList<>();
        StringBuilder sql = new StringBuilder("WITH base AS (SELECT p.id,p.shop_id,s.name AS shop_name,p.name,p.brand,"
                + "p.condition,p.published_at,price.amount_minor,price.compare_at_amount_minor,"
                + "(SELECT pm.media_id FROM product_media pm WHERE pm.product_id=p.id AND pm.media_role='IMAGE' "
                + "ORDER BY pm.display_order LIMIT 1) AS image_id,"
                + "(SELECT count(*) FROM wishlist_items wi WHERE wi.product_id=p.id) AS fav_count,"
                + "EXISTS(SELECT 1 FROM wishlist_items wi JOIN wishlists w ON w.id=wi.wishlist_id "
                + "WHERE wi.product_id=p.id AND w.user_id=?) AS favourited,"
                + "(SELECT string_agg(DISTINCT o.display_value,' / ') FROM product_variants v "
                + "JOIN product_variant_attribute_values av ON av.variant_id=v.id "
                + "JOIN product_attribute_options o ON o.id=av.option_id WHERE v.product_id=p.id AND v.status='ACTIVE') AS variant_summary,"
                + "(SELECT COALESCE(sum(" + String.format(AVAILABLE_FOR_VARIANT, "v.id") + "),0) FROM product_variants v "
                + "WHERE v.product_id=p.id AND v.status='ACTIVE') AS available_qty,");
        args.add(actor);
        if ("RELEVANCE".equals(sort)) {
            args.add(q);
        }
        sql.append(sortExpr).append(" AS sort_value FROM products p JOIN shops s ON s.id=p.shop_id "
                + "JOIN marketplace_sellers ms ON ms.id=s.seller_id "
                + "JOIN LATERAL (SELECT pr.amount_minor,pr.compare_at_amount_minor FROM product_variant_prices pr "
                + "JOIN product_variants v ON v.id=pr.variant_id AND v.status='ACTIVE' WHERE v.product_id=p.id "
                + "AND pr.market_country_id=? AND pr.currency_code=? AND pr.status='ACTIVE' AND pr.effective_from<=now() "
                + "AND (pr.effective_until IS NULL OR pr.effective_until>now()) ORDER BY pr.amount_minor LIMIT 1) price ON true "
                + "WHERE p.status='PUBLISHED' AND p.deleted_at IS NULL AND " + VISIBLE_SHOP + " AND " + MARKET_ENABLED);
        args.add(market.countryId());
        args.add(currency);
        args.add(market.countryId());
        if (q != null) {
            String like = "%" + q.replace("%", "\\%").replace("_", "\\_") + "%";
            sql.append(" AND (" + doc + " @@ websearch_to_tsquery('english',?) OR p.name ILIKE ? OR p.brand ILIKE ? "
                    + "OR s.name ILIKE ? OR EXISTS(SELECT 1 FROM product_tag_assignments ta JOIN product_tags t ON t.id=ta.tag_id "
                    + "WHERE ta.product_id=p.id AND (t.tag_key ILIKE ? OR t.display_name ILIKE ?)) "
                    + "OR EXISTS(SELECT 1 FROM product_category_translations ct WHERE ct.category_id=p.category_id AND ct.name ILIKE ?))");
            args.addAll(List.of(q, like, like, like, like, like, like));
        }
        if (f.categoryId() != null) {
            sql.append(" AND p.category_id IN (" + CATEGORY_TREE + ")");
            args.add(f.categoryId());
        }
        if (f.shopId() != null) {
            sql.append(" AND p.shop_id=?");
            args.add(f.shopId());
        }
        if (f.conditions() != null && !f.conditions().isEmpty()) {
            List<String> conds = f.conditions().stream().map(String::toUpperCase).filter(CONDITIONS::contains).toList();
            if (!conds.isEmpty()) {
                sql.append(" AND p.condition IN (" + placeholders(conds.size()) + ")");
                args.addAll(conds);
            }
        }
        if (ShopSupport.trim(f.brand()) != null) {
            sql.append(" AND p.brand ILIKE ?");
            args.add(f.brand().trim());
        }
        if (f.minPriceMinor() != null) {
            sql.append(" AND price.amount_minor>=?");
            args.add(f.minPriceMinor());
        }
        if (f.maxPriceMinor() != null) {
            sql.append(" AND price.amount_minor<=?");
            args.add(f.maxPriceMinor());
        }
        if (f.attributeOptions() != null) {
            for (Map.Entry<String, List<String>> e : f.attributeOptions().entrySet()) {
                if (!e.getKey().matches("^[a-z][a-z0-9_]*$") || e.getValue().isEmpty()) {
                    continue;
                }
                String ph = placeholders(e.getValue().size());
                sql.append(" AND (p.attributes->>? IN (" + ph + ") OR EXISTS(SELECT 1 FROM product_variants v "
                        + "JOIN product_variant_attribute_values av ON av.variant_id=v.id "
                        + "JOIN product_attribute_definitions d ON d.id=av.attribute_definition_id "
                        + "JOIN product_attribute_options o ON o.id=av.option_id WHERE v.product_id=p.id AND v.status='ACTIVE' "
                        + "AND d.attribute_key=? AND o.option_key IN (" + ph + ")))");
                args.add(e.getKey());
                args.addAll(e.getValue());
                args.add(e.getKey());
                args.addAll(e.getValue());
            }
        }
        sql.append(") SELECT * FROM base");
        if (f.inStockOnly()) {
            sql.append(" WHERE available_qty>0");
        }
        boolean asc = "PRICE_ASC".equals(sort);
        String[] c = ShopSupport.decodeCursor(cursor, sort);
        if (c != null) {
            sql.append(f.inStockOnly() ? " AND " : " WHERE ");
            sql.append(asc ? "(sort_value,id)>(?,?)" : "(COALESCE(sort_value,0),id)<(?,?)");
            args.add(Double.parseDouble(c[1]));
            args.add(UUID.fromString(c[2]));
        }
        sql.append(asc ? " ORDER BY sort_value ASC,id ASC" : " ORDER BY COALESCE(sort_value,0) DESC,id DESC");
        sql.append(" LIMIT ?");
        args.add(limit + 1);
        List<Object[]> rows = new ArrayList<>();
        List<ProductCard> cards = jdbc.query(sql.toString(), (rs, i) -> {
            rows.add(new Object[] {rs.getDouble("sort_value"), rs.getObject("id", UUID.class)});
            return card(rs, currency);
        }, args.toArray());
        String next = null;
        if (cards.size() > limit) {
            cards = new ArrayList<>(cards.subList(0, limit));
            Object[] last = rows.get(limit - 1);
            next = ShopSupport.cursor(sort, String.valueOf(last[0]), (UUID) last[1]);
        }
        return new Page<>(withImages(cards), next);
    }

    ProductCard card(ResultSet rs, String currency) throws SQLException {
        Long compare = rs.getObject("compare_at_amount_minor", Long.class);
        return new ProductCard(rs.getObject("id", UUID.class), rs.getObject("shop_id", UUID.class),
                rs.getString("shop_name"), rs.getString("name"), rs.getString("brand"), rs.getString("condition"),
                rs.getObject("image_id", UUID.class), null, Money.of(rs.getLong("amount_minor"), currency),
                compare == null ? null : Money.of(compare, currency), rs.getString("variant_summary"),
                rs.getLong("fav_count"), rs.getBoolean("favourited"), rs.getLong("available_qty") > 0,
                instant(rs, "published_at"));
    }

    List<ProductCard> withImages(List<ProductCard> cards) {
        Map<UUID, String> urls = support.urls(cards.stream().map(ProductCard::imageMediaId).toList());
        return cards.stream().map(c -> new ProductCard(c.id(), c.shopId(), c.shopName(), c.name(), c.brand(),
                c.condition(), c.imageMediaId(), urls.get(c.imageMediaId()), c.price(), c.compareAtPrice(),
                c.variantSummary(), c.favouriteCount(), c.favourited(), c.available(), c.publishedAt())).toList();
    }

    // ------------------------------------------------------------------ product detail

    private record ProductRow(UUID id, UUID shopId, UUID categoryId, String name, String slug, String description,
            String brand, String condition, Map<String, Object> attributes, String status, Instant publishedAt,
            String shopStatus, String sellerStatus, UUID sellerId) {
    }

    public ProductDetail product(UUID actor, UUID productId, UUID marketCountryId, String currencyCode) {
        Market market = markets.requireBrowsable(marketCountryId);
        String currency = markets.currency(market, currencyCode);
        ProductRow p = jdbc.query("SELECT p.id,p.shop_id,p.category_id,p.name,p.slug,p.description,p.brand,p.condition,"
                + "p.attributes::text AS attrs,p.status,p.published_at,s.status AS shop_status,ms.status AS seller_status,"
                + "s.seller_id FROM products p JOIN shops s ON s.id=p.shop_id JOIN marketplace_sellers ms ON ms.id=s.seller_id "
                + "WHERE p.id=? AND p.deleted_at IS NULL", (rs, i) -> new ProductRow(rs.getObject("id", UUID.class),
                        rs.getObject("shop_id", UUID.class), rs.getObject("category_id", UUID.class), rs.getString("name"),
                        rs.getString("slug"), rs.getString("description"), rs.getString("brand"), rs.getString("condition"),
                        ShopSupport.map(rs.getString("attrs")), rs.getString("status"), instant(rs, "published_at"),
                        rs.getString("shop_status"), rs.getString("seller_status"), rs.getObject("seller_id", UUID.class)),
                productId).stream().findFirst().orElseThrow(() -> notFound("PRODUCT_NOT_FOUND"));
        boolean publiclyVisible = ("PUBLISHED".equals(p.status()) || "OUT_OF_STOCK".equals(p.status()))
                && "ACTIVE".equals(p.shopStatus()) && "ACTIVE".equals(p.sellerStatus());
        if (!publiclyVisible && policy.sellerAccess(actor, p.sellerId()).isEmpty()) {
            throw notFound("PRODUCT_NOT_FOUND");
        }
        List<AttributeDefinition> defs = attributes(p.categoryId());
        Map<String, AttributeDefinition> byKey = new LinkedHashMap<>();
        defs.forEach(d -> byKey.put(d.attributeKey(), d));
        List<AttributeValueView> productAttributes = new ArrayList<>();
        p.attributes().forEach((key, raw) -> {
            AttributeDefinition d = byKey.get(key);
            if (d == null || raw == null) {
                return;
            }
            String value = String.valueOf(raw);
            String display = d.options().stream().filter(o -> o.optionKey().equals(value)).map(AttributeOption::displayValue)
                    .findFirst().orElse("BOOLEAN".equals(d.dataType()) ? ("true".equals(value) ? "Yes" : "No") : value);
            productAttributes.add(new AttributeValueView(d.id(), key, d.displayName(), null, display));
        });

        List<VariantView> variants = variants(productId, market.countryId(), currency);
        Map<UUID, VariantAxis> axes = new LinkedHashMap<>();
        for (VariantView v : variants) {
            for (AttributeValueView a : v.attributes()) {
                VariantAxis axis = axes.computeIfAbsent(a.definitionId(),
                        k -> new VariantAxis(a.definitionId(), a.attributeKey(), a.label(), new ArrayList<>()));
                UUID optionId = a.optionId();
                boolean present = axis.options().stream().anyMatch(o -> o.displayValue().equals(a.value()));
                if (!present) {
                    axis.options().add(new AttributeOption(optionId, a.value(), a.value(), axis.options().size()));
                }
            }
        }
        boolean marketEnabled = Boolean.TRUE.equals(jdbc.queryForObject("SELECT " + MARKET_ENABLED.replace("p.id", "?"),
                Boolean.class, productId, market.countryId()));
        boolean anyPrice = variants.stream().anyMatch(v -> v.price() != null);
        boolean anyStock = variants.stream().anyMatch(VariantView::available);
        String reason = !publiclyVisible ? "PRODUCT_NOT_PUBLISHED" : !marketEnabled ? "NOT_AVAILABLE_IN_MARKET"
                : !anyPrice ? "NO_PRICE_FOR_MARKET" : !market.buyerCheckoutEnabled() ? "CHECKOUT_UNAVAILABLE_IN_MARKET"
                : !anyStock ? "OUT_OF_STOCK" : null;
        MarketAvailability availability = new MarketAvailability(marketEnabled ? "ENABLED" : "UNAVAILABLE",
                reason == null, reason);

        List<MediaItem> media = productMedia(productId, true);
        SellerBadge badge = badge(p.shopId());
        double[] rating = rating("product_reviews", "product_id", productId);
        long favourites = jdbc.queryForObject("SELECT count(*) FROM wishlist_items WHERE product_id=?", Long.class, productId);
        boolean favourited = Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM wishlist_items wi "
                + "JOIN wishlists w ON w.id=wi.wishlist_id WHERE wi.product_id=? AND w.user_id=?)", Boolean.class, productId, actor));
        List<String> tags = jdbc.queryForList("SELECT t.display_name FROM product_tag_assignments ta JOIN product_tags t "
                + "ON t.id=ta.tag_id WHERE ta.product_id=? ORDER BY ta.sort_order", String.class, productId);
        return new ProductDetail(p.id(), badge, category(p.categoryId()), p.name(), p.slug(), p.description(), p.brand(),
                p.condition(), productAttributes, media, variants, new ArrayList<>(axes.values()), availability,
                policies(p.shopId()), shipping(p.shopId(), market.countryId()), rating[1] > 0 ? rating[0] : null,
                (long) rating[1], favourites, favourited, p.status(), tags, p.publishedAt());
    }

    List<VariantView> variants(UUID productId, UUID marketCountryId, String currency) {
        List<VariantView> base = jdbc.query("SELECT v.id,v.variant_label,v.seller_sku,v.status,price.amount_minor,"
                + "price.compare_at_amount_minor," + String.format(AVAILABLE_FOR_VARIANT, "v.id") + " AS available,"
                + "(SELECT COALESCE(max(ii.low_stock_threshold),0) FROM inventory_items ii WHERE ii.variant_id=v.id) AS threshold "
                + "FROM product_variants v LEFT JOIN LATERAL (" + String.format(PRICE_FOR_VARIANT, "v.id") + ") price ON true "
                + "WHERE v.product_id=? AND v.status='ACTIVE' ORDER BY v.created_at,v.id", (rs, i) -> {
                    Long amount = rs.getObject("amount_minor", Long.class);
                    Long compare = rs.getObject("compare_at_amount_minor", Long.class);
                    long available = rs.getLong("available");
                    return new VariantView(rs.getObject("id", UUID.class), rs.getString("variant_label"), null,
                            rs.getString("status"), new ArrayList<>(), amount == null ? null : Money.of(amount, currency),
                            compare == null ? null : Money.of(compare, currency), available > 0 && amount != null,
                            available > 0 && available <= Math.max(rs.getLong("threshold"), 2));
                }, marketCountryId, currency, productId);
        if (base.isEmpty()) {
            return base;
        }
        Map<UUID, List<AttributeValueView>> values = variantAttributes(base.stream().map(VariantView::id).toList());
        return base.stream().map(v -> new VariantView(v.id(), v.label(), v.sku(), v.status(),
                values.getOrDefault(v.id(), List.of()), v.price(), v.compareAtPrice(), v.available(), v.lowStock())).toList();
    }

    Map<UUID, List<AttributeValueView>> variantAttributes(List<UUID> variantIds) {
        Map<UUID, List<AttributeValueView>> values = new HashMap<>();
        if (variantIds.isEmpty()) {
            return values;
        }
        jdbc.query("SELECT av.variant_id,d.id AS def_id,d.attribute_key,d.display_name,av.option_id,"
                + "COALESCE(o.display_value,av.value_text,av.value_number::text,av.value_boolean::text,av.value_date::text) AS val "
                + "FROM product_variant_attribute_values av JOIN product_attribute_definitions d ON d.id=av.attribute_definition_id "
                + "LEFT JOIN product_attribute_options o ON o.id=av.option_id WHERE av.variant_id IN (" + placeholders(variantIds.size())
                + ") ORDER BY d.sort_order", rs -> {
                    values.computeIfAbsent(rs.getObject("variant_id", UUID.class), k -> new ArrayList<>())
                            .add(new AttributeValueView(rs.getObject("def_id", UUID.class), rs.getString("attribute_key"),
                                    rs.getString("display_name"), rs.getObject("option_id", UUID.class), rs.getString("val")));
                }, variantIds.toArray());
        return values;
    }

    List<MediaItem> productMedia(UUID productId, boolean withUrls) {
        List<MediaItem> items = jdbc.query("SELECT media_id,media_role,display_order,alt_text FROM product_media "
                + "WHERE product_id=? ORDER BY display_order", (rs, i) -> new MediaItem(rs.getObject("media_id", UUID.class),
                        null, rs.getString("media_role"), rs.getInt("display_order"), rs.getString("alt_text")), productId);
        if (!withUrls) {
            return items;
        }
        Map<UUID, String> urls = support.urls(items.stream().map(MediaItem::mediaId).toList());
        return items.stream().map(m -> new MediaItem(m.mediaId(), urls.get(m.mediaId()), m.role(), m.displayOrder(),
                m.altText())).toList();
    }

    public SellerBadge badge(UUID shopId) {
        SellerBadge b = jdbc.query("SELECT s.id,s.name,s.slug,s.status,ms.seller_type,ms.verification_status,"
                + "c.name AS country_name,ms.owner_user_id,ms.business_account_id,"
                + "(SELECT media_id FROM shop_media WHERE shop_id=s.id AND media_role='LOGO') AS logo_id "
                + "FROM shops s JOIN marketplace_sellers ms ON ms.id=s.seller_id JOIN countries c ON c.id=ms.legal_country_id "
                + "WHERE s.id=?", (rs, i) -> new SellerBadge(rs.getObject("id", UUID.class), rs.getString("name"),
                        rs.getString("slug"), rs.getObject("logo_id", UUID.class), null, rs.getString("status"),
                        rs.getString("seller_type"), rs.getString("verification_status"), rs.getString("country_name"),
                        null, 0, rs.getObject("owner_user_id", UUID.class), rs.getObject("business_account_id", UUID.class)),
                shopId).stream().findFirst().orElseThrow(() -> notFound("SHOP_NOT_FOUND"));
        double[] rating = rating("shop_reviews", "shop_id", shopId);
        return new SellerBadge(b.shopId(), b.shopName(), b.slug(), b.logoMediaId(), support.url(b.logoMediaId()),
                b.shopStatus(), b.sellerType(), b.sellerVerificationStatus(), b.sellerCountryName(),
                rating[1] > 0 ? rating[0] : null, (long) rating[1], b.sellerUserId(), b.sellerBusinessAccountId());
    }

    private double[] rating(String table, String column, UUID id) {
        return jdbc.query("SELECT COALESCE(avg(rating),0),count(*) FROM " + table + " WHERE " + column
                + "=? AND status='PUBLISHED'", rs -> {
                    rs.next();
                    return new double[] {Math.round(rs.getDouble(1) * 10) / 10.0, rs.getLong(2)};
                }, id);
    }

    public Map<String, String> policies(UUID shopId) {
        Map<String, String> policies = new LinkedHashMap<>();
        jdbc.query("SELECT DISTINCT ON (policy_type) policy_type,policy_text FROM shop_policies WHERE shop_id=? "
                + "AND effective_from<=now() AND (effective_until IS NULL OR effective_until>now()) "
                + "ORDER BY policy_type,version_number DESC", rs -> {
                    policies.put(rs.getString(1), rs.getString(2));
                }, shopId);
        return policies;
    }

    ShippingSummary shipping(UUID shopId, UUID marketCountryId) {
        Integer[] handling = jdbc.query("SELECT handling_time_min_days,handling_time_max_days FROM shop_shipping_profiles "
                + "WHERE shop_id=? AND status='ACTIVE' ORDER BY is_default DESC LIMIT 1",
                rs -> rs.next() ? new Integer[] {rs.getInt(1), rs.getInt(2)} : new Integer[] {null, null}, shopId);
        List<ShippingMethodSummary> methods = jdbc.query("SELECT m.method_name,m.method_type,EXISTS(SELECT 1 FROM "
                + "shipping_zone_countries zc WHERE zc.shipping_zone_id=z.id AND zc.country_id=?) AS ships "
                + "FROM shipping_methods m JOIN shipping_zones z ON z.id=m.shipping_zone_id AND z.status='ACTIVE' "
                + "WHERE m.shop_id=? AND m.status='ACTIVE' ORDER BY ships DESC,m.method_name", (rs, i) ->
                        new ShippingMethodSummary(rs.getString(1), rs.getString(2), rs.getBoolean(3)), marketCountryId, shopId);
        return new ShippingSummary(handling[0], handling[1], methods);
    }

    // ------------------------------------------------------------------ shop detail / reviews

    public ShopDetail shop(UUID actor, UUID shopId) {
        SellerBadge badge = badge(shopId);
        UUID sellerId = jdbc.queryForObject("SELECT seller_id FROM shops WHERE id=?", UUID.class, shopId);
        String sellerStatus = jdbc.queryForObject("SELECT status FROM marketplace_sellers WHERE id=?", String.class, sellerId);
        boolean visible = "ACTIVE".equals(badge.shopStatus()) && "ACTIVE".equals(sellerStatus);
        if (!visible && policy.sellerAccess(actor, sellerId).isEmpty()) {
            throw notFound("SHOP_NOT_FOUND");
        }
        Object[] row = jdbc.query("SELECT description,published_at,(SELECT media_id FROM shop_media WHERE shop_id=s.id "
                + "AND media_role='COVER') AS cover,(SELECT count(*) FROM products p WHERE p.shop_id=s.id AND p.status='PUBLISHED' "
                + "AND p.deleted_at IS NULL) AS products FROM shops s WHERE id=?", rs -> {
                    rs.next();
                    return new Object[] {rs.getString(1), instant(rs, "published_at"), rs.getObject(3, UUID.class), rs.getLong(4)};
                }, shopId);
        List<MediaItem> gallery = jdbc.query("SELECT media_id,display_order FROM shop_media WHERE shop_id=? "
                + "AND media_role='GALLERY' ORDER BY display_order", (rs, i) -> new MediaItem(rs.getObject(1, UUID.class),
                        null, "GALLERY", rs.getInt(2), null), shopId);
        Map<UUID, String> urls = support.urls(new ArrayList<UUID>() {
            {
                add((UUID) row[2]);
                gallery.forEach(g -> add(g.mediaId()));
            }
        });
        return new ShopDetail(badge, (String) row[0], (UUID) row[2], urls.get((UUID) row[2]),
                gallery.stream().map(g -> new MediaItem(g.mediaId(), urls.get(g.mediaId()), g.role(), g.displayOrder(), null)).toList(),
                policies(shopId), (Long) row[3], (Instant) row[1]);
    }

    public Page<Review> productReviews(UUID productId, String cursor, Integer size) {
        return reviews("SELECT r.id,r.product_id AS target,r.reviewer_user_id,r.rating,r.review_text,r.status,"
                + "NULL::text AS seller_response,NULL::timestamptz AS responded_at,r.created_at,oi.product_name_snapshot AS product_name "
                + "FROM product_reviews r JOIN order_items oi ON oi.id=r.order_item_id WHERE r.product_id=? AND r.status='PUBLISHED'",
                productId, cursor, size);
    }

    public Page<Review> shopReviews(UUID shopId, boolean includeUnpublished, String cursor, Integer size) {
        return reviews("SELECT r.id,r.shop_id AS target,r.reviewer_user_id,r.rating,r.review_text,r.status,r.seller_response,"
                + "r.responded_at,r.created_at,NULL::text AS product_name FROM shop_reviews r WHERE r.shop_id=?"
                + (includeUnpublished ? "" : " AND r.status='PUBLISHED'"), shopId, cursor, size);
    }

    private Page<Review> reviews(String base, UUID id, String cursor, Integer size) {
        int limit = ShopSupport.pageSize(size);
        String[] c = ShopSupport.decodeCursor(cursor, "REVIEWS");
        List<Object> args = new ArrayList<>(List.of(id));
        String sql = "SELECT * FROM (" + base + ") x";
        if (c != null) {
            sql += " WHERE (created_at,id)<(?::timestamptz,?)";
            args.add(c[1]);
            args.add(UUID.fromString(c[2]));
        }
        sql += " ORDER BY created_at DESC,id DESC LIMIT ?";
        args.add(limit + 1);
        List<Review> rows = jdbc.query(sql, (rs, i) -> new Review(rs.getObject("id", UUID.class),
                rs.getObject("target", UUID.class), rs.getObject("reviewer_user_id", UUID.class), null,
                rs.getInt("rating"), rs.getString("review_text"), rs.getString("status"), rs.getString("seller_response"),
                instant(rs, "responded_at"), instant(rs, "created_at"), rs.getString("product_name")), args.toArray());
        String next = null;
        if (rows.size() > limit) {
            rows = new ArrayList<>(rows.subList(0, limit));
            Review last = rows.getLast();
            next = ShopSupport.cursor("REVIEWS", last.createdAt().toString(), last.id());
        }
        Map<UUID, String> names = support.displayNames(rows.stream().map(Review::reviewerUserId).toList());
        return new Page<>(rows.stream().map(r -> new Review(r.id(), r.targetId(), r.reviewerUserId(),
                names.getOrDefault(r.reviewerUserId(), "Member"), r.rating(), r.text(), r.status(), r.sellerResponse(),
                r.respondedAt(), r.createdAt(), r.productName())).toList(), next);
    }
}
