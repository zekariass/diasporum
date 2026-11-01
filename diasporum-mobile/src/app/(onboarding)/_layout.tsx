/**
 * Onboarding route group layout.
 * Guards: must be authenticated AND not yet fully onboarded.
 * If onboarding is complete, redirects to the main app tabs.
 * If unauthenticated, redirects to login.
 */

import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/core/auth/auth-provider';
import { useSession } from '@/core/session/session-provider';
import { LoadingScreen } from '@/shared/components/loading-screen';
import { ErrorState } from '@/shared/components/error-state';

export default function OnboardingLayout() {
  const { authState } = useAuth();
  const { session, isLoading, error, onboardingStep, refresh } = useSession();

  if (authState.status === 'loading' || isLoading) {
    return <LoadingScreen message="Setting things up…" />;
  }

  if (authState.status === 'unauthenticated') {
    return <Redirect href="/(auth)/login" />;
  }

  if (error && !session) {
    return <ErrorState message={error} onRetry={refresh} />;
  }

  if (onboardingStep === 'main-app') {
    return <Redirect href="/(app)/(tabs)" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        gestureEnabled: false,
      }}
    />
  );
}
