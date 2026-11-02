/**
 * Ably realtime transport for messaging (M3 + M4).
 *
 * M4 adds: TYPING_STARTED, TYPING_STOPPED, PRESENCE_ONLINE, PRESENCE_OFFLINE.
 * All events remain on the personal user channel (user:{id}) — no new channel
 * types are introduced. Ably is transport only; REST is the source of truth.
 */

import * as Ably from 'ably';
import type { ApiClient } from '@/core/api/api-client';

export type MessagingEventType =
  | 'MESSAGE_CREATED'
  | 'MESSAGE_READ'
  | 'CONVERSATION_UPDATED'
  | 'TYPING_STARTED'
  | 'TYPING_STOPPED'
  | 'PRESENCE_ONLINE'
  | 'PRESENCE_OFFLINE';

export interface MessagingEvent {
  type: MessagingEventType;
  conversationId?: string;
  messageId?: string;
  sequenceNo?: number;
  senderId?: string;
  senderBusinessAccountId?: string;
  createdAt?: string;
  readerId?: string;
  lastReadSeq?: number;
  status?: string;
  userId?: string;
  online?: boolean;
}

type EventHandler = (event: MessagingEvent) => void;
type ConnectionHandler = (connected: boolean, recovered: boolean) => void;

const TOKEN_PATH = '/api/v1/realtime/token';

class MessagingRealtime {
  private realtime: Ably.Realtime | null = null;
  private channel: Ably.RealtimeChannel | null = null;
  private userId: string | null = null;
  private connecting: Promise<void> | null = null;
  private consumers = 0;
  private handlers = new Map<MessagingEventType, Set<EventHandler>>();
  private connHandlers = new Set<ConnectionHandler>();
  private everConnected = false;

  async acquire(apiClient: ApiClient, userId: string): Promise<void> {
    this.consumers++;
    if (this.userId !== userId) {
      this.teardown();
      this.userId = userId;
    }
    if (this.realtime || this.connecting) {
      return this.connecting ?? Promise.resolve();
    }
    this.connecting = this.connect(apiClient, userId).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  release(): void {
    this.consumers = Math.max(0, this.consumers - 1);
    if (this.consumers === 0) {
      this.teardown();
      this.userId = null;
      this.everConnected = false;
    }
  }

  disconnect(): void {
    this.consumers = 0;
    this.teardown();
    this.userId = null;
    this.everConnected = false;
    this.handlers.clear();
    this.connHandlers.clear();
  }

  isConnected(): boolean {
    return this.realtime?.connection.state === 'connected';
  }

  on(type: MessagingEventType, handler: EventHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) { set = new Set(); this.handlers.set(type, set); }
    set.add(handler);
    return () => set!.delete(handler);
  }

  onConnection(handler: ConnectionHandler): () => void {
    this.connHandlers.add(handler);
    return () => this.connHandlers.delete(handler);
  }

  private async connect(apiClient: ApiClient, userId: string): Promise<void> {
    let realtime: Ably.Realtime;
    try {
      realtime = new Ably.Realtime({
        authCallback: (_params, callback) => {
          apiClient
            .post<Record<string, unknown>>(TOKEN_PATH, {}, { authenticated: true })
            .then(t => callback(null, t as never))
            .catch(e => callback(e instanceof Error ? e.message : String(e), null));
        },
        disconnectedRetryTimeout: 5000,
        suspendedRetryTimeout: 15000,
      });
    } catch { return; }

    realtime.connection.on((state) => {
      const recovered = this.everConnected
        && state.current === 'connected'
        && (state.previous === 'disconnected' || state.previous === 'suspended');
      if (state.current === 'connected') this.everConnected = true;
      this.connHandlers.forEach(h => h(state.current === 'connected', recovered));
    });

    const channel = realtime.channels.get(`user:${userId}`);
    channel.subscribe(msg => {
      try {
        const data = typeof msg.data === 'string'
          ? JSON.parse(msg.data) : (msg.data ?? {});
        const type = (msg.name ?? data.type) as MessagingEventType;
        this.handlers.get(type)?.forEach(h => h(data as MessagingEvent));
      } catch { /* malformed — ignore */ }
    });

    this.realtime = realtime;
    this.channel = channel;
  }

  private teardown(): void {
    try { this.channel?.unsubscribe(); } catch { /* ok */ }
    try { this.realtime?.close(); } catch { /* ok */ }
    this.channel = null;
    this.realtime = null;
  }
}

export const messagingRealtime = new MessagingRealtime();
