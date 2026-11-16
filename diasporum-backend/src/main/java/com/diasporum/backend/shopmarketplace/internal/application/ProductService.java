package com.diasporum.backend.shopmarketplace.internal.application;

import static com.diasporum.backend.shopmarketplace.internal.application.SellerAccessPolicy.CATALOG_EDIT;
import static com.diasporum.backend.shopmarketplace.internal.application.SellerAccessPolicy.LISTING_LIFECYCLE;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.badRequest;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.conflict;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.instant;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.notFound;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.placeholders;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.trim;

import com.diasporum.backend.shopmarketplace.internal.application.SellerAccessPolicy.Access;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.AttributeDefinition;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.AttributeValueInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.AttributeValueView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.MediaItem;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Money;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Page;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.PriceInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ProductInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerPrice;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerProduct;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerProductRow;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerVariant;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.VariantInput;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Seller catalogue management: drafts, variants, explicit market prices, media and lifecycle. */
@Service
public class ProductService {
    static final Set<String> STATUSES = Set.of("DRAFT", "PENDING_REVIEW", "PUBLISHED", "PAUSED", "OUT_OF_STOCK",
            "ARCHIVED", "REMOVED", "REJECTED");
    private static final int MAX_MEDIA = 20;
    private static final int MAX_VARIANTS = 100;

    private final JdbcTemplate jdbc;
    private final ShopSupport support;
    private final SellerAccessPolicy policy;
    private final CatalogQueryService catalog;
    private final InventoryService inventory;
    private final ShopProperties properties;

    public ProductService(ShopSupport support, SellerAccessPolicy policy, CatalogQueryService catalog,
            InventoryService inventory, ShopProperties properties) {
        this.jdbc = support.jdbc();
        this.support = support;
        this.policy = policy;
        this.catalog = catalog;
        this.inventory = inventory;
        this.properties = properties;
    }

    public Page<SellerProductRow> list(UUID actor, UUID shopId, String status, String q, String cursor, Integer size) {
        policy.requireShop(actor, shopId, null);
        int limit = ShopSupport.pageSize(size);
        List<Object> args = new ArrayList<>(List.of(shopId));
        StringBuilder sql = new StringBuilder("SELECT p.id,p.name,p.status,p.updated_at,"
                + "(SELECT media_id FROM product_media pm WHERE pm.product_id=p.id ORDER BY display_order LIMIT 1) AS image,"
                + "(SELECT pr.amount_minor || ':' || pr.currency_code FROM product_variant_prices pr JOIN product_variants v "
                + "ON v.id=pr.variant_id WHERE v.product_id=p.id AND v.status='ACTIVE' AND pr.status='ACTIVE' "
                + "ORDER BY pr.amount_minor LIMIT 1) AS price,"
                + "(SELECT COALESCE(sum(ii.quantity_on_hand),0) FROM inventory_items ii JOIN product_variants v ON v.id=ii.variant_id "
                + "AND v.status='ACTIVE' WHERE v.product_id=p.id) AS on_hand,"
                + "(SELECT COALESCE(sum(" + String.format(CatalogQueryService.AVAILABLE_FOR_VARIANT, "v.id") + "),0) "
                + "FROM product_variants v WHERE v.product_id=p.id AND v.status='ACTIVE') AS available "
                + "FROM products p WHERE p.shop_id=? AND p.deleted_at IS NULL");
        if (status != null && !status.isBlank()) {
            String s = status.toUpperCase();
            if (!STATUSES.contains(s)) {
                throw badRequest("INVALID_STATUS");
            }
            sql.append(" AND p.status=?");
            args.add(s);
        } else {
            sql.append(" AND p.status<>'REMOVED'");
        }
        if (trim(q) != null) {
            sql.append(" AND p.name ILIKE ?");
            args.add("%" + q.trim() + "%");
        }
        String[] c = ShopSupport.decodeCursor(cursor, "UPDATED");
        if (c != null) {
            sql.append(" AND (p.updated_at,p.id)<(?::timestamptz,?)");
            args.add(c[1]);
            args.add(UUID.fromString(c[2]));
        }
        sql.append(" ORDER BY p.updated_at DESC,p.id DESC LIMIT ?");
        args.add(limit + 1);
        List<SellerProductRow> rows = jdbc.query(sql.toString(), (rs, i) -> {
            String price = rs.getString("price");
            Money money = null;
            if (price != null) {
                String[] parts = price.split(":");
                money = Money.of(Long.parseLong(parts[0]), parts[1].trim());
            }
            return new SellerProductRow(rs.getObject("id", UUID.class), rs.getString("name"), rs.getString("status"),
                    rs.getObject("image", UUID.class), null, money, rs.getInt("on_hand"), rs.getInt("available"),
                    instant(rs, "updated_at"));
        }, args.toArray());
        String next = null;
        if (rows.size() > limit) {
            rows = new ArrayList<>(rows.subList(0, limit));
            SellerProductRow last = rows.getLast();
            next = ShopSupport.cursor("UPDATED", last.updatedAt().toString(), last.id());
        }
        Map<UUID, String> urls = support.urls(rows.stream().map(SellerProductRow::imageMediaId).toList());
        return new Page<>(rows.stream().map(r -> new SellerProductRow(r.id(), r.name(), r.status(), r.imageMediaId(),
                urls.get(r.imageMediaId()), r.price(), r.stockOnHand(), r.stockAvailable(), r.updatedAt())).toList(), next);
    }

