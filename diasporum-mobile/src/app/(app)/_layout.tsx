/**
 * Authenticated route group layout.
 * Guards: must be authenticated AND fully onboarded.
 * Unauthenticated → login. Onboarding incomplete → onboarding flow.
 */

import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/core/auth/auth-provider';
import { useSession } from '@/core/session/session-provider';
import { LoadingScreen } from '@/shared/components/loading-screen';
import { ErrorState } from '@/shared/components/error-state';

export default function AppLayout() {
  const { authState } = useAuth();
  const { session, isLoading, error, onboardingStep, refresh } = useSession();

  if (authState.status === 'loading' || isLoading) {
    return <LoadingScreen />;
  }

  if (authState.status === 'unauthenticated') {
    return <Redirect href="/(auth)/login" />;
  }

  if (error && !session) {
    return <ErrorState message={error} onRetry={refresh} />;
  }

  if (onboardingStep !== 'main-app') {
    return <Redirect href={`/(onboarding)/${onboardingStep}` as never} />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}
