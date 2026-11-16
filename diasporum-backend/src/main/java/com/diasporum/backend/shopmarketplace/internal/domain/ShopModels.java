package com.diasporum.backend.shopmarketplace.internal.domain;

import java.time.Instant;
import java.util.Currency;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Shop Marketplace domain/view records. Amounts are integer currency minor units. */
public final class ShopModels {
    private ShopModels() {
    }

    /** A monetary amount with its ISO 4217 code and minor-unit exponent. */
    public record Money(long amountMinor, String currencyCode, int exponent) {
        public static Money of(long amountMinor, String currencyCode) {
            return new Money(amountMinor, currencyCode, exponent(currencyCode));
        }

        public static int exponent(String currencyCode) {
            try {
                int digits = Currency.getInstance(currencyCode).getDefaultFractionDigits();
                return Math.max(digits, 0);
            } catch (IllegalArgumentException e) {
                return 2;
            }
        }
    }

    public record Page<T>(List<T> items, String nextCursor) {
    }

    // ------------------------------------------------------------------ markets

    public record Market(UUID countryId, String countryName, String iso2, String flagEmoji,
            String marketStatus, boolean buyerCheckoutEnabled, boolean sellerOnboardingEnabled,
            boolean shippingEnabled, boolean taxEnabled, String defaultCurrency,
            List<String> supportedCurrencies, String disabledReason) {
    }

    // ------------------------------------------------------------------ catalogue

    public record Category(UUID id, UUID parentId, String categoryKey, String name,
            String description, int sortOrder, boolean hasChildren) {
    }

    public record AttributeOption(UUID id, String optionKey, String displayValue, int sortOrder) {
    }

    public record AttributeDefinition(UUID id, UUID categoryId, String attributeKey,
            String displayName, String dataType, boolean required, boolean filterable,
            boolean variantLevel, Map<String, Object> validationConfig, int sortOrder,
            List<AttributeOption> options) {
    }

    public record ProductCard(UUID id, UUID shopId, String shopName, String name, String brand,
            String condition, UUID imageMediaId, String imageUrl, Money price, Money compareAtPrice,
            String variantSummary, long favouriteCount, boolean favourited, boolean available,
            Instant publishedAt) {
    }

    public record SearchFilters(UUID marketCountryId, String currencyCode, String q, UUID categoryId,
            UUID shopId, List<String> conditions, String brand, Long minPriceMinor, Long maxPriceMinor,
            Map<String, List<String>> attributeOptions, boolean inStockOnly, String sort) {
    }

    public record MediaItem(UUID mediaId, String url, String role, int displayOrder, String altText) {
    }

    public record AttributeValueView(UUID definitionId, String attributeKey, String label,
            UUID optionId, String value) {
    }

    public record VariantView(UUID id, String label, String sku, String status,
            List<AttributeValueView> attributes, Money price, Money compareAtPrice,
            boolean available, boolean lowStock) {
    }

    public record VariantAxis(UUID definitionId, String attributeKey, String label,
            List<AttributeOption> options) {
    }

    public record SellerBadge(UUID shopId, String shopName, String slug, UUID logoMediaId,
            String logoUrl, String shopStatus, String sellerType, String sellerVerificationStatus,
            String sellerCountryName, Double ratingAverage, long ratingCount,
            UUID sellerUserId, UUID sellerBusinessAccountId) {
    }

    public record ShippingMethodSummary(String name, String methodType, boolean shipsToMarket) {
    }

    public record ShippingSummary(Integer handlingMinDays, Integer handlingMaxDays,
            List<ShippingMethodSummary> methods) {
    }

    public record MarketAvailability(String status, boolean purchasable, String reason) {
    }

    public record ProductDetail(UUID id, SellerBadge shop, Category category, String name,
            String slug, String description, String brand, String condition,
            List<AttributeValueView> attributes, List<MediaItem> media, List<VariantView> variants,
            List<VariantAxis> variantAxes, MarketAvailability marketAvailability,
            Map<String, String> policies, ShippingSummary shipping, Double ratingAverage,
            long ratingCount, long favouriteCount, boolean favourited, String status,
            List<String> tags, Instant publishedAt) {
    }

    public record ShopDetail(SellerBadge badge, String description, UUID coverMediaId,
            String coverUrl, List<MediaItem> gallery, Map<String, String> policies,
            long productCount, Instant publishedAt) {
    }

    public record Review(UUID id, UUID targetId, UUID reviewerUserId, String reviewerDisplayName,
            int rating, String text, String status, String sellerResponse, Instant respondedAt,
            Instant createdAt, String productName) {
    }

    // ------------------------------------------------------------------ sellers / shops

    public record Seller(UUID id, String sellerType, UUID ownerUserId, UUID businessAccountId,
            UUID legalCountryId, String legalCountryName, String legalName, String displayName,
            String status, String verificationStatus, Instant createdAt) {
    }

