package com.diasporum.backend.shopmarketplace.internal.api.rest;

import com.diasporum.backend.security.DiasporumUserPrincipal;
import com.diasporum.backend.shopmarketplace.internal.application.DiscountService;
import com.diasporum.backend.shopmarketplace.internal.application.EarningsService;
import com.diasporum.backend.shopmarketplace.internal.application.InventoryService;
import com.diasporum.backend.shopmarketplace.internal.application.ProductService;
import com.diasporum.backend.shopmarketplace.internal.application.SellerOrderService;
import com.diasporum.backend.shopmarketplace.internal.application.SellerService;
import com.diasporum.backend.shopmarketplace.internal.application.ShippingConfigService;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Dashboard;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.DiscountCode;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.DiscountCodeInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Earnings;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.InventoryLocation;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.InventoryMovement;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.InventoryRow;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.OnboardingLink;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Page;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.PaymentAccount;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ProductInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.RateView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ReturnRequestView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Review;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Seller;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerOnboarding;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerOrderDetail;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerOrderSummary;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerProduct;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerProductRow;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerShop;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerShopDetail;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Shipment;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShipmentInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingConfig;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingMethodInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingMethodView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingProfile;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingProfileInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingZoneView;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Seller workspace endpoints. Every operation resolves the actor from the JWT and
 * validates ownership/business membership server-side via SellerAccessPolicy.
 */
@RestController
@RequestMapping("/api/v1/shop/seller")
public class ShopSellerController {
    private final SellerService sellers;
    private final ProductService products;
    private final InventoryService inventory;
    private final ShippingConfigService shipping;
    private final DiscountService discounts;
    private final SellerOrderService orders;
    private final EarningsService earnings;

    public ShopSellerController(SellerService sellers, ProductService products,
            InventoryService inventory, ShippingConfigService shipping, DiscountService discounts,
            SellerOrderService orders, EarningsService earnings) {
        this.sellers = sellers;
        this.products = products;
        this.inventory = inventory;
        this.shipping = shipping;
        this.discounts = discounts;
        this.orders = orders;
        this.earnings = earnings;
    }

    // ------------------------------------------------------------------ onboarding

    @GetMapping("/onboarding")
    public SellerOnboarding onboarding(@AuthenticationPrincipal DiasporumUserPrincipal p) {
        return sellers.onboarding(p.userId());
    }

    public record CreateSellerBody(@NotBlank String sellerType, UUID businessAccountId,
            @NotNull UUID legalCountryId, @NotBlank @Size(max = 240) String legalName,
            @NotBlank @Size(max = 180) String displayName) {
    }

    @PostMapping("/sellers")
    public Seller createSeller(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @Valid @RequestBody CreateSellerBody body) {
        return sellers.createSeller(p.userId(), body.sellerType(), body.businessAccountId(),
                body.legalCountryId(), body.legalName(), body.displayName());
    }

    @GetMapping("/shops")
    public List<SellerShop> shops(@AuthenticationPrincipal DiasporumUserPrincipal p) {
        return sellers.shops(p.userId());
    }

    public record CreateShopBody(@NotNull UUID sellerId, @NotBlank @Size(max = 160) String name,
            @Size(max = 4000) String description, @NotNull UUID marketCountryId) {
    }

    @PostMapping("/shops")
    public SellerShopDetail createShop(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @Valid @RequestBody CreateShopBody body) {
        return sellers.createShop(p.userId(), body.sellerId(), body.name(), body.description(),
                body.marketCountryId());
    }

    @GetMapping("/shops/{shopId}")
    public SellerShopDetail shopDetail(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId) {
        return sellers.shopDetail(p.userId(), shopId);
    }

    public record UpdateShopBody(@NotBlank @Size(max = 160) String name,
            @Size(max = 4000) String description) {
    }

    @PutMapping("/shops/{shopId}")
    public SellerShopDetail updateShop(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @Valid @RequestBody UpdateShopBody body) {
        return sellers.updateShop(p.userId(), shopId, body.name(), body.description());
    }

    public record ShopMediaBody(UUID logoMediaId, UUID coverMediaId, List<UUID> galleryMediaIds) {
    }

    @PutMapping("/shops/{shopId}/media")
    public SellerShopDetail updateShopMedia(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @RequestBody ShopMediaBody body) {
        return sellers.updateMedia(p.userId(), shopId, body.logoMediaId(), body.coverMediaId(),
                body.galleryMediaIds() == null ? List.of() : body.galleryMediaIds());
    }

