package com.diasporum.backend.shopmarketplace;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import com.diasporum.backend.shopmarketplace.internal.application.CartService;
import com.diasporum.backend.shopmarketplace.internal.application.CatalogQueryService;
import com.diasporum.backend.shopmarketplace.internal.application.CheckoutService;
import com.diasporum.backend.shopmarketplace.internal.application.DiscountService;
import com.diasporum.backend.shopmarketplace.internal.application.InventoryService;
import com.diasporum.backend.shopmarketplace.internal.application.MarketplaceAdminService;
import com.diasporum.backend.shopmarketplace.internal.application.ProductService;
import com.diasporum.backend.shopmarketplace.internal.application.SellerService;
import com.diasporum.backend.shopmarketplace.internal.application.ShippingConfigService;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.AddressInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Cart;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.CheckoutQuote;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.DiscountCode;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.DiscountCodeInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.InventoryLocation;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Page;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.PriceInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ProductCard;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ProductInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.QuoteRequest;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Seller;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerShopDetail;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SearchFilters;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerProduct;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingMethodInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingMethodView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingProfileInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingRules;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingZoneView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.VariantInput;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * Shop marketplace on real migrated PostgreSQL/PostGIS: V28 migration invariants plus the
 * seller→shop→product→cart→checkout-quote pipeline with AUTO_APPROVE moderation and the
 * approved no-collection tax provider. Payment/label providers are intentionally
 * unconfigured — those paths must fail closed, not silently succeed.
 */