    public record SellerAccess(Seller seller, String role, List<String> capabilities) {
    }

    public record PaymentAccount(UUID id, UUID sellerId, String providerKey, String accountType,
            String onboardingStatus, boolean chargesEnabled, boolean payoutsEnabled,
            boolean detailsSubmitted, List<String> requirementsDue, Instant lastSyncedAt) {
    }

    public record Shop(UUID id, UUID sellerId, UUID primaryMarketCountryId, String name, String slug,
            String description, String status, Instant publishedAt, Instant createdAt,
            Instant updatedAt) {
    }

    public record SellerShop(UUID id, UUID sellerId, String sellerDisplayName, String sellerType,
            String sellerStatus, String name, String slug, String status, UUID logoMediaId,
            String logoUrl, UUID primaryMarketCountryId, String role, List<String> capabilities) {
    }

    public record PolicyView(String policyType, int versionNumber, String text, Instant effectiveFrom) {
    }

    public record AddressView(UUID id, UUID countryId, String countryCode, String countryName,
            String line1, String line2, String city, String region, String postalCode,
            String formatted) {
    }

    public record AddressInput(UUID countryId, String line1, String line2, String city,
            String region, String postalCode) {
    }

    public record ShippingProfile(UUID id, AddressView origin, int handlingMinDays,
            int handlingMaxDays, Integer defaultWeightGrams, Integer defaultLengthMm,
            Integer defaultWidthMm, Integer defaultHeightMm) {
    }

    public record ShippingProfileInput(AddressInput origin, int handlingMinDays, int handlingMaxDays,
            Integer defaultWeightGrams, Integer defaultLengthMm, Integer defaultWidthMm,
            Integer defaultHeightMm) {
    }

    public record ReadinessCheck(String key, boolean ok, String message) {
    }

    public record SellerShopDetail(Shop shop, Seller seller, UUID logoMediaId, String logoUrl,
            UUID coverMediaId, String coverUrl, List<MediaItem> gallery, List<PolicyView> policies,
            ShippingProfile shippingProfile, String role, List<String> capabilities,
            List<ReadinessCheck> readiness) {
    }

    public record OnboardingStep(String key, String label, String status, String detail) {
    }

    public record EligibleBusiness(UUID id, String name, String role) {
    }

    public record SellerOnboarding(List<SellerAccess> sellers, List<EligibleBusiness> eligibleBusinesses,
            List<SellerShop> shops, List<Market> onboardingMarkets, List<OnboardingStep> steps) {
    }

    public record Dashboard(UUID shopId, String shopStatus, List<Money> grossLast30Days,
            Long ordersLast30Days, long newOrders, long awaitingDispatch, long lowStock,
            long openReturns, String sellerStatus, String sellerVerificationStatus,
            PaymentAccount paymentAccount, List<ActivityItem> recentActivity, boolean financeVisible) {
    }

    public record ActivityItem(String type, String title, Instant at, UUID referenceId) {
    }

    // ------------------------------------------------------------------ seller catalogue

    public record PriceInput(UUID marketCountryId, String currencyCode, long amountMinor,
            Long compareAtAmountMinor) {
    }

    public record AttributeValueInput(UUID definitionId, UUID optionId, String value) {
    }

    public record VariantInput(UUID id, String label, String sku, String barcode, Integer weightGrams,
            Integer lengthMm, Integer widthMm, Integer heightMm, List<AttributeValueInput> attributes,
            List<PriceInput> prices, Integer initialStock) {
    }

    public record ProductInput(UUID categoryId, String name, String description, String brand,
            String condition, Map<String, Object> attributes, List<String> tags, List<UUID> mediaIds,
            List<UUID> marketCountryIds, List<VariantInput> variants) {
    }

    public record SellerPrice(UUID marketCountryId, Money amount, Money compareAt) {
    }

    public record SellerVariant(UUID id, String label, String sku, String barcode, Integer weightGrams,
            Integer lengthMm, Integer widthMm, Integer heightMm, String status,
            List<AttributeValueView> attributes, List<SellerPrice> prices, int onHand,
            int available) {
    }

    public record SellerProduct(UUID id, UUID shopId, UUID categoryId, String categoryName,
            String name, String slug, String description, String brand, String condition,
            Map<String, Object> attributes, List<String> tags, List<MediaItem> media,
            List<UUID> marketCountryIds, List<SellerVariant> variants, String status,
            boolean moderationRequired, Instant publishedAt, Instant updatedAt,
            List<String> publishIssues) {
    }

    public record SellerProductRow(UUID id, String name, String status, UUID imageMediaId,
            String imageUrl, Money price, int stockOnHand, int stockAvailable, Instant updatedAt) {
    }

