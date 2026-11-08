/**
 * Social graph reads for the profile stats row — follower/following totals.
 * Mirrors SocialController (/api/v1/social/*).
 */

import type { ApiClient } from "@/core/api/api-client";
import type { ProfileSummary } from "@/features/feed/types/feed-types";

export interface SocialPage {
  items: ProfileSummary[];
  total: number;
  page: number;
  size: number;
}

/** RelationshipView — SocialApi.relationship (SocialController). */
export interface RelationshipView {
  following: boolean;
  followedBy: boolean;
  mutual: boolean;
  friends: boolean;
  blockedByMe: boolean;
}

export function createSocialApi(client: ApiClient) {
  return {
    relationship: (userId: string) =>
      client.get<RelationshipView>(
        `/api/v1/social/relationship/${userId}`,
        { authenticated: true },
      ),
    follow: (userId: string) =>
      client.post(`/api/v1/social/follows/${userId}`, {}, { authenticated: true }),
    unfollow: (userId: string) =>
      client.delete(`/api/v1/social/follows/${userId}`, { authenticated: true }),
    followers: (page = 0, size = 20) =>
      client.get<SocialPage>(
        `/api/v1/social/followers?page=${page}&s=${size}`,
        { authenticated: true },
      ),
    following: (page = 0, size = 20) =>
      client.get<SocialPage>(
        `/api/v1/social/following?page=${page}&s=${size}`,
        { authenticated: true },
      ),
  };
}

export type SocialApi = ReturnType<typeof createSocialApi>;
