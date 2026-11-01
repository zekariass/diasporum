/**
 * Messaging realtime tests (M3) — connection init, user-channel
 * subscription, incoming-message merge, duplicate/out-of-order events,
 * reconnect reconcile, cleanup on unmount, and optimistic send dedupe.
 * Ably is fully mocked; no network or socket is used.
 */

import React from 'react';
import { Text, Pressable } from 'react-native';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ConversationScreen from '@/features/messaging/screens/conversation-screen';
import { useMessagingRealtime } from '@/features/messaging/hooks/use-realtime';
import { useThread } from '@/features/messaging/hooks/use-thread';
import { messagingRealtime } from '@/features/messaging/services/realtime-service';
import { __state as ablyState } from '../../../../__mocks__/ably';

const mockClient = { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() };

jest.mock('@/global.css', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'client-msg-rt' }));
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

// ---- Ably mock: the shared manual mock in __mocks__/ably.ts captures
// channels, subscribers and connection handlers — no real sockets. ----
jest.mock('ably');

function emitEvent(name: string, data: Record<string, unknown>) {
  ablyState.channels['user:u1']?.handlers
    .forEach(h => h({ name, data: JSON.stringify(data) }));
}

function emitConnection(current: string, previous: string) {
  ablyState.instances.forEach(i =>
    i.connection.listeners.forEach(l => l({ current, previous })));
}

const participant = (id: string, name: string, side: 'A' | 'B' = 'A') => ({
  side, userId: id, businessAccountId: null, displayName: name, business: false,
});

const conversation = (over: Record<string, unknown> = {}) => ({
  id: 'conv-1', contextType: 'GENERAL', contextId: null, status: 'ACCEPTED',
  self: participant('u1', 'Me', 'A'), other: participant('u2', 'Ada Lovelace', 'B'),
  lastMessageSeq: 2, lastMessageAt: '2026-11-01T10:00:00Z',
  lastMessagePreview: 'See you then', unreadCount: 0,
  archivedAt: null, mutedUntil: null, pendingRequestId: null,
  pendingRequestDirection: null, createdAt: '2026-10-30T10:00:00Z',
  ...over,
});

const message = (seq: number, over: Record<string, unknown> = {}) => ({
  id: `m${seq}`, conversationId: 'conv-1', sequenceNo: seq,
  senderId: 'u2', senderBusinessAccountId: null, body: `msg ${seq}`,
  messageType: 'TEXT', replyToMessageId: null,
  createdAt: '2026-11-01T10:00:00Z', editedAt: null, ...over,
});

function threadMocks(items: ReturnType<typeof message>[]) {
  mockClient.get.mockImplementation((path: string) => {
    if (path === '/api/v1/conversations/conv-1') {
      return Promise.resolve({ conversation: conversation(), participants: [] });
    }
    if (path.startsWith('/api/v1/conversations/conv-1/messages')) {
      return Promise.resolve({ items, nextCursor: null });
    }
    return Promise.reject(new Error('unexpected ' + path));
  });
  mockClient.post.mockImplementation((path: string) =>
    path.endsWith('/read') ? Promise.resolve({ conversationId: 'conv-1', lastReadSeq: 1 }) : Promise.reject(new Error('unexpected ' + path)));
}

async function mount(ui: React.ReactElement) {
  return await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      {ui}
    </SafeAreaProvider>
  );
}

/** Minimal component exposing useThread state for assertions. */
function ThreadProbe() {
  const t = useThread('conv-1', 'u1');
  const server = t.items.filter(i => i.kind === 'server');
  return (
    <>
      <Text testID="seqs">
        {server.map(i => (i.kind === 'server' ? i.message.sequenceNo : -1))
          .join(',')}
      </Text>
      <Text testID="pending">{t.items.filter(i => i.kind === 'pending').length}</Text>
      {server.map(i => (i.kind === 'server'
        ? <Text key={i.message.id} testID={`body-${i.message.id}`}>{i.message.body}</Text>
        : null))}
      <Pressable testID="send" onPress={() => void t.send('hello there')} />
    </>
  );
}

