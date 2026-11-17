/** Wire shapes for /api/v1/me/billing (field names mirror the backend verbatim). */

export type BillingArrangement = "PREPAID" | "RECURRING";
export type BillingInterval = "MONTH" | "YEAR";

export interface BillingOption {
  planKey: string;
  planDisplayName: string;
  planId: string;
  priceId: string;
  amount: number;
  currencyCode: string;
  billingInterval: BillingInterval | string;
  intervalCount: number;
  billingArrangement: BillingArrangement | string;
  providerKey: string;
  providerDisplayName: string;
  methods: string[];
  requiresManualVerification: boolean;
}

export interface BillingOptionsView {
  countryId: string;
  countryIso2: string;
  defaultCurrency: string;
  supportedCurrencies: string[];
  recurringBillingEnabled: boolean;
  prepaidTermsEnabled: boolean;
  options: BillingOption[];
}

export interface CheckoutRequest {
  countryId: string;
  planKey: string;
  priceId: string;
  billingArrangement: string;
  billingInterval: string;
  intervalCount: number;
  currencyCode: string;
  providerKey: string;
  method: string;
  idempotencyKey: string;
}

export interface CheckoutResult {
  orderId: string;
  paymentId: string;
  subscriptionId: string | null;
  providerKey: string;
  status: string;
  instructions: string | null;
  details: Record<string, unknown> | null;
}

export interface SubscriptionView {
  id: string;
  userId: string;
  planId: string;
  planKey: string;
  status: string;
  billingArrangement: BillingArrangement | string;
  sourceType: string;
  countryId: string;
  currencyCode: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  providerKey: string | null;
  providerBillingId: string | null;
  sourceOrderId: string | null;
  renewalReminderSentAt: string | null;
}

export interface ProofRequest {
  proofReference?: string | null;
  mediaObjectId?: string | null;
  notes?: string | null;
}

export interface ProofResult {
  id: string;
  status: string;
}
