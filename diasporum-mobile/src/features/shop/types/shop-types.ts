/**
 * Shop Marketplace API types — mirrors the backend ShopModels records exactly.
 * All money is integer minor units plus an ISO currency code; formatting is done
 * by money.ts, never by the backend.
 */

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Money {
  amountMinor: number;
  currencyCode: string;
  exponent: number;
}

export interface Market {
  countryId: string;
  countryName: string;
  iso2: string;
  flagEmoji: string | null;
  marketStatus: string;
  buyerCheckoutEnabled: boolean;
  sellerOnboardingEnabled: boolean;
  defaultCurrency: string;
  supportedCurrencies: string[];
}

export interface Category {
  id: string;
  parentId: string | null;
  categoryKey: string;
  name: string;
  description: string | null;
  sortOrder: number;
}

export interface AttributeOption {
  id: string;
  optionKey: string;
  displayValue: string;
  sortOrder: number;
}

export interface AttributeDefinition {
  id: string;
  categoryId: string;
  attributeKey: string;
  displayName: string;
  dataType: "TEXT" | "NUMBER" | "BOOLEAN" | "ENUM" | "DATE" | string;
  required: boolean;
  filterable: boolean;
  variantLevel: boolean;
  sortOrder: number;
  options: AttributeOption[];
}

export interface ProductCard {
  id: string;
  shopId: string;
  shopName: string;
  name: string;
  brand: string | null;
  condition: string | null;
  imageMediaId: string | null;
  imageUrl: string | null;
  price: Money;
  compareAtPrice: Money | null;
  variantSummary: string | null;
  favouriteCount: number;
  favourited: boolean;
  available: boolean;
  publishedAt: string;
}

export interface SearchFilters {
  marketCountryId: string;
  currencyCode?: string;
  q?: string;
  categoryId?: string;
  shopId?: string;
  conditions?: string[];
  attributes?: Record<string, string[]>;
  brand?: string;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  inStockOnly?: boolean;
  sort?: string;
}

export interface MediaItem {
  mediaId: string;
  url: string | null;
  role: string;
  displayOrder: number;
  altText: string | null;
}

export interface SellerBadge {
  shopId: string;
  shopName: string;
  slug: string;
  logoMediaId: string | null;
  logoUrl: string | null;
  shopStatus: string;
  sellerType: string;
  sellerVerificationStatus: string;
  sellerCountryName: string | null;
  ratingAverage: number | null;
  ratingCount: number;
  sellerUserId: string | null;
  sellerBusinessAccountId: string | null;
}

export interface VariantView {
  id: string;
  label: string;
  sku: string | null;
  status: string;
  attributes: AttributeValueView[];
  price: Money;
  compareAtPrice: Money | null;
  available: boolean;
  lowStock: boolean;
}

export interface AttributeValueView {
  definitionId: string;
  attributeKey: string;
  label: string;
  optionId: string | null;
  value: string | null;
}

export interface VariantAxis {
  definitionId: string;
  attributeKey: string;
  label: string;
  options: AttributeOption[];
}

export interface MarketAvailability {
  status: string;
  purchasable: boolean;
  reason: string | null;
}

export interface ShippingSummary {
  handlingMinDays: number | null;
  handlingMaxDays: number | null;
  methods: { name: string; methodType: string; shipsToMarket: boolean }[];
}

export interface ProductDetail {
  id: string;
  shop: SellerBadge;
  category: Category;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  condition: string | null;
  attributes: AttributeValueView[];
  media: MediaItem[];
  variants: VariantView[];
  variantAxes: VariantAxis[];
  marketAvailability: MarketAvailability;
  policies: Record<string, string>;
  shipping: ShippingSummary;
  ratingAverage: number | null;
  ratingCount: number;
  favouriteCount: number;
  favourited: boolean;
  status: string;
  tags: string[];
  publishedAt: string | null;
}

