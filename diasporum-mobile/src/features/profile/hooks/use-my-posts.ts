/**
 * useMyPosts — own posts via GET /api/v1/feed/mine with the same item-level
 * interactions as the home feed (react / save / delete / poll updates).
 * `filters.postType` powers the Polls tab; `filters.hasMedia` the Media tab.
 */

import { useCallback, useEffect, useMemo } from "react";
import { subscribeFeedUpdates } from "@/features/feed/utils/feed-updates";

import { useSession } from "@/core/session/session-provider";
import { createFeedApi } from "@/features/feed/services/feed-api";
import type { FeedItem, ReactionKey } from "@/features/feed/types/feed-types";
import { useProfileCollection } from "./use-profile-collection";

export interface MyPostsFilters {
  postType?: string;
  hasMedia?: boolean;
}

export function useMyPosts(filters: MyPostsFilters, enabled: boolean) {
  const { apiClient } = useSession();
  const feedApi = useMemo(() => createFeedApi(apiClient), [apiClient]);
  const postType = filters.postType;
  const hasMedia = filters.hasMedia;

  const fetchPage = useCallback(
    (token: string | null) =>
      feedApi.mine({ postType, hasMedia }, token ?? undefined).then((p) => ({
        items: p.items,
        nextToken: p.nextCursor,
        total: p.total,
      })),
    [feedApi, postType, hasMedia],
  );

  const keyOf = useCallback((i: FeedItem) => i.sourceId, []);
  const col = useProfileCollection<FeedItem>(fetchPage, keyOf, enabled);
  const { setItems } = col;
  useEffect(
    () =>
      subscribeFeedUpdates(apiClient, (id, update) => {
        setItems((items) =>
          items.map((i) => (i.sourceId === id ? update(i) : i)),
        );
      }),
    [apiClient, setItems],
  );

  const updateItem = useCallback(
    (postId: string, updates: Partial<FeedItem>) => {
      setItems((items) =>
        items.map((i) => (i.sourceId === postId ? { ...i, ...updates } : i)),
      );
    },
    [setItems],
  );

  const react = useCallback(
    async (postId: string, reaction: ReactionKey) => {
      const item = col.items.find((i) => i.sourceId === postId);
      const wasReacted = !!item?.viewerReaction;
      updateItem(postId, {
        viewerReaction: reaction,
        reactionCount: (item?.reactionCount ?? 0) + (wasReacted ? 0 : 1),
      });
      try {
        if (wasReacted && item?.viewerReaction === reaction) {
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
    [col.items, feedApi, updateItem],
  );

  const toggleSave = useCallback(
    async (postId: string) => {
      const item = col.items.find((i) => i.sourceId === postId);
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
    [col.items, feedApi, updateItem],
  );

  const deletePost = useCallback(
    async (postId: string) => {
      setItems((items) => items.filter((i) => i.sourceId !== postId));
      try {
        await feedApi.deletePost(postId);
      } catch {
        /* removed optimistically — re-fetched on next refresh */
      }
    },
    [feedApi, setItems],
  );

  return { ...col, react, toggleSave, deletePost, updatePost: updateItem };
}

export type MyPosts = ReturnType<typeof useMyPosts>;
