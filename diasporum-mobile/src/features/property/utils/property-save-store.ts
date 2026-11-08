import type { ApiClient } from "@/core/api/api-client";

type SaveState = {
  saved: boolean;
  pending: boolean;
  error: string | null;
  revision: number;
};
function createStore() {
  const values = new Map<string, SaveState>();
  const listeners = new Set<() => void>();
  let revision = 0;
  const emit = () => listeners.forEach((listener) => listener());
  return {
    values,
    version: () => revision,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (id: string, value: Omit<SaveState, "revision">) => {
      values.set(id, { ...value, revision: ++revision });
      emit();
    },
    reconcile: (id: string, saved: boolean, readVersion: number) => {
      const current = values.get(id);
      // Reads started before/during a mutation must not undo its optimistic result.
      if (current && (current.pending || current.revision > readVersion))
        return;
      if (current?.saved === saved) return;
      values.set(id, {
        saved,
        pending: false,
        error: null,
        revision: readVersion,
      });
      emit();
    },
  };
}

const stores = new WeakMap<ApiClient, ReturnType<typeof createStore>>();
export function propertySaveStore(client: ApiClient) {
  let store = stores.get(client);
  if (!store) {
    store = createStore();
    stores.set(client, store);
  }
  return store;
}
