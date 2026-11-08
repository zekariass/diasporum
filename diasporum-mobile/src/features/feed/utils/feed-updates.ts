import type { ApiClient } from "@/core/api/api-client";
import type { FeedItem } from "../types/feed-types";

type Update = (item: FeedItem) => FeedItem;
type Listener = (id: string, update: Update) => void;
// Scoped to the authenticated API client; no user data retained after logout.
const listeners = new WeakMap<ApiClient, Set<Listener>>();
export function subscribeFeedUpdates(client: ApiClient, listener: Listener) {
  let set = listeners.get(client);
  if (!set) {
    set = new Set();
    listeners.set(client, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}
export function publishFeedUpdate(
  client: ApiClient,
  id: string,
  update: Update,
) {
  listeners.get(client)?.forEach((listener) => listener(id, update));
}
