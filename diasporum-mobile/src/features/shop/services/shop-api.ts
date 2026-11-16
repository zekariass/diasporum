import type { ApiClient } from "@/core/api/api-client";
import type {
  AddressInput,
  AddressView,
  AttributeDefinition,
  Cart,
  Category,
  CheckoutQuote,
  Dashboard,
  DiscountCode,
  DiscountCodeInput,
  Earnings,
  InventoryLocation,
  InventoryMovement,
  InventoryRow,
  Market,
  OnboardingLink,
  OrderDetail,
  OrderSummary,
  Page,
  PaymentAccount,
  PlacedOrder,
  ProductCard,
  ProductDetail,
  ProductInput,
  QuoteRequest,
  RateView,
  ReturnRequestView,
  Review,
  SearchFilters,
  Seller,
  SellerOnboarding,
  SellerOrderDetail,
  SellerOrderSummary,
  SellerProduct,
  SellerProductRow,
  SellerShop,
  SellerShopDetail,
  Shipment,
  ShipmentInput,
  ShippingConfig,
  ShippingMethodInput,
  ShippingMethodView,
  ShippingProfile,
  ShippingProfileInput,
  ShippingZoneView,
  ShopDetail,
} from "../types/shop-types";

const auth = { authenticated: true } as const;
const BASE = "/api/v1/shop";
const ME = `${BASE}/me`;
const SELLER = `${BASE}/seller`;

type QueryValue = string | number | boolean | undefined;
function attributeParams(attributes?: Record<string, string[]>): string {
  return Object.entries(attributes ?? {})
    .flatMap(([key, values]) =>
      values.map((value) => `&attribute=${encodeURIComponent(`${key}=${value}`)}`))
    .join("");
}
function query(params: [string, QueryValue][]): string {
  const value = params
    .filter(([, item]) => item !== undefined && item !== "")
    .map(([key, item]) => `${key}=${encodeURIComponent(String(item))}`)
    .join("&");
  return value ? `?${value}` : "";
}

/**
 * Diasporum Shop Marketplace REST surface. The mobile app only ever talks to
 * Diasporum endpoints — Stripe/Shippo are backend-internal and never appear here.
 */