jest.setTimeout(20000); // RNTL act flushing on the full screen is slow.

beforeEach(() => {
  jest.clearAllMocks();
  messagingRealtime.disconnect();
  ablyState.instances.length = 0;
  Object.keys(ablyState.channels).forEach(k => delete ablyState.channels[k]);
});

afterEach(() => messagingRealtime.disconnect());

describe('realtime connection', () => {
  it('connects and subscribes the user channel', async () => {
    await renderHook(() => useMessagingRealtime());
    await waitFor(() => expect(ablyState.instances.length).toBe(1));
    expect(ablyState.channels['user:u1'].handlers.length).toBe(1);
  });

  it('authCallback fetches a scoped token from the backend', async () => {
    mockClient.post.mockResolvedValueOnce({
      keyName: 'app.keyId', capability: '{"user:u1":["subscribe"]}',
      clientId: 'u1', ttl: 3600000, timestamp: 1, nonce: 'n', mac: 'm',
    });
    await renderHook(() => useMessagingRealtime());
    await waitFor(() => expect(ablyState.instances.length).toBe(1));
    const cb = jest.fn();
    (ablyState.instances[0].options.authCallback as (
        p: unknown, c: (e: unknown, t: unknown) => void) => void)({}, cb);
    await waitFor(() => expect(cb).toHaveBeenCalled());
    expect(mockClient.post).toHaveBeenCalledWith(
      '/api/v1/realtime/token', {}, { authenticated: true });
    expect(cb.mock.calls[0][0]).toBeNull();
    expect(cb.mock.calls[0][1]).toMatchObject({ clientId: 'u1' });
  });

  it('unmount releases the connection (unsubscribe + close)', async () => {
    const hook = await renderHook(() => useMessagingRealtime());
    await waitFor(() => expect(ablyState.instances.length).toBe(1));
    await hook.unmount();
    expect(ablyState.instances[0].closed).toBe(true);
    expect(ablyState.channels['user:u1'].handlers.length).toBe(0);
  });
});

