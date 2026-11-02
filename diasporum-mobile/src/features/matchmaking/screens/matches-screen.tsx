import React, { useCallback } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { ErrorState } from '@/shared/components/error-state';
import { PrimaryButton } from '@/shared/components/primary-button';
import { MatchedBadge } from '@/shared/components/matched-badge';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/shared/theme/spacing';
import { CandidateCard } from '../components/candidate-profile';
import { EmptyState, ScreenHeader } from '../components/matchmaking-ui';
import { useMatchmakingApi } from '../hooks/use-matchmaking-api';
import { usePagedMatchmaking } from '../hooks/use-paged-matchmaking';
import type { MatchView } from '../types/matchmaking-types';

const matchId = (match: MatchView) => match.id;

export default function MatchesScreen() {
  const theme = useTheme();
  const api = useMatchmakingApi();
  const fetcher = useCallback((cursor?: string) => api.matches(cursor), [api]);
  const page = usePagedMatchmaking(fetcher, matchId, 'Your matches could not be loaded.');

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title="Your matches" subtitle="Active mutual matches and their conversations" />
        {page.loading ? <ActivityIndicator style={styles.loader} color={theme.primary} /> :
          page.error && page.items.length === 0 ? <ErrorState message={page.error} onRetry={page.refresh} /> : (
          <FlatList data={page.items} keyExtractor={item => item.id}
            contentContainerStyle={[styles.list, page.items.length === 0 && styles.emptyList]}
            renderItem={({ item }) => (
              <View style={[styles.match, { backgroundColor: theme.backgroundElement }]}>
                <CandidateCard profile={item.other} onPress={() =>
                  router.push(`/(app)/matchmaking/matches/${item.id}` as never)} />
                <View style={styles.meta}>
                  <MatchedBadge compact />
                  <ThemedText type="small" themeColor="textSecondary">
                    Matched {new Date(item.matchedAt).toLocaleDateString()}
                  </ThemedText>
                </View>
                {item.conversationId ? <PrimaryButton label="Open chat" variant="secondary" onPress={() =>
                  router.push(`/(app)/messages/${item.conversationId}` as never)} /> : null}
              </View>
            )}
            refreshControl={<RefreshControl refreshing={page.refreshing} onRefresh={page.refresh}
              tintColor={theme.primary} />}
            onEndReached={page.loadMore} onEndReachedThreshold={0.35}
            ListEmptyComponent={<EmptyState title="No active matches yet"
              body="When a like becomes mutual, the match and its ordinary conversation will appear here."
              action={<PrimaryButton label="Discover people" onPress={() =>
                router.push('/(app)/matchmaking' as never)} />} />}
            ListFooterComponent={<View style={styles.footer}>
              {page.loadingMore ? <ActivityIndicator color={theme.primary} /> : null}
              {page.error ? <ThemedText themeColor="error">{page.error}</ThemedText> : null}
            </View>} />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loader: { marginTop: Spacing.six },
  list: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.six },
  emptyList: { flexGrow: 1 },
  match: { borderRadius: 18, padding: Spacing.two, gap: Spacing.two },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.two },
  footer: { alignItems: 'center', gap: Spacing.two, padding: Spacing.two },
});
