/**
 * Business API service tests — verifies authenticated endpoints and payloads.
 * Uses a mock ApiClient; no network or backend is involved.
 */

import { createBusinessApi } from "@/features/business/services/business-api";

const client = {
  get: jest.fn(() => Promise.resolve({ items: [] })),
  post: jest.fn(() => Promise.resolve({})),
};

const api = createBusinessApi(client as never);

beforeEach(() => jest.clearAllMocks());

describe("businessApi", () => {
  it("loads accounts through the authenticated collection endpoint", async () => {
    await api.accounts();

    expect(client.get).toHaveBeenCalledWith("/api/v1/business-accounts", {
      authenticated: true,
    });
  });

  it("creates an account with only the supported accountName field", async () => {
    await api.createAccount("Habesha Group");

    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/business-accounts",
      { accountName: "Habesha Group" },
      { authenticated: true },
    );
  });

  it("loads the selected account workspace with authentication", async () => {
    await api.workspace("account-123");

    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/business-accounts/account-123/workspace",
      { authenticated: true },
    );
  });
});
