/**
 * Identity API service — own-profile read, patch, completion, settings,
 * username availability.
 */

import type { ApiClient } from '@/core/api/api-client';
import type {
  MeResponse,
  ProfileResponse,
  UpdateProfileRequest,
  ProfileCompletionResponse,
  UsernameAvailabilityResponse,
  SettingsResponse,
  UpdateSettingsRequest,
} from '@/features/profile/types/profile-types';

export function createProfileApi(client: ApiClient) {
  return {
    me() {
      return client.get<MeResponse>('/api/v1/me', { authenticated: true });
    },

    profile() {
      return client.get<ProfileResponse>('/api/v1/me/profile', {
        authenticated: true,
      });
    },

    updateProfile(body: UpdateProfileRequest) {
      return client.patch<ProfileResponse>('/api/v1/me/profile', body, {
        authenticated: true,
      });
    },

    completion() {
      return client.get<ProfileCompletionResponse>(
        '/api/v1/me/profile/completion',
        { authenticated: true }
      );
    },

    usernameAvailability(username: string) {
      const q = new URLSearchParams({ username });
      return client.get<UsernameAvailabilityResponse>(
        `/api/v1/usernames/availability?${q}`,
        { authenticated: true }
      );
    },

    settings() {
      return client.get<SettingsResponse>('/api/v1/me/settings', {
        authenticated: true,
      });
    },

    updateSettings(body: UpdateSettingsRequest) {
      return client.patch<SettingsResponse>('/api/v1/me/settings', body, {
        authenticated: true,
      });
    },
  };
}

export type ProfileApi = ReturnType<typeof createProfileApi>;
