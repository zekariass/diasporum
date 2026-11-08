/**
 * People API — members / followers / following pages plus relationship
 * actions. Mirrors CommunityController.members + SocialController pages;
 * all return { items, total, page, size }.
 */

import type { ApiClient } from '@/core/api/api-client';
import type { ProfileSummary } from '@/features/feed/types/feed-types';
import type { RelationshipView } from '@/features/profile/services/social-api';

export interface PeoplePage {
  items: ProfileSummary[];
  total: number;
  page: number;
  size: number;
}

export function createPeopleApi(client: ApiClient) {
  return {
    members: (communityId: string, page = 0, size = 30) =>
      client.get<PeoplePage>(
        `/api/v1/communities/${communityId}/members?page=${page}&s=${size}`,
        { authenticated: true }),

    followers: (page = 0, size = 30) =>
      client.get<PeoplePage>(
        `/api/v1/social/followers?page=${page}&s=${size}`,
        { authenticated: true }),

    following: (page = 0, size = 30) =>
      client.get<PeoplePage>(
        `/api/v1/social/following?page=${page}&s=${size}`,
        { authenticated: true }),

    relationship: (userId: string) =>
      client.get<RelationshipView>(
        `/api/v1/social/relationship/${userId}`,
        { authenticated: true }),

    follow: (userId: string) =>
      client.post(`/api/v1/social/follows/${userId}`, {}, { authenticated: true }),

    unfollow: (userId: string) =>
      client.delete(`/api/v1/social/follows/${userId}`, { authenticated: true }),
  };
}

export type PeopleApi = ReturnType<typeof createPeopleApi>;
