/**
 * Unauthenticated route group layout.
 * Authenticated users are redirected away from this group.
 */

import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/core/auth/auth-provider';
import { LoadingScreen } from '@/shared/components/loading-screen';

export default function AuthLayout() {
  const { authState } = useAuth();

  if (authState.status === 'loading') {
    return <LoadingScreen />;
  }

  if (authState.status === 'authenticated') {
    return <Redirect href={"/(app)/(tabs)" as never} />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
