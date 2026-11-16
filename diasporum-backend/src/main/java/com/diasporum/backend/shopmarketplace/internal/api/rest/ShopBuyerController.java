package com.diasporum.backend.shopmarketplace.internal.api.rest;

import com.diasporum.backend.security.DiasporumUserPrincipal;
import com.diasporum.backend.shopmarketplace.internal.application.CartService;
import com.diasporum.backend.shopmarketplace.internal.application.CheckoutService;
import com.diasporum.backend.shopmarketplace.internal.application.OrderService;
import com.diasporum.backend.shopmarketplace.internal.application.OrderService.ReturnItemInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.AddressInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.AddressView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Cart;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.CheckoutQuote;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.OrderDetail;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.OrderSummary;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Page;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.PlacedOrder;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ProductCard;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.QuoteRequest;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ReturnRequestView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Review;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
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
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RequestHeader;

/** Buyer-facing marketplace workflows: cart, wishlist, addresses, checkout, orders. */
@RestController
@RequestMapping("/api/v1/shop/me")
public class ShopBuyerController {
    private final CartService cart;
    private final CheckoutService checkout;
    private final OrderService orders;

    public ShopBuyerController(CartService cart, CheckoutService checkout, OrderService orders) {
        this.cart = cart;
        this.checkout = checkout;
        this.orders = orders;
    }

    // ------------------------------------------------------------------ cart

    @GetMapping("/cart")
    public Cart cart(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam UUID marketCountryId,
            @RequestParam(required = false) String currencyCode) {
        return cart.cart(p.userId(), marketCountryId, currencyCode);
    }

    @GetMapping("/cart/count")
    public Map<String, Integer> cartCount(@AuthenticationPrincipal DiasporumUserPrincipal p) {
        return Map.of("count", cart.count(p.userId()));
    }

    public record AddToCartBody(@NotNull UUID variantId, @Min(1) @Max(99) int quantity,
            @NotNull UUID marketCountryId, String currencyCode) {
    }

    @PostMapping("/cart/items")
    public Cart addToCart(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @Valid @RequestBody AddToCartBody body) {
        return cart.add(p.userId(), body.variantId(), body.quantity(), body.marketCountryId(),
                body.currencyCode());
    }

    public record UpdateCartItemBody(@Min(1) @Max(99) int quantity, @NotNull UUID marketCountryId) {
    }

    @PutMapping("/cart/items/{itemId}")
    public Cart updateCartItem(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID itemId, @Valid @RequestBody UpdateCartItemBody body) {
        return cart.updateQuantity(p.userId(), itemId, body.quantity(), body.marketCountryId());
    }

    @DeleteMapping("/cart/items/{itemId}")
    public Cart removeCartItem(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID itemId, @RequestParam UUID marketCountryId) {
        return cart.remove(p.userId(), itemId, marketCountryId);
    }

    // ------------------------------------------------------------------ wishlist

    @GetMapping("/wishlist")
    public List<ProductCard> wishlist(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam UUID marketCountryId,
            @RequestParam(required = false) String currencyCode) {
        return cart.wishlist(p.userId(), marketCountryId, currencyCode);
    }

    @PostMapping("/wishlist/{productId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void favourite(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID productId) {
        cart.addToWishlist(p.userId(), productId);
    }

    @DeleteMapping("/wishlist/{productId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unfavourite(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID productId) {
        cart.removeFromWishlist(p.userId(), productId);
    }

    // ------------------------------------------------------------------ addresses

    @GetMapping("/addresses")
    public List<AddressView> addresses(@AuthenticationPrincipal DiasporumUserPrincipal p) {
        return cart.addresses(p.userId());
    }

    @PostMapping("/addresses")
    public AddressView createAddress(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @Valid @RequestBody AddressInput body) {
        return cart.createAddress(p.userId(), body);
    }

    @PutMapping("/addresses/{addressId}")
    public AddressView updateAddress(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID addressId, @Valid @RequestBody AddressInput body) {
        return cart.updateAddress(p.userId(), addressId, body);
    }

    @DeleteMapping("/addresses/{addressId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteAddress(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID addressId) {
        cart.deleteAddress(p.userId(), addressId);
    }

    // ------------------------------------------------------------------ checkout

    @PostMapping("/checkout/quote")
    public CheckoutQuote quote(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @Valid @RequestBody QuoteRequest body) {
        return checkout.quote(p.userId(), body);
    }

    @PostMapping("/checkout/{sessionId}/place")
    public PlacedOrder place(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID sessionId) {
        return checkout.place(p.userId(), sessionId);
    }

    // ------------------------------------------------------------------ orders

    @GetMapping("/orders")
    public Page<OrderSummary> orders(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam(required = false) String filter,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return orders.list(p.userId(), filter, cursor, size);
    }

    @GetMapping("/orders/{orderId}")
    public OrderDetail order(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID orderId) {
        return orders.detail(p.userId(), orderId);
    }

    @PostMapping("/orders/{orderId}/cancel")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void cancelOrder(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID orderId) {
        orders.cancelOrder(p.userId(), orderId);
    }

    public record ReturnRequestBody(@NotBlank @Size(max = 60) String reasonCode,
            @Size(max = 2000) String description,
            @NotEmpty @Size(max = 100) List<@Valid ReturnItemInput> items,
            @Size(max = 10) List<UUID> mediaIds) {
    }

    @PostMapping("/seller-orders/{sellerOrderId}/returns")
    public ReturnRequestView requestReturn(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID sellerOrderId, @Valid @RequestBody ReturnRequestBody body) {
        return orders.requestReturn(p.userId(), sellerOrderId, body.reasonCode(), body.description(),
                body.items(), body.mediaIds() == null ? List.of() : body.mediaIds());
    }

    public record ProductReviewBody(@Min(1) @Max(5) int rating,
            @NotBlank @Size(max = 4000) String text,
            @Size(max = 6) List<UUID> mediaIds) {
    }

    @PostMapping("/order-items/{orderItemId}/review")
    public Review reviewProduct(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID orderItemId, @Valid @RequestBody ProductReviewBody body) {
        return orders.reviewProduct(p.userId(), orderItemId, body.rating(), body.text(),
                body.mediaIds() == null ? List.of() : body.mediaIds());
    }

    public record ShopReviewBody(@Min(1) @Max(5) int rating,
            @NotBlank @Size(max = 4000) String text) {
    }

    @PostMapping("/seller-orders/{sellerOrderId}/review")
    public Review reviewShop(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID sellerOrderId, @Valid @RequestBody ShopReviewBody body) {
        return orders.reviewShop(p.userId(), sellerOrderId, body.rating(), body.text());
    }
}
