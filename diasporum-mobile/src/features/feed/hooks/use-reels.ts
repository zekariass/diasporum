/**
 * Reels feed hook — cursor pagination over REEL posts.
 * Community mode: GET /feed/reels/community.
 * Following mode: filters followingFeed client-side (no dedicated endpoint).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createFeedApi } from '../services/feed-api';
import { useSession } from '@/core/session/session-provider';
import type { FeedItem, ReelsMode } from '../types/feed-types';
import { ApiError } from '@/core/api/api-error';

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

const initial: ReelsState = { items: [], cursor: null, loading: false, refreshing: false, loadingMore: false, error: null, hasMore: true, mode: 'community' };

export function useReels() {
  const { apiClient, session } = useSession();
  const feedApi = React.useMemo(() => createFeedApi(apiClient), [apiClient]);
  const [state, setState] = useState<ReelsState>(initial);
  const requestRef = useRef(false);

  const fetch = useCallback(async (mode: ReelsMode, cursor: string | null, append: boolean) => {
    if (requestRef.current) return;
    requestRef.current = true;
    setState(s => ({ ...s, loading: !append, loadingMore: append, error: null }));
    try {
      const communityId = session?.activeCommunityId ?? '';
      const page = mode === 'community'
        ? await apiClient.get<import('../types/feed-types').FeedPage>(
            `/api/v1/feed/reels/community?communityId=${communityId}&size=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
            { authenticated: true })
        : await feedApi.followingFeed(cursor ?? undefined).then(p => ({
            items: p.items.filter(i => i.contentType === 'REEL'),
            nextCursor: p.nextCursor,
          }));
      setState(s => ({
        ...s,
        items: append
          ? [...s.items, ...page.items.filter(i => !s.items.some(e => e.sourceId === i.sourceId))]
          : page.items,
        cursor: page.nextCursor,
        hasMore: page.nextCursor !== null,
        loading: false, loadingMore: false, refreshing: false,
      }));
    } catch (err) {
      setState(s => ({ ...s, loading: false, loadingMore: false, refreshing: false,
        error: ApiError.isApiError(err) ? err.userMessage : 'Failed to load reels.' }));
    } finally { requestRef.current = false; }
  }, [feedApi, apiClient, session?.activeCommunityId]);

  const loadMore = useCallback(() => {
    if (state.hasMore && !state.loadingMore && !state.loading) void fetch(state.mode, state.cursor, true);
  }, [state, fetch]);

  const refresh = useCallback(() => {
    setState(s => ({ ...s, refreshing: true, cursor: null, hasMore: true }));
    void fetch(state.mode, null, false);
  }, [state.mode, fetch]);

  const switchMode = useCallback((mode: ReelsMode) => {
    if (mode === state.mode) return;
    setState(s => ({ ...s, mode, items: [], cursor: null, hasMore: true }));
    void fetch(mode, null, false);
  }, [state.mode, fetch]);

  const prevCommunityId = useRef(session?.activeCommunityId);
  useEffect(() => {
    if (session?.activeCommunityId !== prevCommunityId.current) {
      prevCommunityId.current = session?.activeCommunityId;
      setState(initial);
      void fetch('community', null, false);
    }
  }, [session?.activeCommunityId, fetch]);

  useEffect(() => { void fetch('community', null, false); }, [fetch]);

  return { ...state, refresh, loadMore, switchMode };
}
