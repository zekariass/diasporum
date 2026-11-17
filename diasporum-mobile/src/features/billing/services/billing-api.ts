import type { ApiClient } from "@/core/api/api-client";
import type {
  BillingOptionsView,
  CheckoutRequest,
  CheckoutResult,
  ProofRequest,
  ProofResult,
  SubscriptionView,
} from "../types/billing-types";

const BASE = "/api/v1/me/billing";

function blankToUndefined(v: string | null | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

export function createBillingApi(client: ApiClient) {
  return {
    options: (countryId?: string) =>
      client.get<BillingOptionsView>(
        countryId
          ? `${BASE}/options?countryId=${encodeURIComponent(countryId)}`
          : `${BASE}/options`,
        { authenticated: true },
      ),

    checkout: (req: CheckoutRequest) =>
      client.post<CheckoutResult>(`${BASE}/checkout`, req, {
        authenticated: true,
      }),

    /** Backend wraps the result as `{ subscription: SubscriptionView | null }`. */
    subscription: async (): Promise<SubscriptionView | null> => {
      const res = await client.get<{ subscription: SubscriptionView | null }>(
        `${BASE}/subscription`,
        { authenticated: true },
      );
      return res?.subscription ?? null;
    },

    /** `billingArrangement` must be sent as exactly "PREPAID" for renewals. */
    renew: (req: Partial<CheckoutRequest> & { idempotencyKey: string }) =>
      client.post<CheckoutResult>(
        `${BASE}/subscription/renew`,
        { ...req, billingArrangement: "PREPAID" },
        { authenticated: true },
      ),

    submitProof: (paymentId: string, req: ProofRequest) =>
      client.post<ProofResult>(
        `${BASE}/payments/${encodeURIComponent(paymentId)}/proofs`,
        {
          proofReference: blankToUndefined(req.proofReference),
          mediaObjectId: blankToUndefined(req.mediaObjectId),
          notes: blankToUndefined(req.notes),
        },
        { authenticated: true },
      ),
  };
}

export type BillingApi = ReturnType<typeof createBillingApi>;
