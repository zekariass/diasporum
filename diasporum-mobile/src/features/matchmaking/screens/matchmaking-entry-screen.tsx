import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ThemedView } from '@/components/themed-view';
import { ErrorState } from '@/shared/components/error-state';
import { LoadingScreen } from '@/shared/components/loading-screen';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/shared/theme/spacing';
import { ScreenHeader } from '../components/matchmaking-ui';
import { useMatchmakingApi } from '../hooks/use-matchmaking-api';
import { isMissingResource, matchmakingError } from '../services/matchmaking-errors';
import type { MatchmakingStatus } from '../types/matchmaking-types';
import DiscoveryScreen from './discovery-screen';

export default function MatchmakingEntryScreen() {
  const theme = useTheme();
  const api = useMatchmakingApi();
  const [status, setStatus] = useState<MatchmakingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profile = await api.profile();
      setStatus(profile.status);
    } catch (loadError) {
      if (isMissingResource(loadError)) {
        setStatus('DRAFT');
      } else {
        setError(matchmakingError(loadError, 'Matchmaking status could not be loaded.'));
      }
    } finally {
      setLoading(false);
    }
  }, [api]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (loading || error || status === 'ACTIVE') return;
    if (status === 'DRAFT') router.replace('/(app)/matchmaking/setup' as never);
    else if (status) router.replace('/(app)/matchmaking/profile' as never);
  }, [error, loading, status]);

  if (status === 'ACTIVE' && !loading && !error) return <DiscoveryScreen />;
  if (loading) return <LoadingScreen />;
  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title="Matchmaking" />
        {error ? <ErrorState message={error} onRetry={() => void load()} /> :
          <ActivityIndicator style={styles.loader} color={theme.primary} />}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loader: { marginTop: Spacing.six },
});
