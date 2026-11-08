import { useCallback, useMemo, useSyncExternalStore } from "react";
import { ApiError } from "@/core/api/api-error";
import { useSession } from "@/core/session/session-provider";
import { createPropertyApi } from "../services/property-api";

import { propertySaveStore } from "../utils/property-save-store";

export function usePropertySave(id: string, initialSaved: boolean) {
  const { apiClient } = useSession();
  const store = useMemo(() => propertySaveStore(apiClient), [apiClient]);
  const snapshot = useCallback(() => store.values.get(id), [store, id]);
  const state = useSyncExternalStore(store.subscribe, snapshot, snapshot);
  const toggle = useCallback(async () => {
    const previous = store.values.get(id);
    if (previous?.pending) return;
    const saved = !(previous?.saved ?? initialSaved);
    store.set(id, { saved, pending: true, error: null });
    try {
      const api = createPropertyApi(apiClient);
      if (saved) await api.save(id);
      else await api.unsave(id);
      store.set(id, { saved, pending: false, error: null });
      return true;
    } catch (cause) {
      store.set(id, {
        saved: !saved,
        pending: false,
        error: ApiError.isApiError(cause)
          ? cause.userMessage
          : "Could not update saved properties. Please try again.",
      });
      return false;
    }
  }, [apiClient, id, initialSaved, store]);
  return {
    saved: state?.saved ?? initialSaved,
    pending: state?.pending ?? false,
    error: state?.error,
    toggle,
  };
}
