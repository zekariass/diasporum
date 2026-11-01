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
