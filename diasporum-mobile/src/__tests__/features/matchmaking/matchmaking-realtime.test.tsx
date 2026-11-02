import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useMatchmakingRealtime } from '@/features/matchmaking/hooks/use-matchmaking-realtime';
import { messagingRealtime } from '@/features/messaging/services/realtime-service';
import { __state as ablyState } from '../../../../__mocks__/ably';

const mockClient = { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() };

jest.mock('ably');
jest.mock('@/core/session/session-provider', () => ({
  useSession: () => ({
    apiClient: mockClient,
    session: { me: { id: 'u1', email: 'u1@test.com' } },
  }),
}));

function emit(type: string, eventId: string) {
  ablyState.channels['user:u1']?.handlers.forEach(handler => handler({
    name: type,
    data: JSON.stringify({ type, eventId, matchId: 'match-1' }),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  messagingRealtime.disconnect();
  ablyState.instances.length = 0;
  Object.keys(ablyState.channels).forEach(key => delete ablyState.channels[key]);
});

afterEach(() => messagingRealtime.disconnect());

it('deduplicates events and debounces Matchmaking REST invalidation', async () => {
  const invalidate = jest.fn();
  const hook = await renderHook(() => useMatchmakingRealtime(invalidate));
  await waitFor(() => expect(ablyState.channels['user:u1']?.handlers.length).toBe(1));

  await act(async () => {
    emit('MATCHMAKING_MATCHED', 'event-1');
    emit('MATCHMAKING_MATCHED', 'event-1');
    emit('MATCHMAKING_UNMATCHED', 'event-2');
  });
  await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
  expect(invalidate).toHaveBeenCalledTimes(1);

  await hook.unmount();
  expect(ablyState.channels['user:u1']?.handlers.length).toBe(0);
});
