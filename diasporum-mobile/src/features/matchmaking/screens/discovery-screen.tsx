import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { ErrorState } from '@/shared/components/error-state';
import { PrimaryButton } from '@/shared/components/primary-button';
import { MatchedBadge } from '@/shared/components/matched-badge';
import { useTheme } from '@/hooks/use-theme';
import { BorderRadius, Spacing } from '@/shared/theme/spacing';
import { CandidateCard } from '../components/candidate-profile';
import { EmptyState, ScreenHeader } from '../components/matchmaking-ui';
import { useMatchmakingApi } from '../hooks/use-matchmaking-api';
import { usePagedMatchmaking } from '../hooks/use-paged-matchmaking';
import { matchmakingError } from '../services/matchmaking-errors';
import type { PublicMatchmakingProfile, SwipeAction, SwipeResult } from '../types/matchmaking-types';

const profileId = (profile: PublicMatchmakingProfile) => profile.userId;

export default function DiscoveryScreen() {
  const theme = useTheme();
  const api = useMatchmakingApi();
  const [tab, setTab] = useState<'discover' | 'received'>('discover');
  const fetcher = useCallback((cursor?: string) =>
    tab === 'discover' ? api.discover(cursor) : api.receivedLikes(cursor), [api, tab]);
  const page = usePagedMatchmaking(fetcher, profileId, 'Matchmaking profiles could not be loaded.');
  const actingRef = useRef<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastLike, setLastLike] = useState<PublicMatchmakingProfile | null>(null);
  const [match, setMatch] = useState<SwipeResult | null>(null);

  const swipe = async (profile: PublicMatchmakingProfile, action: SwipeAction) => {
    if (actingRef.current) return;
    actingRef.current = profile.userId;
    setActing(profile.userId);
    setActionError(null);
    try {
      const result = await api.swipe(profile.userId, action);
      page.remove(profile.userId);
      if (result.matched) {
        setMatch(result);
        setLastLike(null);
      } else if (action === 'LIKE') {
        setLastLike(profile);
      }
    } catch (error) {
      setActionError(matchmakingError(error, `${action === 'LIKE' ? 'Like' : 'Pass'} could not be recorded.`));
    } finally {
      actingRef.current = null;
      setActing(null);
    }
  };
  const rewind = async () => {
    if (actingRef.current) return;
    actingRef.current = 'rewind';
    setActing('rewind');
    setActionError(null);
    try {
      await api.rewind();
      setLastLike(null);
      page.refresh();
    } catch (error) {
      setActionError(matchmakingError(error, 'There is no eligible swipe to rewind.'));
    } finally {
      actingRef.current = null;
      setActing(null);
    }
  };
  const cancelLike = async () => {
    if (!lastLike || actingRef.current) return;
    actingRef.current = lastLike.userId;
    setActing(lastLike.userId);
    setActionError(null);
    try {
      await api.cancelLike(lastLike.userId);
      setLastLike(null);
      page.refresh();
    } catch (error) {
      setActionError(matchmakingError(error, 'The like could not be cancelled.'));
    } finally {
      actingRef.current = null;
      setActing(null);
    }
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title="Matchmaking" subtitle="Reciprocal preferences, privacy-safe discovery"
          action={<View style={styles.headerActions}>
            <Pressable onPress={() => router.push('/(app)/matchmaking/matches' as never)}
              accessibilityRole="button" accessibilityLabel="View matches" hitSlop={8}>
              <Ionicons name="heart-outline" size={25} color={theme.primary} />
            </Pressable>
            <Pressable onPress={() => router.push('/(app)/matchmaking/profile' as never)}
              accessibilityRole="button" accessibilityLabel="Manage Matchmaking profile" hitSlop={8}>
              <Ionicons name="person-circle-outline" size={27} color={theme.primary} />
            </Pressable>
          </View>} />
        <View style={[styles.tabs, { borderBottomColor: theme.border }]}>
          {(['discover', 'received'] as const).map(item => (
            <Pressable key={item} onPress={() => { setTab(item); setActionError(null); }}
              style={[styles.tab, tab === item && { borderBottomColor: theme.primary }]}
              accessibilityRole="button" accessibilityState={{ selected: tab === item }}>
              <ThemedText style={[styles.tabText, tab === item && { color: theme.primary }]}>
                {item === 'discover' ? 'Discover' : 'Likes received'}
              </ThemedText>
            </Pressable>
          ))}
        </View>
        {match ? (
          <View style={[styles.matchCard, { backgroundColor: theme.primarySurface }]}>
            <MatchedBadge />
            <ThemedText type="subtitle">You have a new mutual match</ThemedText>
            <View style={styles.matchActions}>
              {match.conversationId ? <PrimaryButton label="Open chat" onPress={() => {
                setMatch(null);
                router.push(`/(app)/messages/${match.conversationId}` as never);
              }} /> : null}
              {match.matchId ? <PrimaryButton label="View match" variant="secondary" onPress={() => {
                setMatch(null);
                router.push(`/(app)/matchmaking/matches/${match.matchId}` as never);
              }} /> : null}
              <PrimaryButton label="Keep discovering" variant="ghost" onPress={() => setMatch(null)} />
            </View>
          </View>
        ) : null}
        {lastLike && !match ? (
          <View style={[styles.sentCard, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText style={styles.sentText}>Like sent to {lastLike.displayName}</ThemedText>
            <PrimaryButton label="Cancel like" variant="ghost" loading={acting === lastLike.userId}
              onPress={() => void cancelLike()} />
          </View>
        ) : null}
        {actionError || page.error ? (
          <ThemedText style={styles.error} themeColor="error" accessibilityRole="alert">
            {actionError ?? page.error}
          </ThemedText>
        ) : null}
        {page.loading ? <ActivityIndicator style={styles.loader} color={theme.primary} /> :
          page.error && page.items.length === 0 ? <ErrorState message={page.error} onRetry={page.refresh} /> : (
          <FlatList
            data={page.items}
            keyExtractor={item => item.userId}
            contentContainerStyle={[styles.list, page.items.length === 0 && styles.emptyList]}
            renderItem={({ item }) => (
              <View style={styles.candidate}>
                <CandidateCard profile={item} />
                <View style={styles.swipeActions}>
                  <PrimaryButton label="Pass" variant="secondary" disabled={acting !== null}
                    onPress={() => void swipe(item, 'PASS')} />
                  <PrimaryButton label={tab === 'received' ? 'Like back' : 'Like'} disabled={acting !== null}
                    loading={acting === item.userId} onPress={() => void swipe(item, 'LIKE')} />
                </View>
              </View>
            )}
            refreshControl={<RefreshControl refreshing={page.refreshing} onRefresh={page.refresh}
              tintColor={theme.primary} />}
            onEndReached={page.loadMore}
            onEndReachedThreshold={0.35}
            ListHeaderComponent={page.items.length > 0 ? (
              <PrimaryButton label="Rewind latest swipe" variant="ghost" loading={acting === 'rewind'}
                disabled={acting !== null} onPress={() => void rewind()} />
            ) : undefined}
            ListEmptyComponent={<EmptyState
              title={tab === 'discover' ? 'No compatible profiles right now' : 'No received likes yet'}
              body={tab === 'discover'
                ? 'Check back later or review your preferences. Your latest eligible swipe can be rewound.'
                : 'Incoming active likes from compatible members will appear here.'}
              action={tab === 'discover' ? <PrimaryButton label="Review preferences" variant="secondary"
                onPress={() => router.push('/(app)/matchmaking/preferences' as never)} /> : undefined} />}
            ListFooterComponent={page.loadingMore ? <ActivityIndicator color={theme.primary} /> : undefined}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: 'center', paddingVertical: Spacing.three, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontSize: 14, fontWeight: '700' },
  matchCard: { margin: Spacing.three, borderRadius: BorderRadius.lg, padding: Spacing.three, gap: Spacing.two },
  matchActions: { gap: Spacing.two },
  sentCard: { flexDirection: 'row', alignItems: 'center', marginHorizontal: Spacing.three,
    borderRadius: BorderRadius.lg, paddingLeft: Spacing.three },
  sentText: { flex: 1, fontSize: 13 },
  error: { marginHorizontal: Spacing.four, marginVertical: Spacing.two, textAlign: 'center' },
  loader: { marginTop: Spacing.six },
  list: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.six },
  emptyList: { flexGrow: 1 },
  candidate: { gap: Spacing.two, marginBottom: Spacing.four },
  swipeActions: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.three },
});
