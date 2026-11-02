/** Spare Bag DTOs mirror SpareBagController; no courier or payment workflow types. */

export type ListingType = "SENDER_REQUEST" | "PASSENGER_OFFER";
export type ListingStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "PUBLISHED"
  | "PAUSED"
  | "MATCHED"
  | "CLOSED"
  | "EXPIRED"
  | "REMOVED";
export type ContactStatus =
  | "PENDING"
  | "ACCEPTED"
  | "DECLINED"
  | "CANCELLED"
  | "EXPIRED"
  | "CLOSED";
export type PriceUnit = "PER_KG" | "PER_PARCEL";
export type ContactDirection = "INCOMING" | "OUTGOING";

export interface Airport {
  id: string;
  countryId: string;
  iataCode: string;
  icaoCode: string | null;
  name: string;
  city: string;
  countryName: string;
  countryIso2: string;
}

export interface Category {
  key: string;
  displayName: string;
  sortOrder: number;
}

export interface Owner {
  id: string;
  username: string;
  displayName: string | null;
}

export interface Address {
  id: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  formattedAddress: string | null;
}

export interface Listing {
  id: string;
  ownerUserId: string;
  listingType: ListingType;
  communityId: string | null;
  visibilityScope: "COMMUNITY" | "COUNTRY";
  originAirport: Airport;
  destinationAirport: Airport;
  title: string;
  description: string;
  travelDateStart: string;
  travelDateEnd: string | null;
  requestedWeightKg: number | null;
  requestedParcelCount: number | null;
  availableCapacityKg: number | null;
  availableParcelCount: number | null;
  maxSingleParcelKg: number | null;
  priceAmount: number;
  priceUnit: PriceUnit;
  priceCurrency: string;
  collectionPlace: string | null;
  handoverPlace: string | null;
  handoverNotes: string | null;
  status: ListingStatus;
  publishedAt: string | null;
  closesAt: string | null;
  createdAt: string;
  updatedAt: string;
  categories: Category[];
  mediaIds: string[];
  owner: Owner | null;
  saved: boolean;
  canManage: boolean;
  collectionAddress: Address | null;
  handoverAddress: Address | null;
}

export interface ListingPage {
  items: Listing[];
  nextCursor: string | null;
}

export interface ListingRequest {
  listingType: ListingType;
  communityId?: string;
  visibilityScope: "COMMUNITY" | "COUNTRY";
  originAirportId: string;
  destinationAirportId: string;
  title: string;
  description: string;
  travelDateStart: string;
  travelDateEnd?: string;
  requestedWeightKg?: number;
  requestedParcelCount?: number;
  availableCapacityKg?: number;
  availableParcelCount?: number;
  maxSingleParcelKg?: number;
  priceAmount: number;
  priceUnit: PriceUnit;
  priceCurrency: string;
  collectionPlace?: string;
  collectionAddressId?: string;
  handoverPlace?: string;
  handoverAddressId?: string;
  handoverNotes?: string;
  categoryKeys: string[];
  mediaIds: string[];
}

export interface DiscoveryFilters {
  listingType?: ListingType;
  communityId?: string;
  originCountryId?: string;
  destinationCountryId?: string;
  originAirportId?: string;
  destinationAirportId?: string;
  dateFrom?: string;
  dateTo?: string;
  maxPrice?: string;
  minimumCapacityKg?: string;
  priceCurrency?: string;
  categoryKey?: string;
}

export interface ContactRequestInput {
  ownListingId: string;
  targetListingId: string;
  parcelWeightKg?: number;
  proposedPriceAmount?: number;
  proposedPriceUnit?: PriceUnit;
  priceCurrency?: string;
  message?: string;
  idempotencyKey: string;
}

export interface ContactRequest {
  id: string;
  senderListingId: string;
  passengerListingId: string;
  requestedByUserId: string;
  respondedByUserId: string | null;
  directConversationId: string | null;
  status: ContactStatus;
  parcelWeightKg: number | null;
  proposedPriceAmount: number | null;
  proposedPriceUnit: PriceUnit | null;
  priceCurrency: string | null;
  message: string | null;
  responseNote: string | null;
  createdAt: string;
  updatedAt: string;
  respondedAt: string | null;
  expiresAt: string | null;
  senderListing: Listing;
  passengerListing: Listing;
  otherOwner: Owner | null;
  incoming: boolean;
}

export interface ContactPage {
  items: ContactRequest[];
  nextCursor: string | null;
}
