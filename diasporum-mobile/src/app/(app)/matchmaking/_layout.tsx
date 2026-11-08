import { Stack } from 'expo-router';

/**
 * Dating section layout — groups the matchmaking routes so the feature has its
 * own navigation experience. Eligibility is enforced by the backend on every
 * endpoint and by the entry screen at `/matchmaking`.
 */
export default function MatchmakingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="preferences"
        options={{ animation: 'slide_from_bottom' }}
      />
    </Stack>
  );
}
