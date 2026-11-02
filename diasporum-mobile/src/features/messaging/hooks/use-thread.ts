/**
 * Conversation thread hook — M1-M4.
 * M4 adds: attachment sending, typing indicators, presence, read-receipt state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { ApiError } from '@/core/api/api-error';
import { useSession } from '@/core/session/session-provider';
import { createMessagingApi } from '../services/messaging-api';
import { useMessagingRealtime } from './use-realtime';
import type { ConversationView, MessageView } from '../types/messaging-types';

export interface PendingMessage {
  localId: string;
  body: string | null;
  attachmentIds: string[];
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
  /** userId → last-read seq from MESSAGE_READ events. */
  partnerReadSeqs: Record<string, number>;
  /** userId → typing state with expiry timer. */
  typingUsers: Record<string, boolean>;
  /** userId → online state. */
  presence: Record<string, boolean>;
}

const initial: ThreadState = {
  conversation: null, items: [], pending: [], nextBeforeSeq: null,
  loading: false, loadingOlder: false, sending: false, error: null,
  partnerReadSeqs: {}, typingUsers: {}, presence: {},
};

const TYPING_EXPIRY_MS = 8000;

function errMsg(err: unknown, fallback: string): string {
  return ApiError.isApiError(err) ? err.userMessage : fallback;
}

