/**
 * Business API service tests — verifies authenticated endpoints and payloads.
 * Uses a mock ApiClient; no network or backend is involved.
 */

import { createBusinessApi } from "@/features/business/services/business-api";

const client = {
  get: jest.fn(() => Promise.resolve({ items: [] })),
  post: jest.fn(() => Promise.resolve({})),
  patch: jest.fn(() => Promise.resolve({})),
  delete: jest.fn(() => Promise.resolve({})),
};

const api = createBusinessApi(client as never);

const base = "/api/v1/business-accounts";
const auth = { authenticated: true };

beforeEach(() => jest.clearAllMocks());

describe("businessApi", () => {
  it("loads accounts through the authenticated collection endpoint", async () => {
    await api.accounts();

    expect(client.get).toHaveBeenCalledWith(base, auth);
  });

  it("creates an account with only the supported accountName field", async () => {
    await api.createAccount("Habesha Group");

    expect(client.post).toHaveBeenCalledWith(
      base,
      { accountName: "Habesha Group" },
      auth,
    );
  });

  it("sends the idempotency key when provided for safe creation retries", async () => {
    await api.createAccount("Habesha Group", "key-123");

    expect(client.post).toHaveBeenCalledWith(
      base,
      { accountName: "Habesha Group", idempotencyKey: "key-123" },
      auth,
    );
  });

  it("loads the selected account workspace with authentication", async () => {
    await api.workspace("account-123");

    expect(client.get).toHaveBeenCalledWith(
      `${base}/account-123/workspace`,
      auth,
    );
  });

  it("renames the account via PATCH", async () => {
    await api.renameAccount("account-123", "New Name");

    expect(client.patch).toHaveBeenCalledWith(
      `${base}/account-123`,
      { accountName: "New Name" },
      auth,
    );
  });

  it("closes the account with an optional reason", async () => {
    await api.closeAccount("account-123", "no longer needed");

    expect(client.post).toHaveBeenCalledWith(
      `${base}/account-123/close`,
      { reason: "no longer needed" },
      auth,
    );
  });

  it("omits the reason key entirely when closing without one", async () => {
    await api.closeAccount("account-123");

    expect(client.post).toHaveBeenCalledWith(
      `${base}/account-123/close`,
      {},
      auth,
    );
  });

  it("loads audit events", async () => {
    await api.auditEvents("account-123");

    expect(client.get).toHaveBeenCalledWith(
      `${base}/account-123/audit-events`,
      auth,
    );
  });

  it("loads members", async () => {
    await api.members("account-123");

    expect(client.get).toHaveBeenCalledWith(
      `${base}/account-123/members`,
      auth,
    );
  });

  it("sends invitations with role and optional expiry", async () => {
    await api.invite("account-123", "someuser", "EDITOR", 7);

    expect(client.post).toHaveBeenCalledWith(
      `${base}/account-123/invitations`,
      { username: "someuser", role: "EDITOR", expiresInDays: 7 },
      auth,
    );
  });

  it("omits expiresInDays when not provided", async () => {
    await api.invite("account-123", "someuser", "EDITOR");

    expect(client.post).toHaveBeenCalledWith(
      `${base}/account-123/invitations`,
      { username: "someuser", role: "EDITOR" },
      auth,
    );
  });

  it("revokes a pending invitation", async () => {
    await api.revokeInvitation("account-123", "user-9");

    expect(client.delete).toHaveBeenCalledWith(
      `${base}/account-123/invitations/user-9`,
      auth,
    );
  });

  it("changes a member role", async () => {
    await api.changeRole("account-123", "user-9", "ADMINISTRATOR");

    expect(client.patch).toHaveBeenCalledWith(
      `${base}/account-123/members/user-9`,
      { role: "ADMINISTRATOR" },
      auth,
    );
  });

  it("removes a member", async () => {
    await api.revokeMember("account-123", "user-9");

    expect(client.delete).toHaveBeenCalledWith(
      `${base}/account-123/members/user-9`,
      auth,
    );
  });

  it("transfers ownership", async () => {
    await api.transferOwnership("account-123", "user-9");

    expect(client.post).toHaveBeenCalledWith(
      `${base}/account-123/transfer-ownership`,
      { newOwnerUserId: "user-9" },
      auth,
    );
  });

  it("loads the billing summary", async () => {
    await api.billing("account-123");

    expect(client.get).toHaveBeenCalledWith(
      `${base}/account-123/billing`,
      auth,
    );
  });

  it("loads the aggregated listings", async () => {
    await api.listings("account-123");

    expect(client.get).toHaveBeenCalledWith(
      `${base}/account-123/listings`,
      auth,
    );
  });

  it("loads the personal invitation inbox", async () => {
    await api.invitations();

    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/me/business-invitations",
      auth,
    );
  });

  it("accepts an invitation through the /me inbox", async () => {
    await api.acceptInvitation("account-123");

    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/me/business-invitations/account-123/accept",
      {},
      auth,
    );
  });

  it("declines an invitation through the /me inbox", async () => {
    await api.declineInvitation("account-123");

    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/me/business-invitations/account-123/decline",
      {},
      auth,
    );
  });
});
