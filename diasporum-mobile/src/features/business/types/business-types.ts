export type BusinessRole =
  | "OWNER"
  | "ADMINISTRATOR"
  | "EDITOR"
  | "LISTING_MANAGER"
  | "BILLING_MANAGER";

export type BusinessAccountStatus = "ACTIVE" | "SUSPENDED" | "CLOSED";

export interface BusinessAccount {
  id: string;
  accountName: string;
  status: BusinessAccountStatus;
  role: BusinessRole;
  profileCount: number;
  createdAt: string;
}

export interface BusinessCapabilities {
  manageProfiles: boolean;
  manageListings: boolean;
  manageTeam: boolean;
  manageBilling: boolean;
  manageSettings: boolean;
}

export interface BusinessWorkspace extends BusinessAccount {
  capabilities: BusinessCapabilities;
}

export type MembershipStatus = "ACTIVE" | "PENDING";

export interface BusinessMember {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarMediaId: string | null;
  role: BusinessRole;
  membershipStatus: MembershipStatus;
  invitationExpired: boolean;
  invitedByUserId: string | null;
  invitedByName: string | null;
  invitedAt: string;
  invitationExpiresAt: string | null;
  acceptedAt: string | null;
}

export interface BusinessInvitation {
  accountId: string;
  accountName: string;
  role: BusinessRole;
  invitedByUserId: string | null;
  invitedByName: string | null;
  invitedAt: string;
  expiresAt: string | null;
  expired: boolean;
}

export interface BusinessSubscription {
  planKey: string;
  displayName: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface BusinessSeats {
  used: number;
  limit: number | null;
}

export interface BusinessEntitlement {
  featureKey: string;
  displayName: string;
  featureKind: string;
  enabled: boolean;
  quantityLimit: number | null;
  resetPeriod: string | null;
}

export interface BusinessOrder {
  id: string;
  status: string;
  currencyCode: string;
  totalAmount: number;
  createdAt: string;
  paidAt: string | null;
}

export interface BusinessBilling {
  subscription: BusinessSubscription | null;
  seats: BusinessSeats;
  entitlements: BusinessEntitlement[];
  orders: BusinessOrder[];
}

export interface BusinessListingItem {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

export interface BusinessListingSection {
  total: number;
  items: BusinessListingItem[];
}

export interface BusinessListings {
  profiles: BusinessListingSection;
  events: BusinessListingSection;
  jobs: BusinessListingSection;
  properties: BusinessListingSection;
  vehicles: BusinessListingSection;
  providers: BusinessListingSection;
}

/** Workspace dashboard metrics for a reporting window. */
export interface BusinessOverview {
  periodDays: number;
  listingViews: number;
  enquiries: number;
  activeListings: number;
  upcomingEvents: number;
}

export interface BusinessAuditEvent {
  id: string;
  actionKey: string;
  reason: string | null;
  actorUserId: string | null;
  actorName: string | null;
  targetUserId: string | null;
  targetName: string | null;
  createdAt: string;
}
