/** Explore API — discovery endpoints for people, communities, posts, reels. */

import type { ApiClient } from '@/core/api/api-client';
import type { ProfileSummary, FeedPage, CommunitySummary } from '../types/feed-types';

export function createExploreApi(client: ApiClient) {
  return {
    // People
    communityMembers: (communityId: string) =>
      client.get<{ items: ProfileSummary[] }>(`/api/v1/communities/${communityId}/members?size=50`, { authenticated: true }),
    following: () =>
      client.get<{ items: ProfileSummary[] }>('/api/v1/social/following?size=50', { authenticated: true }),
    follow: (targetId: string) =>
      client.post(`/api/v1/social/follows/${targetId}`, {}, { authenticated: true }),
    unfollow: (targetId: string) =>
      client.delete(`/api/v1/social/follows/${targetId}`, { authenticated: true }),
    relationship: (targetId: string) =>
      client.get<{ following: boolean; followedBy: boolean; blockedBy: boolean }>(
        `/api/v1/social/relationship/${targetId}`, { authenticated: true }),

    // Communities
    getCommunity: (communityId: string) =>
      client.get<CommunitySummary>(`/api/v1/me/communities/${communityId}`, { authenticated: true }),
    availableCommunities: () =>
      client.get<{ items: CommunitySummary[] }>('/api/v1/me/communities/available', { authenticated: true }),
    myCommunities: () =>
      client.get<{ items: CommunitySummary[] }>('/api/v1/me/communities', { authenticated: true }),
    joinCommunity: (communityId: string) =>
      client.post(`/api/v1/communities/${communityId}/join`, {}, { authenticated: true }),

    // Content
    communityPosts: (communityId: string, cursor?: string) =>
      client.get<FeedPage>(`/api/v1/feed/community?communityId=${communityId}&size=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { authenticated: true }),
    communityReels: (communityId: string, cursor?: string) =>
      client.get<FeedPage>(`/api/v1/feed/reels/community?communityId=${communityId}&size=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { authenticated: true }),

    // Batch author resolution
    authorSummaries: (ids: string[]) =>
      client.get<ProfileSummary[]>(`/api/v1/feed/authors?ids=${ids.join(',')}`, { authenticated: true }),
  };
}
