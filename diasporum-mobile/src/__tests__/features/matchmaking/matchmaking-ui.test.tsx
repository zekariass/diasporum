import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import MatchmakingEntryScreen from '@/features/matchmaking/screens/matchmaking-entry-screen';
import DiscoveryScreen from '@/features/matchmaking/screens/discovery-screen';
import MatchDetailScreen from '@/features/matchmaking/screens/match-detail-screen';
import SetupScreen from '@/features/matchmaking/screens/setup-screen';
import { usePagedMatchmaking } from '@/features/matchmaking/hooks/use-paged-matchmaking';
import { ApiError } from '@/core/api/api-error';
import type {
  MatchView, PublicMatchmakingProfile, SwipeResult,
} from '@/features/matchmaking/types/matchmaking-types';

const mockClient = { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() };
let mockDateOfBirth = '1990-01-01';

jest.mock('@/global.css', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ matchId: 'match-1' }),
}));
jest.mock('@/core/session/session-provider', () => ({
  useSession: () => ({
    apiClient: mockClient,
    session: { me: { id: 'u1', email: 'u1@test.com' }, profile: { dateOfBirth: mockDateOfBirth } },
  }),
}));
jest.mock('@/features/matchmaking/hooks/use-matchmaking-realtime', () => ({
  useMatchmakingRealtime: () => {},
}));

const candidate: PublicMatchmakingProfile = {
  userId: 'u2', displayName: 'Ada', photoUrl: null, genderKey: 'WOMAN', age: 36,
  nationalityCountryId: null, religionId: null, educationLevel: null,
  occupation: 'Engineer', relationshipIntention: 'MARRIAGE', maritalStatus: null,
  hasChildren: false, wantsChildren: 'UNSURE', smoking: 'NO', drinking: 'NO',
  activityLevel: 'MODERATE', heightCm: 170, marriageTimeline: null,
  longDistanceRelationship: false, religionImportance: null, willingToRelocate: false,
  verificationStatus: 'VERIFIED',
};

const match: MatchView = {
  id: 'match-1', status: 'MATCHED', other: candidate,
  matchedAt: '2026-11-01T10:00:00Z', closedAt: null, conversationId: 'conv-1',
};

const references = { genders: [], religions: [], countries: [], languages: [], addresses: [] };

async function mount(ui: React.ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 0, left: 0, right: 0, bottom: 0 },
    }}>
      {ui}
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDateOfBirth = '1990-01-01';
});

afterEach(() => jest.restoreAllMocks());

describe('Matchmaking entry and adult gate', () => {
  it('routes a missing profile to setup from backend state', async () => {
    mockClient.get.mockRejectedValue(new ApiError({ code: 'NOT_FOUND', httpStatus: 404 }));
    await mount(<MatchmakingEntryScreen />);
    await waitFor(() => expect(jest.mocked(router.replace))
      .toHaveBeenCalledWith('/(app)/matchmaking/setup'));
  });

  it('blocks setup for an underage profile', async () => {
    mockDateOfBirth = '2015-01-01';
    mockClient.get.mockImplementation((path: string) => {
      if (path.endsWith('/reference-data')) return Promise.resolve(references);
      if (path.endsWith('/privacy-settings')) {
        return Promise.resolve({ allowMatchmakingDiscovery: false });
      }
      return Promise.reject(new ApiError({ code: 'NOT_FOUND', httpStatus: 404 }));
    });
    await mount(<SetupScreen />);
    expect(await screen.findByText('Matchmaking is for adults')).toBeTruthy();
    expect(screen.queryByLabelText('Save and set preferences')).toBeNull();
  });
});

describe('Discovery actions', () => {
  it('prevents duplicate likes and opens the mutual match conversation', async () => {
    mockClient.get.mockImplementation((path: string) => {
      if (path.startsWith('/api/v1/matchmaking/discover')) {
        return Promise.resolve({ items: [candidate], nextCursor: null });
      }
      return Promise.resolve({ items: [], nextCursor: null });
    });
    const result: SwipeResult = {
      action: 'LIKE', status: 'ACTIVE', matched: true,
      matchId: 'match-1', conversationId: 'conv-1',
    };
    let resolveSwipe!: (value: SwipeResult) => void;
    const pending = new Promise<SwipeResult>(resolve => { resolveSwipe = resolve; });
    mockClient.post.mockReturnValue(pending);

    await mount(<DiscoveryScreen />);
    const like = await screen.findByLabelText('Like');
    await fireEvent.press(like);
    await fireEvent.press(like);
    expect(mockClient.post.mock.calls.filter(call => call[0] === '/api/v1/matchmaking/swipes'))
      .toHaveLength(1);

    await act(async () => {
      resolveSwipe(result);
      await pending;
    });
    expect(await screen.findByText('You have a new mutual match')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Open chat'));
    expect(jest.mocked(router.push)).toHaveBeenCalledWith('/(app)/messages/conv-1');
  });

  it('reloads from the received-likes endpoint when the tab changes', async () => {
    mockClient.get.mockResolvedValue({ items: [], nextCursor: null });
    await mount(<DiscoveryScreen />);
    await waitFor(() => expect(mockClient.get)
      .toHaveBeenCalledWith('/api/v1/matchmaking/discover?limit=20', { authenticated: true }));

    await fireEvent.press(screen.getByText('Likes received'));
    await waitFor(() => expect(mockClient.get)
      .toHaveBeenCalledWith('/api/v1/matchmaking/likes/received?limit=20', { authenticated: true }));
  });
});

describe('Matchmaking pagination', () => {
  it('uses the opaque cursor and deduplicates overlapping items', async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce({ items: [{ id: 'one' }], nextCursor: 'next-cursor' })
      .mockResolvedValueOnce({ items: [{ id: 'one' }, { id: 'two' }], nextCursor: null });
    const hook = await renderHook(() => usePagedMatchmaking(
      fetcher, (item: { id: string }) => item.id, 'Could not load.'));
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));

    await act(async () => { hook.result.current.loadMore(); });
    await waitFor(() => expect(hook.result.current.items.map(item => item.id)).toEqual(['one', 'two']));
    expect(fetcher).toHaveBeenNthCalledWith(2, 'next-cursor');
  });
});

describe('Match detail continuity', () => {
  it('confirms unmatch, preserves chat entry, and removes only the active badge', async () => {
    mockClient.get.mockImplementation((path: string) => {
      if (path.endsWith('/reference-data')) return Promise.resolve(references);
      if (path.endsWith('/matches/match-1')) return Promise.resolve(match);
      return Promise.reject(new Error('unexpected ' + path));
    });
    mockClient.post.mockResolvedValue({ ...match, status: 'UNMATCHED', closedAt: '2026-11-02T10:00:00Z' });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    await mount(<MatchDetailScreen />);
    expect(await screen.findByTestId('matched-badge')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Unmatch'));
    expect(alert).toHaveBeenCalledWith('Unmatch?', expect.stringContaining('friendship'), expect.any(Array));
    const buttons = alert.mock.calls[0][2];
    await act(async () => { buttons?.[1].onPress?.(); });

    await waitFor(() => expect(screen.queryByTestId('matched-badge')).toBeNull());
    expect(mockClient.post).toHaveBeenCalledWith(
      '/api/v1/matchmaking/matches/match-1/unmatch', {}, { authenticated: true });
    await fireEvent.press(screen.getByLabelText('Open chat'));
    expect(jest.mocked(router.push)).toHaveBeenCalledWith('/(app)/messages/conv-1');
  });
});
