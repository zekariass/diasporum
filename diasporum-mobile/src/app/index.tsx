/**
 * Root index — resolves the correct initial destination based on
 * auth state and backend onboarding state.
 */

import { Redirect } from 'expo-router';

import { useAuth } from '@/core/auth/auth-provider';
import { useSession } from '@/core/session/session-provider';
import { LoadingScreen } from '@/shared/components/loading-screen';
import { ErrorState } from '@/shared/components/error-state';
import { STEP_ROUTES } from '@/features/onboarding/hooks/use-onboarding';

export default function Index() {
  const { authState } = useAuth();
  const { session, isLoading, error, onboardingStep, refresh } = useSession();

  if (authState.status === 'loading' || (authState.status === 'authenticated' && isLoading)) {
    return <LoadingScreen message="Restoring your session…" />;
  }

  if (authState.status === 'unauthenticated') {
    return <Redirect href={"/(auth)/welcome" as never} />;
  }

  if (error && !session) {
    return <ErrorState message={error} onRetry={refresh} />;
  }

  if (!session) {
    return <LoadingScreen />;
  }

  return <Redirect href={STEP_ROUTES[onboardingStep] as never} />;
}
