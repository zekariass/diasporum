export type ProviderStatus = "ACTIVE" | "PAUSED" | "SUSPENDED" | "CLOSED";
export type ProviderOnboardingStatus =
  | "DRAFT"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED";
export type QuoteStatus =
  | "SENT"
  | "ACCEPTED"
  | "DECLINED"
  | "WITHDRAWN"
  | "EXPIRED"
  | "SUPERSEDED";
export type EngagementStatus =
  | "ACCEPTED"
  | "IN_PROGRESS"
  | "COMPLETION_SUBMITTED"
  | "COMPLETED"
  | "CANCELLED"
  | "ISSUE_RAISED";
export type EngagementAction =
  | "START"
  | "SUBMIT_COMPLETION"
  | "COMPLETE"
  | "RAISE_ISSUE"
  | "CANCEL";
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
  onboardingStatus: ProviderOnboardingStatus;
  onboardingSubmittedAt: string | null;
  onboardingReviewedAt: string | null;
  onboardingReviewedByUserId: string | null;
  onboardingRejectionReason: string | null;
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
  repostedFromRequestId: string | null;
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
  billingUsageRecordId: string | null;
  leadPrice: number;
  leadCurrency: string;
  accessedAt: string;
  contactAddress: ContactAddress | null;
}

export interface ServiceConfiguration {
  maxProvidersPerRequest: number;
  leadPrice: number;
  leadCurrency: string;
}

export interface QuoteItemInput {
  description: string;
  quantity: number;
  unitLabel?: string;
  unitAmount: number;
}

export interface QuoteInput {
  serviceProviderId: string;
  supersedesQuoteId?: string;
  title: string;
  scopeOfWork: string;
  amount: number;
  currencyCode: string;
  estimatedDurationValue?: number;
  estimatedDurationUnit?: "HOUR" | "DAY" | "WEEK" | "MONTH";
  validUntil?: string;
  inclusions?: string;
  exclusions?: string;
  termsAndConditions?: string;
  items: QuoteItemInput[];
}

export interface ServiceQuoteItem {
  id: string;
  lineNo: number;
  description: string;
  quantity: number;
  unitLabel: string | null;
  unitAmount: number;
  lineAmount: number;
}

export interface ServiceQuote {
  id: string;
  serviceRequestId: string;
  serviceProviderId: string;
  providerDisplayName: string;
  revisionNo: number;
  supersedesQuoteId: string | null;
  submittedByUserId: string;
  title: string;
  scopeOfWork: string;
  amount: number;
  currencyCode: string;
  estimatedDurationValue: number | null;
  estimatedDurationUnit: "HOUR" | "DAY" | "WEEK" | "MONTH" | null;
  validUntil: string | null;
  inclusions: string | null;
  exclusions: string | null;
  termsAndConditions: string | null;
  status: QuoteStatus;
  sentAt: string;
  respondedAt: string | null;
  items: ServiceQuoteItem[];
}

export interface ServiceEngagement {
  id: string;
  serviceRequestId: string;
  acceptedQuoteId: string;
  serviceProviderId: string;
  providerDisplayName: string;
  customerUserId: string;
  status: EngagementStatus;
  acceptedAt: string;
  startedAt: string | null;
  completionSubmittedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  issueRaisedAt: string | null;
  issueReason: string | null;
  customerCompletionNote: string | null;
  providerCompletionNote: string | null;
  createdAt: string;
  updatedAt: string;
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