describe('realtime events in the thread', () => {
  it('merges an incoming MESSAGE_CREATED via the REST page', async () => {
    threadMocks([message(2), message(1)]);
    await mount(<ConversationScreen />);
    expect(await screen.findByText('msg 2')).toBeTruthy();
    // Event arrives → mergeLatest refetches the newest page with m3.
    mockClient.get.mockImplementation((path: string) => {
      if (path.startsWith('/api/v1/conversations/conv-1/messages')) {
        return Promise.resolve({ items: [message(3), message(2), message(1)], nextCursor: null });
      }
      if (path === '/api/v1/conversations/conv-1') {
        return Promise.resolve({ conversation: conversation(), participants: [] });
      }
      return Promise.reject(new Error('unexpected ' + path));
    });
    await act(async () => emitEvent('MESSAGE_CREATED', {
      conversationId: 'conv-1', messageId: 'm3', sequenceNo: 3,
      senderId: 'u2', createdAt: '2026-11-01T10:01:00Z',
    }));
    expect(await screen.findByText('msg 3')).toBeTruthy();
    // Every message shown exactly once — merge deduped m1/m2 by id.
    expect(screen.getAllByText(/msg \d/).length).toBe(3);
  });

  it('events for other conversations are ignored', async () => {
    threadMocks([message(1)]);
    await mount(<ConversationScreen />);
    expect(await screen.findByText('msg 1')).toBeTruthy();
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });
    const calls = mockClient.get.mock.calls.length;
    await act(async () => emitEvent('MESSAGE_CREATED', {
      conversationId: 'conv-9', messageId: 'm9', sequenceNo: 1,
      senderId: 'u2',
    }));
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });
    // No message/detail fetch was triggered by the foreign-conversation event.
    expect(mockClient.get.mock.calls.length).toBe(calls);
  });

  it('keeps sequence order for out-of-order events', async () => {
    threadMocks([message(1)]);
    await mount(<ThreadProbe />);
    expect((await screen.findByTestId('seqs')).props.children).toBe('1');
    mockClient.get.mockImplementation((path: string) => {
      if (path.startsWith('/api/v1/conversations/conv-1/messages')) {
        return Promise.resolve({ items: [message(5), message(4)], nextCursor: null });
      }
      return Promise.resolve({ conversation: conversation(), participants: [] });
    });
    await act(async () => emitEvent('MESSAGE_CREATED', {
      conversationId: 'conv-1', messageId: 'm5', sequenceNo: 5, senderId: 'u2',
    }));
    await waitFor(() => expect(
      (screen.getByTestId('seqs').props.children as string).split(',').length)
      .toBe(3));
    expect((screen.getByTestId('seqs').props.children as string)).toBe('5,4,1');
  });

  it('reconnect after a drop reconciles via REST reload', async () => {
    threadMocks([message(1)]);
    await mount(<ThreadProbe />);
    expect((await screen.findByTestId('seqs')).props.children).toBe('1');
    mockClient.get.mockClear();
    await act(async () => {
      // Initial connect (real SDK fires this) → drop → re-establish.
      emitConnection('connected', 'connecting');
      emitConnection('suspended', 'connected');
      emitConnection('connected', 'suspended');
    });
    await waitFor(() => expect(
      mockClient.get.mock.calls.some(c =>
        String(c[0]).includes('/messages'))).toBe(true));
  });

  it('MESSAGE_READ refreshes conversation detail', async () => {
    threadMocks([message(1)]);
    await mount(<ThreadProbe />);
    await waitFor(() => expect(mockClient.get).toHaveBeenCalled());
    mockClient.get.mockClear();
    await act(async () => emitEvent('MESSAGE_READ', {
      conversationId: 'conv-1', readerId: 'u2', lastReadSeq: 1,
    }));
    await waitFor(() => expect(
      mockClient.get.mock.calls.some(c => c[0] === '/api/v1/conversations/conv-1')).toBe(true));
  });

  it('REST send + realtime echo of the same message show once', async () => {
    threadMocks([message(1)]);
    await mount(<ThreadProbe />);
    expect((await screen.findByTestId('seqs')).props.children).toBe('1');
    // Send — REST returns the persisted message.
    mockClient.post.mockImplementation((path: string, body: unknown) => {
      if (path.endsWith('/read')) {
        return Promise.resolve({ conversationId: 'conv-1', lastReadSeq: 2 });
      }
      if (path.endsWith('/messages')) {
        return Promise.resolve(message(2, { senderId: 'u1', body: (body as { body: string }).body }));
      }
      return Promise.reject(new Error('unexpected ' + path));
    });
    await fireEvent.press(screen.getByTestId('send'));
    await waitFor(() => expect(
      (screen.getByTestId('seqs').props.children as string)).toBe('2,1'));
    // The realtime echo for the same persisted message must not duplicate.
    mockClient.get.mockImplementation((path: string) => {
      if (path.startsWith('/api/v1/conversations/conv-1/messages')) {
        return Promise.resolve({
          items: [message(2, { senderId: 'u1', body: 'hello there' }), message(1)],
          nextCursor: null });
      }
      return Promise.resolve({ conversation: conversation(), participants: [] });
    });
    await act(async () => emitEvent('MESSAGE_CREATED', {
      conversationId: 'conv-1', messageId: 'm2', sequenceNo: 2,
      senderId: 'u1',
    }));
    await waitFor(() => expect(
      screen.getAllByTestId('body-m2').length).toBe(1));
    expect((screen.getByTestId('pending').props.children as number)).toBe(0);
  });
});
