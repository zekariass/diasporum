export type ProviderStatus = "ACTIVE" | "PAUSED" | "SUSPENDED" | "CLOSED";
export type RequestStatus =
  | "DRAFT"
  | "OPEN"
  | "PAUSED"
  | "CLOSED"
  | "EXPIRED"
  | "CANCELLED"
  | "REMOVED";
export type ResponseType = "INTEREST" | "CONTACT";
export type ServiceSort = "NEWEST" | "DISTANCE" | "PRICE_ASC" | "PRICE_DESC";

export interface ServiceCategory {
  id: string;
  categoryKey: string;
  parentId: string | null;
  displayName: string;
  description: string | null;
  sortOrder: number;
}

export interface ServiceProvider {
  id: string;
  ownerUserId: string | null;
  businessAccountId: string | null;
  displayName: string;
  description: string | null;
  baseLatitude: number | null;
  baseLongitude: number | null;
  radiusKm: number | null;
  status: ProviderStatus;
  verificationStatus: string;
  categories: ServiceCategory[];
  distanceMeters: number | null;
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceRequest {
  id: string;
  customerUserId: string;
  customerDisplayName: string;
  serviceCategoryId: string;
  categoryDisplayName: string;
  countryId: string;
  addressId: string | null;
  latitude: number;
  longitude: number;
  title: string;
  description: string;
  budgetMin: number | null;
  budgetMax: number | null;
  currencyCode: string | null;
  preferredDate: string | null;
  status: RequestStatus;
  expiresAt: string | null;
  publishedAt: string | null;
  mediaIds: string[];
  distanceMeters: number | null;
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderResponse {
  id: string;
  serviceRequestId: string;
  serviceProviderId: string;
  providerDisplayName: string;
  respondedByUserId: string;
  responseType: ResponseType;
  message: string;
  quotedAmount: number | null;
  currencyCode: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContactAddress {
  id: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface LeadAccess {
  id: string;
  serviceRequestId: string;
  serviceProviderId: string;
  chatEnabled: boolean;
  contactDetailsUnlocked: boolean;
  status: "ACTIVE" | "REVOKED";
  grantedByUserId: string;
  accessedAt: string;
  contactAddress: ContactAddress | null;
}

export interface ServiceReview {
  id: string;
  serviceRequestId: string;
  serviceProviderId: string;
  reviewerUserId: string;
  reviewerDisplayName: string;
  rating: number;
  reviewText: string | null;
  status: string;
  providerResponse: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceReport {
  id: string;
  targetType: "SERVICE_REQUEST" | "SERVICE_PROVIDER" | "SERVICE_REVIEW";
  targetId: string;
  status: string;
}

export interface ProviderInput {
  businessAccountId?: string;
  displayName: string;
  description?: string;
  baseLatitude: number;
  baseLongitude: number;
  radiusKm: number;
  categoryIds: string[];
}

export interface ServiceRequestInput {
  serviceCategoryId: string;
  countryId: string;
  addressId?: string;
  latitude: number;
  longitude: number;
  title: string;
  description: string;
  budgetMin?: number;
  budgetMax?: number;
  currencyCode?: string;
  preferredDate?: string;
  expiresAt?: string;
  mediaIds: string[];
}

export interface ProviderDiscoveryFilters {
  categoryId?: string;
  originLatitude?: number;
  originLongitude?: number;
  radiusKm?: number;
  q?: string;
  sort?: "NEWEST" | "DISTANCE";
}

export interface RequestDiscoveryFilters {
  serviceProviderId?: string;
  categoryId?: string;
  countryId?: string;
  city?: string;
  budgetMin?: number;
  budgetMax?: number;
  currencyCode?: string;
  preferredDateFrom?: string;
  preferredDateTo?: string;
  maxDistanceKm?: number;
  sort?: ServiceSort;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
