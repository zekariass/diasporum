package com.diasporum.backend.shopmarketplace.internal.application;

import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.AddressInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.DiscountCodeInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.PriceInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ProductInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Seller;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerProduct;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerShopDetail;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingMethodInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingProfileInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingRules;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingZoneView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.VariantInput;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Seeds shopping-marketplace data on startup — always reference data, optionally a
 * dev demo fixture.
 *
 * <p>Reference seed (idempotent): product categories + English translations,
 * marketplace country settings for launch markets, a TEST {@code NO_COLLECTION} tax
 * configuration so checkout works without real provider credentials, and a global
 * commission rule. Runs when the {@code local} profile is explicitly active, or when
 * {@code diasporum.shop.seed-reference-enabled=true} is set (e.g. a first production
 * deploy). Tests never see these rows.
 *
 * <p>Demo seed ({@code diasporum.shop.demo-seed-enabled=true} + active {@code local}
 * profile — never in tests): one demo
 * seller + ACTIVE shop "Diaspora Market" with shipping config, a return policy, a
 * discount code and a dozen published products. Product media rows are READY but
 * point at placeholder object keys — no real image bytes exist in dev storage.
 */
@Component
public class ShopMarketplaceStartupSeeder implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(ShopMarketplaceStartupSeeder.class);
    private static final String DEMO_EMAIL = "shop-demo-seller@diasporum.invalid";
    private static final String DEMO_BUCKET = "dev-seed";

    private final JdbcTemplate jdbc;
    private final SellerService sellers;
    private final ShippingConfigService shipping;
    private final ProductService products;
    private final DiscountService discounts;
    private final boolean demoSeedEnabled;
    private final boolean seedReferenceEnabled;
    private final org.springframework.core.env.Environment env;

    public ShopMarketplaceStartupSeeder(ShopSupport support, SellerService sellers,
            ShippingConfigService shipping, ProductService products, DiscountService discounts,
            @Value("${diasporum.shop.demo-seed-enabled:false}") boolean demoSeedEnabled,
            @Value("${diasporum.shop.seed-reference-enabled:false}") boolean seedReferenceEnabled,
            org.springframework.core.env.Environment env) {
        this.jdbc = support.jdbc();
        this.sellers = sellers;
        this.shipping = shipping;
        this.products = products;
        this.discounts = discounts;
        this.demoSeedEnabled = demoSeedEnabled;
        this.seedReferenceEnabled = seedReferenceEnabled;
        this.env = env;
    }

    /**
     * Tests fall back to {@code local} via {@code spring.profiles.default} without it
     * being an <em>active</em> profile — so seed rows must never appear unless
     * {@code local} is explicitly active or the ops opt-in flag is set. Seeded
     * {@code marketplace_country_settings} rows hold an FK on {@code countries} and
     * would break test fixtures that wipe the country table.
     */
    private boolean localProfileActive() {
        return List.of(env.getActiveProfiles()).contains("local");
    }

    /** Reference data seeds when {@code local} is active, or when ops sets
     * {@code diasporum.shop.seed-reference-enabled=true} on any other profile. */
    private boolean referenceSeedActive() {
        return seedReferenceEnabled || localProfileActive();
    }

    /** Demo fixtures additionally require {@code demo-seed-enabled} — never in tests. */
    private boolean demoSeedActive() {
        return demoSeedEnabled && localProfileActive();
    }

    @Override
    public void run(ApplicationArguments args) {
        if (referenceSeedActive()) {
            int categories = seedCategories();
            int markets = seedMarkets();
            seedTaxConfiguration();
            seedCommissionRule();
            if (categories > 0 || markets > 0) {
                log.info("[shop] Seeded {} categories, {} markets", categories, markets);
            }
        }
        if (demoSeedActive()) {
            try {
                seedDemoFixture();
            } catch (RuntimeException e) {
                log.warn("[shop] Demo seed failed — continuing startup: {}", e.getMessage());
            }
        }
    }

    // ------------------------------------------------------------------ reference data

    private int seedCategories() {
        int inserted = 0;
        for (CategorySeed c : CATEGORIES) {
            UUID id = deterministicId("shop-category:" + c.key());
            UUID parentId = c.parent() == null ? null : deterministicId("shop-category:" + c.parent());
            inserted += jdbc.update("INSERT INTO product_categories(id,parent_id,category_key,"
                    + "provider_tax_category_key,sort_order,is_active) VALUES(?,?,?,?,?,true) "
                    + "ON CONFLICT (category_key) DO NOTHING",
                    id, parentId, c.key(), "txcd_99999999", c.sort());
            for (Map.Entry<String, String> tr : c.names().entrySet()) {
                jdbc.update("INSERT INTO product_category_translations(category_id,language_code,name) "
                        + "VALUES(?,?,?) ON CONFLICT (category_id,language_code) DO NOTHING",
                        id, tr.getKey(), tr.getValue());
            }
        }
        return inserted;
    }

    private int seedMarkets() {
        int inserted = 0;
        for (String[] m : MARKETS) {
            inserted += jdbc.update("INSERT INTO marketplace_country_settings(country_id,market_status,"
                    + "buyer_checkout_enabled,seller_onboarding_enabled,shipping_enabled,tax_enabled,"
                    + "default_currency,supported_currencies,enabled_at) "
                    + "SELECT c.id,'ACTIVE',true,true,true,true,?,ARRAY[?],now() FROM countries c "
                    + "WHERE c.iso2=? ON CONFLICT (country_id) DO NOTHING", m[1], m[1], m[0]);
        }
        return inserted;
    }

    /** A TEST no-collection configuration keeps local checkout fail-open for dev only. */
    private void seedTaxConfiguration() {
        jdbc.update("INSERT INTO tax_provider_configurations(provider_key,country_id,environment,"
                + "is_enabled,non_secret_configuration) VALUES('NO_COLLECTION',NULL,'TEST',true,"
                + "'{\"approvalReference\":\"dev-seed-no-collection\"}'::jsonb) ON CONFLICT DO NOTHING");
    }

    /** Global 10% commission baseline; admins can layer shop/category overrides above it. */
    private void seedCommissionRule() {
        jdbc.update("INSERT INTO marketplace_commission_rules(commission_basis_points,priority,status) "
                + "SELECT 1000,0,'ACTIVE' WHERE NOT EXISTS(SELECT 1 FROM marketplace_commission_rules)");
    }

    // ------------------------------------------------------------------ demo fixture (dev only)

    private void seedDemoFixture() {
        if (Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM users WHERE email_normalized=?)", Boolean.class, DEMO_EMAIL))) {
            return;
        }
        UUID marketCountryId = jdbc.queryForObject(
                "SELECT country_id FROM marketplace_country_settings WHERE market_status='ACTIVE' "
                        + "ORDER BY enabled_at LIMIT 1", UUID.class);
        if (marketCountryId == null) {
            log.warn("[shop] No ACTIVE market — skipping demo seed");
            return;
        }
        UUID sellerUser = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,email,email_verified_at,account_status) "
                + "VALUES(?,?,now(),'ACTIVE')", sellerUser, DEMO_EMAIL);
        jdbc.update("INSERT INTO profiles(id,display_name,origin_country_id,current_country_id,"
                + "trust_score,profile_completed_at) VALUES(?,?,?,?,0,now())",
                sellerUser, "Diaspora Demo Seller", marketCountryId, marketCountryId);

        Seller seller = sellers.createSeller(sellerUser, "INDIVIDUAL", null, marketCountryId,
                "Diaspora Market LLC", "Diaspora Market");
        SellerShopDetail shop = sellers.createShop(sellerUser, seller.id(), "Diaspora Market",
                "Hand-picked products from home — traditional wear, food, crafts and art.",
                marketCountryId);
        UUID shopId = shop.shop().id();

        // Readiness: shipping profile (auto-creates the default inventory location),
        // a domestic zone + flat-rate method, and a published returns policy.
        sellers.updateShippingProfile(sellerUser, shopId, new ShippingProfileInput(
                new AddressInput(marketCountryId, "1 Marketplace Way", null, "Diaspora City",
                        null, "10001"), 1, 3, 500, 200, 200, 100));
        ShippingZoneView zone = shipping.saveZone(sellerUser, shopId, null, "Domestic",
                List.of(marketCountryId));
        shipping.saveMethod(sellerUser, shopId, zone.id(), null, new ShippingMethodInput(
                "Standard", "FLAT_RATE", "USD", new ShippingRules(500L, null, 10000L, null, 3, 7)));
        sellers.updatePolicy(sellerUser, shopId, "RETURNS",
                "Returns accepted within 14 days of delivery. Items must be unused and in original "
                        + "packaging. Buyer covers return shipping unless the item arrived damaged.");
        sellers.submitShop(sellerUser, shopId);
        // Demo fixtures bypass the moderation queue regardless of moderation-mode.
        jdbc.update("UPDATE marketplace_sellers SET status='ACTIVE' WHERE id=?", seller.id());
        jdbc.update("UPDATE shops SET status='ACTIVE',published_at=COALESCE(published_at,now()) WHERE id=?",
                shopId);

        String currency = jdbc.queryForObject(
                "SELECT default_currency FROM marketplace_country_settings WHERE country_id=?",
                String.class, marketCountryId);
        for (DemoProduct dp : DEMO_PRODUCTS) {
            UUID mediaId = UUID.randomUUID();
            jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,object_key,purpose,"
                    + "access_scope,status,mime_type,size_bytes,width_px,height_px,uploaded_at,processed_at) "
                    + "VALUES(?,?,?,?,'PRODUCT','PUBLIC','READY','image/jpeg',0,1200,1200,now(),now())",
                    mediaId, sellerUser, DEMO_BUCKET, "shop-demo/" + ShopSupport.slug(dp.name()) + ".jpg");
            SellerProduct created = products.create(sellerUser, shopId, new ProductInput(
                    categoryId(dp.categoryKey()), dp.name(), dp.description(), dp.brand(), dp.condition(),
                    Map.of(), dp.tags(), List.of(mediaId), List.of(marketCountryId),
                    List.of(new VariantInput(null, "Default", null, null, dp.weightGrams(), null, null,
                            null, List.of(), List.of(new PriceInput(marketCountryId, currency,
                                    dp.priceMinor(), dp.compareAtMinor())), dp.stock()))));
            products.publish(sellerUser, shopId, created.id());
        }
        // Same moderation bypass as the shop itself — demo products must be browsable
        // immediately even when moderation-mode is not AUTO_APPROVE.
        jdbc.update("UPDATE products SET status='PUBLISHED',published_at=COALESCE(published_at,now()),"
                + "updated_at=now() WHERE shop_id=? AND status='PENDING_REVIEW'", shopId);
        discounts.create(sellerUser, shopId, new DiscountCodeInput("DIASPORA10", "PERCENTAGE",
                new BigDecimal("10"), currency, null, 200, 1, Instant.now().minus(1, ChronoUnit.DAYS),
                Instant.now().plus(90, ChronoUnit.DAYS)));
        log.info("[shop] Seeded demo shop '{}' with {} products", shopId, DEMO_PRODUCTS.size());
    }

    private UUID categoryId(String key) {
        return jdbc.queryForObject("SELECT id FROM product_categories WHERE category_key=?",
                UUID.class, key);
    }

    private static UUID deterministicId(String seed) {
        return UUID.nameUUIDFromBytes(seed.getBytes(StandardCharsets.UTF_8));
    }

    private record CategorySeed(String key, String parent, int sort, Map<String, String> names) {
    }

    private static CategorySeed cat(String key, String parent, int sort, String name) {
        return new CategorySeed(key, parent, sort, Map.of("en", name));
    }

    private static CategorySeed cat(String key, String parent, int sort, Map<String, String> names) {
        return new CategorySeed(key, parent, sort, names);
    }

    private record DemoProduct(String categoryKey, String name, String description, String brand,
            String condition, long priceMinor, Long compareAtMinor, int weightGrams, int stock,
            List<String> tags) {
    }

    /** Markets enabled on boot: iso2 → default+supported currency. */
    private static final String[][] MARKETS = {
        {"US", "USD"}, {"CA", "CAD"}, {"GB", "GBP"}, {"AU", "AUD"},
        {"DE", "EUR"}, {"FR", "EUR"}, {"NL", "EUR"}, {"ES", "EUR"}, {"IT", "EUR"},
        {"BE", "EUR"}, {"AT", "EUR"}, {"IE", "EUR"}, {"SE", "SEK"},
        {"AE", "AED"}, {"SA", "SAR"}, {"ET", "ETB"},
    };

    private static final List<CategorySeed> CATEGORIES = List.of(
        cat("fashion", null, 10, Map.of("en", "Fashion", "am", "ፋሽን", "fr", "Mode")),
        cat("electronics", null, 20, "Electronics"),
        cat("home-garden", null, 30, "Home & Garden"),
        cat("beauty", null, 40, "Beauty & Personal Care"),
        cat("food-grocery", null, 50, Map.of("en", "Food & Grocery", "am", "ምግብ እና ግሮሰሪ")),
        cat("handmade-crafts", null, 60, "Handmade & Crafts"),
        cat("cultural-traditional", null, 70, Map.of("en", "Cultural & Traditional", "am", "ባህላዊ እና ስርዓተ-ገብ")),
        cat("kids-baby", null, 80, "Kids & Baby"),
        cat("sports-outdoors", null, 90, "Sports & Outdoors"),
        cat("books-media", null, 100, "Books & Media"),
        cat("art-collectibles", null, 110, "Art & Collectibles"),
        cat("jewelry-accessories", null, 120, "Jewelry & Accessories"),
        cat("women-clothing", "fashion", 10, "Women's Clothing"),
        cat("men-clothing", "fashion", 20, "Men's Clothing"),
        cat("shoes", "fashion", 30, "Shoes"),
        cat("bags", "fashion", 40, "Bags"),
        cat("traditional-wear", "fashion", 50, Map.of("en", "Traditional Wear", "am", "ባህላዊ ልብስ")),
        cat("coffee-tea", "food-grocery", 10, "Coffee & Tea"),
        cat("spices-condiments", "food-grocery", 20, "Spices & Condiments"),
        cat("snacks-sweets", "food-grocery", 30, "Snacks & Sweets"),
        cat("ceremonial-items", "cultural-traditional", 10, "Ceremonial Items"),
        cat("music-instruments", "cultural-traditional", 20, "Musical Instruments"),
        cat("textiles-fabrics", "cultural-traditional", 30, "Textiles & Fabrics")
    );

    private static final List<DemoProduct> DEMO_PRODUCTS = List.of(
        new DemoProduct("traditional-wear", "Handwoven Habesha Kemis — White",
                "Traditional handwoven dress with tibeb embroidery. 100% Ethiopian cotton.",
                "Addis Threads", "NEW", 14500, 18000L, 400, 4, List.of("habesha", "dress", "traditional")),
        new DemoProduct("coffee-tea", "Yirgacheffe Coffee Beans 1kg",
                "Single-origin washed Arabica, roasted weekly. Floral, citrus, tea-like finish.",
                "Kaffa Roasters", "NEW", 2400, null, 1000, 25, List.of("coffee", "ethiopian", "beans")),
        new DemoProduct("spices-condiments", "Berbere Spice Blend 500g",
                "Authentic berbere — chili, garlic, ginger and 12 spices ground in-house.",
                "Meret Spice Co.", "NEW", 1400, null, 500, 40, List.of("berbere", "spice")),
        new DemoProduct("handmade-crafts", "Handwoven Mesa Serving Basket",
                "Traditional injera serving basket, dyed with natural colours.",
                "Wollo Crafts", "NEW", 3800, null, 800, 8, List.of("basket", "mesa", "handwoven")),
        new DemoProduct("beauty", "Whipped Shea Butter Cream 250ml",
                "Raw unrefined shea butter whipped with coconut oil. Fragrance-free.",
                "Nile Botanicals", "NEW", 1800, null, 300, 30, List.of("shea", "skincare")),
        new DemoProduct("art-collectibles", "Ge'ez Calligraphy Art Print A3",
                "Museum-quality giclée print on archival paper. Unframed.",
                "Melkam Studio", "NEW", 3200, null, 120, 15, List.of("art", "print", "geez")),
        new DemoProduct("jewelry-accessories", "Silver Coptic Cross Necklace",
                "Sterling silver cross pendant on an 18-inch chain. Handmade.",
                "Axum Silver", "NEW", 6500, null, 40, 12, List.of("necklace", "silver", "cross")),
        new DemoProduct("kids-baby", "Kids' Traditional Outfit Set",
                "Two-piece cotton set with embroidered trim. Ages 4–6.",
                "Addis Threads", "NEW", 4200, null, 250, 10, List.of("kids", "traditional")),
        new DemoProduct("home-garden", "Clay Injera Grill (Mitad)",
                "Traditional clay griddle for injera and flatbread. Seasoned and ready to use.",
                "Entoto Pottery", "NEW", 8500, null, 4500, 6, List.of("mitad", "injera", "kitchen")),
        new DemoProduct("books-media", "Amharic Children's Book Set (4 books)",
                "Illustrated storybooks for early readers — English and Amharic side by side.",
                "Selam Books", "NEW", 2800, null, 700, 20, List.of("books", "amharic", "children")),
        new DemoProduct("music-instruments", "Krar — 5-String Lyre",
                "Hand-carved bowl lyre with goatskin resonator. Tuned and ready to play.",
                "Azmari Workshop", "NEW", 16000, null, 1500, 3, List.of("krar", "instrument", "lyre")),
        new DemoProduct("women-clothing", "Silk Headwrap — Gold",
                "Lightweight silk headwrap, 180 × 60 cm. Hand-finished edges.",
                "Harar Silk", "NEW", 2200, null, 90, 25, List.of("headwrap", "silk", "scarf"))
    );
}
