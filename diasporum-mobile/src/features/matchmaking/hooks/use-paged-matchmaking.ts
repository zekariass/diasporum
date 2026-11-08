import { useCallback, useEffect, useRef, useState } from "react";
import type { Page } from "../types/matchmaking-types";
import { matchmakingError } from "../services/matchmaking-errors";
import { useMatchmakingRealtime } from "./use-matchmaking-realtime";

interface PagedState<T> {
  items: T[];
  nextCursor: string | null;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;
}

export function usePagedMatchmaking<T>(
  fetcher: (cursor?: string) => Promise<Page<T>>,
  getId: (item: T) => string,
  fallback: string,
) {
  const [state, setState] = useState<PagedState<T>>({
    items: [],
    nextCursor: null,
    loading: true,
    refreshing: false,
    loadingMore: false,
    error: null,
  });
  const busy = useRef(false);
  const reconcile = useRef(false);
  const mutations = useRef(0);
  const mounted = useRef(true);
  const fetcherRef = useRef(fetcher);
  const getIdRef = useRef(getId);
  const fallbackRef = useRef(fallback);

  useEffect(() => {
    fetcherRef.current = fetcher;
    getIdRef.current = getId;
    fallbackRef.current = fallback;
  }, [fallback, fetcher, getId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (cursor: string | undefined, append: boolean) => {
      if (busy.current) {
        if (!append) reconcile.current = true;
        return;
      }
      busy.current = true;
      setState((current) => ({
        ...current,
        loading: !append && current.items.length === 0,
        refreshing: !append && current.items.length > 0,
        loadingMore: append,
        error: null,
      }));
      const requestedFetcher = fetcherRef.current;
      const requestedMutation = mutations.current;
      try {
        const page = await requestedFetcher(cursor);
        if (
          !mounted.current ||
          requestedFetcher !== fetcherRef.current ||
          reconcile.current ||
          requestedMutation !== mutations.current
        )
          return;
        setState((current) => ({
          items: append
            ? [
                ...current.items,
                ...page.items.filter(
                  (item) =>
                    !current.items.some(
                      (existing) =>
                        getIdRef.current(existing) === getIdRef.current(item),
                    ),
                ),
              ]
            : page.items,
          nextCursor: page.nextCursor,
          loading: false,
          refreshing: false,
          loadingMore: false,
          error: null,
        }));
      } catch (error) {
        if (
          !mounted.current ||
          requestedFetcher !== fetcherRef.current ||
          reconcile.current ||
          requestedMutation !== mutations.current
        )
          return;
        setState((current) => ({
          ...current,
          loading: false,
          refreshing: false,
          loadingMore: false,
          error: matchmakingError(error, fallbackRef.current),
        }));
      } finally {
        busy.current = false;
        if (
          mounted.current &&
          (reconcile.current || requestedMutation !== mutations.current)
        ) {
          reconcile.current = false;
          void load(undefined, false);
        }
      }
    },
    [],
  );

  const refresh = useCallback(() => {
    void load(undefined, false);
  }, [load]);
  const loadMore = useCallback(() => {
    if (state.nextCursor && !state.loadingMore && !state.error)
      void load(state.nextCursor, true);
  }, [load, state.loadingMore, state.nextCursor, state.error]);
  const retry = useCallback(() => {
    void load(
      state.items.length ? (state.nextCursor ?? undefined) : undefined,
      state.items.length > 0 && state.nextCursor !== null,
    );
  }, [load, state.items.length, state.nextCursor]);
  const remove = useCallback((id: string) => {
    mutations.current++;
    setState((current) => ({
      ...current,
      items: current.items.filter((item) => getIdRef.current(item) !== id),
    }));
  }, []);

  useMatchmakingRealtime(refresh);
  useEffect(() => {
    setState({
      items: [],
      nextCursor: null,
      loading: true,
      refreshing: false,
      loadingMore: false,
      error: null,
    });
    refresh();
  }, [fetcher, refresh]);

  return { ...state, refresh, loadMore, retry, remove };
}
