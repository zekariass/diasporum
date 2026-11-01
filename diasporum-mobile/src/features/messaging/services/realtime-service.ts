/**
 * Ably realtime transport for messaging (M3).
 *
 * One shared connection per signed-in user; channels are per-user
 * (`user:{id}`) — the backend only ever issues `subscribe` on the caller's
 * own channel, so a client can never attach to someone else's stream.
 * Authentication is via authCallback → POST /api/v1/realtime/token, which
 * returns a short-lived signed token request; the SDK renews it
 * automatically when it nears expiry.
 *
 * Ably is transport, never the source of truth — every event handler here
 * reconciles against the REST API, so the app keeps working when realtime
 * is unavailable.
 */

import * as Ably from 'ably';
import type { ApiClient } from '@/core/api/api-client';

export type MessagingEventType =
  | 'MESSAGE_CREATED'
  | 'MESSAGE_READ'
  | 'CONVERSATION_UPDATED';

/** Minimal event payload published by the outbox dispatcher. */
export interface MessagingEvent {
  type: MessagingEventType;
  eventId?: string;
  conversationId: string;
  messageId?: string;
  sequenceNo?: number;
  senderId?: string;
  senderBusinessAccountId?: string;
  createdAt?: string;
  readerId?: string;
  readerBusinessAccountId?: string;
  lastReadSeq?: number;
  status?: string;
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

  /**
   * Ensure a connection exists for {@code userId}. Refcounted — each caller
   * must balance with {@link release}; the last release closes the socket.
   * Rejects never propagate: realtime absence must not break the screen.
   */
  async acquire(apiClient: ApiClient, userId: string): Promise<void> {
    this.consumers++;
    if (this.userId !== userId) {
      // Account switch — rebuild the connection for the new identity.
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

  /** Decrement the refcount; disconnect when the last consumer leaves. */
  release(userId?: string): void {
    this.consumers = Math.max(0, this.consumers - 1);
    if (this.consumers === 0) {
      this.teardown();
      this.userId = null;
      this.everConnected = false;
    }
  }

  /** Force-close — sign-out path; safe to call any time. */
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
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  /**
   * Connection-state listener. `connected=true, recovered=true` means the
   * socket re-established after a drop — callers should reconcile via REST
   * since events may have been missed while disconnected.
   */
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
            .post<Record<string, unknown>>(TOKEN_PATH, {},
              { authenticated: true })
            .then(tokenRequest => callback(null, tokenRequest as never))
            .catch(err => callback(
              err instanceof Error ? err.message : String(err), null));
        },
        // React Native has no ambient websocket — Ably picks the RN
        // transport automatically; these just keep the session snappy.
        disconnectedRetryTimeout: 5000,
        suspendedRetryTimeout: 15000,
      });
    } catch {
      return; // SDK init failed — stay in REST-only mode.
    }

    realtime.connection.on((state) => {
      const recovered = this.everConnected
        && (state.current === 'connected')
        && (state.previous === 'disconnected'
          || state.previous === 'suspended');
      if (state.current === 'connected') {
        this.everConnected = true;
      }
      this.connHandlers.forEach(h =>
        h(state.current === 'connected', recovered));
    });

    const channel = realtime.channels.get(`user:${userId}`);
    channel.subscribe(msg => {
      try {
        const data = typeof msg.data === 'string'
          ? JSON.parse(msg.data) : (msg.data ?? {});
        const type = (msg.name ?? data.type) as MessagingEventType;
        this.handlers.get(type)?.forEach(h => h(data as MessagingEvent));
      } catch {
        // Malformed event — never let it break the subscription.
      }
    });

    this.realtime = realtime;
    this.channel = channel;
  }

  private teardown(): void {
    try {
      this.channel?.unsubscribe();
    } catch { /* already detached */ }
    try {
      this.realtime?.close();
    } catch { /* already closed */ }
    this.channel = null;
    this.realtime = null;
  }
}

/** Shared singleton — one Ably connection per signed-in user. */
export const messagingRealtime = new MessagingRealtime();