    public record PolicyBody(@NotBlank @Size(max = 20000) String text) {
    }

    @PutMapping("/shops/{shopId}/policies/{policyType}")
    public SellerShopDetail updatePolicy(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable String policyType,
            @Valid @RequestBody PolicyBody body) {
        return sellers.updatePolicy(p.userId(), shopId, policyType, body.text());
    }

    @PostMapping("/shops/{shopId}/submit")
    public SellerShopDetail submitShop(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId) {
        return sellers.submitShop(p.userId(), shopId);
    }

    @PostMapping("/shops/{shopId}/pause")
    public SellerShopDetail pauseShop(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId) {
        return sellers.pauseShop(p.userId(), shopId);
    }

    @GetMapping("/shops/{shopId}/dashboard")
    public Dashboard dashboard(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId) {
        return sellers.dashboard(p.userId(), shopId);
    }

    // ------------------------------------------------------------------ payment account

    @GetMapping("/shops/{shopId}/payment-account")
    public PaymentAccount paymentAccount(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId) {
        return sellers.paymentStatus(p.userId(), shopId);
    }

    @PostMapping("/shops/{shopId}/payment-account/onboarding-link")
    public OnboardingLink onboardingLink(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId) {
        return sellers.onboardingLink(p.userId(), shopId);
    }

    // ------------------------------------------------------------------ inventory locations

    @GetMapping("/shops/{shopId}/locations")
    public List<InventoryLocation> locations(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId) {
        return sellers.locations(p.userId(), shopId);
    }

    public record CreateLocationBody(@NotBlank @Size(max = 120) String name,
            @NotNull com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.AddressInput address) {
    }

    @PostMapping("/shops/{shopId}/locations")
    public InventoryLocation createLocation(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @Valid @RequestBody CreateLocationBody body) {
        return sellers.createLocation(p.userId(), shopId, body.name(), body.address());
    }

    // ------------------------------------------------------------------ products

    @GetMapping("/shops/{shopId}/products")
    public Page<SellerProductRow> products(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return products.list(p.userId(), shopId, status, q, cursor, size);
    }

    @GetMapping("/shops/{shopId}/products/{productId}")
    public SellerProduct product(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID productId) {
        return products.get(p.userId(), shopId, productId);
    }

    @PostMapping("/shops/{shopId}/products")
    public SellerProduct createProduct(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @Valid @RequestBody ProductInput body) {
        return products.create(p.userId(), shopId, body);
    }

    @PutMapping("/shops/{shopId}/products/{productId}")
    public SellerProduct updateProduct(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID productId,
            @Valid @RequestBody ProductInput body) {
        return products.update(p.userId(), shopId, productId, body);
    }

    @PostMapping("/shops/{shopId}/products/{productId}/publish")
    public SellerProduct publishProduct(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID productId) {
        return products.publish(p.userId(), shopId, productId);
    }

    @PostMapping("/shops/{shopId}/products/{productId}/pause")
    public SellerProduct pauseProduct(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID productId) {
        return products.pause(p.userId(), shopId, productId);
    }

    @PostMapping("/shops/{shopId}/products/{productId}/archive")
    public SellerProduct archiveProduct(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID productId) {
        return products.archive(p.userId(), shopId, productId);
    }

    // ------------------------------------------------------------------ inventory

    @GetMapping("/shops/{shopId}/inventory")
    public List<InventoryRow> inventory(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId,
            @RequestParam(required = false, defaultValue = "false") boolean lowOnly,
            @RequestParam(required = false) String q) {
        return inventory.list(p.userId(), shopId, lowOnly, q);
    }

    public record AdjustBody(@NotNull UUID variantId, @NotNull UUID locationId,
            @Min(-1000000) @Max(1000000) int delta, String movementType,
            @Size(max = 500) String reason, Integer lowStockThreshold) {
    }

    @PostMapping("/shops/{shopId}/inventory/adjustments")
    public InventoryRow adjust(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @Valid @RequestBody AdjustBody body) {
        return inventory.adjust(p.userId(), shopId, body.variantId(), body.locationId(),
                body.delta(), body.movementType(), body.reason(), body.lowStockThreshold());
    }

    @GetMapping("/shops/{shopId}/inventory/{inventoryItemId}/movements")
    public List<InventoryMovement> movements(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID inventoryItemId) {
        return inventory.movements(p.userId(), shopId, inventoryItemId);
    }

