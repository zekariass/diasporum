/**
 * Messaging API service — wraps the v10.12 M1 direct-messaging endpoints.
 * All methods use the shared apiClient (bearer auth, host restriction, 401 retry).
 * Verified against DirectConversationController, DirectMessageController and
 * MessageRequestController.
 */

import type { ApiClient } from '@/core/api/api-client';
import type {
  ConversationDetail,
  ConversationPage,
  ConversationView,
  CreateConversationRequest,
  MessagePage,
  MessageRequestView,
  MessageView,
  UnreadCountView,
} from '../types/messaging-types';

const BASE = '/api/v1/conversations';

export function createMessagingApi(client: ApiClient) {
  return {
    // ---- conversations ----
    /** Inbox page — keyset cursor on (last activity, id). */
    conversations: (cursor?: string, size = 20, archived = false) =>
      client.get<ConversationPage>(
        `${BASE}?size=${size}${archived ? '&archived=true' : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        { authenticated: true }
      ),

    /** Create or reuse a conversation (GENERAL request/direct or context). */
    createConversation: (req: CreateConversationRequest) =>
      client.post<ConversationView>(BASE, req, { authenticated: true }),

    /** Conversation detail + both participant side identities. */
    conversationDetail: (conversationId: string) =>
      client.get<ConversationDetail>(`${BASE}/${conversationId}`, { authenticated: true }),

    /** Aggregate unread: unread messages + incoming pending requests. */
    unreadCount: () =>
      client.get<UnreadCountView>(`${BASE}/unread-count`, { authenticated: true }),

    /** Advance the read cursor; omit lastReadSeq to mark all read. */
    markRead: (conversationId: string, lastReadSeq?: number) =>
      client.post<{ conversationId: string; lastReadSeq: number }>(
        `${BASE}/${conversationId}/read`,
        lastReadSeq === undefined ? {} : { lastReadSeq },
        { authenticated: true }
      ),

    archive: (conversationId: string) =>
      client.post(`${BASE}/${conversationId}/archive`, {}, { authenticated: true }),

    unarchive: (conversationId: string) =>
      client.delete(`${BASE}/${conversationId}/archive`, { authenticated: true }),

    mute: (conversationId: string, minutes?: number) =>
      client.post(`${BASE}/${conversationId}/mute`,
        minutes === undefined ? {} : { minutes }, { authenticated: true }),

    unmute: (conversationId: string) =>
      client.delete(`${BASE}/${conversationId}/mute`, { authenticated: true }),

    // ---- messages ----
    /** Message history — newest first; beforeSeq pages older messages. */
    messages: (conversationId: string, beforeSeq?: number, size = 30) =>
      client.get<MessagePage>(
        `${BASE}/${conversationId}/messages?size=${size}${beforeSeq !== undefined ? `&beforeSeq=${beforeSeq}` : ''}`,
        { authenticated: true }
      ),

    /** Send a text message. clientMessageId makes retries idempotent. */
    sendMessage: (conversationId: string, body: string, clientMessageId?: string,
        replyToMessageId?: string) =>
      client.post<MessageView>(`${BASE}/${conversationId}/messages`, {
        body,
        ...(clientMessageId ? { clientMessageId } : {}),
        ...(replyToMessageId ? { replyToMessageId } : {}),
      }, { authenticated: true }),

    /** Soft-delete the caller's own message. */
    deleteMessage: (conversationId: string, messageId: string) =>
      client.delete(`${BASE}/${conversationId}/messages/${messageId}`,
        { authenticated: true }),

    // ---- message requests ----
    /** Pending incoming requests, newest first. */
    incomingRequests: () =>
      client.get<MessageRequestView[]>('/api/v1/message-requests',
        { authenticated: true }),

    acceptRequest: (requestId: string) =>
      client.post(`/api/v1/message-requests/${requestId}/accept`, {},
        { authenticated: true }),

    declineRequest: (requestId: string) =>
      client.post(`/api/v1/message-requests/${requestId}/decline`, {},
        { authenticated: true }),
  };
}

export type MessagingApi = ReturnType<typeof createMessagingApi>;