export function useThread(conversationId: string, viewerUserId: string) {
  const { apiClient } = useSession();
  const realtime = useMessagingRealtime();
  const api = useMemo(() => createMessagingApi(apiClient), [apiClient]);
  const [state, setState] = useState<ThreadState>(initial);
  const mountedRef = useRef(true);
  const loadingRef = useRef(false);
  // Typing expiry timers per userId
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const markRead = useCallback(() => {
    api.markRead(conversationId).catch(() => {});
  }, [api, conversationId]);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const [detail, page] = await Promise.all([
        api.conversationDetail(conversationId),
        api.messages(conversationId),
      ]);
      // Load initial presence
      let presence: Record<string, boolean> = {};
      try { presence = await api.conversationPresence(conversationId); } catch { /* optional */ }
      if (!mountedRef.current) return;
      setState(s => ({
        ...s, conversation: detail.conversation,
        items: page.items,
        nextBeforeSeq: page.nextCursor ? Number(page.nextCursor) : null,
        loading: false, presence,
      }));
      markRead();
    } catch (err) {
      if (!mountedRef.current) return;
      setState(s => ({ ...s, loading: false, error: errMsg(err, 'Failed to load conversation.') }));
    } finally { loadingRef.current = false; }
  }, [api, conversationId, markRead]);

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
      setState(s => ({ ...s, loadingOlder: false, error: errMsg(err, 'Failed to load older messages.') }));
    }
  }, [api, conversationId, state.nextBeforeSeq, state.loadingOlder, state.loading]);

  const mergeLatest = useCallback(async () => {
    try {
      const page = await api.messages(conversationId);
      if (!mountedRef.current) return;
      setState(s => {
        const byId = new Map(s.items.map(m => [m.id, m]));
        page.items.forEach(m => byId.set(m.id, m));
        return { ...s, items: [...byId.values()].sort((a, b) => b.sequenceNo - a.sequenceNo) };
      });
      markRead();
    } catch { /* next reconcile will catch up */ }
  }, [api, conversationId, markRead]);

  const refreshDetail = useCallback(async () => {
    try {
      const detail = await api.conversationDetail(conversationId);
      if (!mountedRef.current) return;
      setState(s => ({ ...s, conversation: detail.conversation }));
    } catch { /* non-fatal */ }
  }, [api, conversationId]);

  const postMessage = useCallback(async (local: PendingMessage) => {
    try {
      const sent = await api.sendMessage(
        conversationId, local.body, local.localId, undefined, local.attachmentIds
      );
      if (!mountedRef.current) return;
      setState(s => ({
        ...s, sending: false,
        items: s.items.some(m => m.id === sent.id) ? s.items : [sent, ...s.items],
        pending: s.pending.filter(p => p.localId !== local.localId),
        conversation: s.conversation
          ? { ...s.conversation, lastMessageSeq: Math.max(s.conversation.lastMessageSeq, sent.sequenceNo), lastMessagePreview: sent.body ?? '[Media]' }
          : s.conversation,
      }));
      markRead();
    } catch (err) {
      if (!mountedRef.current) return;
      setState(s => ({
        ...s, sending: false,
        pending: s.pending.map(p => p.localId === local.localId ? { ...p, status: 'failed' as const } : p),
        error: errMsg(err, 'Message could not be sent.'),
      }));
    }
  }, [api, conversationId, markRead]);

  /** Send text, optional attachments, or both. Stops typing on send. */
  const send = useCallback(async (body: string, attachmentIds: string[] = []) => {
    const text = body.trim();
    if (!text && attachmentIds.length === 0) return;
    if (state.sending) return;
    // Stop typing indicator on send
    api.sendTyping(conversationId, false).catch(() => {});
    const local: PendingMessage = {
      localId: Crypto.randomUUID(),
      body: text || null,
      attachmentIds,
      senderId: viewerUserId,
      createdAt: new Date().toISOString(),
      status: 'sending',
    };
    setState(s => ({ ...s, sending: true, pending: [...s.pending, local] }));
    await postMessage(local);
  }, [postMessage, state.sending, viewerUserId, api, conversationId]);

  const retry = useCallback(async (localId: string) => {
    const local = state.pending.find(p => p.localId === localId);
    if (!local || local.status !== 'failed' || state.sending) return;
    setState(s => ({
      ...s, sending: true,
      pending: s.pending.map(p => p.localId === localId ? { ...p, status: 'sending' as const } : p),
    }));
    await postMessage(local);
  }, [postMessage, state.pending, state.sending]);

  /** Publish typing started/stopped; debounced — callers call on keystroke. */
  const notifyTyping = useCallback((typing: boolean) => {
    api.sendTyping(conversationId, typing).catch(() => {});
  }, [api, conversationId]);

  // ── Realtime event handlers ───────────────────────────────────────────────

  useEffect(() => {
    const offs = [
      realtime.on('MESSAGE_CREATED', e => {
        if (e.conversationId === conversationId) void mergeLatest();
      }),
      realtime.on('MESSAGE_READ', e => {
        if (e.conversationId === conversationId) {
          if (e.readerId && e.lastReadSeq !== undefined) {
            setState(s => ({
              ...s,
              partnerReadSeqs: { ...s.partnerReadSeqs, [e.readerId!]: e.lastReadSeq! },
            }));
          }
          void refreshDetail();
        }
      }),
      realtime.on('CONVERSATION_UPDATED', e => {
        if (e.conversationId === conversationId) void refreshDetail();
      }),
      realtime.on('TYPING_STARTED', e => {
        if (e.conversationId !== conversationId || e.userId === viewerUserId) return;
        const uid = e.userId!;
        setState(s => ({ ...s, typingUsers: { ...s.typingUsers, [uid]: true } }));
        clearTimeout(typingTimers.current[uid]);
        typingTimers.current[uid] = setTimeout(() => {
          setState(s => ({ ...s, typingUsers: { ...s.typingUsers, [uid]: false } }));
        }, TYPING_EXPIRY_MS);
      }),
      realtime.on('TYPING_STOPPED', e => {
        if (e.conversationId !== conversationId || e.userId === viewerUserId) return;
        const uid = e.userId!;
        clearTimeout(typingTimers.current[uid]);
        setState(s => ({ ...s, typingUsers: { ...s.typingUsers, [uid]: false } }));
      }),
      realtime.on('PRESENCE_ONLINE', e => {
        if (e.userId) setState(s => ({ ...s, presence: { ...s.presence, [e.userId!]: true } }));
      }),
      realtime.on('PRESENCE_OFFLINE', e => {
        if (e.userId) setState(s => ({ ...s, presence: { ...s.presence, [e.userId!]: false } }));
      }),
      realtime.onConnection((connected, recovered) => {
        if (connected && recovered) void load();
      }),
    ];
    return () => {
      offs.forEach(off => off());
      const timers = typingTimers.current;
      Object.values(timers).forEach(clearTimeout);
    };
  }, [realtime, conversationId, viewerUserId, mergeLatest, refreshDetail, load]);

  useEffect(() => { void load(); }, [load]);

  const anyoneTyping = Object.entries(state.typingUsers)
    .some(([uid, v]) => uid !== viewerUserId && v);
  const partnerOnline = state.conversation
    ? (state.presence[state.conversation.other.userId] ?? false)
    : false;

  const items: ThreadItem[] = useMemo(() => [
    ...[...state.pending].reverse().map(p => ({ kind: 'pending' as const, pending: p })),
    ...state.items.map(m => ({ kind: 'server' as const, message: m })),
  ], [state.items, state.pending]);

  return {
    conversation: state.conversation,
    items,
    loading: state.loading,
    loadingOlder: state.loadingOlder,
    sending: state.sending,
    hasOlder: state.nextBeforeSeq != null,
    error: state.error,
    partnerReadSeqs: state.partnerReadSeqs,
    anyoneTyping,
    partnerOnline,
    reload: load,
    loadOlder,
    send,
    retry,
    notifyTyping,
  };
}
