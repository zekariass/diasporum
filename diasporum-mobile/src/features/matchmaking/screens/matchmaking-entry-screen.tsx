import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ThemedView } from '@/components/themed-view';
import { ErrorState } from '@/shared/components/error-state';
import { LoadingScreen } from '@/shared/components/loading-screen';
import { ScreenHeader } from '../components/matchmaking-ui';
import { useMatchmakingEligibility } from '../hooks/use-matchmaking-eligibility';
import DatingDobScreen from './dob-screen';
import DatingIntroScreen from './dating-intro-screen';
import DatingStatusScreen from './dating-status-screen';
import DiscoveryScreen from './discovery-screen';

/**
 * Dating entry router — the backend `/eligibility` read decides which experience
 * applies: intro (no profile), setup redirect (incomplete), a restricted-status
 * screen, or discovery (eligible). Discovery itself is enforced server-side, so
 * navigation and deep links cannot bypass these checks.
 */
export default function MatchmakingEntryScreen() {
  const { eligibility, loading, error, refresh } = useMatchmakingEligibility();

  useEffect(() => {
    if (eligibility?.reason === 'PROFILE_INCOMPLETE') {
      router.replace('/(app)/matchmaking/setup' as never);
    }
  }, [eligibility?.reason]);

  if (loading || (!eligibility && !error)) return <LoadingScreen message="Opening Dating" />;
  if (error || !eligibility) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
          <ScreenHeader title="Dating" />
          <ErrorState message={error ?? 'Dating status could not be loaded.'}
            onRetry={() => void refresh()} />
        </SafeAreaView>
      </ThemedView>
    );
  }
  if (eligibility.eligible) return <DiscoveryScreen />;
  // No stored DOB → collect it before anything else; saving refreshes
  // eligibility and the backend resolves the next step (18+ vs under-18).
  if (eligibility.reason === 'DOB_REQUIRED') {
    return <DatingDobScreen onSaved={() => void refresh()} />;
  }
  if (eligibility.reason === 'NO_PROFILE') return <DatingIntroScreen />;
  // PROFILE_INCOMPLETE redirects to setup in the effect above.
  if (eligibility.reason === 'PROFILE_INCOMPLETE') return <LoadingScreen />;
  return <DatingStatusScreen eligibility={eligibility} onChanged={() => void refresh()} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