@SpringBootTest(properties = {"diasporum.shop.moderation-mode=AUTO_APPROVE",
        "diasporum.shop.reviews-auto-publish=true"})
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class ShopMarketplaceIntegrationTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired SellerService sellers;
    @Autowired ProductService products;
    @Autowired CatalogQueryService catalog;
    @Autowired CartService carts;
    @Autowired CheckoutService checkout;
    @Autowired InventoryService inventory;
    @Autowired ShippingConfigService shipping;
    @Autowired DiscountService discounts;
    @Autowired MarketplaceAdminService admin;
    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;

    private UUID sellerUser;
    private UUID buyerUser;
    private UUID marketCountryId;
    private UUID shopId;
    private UUID categoryId;

    @BeforeEach
    void setup() {
        jdbc.execute("TRUNCATE order_items,seller_orders,orders,checkout_items,checkout_sessions,"
                + "inventory_reservations,inventory_movements,inventory_items,product_variant_prices,"
                + "product_variant_attribute_values,product_variants,product_market_availability,"
                + "product_media,products,shipping_method_rules,shipping_methods,"
                + "shipping_zone_countries,shipping_zones,shop_shipping_profiles,inventory_locations,"
                + "shop_policies,shop_media,shops,shopping_cart_items,shopping_carts,"
                + "wishlist_items,wishlists,discount_redemptions,discount_codes,addresses,"
                + "tax_calculations,marketplace_sellers,media_objects,marketplace_webhook_events,"
                + "marketplace_country_settings,tax_provider_configurations,"
                + "marketplace_commission_rules,product_categories CASCADE");
        sellerUser = user("shop-seller");
        buyerUser = user("shop-buyer");
        marketCountryId = jdbc.queryForObject("SELECT id FROM countries LIMIT 1", UUID.class);
        jdbc.update("INSERT INTO marketplace_country_settings(country_id,market_status,"
                + "buyer_checkout_enabled,seller_onboarding_enabled,shipping_enabled,tax_enabled,"
                + "default_currency,supported_currencies) VALUES(?,'ACTIVE',true,true,true,true,"
                + "'USD',ARRAY['USD'])", marketCountryId);
        jdbc.update("INSERT INTO tax_provider_configurations(provider_key,country_id,environment,"
                + "is_enabled,non_secret_configuration) VALUES('NO_COLLECTION',?,'TEST',true,"
                + "'{\"approvalReference\":\"test-approval\"}'::jsonb)", marketCountryId);
        categoryId = UUID.randomUUID();
        jdbc.update("INSERT INTO product_categories(id,category_key,is_active) VALUES(?,?,true)",
                categoryId, "test-cat-" + categoryId.toString().substring(0, 8));
        Seller seller = sellers.createSeller(sellerUser, "INDIVIDUAL", null, marketCountryId,
                "Seller Legal", "Seller Display");
        SellerShopDetail shop = sellers.createShop(sellerUser, seller.id(), "Test Shop",
                "A test shop", marketCountryId);
        shopId = shop.shop().id();
        // submitShop requires shipping profile, an active shipping method and a returns policy.
        sellers.updateShippingProfile(sellerUser, shopId, new ShippingProfileInput(
                new AddressInput(marketCountryId, "1 Test St", null, "Testville", null, "12345"),
                1, 3, null, null, null, null));
        ShippingZoneView zone = shipping.saveZone(sellerUser, shopId, null, "Domestic",
                List.of(marketCountryId));
        shipping.saveMethod(sellerUser, shopId, zone.id(), null, new ShippingMethodInput(
                "Standard", "FLAT_RATE", "USD",
                new ShippingRules(500L, null, null, null, 2, 5)));
        sellers.updatePolicy(sellerUser, shopId, "RETURNS", "30-day returns accepted.");
        sellers.submitShop(sellerUser, shopId);
    }

    private UUID user(String subject) {
        UUID userId = IdentityTestSupport.provision(ctx, ISSUER, subject + "-" + UUID.randomUUID());
        jdbc.update("UPDATE profiles SET profile_completed_at=now() WHERE id=?", userId);
        return userId;
    }

    private RequestPostProcessor asUser(UUID userId) {
        return authentication(new UsernamePasswordAuthenticationToken(
                new DiasporumUserPrincipal(userId, UUID.randomUUID(),
                        userId + "@test.invalid", List.of()), null, List.of()));
    }

    private UUID media(UUID owner) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,object_key,purpose,"
                + "access_scope,status,mime_type) VALUES(?,?,'test-bucket',?,'PRODUCT','PUBLIC',"
                + "'READY','image/jpeg')", id, owner, "k/" + id);
        return id;
    }

    private SellerProduct publishedProduct(UUID imageId) {
        SellerProduct created = products.create(sellerUser, shopId, new ProductInput(categoryId,
                "Vintage Denim Jacket", "Nice jacket", "Levis", "USED_GOOD", Map.of(), List.of("denim"),
                List.of(imageId), List.of(marketCountryId),
                List.of(new VariantInput(null, "M", "SKU-1", null, 500, null, null, null,
                        List.of(), List.of(new PriceInput(marketCountryId, "USD", 4000, null)),
                                5))));
        return products.publish(sellerUser, shopId, created.id());
    }

    @Test
    void migrationCreatesMarketplaceTables() {
        Integer tables = jdbc.queryForObject("SELECT count(*) FROM information_schema.tables "
                + "WHERE table_schema='public' AND table_name IN ('shops','products','orders',"
                + "'seller_orders','marketplace_payments','shipping_labels','return_requests',"
                + "'marketplace_commission_rules','inventory_reservations','marketplace_webhook_events')",
                Integer.class);
        assertEquals(10, tables);
    }

    @Test
    void sellerOnboardingShopAndProductFlowPublishesToCatalog() {
        assertEquals("ACTIVE", jdbc.queryForObject("SELECT status FROM shops WHERE id=?",
                String.class, shopId));
        UUID imageId = media(sellerUser);
        SellerProduct product = publishedProduct(imageId);
        assertEquals("PUBLISHED", product.status());
        Page<ProductCard> page = catalog.search(buyerUser,
                new SearchFilters(marketCountryId, "USD", "denim", null, null, List.of(), null,
                        null, null, Map.of(), false, null), null, null);
        assertEquals(1, page.items().size());
        assertEquals("Vintage Denim Jacket", page.items().getFirst().name());
        assertEquals(4000, page.items().getFirst().price().amountMinor());
    }

    @Test
    void cartGroupsItemsByShopAndRejectsForeignMarket() {
        UUID imageId = media(sellerUser);
        SellerProduct product = publishedProduct(imageId);
        UUID variantId = product.variants().getFirst().id();
        Cart cart = carts.add(buyerUser, variantId, 2, marketCountryId, "USD");
        assertEquals(1, cart.groups().size());
        assertEquals(2, cart.groups().getFirst().items().getFirst().quantity());
        assertEquals(8000, cart.subtotal().amountMinor());
        assertEquals(2, carts.count(buyerUser));
        cart = carts.updateQuantity(buyerUser, cart.groups().getFirst().items().getFirst().id(),
                1, marketCountryId);
        assertEquals(1, cart.groups().getFirst().items().getFirst().quantity());
    }

    @Test
    void wishlistTogglesFavourites() {
        SellerProduct product = publishedProduct(media(sellerUser));
        carts.addToWishlist(buyerUser, product.id());
        assertFalse(carts.wishlist(buyerUser, marketCountryId, "USD").isEmpty());
        assertTrue(catalog.search(buyerUser, new SearchFilters(marketCountryId, "USD", null, null,
                null, List.of(), null, null, null, Map.of(), false, null), null, null)
                .items().getFirst().favourited());
        carts.removeFromWishlist(buyerUser, product.id());
        assertTrue(carts.wishlist(buyerUser, marketCountryId, "USD").isEmpty());
    }

    @Test
    void shippingZoneAndFlatRateMethodQuoteCheckout() {
        SellerProduct product = publishedProduct(media(sellerUser));
        UUID variantId = product.variants().getFirst().id();
        sellers.updateShippingProfile(sellerUser, shopId,
                new com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingProfileInput(
                        new AddressInput(marketCountryId, "1 Seller St", null, "Town", null, "10001"),
                        1, 3, 500, 300, 200, 50));
        ShippingZoneView zone = shipping.saveZone(sellerUser, shopId, null, "Domestic B",
                List.of(marketCountryId));
        ShippingMethodView method = shipping.saveMethod(sellerUser, shopId, zone.id(), null,
                new ShippingMethodInput("Standard", "FLAT_RATE", "USD",
                        new ShippingRules(500L, null, null, null, 3, 5)));
        carts.add(buyerUser, variantId, 1, marketCountryId, "USD");
        var address = carts.createAddress(buyerUser,
                new AddressInput(marketCountryId, "9 Buyer Rd", null, "Town", null, "10001"));
        CheckoutQuote quote = checkout.quote(buyerUser, new QuoteRequest(marketCountryId, "USD",
                address.id(), "Buyer Name", null, Map.of(shopId, "METHOD:" + method.id()),
                List.of()));
        // Quote is valid (shipping 500, no tax, no blocking issues). Stripe is not
        // configured, so placement must fail closed rather than create a fake order.
        assertTrue(quote.canPlaceOrder());
        assertEquals(500, quote.totals().shipping().amountMinor(),
                () -> "blocking=" + quote.blockingIssues());
        assertEquals(4500, quote.totals().total().amountMinor());
        // Placement must fail closed, not create a fake order.
        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> checkout.place(buyerUser, quote.checkoutSessionId()));
        assertEquals("PAYMENT_PROVIDER_UNAVAILABLE", ex.getReason());
    }

    @Test
    void discountCodeAppliesAndDeactivates() {
        DiscountCode code = discounts.create(sellerUser, shopId, new DiscountCodeInput("SAVE10",
                "PERCENTAGE", new BigDecimal("10"), "USD", null, null, null,
                java.time.Instant.now().minusSeconds(60), java.time.Instant.now().plusSeconds(86400)));
        assertEquals("ACTIVE", code.status());
        long applied = discounts.apply(sellerUser, shopId, "save10", 4000, "USD");
        assertEquals(400, applied);
        discounts.setStatus(sellerUser, shopId, code.id(), "PAUSED");
        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> discounts.apply(sellerUser, shopId, "SAVE10", 4000, "USD"));
        assertEquals(400, ex.getStatusCode().value());
    }

    @Test
    void inventoryAdjustmentWritesBalancedMovements() {
        SellerProduct product = publishedProduct(media(sellerUser));
        UUID variantId = product.variants().getFirst().id();
        InventoryLocation location = sellers.createLocation(sellerUser, shopId, "Main",
                new AddressInput(marketCountryId, "1 Depot", null, "Town", null, "10001"));
        var row = inventory.adjust(sellerUser, shopId, variantId, location.id(), 3, "ADJUSTMENT",
                "count fix", null);
        assertEquals(3, row.onHand());
        assertFalse(inventory.movements(sellerUser, shopId, row.inventoryItemId()).isEmpty());
    }

    @Test
    void strangersCannotManageShopAndRestExposesCatalogue() throws Exception {
        ResponseStatusException denied = assertThrows(ResponseStatusException.class,
                () -> sellers.shopDetail(buyerUser, shopId));
        assertEquals(404, denied.getStatusCode().value());
        SellerProduct product = publishedProduct(media(sellerUser));
        jdbc.update("UPDATE products SET attributes='{\"colour\":\"navy\"}'::jsonb WHERE id=?", product.id());
        mvc.perform(get("/api/v1/shop/products")
                        .param("marketCountryId", marketCountryId.toString())
                        .param("q", "denim").param("size", "20")
                        .with(asUser(buyerUser)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].name").value("Vintage Denim Jacket"))
                .andExpect(jsonPath("$.items[0].price.amountMinor").value(4000));
        mvc.perform(get("/api/v1/shop/products")
                        .param("marketCountryId", marketCountryId.toString())
                        .param("attribute", "colour=navy")
                        .with(asUser(buyerUser)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].name").value("Vintage Denim Jacket"));
        mvc.perform(get("/api/v1/shop/products")
                        .param("marketCountryId", marketCountryId.toString())
                        .param("attribute", "colour=red")
                        .with(asUser(buyerUser)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isEmpty());
        mvc.perform(get("/api/v1/shop/products")
                        .param("marketCountryId", marketCountryId.toString())
                        .param("attribute", "colour")
                        .with(asUser(buyerUser)))
                .andExpect(status().isBadRequest());
    }
}
