/**
 * Messaging API service — M1-M4 direct-messaging endpoints.
 */
import type { ApiClient } from '@/core/api/api-client';
import type {
  ConversationDetail, ConversationPage, ConversationView,
  CreateConversationRequest, MessagePage, MessageRequestView,
  MessageView, UnreadCountView,
} from '../types/messaging-types';

const BASE = '/api/v1/conversations';

export function createMessagingApi(client: ApiClient) {
  return {
    conversations: (cursor?: string, size = 20, archived = false) =>
      client.get<ConversationPage>(
        `${BASE}?size=${size}${archived ? '&archived=true' : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        { authenticated: true }
      ),

    createConversation: (req: CreateConversationRequest) =>
      client.post<ConversationView>(BASE, req, { authenticated: true }),

    conversationDetail: (conversationId: string) =>
      client.get<ConversationDetail>(`${BASE}/${conversationId}`, { authenticated: true }),

    unreadCount: () =>
      client.get<UnreadCountView>(`${BASE}/unread-count`, { authenticated: true }),

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

    messages: (conversationId: string, beforeSeq?: number, size = 30) =>
      client.get<MessagePage>(
        `${BASE}/${conversationId}/messages?size=${size}${beforeSeq !== undefined ? `&beforeSeq=${beforeSeq}` : ''}`,
        { authenticated: true }
      ),

    /** Send a message. M4: attachmentIds for image/document attachments. */
    sendMessage: (
      conversationId: string,
      body: string | null,
      clientMessageId?: string,
      replyToMessageId?: string,
      attachmentIds?: string[]
    ) =>
      client.post<MessageView>(`${BASE}/${conversationId}/messages`, {
        ...(body ? { body } : {}),
        ...(clientMessageId ? { clientMessageId } : {}),
        ...(replyToMessageId ? { replyToMessageId } : {}),
        ...(attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : {}),
      }, { authenticated: true }),

    deleteMessage: (conversationId: string, messageId: string) =>
      client.delete(`${BASE}/${conversationId}/messages/${messageId}`, { authenticated: true }),

    /** M4: Get a short-lived download URL for a message attachment. */
    attachmentDownloadUrl: (conversationId: string, messageId: string, assetId: string) =>
      client.post<{ downloadUrl: string }>(
        `${BASE}/${conversationId}/messages/${messageId}/attachments/${assetId}/download-url`,
        {},
        { authenticated: true }
      ),

    incomingRequests: () =>
      client.get<MessageRequestView[]>('/api/v1/message-requests', { authenticated: true }),
    acceptRequest: (requestId: string) =>
      client.post(`/api/v1/message-requests/${requestId}/accept`, {}, { authenticated: true }),
    declineRequest: (requestId: string) =>
      client.post(`/api/v1/message-requests/${requestId}/decline`, {}, { authenticated: true }),

    /** M4: Publish typing-started (true) or typing-stopped (false). */
    sendTyping: (conversationId: string, typing: boolean) =>
      client.post(`${BASE}/${conversationId}/typing`, { typing }, { authenticated: true })
        .catch(() => { /* ephemeral — never break on failure */ }),

    /** M4: Presence heartbeat — call every 30 s while conversation is open. */
    heartbeat: () =>
      client.post('/api/v1/presence/heartbeat', {}, { authenticated: true })
        .catch(() => { /* non-critical */ }),

    /** M4: Explicit offline signal — call on unmount or background. */
    goOffline: () =>
      client.post('/api/v1/presence/offline', {}, { authenticated: true })
        .catch(() => {}),

    /** M4: Get presence status for all participants in a conversation. */
    conversationPresence: (conversationId: string) =>
      client.get<Record<string, boolean>>(
        `${BASE}/${conversationId}/presence`, { authenticated: true }
      ),
  };
}

export type MessagingApi = ReturnType<typeof createMessagingApi>;