    public SellerProduct get(UUID actor, UUID shopId, UUID productId) {
        policy.requireShop(actor, shopId, null);
        return view(shopId, productId);
    }

    SellerProduct view(UUID shopId, UUID productId) {
        Object[] p = jdbc.query("SELECT p.category_id,p.name,p.slug,p.description,p.brand,p.condition,p.attributes::text,"
                + "p.status,p.moderation_required,p.published_at,p.updated_at FROM products p WHERE p.id=? AND p.shop_id=? "
                + "AND p.deleted_at IS NULL", rs -> rs.next() ? new Object[] {rs.getObject(1, UUID.class), rs.getString(2),
                        rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6), ShopSupport.map(rs.getString(7)),
                        rs.getString(8), rs.getBoolean(9), instant(rs, "published_at"), instant(rs, "updated_at")} : null,
                productId, shopId);
        if (p == null) {
            throw notFound("PRODUCT_NOT_FOUND");
        }
        UUID categoryId = (UUID) p[0];
        List<String> tags = jdbc.queryForList("SELECT t.display_name FROM product_tag_assignments ta JOIN product_tags t "
                + "ON t.id=ta.tag_id WHERE ta.product_id=? ORDER BY ta.sort_order", String.class, productId);
        List<MediaItem> media = catalog.productMedia(productId, true);
        List<UUID> markets = jdbc.queryForList("SELECT country_id FROM product_market_availability WHERE product_id=? "
                + "AND availability_status='ENABLED'", UUID.class, productId);
        List<SellerVariant> base = jdbc.query("SELECT v.id,v.variant_label,v.seller_sku,v.barcode,v.weight_grams,v.length_mm,"
                + "v.width_mm,v.height_mm,v.status,(SELECT COALESCE(sum(quantity_on_hand),0) FROM inventory_items WHERE variant_id=v.id) "
                + "AS on_hand," + String.format(CatalogQueryService.AVAILABLE_FOR_VARIANT, "v.id") + " AS available "
                + "FROM product_variants v WHERE v.product_id=? AND v.status<>'ARCHIVED' ORDER BY v.created_at,v.id",
                (rs, i) -> new SellerVariant(rs.getObject("id", UUID.class), rs.getString("variant_label"),
                        rs.getString("seller_sku"), rs.getString("barcode"), rs.getObject("weight_grams", Integer.class),
                        rs.getObject("length_mm", Integer.class), rs.getObject("width_mm", Integer.class),
                        rs.getObject("height_mm", Integer.class), rs.getString("status"), List.of(), List.of(),
                        rs.getInt("on_hand"), rs.getInt("available")), productId);
        Map<UUID, List<AttributeValueView>> values = catalog.variantAttributes(base.stream().map(SellerVariant::id).toList());
        Map<UUID, List<SellerPrice>> prices = new HashMap<>();
        if (!base.isEmpty()) {
            jdbc.query("SELECT variant_id,market_country_id,currency_code,amount_minor,compare_at_amount_minor "
                    + "FROM product_variant_prices WHERE status='ACTIVE' AND (effective_until IS NULL OR effective_until>now()) "
                    + "AND variant_id IN (" + placeholders(base.size()) + ") ORDER BY market_country_id,currency_code", rs -> {
                        String currency = rs.getString("currency_code").trim();
                        Long compare = rs.getObject("compare_at_amount_minor", Long.class);
                        prices.computeIfAbsent(rs.getObject("variant_id", UUID.class), k -> new ArrayList<>())
                                .add(new SellerPrice(rs.getObject("market_country_id", UUID.class),
                                        Money.of(rs.getLong("amount_minor"), currency),
                                        compare == null ? null : Money.of(compare, currency)));
                    }, base.stream().map(SellerVariant::id).toArray());
        }
        List<SellerVariant> variants = base.stream().map(v -> new SellerVariant(v.id(), v.label(), v.sku(), v.barcode(),
                v.weightGrams(), v.lengthMm(), v.widthMm(), v.heightMm(), v.status(), values.getOrDefault(v.id(), List.of()),
                prices.getOrDefault(v.id(), List.of()), v.onHand(), v.available())).toList();
        @SuppressWarnings("unchecked")
        Map<String, Object> attributes = (Map<String, Object>) p[6];
        String categoryName = catalog.category(categoryId).name();
        return new SellerProduct(productId, shopId, categoryId, categoryName, (String) p[1], (String) p[2], (String) p[3],
                (String) p[4], (String) p[5], attributes, tags, media, markets, variants, (String) p[7], (Boolean) p[8],
                (java.time.Instant) p[9], (java.time.Instant) p[10], publishIssues(shopId, productId));
    }

    // ------------------------------------------------------------------ save

    @Transactional
    public SellerProduct create(UUID actor, UUID shopId, ProductInput input) {
        support.requireActive(actor);
        Access access = policy.requireShop(actor, shopId, CATALOG_EDIT);
        validateHeader(input);
        UUID id = UUID.randomUUID();
        String base = ShopSupport.slug(input.name());
        String slug = base;
        for (int n = 2; Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM products WHERE shop_id=? "
                + "AND slug=?)", Boolean.class, shopId, slug)); n++) {
            slug = base + "-" + n;
        }
        jdbc.update("INSERT INTO products(id,shop_id,category_id,name,slug,description,brand,condition,attributes,"
                + "created_by_user_id) VALUES(?,?,?,?,?,?,?,?,?::jsonb,?)", id, shopId, input.categoryId(), input.name().trim(),
                slug, trim(input.description()), trim(input.brand()), condition(input.condition()),
                ShopSupport.json(validatedAttributes(input)), actor);
        applyContent(actor, access, shopId, id, input, true);
        return view(shopId, id);
    }

    @Transactional
    public SellerProduct update(UUID actor, UUID shopId, UUID productId, ProductInput input) {
        Access access = policy.requireShop(actor, shopId, CATALOG_EDIT);
        String status = lockedStatus(shopId, productId);
        if ("REMOVED".equals(status)) {
            throw conflict("PRODUCT_REMOVED");
        }
        validateHeader(input);
        jdbc.update("UPDATE products SET category_id=?,name=?,description=?,brand=?,condition=?,attributes=?::jsonb,"
                + "updated_at=now() WHERE id=?", input.categoryId(), input.name().trim(), trim(input.description()),
                trim(input.brand()), condition(input.condition()), ShopSupport.json(validatedAttributes(input)), productId);
        applyContent(actor, access, shopId, productId, input, false);
        if (("PUBLISHED".equals(status) || "OUT_OF_STOCK".equals(status)) && !publishIssues(shopId, productId).isEmpty()) {
            jdbc.update("UPDATE products SET status='PAUSED',updated_at=now() WHERE id=?", productId);
        } else {
            inventory.refreshProductStock(productId);
        }
        return view(shopId, productId);
    }

    private String lockedStatus(UUID shopId, UUID productId) {
        return jdbc.query("SELECT status FROM products WHERE id=? AND shop_id=? AND deleted_at IS NULL FOR UPDATE",
                rs -> rs.next() ? rs.getString(1) : null, productId, shopId) instanceof String s ? s
                : throwNotFound();
    }

    private static String throwNotFound() {
        throw notFound("PRODUCT_NOT_FOUND");
    }

    private void validateHeader(ProductInput in) {
        if (in == null || in.categoryId() == null) {
            throw badRequest("CATEGORY_REQUIRED");
        }
        if (!Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM product_categories WHERE id=? AND is_active)",
                Boolean.class, in.categoryId()))) {
            throw badRequest("CATEGORY_INACTIVE");
        }
        String name = trim(in.name());
        if (name == null || name.length() > 240) {
            throw badRequest("PRODUCT_NAME_REQUIRED");
        }
        if (in.description() != null && in.description().length() > 20000) {
            throw badRequest("DESCRIPTION_TOO_LONG");
        }
        if (in.brand() != null && in.brand().length() > 160) {
            throw badRequest("BRAND_TOO_LONG");
        }
        condition(in.condition());
    }

    private static String condition(String value) {
        String c = value == null ? "NEW" : value.toUpperCase();
        if (!CatalogQueryService.CONDITIONS.contains(c)) {
            throw badRequest("INVALID_CONDITION");
        }
        return c;
    }

    /** Validates product-level attributes against the category definitions. */
    private Map<String, Object> validatedAttributes(ProductInput in) {
        Map<String, Object> source = in.attributes() == null ? Map.of() : in.attributes();
        Map<String, AttributeDefinition> defs = new HashMap<>();
        catalog.attributes(in.categoryId()).stream().filter(d -> !d.variantLevel()).forEach(d -> defs.put(d.attributeKey(), d));
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : source.entrySet()) {
            Object raw = e.getValue();
            if (raw == null || String.valueOf(raw).isBlank()) {
                continue;
            }
            AttributeDefinition d = defs.get(e.getKey());
            if (d == null) {
                throw badRequest("UNKNOWN_ATTRIBUTE");
            }
            String value = String.valueOf(raw).trim();
            switch (d.dataType()) {
                case "ENUM" -> {
                    if (d.options().stream().noneMatch(o -> o.optionKey().equals(value))) {
                        throw badRequest("INVALID_ATTRIBUTE_OPTION");
                    }
                    result.put(d.attributeKey(), value);
                }
                case "NUMBER" -> {
                    try {
                        result.put(d.attributeKey(), new BigDecimal(value));
                    } catch (NumberFormatException ex) {
                        throw badRequest("INVALID_ATTRIBUTE_NUMBER");
                    }
                }
                case "BOOLEAN" -> result.put(d.attributeKey(), Boolean.parseBoolean(value));
                case "DATE" -> {
                    try {
                        result.put(d.attributeKey(), LocalDate.parse(value).toString());
                    } catch (Exception ex) {
                        throw badRequest("INVALID_ATTRIBUTE_DATE");
                    }
                }
                default -> {
                    if (value.length() > 500) {
                        throw badRequest("ATTRIBUTE_TOO_LONG");
                    }
                    result.put(d.attributeKey(), value);
                }
            }
        }
        return result;
    }

    private void applyContent(UUID actor, Access access, UUID shopId, UUID productId, ProductInput in, boolean created) {
        // Tags
        List<String> tags = in.tags() == null ? List.of() : in.tags().stream().map(ShopSupport::trim)
                .filter(t -> t != null && t.length() >= 2 && t.length() <= 50).distinct().limit(10).toList();
        jdbc.update("DELETE FROM product_tag_assignments WHERE product_id=?", productId);
        int order = 0;
        for (String tag : tags) {
            UUID tagId = jdbc.queryForObject("INSERT INTO product_tags(tag_key,display_name) VALUES(?,?) ON CONFLICT(tag_key) "
                    + "DO UPDATE SET tag_key=EXCLUDED.tag_key RETURNING id", UUID.class, tag.toLowerCase(), tag);
            jdbc.update("INSERT INTO product_tag_assignments(product_id,tag_id,sort_order) VALUES(?,?,?) ON CONFLICT DO NOTHING",
                    productId, tagId, order++);
        }
        // Media (ordered; first = primary)
        List<UUID> media = in.mediaIds() == null ? List.of() : in.mediaIds().stream().distinct().toList();
        if (media.size() > MAX_MEDIA) {
            throw badRequest("PRODUCT_MEDIA_LIMIT");
        }
        Set<UUID> attached = new HashSet<>(jdbc.queryForList("SELECT media_id FROM product_media WHERE product_id=?",
                UUID.class, productId));
        for (UUID mediaId : media) {
            if (!attached.contains(mediaId)) {
                support.requireMedia(mediaId, actor, "PRODUCT");
            }
        }
        jdbc.update("DELETE FROM product_media WHERE product_id=?", productId);
        order = 0;
        for (UUID mediaId : media) {
            jdbc.update("INSERT INTO product_media(product_id,media_id,media_role,display_order) VALUES(?,?,'IMAGE',?)",
                    productId, mediaId, order++);
        }
        // Market availability
        List<UUID> markets = in.marketCountryIds() == null ? List.of() : in.marketCountryIds().stream().distinct().toList();
        for (UUID market : markets) {
            if (!Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM marketplace_country_settings "
                    + "WHERE country_id=? AND market_status IN ('ACTIVE','BROWSING_ONLY'))", Boolean.class, market))) {
                throw badRequest("MARKET_NOT_AVAILABLE");
            }
        }
        if (markets.isEmpty()) {
            jdbc.update("UPDATE product_market_availability SET availability_status='DISABLED',updated_at=now() "
                    + "WHERE product_id=?", productId);
        } else {
            jdbc.update("UPDATE product_market_availability SET availability_status='DISABLED',updated_at=now() "
                    + "WHERE product_id=? AND country_id NOT IN (" + placeholders(markets.size()) + ")",
                    concat(productId, markets));
        }
        for (UUID market : markets) {
            jdbc.update("INSERT INTO product_market_availability(product_id,country_id,availability_status) VALUES(?,?,'ENABLED') "
                    + "ON CONFLICT(product_id,country_id) DO UPDATE SET availability_status='ENABLED',effective_until=NULL,"
                    + "updated_at=now()", productId, market);
        }
        // Variants
        List<VariantInput> variants = in.variants() == null || in.variants().isEmpty()
                ? List.of(new VariantInput(null, "Default", null, null, null, null, null, null, List.of(), List.of(), null))
                : in.variants();
        if (variants.size() > MAX_VARIANTS) {
            throw badRequest("VARIANT_LIMIT");
        }
        Map<UUID, AttributeDefinition> variantDefs = new HashMap<>();
        catalog.attributes(in.categoryId()).stream().filter(AttributeDefinition::variantLevel)
                .forEach(d -> variantDefs.put(d.id(), d));
        Set<UUID> existing = new HashSet<>(jdbc.queryForList("SELECT id FROM product_variants WHERE product_id=? "
                + "AND status<>'ARCHIVED'", UUID.class, productId));
        Set<UUID> kept = new HashSet<>();
        for (VariantInput v : variants) {
            UUID variantId = v.id() != null && existing.contains(v.id()) ? v.id() : null;
            String label = trim(v.label());
            if (label == null) {
                label = labelFrom(v.attributes(), variantDefs);
            }
            String sku = trim(v.sku());
            try {
                if (variantId == null) {
                    variantId = UUID.randomUUID();
                    jdbc.update("INSERT INTO product_variants(id,product_id,seller_id,seller_sku,barcode,variant_label,weight_grams,"
                            + "length_mm,width_mm,height_mm) VALUES(?,?,?,?,?,?,?,?,?,?)", variantId, productId, access.sellerId(),
                            sku, trim(v.barcode()), label, positive(v.weightGrams()), positive(v.lengthMm()),
                            positive(v.widthMm()), positive(v.heightMm()));
                    if (v.initialStock() != null && v.initialStock() > 0) {
                        inventory.receiveInitial(actor, shopId, variantId, v.initialStock());
                    }
                } else {
                    jdbc.update("UPDATE product_variants SET seller_sku=?,barcode=?,variant_label=?,weight_grams=?,length_mm=?,"
                            + "width_mm=?,height_mm=?,status='ACTIVE',updated_at=now() WHERE id=?", sku, trim(v.barcode()), label,
                            positive(v.weightGrams()), positive(v.lengthMm()), positive(v.widthMm()), positive(v.heightMm()),
                            variantId);
                }
            } catch (DuplicateKeyException e) {
                throw conflict("SKU_ALREADY_USED");
            }
            kept.add(variantId);
            replaceVariantAttributes(variantId, v.attributes(), variantDefs);
            replacePrices(variantId, v.prices() == null ? List.of() : v.prices());
        }
        for (UUID removed : existing) {
            if (!kept.contains(removed)) {
                jdbc.update("UPDATE product_variants SET status='ARCHIVED',updated_at=now() WHERE id=?", removed);
                jdbc.update("DELETE FROM shopping_cart_items WHERE variant_id=?", removed);
            }
        }
    }

    private static Object[] concat(UUID first, List<UUID> rest) {
        List<Object> all = new ArrayList<>();
        all.add(first);
        all.addAll(rest);
        return all.toArray();
    }

    private static Integer positive(Integer value) {
        if (value != null && value <= 0) {
            throw badRequest("DIMENSIONS_MUST_BE_POSITIVE");
        }
        return value;
    }

    private String labelFrom(List<AttributeValueInput> values, Map<UUID, AttributeDefinition> defs) {
        if (values == null || values.isEmpty()) {
            return "Default";
        }
        List<String> parts = new ArrayList<>();
        for (AttributeValueInput v : values) {
            AttributeDefinition d = defs.get(v.definitionId());
            if (d == null) {
                continue;
            }
            if (v.optionId() != null) {
                d.options().stream().filter(o -> o.id().equals(v.optionId())).findFirst()
                        .ifPresent(o -> parts.add(o.displayValue()));
            } else if (trim(v.value()) != null) {
                parts.add(v.value().trim());
            }
        }
        return parts.isEmpty() ? "Default" : String.join(" / ", parts);
    }

    private void replaceVariantAttributes(UUID variantId, List<AttributeValueInput> values,
            Map<UUID, AttributeDefinition> defs) {
        jdbc.update("DELETE FROM product_variant_attribute_values WHERE variant_id=?", variantId);
        if (values == null) {
            return;
        }
        Set<UUID> seen = new HashSet<>();
        for (AttributeValueInput v : values) {
            AttributeDefinition d = defs.get(v.definitionId());
            if (d == null || !seen.add(d.id())) {
                throw badRequest("INVALID_VARIANT_ATTRIBUTE");
            }
            UUID option = null;
            String text = null;
            BigDecimal number = null;
            Boolean bool = null;
            LocalDate date = null;
            String raw = trim(v.value());
            switch (d.dataType()) {
                case "ENUM" -> {
                    if (v.optionId() == null || d.options().stream().noneMatch(o -> o.id().equals(v.optionId()))) {
                        throw badRequest("INVALID_ATTRIBUTE_OPTION");
                    }
                    option = v.optionId();
                }
                case "NUMBER" -> number = raw == null ? null : new BigDecimal(raw);
                case "BOOLEAN" -> bool = raw == null ? null : Boolean.parseBoolean(raw);
                case "DATE" -> date = raw == null ? null : LocalDate.parse(raw);
                default -> text = raw;
            }
            if (option == null && text == null && number == null && bool == null && date == null) {
                continue;
            }
            jdbc.update("INSERT INTO product_variant_attribute_values(variant_id,attribute_definition_id,option_id,value_text,"
                    + "value_number,value_boolean,value_date) VALUES(?,?,?,?,?,?,?)", variantId, d.id(), option, text, number,
                    bool, date == null ? null : java.sql.Date.valueOf(date));
        }
    }

    /** Explicit per-market/currency prices; changes close the previous row (immutable history). */
    private void replacePrices(UUID variantId, List<PriceInput> prices) {
        Set<String> keys = new HashSet<>();
        for (PriceInput p : prices) {
            if (p.marketCountryId() == null || p.currencyCode() == null || !p.currencyCode().matches("^[A-Za-z]{3}$")) {
                throw badRequest("INVALID_PRICE");
            }
            if (p.amountMinor() < 0 || (p.compareAtAmountMinor() != null && p.compareAtAmountMinor() < p.amountMinor())) {
                throw badRequest("INVALID_PRICE_AMOUNT");
            }
            String currency = p.currencyCode().toUpperCase();
            if (!keys.add(p.marketCountryId() + ":" + currency)) {
                throw badRequest("DUPLICATE_PRICE");
            }
            Object[] current = jdbc.query("SELECT id,amount_minor,compare_at_amount_minor FROM product_variant_prices "
                    + "WHERE variant_id=? AND market_country_id=? AND currency_code=? AND status='ACTIVE' AND effective_until IS NULL",
                    rs -> rs.next() ? new Object[] {rs.getObject(1, UUID.class), rs.getLong(2),
                            rs.getObject(3, Long.class)} : null, variantId, p.marketCountryId(), currency);
            if (current != null && (Long) current[1] == p.amountMinor()
                    && java.util.Objects.equals(current[2], p.compareAtAmountMinor())) {
                continue;
            }
            if (current != null) {
                jdbc.update("UPDATE product_variant_prices SET status='INACTIVE',effective_until=clock_timestamp() WHERE id=?",
                        current[0]);
            }
            try {
                jdbc.update("INSERT INTO product_variant_prices(variant_id,market_country_id,currency_code,amount_minor,"
                        + "compare_at_amount_minor,effective_from) VALUES(?,?,?,?,?,clock_timestamp())", variantId,
                        p.marketCountryId(), currency, p.amountMinor(), p.compareAtAmountMinor());
            } catch (DataIntegrityViolationException e) {
                throw badRequest("CURRENCY_NOT_SUPPORTED_IN_MARKET");
            }
        }
        jdbc.query("SELECT id,market_country_id,currency_code FROM product_variant_prices WHERE variant_id=? AND status='ACTIVE' "
                + "AND effective_until IS NULL", rs -> {
                    String key = rs.getObject(2, UUID.class) + ":" + rs.getString(3).trim();
                    if (!keys.contains(key)) {
                        jdbc.update("UPDATE product_variant_prices SET status='INACTIVE',effective_until=clock_timestamp() "
                                + "WHERE id=?", rs.getObject(1, UUID.class));
                    }
                }, variantId);
    }

    // ------------------------------------------------------------------ lifecycle

    /** Explains every reason a product cannot be published right now. */
    public List<String> publishIssues(UUID shopId, UUID productId) {
        List<String> issues = new ArrayList<>();
        String[] state = jdbc.query("SELECT s.status,ms.status,c.is_active::text FROM products p JOIN shops s ON s.id=p.shop_id "
                + "JOIN marketplace_sellers ms ON ms.id=s.seller_id JOIN product_categories c ON c.id=p.category_id WHERE p.id=?",
                rs -> rs.next() ? new String[] {rs.getString(1), rs.getString(2), rs.getString(3)} : null, productId);
        if (state == null) {
            return List.of("PRODUCT_NOT_FOUND");
        }
        if (!"ACTIVE".equals(state[0])) {
            issues.add("SHOP_NOT_ACTIVE");
        }
        if (!"ACTIVE".equals(state[1])) {
            issues.add("SELLER_NOT_ACTIVE");
        }
        if (!"true".equals(state[2])) {
            issues.add("CATEGORY_INACTIVE");
        }
        Integer ready = jdbc.queryForObject("SELECT count(*) FROM product_media pm JOIN media_objects m ON m.id=pm.media_id "
                + "WHERE pm.product_id=? AND m.status='READY' AND m.deleted_at IS NULL", Integer.class, productId);
        if (ready == 0) {
            issues.add("MEDIA_REQUIRED");
        }
        Integer pendingMedia = jdbc.queryForObject("SELECT count(*) FROM product_media pm JOIN media_objects m ON m.id=pm.media_id "
                + "WHERE pm.product_id=? AND (m.status<>'READY' OR m.deleted_at IS NOT NULL)", Integer.class, productId);
        if (pendingMedia > 0) {
            issues.add("MEDIA_PROCESSING");
        }
        Integer variants = jdbc.queryForObject("SELECT count(*) FROM product_variants WHERE product_id=? AND status='ACTIVE'",
                Integer.class, productId);
        if (variants == 0) {
            issues.add("VARIANT_REQUIRED");
        }
        Integer unpriced = jdbc.queryForObject("SELECT count(*) FROM product_variants v WHERE v.product_id=? AND v.status='ACTIVE' "
                + "AND NOT EXISTS(SELECT 1 FROM product_variant_prices pr JOIN product_market_availability pma ON "
                + "pma.product_id=v.product_id AND pma.country_id=pr.market_country_id AND pma.availability_status='ENABLED' "
                + "WHERE pr.variant_id=v.id AND pr.status='ACTIVE' AND pr.effective_until IS NULL)", Integer.class, productId);
        if (unpriced > 0) {
            issues.add("PRICE_REQUIRED_FOR_ENABLED_MARKET");
        }
        Integer markets = jdbc.queryForObject("SELECT count(*) FROM product_market_availability pma JOIN marketplace_country_settings m "
                + "ON m.country_id=pma.country_id WHERE pma.product_id=? AND pma.availability_status='ENABLED' "
                + "AND m.market_status IN ('ACTIVE','BROWSING_ONLY')", Integer.class, productId);
        if (markets == 0) {
            issues.add("MARKET_REQUIRED");
        }
        UUID category = jdbc.queryForObject("SELECT category_id FROM products WHERE id=?", UUID.class, productId);
        Map<String, Object> attributes = ShopSupport.map(jdbc.queryForObject("SELECT attributes::text FROM products WHERE id=?",
                String.class, productId));
        for (AttributeDefinition d : catalog.attributes(category)) {
            if (!d.required()) {
                continue;
            }
            if (!d.variantLevel() && !attributes.containsKey(d.attributeKey())) {
                issues.add("REQUIRED_ATTRIBUTE_MISSING:" + d.attributeKey());
            } else if (d.variantLevel()) {
                Integer missing = jdbc.queryForObject("SELECT count(*) FROM product_variants v WHERE v.product_id=? "
                        + "AND v.status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM product_variant_attribute_values av "
                        + "WHERE av.variant_id=v.id AND av.attribute_definition_id=?)", Integer.class, productId, d.id());
                if (missing > 0) {
                    issues.add("REQUIRED_VARIANT_ATTRIBUTE_MISSING:" + d.attributeKey());
                }
            }
        }
        return issues;
    }

    @Transactional
    public SellerProduct publish(UUID actor, UUID shopId, UUID productId) {
        policy.requireShop(actor, shopId, LISTING_LIFECYCLE);
        String status = lockedStatus(shopId, productId);
        if (!Set.of("DRAFT", "REJECTED", "PAUSED").contains(status)) {
            throw conflict("PRODUCT_NOT_PUBLISHABLE_FROM_" + status);
        }
        if (!publishIssues(shopId, productId).isEmpty()) {
            throw badRequest("PRODUCT_NOT_PUBLISHABLE");
        }
        boolean published = properties.autoApprove() || "PAUSED".equals(status)
                && jdbc.queryForObject("SELECT published_at IS NOT NULL FROM products WHERE id=?", Boolean.class, productId);
        jdbc.update("UPDATE products SET status=?,published_at=CASE WHEN ?='PUBLISHED' THEN COALESCE(published_at,now()) "
                + "ELSE published_at END,updated_at=now() WHERE id=?", published ? "PUBLISHED" : "PENDING_REVIEW",
                published ? "PUBLISHED" : "PENDING_REVIEW", productId);
        if (published) {
            inventory.refreshProductStock(productId);
        }
        return view(shopId, productId);
    }

    @Transactional
    public SellerProduct pause(UUID actor, UUID shopId, UUID productId) {
        policy.requireShop(actor, shopId, LISTING_LIFECYCLE);
        String status = lockedStatus(shopId, productId);
        if (!Set.of("PUBLISHED", "OUT_OF_STOCK", "PENDING_REVIEW").contains(status)) {
            throw conflict("PRODUCT_NOT_PAUSABLE");
        }
        jdbc.update("UPDATE products SET status='PAUSED',updated_at=now() WHERE id=?", productId);
        return view(shopId, productId);
    }

    @Transactional
    public SellerProduct archive(UUID actor, UUID shopId, UUID productId) {
        policy.requireShop(actor, shopId, LISTING_LIFECYCLE);
        String status = lockedStatus(shopId, productId);
        if ("REMOVED".equals(status) || "ARCHIVED".equals(status)) {
            throw conflict("PRODUCT_ALREADY_ARCHIVED");
        }
        jdbc.update("UPDATE products SET status='ARCHIVED',updated_at=now() WHERE id=?", productId);
        jdbc.update("DELETE FROM shopping_cart_items WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id=?)",
                productId);
        return view(shopId, productId);
    }
}