export interface ShopDetail {
  badge: SellerBadge;
  description: string | null;
  coverMediaId: string | null;
  coverUrl: string | null;
  gallery: MediaItem[];
  policies: Record<string, string>;
  productCount: number;
  publishedAt: string | null;
}

export interface Review {
  id: string;
  targetId: string;
  reviewerUserId: string;
  reviewerDisplayName: string;
  rating: number;
  text: string;
  status: string;
  sellerResponse: string | null;
  respondedAt: string | null;
  createdAt: string;
  productName: string | null;
}

// ------------------------------------------------------------------ seller

export interface Seller {
  id: string;
  sellerType: string;
  ownerUserId: string | null;
  businessAccountId: string | null;
  legalCountryId: string;
  legalCountryName: string;
  legalName: string;
  displayName: string;
  status: string;
  verificationStatus: string;
  createdAt: string;
}

export interface SellerAccess {
  seller: Seller;
  role: string;
  capabilities: string[];
}

export interface PaymentAccount {
  id: string | null;
  sellerId: string;
  providerKey: string | null;
  accountType: string | null;
  onboardingStatus: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: string[];
  lastSyncedAt: string | null;
}

export interface Shop {
  id: string;
  sellerId: string;
  primaryMarketCountryId: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  createdAt: string;
}

export interface SellerShop {
  id: string;
  sellerId: string;
  sellerDisplayName: string;
  sellerType: string;
  name: string;
  slug: string;
  status: string;
  marketCountryName: string;
  productCount: number;
}

export interface PolicyView {
  policyType: string;
  versionNumber: number;
  text: string;
  effectiveFrom: string;
}

export interface AddressView {
  id: string;
  countryId: string;
  countryCode: string;
  countryName: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string;
  formatted: string;
}

export interface AddressInput {
  countryId: string;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postalCode: string;
}

export interface ShippingProfile {
  id: string;
  origin: AddressView;
  handlingMinDays: number;
  handlingMaxDays: number;
  defaultWeightGrams: number | null;
  defaultLengthMm: number | null;
  defaultWidthMm: number | null;
  defaultHeightMm: number | null;
}

export interface ShippingProfileInput {
  origin: AddressInput;
  handlingMinDays: number;
  handlingMaxDays: number;
  defaultWeightGrams?: number | null;
  defaultLengthMm?: number | null;
  defaultWidthMm?: number | null;
  defaultHeightMm?: number | null;
}

export interface ReadinessCheck {
  key: string;
  ok: boolean;
  message: string;
}

export interface SellerShopDetail {
  shop: Shop;
  seller: Seller;
  logoMediaId: string | null;
  logoUrl: string | null;
  coverMediaId: string | null;
  coverUrl: string | null;
  gallery: MediaItem[];
  policies: PolicyView[];
  shippingProfile: ShippingProfile | null;
  role: string;
  capabilities: string[];
  readiness: ReadinessCheck[];
}

export interface OnboardingStep {
  key: string;
  label: string;
  status: string;
  detail: string | null;
}

export interface EligibleBusiness {
  id: string;
  name: string;
  role: string;
}

export interface SellerOnboarding {
  sellers: SellerAccess[];
  eligibleBusinesses: EligibleBusiness[];
  shops: SellerShop[];
  onboardingMarkets: Market[];
  steps: OnboardingStep[];
}

export interface Dashboard {
  shopId: string;
  shopStatus: string;
  grossLast30Days: Money[];
  ordersLast30Days: number | null;
  newOrders: number;
  awaitingDispatch: number;
  lowStock: number;
  openReturns: number;
  sellerStatus: string;
  sellerVerificationStatus: string;
  paymentAccount: PaymentAccount;
  recentActivity: ActivityItem[];
  financeVisible: boolean;
}

export interface ActivityItem {
  type: string;
  title: string;
  at: string;
  referenceId: string | null;
}

// ------------------------------------------------------------------ catalogue editing

export interface PriceInput {
  marketCountryId: string;
  currencyCode: string;
  amountMinor: number;
  compareAtAmountMinor?: number | null;
}