    // ------------------------------------------------------------------ inventory

    public record InventoryLocation(UUID id, String name, String locationType, String status,
            AddressView address) {
    }

    public record InventoryRow(UUID inventoryItemId, UUID locationId, String locationName,
            UUID variantId, UUID productId, String productName, String variantLabel, String sku,
            int onHand, int reserved, int available, int lowStockThreshold, boolean low) {
    }

    public record InventoryMovement(UUID id, String movementType, int quantityDelta, String reason,
            String sourceType, UUID sourceId, Instant createdAt) {
    }

    // ------------------------------------------------------------------ cart / wishlist

    public record CartItem(UUID id, UUID productId, UUID variantId, String productName,
            String variantLabel, UUID imageMediaId, String imageUrl, int quantity, Money unitPrice,
            Money lineTotal, int availableQuantity, String issue) {
    }

    public record CartGroup(UUID shopId, String shopName, UUID logoMediaId, String logoUrl,
            List<CartItem> items, Money subtotal) {
    }

    public record CurrencyCount(String currencyCode, int itemCount) {
    }

    public record Cart(UUID id, UUID marketCountryId, String currencyCode, List<CartGroup> groups,
            int itemCount, Money subtotal, boolean hasIssues, List<CurrencyCount> otherCurrencyCarts) {
    }

    // ------------------------------------------------------------------ checkout

    public record ShippingOption(String optionKey, UUID methodId, String name, String methodType,
            String providerKey, Money amount, Integer estimatedMinDays, Integer estimatedMaxDays) {
    }

    public record CheckoutLine(UUID variantId, UUID productId, String productName, String variantLabel,
            UUID imageMediaId, String imageUrl, int quantity, Money unitPrice, Money discount,
            Money tax, Money lineTotal) {
    }

    public record CheckoutGroup(UUID shopId, String shopName, List<CheckoutLine> items, Money subtotal,
            Money discount, List<ShippingOption> shippingOptions, String selectedOptionKey,
            Money shipping, Money tax, Money total, String appliedDiscountCode, List<String> issues) {
    }

    public record CheckoutTotals(Money subtotal, Money discount, Money shipping, Money tax, Money total) {
    }

    public record CheckoutQuote(UUID checkoutSessionId, UUID marketCountryId, String currencyCode,
            String status, List<CheckoutGroup> groups, CheckoutTotals totals, String taxStatus,
            String taxProvider, List<String> blockingIssues, boolean canPlaceOrder, Instant expiresAt,
            AddressView shippingAddress) {
    }

    public record QuoteRequest(UUID marketCountryId, String currencyCode, UUID shippingAddressId,
            String recipientName, String phone, Map<UUID, String> shippingSelections,
            List<String> discountCodes) {
    }

    public record PlacedOrder(UUID orderId, String orderNumber, String status, String paymentStatus,
            String paymentUrl) {
    }

    // ------------------------------------------------------------------ orders

    public record OrderSummary(UUID id, String orderNumber, String status, Money total,
            Instant placedAt, Instant createdAt, int itemCount, int sellerOrderCount,
            List<UUID> previewMediaIds, List<String> previewImageUrls) {
    }

    public record TrackingEvent(String eventCode, String description, String location, Instant occurredAt) {
    }

    public record PackageView(UUID id, int packageNumber, int weightGrams, int lengthMm, int widthMm,
            int heightMm, String labelStatus, String labelCarrier, String labelService,
            boolean labelAvailable) {
    }

    public record ShipmentItemView(UUID orderItemId, String productName, int quantity) {
    }

    public record Shipment(UUID id, UUID sellerOrderId, String shipmentType, String providerKey,
            String carrierName, String serviceName, String trackingNumber, String trackingUrl,
            String status, Instant shippedAt, Instant deliveredAt, List<ShipmentItemView> items,
            List<PackageView> packages, List<TrackingEvent> events) {
    }

    public record OrderItemView(UUID id, UUID sellerOrderId, UUID productId, UUID variantId,
            String productName, String variantLabel, String condition, int quantity, Money unitPrice,
            Money discount, Money tax, Money lineTotal, UUID imageMediaId, String imageUrl,
            boolean reviewed, int returnableQuantity, int shippedQuantity) {
    }

    public record RefundView(UUID id, Money amount, String status, String reason, Instant createdAt) {
    }

    public record ReturnItemView(UUID orderItemId, String productName, int quantity,
            String requestedResolution, String reasonCode) {
    }

    public record ReturnRequestView(UUID id, UUID sellerOrderId, String sellerOrderNumber, UUID shopId,
            String shopName, String reasonCode, String description, String status, String decisionReason,
            Instant requestedAt, Instant decidedAt, List<ReturnItemView> items, List<UUID> mediaIds,
            List<RefundView> refunds, String customerDisplayName) {
    }