    // ------------------------------------------------------------------ shipping config

    @GetMapping("/shops/{shopId}/shipping")
    public ShippingConfig shippingConfig(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId) {
        return shipping.config(p.userId(), shopId);
    }

    @PutMapping("/shops/{shopId}/shipping/profile")
    public ShippingProfile updateShippingProfile(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @Valid @RequestBody ShippingProfileInput body) {
        return sellers.updateShippingProfile(p.userId(), shopId, body);
    }

    public record ZoneBody(@NotBlank @Size(max = 120) String name,
            @NotNull @Size(min = 1, max = 250) List<UUID> countryIds) {
    }

    @PostMapping("/shops/{shopId}/shipping/zones")
    public ShippingZoneView createZone(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @Valid @RequestBody ZoneBody body) {
        return shipping.saveZone(p.userId(), shopId, null, body.name(), body.countryIds());
    }

    @PutMapping("/shops/{shopId}/shipping/zones/{zoneId}")
    public ShippingZoneView updateZone(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID zoneId, @Valid @RequestBody ZoneBody body) {
        return shipping.saveZone(p.userId(), shopId, zoneId, body.name(), body.countryIds());
    }

    @DeleteMapping("/shops/{shopId}/shipping/zones/{zoneId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteZone(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID zoneId) {
        shipping.deleteZone(p.userId(), shopId, zoneId);
    }

    @PostMapping("/shops/{shopId}/shipping/zones/{zoneId}/methods")
    public ShippingMethodView createMethod(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID zoneId,
            @Valid @RequestBody ShippingMethodInput body) {
        return shipping.saveMethod(p.userId(), shopId, zoneId, null, body);
    }

    @PutMapping("/shops/{shopId}/shipping/methods/{methodId}")
    public ShippingMethodView updateMethod(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID methodId,
            @Valid @RequestBody ShippingMethodInput body) {
        return shipping.saveMethod(p.userId(), shopId, null, methodId, body);
    }

    @DeleteMapping("/shops/{shopId}/shipping/methods/{methodId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteMethod(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID methodId) {
        shipping.deleteMethod(p.userId(), shopId, methodId);
    }

    // ------------------------------------------------------------------ discounts

    @GetMapping("/shops/{shopId}/discounts")
    public List<DiscountCode> discounts(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId) {
        return discounts.list(p.userId(), shopId);
    }

    @PostMapping("/shops/{shopId}/discounts")
    public DiscountCode createDiscount(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @Valid @RequestBody DiscountCodeInput body) {
        return discounts.create(p.userId(), shopId, body);
    }

    public record DiscountStatusBody(@NotBlank String status) {
    }

    @PostMapping("/shops/{shopId}/discounts/{codeId}/status")
    public DiscountCode discountStatus(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID codeId,
            @Valid @RequestBody DiscountStatusBody body) {
        return discounts.setStatus(p.userId(), shopId, codeId, body.status());
    }

    // ------------------------------------------------------------------ seller orders

    @GetMapping("/shops/{shopId}/orders")
    public Page<SellerOrderSummary> sellerOrders(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId,
            @RequestParam(required = false) String filter,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return orders.list(p.userId(), shopId, filter, cursor, size);
    }

    @GetMapping("/shops/{shopId}/orders/{sellerOrderId}")
    public SellerOrderDetail sellerOrder(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID sellerOrderId) {
        return orders.detail(p.userId(), shopId, sellerOrderId);
    }

    @PostMapping("/shops/{shopId}/orders/{sellerOrderId}/accept")
    public SellerOrderDetail accept(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID sellerOrderId) {
        return orders.accept(p.userId(), shopId, sellerOrderId);
    }

    @PostMapping("/shops/{shopId}/orders/{sellerOrderId}/processing")
    public SellerOrderDetail markProcessing(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID sellerOrderId) {
        return orders.markProcessing(p.userId(), shopId, sellerOrderId);
    }

    public record CancelBody(@Size(max = 500) String reason) {
    }

    @PostMapping("/shops/{shopId}/orders/{sellerOrderId}/cancel")
    public SellerOrderDetail cancelOrder(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID sellerOrderId,
            @RequestBody(required = false) CancelBody body) {
        return orders.cancel(p.userId(), shopId, sellerOrderId,
                body == null ? null : body.reason());
    }