export interface AttributeValueInput {
  definitionId: string;
  optionId?: string | null;
  value?: string | null;
}

export interface VariantInput {
  id?: string | null;
  label: string;
  sku?: string | null;
  barcode?: string | null;
  weightGrams?: number | null;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
  attributes?: AttributeValueInput[];
  prices: PriceInput[];
  initialStock?: number | null;
}

export interface ProductInput {
  categoryId: string;
  name: string;
  description?: string | null;
  brand?: string | null;
  condition?: string | null;
  attributes?: Record<string, unknown>;
  tags?: string[];
  mediaIds?: string[];
  marketCountryIds: string[];
  variants: VariantInput[];
}

export interface SellerPrice {
  marketCountryId: string;
  amount: Money;
  compareAt: Money | null;
}

export interface SellerVariant {
  id: string;
  label: string;
  sku: string | null;
  barcode: string | null;
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  status: string;
  attributes: AttributeValueView[];
  prices: SellerPrice[];
  onHand: number;
  available: number;
}

export interface SellerProduct {
  id: string;
  shopId: string;
  categoryId: string;
  categoryName: string;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  condition: string | null;
  attributes: Record<string, unknown>;
  tags: string[];
  media: MediaItem[];
  marketCountryIds: string[];
  variants: SellerVariant[];
  status: string;
  moderationRequired: boolean;
  publishedAt: string | null;
  updatedAt: string | null;
}

export interface SellerProductRow {
  id: string;
  name: string;
  status: string;
  imageMediaId: string | null;
  imageUrl: string | null;
  variantCount: number;
  marketCount: number;
  lowStockVariants: number;
  updatedAt: string | null;
}

export interface InventoryLocation {
  id: string;
  name: string;
  locationType: string;
  status: string;
  address: AddressView;
}

export interface InventoryRow {
  inventoryItemId: string;
  locationId: string;
  locationName: string;
  variantId: string;
  productId: string;
  productName: string;
  variantLabel: string;
  sku: string | null;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  low: boolean;
}

export interface InventoryMovement {
  id: string;
  movementType: string;
  quantityDelta: number;
  reason: string | null;
  sourceType: string | null;
  sourceId: string | null;
  createdAt: string;
}

// ------------------------------------------------------------------ cart / checkout

export interface CartItem {
  id: string;
  productId: string;
  variantId: string;
  productName: string;
  variantLabel: string;
  imageMediaId: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
  availableQuantity: number;
  issue: string | null;
}

export interface CartGroup {
  shopId: string;
  shopName: string;
  logoMediaId: string | null;
  logoUrl: string | null;
  items: CartItem[];
  subtotal: Money;
}

export interface Cart {
  id: string;
  marketCountryId: string;
  currencyCode: string;
  groups: CartGroup[];
  itemCount: number;
  subtotal: Money;
  hasIssues: boolean;
  otherCurrencyCarts: { currencyCode: string; itemCount: number }[];
}

export interface ShippingOption {
  optionKey: string;
  methodId: string | null;
  name: string;
  methodType: string;
  providerKey: string | null;
  amount: Money;
  transitMinDays: number | null;
  transitMaxDays: number | null;
}

export interface CheckoutLine {
  variantId: string;
  productId: string;
  productName: string;
  variantLabel: string;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
}

export interface CheckoutGroup {
  shopId: string;
  shopName: string;
  items: CheckoutLine[];
  subtotal: Money;
  shippingOptions: ShippingOption[];
  selectedShipping: ShippingOption | null;
  discount: Money;
}

export interface CheckoutTotals {
  subtotal: Money;
  discount: Money;
  shipping: Money;
  tax: Money;
  total: Money;
}

export interface CheckoutQuote {
  checkoutSessionId: string;
  marketCountryId: string;
  currencyCode: string;
  status: string;
  groups: CheckoutGroup[];
  totals: CheckoutTotals;
  taxStatus: string;
  taxProvider: string | null;
  blockingIssues: string[];
  canPlaceOrder: boolean;
  expiresAt: string;
  shippingAddress: AddressView;
}

