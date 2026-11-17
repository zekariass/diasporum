import { createBillingApi } from "@/features/billing/services/billing-api";

const client = {
  get: jest.fn(() => Promise.resolve({})),
  post: jest.fn(() => Promise.resolve({})),
  put: jest.fn(() => Promise.resolve({})),
  patch: jest.fn(() => Promise.resolve({})),
  delete: jest.fn(() => Promise.resolve({})),
};
const api = createBillingApi(client as never);
const auth = { authenticated: true };

beforeEach(() => jest.clearAllMocks());

describe("billing api", () => {
  it("loads options without and with a country", async () => {
    await api.options();
    expect(client.get).toHaveBeenCalledWith("/api/v1/me/billing/options", auth);
    await api.options("c 1");
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/me/billing/options?countryId=c%201",
      auth,
    );
  });

  it("posts checkout with the request body verbatim", async () => {
    const req = {
      countryId: "c",
      planKey: "PRO",
      priceId: "p",
      billingArrangement: "PREPAID",
      billingInterval: "MONTH",
      intervalCount: 1,
      currencyCode: "USD",
      providerKey: "BANK_TRANSFER",
      method: "BANK_TRANSFER",
      idempotencyKey: "k",
    };
    await api.checkout(req);
    expect(client.post).toHaveBeenCalledWith("/api/v1/me/billing/checkout", req, auth);
  });

  it("unwraps the subscription envelope", async () => {
    client.get.mockResolvedValueOnce({ subscription: { id: "s1" } } as never);
    await expect(api.subscription()).resolves.toEqual({ id: "s1" });
    client.get.mockResolvedValueOnce({ subscription: null } as never);
    await expect(api.subscription()).resolves.toBeNull();
    client.get.mockResolvedValueOnce({} as never);
    await expect(api.subscription()).resolves.toBeNull();
  });

  it("always sends PREPAID on renew", async () => {
    await api.renew({ idempotencyKey: "k" });
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/me/billing/subscription/renew",
      { idempotencyKey: "k", billingArrangement: "PREPAID" },
      auth,
    );
  });

  it("submits proof, omitting blank fields", async () => {
    await api.submitProof("pay/1", {
      proofReference: "  REF  ",
      mediaObjectId: null,
      notes: "   ",
    });
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/me/billing/payments/pay%2F1/proofs",
      { proofReference: "REF", mediaObjectId: undefined, notes: undefined },
      auth,
    );
  });
});
