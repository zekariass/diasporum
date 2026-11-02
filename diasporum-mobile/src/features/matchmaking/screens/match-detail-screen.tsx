import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { ErrorState } from '@/shared/components/error-state';
import { PrimaryButton } from '@/shared/components/primary-button';
import { MatchedBadge } from '@/shared/components/matched-badge';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/shared/theme/spacing';
import { ProfileDetails } from '../components/candidate-profile';
import { ScreenHeader, Section } from '../components/matchmaking-ui';
import { useMatchmakingApi } from '../hooks/use-matchmaking-api';
import { matchmakingError } from '../services/matchmaking-errors';
import type { MatchView, MatchmakingReferenceData } from '../types/matchmaking-types';

const REPORT_REASONS = ['SPAM', 'SCAM', 'HARASSMENT', 'HATE', 'SEXUAL_MISCONDUCT', 'IMPERSONATION', 'PRIVACY', 'OTHER'] as const;

export default function MatchDetailScreen() {
  const theme = useTheme();
  const api = useMatchmakingApi();
  const params = useLocalSearchParams<{ matchId: string }>();
  const matchId = String(params.matchId);
  const [match, setMatch] = useState<MatchView | null>(null);
  const [references, setReferences] = useState<MatchmakingReferenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const actingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detail, referenceData] = await Promise.all([
        api.match(matchId), api.referenceData().catch(() => null),
      ]);
      setMatch(detail);
      setReferences(referenceData);
    } catch (loadError) {
      setError(matchmakingError(loadError, 'This match is unavailable.'));
    } finally {
      setLoading(false);
    }
  }, [api, matchId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const run = async (operation: () => Promise<void>) => {
    if (actingRef.current) return;
    actingRef.current = true;
    setActing(true);
    setError(null);
    try {
      await operation();
    } catch (actionError) {
      setError(matchmakingError(actionError, 'The requested action could not be completed.'));
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  };

  const unmatch = () => {
    if (!match) return;
    Alert.alert('Unmatch?', 'This removes the active match. Your friendship, ordinary conversation, and message history are preserved.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unmatch', style: 'destructive', onPress: () => void run(async () => {
        setMatch(await api.unmatch(match.id));
      }) },
    ]);
  };
  const block = () => {
    if (!match) return;
    Alert.alert('Block this member?', 'Blocking is a safety action. It closes the match and conversation and removes friendship. Unblocking does not restore them.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: () => void run(async () => {
        await api.block(match.other.userId);
        router.replace('/(app)/matchmaking/matches' as never);
      }) },
    ]);
  };
  const report = () => {
    if (!match) return;
    Alert.alert('Report match', 'Choose a reason. The reported member will not see your reporter identity.', [
      ...REPORT_REASONS.map(reason => ({ text: reason.replaceAll('_', ' '),
        onPress: () => void run(async () => { await api.reportMatch(match.id, reason); }) })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title="Match details" />
        {loading ? <ActivityIndicator style={styles.loader} color={theme.primary} /> :
          error && !match ? <ErrorState message={error} onRetry={() => void load()} /> : match ? (
          <ScrollView contentContainerStyle={styles.content}>
            {match.status === 'MATCHED' ? <MatchedBadge /> : null}
            <ThemedText themeColor="textSecondary">
              {match.status === 'MATCHED' ? `Matched ${new Date(match.matchedAt).toLocaleDateString()}` : `Match status: ${match.status}`}
            </ThemedText>
            <ProfileDetails profile={match.other} references={references} />
            {match.status !== 'MATCHED' ? (
              <ThemedText themeColor="textSecondary">
                The match is no longer active. Friendship and ordinary chat history are not deleted by unmatching.
              </ThemedText>
            ) : null}
            <Section title="Conversation and safety">
              {match.conversationId ? <PrimaryButton label="Open chat" onPress={() =>
                router.push(`/(app)/messages/${match.conversationId}` as never)} /> : null}
              {match.status === 'MATCHED' ? <PrimaryButton label="Unmatch" variant="secondary"
                disabled={acting} loading={acting} onPress={unmatch} /> : null}
              <PrimaryButton label="Report match" variant="ghost" disabled={acting} onPress={report} />
              <PrimaryButton label="Block member" variant="danger" disabled={acting} onPress={block} />
            </Section>
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
});