export interface QuoteRequest {
  marketCountryId: string;
  currencyCode?: string;
  shippingAddressId: string;
  recipientName?: string;
  phone?: string;
  shippingSelections?: Record<string, string>;
  discountCodes?: string[];
}

export interface PlacedOrder {
  orderId: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentUrl: string | null;
}

// ------------------------------------------------------------------ orders

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  total: Money;
  placedAt: string | null;
  createdAt: string;
  itemCount: number;
  sellerOrderCount: number;
  previewMediaIds: string[];
  previewImageUrls: string[];
}

export interface TrackingEvent {
  eventCode: string;
  description: string;
  location: string | null;
  occurredAt: string;
}

export interface PackageView {
  id: string;
  packageNumber: number;
  weightGrams: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  labelStatus: string | null;
  labelCarrier: string | null;
  labelService: string | null;
  labelAvailable: boolean;
}

export interface ShipmentItemView {
  orderItemId: string;
  productName: string;
  quantity: number;
}

export interface Shipment {
  id: string;
  sellerOrderId: string;
  shipmentType: string;
  providerKey: string | null;
  carrierName: string | null;
  serviceName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  items: ShipmentItemView[];
  packages: PackageView[];
  events: TrackingEvent[];
}

export interface OrderItemView {
  id: string;
  sellerOrderId: string;
  productId: string;
  variantId: string;
  productName: string;
  variantLabel: string;
  condition: string | null;
  quantity: number;
  unitPrice: Money;
  discount: Money;
  tax: Money;
  lineTotal: Money;
  imageMediaId: string | null;
  imageUrl: string | null;
  reviewed: boolean;
  returnableQuantity: number;
  shippedQuantity: number;
}

export interface RefundView {
  id: string;
  amount: Money;
  status: string;
  reason: string | null;
  createdAt: string;
}

export interface ReturnItemView {
  orderItemId: string;
  productName: string;
  quantity: number;
  requestedResolution: string;
  reasonCode: string;
}

export interface ReturnRequestView {
  id: string;
  sellerOrderId: string;
  sellerOrderNumber: string;
  shopId: string;
  shopName: string;
  reasonCode: string;
  description: string | null;
  status: string;
  decisionReason: string | null;
  requestedAt: string;
  decidedAt: string | null;
  items: ReturnItemView[];
  mediaIds: string[];
  refunds: RefundView[];
  customerDisplayName: string | null;
}

export interface SellerOrderView {
  id: string;
  sellerOrderNumber: string;
  shopId: string;
  shopName: string;
  shopLogoMediaId: string | null;
  shopLogoUrl: string | null;
  status: string;
  items: OrderItemView[];
  subtotal: Money;
  discount: Money;
  shipping: Money;
  tax: Money;
  total: Money;
  shippingMethodName: string | null;
  shipments: Shipment[];
  returns: ReturnRequestView[];
  refunds: RefundView[];
  canRequestReturn: boolean;
  canReviewShop: boolean;
  shopReviewed: boolean;
  sellerUserId: string | null;
  sellerBusinessAccountId: string | null;
  createdAt: string;
}

export interface OrderAddress {
  recipientName: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string;
  countryCode: string;
  phone: string | null;
}

export interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  totals: CheckoutTotals;
  placedAt: string | null;
  createdAt: string;
  paymentStatus: string;
  paymentFailure: string | null;
  paymentUrl: string | null;
  shippingAddress: OrderAddress;
  sellerOrders: SellerOrderView[];
}

// ------------------------------------------------------------------ seller orders

export interface SellerOrderSummary {
  id: string;
  sellerOrderNumber: string;
  status: string;
  subtotal: Money;
  total: Money;
  itemCount: number;
  customerDisplayName: string;
  createdAt: string;
}

