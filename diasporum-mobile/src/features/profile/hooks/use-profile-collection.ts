/**
 * Generic own-content collection for profile tabs — token-based pagination
 * (cursor or page number, both are opaque strings here), pull-to-refresh,
 * lazy first load on `enabled`, and state retention across tab switches.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/core/api/api-error";

export interface CollectionPage<T> {
  items: T[];
  /** Opaque next-page token (API cursor or page index). null → no more. */
  nextToken: string | null;
  /** Optional total count for the filtered set. */
  total?: number;
}

interface CollectionState<T> {
  items: T[];
  token: string | null;
  total: number | null;
  hasMore: boolean;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;
  loaded: boolean;
}

export interface ProfileCollection<T> extends CollectionState<T> {
  refresh(): void;
  loadMore(): void;
  /** Item-level mutations (react/save/delete) applied in place. */
  setItems(updater: (items: T[]) => T[]): void;
}

export function useProfileCollection<T>(
  fetchPage: (token: string | null) => Promise<CollectionPage<T>>,
  keyOf: (item: T) => string,
  enabled: boolean,
): ProfileCollection<T> {
  const [state, setState] = useState<CollectionState<T>>({
    items: [],
    token: null,
    total: null,
    hasMore: true,
    loading: false,
    refreshing: false,
    loadingMore: false,
    error: null,
    loaded: false,
  });
  const busy = useRef(false);

  const request = useCallback(
    (token: string | null, append: boolean, isRefresh = false) => {
      if (busy.current) return;
      busy.current = true;
      setState((s) => ({
        ...s,
        loading: !s.loaded && !append,
        refreshing: isRefresh,
        loadingMore: append,
        error: null,
      }));
      fetchPage(token)
        .then((page) => {
          setState((s) => ({
            ...s,
            items: append
              ? [
                  ...s.items,
                  ...page.items.filter(
                    (i) => !s.items.some((e) => keyOf(e) === keyOf(i)),
                  ),
                ]
              : page.items,
            token: page.nextToken,
            total: page.total ?? s.total,
            hasMore: page.nextToken != null,
            loading: false,
            refreshing: false,
            loadingMore: false,
            loaded: true,
          }));
        })
        .catch((err: unknown) => {
          setState((s) => ({
            ...s,
            loading: false,
            refreshing: false,
            loadingMore: false,
            error: ApiError.isApiError(err)
              ? err.userMessage
              : "Failed to load. Pull to retry.",
          }));
        })
        .finally(() => {
          busy.current = false;
        });
    },
    [fetchPage, keyOf],
  );

  // Lazy first load — only fires once, when the tab is first opened.
  const started = useRef(false);
  useEffect(() => {
    if (enabled && !started.current) {
      started.current = true;
      request(null, false);
    }
  }, [enabled, request]);

  const refresh = useCallback(() => request(null, false, true), [request]);

  const loadMore = useCallback(() => {
    if (state.hasMore && !state.loadingMore && state.token != null) {
      request(state.token, true);
    }
  }, [state.hasMore, state.loadingMore, state.token, request]);

  const setItems = useCallback((updater: (items: T[]) => T[]) => {
    setState((s) => ({ ...s, items: updater(s.items) }));
  }, []);

  return { ...state, refresh, loadMore, setItems };
}
