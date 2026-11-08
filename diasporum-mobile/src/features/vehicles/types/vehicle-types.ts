import type { MediaUploadSelection } from "@/shared/services/media-upload";

export type VehiclePurpose = "SALE" | "RENT";
export type VehicleVisibility =
  | "COMMUNITY"
  | "COUNTRY"
  | "SELECTED_COMMUNITIES";
export type VehicleStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "PUBLISHED"
  | "PAUSED"
  | "SOLD"
  | "RENTED"
  | "REJECTED"
  | "EXPIRED"
  | "REMOVED";
export type VehicleSort = "NEWEST" | "PRICE_ASC" | "PRICE_DESC" | "DISTANCE";
export type VehicleAttributeValue = string | number | boolean;

export interface VehicleCatalogItem {
  id: string;
  key: string;
  displayName: string;
  sortOrder: number;
}

export interface VehicleAttributePolicy {
  type: "STRING" | "NUMBER" | "BOOLEAN" | string;
  required: boolean;
  minimum: number | null;
  maximum: number | null;
  options: string[];
  filterable: boolean;
}

export interface VehicleCategory {
  category: VehicleCatalogItem;
  coreFields: string[];
  requiredCoreFields: string[];
  allowedFeatures: string[];
  attributes: Record<string, VehicleAttributePolicy>;
}

export interface VehicleLocation {
  countryId: string | null;
  city: string | null;
  region: string | null;
  formattedAddress: string | null;
}

export interface VehicleListing {
  id: string;
  countryId: string;
  communityId: string | null;
  ownerUserId: string | null;
  businessAccountId: string | null;
  businessListingId: string | null;
  createdByUserId: string;
  visibilityScope: VehicleVisibility;
  listingPurpose: VehiclePurpose;
  categoryId: string;
  makeId: string | null;
  modelId: string | null;
  variantId: string | null;
  categoryKey: string | null;
  categoryName: string | null;
  makeName: string | null;
  modelName: string | null;
  variantName: string | null;
  title: string;
  description: string;
  modelYear: number | null;
  mileage: number | null;
  mileageUnit: string | null;
  fuelType: string | null;
  transmission: string | null;
  driveType: string | null;
  bodyType: string | null;
  engineSizeCc: number | null;
  colour: string | null;
  doors: number | null;
  seats: number | null;
  conditionKey: string | null;
  registrationYear: number | null;
  previousOwners: number | null;
  additionalAttributes: Record<string, VehicleAttributeValue>;
  motExpiry: string | null;
  serviceHistory: string | null;
  priceAmount: number | null;
  currencyCode: string | null;
  pricePeriod: "TOTAL" | "DAY" | "WEEK" | "MONTH" | null;
  rentalDeposit: number | null;
  mileageAllowance: number | null;
  rentalConditions: string | null;
  addressId: string | null;
  status: VehicleStatus;
  expiresAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  saved: boolean;
  distanceMeters: number | null;
  location: VehicleLocation | null;
}

export interface VehicleMedia {
  id: string;
  downloadUrl: string | null;
  sortOrder: number;
  cover: boolean;
}

export interface VehicleFeature {
  id: string;
  featureKey: string;
  displayName: string;
}

export interface VehicleSeller {
  userId: string | null;
  displayName: string | null;
  username: string | null;
  businessAccountId: string | null;
  businessName: string | null;
}

/** Seller contact channels as exposed to the viewer (flag-filtered server-side).
 *  show* flags are only populated for listing managers. */
export interface VehicleContact {
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  preferredMethod: string | null;
  showPhone?: boolean | null;
  showWhatsapp?: boolean | null;
  showEmail?: boolean | null;
}

/** Public Business Profile the listing is published under, when associated. */
export interface VehicleListedBy {
  businessId: string;
  name: string;
  categoryName: string | null;
  verificationStatus: string;
  averageRating: number | null;
  reviewCount: number | null;
}

export interface VehicleView {
  listing: VehicleListing;
  location: VehicleLocation | null;
  media: VehicleMedia[];
  features: VehicleFeature[];
  selectedCommunityIds: string[];
  seller: VehicleSeller | null;
  listedBy: VehicleListedBy | null;
  contact: VehicleContact | null;
  canManage: boolean;
}

export interface VehiclePage {
  items: VehicleView[];
  nextCursor: string | null;
  totalCount?: number | null;
}

export interface VehicleLocationRequest {
  city?: string;
  region?: string;
  formattedAddress?: string;
  discoveryLatitude?: number;
  discoveryLongitude?: number;
}

export interface VehicleRequest {
  businessAccountId?: string;
  businessListingId?: string;
  visibilityScope?: VehicleVisibility;
  communityId?: string;
  selectedCommunityIds?: string[];
  listingPurpose?: VehiclePurpose;
  categoryId?: string;
  makeId?: string;
  modelId?: string;
  variantId?: string;
  title?: string;
  description?: string;
  modelYear?: number;
  mileage?: number;
  mileageUnit?: string;
  fuelType?: string;
  transmission?: string;
  driveType?: string;
  bodyType?: string;
  engineSizeCc?: number;
  colour?: string;
  doors?: number;
  seats?: number;
  condition?: string;
  registrationYear?: number;
  previousOwners?: number;
  additionalAttributes?: Record<string, VehicleAttributeValue>;
  motExpiry?: string;
  serviceHistory?: string;
  priceAmount?: number;
  currencyCode?: string;
  pricePeriod?: "TOTAL" | "DAY" | "WEEK" | "MONTH";
  rentalDeposit?: number;
  mileageAllowance?: number;
  rentalConditions?: string;
  location?: VehicleLocationRequest;
  featureIds?: string[];
  expiresAt?: string;
  clearLocation?: boolean;
  clearExpiry?: boolean;
  clearFields?: string[];
  contact?: VehicleContactRequest;
  clearContact?: boolean;
}

export interface VehicleContactRequest {
  phone?: string;
  whatsapp?: string;
  email?: string;
  preferredMethod?: string;
  showPhone?: boolean;
  showWhatsapp?: boolean;
  showEmail?: boolean;
}

export interface VehicleDiscoveryFilters {
  keyword?: string;
  purpose?: VehiclePurpose;
  categoryId?: string;
  makeId?: string;
  modelId?: string;
  variantId?: string;
  yearMin?: number;
  yearMax?: number;
  mileageMin?: number;
  mileageMax?: number;
  mileageUnit?: string;
  colour?: string;
  pricePeriod?: string;
  priceMin?: number;
  priceMax?: number;
  currency?: string;
  fuelType?: string;
  transmission?: string;
  bodyType?: string;
  condition?: string;
  engineSizeMin?: number;
  engineSizeMax?: number;
  countryId?: string;
  communityId?: string;
  city?: string;
  region?: string;
  originLatitude?: number;
  originLongitude?: number;
  radiusMeters?: number;
  attributes?: Record<string, string>;
  sort?: VehicleSort;
  driveType?: string;
  seats?: number;
  doors?: number;
  registrationYearMin?: number;
  registrationYearMax?: number;
  businessListingId?: string;
}

/** Filter payload as persisted by the backend (`attributeFilters` naming). */
export type SavedVehicleSearchFilters = Omit<
  VehicleDiscoveryFilters,
  "attributes"
> & {
  attributeFilters?: Record<string, string>;
};

export interface VehicleSavedSearch {
  id: string;
  name: string;
  filters: SavedVehicleSearchFilters;
  createdAt: string;
}

export interface VehicleMediaItem {
  id: string;
  uri: string | null;
  selection: MediaUploadSelection | null;
  cover: boolean;
}

export type { MediaUploadSelection };
