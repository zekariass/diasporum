export type VisibilityScope =
  | "COUNTRY"
  | "COMMUNITY"
  | "SELECTED_COMMUNITIES";
export type BusinessStatus = "DRAFT" | "PUBLISHED" | "DELETED";
export type VerificationStatus =
  | "UNVERIFIED"
  | "PENDING"
  | "VERIFIED"
  | "REJECTED"
  | "REVOKED";
export type BusinessMediaRole = "LOGO" | "COVER" | "GALLERY";

export interface BusinessCategory {
  id: string;
  countryId: string | null;
  name: string;
  slug: string;
  iconKey: string | null;
  active: boolean;
}

export interface Business {
  id: string;
  countryId: string;
  category: BusinessCategory | null;
  name: string;
  slug: string;
  description: string;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
  verificationStatus: VerificationStatus;
  status: BusinessStatus;
  visibilityScope: VisibilityScope;
  communityId: string | null;
  averageRating: number | null;
  reviewCount: number;
  sponsored: boolean;
  createdAt: string;
  updatedAt: string;
  saved: boolean;
  canManage: boolean;
  businessAccountName: string | null;
  logoMediaId: string | null;
  coverMediaId: string | null;
  distanceMeters: number | null;
}

export interface BusinessAddress {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface OpeningHour {
  dayOfWeek: number;
  openTime: string | null;
  closeTime: string | null;
  closed: boolean;
}

export interface BusinessBranch {
  id: string;
  businessId: string;
  addressId: string;
  locationName: string | null;
  phone: string | null;
  primary: boolean;
  active: boolean;
  timezone: string;
  address: BusinessAddress;
  hours: OpeningHour[];
}

export interface BusinessMedia {
  mediaId: string;
  sortOrder: number;
  role: BusinessMediaRole;
}

export interface BusinessDetail {
  business: Business;
  locations: BusinessBranch[];
  media: BusinessMedia[];
}

export interface Reviewer {
  id: string;
  username: string | null;
  displayName: string | null;
  accountStatus: string;
  profileCompleted: boolean;
  originCountryId: string | null;
  currentCountryId: string | null;
}

export interface BusinessReview {
  id: string;
  businessId: string;
  rating: number;
  body: string | null;
  ownerResponse: string | null;
  ownerRespondedAt: string | null;
  createdAt: string;
  updatedAt: string;
  reviewer: Reviewer | null;
  mine: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface DiscoveryFilters {
  countryId?: string;
  communityId?: string;
  categoryId?: string;
  city?: string;
  search?: string;
  verifiedOnly?: boolean;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  sort?: "newest" | "distance";
}

export interface BusinessRequest {
  countryId?: string;
  businessAccountId?: string;
  categoryId: string;
  name: string;
  description: string;
  phone?: string | null;
  email?: string | null;
  websiteUrl?: string | null;
  visibilityScope: VisibilityScope;
  communityId?: string;
  selectedCommunityIds?: string[];
}

export interface AddressRequest {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  formattedAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  clearCoordinates?: boolean;
}

export interface BranchRequest {
  locationName?: string | null;
  phone?: string | null;
  primary?: boolean;
  active?: boolean;
  timezone?: string;
  address?: AddressRequest;
}

export interface SelectedImage {
  uri: string;
  mimeType: string;
  size?: number;
}
