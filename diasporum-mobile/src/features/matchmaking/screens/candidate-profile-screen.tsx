import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { ErrorState } from '@/shared/components/error-state';
import { PrimaryButton } from '@/shared/components/primary-button';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/shared/theme/spacing';
import { ProfileDetails } from '../components/candidate-profile';
import { ScreenHeader } from '../components/matchmaking-ui';
import { useMatchmakingApi } from '../hooks/use-matchmaking-api';
import { matchmakingError } from '../services/matchmaking-errors';
import type {
  MatchmakingReferenceData, PublicMatchmakingProfile, SwipeAction, SwipeResult,
} from '../types/matchmaking-types';

export default function CandidateProfileScreen() {
  const theme = useTheme();
  const api = useMatchmakingApi();
  const params = useLocalSearchParams<{ userId: string }>();
  const userId = String(params.userId);
  const [profile, setProfile] = useState<PublicMatchmakingProfile | null>(null);
  const [references, setReferences] = useState<MatchmakingReferenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const actingRef = useRef(false);
  const [liked, setLiked] = useState(false);
  const [match, setMatch] = useState<SwipeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [candidate, referenceData] = await Promise.all([
        api.candidate(userId), api.referenceData().catch(() => null),
      ]);
      setProfile(candidate);
      setReferences(referenceData);
    } catch (loadError) {
      setError(matchmakingError(loadError, 'This Matchmaking profile is unavailable.'));
    } finally {
      setLoading(false);
    }
  }, [api, userId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const swipe = async (action: SwipeAction) => {
    if (!profile || actingRef.current) return;
    actingRef.current = true;
    setActing(true);
    setError(null);
    try {
      const result = await api.swipe(profile.userId, action);
      if (result.matched) setMatch(result);
      else if (action === 'LIKE') setLiked(true);
      else router.back();
    } catch (swipeError) {
      setError(matchmakingError(swipeError, 'Your decision could not be recorded.'));
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  };
  const cancel = async () => {
    if (!profile || actingRef.current) return;
    actingRef.current = true;
    setActing(true);
    try {
      await api.cancelLike(profile.userId);
      setLiked(false);
    } catch (cancelError) {
      setError(matchmakingError(cancelError, 'The like could not be cancelled.'));
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title="Matchmaking profile" />
        {loading ? <ActivityIndicator style={styles.loader} color={theme.primary} /> :
          error && !profile ? <ErrorState message={error} onRetry={() => void load()} /> : profile ? (
          <ScrollView contentContainerStyle={styles.content}>
            <ProfileDetails profile={profile} references={references} />
            {match ? (
              <View style={styles.actions}>
                <ThemedText type="subtitle">It is a mutual match</ThemedText>
                {match.conversationId ? <PrimaryButton label="Open chat" onPress={() =>
                  router.replace(`/(app)/messages/${match.conversationId}` as never)} /> : null}
                {match.matchId ? <PrimaryButton label="View match" variant="secondary" onPress={() =>
                  router.replace(`/(app)/matchmaking/matches/${match.matchId}` as never)} /> : null}
              </View>
            ) : (
              <View style={styles.actions}>
                {liked ? <PrimaryButton label="Cancel like" variant="secondary" loading={acting}
                  onPress={() => void cancel()} /> : (
                  <>
                    <PrimaryButton label="Pass" variant="secondary" disabled={acting}
                      onPress={() => void swipe('PASS')} />
                    <PrimaryButton label="Like" loading={acting} disabled={acting}
                      onPress={() => void swipe('LIKE')} />
                  </>
                )}
              </View>
            )}
            {error ? <ThemedText themeColor="error" accessibilityRole="alert">{error}</ThemedText> : null}
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loader: { marginTop: Spacing.six },
  content: { padding: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  actions: { gap: Spacing.three },
});
