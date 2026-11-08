/**
 * Identity API service — own-profile read, patch, completion, settings,
 * username availability.
 */

import type { ApiClient } from "@/core/api/api-client";
import type {
  MeResponse,
  ProfileResponse,
  UpdateProfileRequest,
  ProfileCompletionResponse,
  UsernameAvailabilityResponse,
  SettingsResponse,
  UpdateSettingsRequest,
} from "@/features/profile/types/profile-types";

export interface ProfileCompatibility {
  interestIds: string[];
  languageIds: string[];
  interests: { id: string; label: string }[];
  languages: { id: string; label: string }[];
  hasDiscoveryLocation: boolean;
}

export function createProfileApi(client: ApiClient) {
  return {
    compatibility: () =>
      client.get<ProfileCompatibility>("/api/v1/me/profile/compatibility", {
        authenticated: true,
      }),
    saveCompatibility: (interestIds: string[], languageIds: string[]) =>
      client.put<ProfileCompatibility>(
        "/api/v1/me/profile/compatibility",
        { interestIds, languageIds },
        { authenticated: true },
      ),
    saveDiscoveryLocation: (latitude: number, longitude: number) =>
      client.put(
        "/api/v1/me/profile/discovery-location",
        { latitude, longitude, consent: true },
        { authenticated: true },
      ),
    removeDiscoveryLocation: () =>
      client.delete("/api/v1/me/profile/discovery-location", {
        authenticated: true,
      }),
    confirmAge: () =>
      client.post(
        "/api/v1/me/profile/age-confirmation",
        { confirmed: true },
        { authenticated: true },
      ),
    me() {
      return client.get<MeResponse>("/api/v1/me", { authenticated: true });
    },

    profile() {
      return client.get<ProfileResponse>("/api/v1/me/profile", {
        authenticated: true,
      });
    },

    updateProfile(body: UpdateProfileRequest) {
      return client.patch<ProfileResponse>("/api/v1/me/profile", body, {
        authenticated: true,
      });
    },

    completion() {
      return client.get<ProfileCompletionResponse>(
        "/api/v1/me/profile/completion",
        { authenticated: true },
      );
    },

    usernameAvailability(username: string) {
      const q = new URLSearchParams({ username });
      return client.get<UsernameAvailabilityResponse>(
        `/api/v1/usernames/availability?${q}`,
        { authenticated: true },
      );
    },

    settings() {
      return client.get<SettingsResponse>("/api/v1/me/settings", {
        authenticated: true,
      });
    },

    updateSettings(body: UpdateSettingsRequest) {
      return client.patch<SettingsResponse>("/api/v1/me/settings", body, {
        authenticated: true,
      });
    },
  };
}

export type ProfileApi = ReturnType<typeof createProfileApi>;
