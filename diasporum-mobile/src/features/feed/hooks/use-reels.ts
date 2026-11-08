/**
 * Reels feed hook — cursor pagination over REEL posts.
 * Community mode: GET /feed/reels/community (server-filtered).
 * Following mode: filters followingFeed client-side (no dedicated endpoint).
 * Only items with contentType='REEL' and at least one video attachment are
 * kept — pages that filter down to empty are skipped by walking the cursor.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createFeedApi } from "../services/feed-api";
import { useSession } from "@/core/session/session-provider";
import type { FeedItem, FeedPage, ReelsMode } from "../types/feed-types";
import { ApiError } from "@/core/api/api-error";
import { subscribeFeedUpdates } from "../utils/feed-updates";

interface ReelsState {
  items: FeedItem[];
  cursor: string | null;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  mode: ReelsMode;
}

const initial: ReelsState = {
  items: [],
  cursor: null,
  loading: false,
  refreshing: false,
  loadingMore: false,
  error: null,
  hasMore: true,
  mode: "community",
};

/** A displayable reel: REEL post with its single video attachment present. */
const isReel = (i: FeedItem) =>
  i.contentType === "REEL" &&
  i.mediaIds.length === 1 &&
  i.media.length === 1 &&
  i.media[0].id === i.mediaIds[0] &&
  i.media[0].purpose === "FEED_VIDEO";

/** Pages that filter to zero reels don't stall the pager — walk ≤5 hops. */
const MAX_CURSOR_HOPS = 5;

export function useReels() {
  const { apiClient, session } = useSession();
  const feedApi = React.useMemo(() => createFeedApi(apiClient), [apiClient]);
  const [state, setState] = useState<ReelsState>(initial);
  const requestRef = useRef(0);
  const busy = useRef(false);
  const modeRef = useRef<ReelsMode>("community");
  const knownIds = useRef(new Set<string>());
  const communityId = session?.activeCommunityId;
  const [generation, setGeneration] = useState(0);
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

  const fetch = useCallback(
    async (mode: ReelsMode, cursor: string | null, append: boolean) => {
      if (append && busy.current) return;
      const request = ++requestRef.current;
      busy.current = true;
      if (!append) {
        knownIds.current.clear();
        setGeneration((g) => g + 1);
      }
      setState((s) => ({
        ...s,
        mode,
        items: append ? s.items : [],
        loading: !append,
        loadingMore: append,
        error: null,
      }));
      try {
        if (mode === "community" && !communityId)
          throw new Error("No active community.");
        let nextCursor = cursor;
        let collected: FeedItem[] = [];
        const visited = new Set<string | null>([cursor]);
        for (let hops = 0; hops < MAX_CURSOR_HOPS; hops++) {
          const page: FeedPage =
            mode === "community"
              ? await apiClient.get<FeedPage>(
                  `/api/v1/feed/reels/community?communityId=${communityId}&size=20${nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : ""}`,
                  { authenticated: true },
                )
              : await feedApi.followingFeed(nextCursor ?? undefined);
          if (request !== requestRef.current) return;
          const unique = new Map(
            page.items.filter(isReel).map((i) => [i.sourceId, i]),
          );
          collected = [...unique.values()].filter(
            (i) => !knownIds.current.has(i.sourceId),
          );
          nextCursor = page.nextCursor;
          if (nextCursor !== null && visited.has(nextCursor)) {
            throw new Error("Reels pagination did not advance. Please retry.");
          }
          visited.add(nextCursor);
          if (collected.length > 0 || nextCursor === null) break;
        }
        collected.forEach((i) => knownIds.current.add(i.sourceId));
        setState((s) => ({
          ...s,
          items: append
            ? [
                ...s.items,
                ...collected.filter(
                  (i) => !s.items.some((e) => e.sourceId === i.sourceId),
                ),
              ]
            : collected,
          cursor: nextCursor,
          hasMore: nextCursor !== null,
          loading: false,
          loadingMore: false,
          refreshing: false,
        }));
      } catch (err) {
        if (request !== requestRef.current) return;
        setState((s) => ({
          ...s,
          loading: false,
          loadingMore: false,
          refreshing: false,
          error: ApiError.isApiError(err)
            ? err.userMessage
            : "Failed to load reels. Please retry.",
        }));
      } finally {
        if (request === requestRef.current) busy.current = false;
      }
    },
    [feedApi, apiClient, communityId],
  );

  const loadMore = useCallback(() => {
    if (state.hasMore && !state.loadingMore && !state.loading)
      void fetch(state.mode, state.cursor, true);
  }, [state, fetch]);

  const refresh = useCallback(() => {
    setState((s) => ({ ...s, refreshing: true, cursor: null, hasMore: true }));
    void fetch(modeRef.current, null, false);
  }, [fetch]);

  const switchMode = useCallback(
    (mode: ReelsMode) => {
      if (mode === modeRef.current) return;
      modeRef.current = mode;
      void fetch(mode, null, false);
    },
    [fetch],
  );

  useEffect(() => {
    void fetch(modeRef.current, null, false);
    return () => {
      // Invalidate every pending request, including a refresh started after this effect.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++requestRef.current;
      busy.current = false;
    };
  }, [fetch]);

  const updateItem = useCallback((id: string, patch: Partial<FeedItem>) => {
    setState((s) => ({
      ...s,
      items: s.items.map((i) => (i.sourceId === id ? { ...i, ...patch } : i)),
    }));
  }, []);

  return { ...state, generation, refresh, loadMore, switchMode, updateItem };
}
