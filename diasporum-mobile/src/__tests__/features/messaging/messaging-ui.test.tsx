/**
 * Messaging UI tests — conversation list states, request accept/decline,
 * thread sending + error retry, and cursor pagination. Session/apiClient and
 * expo-router are mocked; no network.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { router } from 'expo-router';

import MessagesScreen from '@/features/messaging/screens/messages-screen';
import ConversationScreen from '@/features/messaging/screens/conversation-thread-screen';
import { ApiError } from '@/core/api/api-error';

const mockClient = { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() };

jest.mock('@/global.css', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'client-msg-1' }));
jest.mock('ably');

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'conv-1' }),
}));

jest.mock('@/core/session/session-provider', () => ({
  useSession: () => ({
    apiClient: mockClient,
    session: { me: { id: 'u1', email: 'u1@test.com' }, memberships: [], activeCommunityId: null },
  }),
}));

const participant = (id: string, name: string, side: 'A' | 'B' = 'A') => ({
  side, userId: id, businessAccountId: null, displayName: name, business: false,
});

const conversation = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'conv-1', contextType: 'GENERAL', contextId: null, status: 'ACCEPTED', matched: false,
  self: participant('u1', 'Me', 'A'), other: participant('u2', 'Ada Lovelace', 'B'),
  lastMessageSeq: 2, lastMessageAt: '2026-11-01T10:00:00Z',
  lastMessagePreview: 'See you then', unreadCount: 3,
  archivedAt: null, mutedUntil: null, pendingRequestId: null,
  pendingRequestDirection: null, createdAt: '2026-10-30T10:00:00Z',
  ...over,
});

const message = (seq: number, over: Partial<Record<string, unknown>> = {}) => ({
  id: `m${seq}`, conversationId: 'conv-1', sequenceNo: seq,
  senderId: 'u2', senderBusinessAccountId: null, body: `msg ${seq}`,
  messageType: 'TEXT', replyToMessageId: null,
  createdAt: '2026-11-01T10:00:00Z', editedAt: null, ...over,
});

async function mount(ui: React.ReactElement) {
  return await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      {ui}
    </SafeAreaProvider>
  );
}

beforeEach(() => jest.clearAllMocks());

describe('MessagesScreen', () => {
  it('renders conversations with unread badge', async () => {
    mockClient.get.mockImplementation((path: string) => {
      if (path.startsWith('/api/v1/conversations?')) {
        return Promise.resolve({ items: [conversation()], nextCursor: null });
      }
      if (path === '/api/v1/message-requests') return Promise.resolve([]);
      return Promise.reject(new Error('unexpected ' + path));
    });
    await mount(<MessagesScreen />);
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('See you then')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();       // unread badge
  });

  it('renders the derived Matched badge for an active match', async () => {
    mockClient.get.mockImplementation((path: string) =>
      path === '/api/v1/message-requests'
        ? Promise.resolve([])
        : Promise.resolve({ items: [conversation({ matched: true })], nextCursor: null }));
    await mount(<MessagesScreen />);
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByTestId('matched-badge')).toBeTruthy();
  });

  it('renders empty state with no conversations or requests', async () => {
    mockClient.get.mockImplementation((path: string) =>
      path === '/api/v1/message-requests'
        ? Promise.resolve([])
        : Promise.resolve({ items: [], nextCursor: null }));
    await mount(<MessagesScreen />);
    expect(await screen.findByText('No conversations yet')).toBeTruthy();
  });

  it('renders error state with retry', async () => {
    mockClient.get.mockImplementation((path: string) =>
      path === '/api/v1/message-requests'
        ? Promise.resolve([])
        : Promise.reject(new ApiError({ code: 'NETWORK_ERROR', message: 'offline' })));
    await mount(<MessagesScreen />);
    expect(await screen.findByText('Retry')).toBeTruthy();
  });

  it('shows incoming requests and accepts one', async () => {
    const request = {
      id: 'req-1', conversationId: 'conv-9', status: 'REQUESTED',
      sender: participant('u9', 'Grace Hopper', 'A'),
      recipient: participant('u1', 'Me', 'B'),
      initialMessage: 'Saw your post!', createdAt: '2026-11-01T09:00:00Z',
      respondedAt: null,
    };
    mockClient.get.mockImplementation((path: string) =>
      path === '/api/v1/message-requests'
        ? Promise.resolve([request])
        : Promise.resolve({ items: [], nextCursor: null }));
    mockClient.post.mockResolvedValue({});
    await mount(<MessagesScreen />);
    expect(await screen.findByText('Message requests')).toBeTruthy();
    expect(screen.getByText('Saw your post!')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Accept request from Grace Hopper'));
    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith(
      '/api/v1/message-requests/req-1/accept', {}, expect.anything()));
  });

  it('navigates to the thread on row press', async () => {
    mockClient.get.mockImplementation((path: string) =>
      path === '/api/v1/message-requests'
        ? Promise.resolve([])
        : Promise.resolve({ items: [conversation()], nextCursor: null }));
    await mount(<MessagesScreen />);
    await fireEvent.press(await screen.findByLabelText('Conversation with Ada Lovelace'));
    expect(jest.mocked(router.push)).toHaveBeenCalledWith('/messages/conv-1');
  });
});

describe('ConversationScreen', () => {
  const detail = { conversation: conversation(), participants: [] };

  it('renders history newest-first and sends a message', async () => {
    mockClient.get.mockImplementation((path: string) => {
      if (path === '/api/v1/conversations/conv-1') return Promise.resolve(detail);
      if (path.includes('/messages?')) {
        return Promise.resolve({ items: [message(2), message(1)], nextCursor: '1' });
      }
      return Promise.reject(new Error('unexpected ' + path));
    });
    mockClient.post.mockImplementation((path: string) => {
      if (path === '/api/v1/conversations/conv-1/messages') {
        return Promise.resolve(message(3, { senderId: 'u1', body: 'hello!' }));
      }
      return Promise.resolve({});            // markRead
    });
    await mount(<ConversationScreen />);
    expect(await screen.findByText('msg 2')).toBeTruthy();
    expect(screen.getByText('msg 1')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Message input'), 'hello!');
    await fireEvent.press(screen.getByLabelText('Send message'));
    await waitFor(() => expect(mockClient.post).toHaveBeenCalledWith(
      '/api/v1/conversations/conv-1/messages',
      { body: 'hello!', clientMessageId: 'client-msg-1' },
      expect.anything()));
    expect(await screen.findByText('hello!')).toBeTruthy();
  });

  it('marks a failed send and retries with the same clientMessageId', async () => {
    mockClient.get.mockImplementation((path: string) => {
      if (path === '/api/v1/conversations/conv-1') return Promise.resolve(detail);
      if (path.includes('/messages?')) {
        return Promise.resolve({ items: [], nextCursor: null });
      }
      return Promise.reject(new Error('unexpected ' + path));
    });
    mockClient.post.mockImplementation((path: string) =>
      path === '/api/v1/conversations/conv-1/messages'
        ? Promise.reject(new ApiError({ code: 'NETWORK_ERROR', message: 'offline' }))
        : Promise.resolve({}));
    await mount(<ConversationScreen />);
    await waitFor(() => screen.getByLabelText('Message input'));
    await fireEvent.changeText(screen.getByLabelText('Message input'), 'retry me');
    await fireEvent.press(screen.getByLabelText('Send message'));
    expect(await screen.findByText('Failed — tap to retry')).toBeTruthy();

    mockClient.post.mockImplementation((path: string) =>
      path === '/api/v1/conversations/conv-1/messages'
        ? Promise.resolve(message(1, { senderId: 'u1', body: 'retry me' }))
        : Promise.resolve({}));
    await fireEvent.press(screen.getByText('Failed — tap to retry'));
    await waitFor(() => expect(screen.getByText('retry me')).toBeTruthy());
    // both the failed send and the retry used the same idempotent clientMessageId
    const sendCalls = mockClient.post.mock.calls.filter(
      (c: unknown[]) => c[0] === '/api/v1/conversations/conv-1/messages');
    expect(sendCalls).toHaveLength(2);
    expect(sendCalls[0][1].clientMessageId).toBe('client-msg-1');
    expect(sendCalls[1][1]).toEqual({ body: 'retry me', clientMessageId: 'client-msg-1' });
  });

  it('pages older messages when scrolled to top', async () => {
    mockClient.get.mockImplementation((path: string) => {
      if (path === '/api/v1/conversations/conv-1') return Promise.resolve(detail);
      if (path.includes('beforeSeq=5')) {
        return Promise.resolve({ items: [message(4)], nextCursor: null });
      }
      if (path.includes('/messages?')) {
        return Promise.resolve({ items: [message(5)], nextCursor: '5' });
      }
      return Promise.reject(new Error('unexpected ' + path));
    });
    mockClient.post.mockResolvedValue({});
    await mount(<ConversationScreen />);
    expect(await screen.findByText('msg 5')).toBeTruthy();

    const lists = screen.root!.queryAll(
      (i: { props: Record<string, unknown> }) => i.props.inverted === true);
    await fireEvent(lists[0], 'onEndReached');
    await waitFor(() => expect(mockClient.get).toHaveBeenCalledWith(
      expect.stringContaining('beforeSeq=5'), expect.anything()));
    expect(await screen.findByText('msg 4')).toBeTruthy();
  });

  it('shows pending-request banner instead of composer', async () => {
    mockClient.get.mockImplementation((path: string) => {
      if (path === '/api/v1/conversations/conv-1') {
        return Promise.resolve({
          conversation: conversation({ status: 'REQUESTED', pendingRequestDirection: 'OUTGOING' }),
          participants: [],
        });
      }
      if (path.includes('/messages?')) {
        return Promise.resolve({ items: [message(1)], nextCursor: null });
      }
      return Promise.reject(new Error('unexpected ' + path));
    });
    mockClient.post.mockResolvedValue({});
    await mount(<ConversationScreen />);
    expect(await screen.findByText(/Waiting for Ada Lovelace to accept/)).toBeTruthy();
    expect(screen.queryByLabelText('Send message')).toBeNull();
  });
});
