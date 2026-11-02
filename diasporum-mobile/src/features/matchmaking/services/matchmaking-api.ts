import type { ApiClient } from '@/core/api/api-client';
import type {
  MatchmakingPreferences,
  MatchmakingPreferencesRequest,
  MatchmakingProfile,
  MatchmakingProfileRequest,
  MatchmakingReferenceData,
  MatchView,
  Page,
  PrivacySettings,
  PublicMatchmakingProfile,
  SwipeAction,
  SwipeResult,
} from '../types/matchmaking-types';

const ROOT = '/api/v1/matchmaking';
const AUTH = { authenticated: true } as const;

function page(path: string, cursor?: string, limit = 20): string {
  return `${path}?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
}

export function createMatchmakingApi(client: ApiClient) {
  return {
    profile: () => client.get<MatchmakingProfile>(`${ROOT}/profile`, AUTH),
    saveProfile: (profile: MatchmakingProfileRequest) =>
      client.put<MatchmakingProfile>(`${ROOT}/profile`, profile, AUTH),
    deleteProfile: () => client.delete<void>(`${ROOT}/profile`, AUTH),
    preferences: () => client.get<MatchmakingPreferences>(`${ROOT}/preferences`, AUTH),
    savePreferences: (preferences: MatchmakingPreferencesRequest) =>
      client.put<MatchmakingPreferences>(`${ROOT}/preferences`, preferences, AUTH),
    referenceData: () => client.get<MatchmakingReferenceData>(`${ROOT}/reference-data`, AUTH),
    discover: (cursor?: string) =>
      client.get<Page<PublicMatchmakingProfile>>(page(`${ROOT}/discover`, cursor), AUTH),
    candidate: (userId: string) =>
      client.get<PublicMatchmakingProfile>(`${ROOT}/profiles/${encodeURIComponent(userId)}`, AUTH),
    receivedLikes: (cursor?: string) =>
      client.get<Page<PublicMatchmakingProfile>>(page(`${ROOT}/likes/received`, cursor), AUTH),
    swipe: (targetUserId: string, action: SwipeAction) =>
      client.post<SwipeResult>(`${ROOT}/swipes`, { targetUserId, action }, AUTH),
    cancelLike: (targetUserId: string) =>
      client.delete<SwipeResult>(`${ROOT}/likes/${encodeURIComponent(targetUserId)}`, AUTH),
    rewind: () => client.post<SwipeResult>(`${ROOT}/rewind`, {}, AUTH),
    matches: (cursor?: string) =>
      client.get<Page<MatchView>>(page(`${ROOT}/matches`, cursor), AUTH),
    match: (matchId: string) =>
      client.get<MatchView>(`${ROOT}/matches/${encodeURIComponent(matchId)}`, AUTH),
    unmatch: (matchId: string, reason?: string) =>
      client.post<MatchView>(`${ROOT}/matches/${encodeURIComponent(matchId)}/unmatch`,
        reason ? { reason } : {}, AUTH),
    reportMatch: (matchId: string, reason: string, details?: string) =>
      client.post<{ id: string }>(`${ROOT}/matches/${encodeURIComponent(matchId)}/report`,
        { reason, ...(details ? { details } : {}) }, AUTH),
    privacy: () => client.get<PrivacySettings>('/api/v1/me/privacy-settings', AUTH),
    setDiscoveryOptIn: (allowMatchmakingDiscovery: boolean) =>
      client.patch<PrivacySettings>('/api/v1/me/privacy-settings', { allowMatchmakingDiscovery }, AUTH),
    block: (targetUserId: string) =>
      client.post<{ blocked: boolean }>(`/api/v1/social/blocks/${encodeURIComponent(targetUserId)}`, {}, AUTH),
  };
}

export type MatchmakingApi = ReturnType<typeof createMatchmakingApi>;
