/**
 * Messaging API service tests — verifies correct endpoints, methods and
 * payloads against the M1 messaging controllers. Uses a mock apiClient —
 * no network.
 */

import { createMessagingApi } from '@/features/messaging/services/messaging-api';

jest.mock('@/core/config/env', () => ({
  appConfig: { apiBaseUrl: 'http://localhost:8080' },
  getTokenEndpoint: jest.fn(), getEndSessionEndpoint: jest.fn(), getKeycloakIssuer: jest.fn(),
}));

const client = {
  get: jest.fn(() => Promise.resolve({ items: [], nextCursor: null })),
  post: jest.fn(() => Promise.resolve({})),
  put: jest.fn(() => Promise.resolve({})),
  patch: jest.fn(() => Promise.resolve({})),
  delete: jest.fn(() => Promise.resolve({})),
};

beforeEach(() => jest.clearAllMocks());

const api = createMessagingApi(client as never);

describe('messagingApi', () => {
  it('conversations hits inbox endpoint', async () => {
    await api.conversations();
    expect(client.get).toHaveBeenCalledWith(
      '/api/v1/conversations?size=20',
      expect.objectContaining({ authenticated: true })
    );
  });

  it('conversations passes cursor and archived flag', async () => {
    await api.conversations('12345_abc', 20, true);
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('&archived=true&cursor=12345_abc'),
      expect.anything()
    );
  });

  it('createConversation posts the command body', async () => {
    await api.createConversation({ recipientUserId: 'u2', initialMessage: 'hi', clientMessageId: 'cm1' });
    expect(client.post).toHaveBeenCalledWith('/api/v1/conversations',
      { recipientUserId: 'u2', initialMessage: 'hi', clientMessageId: 'cm1' },
      expect.objectContaining({ authenticated: true })
    );
  });

  it('createConversation supports context + business acting side', async () => {
    await api.createConversation({
      contextType: 'COMMUNITY_HELP_POST', contextId: 'p1',
      actingBusinessAccountId: 'b1',
    });
    expect(client.post).toHaveBeenCalledWith('/api/v1/conversations',
      { contextType: 'COMMUNITY_HELP_POST', contextId: 'p1', actingBusinessAccountId: 'b1' },
      expect.anything());
  });

  it('conversationDetail hits correct path', async () => {
    await api.conversationDetail('c1');
    expect(client.get).toHaveBeenCalledWith('/api/v1/conversations/c1', expect.anything());
  });

  it('unreadCount hits unread-count endpoint', async () => {
    await api.unreadCount();
    expect(client.get).toHaveBeenCalledWith('/api/v1/conversations/unread-count', expect.anything());
  });

  it('markRead posts empty body when no seq given', async () => {
    await api.markRead('c1');
    expect(client.post).toHaveBeenCalledWith('/api/v1/conversations/c1/read', {}, expect.anything());
  });

  it('markRead posts lastReadSeq when given', async () => {
    await api.markRead('c1', 42);
    expect(client.post).toHaveBeenCalledWith('/api/v1/conversations/c1/read', { lastReadSeq: 42 }, expect.anything());
  });

  it('archive posts, unarchive deletes', async () => {
    await api.archive('c1');
    expect(client.post).toHaveBeenCalledWith('/api/v1/conversations/c1/archive', {}, expect.anything());
    await api.unarchive('c1');
    expect(client.delete).toHaveBeenCalledWith('/api/v1/conversations/c1/archive', expect.anything());
  });

  it('mute posts minutes, unmute deletes', async () => {
    await api.mute('c1', 60);
    expect(client.post).toHaveBeenCalledWith('/api/v1/conversations/c1/mute', { minutes: 60 }, expect.anything());
    await api.unmute('c1');
    expect(client.delete).toHaveBeenCalledWith('/api/v1/conversations/c1/mute', expect.anything());
  });

  it('messages hits history endpoint with beforeSeq cursor', async () => {
    await api.messages('c1', 9, 30);
    expect(client.get).toHaveBeenCalledWith(
      '/api/v1/conversations/c1/messages?size=30&beforeSeq=9', expect.anything());
  });

  it('messages omits beforeSeq for latest page', async () => {
    await api.messages('c1');
    expect(client.get).toHaveBeenCalledWith(
      '/api/v1/conversations/c1/messages?size=30', expect.anything());
  });

  it('sendMessage posts body with idempotent clientMessageId', async () => {
    await api.sendMessage('c1', 'hello', 'cm-1');
    expect(client.post).toHaveBeenCalledWith('/api/v1/conversations/c1/messages',
      { body: 'hello', clientMessageId: 'cm-1' }, expect.anything());
  });

  it('sendMessage omits clientMessageId when absent', async () => {
    await api.sendMessage('c1', 'hello');
    expect(client.post).toHaveBeenCalledWith('/api/v1/conversations/c1/messages',
      { body: 'hello' }, expect.anything());
  });

  it('deleteMessage deletes own message path', async () => {
    await api.deleteMessage('c1', 'm1');
    expect(client.delete).toHaveBeenCalledWith(
      '/api/v1/conversations/c1/messages/m1', expect.anything());
  });

  it('incomingRequests hits message-requests endpoint', async () => {
    await api.incomingRequests();
    expect(client.get).toHaveBeenCalledWith('/api/v1/message-requests', expect.anything());
  });

  it('acceptRequest and declineRequest post to action paths', async () => {
    await api.acceptRequest('r1');
    expect(client.post).toHaveBeenCalledWith('/api/v1/message-requests/r1/accept', {}, expect.anything());
    await api.declineRequest('r1');
    expect(client.post).toHaveBeenCalledWith('/api/v1/message-requests/r1/decline', {}, expect.anything());
  });
});
