import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@/core/session/session-provider";
import { createShopApi } from "./shop-api";
import type { Market } from "../types/shop-types";

/**
 * Resolves the buyer's marketplace: loads enabled markets once and picks the
 * profile's current country when it is an ACTIVE/BROWSING market, else the
 * first ACTIVE market. The selection can be overridden for a country picker.
 */
export function useMarket() {
  const { apiClient, session } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [overrideId, setOverrideId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMarkets(await api.markets());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load markets");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const market = useMemo(() => {
    const browsable = markets.filter((m) =>
      m.marketStatus === "ACTIVE" || m.marketStatus === "BROWSING_ONLY");
    if (!browsable.length) return null;
    const profileCountry = session?.profile?.currentCountryId ?? session?.profile?.originCountryId;
    if (overrideId) {
      const chosen = browsable.find((m) => m.countryId === overrideId);
      if (chosen) return chosen;
    }
    return browsable.find((m) => m.countryId === profileCountry)
        ?? browsable.find((m) => m.marketStatus === "ACTIVE")
        ?? browsable[0];
  }, [markets, overrideId, session?.profile]);

  return {
    market,
    markets: markets.filter((m) => m.marketStatus === "ACTIVE" || m.marketStatus === "BROWSING_ONLY"),
    selectMarket: setOverrideId,
    loading,
    error,
    reload: load,
  };
}
