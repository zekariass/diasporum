/**
 * Conversation list hook — cursor pagination, refresh, and the incoming
 * message-request inbox (accept/decline).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError } from '@/core/api/api-error';
import { useSession } from '@/core/session/session-provider';
import { createMessagingApi } from '../services/messaging-api';
import { useMessagingRealtime } from './use-realtime';
import type { ConversationView, MessageRequestView } from '../types/messaging-types';

interface ConversationsState {
  items: ConversationView[];
  cursor: string | null;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  requests: MessageRequestView[];
  requestsLoading: boolean;
  actingOnRequest: string | null;
}

const initial: ConversationsState = {
  items: [], cursor: null, loading: false, refreshing: false,
  loadingMore: false, error: null, hasMore: true,
  requests: [], requestsLoading: false, actingOnRequest: null,
};

function message(err: unknown, fallback: string): string {
  return ApiError.isApiError(err) ? err.userMessage : fallback;
}

export function useConversations() {
  const { apiClient } = useSession();
  const realtime = useMessagingRealtime();
  const api = useMemo(() => createMessagingApi(apiClient), [apiClient]);
  const [state, setState] = useState<ConversationsState>(initial);
  const requestRef = useRef(false);

  const fetchPage = useCallback(async (cursor: string | null, append: boolean) => {
    if (requestRef.current) return;
    requestRef.current = true;
    setState(s => ({ ...s, loading: !append, loadingMore: append, error: null }));
    try {
      const page = await api.conversations(cursor ?? undefined);
      setState(s => ({
        ...s,
        items: append
          ? [...s.items, ...page.items.filter(i => !s.items.some(e => e.id === i.id))]
          : page.items,
        cursor: page.nextCursor,
        hasMore: page.nextCursor !== null,
        loading: false, loadingMore: false, refreshing: false,
      }));
    } catch (err) {
      setState(s => ({ ...s, loading: false, loadingMore: false,
        refreshing: false, error: message(err, 'Failed to load conversations.') }));
    } finally {
      requestRef.current = false;
    }
  }, [api]);

  const fetchRequests = useCallback(async () => {
    setState(s => ({ ...s, requestsLoading: true }));
    try {
      const requests = await api.incomingRequests();
      setState(s => ({ ...s, requests, requestsLoading: false }));
    } catch {
      setState(s => ({ ...s, requestsLoading: false }));
    }
  }, [api]);

  const refresh = useCallback(() => {
    setState(s => ({ ...s, refreshing: true, cursor: null, hasMore: true }));
    void fetchPage(null, false);
    void fetchRequests();
  }, [fetchPage, fetchRequests]);

  const loadMore = useCallback(() => {
    if (state.hasMore && !state.loadingMore && !state.loading) {
      void fetchPage(state.cursor, true);
    }
  }, [state, fetchPage]);

  /** Accept or decline an incoming request, then refresh both lists. */
  const respondToRequest = useCallback(async (requestId: string, accept: boolean) => {
    setState(s => ({ ...s, actingOnRequest: requestId }));
    try {
      if (accept) {
        await api.acceptRequest(requestId);
      } else {
        await api.declineRequest(requestId);
      }
      setState(s => ({ ...s, actingOnRequest: null }));
      void fetchPage(null, false);
      void fetchRequests();
    } catch (err) {
      setState(s => ({ ...s, actingOnRequest: null,
        error: message(err, 'Could not respond to the request.') }));
    }
  }, [api, fetchPage, fetchRequests]);

  /**
   * Realtime inbox updates — a new message or status transition refreshes
   * the first page + request inbox (debounced so bursts coalesce), and a
   * reconnect triggers a reconcile since events may have been missed.
   */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void fetchPage(null, false);
        void fetchRequests();
      }, 400);
    };
    const offs = [
      realtime.on('MESSAGE_CREATED', schedule),
      realtime.on('CONVERSATION_UPDATED', schedule),
      realtime.onConnection((connected, recovered) => {
        if (connected && recovered) schedule();
      }),
    ];
    return () => {
      if (timer) clearTimeout(timer);
      offs.forEach(off => off());
    };
  }, [realtime, fetchPage, fetchRequests]);

  useEffect(() => { refresh(); }, [refresh]);

  return { ...state, refresh, loadMore, respondToRequest };
}
