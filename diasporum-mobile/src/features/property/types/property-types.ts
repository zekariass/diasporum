/** Property Marketplace DTOs — mirrors PropertyController and PropertyModels. */

export type ListingPurpose = "SALE" | "RENT";
export type PropertyVisibility =
  | "COMMUNITY"
  | "COUNTRY"
  | "SELECTED_COMMUNITIES";
export type PropertyStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "PUBLISHED"
  | "PAUSED"
  | "SOLD"
  | "RENTED"
  | "EXPIRED"
  | "REJECTED"
  | "REMOVED"
  | "CLOSED";
export type FurnishedStatus =
  | "FURNISHED"
  | "PART_FURNISHED"
  | "UNFURNISHED"
  | "UNSPECIFIED";

export interface AddressInput {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
}

export interface ContactInput {
  phone?: string;
  whatsapp?: string;
  email?: string;
  preferredMethod?: "PHONE" | "WHATSAPP" | "EMAIL";
  showPhone?: boolean;
  showWhatsapp?: boolean;
  showEmail?: boolean;
}

export interface PropertyCommand {
  countryId: string;
  communityId?: string;
  businessAccountId?: string;
  businessListingId?: string;
  propertyTypeId: string;
  visibilityScope?: PropertyVisibility;
  listingPurpose: ListingPurpose;
  title: string;
  description: string;
  additionalAttributes?: Record<string, unknown>;
  priceAmount: number;
  currencyCode: string;
  pricePeriod?: "TOTAL" | "WEEK" | "MONTH" | "YEAR";
  address?: AddressInput;
  bedrooms?: number;
  bathrooms?: number;
  receptionRooms?: number;
  floorArea?: number;
  floorAreaUnit?: "SQM" | "SQFT";
  furnishedStatus?: FurnishedStatus;
  rentalDeposit?: number;
  billsIncluded?: boolean;
  minimumTenancyMonths?: number;
  availabilityDate?: string;
  tenure?: string;
  conditionKey?: string;
  communityIds?: string[];
  amenityIds?: string[];
  contact?: ContactInput;
}

export interface PropertyType {
  id: string;
  typeKey: string;
  displayName: string;
}

export interface Amenity {
  id: string;
  amenityKey: string;
  displayName: string;
}

export interface PublicLocation {
  countryName?: string | null;
  city: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface PropertyRow {
  id: string;
  countryId: string;
  communityId: string | null;
  ownerUserId: string | null;
  businessAccountId: string | null;
  businessListingId: string | null;
  createdByUserId: string | null;
  propertyTypeId: string;
  visibilityScope: PropertyVisibility;
  listingPurpose: ListingPurpose;
  title: string;
  description: string;
  additionalAttributes: Record<string, unknown> | null;
  priceAmount: number;
  currencyCode: string;
  pricePeriod: "TOTAL" | "WEEK" | "MONTH" | "YEAR" | null;
  bedrooms: number | null;
  bathrooms: number | null;
  receptionRooms: number | null;
  floorArea: number | null;
  floorAreaUnit: "SQM" | "SQFT" | null;
  furnishedStatus: FurnishedStatus | null;
  rentalDeposit: number | null;
  billsIncluded: boolean | null;
  minimumTenancyMonths: number | null;
  availabilityDate: string | null;
  tenure: string | null;
  conditionKey: string | null;
  status: PropertyStatus;
  expiresAt: string | null;
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyItem {
  property: PropertyRow;
  propertyType: PropertyType | null;
  location: PublicLocation | null;
  coverMediaId: string | null;
  saved: boolean;
  canManage: boolean;
  viewCount: number;
  enquiryCount: number;
  saveCount: number;
}

export interface PropertyPage {
  totalCount?: number | null;
  items: PropertyItem[];
  nextCursor: string | null;
}

export interface PropertyMedia {
  mediaId: string;
  sortOrder: number;
  cover: boolean;
}

export interface PropertyContact {
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  preferredMethod: "PHONE" | "WHATSAPP" | "EMAIL" | null;
}

export interface PropertyOwner {
  displayName: string | null;
  businessAccountName: string | null;
  avatarMediaId?: string | null;
}

/** Public Business Profile the listing is published under, when associated. */
export interface PropertyListedBy {
  businessId: string;
  name: string;
  categoryName: string | null;
  verificationStatus: string;
  logoMediaId?: string | null;
}

/** Manager-only private address projection — null for public viewers. */
export interface PrivateAddress {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface PropertyDetail {
  item: PropertyItem;
  media: PropertyMedia[];
  amenities: Amenity[];
  contact: PropertyContact | null;
  owner: PropertyOwner | null;
  listedBy: PropertyListedBy | null;
  privateAddress: PrivateAddress | null;
  communityIds: string[];
}

export type PropertySort = "NEWEST" | "PRICE_ASC" | "PRICE_DESC";

export interface PropertyDiscoveryFilters {
  sort?: PropertySort;
  currencyCode?: string;
  pricePeriod?: "TOTAL" | "WEEK" | "MONTH" | "YEAR";
  minFloorArea?: number;
  maxFloorArea?: number;
  floorAreaUnit?: "SQM" | "SQFT";
  availableBy?: string;
  maxDeposit?: number;
  billsIncluded?: boolean;
  maxTenancyMonths?: number;
  tenure?: string;
  conditionKey?: string;
  maxBathrooms?: number;
  countryId?: string;
  communityId?: string;
  propertyTypeId?: string;
  listingPurpose?: ListingPurpose;
  minPrice?: number;
  maxPrice?: number;
  minBedrooms?: number;
  maxBedrooms?: number;
  bathrooms?: number;
  furnishedStatus?: FurnishedStatus;
  city?: string;
  search?: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  businessListingId?: string;
}

export interface PropertyImageSelection {
  uri: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  size: number;
}
