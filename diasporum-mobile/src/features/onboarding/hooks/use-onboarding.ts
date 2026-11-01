/**
 * Onboarding navigation hook — wraps SessionContext with step helpers.
 * Each screen explicitly navigates to its next step after its API calls succeed.
 * The layout guard in (onboarding)/_layout.tsx handles the main-app boundary.
 * Never navigate directly from the resolver — always call refresh() first,
 * then navigate to the explicit next step for the current screen.
 */

import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { safeBack } from '@/core/navigation/safe-back';

import { useSession } from '@/core/session/session-provider';
import type { OnboardingStep } from '@/core/session/session-types';

export const STEP_ROUTES: Record<OnboardingStep, `/${string}`> = {
  'country-origin': '/(onboarding)/country-origin',
  'country-current': '/(onboarding)/country-current',
  'community-preview': '/(onboarding)/community-preview',
  profile: '/(onboarding)/profile',
  complete: '/(onboarding)/complete',
  'main-app': '/(app)/(tabs)',
};

export function useOnboarding() {
  const router = useRouter();
  const session = useSession();

  /**
   * Refresh state and navigate to the next onboarding step.
   * The next step is always explicit — the caller knows the ordered flow.
   * If onboarding is now complete, the layout guard in (onboarding)/_layout.tsx
   * intercepts the navigation and redirects to (app)/(tabs).
   */
  const advance = useCallback(
    async (nextStep: OnboardingStep) => {
      await session.refresh();
      if (nextStep === 'main-app') {
        router.replace(STEP_ROUTES['main-app'] as never);
      } else {
        router.push(STEP_ROUTES[nextStep] as never);
      }
    },
    [session, router]
  );

  const goBack = useCallback(() => safeBack(), []);

  return {
    session: session.session,
    isLoading: session.isLoading,
    error: session.error,
    onboardingStep: session.onboardingStep,
    advance,
    goBack,
    updateProfile: session.updateProfile,
    joinCommunity: session.joinCommunity,
    setActiveCommunity: session.setActiveCommunity,
    updatePreferredLanguage: session.updatePreferredLanguage,
    completeOnboarding: session.completeOnboarding,
  };
}
