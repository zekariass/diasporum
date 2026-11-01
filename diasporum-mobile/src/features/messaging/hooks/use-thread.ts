/**
 * Conversation thread hook — message history (newest first, cursor pages of
 * older messages), optimistic send with delivery/error state and idempotent
 * retry via clientMessageId, and read-cursor advancement.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';

import { ApiError } from '@/core/api/api-error';
import { useSession } from '@/core/session/session-provider';
import { createMessagingApi } from '../services/messaging-api';
import type {
  ConversationView,
  MessageView,
} from '../types/messaging-types';

/** A locally-composed message not yet confirmed by the server. */
export interface PendingMessage {
  localId: string;
  body: string;
  senderId: string;
  createdAt: string;
  status: 'sending' | 'failed';
}

export type ThreadItem =
  | { kind: 'server'; message: MessageView }
  | { kind: 'pending'; pending: PendingMessage };

interface ThreadState {
  conversation: ConversationView | null;
  items: MessageView[];
  pending: PendingMessage[];
  nextBeforeSeq: number | null;
  loading: boolean;
  loadingOlder: boolean;
  sending: boolean;
  error: string | null;
}

const initial: ThreadState = {
  conversation: null, items: [], pending: [], nextBeforeSeq: null,
  loading: false, loadingOlder: false, sending: false, error: null,
};

function message(err: unknown, fallback: string): string {
  return ApiError.isApiError(err) ? err.userMessage : fallback;
}

export function useThread(conversationId: string, viewerUserId: string) {
  const { apiClient } = useSession();
  const api = useMemo(() => createMessagingApi(apiClient), [apiClient]);
  const [state, setState] = useState<ThreadState>(initial);
  const requestRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const markRead = useCallback(() => {
    // Silent — read cursors must never block the UI.
    api.markRead(conversationId).catch(() => {});
  }, [api, conversationId]);

  const load = useCallback(async () => {
    if (requestRef.current) return;
    requestRef.current = true;
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const [detail, page] = await Promise.all([
        api.conversationDetail(conversationId),
        api.messages(conversationId),
      ]);
      if (!mountedRef.current) return;
      setState(s => ({
        ...s,
        conversation: detail.conversation,
        items: page.items,
        nextBeforeSeq: page.nextCursor ? Number(page.nextCursor) : null,
        loading: false,
      }));
      markRead();
    } catch (err) {
      if (!mountedRef.current) return;
      setState(s => ({ ...s, loading: false,
        error: message(err, 'Failed to load the conversation.') }));
    } finally {
      requestRef.current = false;
    }
  }, [api, conversationId, markRead]);

  /** Fetch the next page of older messages (scroll-to-top pagination). */
  const loadOlder = useCallback(async () => {
    if (state.nextBeforeSeq == null || state.loadingOlder || state.loading) return;
    setState(s => ({ ...s, loadingOlder: true }));
    try {
      const page = await api.messages(conversationId, state.nextBeforeSeq);
      if (!mountedRef.current) return;
      setState(s => ({
        ...s,
        items: [...s.items, ...page.items.filter(m => !s.items.some(e => e.id === m.id))],
        nextBeforeSeq: page.nextCursor ? Number(page.nextCursor) : null,
        loadingOlder: false,
      }));
    } catch (err) {
      if (!mountedRef.current) return;
      setState(s => ({ ...s, loadingOlder: false,
        error: message(err, 'Failed to load older messages.') }));
    }
  }, [api, conversationId, state]);

  const postMessage = useCallback(async (local: PendingMessage) => {
    try {
      const sent = await api.sendMessage(conversationId, local.body, local.localId);
      if (!mountedRef.current) return;
      setState(s => ({
        ...s,
        sending: false,
        // Server returns newest-first history — prepend the confirmed message.
        items: s.items.some(m => m.id === sent.id)
          ? s.items
          : [sent, ...s.items],
        pending: s.pending.filter(p => p.localId !== local.localId),
        conversation: s.conversation
          ? { ...s.conversation, lastMessageSeq: Math.max(s.conversation.lastMessageSeq, sent.sequenceNo), lastMessagePreview: sent.body }
          : s.conversation,
      }));
      markRead();
    } catch (err) {
      if (!mountedRef.current) return;
      setState(s => ({
        ...s,
        sending: false,
        pending: s.pending.map(p => p.localId === local.localId
          ? { ...p, status: 'failed' as const } : p),
        error: message(err, 'Message could not be sent.'),
      }));
    }
  }, [api, conversationId, markRead]);

  /** Optimistic send — appends a pending bubble, confirmed or marked failed. */
  const send = useCallback(async (body: string) => {
    const text = body.trim();
    if (!text || state.sending) return;
    const local: PendingMessage = {
      localId: Crypto.randomUUID(),
      body: text,
      senderId: viewerUserId,
      createdAt: new Date().toISOString(),
      status: 'sending',
    };
    setState(s => ({ ...s, sending: true, pending: [...s.pending, local] }));
    await postMessage(local);
  }, [postMessage, state.sending, viewerUserId]);

  /** Retry a failed pending message (same clientMessageId → idempotent). */
  const retry = useCallback(async (localId: string) => {
    const local = state.pending.find(p => p.localId === localId);
    if (!local || local.status !== 'failed' || state.sending) return;
    setState(s => ({
      ...s,
      sending: true,
      pending: s.pending.map(p => p.localId === localId
        ? { ...p, status: 'sending' as const } : p),
    }));
    await postMessage(local);
  }, [postMessage, state.pending, state.sending]);

  /** Newest-first list for an inverted FlatList: pending first, then server items. */
  const items: ThreadItem[] = useMemo(() => [
    ...[...state.pending].reverse().map(p => ({ kind: 'pending' as const, pending: p })),
    ...state.items.map(m => ({ kind: 'server' as const, message: m })),
  ], [state.items, state.pending]);

  useEffect(() => { void load(); }, [load]);

  return {
    conversation: state.conversation,
    items,
    loading: state.loading,
    loadingOlder: state.loadingOlder,
    sending: state.sending,
    hasOlder: state.nextBeforeSeq != null,
    error: state.error,
    reload: load,
    loadOlder,
    send,
    retry,
  };
}
