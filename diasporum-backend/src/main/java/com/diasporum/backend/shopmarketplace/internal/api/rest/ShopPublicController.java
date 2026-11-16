package com.diasporum.backend.shopmarketplace.internal.api.rest;

import com.diasporum.backend.security.DiasporumUserPrincipal;
import com.diasporum.backend.shopmarketplace.internal.application.CatalogQueryService;
import com.diasporum.backend.shopmarketplace.internal.application.MarketService;
import com.diasporum.backend.shopmarketplace.internal.application.ShopSupport;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.AttributeDefinition;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Category;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Market;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Page;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ProductCard;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ProductDetail;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Review;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SearchFilters;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShopDetail;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Public marketplace browsing — no secrets, no provider internals, catalogue only. */
@RestController
@RequestMapping("/api/v1/shop")
public class ShopPublicController {
    private final MarketService markets;
    private final CatalogQueryService catalog;

    public ShopPublicController(MarketService markets, CatalogQueryService catalog) {
        this.markets = markets;
        this.catalog = catalog;
    }

    private static UUID actor(DiasporumUserPrincipal principal) {
        return principal == null ? null : principal.userId();
    }

    @GetMapping("/markets")
    public List<Market> markets() {
        return markets.markets();
    }

    @GetMapping("/markets/{countryId}")
    public Market market(@PathVariable UUID countryId) {
        return markets.requireBrowsable(countryId);
    }

    @GetMapping("/categories")
    public List<Category> categories(@RequestParam(required = false) String languageCode,
            @RequestParam(required = false) UUID parentId,
            @RequestParam(required = false, defaultValue = "false") boolean all) {
        return catalog.categories(languageCode, parentId, all);
    }

    @GetMapping("/categories/{categoryId}/attributes")
    public List<AttributeDefinition> attributes(@PathVariable UUID categoryId) {
        return catalog.attributes(categoryId);
    }

    @GetMapping("/products")
    public Page<ProductCard> search(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam UUID marketCountryId,
            @RequestParam(required = false) String currencyCode,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) UUID categoryId,
            @RequestParam(required = false) UUID shopId,
            @RequestParam(required = false) List<String> conditions,
            @RequestParam(required = false) String brand,
            @RequestParam(required = false) Long minPriceMinor,
            @RequestParam(required = false) Long maxPriceMinor,
            @RequestParam(required = false) List<String> attribute,
            @RequestParam(required = false, defaultValue = "false") boolean inStockOnly,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return catalog.search(actor(principal), new SearchFilters(marketCountryId, currencyCode, q,
                categoryId, shopId, conditions, brand, minPriceMinor, maxPriceMinor,
                attributes(attribute), inStockOnly, sort), cursor, size);
    }

    /** Repeated {@code attribute=<key>=<optionKey>} params → attribute key → option keys. */
    private static Map<String, List<String>> attributes(List<String> values) {
        Map<String, List<String>> result = new LinkedHashMap<>();
        if (values == null) {
            return result;
        }
        for (String value : values) {
            int separator = value == null ? -1 : value.indexOf('=');
            if (separator <= 0 || separator == value.length() - 1) {
                throw ShopSupport.badRequest("INVALID_ATTRIBUTE_FILTER");
            }
            result.computeIfAbsent(value.substring(0, separator), k -> new ArrayList<>())
                    .add(value.substring(separator + 1));
        }
        return result;
    }

    @GetMapping("/products/{productId}")
    public ProductDetail product(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID productId,
            @RequestParam UUID marketCountryId,
            @RequestParam(required = false) String currencyCode) {
        return catalog.product(actor(principal), productId, marketCountryId, currencyCode);
    }

    @GetMapping("/products/{productId}/reviews")
    public Page<Review> productReviews(@PathVariable UUID productId,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return catalog.productReviews(productId, cursor, size);
    }

    @GetMapping("/shops/{shopId}")
    public ShopDetail shop(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID shopId) {
        return catalog.shop(actor(principal), shopId);
    }

    @GetMapping("/shops/{shopId}/reviews")
    public Page<Review> shopReviews(@PathVariable UUID shopId,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return catalog.shopReviews(shopId, false, cursor, size);
    }

    @GetMapping("/shops/{shopId}/products")
    public Page<ProductCard> shopProducts(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID shopId,
            @RequestParam UUID marketCountryId,
            @RequestParam(required = false) String currencyCode,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) UUID categoryId,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return catalog.search(actor(principal), new SearchFilters(marketCountryId, currencyCode, q,
                categoryId, shopId, List.of(), null, null, null, Map.of(), false, sort), cursor, size);
    }
}
