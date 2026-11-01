import type { ApiClient } from "@/core/api/api-client";
import type {
  BusinessAccount,
  BusinessWorkspace,
} from "../types/business-types";

export function createBusinessApi(client: ApiClient) {
  return {
    accounts: () =>
      client.get<{ items: BusinessAccount[] }>("/api/v1/business-accounts", {
        authenticated: true,
      }),

    createAccount: (accountName: string) =>
      client.post<BusinessAccount>(
        "/api/v1/business-accounts",
        { accountName },
        { authenticated: true },
      ),

    workspace: (accountId: string) =>
      client.get<BusinessWorkspace>(
        `/api/v1/business-accounts/${accountId}/workspace`,
        { authenticated: true },
      ),
  };
}
