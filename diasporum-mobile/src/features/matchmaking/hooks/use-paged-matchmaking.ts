import { useCallback, useEffect, useRef, useState } from 'react';
import type { Page } from '../types/matchmaking-types';
import { matchmakingError } from '../services/matchmaking-errors';
import { useMatchmakingRealtime } from './use-matchmaking-realtime';

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
    items: [], nextCursor: null, loading: true, refreshing: false,
    loadingMore: false, error: null,
  });
  const busy = useRef(false);
  const reconcile = useRef(false);
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
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async (cursor: string | undefined, append: boolean) => {
    if (busy.current) {
      if (!append) reconcile.current = true;
      return;
    }
    busy.current = true;
    setState(current => ({
      ...current,
      loading: !append && current.items.length === 0,
      refreshing: !append && current.items.length > 0,
      loadingMore: append,
      error: null,
    }));
    try {
      const page = await fetcherRef.current(cursor);
      if (!mounted.current) return;
      setState(current => ({
        items: append
          ? [...current.items, ...page.items.filter(item =>
              !current.items.some(existing => getIdRef.current(existing) === getIdRef.current(item)))]
          : page.items,
        nextCursor: page.nextCursor,
        loading: false, refreshing: false, loadingMore: false, error: null,
      }));
    } catch (error) {
      if (!mounted.current) return;
      setState(current => ({
        ...current, loading: false, refreshing: false, loadingMore: false,
        error: matchmakingError(error, fallbackRef.current),
      }));
    } finally {
      busy.current = false;
      if (reconcile.current) {
        reconcile.current = false;
        void load(undefined, false);
      }
    }
  }, []);

  const refresh = useCallback(() => { void load(undefined, false); }, [load]);
  const loadMore = useCallback(() => {
    if (state.nextCursor && !state.loadingMore) void load(state.nextCursor, true);
  }, [load, state.loadingMore, state.nextCursor]);
  const remove = useCallback((id: string) => {
    setState(current => ({
      ...current,
      items: current.items.filter(item => getIdRef.current(item) !== id),
    }));
  }, []);

  useMatchmakingRealtime(refresh);
  useEffect(() => { refresh(); }, [fetcher, refresh]);

  return { ...state, refresh, loadMore, remove };
}
