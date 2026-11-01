import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider } from '@/core/auth/auth-provider';
import { SessionProvider } from '@/core/session/session-provider';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider>
          <AnimatedSplashOverlay />
          <Stack
            screenOptions={{
              headerShown: false,
              animation: colorScheme === 'dark' ? 'fade' : 'fade',
            }}
          />
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