export interface SellerOrderDetail {
  id: string;
  orderId: string;
  sellerOrderNumber: string;
  status: string;
  items: OrderItemView[];
  subtotal: Money;
  discount: Money;
  shipping: Money;
  tax: Money;
  commission: Money;
  sellerNet: Money;
  financeVisible: boolean;
  shippingMethodName: string | null;
  shippingAddress: OrderAddress;
  customerDisplayName: string;
  customerUserId: string;
  shipments: Shipment[];
  returns: ReturnRequestView[];
  allowedActions: string[];
  createdAt: string;
}

export interface ShipmentLineInput {
  orderItemId: string;
  quantity: number;
}

export interface PackageInput {
  weightGrams: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
}

export interface ShipmentInput {
  mode: string;
  items: ShipmentLineInput[];
  packages: PackageInput[];
  carrierName?: string | null;
  serviceName?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  inventoryLocationId?: string | null;
}

export interface RateView {
  rateId: string;
  providerKey: string;
  carrierName: string;
  serviceName: string;
  amount: Money;
  estimatedDays: number | null;
}

// ------------------------------------------------------------------ shipping config

export interface ShippingRules {
  baseRateMinor?: number | null;
  perKgRateMinor?: number | null;
  freeAboveMinor?: number | null;
  maxWeightGrams?: number | null;
  transitMinDays?: number | null;
  transitMaxDays?: number | null;
}

export interface ShippingMethodView {
  id: string;
  zoneId: string;
  name: string;
  methodType: string;
  currencyCode: string | null;
  status: string;
  rules: ShippingRules;
}

export interface ZoneCountry {
  id: string;
  name: string;
  iso2: string;
}

export interface ShippingZoneView {
  id: string;
  name: string;
  status: string;
  countries: ZoneCountry[];
  methods: ShippingMethodView[];
}

export interface ShippingConfig {
  profile: ShippingProfile | null;
  zones: ShippingZoneView[];
  providerCalculatedAvailable: boolean;
}

export interface ShippingMethodInput {
  name: string;
  methodType: string;
  currencyCode?: string | null;
  rules?: ShippingRules;
}

// ------------------------------------------------------------------ discounts / earnings

export interface DiscountCode {
  id: string;
  shopId: string;
  code: string;
  discountType: string;
  discountValue: number;
  currencyCode: string | null;
  minimumOrderAmountMinor: number | null;
  totalUsageLimit: number | null;
  perUserUsageLimit: number | null;
  startsAt: string | null;
  endsAt: string | null;
  status: string;
}

export interface DiscountCodeInput {
  code: string;
  discountType: string;
  discountValue: number;
  currencyCode?: string | null;
  minimumOrderAmountMinor?: number | null;
  totalUsageLimit?: number | null;
  perUserUsageLimit?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface TransferView {
  id: string;
  sellerOrderId: string;
  sellerOrderNumber: string;
  gross: Money;
  commission: Money;
  transfer: Money;
  reversed: Money;
  status: string;
  failureCode: string | null;
  transferredAt: string | null;
  createdAt: string;
}

export interface PayoutView {
  id: string;
  amount: Money;
  status: string;
  arrivalDate: string | null;
  paidAt: string | null;
  failedAt: string | null;
  failureCode: string | null;
  createdAt: string;
}

export interface EarningsTotals {
  currencyCode: string;
  grossSales: Money;
  commission: Money;
  refunds: Money;
  sellerNet: Money;
  pendingTransfers: Money;
  transferred: Money;
  transferReversals: Money;
  paidOut: Money;
}

export interface Earnings {
  shopId: string;
  sellerId: string;
  totals: EarningsTotals[];
  transfers: TransferView[];
  payouts: PayoutView[];
  paymentAccount: PaymentAccount;
}

export interface OnboardingLink {
  url: string;
  expiresAt: string;
}

/** Messaging conversation context types that belong to the shop marketplace
 * inbox (buyer↔seller chats about shops, products and orders). Matches
 * ConversationContextType in messaging-types. */
export const SHOP_CONTEXT_TYPES = new Set(["SHOP", "SHOP_PRODUCT", "SHOP_ORDER"]);