    // Order conversations are created through the messaging module's own
    // POST /api/v1/conversations endpoint (contextType=SHOP_ORDER) so this module
    // never depends back on messaging internals.

    // ------------------------------------------------------------------ shipments

    @PostMapping("/shops/{shopId}/orders/{sellerOrderId}/shipments")
    public Shipment createShipment(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID sellerOrderId,
            @Valid @RequestBody ShipmentInput body) {
        return orders.createShipment(p.userId(), shopId, sellerOrderId, body);
    }

    @GetMapping("/shops/{shopId}/orders/{sellerOrderId}/shipments/{shipmentId}/rates")
    public List<RateView> labelRates(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID sellerOrderId,
            @PathVariable UUID shipmentId) {
        return orders.labelRates(p.userId(), shopId, sellerOrderId, shipmentId);
    }

    public record BuyLabelBody(@NotBlank String rateId) {
    }

    @PostMapping("/shops/{shopId}/orders/{sellerOrderId}/shipments/{shipmentId}/label")
    public Shipment buyLabel(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID sellerOrderId,
            @PathVariable UUID shipmentId, @Valid @RequestBody BuyLabelBody body) {
        return orders.buyLabel(p.userId(), shopId, sellerOrderId, shipmentId, body.rateId());
    }

    @GetMapping("/shops/{shopId}/orders/{sellerOrderId}/shipments/{shipmentId}/label")
    public Map<String, String> labelUrl(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID sellerOrderId,
            @PathVariable UUID shipmentId) {
        return Map.of("url", orders.labelUrl(p.userId(), shopId, sellerOrderId, shipmentId));
    }

    @DeleteMapping("/shops/{shopId}/orders/{sellerOrderId}/shipments/{shipmentId}/label")
    public Shipment voidLabel(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID sellerOrderId,
            @PathVariable UUID shipmentId) {
        return orders.voidLabel(p.userId(), shopId, sellerOrderId, shipmentId);
    }

    @PostMapping("/shops/{shopId}/orders/{sellerOrderId}/shipments/{shipmentId}/dispatch")
    public SellerOrderDetail dispatch(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID sellerOrderId,
            @PathVariable UUID shipmentId) {
        return orders.dispatch(p.userId(), shopId, sellerOrderId, shipmentId);
    }

    public record TrackingEventBody(@NotBlank String eventCode, @Size(max = 500) String description) {
    }

    @PostMapping("/shops/{shopId}/orders/{sellerOrderId}/shipments/{shipmentId}/events")
    public Shipment addTrackingEvent(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID sellerOrderId,
            @PathVariable UUID shipmentId, @Valid @RequestBody TrackingEventBody body) {
        return orders.addTrackingEvent(p.userId(), shopId, sellerOrderId, shipmentId,
                body.eventCode(), body.description());
    }

    // ------------------------------------------------------------------ returns & reviews

    public record ReturnDecisionBody(boolean approve, @Size(max = 500) String decisionReason) {
    }

    @PostMapping("/shops/{shopId}/returns/{returnId}/decision")
    public ReturnRequestView decideReturn(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID returnId,
            @Valid @RequestBody ReturnDecisionBody body) {
        return orders.decideReturn(p.userId(), shopId, returnId, body.approve(), body.decisionReason());
    }

    public record ReceiveReturnBody(Long refundAmountMinor) {
    }

    @PostMapping("/shops/{shopId}/returns/{returnId}/receive")
    public ReturnRequestView receiveReturn(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID returnId,
            @RequestBody(required = false) ReceiveReturnBody body) {
        return orders.receiveReturn(p.userId(), shopId, returnId,
                body == null ? null : body.refundAmountMinor());
    }

    @GetMapping("/shops/{shopId}/reviews")
    public List<Review> shopReviews(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId) {
        return orders.shopReviews(p.userId(), shopId);
    }

    public record ReviewResponseBody(@NotBlank @Size(max = 2000) String response) {
    }

    @PostMapping("/shops/{shopId}/reviews/{reviewId}/response")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void respondToReview(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @PathVariable UUID reviewId,
            @Valid @RequestBody ReviewResponseBody body) {
        orders.respondToReview(p.userId(), shopId, reviewId, body.response());
    }

    // ------------------------------------------------------------------ earnings

    @GetMapping("/shops/{shopId}/earnings")
    public Earnings earnings(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId) {
        return earnings.earnings(p.userId(), shopId);
    }
}