    public record SellerOrderView(UUID id, String sellerOrderNumber, UUID shopId, String shopName,
            UUID shopLogoMediaId, String shopLogoUrl, String status, List<OrderItemView> items,
            Money subtotal, Money discount, Money shipping, Money tax, Money total,
            String shippingMethodName, List<Shipment> shipments, List<ReturnRequestView> returns,
            List<RefundView> refunds, boolean canRequestReturn, boolean canReviewShop,
            boolean shopReviewed, UUID sellerUserId, UUID sellerBusinessAccountId, Instant createdAt) {
    }

    public record OrderAddress(String recipientName, String line1, String line2, String city,
            String region, String postalCode, String countryCode, String phone) {
    }

    public record OrderDetail(UUID id, String orderNumber, String status, CheckoutTotals totals,
            Instant placedAt, Instant createdAt, String paymentStatus, String paymentFailure,
            String paymentUrl, OrderAddress shippingAddress, List<SellerOrderView> sellerOrders) {
    }

    // ------------------------------------------------------------------ seller orders

    public record SellerOrderSummary(UUID id, String sellerOrderNumber, String status, Money subtotal,
            Money total, int itemCount, String customerDisplayName, Instant createdAt) {
    }

    public record SellerOrderDetail(UUID id, UUID orderId, String sellerOrderNumber, String status,
            List<OrderItemView> items, Money subtotal, Money discount, Money shipping, Money tax,
            Money commission, Money sellerNet, boolean financeVisible, String shippingMethodName,
            OrderAddress shippingAddress, String customerDisplayName, UUID customerUserId,
            List<Shipment> shipments, List<ReturnRequestView> returns, List<String> allowedActions,
            Instant createdAt) {
    }

    public record ShipmentLineInput(UUID orderItemId, int quantity) {
    }

    public record PackageInput(int weightGrams, int lengthMm, int widthMm, int heightMm) {
    }

    public record ShipmentInput(String mode, List<ShipmentLineInput> items, List<PackageInput> packages,
            String carrierName, String serviceName, String trackingNumber, String trackingUrl,
            UUID inventoryLocationId) {
    }

    public record RateView(String rateId, String providerKey, String carrierName, String serviceName,
            Money amount, Integer estimatedDays) {
    }

    // ------------------------------------------------------------------ shipping config

    public record ShippingRules(Long baseRateMinor, Long perKgRateMinor, Long freeAboveMinor,
            Integer maxWeightGrams, Integer transitMinDays, Integer transitMaxDays) {
    }

    public record ShippingMethodView(UUID id, UUID zoneId, String name, String methodType,
            String currencyCode, String status, ShippingRules rules) {
    }

    public record ZoneCountry(UUID id, String name, String iso2) {
    }

    public record ShippingZoneView(UUID id, String name, String status, List<ZoneCountry> countries,
            List<ShippingMethodView> methods) {
    }

    public record ShippingConfig(ShippingProfile profile, List<ShippingZoneView> zones,
            boolean shippoAvailable) {
    }

    public record ShippingMethodInput(String name, String methodType, String currencyCode,
            ShippingRules rules) {
    }

    // ------------------------------------------------------------------ discounts

    public record DiscountCode(UUID id, UUID shopId, String code, String discountType,
            java.math.BigDecimal discountValue, String currencyCode, Long minimumOrderAmountMinor,
            Integer totalUsageLimit, Integer perUserUsageLimit, Instant startsAt, Instant endsAt,
            String status, long redemptionCount) {
    }

    public record DiscountCodeInput(String code, String discountType, java.math.BigDecimal discountValue,
            String currencyCode, Long minimumOrderAmountMinor, Integer totalUsageLimit,
            Integer perUserUsageLimit, Instant startsAt, Instant endsAt) {
    }

    // ------------------------------------------------------------------ finance

    public record TransferView(UUID id, UUID sellerOrderId, String sellerOrderNumber, Money gross,
            Money commission, Money transferAmount, Money reversed, String status, String failureCode,
            Instant transferredAt, Instant createdAt) {
    }

    public record PayoutView(UUID id, Money amount, String status, java.time.LocalDate arrivalDate,
            Instant paidAt, Instant failedAt, String failureCode, Instant createdAt) {
    }

    public record EarningsTotals(String currencyCode, Money grossSales, Money commission,
            Money refunds, Money sellerNet, Money pendingTransfers, Money transferred, Money reversed,
            Money paidOut) {
    }

    public record Earnings(UUID shopId, UUID sellerId, List<EarningsTotals> totals,
            List<TransferView> transfers, List<PayoutView> payouts, PaymentAccount paymentAccount) {
    }

    public record OnboardingLink(String url, Instant expiresAt) {
    }
}