export function createShopApi(client: ApiClient) {
  return {
    // ------------------------------ public catalogue
    markets: () => client.get<Market[]>(`${BASE}/markets`, auth),
    market: (countryId: string) => client.get<Market>(`${BASE}/markets/${countryId}`, auth),
    categories: (languageCode?: string, parentId?: string, all = false) =>
      client.get<Category[]>(`${BASE}/categories${query([
        ["languageCode", languageCode], ["parentId", parentId], ["all", all],
      ])}`, auth),
    attributes: (categoryId: string) =>
      client.get<AttributeDefinition[]>(`${BASE}/categories/${categoryId}/attributes`, auth),
    search: (filters: SearchFilters, cursor?: string, size = 20) =>
      client.get<Page<ProductCard>>(`${BASE}/products${query([
        ["marketCountryId", filters.marketCountryId], ["currencyCode", filters.currencyCode],
        ["q", filters.q], ["categoryId", filters.categoryId], ["shopId", filters.shopId],
        ["brand", filters.brand], ["minPriceMinor", filters.minPriceMinor],
        ["maxPriceMinor", filters.maxPriceMinor], ["inStockOnly", filters.inStockOnly],
        ["sort", filters.sort], ["cursor", cursor], ["size", size],
      ])}${filters.conditions?.length
        ? filters.conditions.map((c) => `&conditions=${encodeURIComponent(c)}`).join("") : ""
      }${attributeParams(filters.attributes)}`, auth),
    product: (productId: string, marketCountryId: string, currencyCode?: string) =>
      client.get<ProductDetail>(`${BASE}/products/${productId}${query([
        ["marketCountryId", marketCountryId], ["currencyCode", currencyCode],
      ])}`, auth),
    productReviews: (productId: string, cursor?: string) =>
      client.get<Page<Review>>(`${BASE}/products/${productId}/reviews${query([
        ["cursor", cursor],
      ])}`, auth),
    shop: (shopId: string) => client.get<ShopDetail>(`${BASE}/shops/${shopId}`, auth),
    shopReviews: (shopId: string, cursor?: string) =>
      client.get<Page<Review>>(`${BASE}/shops/${shopId}/reviews${query([["cursor", cursor]])}`, auth),
    shopProducts: (shopId: string, marketCountryId: string, params: {
      q?: string; categoryId?: string; sort?: string; currencyCode?: string; cursor?: string;
    } = {}) =>
      client.get<Page<ProductCard>>(`${BASE}/shops/${shopId}/products${query([
        ["marketCountryId", marketCountryId], ["currencyCode", params.currencyCode],
        ["q", params.q], ["categoryId", params.categoryId], ["sort", params.sort],
        ["cursor", params.cursor],
      ])}`, auth),

    // ------------------------------ cart / wishlist / addresses
    cart: (marketCountryId: string, currencyCode?: string) =>
      client.get<Cart>(`${ME}/cart${query([
        ["marketCountryId", marketCountryId], ["currencyCode", currencyCode],
      ])}`, auth),
    cartCount: () => client.get<{ count: number }>(`${ME}/cart/count`, auth),
    addToCart: (variantId: string, quantity: number, marketCountryId: string, currencyCode?: string) =>
      client.post<Cart>(`${ME}/cart/items`, { variantId, quantity, marketCountryId, currencyCode }, auth),
    updateCartItem: (itemId: string, quantity: number, marketCountryId: string) =>
      client.put<Cart>(`${ME}/cart/items/${itemId}`, { quantity, marketCountryId }, auth),
    removeCartItem: (itemId: string, marketCountryId: string) =>
      client.delete<Cart>(`${ME}/cart/items/${itemId}?marketCountryId=${marketCountryId}`, auth),
    wishlist: (marketCountryId: string, currencyCode?: string) =>
      client.get<ProductCard[]>(`${ME}/wishlist${query([
        ["marketCountryId", marketCountryId], ["currencyCode", currencyCode],
      ])}`, auth),
    favourite: (productId: string) => client.post(`${ME}/wishlist/${productId}`, {}, auth),
    unfavourite: (productId: string) => client.delete(`${ME}/wishlist/${productId}`, auth),
    addresses: () => client.get<AddressView[]>(`${ME}/addresses`, auth),
    createAddress: (input: AddressInput) => client.post<AddressView>(`${ME}/addresses`, input, auth),
    updateAddress: (addressId: string, input: AddressInput) =>
      client.put<AddressView>(`${ME}/addresses/${addressId}`, input, auth),
    deleteAddress: (addressId: string) => client.delete(`${ME}/addresses/${addressId}`, auth),

    // ------------------------------ checkout / orders
    quote: (request: QuoteRequest) => client.post<CheckoutQuote>(`${ME}/checkout/quote`, request, auth),
    place: (sessionId: string) => client.post<PlacedOrder>(`${ME}/checkout/${sessionId}/place`, {}, auth),
    orders: (filter?: string, cursor?: string) =>
      client.get<Page<OrderSummary>>(`${ME}/orders${query([
        ["filter", filter], ["cursor", cursor],
      ])}`, auth),
    order: (orderId: string) => client.get<OrderDetail>(`${ME}/orders/${orderId}`, auth),
    cancelOrder: (orderId: string) => client.post(`${ME}/orders/${orderId}/cancel`, {}, auth),
    requestReturn: (sellerOrderId: string, body: {
      reasonCode: string; description?: string;
      items: { orderItemId: string; quantity: number; resolution: string }[];
      mediaIds?: string[];
    }) => client.post<ReturnRequestView>(`${ME}/seller-orders/${sellerOrderId}/returns`, body, auth),
    reviewProduct: (orderItemId: string, rating: number, text: string, mediaIds?: string[]) =>
      client.post<Review>(`${ME}/order-items/${orderItemId}/review`, { rating, text, mediaIds }, auth),
    reviewShop: (sellerOrderId: string, rating: number, text: string) =>
      client.post<Review>(`${ME}/seller-orders/${sellerOrderId}/review`, { rating, text }, auth),
    // Seller/order conversations are created via the messaging API
    // (POST /api/v1/conversations with SHOP* context types) — never through
    // shop endpoints.

    // ------------------------------ seller onboarding / shops
    onboarding: () => client.get<SellerOnboarding>(`${SELLER}/onboarding`, auth),
    createSeller: (body: {
      sellerType: string; businessAccountId?: string; legalCountryId: string;
      legalName: string; displayName: string;
    }) => client.post<Seller>(`${SELLER}/sellers`, body, auth),
    sellerShops: () => client.get<SellerShop[]>(`${SELLER}/shops`, auth),
    createShop: (body: {
      sellerId: string; name: string; description?: string; marketCountryId: string;
    }) => client.post<SellerShopDetail>(`${SELLER}/shops`, body, auth),
    shopDetail: (shopId: string) => client.get<SellerShopDetail>(`${SELLER}/shops/${shopId}`, auth),
    updateShop: (shopId: string, name: string, description?: string) =>
      client.put<SellerShopDetail>(`${SELLER}/shops/${shopId}`, { name, description }, auth),
    updateShopMedia: (shopId: string, body: {
      logoMediaId?: string | null; coverMediaId?: string | null; galleryMediaIds?: string[];
    }) => client.put<SellerShopDetail>(`${SELLER}/shops/${shopId}/media`, body, auth),
    updatePolicy: (shopId: string, policyType: string, text: string) =>
      client.put<SellerShopDetail>(`${SELLER}/shops/${shopId}/policies/${policyType}`, { text }, auth),
    submitShop: (shopId: string) =>
      client.post<SellerShopDetail>(`${SELLER}/shops/${shopId}/submit`, {}, auth),
    pauseShop: (shopId: string) =>
      client.post<SellerShopDetail>(`${SELLER}/shops/${shopId}/pause`, {}, auth),
    dashboard: (shopId: string) => client.get<Dashboard>(`${SELLER}/shops/${shopId}/dashboard`, auth),
    paymentAccount: (shopId: string) =>
      client.get<PaymentAccount>(`${SELLER}/shops/${shopId}/payment-account`, auth),
    paymentOnboardingLink: (shopId: string) =>
      client.post<OnboardingLink>(`${SELLER}/shops/${shopId}/payment-account/onboarding-link`, {}, auth),

    // ------------------------------ inventory locations
    locations: (shopId: string) =>
      client.get<InventoryLocation[]>(`${SELLER}/shops/${shopId}/locations`, auth),
    createLocation: (shopId: string, name: string, address: AddressInput) =>
      client.post<InventoryLocation>(`${SELLER}/shops/${shopId}/locations`, { name, address }, auth),

    // ------------------------------ products
    sellerProducts: (shopId: string, params: {
      status?: string; q?: string; cursor?: string; size?: number;
    } = {}) =>
      client.get<Page<SellerProductRow>>(`${SELLER}/shops/${shopId}/products${query([
        ["status", params.status], ["q", params.q], ["cursor", params.cursor], ["size", params.size],
      ])}`, auth),
    sellerProduct: (shopId: string, productId: string) =>
      client.get<SellerProduct>(`${SELLER}/shops/${shopId}/products/${productId}`, auth),
    createProduct: (shopId: string, input: ProductInput) =>
      client.post<SellerProduct>(`${SELLER}/shops/${shopId}/products`, input, auth),
    updateProduct: (shopId: string, productId: string, input: ProductInput) =>
      client.put<SellerProduct>(`${SELLER}/shops/${shopId}/products/${productId}`, input, auth),
    publishProduct: (shopId: string, productId: string) =>
      client.post<SellerProduct>(`${SELLER}/shops/${shopId}/products/${productId}/publish`, {}, auth),
    pauseProduct: (shopId: string, productId: string) =>
      client.post<SellerProduct>(`${SELLER}/shops/${shopId}/products/${productId}/pause`, {}, auth),
    archiveProduct: (shopId: string, productId: string) =>
      client.post<SellerProduct>(`${SELLER}/shops/${shopId}/products/${productId}/archive`, {}, auth),

    // ------------------------------ inventory
    inventory: (shopId: string, lowOnly = false, q?: string) =>
      client.get<InventoryRow[]>(`${SELLER}/shops/${shopId}/inventory${query([
        ["lowOnly", lowOnly], ["q", q],
      ])}`, auth),
    adjustInventory: (shopId: string, body: {
      variantId: string; locationId: string; delta: number;
      movementType?: string; reason?: string; lowStockThreshold?: number;
    }) => client.post<InventoryRow>(`${SELLER}/shops/${shopId}/inventory/adjustments`, body, auth),
    inventoryMovements: (shopId: string, inventoryItemId: string) =>
      client.get<InventoryMovement[]>(
        `${SELLER}/shops/${shopId}/inventory/${inventoryItemId}/movements`, auth),

    // ------------------------------ shipping config
    shippingConfig: (shopId: string) =>
      client.get<ShippingConfig>(`${SELLER}/shops/${shopId}/shipping`, auth),
    updateShippingProfile: (shopId: string, input: ShippingProfileInput) =>
      client.put<ShippingProfile>(`${SELLER}/shops/${shopId}/shipping/profile`, input, auth),
    createZone: (shopId: string, name: string, countryIds: string[]) =>
      client.post<ShippingZoneView>(`${SELLER}/shops/${shopId}/shipping/zones`, { name, countryIds }, auth),
    updateZone: (shopId: string, zoneId: string, name: string, countryIds: string[]) =>
      client.put<ShippingZoneView>(`${SELLER}/shops/${shopId}/shipping/zones/${zoneId}`,
        { name, countryIds }, auth),
    deleteZone: (shopId: string, zoneId: string) =>
      client.delete(`${SELLER}/shops/${shopId}/shipping/zones/${zoneId}`, auth),
    createMethod: (shopId: string, zoneId: string, input: ShippingMethodInput) =>
      client.post<ShippingMethodView>(
        `${SELLER}/shops/${shopId}/shipping/zones/${zoneId}/methods`, input, auth),
    updateMethod: (shopId: string, methodId: string, input: ShippingMethodInput) =>
      client.put<ShippingMethodView>(`${SELLER}/shops/${shopId}/shipping/methods/${methodId}`,
        input, auth),
    deleteMethod: (shopId: string, methodId: string) =>
      client.delete(`${SELLER}/shops/${shopId}/shipping/methods/${methodId}`, auth),

    // ------------------------------ discounts
    discounts: (shopId: string) =>
      client.get<DiscountCode[]>(`${SELLER}/shops/${shopId}/discounts`, auth),
    createDiscount: (shopId: string, input: DiscountCodeInput) =>
      client.post<DiscountCode>(`${SELLER}/shops/${shopId}/discounts`, input, auth),
    setDiscountStatus: (shopId: string, codeId: string, status: string) =>
      client.post<DiscountCode>(`${SELLER}/shops/${shopId}/discounts/${codeId}/status`,
        { status }, auth),

    // ------------------------------ seller orders / fulfilment
    sellerOrders: (shopId: string, filter?: string, cursor?: string) =>
      client.get<Page<SellerOrderSummary>>(`${SELLER}/shops/${shopId}/orders${query([
        ["filter", filter], ["cursor", cursor],
      ])}`, auth),
    sellerOrder: (shopId: string, sellerOrderId: string) =>
      client.get<SellerOrderDetail>(`${SELLER}/shops/${shopId}/orders/${sellerOrderId}`, auth),
    acceptOrder: (shopId: string, sellerOrderId: string) =>
      client.post<SellerOrderDetail>(`${SELLER}/shops/${shopId}/orders/${sellerOrderId}/accept`, {}, auth),
    markProcessing: (shopId: string, sellerOrderId: string) =>
      client.post<SellerOrderDetail>(`${SELLER}/shops/${shopId}/orders/${sellerOrderId}/processing`, {}, auth),
    cancelSellerOrder: (shopId: string, sellerOrderId: string, reason?: string) =>
      client.post<SellerOrderDetail>(`${SELLER}/shops/${shopId}/orders/${sellerOrderId}/cancel`,
        { reason }, auth),
    // Seller→buyer order conversations are created via the messaging API
    // (POST /api/v1/conversations, contextType=SHOP_ORDER).
    createShipment: (shopId: string, sellerOrderId: string, input: ShipmentInput) =>
      client.post<Shipment>(`${SELLER}/shops/${shopId}/orders/${sellerOrderId}/shipments`, input, auth),
    labelRates: (shopId: string, sellerOrderId: string, shipmentId: string) =>
      client.get<RateView[]>(
        `${SELLER}/shops/${shopId}/orders/${sellerOrderId}/shipments/${shipmentId}/rates`, auth),
    buyLabel: (shopId: string, sellerOrderId: string, shipmentId: string, rateId: string) =>
      client.post<Shipment>(
        `${SELLER}/shops/${shopId}/orders/${sellerOrderId}/shipments/${shipmentId}/label`,
        { rateId }, auth),
    labelUrl: (shopId: string, sellerOrderId: string, shipmentId: string) =>
      client.get<{ url: string }>(
        `${SELLER}/shops/${shopId}/orders/${sellerOrderId}/shipments/${shipmentId}/label`, auth),
    voidLabel: (shopId: string, sellerOrderId: string, shipmentId: string) =>
      client.delete<Shipment>(
        `${SELLER}/shops/${shopId}/orders/${sellerOrderId}/shipments/${shipmentId}/label`, auth),
    dispatch: (shopId: string, sellerOrderId: string, shipmentId: string) =>
      client.post<SellerOrderDetail>(
        `${SELLER}/shops/${shopId}/orders/${sellerOrderId}/shipments/${shipmentId}/dispatch`, {}, auth),
    addTrackingEvent: (shopId: string, sellerOrderId: string, shipmentId: string,
        eventCode: string, description?: string) =>
      client.post<Shipment>(
        `${SELLER}/shops/${shopId}/orders/${sellerOrderId}/shipments/${shipmentId}/events`,
        { eventCode, description }, auth),
    decideReturn: (shopId: string, returnId: string, approve: boolean, decisionReason?: string) =>
      client.post<ReturnRequestView>(`${SELLER}/shops/${shopId}/returns/${returnId}/decision`,
        { approve, decisionReason }, auth),
    receiveReturn: (shopId: string, returnId: string, refundAmountMinor?: number) =>
      client.post<ReturnRequestView>(`${SELLER}/shops/${shopId}/returns/${returnId}/receive`,
        { refundAmountMinor }, auth),
    sellerShopReviews: (shopId: string) =>
      client.get<Review[]>(`${SELLER}/shops/${shopId}/reviews`, auth),
    respondToReview: (shopId: string, reviewId: string, response: string) =>
      client.post(`${SELLER}/shops/${shopId}/reviews/${reviewId}/response`, { response }, auth),

    // ------------------------------ earnings
    earnings: (shopId: string) =>
      client.get<Earnings>(`${SELLER}/shops/${shopId}/earnings`, auth),
  };
}

export type ShopApi = ReturnType<typeof createShopApi>;
