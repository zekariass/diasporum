import type { ApiClient } from "@/core/api/api-client";
import type {
  BusinessAccount,
  BusinessAuditEvent,
  BusinessBilling,
  BusinessInvitation,
  BusinessListings,
  BusinessMember,
  BusinessOverview,
  BusinessRole,
  BusinessWorkspace,
} from "../types/business-types";

export function createBusinessApi(client: ApiClient) {
  const base = "/api/v1/business-accounts";
  return {
    accounts: () =>
      client.get<{ items: BusinessAccount[] }>(base, {
        authenticated: true,
      }),

    createAccount: (accountName: string, idempotencyKey?: string) =>
      client.post<BusinessAccount>(
        base,
        idempotencyKey ? { accountName, idempotencyKey } : { accountName },
        { authenticated: true },
      ),

    workspace: (accountId: string) =>
      client.get<BusinessWorkspace>(`${base}/${accountId}/workspace`, {
        authenticated: true,
      }),

    renameAccount: (accountId: string, accountName: string) =>
      client.patch<BusinessWorkspace>(
        `${base}/${accountId}`,
        { accountName },
        { authenticated: true },
      ),

    closeAccount: (accountId: string, reason?: string) =>
      client.post<void>(
        `${base}/${accountId}/close`,
        reason ? { reason } : {},
        { authenticated: true },
      ),

    auditEvents: (accountId: string) =>
      client.get<{ items: BusinessAuditEvent[] }>(
        `${base}/${accountId}/audit-events`,
        { authenticated: true },
      ),

    members: (accountId: string) =>
      client.get<{ items: BusinessMember[] }>(`${base}/${accountId}/members`, {
        authenticated: true,
      }),

    invite: (
      accountId: string,
      username: string,
      role: BusinessRole,
      expiresInDays?: number,
    ) =>
      client.post<BusinessMember>(
        `${base}/${accountId}/invitations`,
        expiresInDays
          ? { username, role, expiresInDays }
          : { username, role },
        { authenticated: true },
      ),

    revokeInvitation: (accountId: string, userId: string) =>
      client.delete<void>(`${base}/${accountId}/invitations/${userId}`, {
        authenticated: true,
      }),

    changeRole: (accountId: string, userId: string, role: BusinessRole) =>
      client.patch<BusinessMember>(
        `${base}/${accountId}/members/${userId}`,
        { role },
        { authenticated: true },
      ),

    revokeMember: (accountId: string, userId: string) =>
      client.delete<void>(`${base}/${accountId}/members/${userId}`, {
        authenticated: true,
      }),

    transferOwnership: (accountId: string, newOwnerUserId: string) =>
      client.post<void>(
        `${base}/${accountId}/transfer-ownership`,
        { newOwnerUserId },
        { authenticated: true },
      ),

    billing: (accountId: string) =>
      client.get<BusinessBilling>(`${base}/${accountId}/billing`, {
        authenticated: true,
      }),

    listings: (accountId: string) =>
      client.get<BusinessListings>(`${base}/${accountId}/listings`, {
        authenticated: true,
      }),

    overview: (accountId: string, days = 30) =>
      client.get<BusinessOverview>(
        `${base}/${accountId}/overview?days=${days}`,
        { authenticated: true },
      ),

    invitations: () =>
      client.get<{ items: BusinessInvitation[] }>(
        "/api/v1/me/business-invitations",
        { authenticated: true },
      ),

    acceptInvitation: (accountId: string) =>
      client.post<BusinessMember>(
        `/api/v1/me/business-invitations/${accountId}/accept`,
        {},
        { authenticated: true },
      ),

    declineInvitation: (accountId: string) =>
      client.post<{ declined: boolean }>(
        `/api/v1/me/business-invitations/${accountId}/decline`,
        {},
        { authenticated: true },
      ),
  };
}
