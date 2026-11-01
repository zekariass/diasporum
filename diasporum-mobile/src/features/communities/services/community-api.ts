/**
 * Community API service — memberships, active community, join/leave.
 */

import type { ApiClient } from '@/core/api/api-client';
import type {
  CommunityPreviewResponse,
  CommunityView,
  MembershipView,
  OnboardingCompleteResponse,
} from '@/features/communities/types/community-types';

export function createCommunityApi(client: ApiClient) {
  return {
    /** All ACTIVE memberships for the current user. */
    myCommunities() {
      return client.get<{ items: MembershipView[] }>(
        '/api/v1/me/communities',
        { authenticated: true }
      );
    },

    /** Communities eligible to join — filtered by origin country server-side. */
    availableCommunities() {
      return client.get<{ items: CommunityView[] }>(
        '/api/v1/me/communities/available',
        { authenticated: true }
      );
    },

    /** Current active community ID (null if not set). */
    activeCommunity() {
      return client.get<{ communityId: string | null }>(
        '/api/v1/me/active-community',
        { authenticated: true }
      );
    },

    /** Set the active community — must already be an ACTIVE member. */
    setActiveCommunity(communityId: string) {
      return client.put<{ communityId: string }>(
        '/api/v1/me/active-community',
        { communityId },
        { authenticated: true }
      );
    },

    /** Join a community — idempotent; returns existing membership if already joined. */
    join(communityId: string) {
      return client.post<MembershipView>(
        `/api/v1/communities/${communityId}/join`,
        undefined,
        { authenticated: true }
      );
    },

    /** Leave a community. */
    leave(communityId: string) {
      return client.delete<void>(
        `/api/v1/communities/${communityId}/membership`,
        { authenticated: true }
      );
    },

    /** Membership record for a specific community. */
    membership(communityId: string) {
      return client.get<MembershipView>(
        `/api/v1/communities/${communityId}/membership`,
        { authenticated: true }
      );
    },

    /** Community the user will auto-join — derived from origin + current country. */
    communityPreview() {
      return client.get<CommunityPreviewResponse>(
        '/api/v1/me/community-preview',
        { authenticated: true }
      );
    },

    /** Completes onboarding: creates membership + sets default/active community. Idempotent. */
    completeOnboarding() {
      return client.post<OnboardingCompleteResponse>(
        '/api/v1/me/onboarding/complete',
        undefined,
        { authenticated: true }
      );
    },
  };
}

export type CommunityApi = ReturnType<typeof createCommunityApi>;
