/**
 * Session domain types — the resolved application state for an authenticated user.
 *
 * The backend is the source of truth. These types mirror the API DTOs and are
 * never used to override backend decisions — only to cache them locally for
 * the current session.
 */

import type { ProfileResponse } from '@/features/profile/types/profile-types';
import type { AccountMe } from '@/core/auth/auth-types';
import type { MembershipView } from '@/features/communities/types/community-types';

/** Ordered onboarding steps. 'main-app' means onboarding is complete. */
export type OnboardingStep =
  | 'country-origin'
  | 'country-current'
  | 'community-preview'
  | 'profile'
  | 'complete'
  | 'main-app';

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  'country-origin',
  'country-current',
  'community-preview',
  'profile',
  'complete',
  'main-app',
];

/**
 * Resolved session snapshot — everything the app needs to determine the
 * correct destination for an authenticated user.
 */
export interface SessionState {
  /** Account-level identity — always present when authenticated. */
  readonly me: AccountMe;
  /** null when the account has no profile yet (v10.12: profiles are optional). */
  readonly profile: ProfileResponse | null;
  readonly memberships: MembershipView[];
  readonly activeCommunityId: string | null;
}

/**
 * Resolves the correct onboarding destination for the current session state.
 * This is the single authoritative routing decision — never duplicate this
 * logic inside individual screens.
 *
 * Flow mirrors the approved design: origin → current country → community
 * preview → complete profile → completion ("You're in") → main app.
 * The community preview is informational; membership is only created on the
 * completion screen via POST /me/onboarding/complete.
 */
export function resolveOnboardingStep(state: SessionState): OnboardingStep {
  if (!state.profile || !state.profile.originCountryId) return 'country-origin';
  if (!state.profile.currentCountryId) return 'country-current';
  const profileDone =
    state.profile.displayName != null &&
    state.profile.username != null &&
    state.profile.profileCompleted;
  if (!profileDone) {
    // Informational preview → routes forward to the profile step.
    return 'community-preview';
  }
  const hasCommunity =
    state.memberships.length > 0 && state.activeCommunityId != null;
  // Completion screen creates the membership via POST /me/onboarding/complete.
  return hasCommunity ? 'main-app' : 'complete';
}
