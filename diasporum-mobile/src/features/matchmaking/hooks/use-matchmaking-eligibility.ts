import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useMatchmakingApi } from "./use-matchmaking-api";
import { matchmakingError } from "../services/matchmaking-errors";
import type { MatchmakingEligibility } from "../types/matchmaking-types";

/**
 * Resolves the server-computed Dating entry state once per mount. The backend is
 * authoritative for eligibility — no cached profile flags or client-side guesses.
 */
export function useMatchmakingEligibility() {
  const api = useMatchmakingApi();
  const [eligibility, setEligibility] = useState<MatchmakingEligibility | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.eligibility();
      if (mounted.current) setEligibility(result);
    } catch (cause) {
      if (mounted.current) {
        setError(matchmakingError(cause, "Dating status could not be loaded."));
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return { eligibility, loading, error, refresh };
}
