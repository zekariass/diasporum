import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ApiError } from "@/core/api/api-error";
import type { PropertyPage } from "../types/property-types";

const EMPTY: PropertyPage = { items: [], nextCursor: null };

/** Latest-query-wins pagination; refresh supersedes an in-flight next page. */
export function usePropertyPage(
  fetchPage: (cursor?: string) => Promise<PropertyPage>,
) {
  const [state, setState] = useState({
    page: EMPTY,
    source: fetchPage,
    loading: true,
    refreshing: false,
    loadingMore: false,
    error: null as string | null,
  });
  const generation = useRef(0);
  const inFlight = useRef(false);
  const load = useCallback(
    async (cursor?: string, refresh = false) => {
      if (cursor && inFlight.current) return;
      const request = ++generation.current;
      inFlight.current = true;
      setState((previous) => ({
        ...previous,
        source: fetchPage,
        page: previous.source === fetchPage ? previous.page : EMPTY,
        loading: !cursor && !refresh,
        refreshing: refresh,
        loadingMore: Boolean(cursor),
        error: null,
      }));
      try {
        const page = await fetchPage(cursor);
        if (request !== generation.current) return;
        setState((previous) => {
          const seen = new Set(
            previous.page.items.map((item) => item.property.id),
          );
          return {
            ...previous,
            page: {
              ...page,
              items: cursor
                ? [
                    ...previous.page.items,
                    ...page.items.filter((item) => !seen.has(item.property.id)),
                  ]
                : page.items,
            },
          };
        });
      } catch (cause) {
        if (request !== generation.current) return;
        setState((previous) => ({
          ...previous,
          page: cursor ? previous.page : EMPTY,
          error: ApiError.isApiError(cause)
            ? cause.userMessage
            : "Failed to load properties.",
        }));
      } finally {
        if (request === generation.current) {
          inFlight.current = false;
          setState((previous) => ({
            ...previous,
            loading: false,
            refreshing: false,
            loadingMore: false,
          }));
        }
      }
    },
    [fetchPage],
  );
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        generation.current++;
        inFlight.current = false;
      };
    }, [load]),
  );
  const current = state.source === fetchPage;
  const page = current ? state.page : EMPTY;
  return {
    ...state,
    page,
    loading: !current || state.loading,
    refresh: () => void load(undefined, true),
    retry: () => void load(),
    more: () => {
      if (page.nextCursor && !state.error) void load(page.nextCursor);
    },
  };
}
