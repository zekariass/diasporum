/**
 * Identity API types — mirrors backend DTOs.
 * Do not rename fields; these map directly to the backend contract.
 */

/** GET /api/v1/me */
export interface MeResponse {
  readonly id: string;
  readonly displayName: string | null;
  readonly accountStatus: string;
  readonly profileCompleted: boolean;
}

/** GET /api/v1/me/profile */
export interface ProfileResponse {
  readonly id: string;
  readonly username: string | null;
  readonly displayName: string | null;
  readonly bio: string | null;
  readonly city: string | null;
  readonly dateOfBirth: string | null; // ISO date YYYY-MM-DD
  readonly originCountryId: string | null;
  readonly currentCountryId: string | null;
  readonly accountStatus: string;
  readonly profileCompleted: boolean;
  readonly avatarMediaId: string | null;
}

/** PATCH /api/v1/me/profile — whitelist only; all fields optional */
export interface UpdateProfileRequest {
  username?: string;
  displayName?: string;
  bio?: string;
  city?: string;
  dateOfBirth?: string;
  originCountryId?: string;
  currentCountryId?: string;
  /** Completed AVATAR media asset to link as the profile photo. */
  avatarMediaId?: string;
}

/** GET /api/v1/me/profile/completion */
export interface ProfileCompletionResponse {
  readonly complete: boolean;
  readonly missing: string[];
}

/** GET /api/v1/usernames/availability?username= */
export interface UsernameAvailabilityResponse {
  readonly username: string;
  readonly available: boolean;
  readonly reason: 'INVALID_FORMAT' | 'RESERVED' | 'AVAILABLE' | 'TAKEN';
}

/** GET /api/v1/me/settings */
export interface SettingsResponse {
  readonly defaultCommunityId: string | null;
  readonly activeCommunityId: string | null;
  readonly preferredLanguageCode: string | null;
  readonly theme: string;
}

/** PATCH /api/v1/me/settings — whitelist only */
export interface UpdateSettingsRequest {
  theme?: string;
  preferredLanguageCode?: string;
  activeCommunityId?: string;
  defaultCommunityId?: string;
}
