/**
 * Feed state hook — cursor pagination, mode + category filtering,
 * community switching. Single source of truth for the community feed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createFeedApi } from "../services/feed-api";
import { useSession } from "@/core/session/session-provider";
import type { FeedItem, FeedMode, CategoryView } from "../types/feed-types";
import { ApiError } from "@/core/api/api-error";
import { subscribeFeedUpdates } from "../utils/feed-updates";

interface FeedState {
  items: FeedItem[];
  cursor: string | null;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  mode: FeedMode;
  categoryId: string | null;
  categories: CategoryView[];
}

const initial: FeedState = {
  items: [],
  cursor: null,
  loading: false,
  refreshing: false,
  loadingMore: false,
  error: null,
  hasMore: true,
  mode: "FOR_YOU",
  categoryId: null,
  categories: [],
};

export function useFeed() {
  const { apiClient, session } = useSession();
  const feedApi = useMemo(() => createFeedApi(apiClient), [apiClient]);
  const [state, setState] = useState<FeedState>(initial);
  useEffect(
    () =>
      subscribeFeedUpdates(apiClient, (id, update) => {
        setState((s) => ({
          ...s,
          items: s.items.map((i) => (i.sourceId === id ? update(i) : i)),
        }));
      }),
    [apiClient],
  );
  const requestRef = useRef(false);
  const communityId = session?.activeCommunityId ?? "";

  const fetch = useCallback(
    async (
      mode: FeedMode,
      categoryId: string | null,
      cursor: string | null,
      append: boolean,
    ) => {
      if (requestRef.current) return;
      requestRef.current = true;
      setState((s) => ({
        ...s,
        loading: !append,
        loadingMore: append,
        refreshing: false,
        error: null,
      }));
      try {
        const page = await feedApi.communityFeed(
          communityId,
          mode,
          categoryId ?? undefined,
          cursor ?? undefined,
        );
        setState((s) => ({
          ...s,
          items: append
            ? [
                ...s.items,
                ...page.items.filter(
                  (i) =>
                    i.contentType !== "REEL" &&
                    !s.items.some((e) => e.sourceId === i.sourceId),
                ),
              ]
            : page.items.filter((i) => i.contentType !== "REEL"),
          cursor: page.nextCursor,
          hasMore: page.nextCursor !== null,
          loading: false,
          loadingMore: false,
        }));
      } catch (err) {
        setState((s) => ({
          ...s,
          loading: false,
          loadingMore: false,
          refreshing: false,
          error: ApiError.isApiError(err)
            ? err.userMessage
            : "Failed to load feed.",
        }));
      } finally {
        requestRef.current = false;
      }
    },
    [communityId, feedApi],
  );

  const loadMore = useCallback(() => {
    if (state.hasMore && !state.loadingMore && !state.loading)
      void fetch(state.mode, state.categoryId, state.cursor, true);
  }, [state, fetch]);

  const refresh = useCallback(() => {
    setState((s) => ({ ...s, refreshing: true, cursor: null, hasMore: true }));
    void fetch(state.mode, state.categoryId, null, false);
  }, [state.mode, state.categoryId, fetch]);

  const setMode = useCallback(
    (mode: FeedMode) => {
      if (mode === state.mode) return;
      setState((s) => ({ ...s, mode, items: [], cursor: null, hasMore: true }));
      void fetch(mode, state.categoryId, null, false);
    },
    [state.mode, state.categoryId, fetch],
  );

  const setCategory = useCallback(
    (categoryId: string | null) => {
      setState((s) => ({
        ...s,
        categoryId,
        items: [],
        cursor: null,
        hasMore: true,
      }));
      void fetch(state.mode, categoryId, null, false);
    },
    [state.mode, fetch],
  );

  // Load FEED categories for the active community's destination country.
  const [destCountryId, setDestCountryId] = useState<string | null>(null);
  useEffect(() => {
    if (!communityId) return;
    let cancelled = false;
    void feedApi
      .communityDetail(communityId)
      .then((c) => {
        if (!cancelled) setDestCountryId(c.destinationCountryId);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [communityId, feedApi]);

  useEffect(() => {
    if (!destCountryId) return;
    let cancelled = false;
    void feedApi
      .feedCategories(destCountryId)
      .then((res) => {
        if (!cancelled) setState((s) => ({ ...s, categories: res.items }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [destCountryId, feedApi]);

  // Reload when community changes
  const prevCommunityId = useRef(communityId);
  useEffect(() => {
    if (communityId !== prevCommunityId.current) {
      prevCommunityId.current = communityId;
      setState({ ...initial });
      setDestCountryId(null);
      void fetch("FOR_YOU", null, null, false);
    }
  }, [communityId, fetch]);

  // Initial load
  useEffect(() => {
    void fetch("FOR_YOU", null, null, false);
  }, [fetch]);

  // Mutations that update items in-place
  const updateItem = useCallback(
    (postId: string, updates: Partial<FeedItem>) => {
      setState((s) => ({
        ...s,
        items: s.items.map((i) =>
          i.sourceId === postId ? { ...i, ...updates } : i,
        ),
      }));
    },
    [],
  );

  const react = useCallback(
    async (
      postId: string,
      reaction: "LIKE" | "LOVE" | "HELPFUL" | "INSIGHTFUL" | "THANKS",
    ) => {
      const item = state.items.find((i) => i.sourceId === postId);
      const togglingOff =
        !!item?.viewerReaction && item.viewerReaction === reaction;
      updateItem(
        postId,
        togglingOff
          ? {
              viewerReaction: null,
              reactionCount: Math.max(0, (item?.reactionCount ?? 1) - 1),
            }
          : {
              viewerReaction: reaction,
              reactionCount:
                (item?.reactionCount ?? 0) + (item?.viewerReaction ? 0 : 1),
            },
      );
      try {
        if (togglingOff) {
          await feedApi.unreact(postId);
        } else {
          await feedApi.react(postId, reaction);
        }
      } catch {
        updateItem(postId, {
          viewerReaction: item?.viewerReaction ?? null,
          reactionCount: item?.reactionCount ?? 0,
        });
      }
    },
    [state.items, feedApi, updateItem],
  );

  const toggleSave = useCallback(
    async (postId: string) => {
      const item = state.items.find((i) => i.sourceId === postId);
      if (!item) return;
      const willSave = !item.saved;
      updateItem(postId, { saved: willSave });
      try {
        if (willSave) await feedApi.save(postId);
        else await feedApi.unsave(postId);
      } catch {
        updateItem(postId, { saved: item.saved });
      }
    },
    [state.items, feedApi, updateItem],
  );

  const deletePost = useCallback(
    async (postId: string) => {
      setState((s) => ({
        ...s,
        items: s.items.filter((i) => i.sourceId !== postId),
      }));
      try {
        await feedApi.deletePost(postId);
      } catch {
        /* post already removed optimistically — silently re-fetch on next refresh */
      }
    },
    [feedApi],
  );

  const updatePost = useCallback(
    (postId: string, updates: Partial<FeedItem>) => {
      updateItem(postId, updates);
    },
    [updateItem],
  );

  return {
    ...state,
    refresh,
    loadMore,
    setMode,
    setCategory,
    react,
    toggleSave,
    deletePost,
    updatePost,
  };
}
