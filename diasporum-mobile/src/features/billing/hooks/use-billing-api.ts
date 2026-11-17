import { useMemo } from "react";

import { useSession } from "@/core/session/session-provider";
import { createBillingApi } from "../services/billing-api";

export function useBillingApi() {
  const { apiClient } = useSession();
  return useMemo(() => createBillingApi(apiClient), [apiClient]);
}
