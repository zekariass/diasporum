/**
 * MyEventsScreen — events the user created/manages or participates in.
 * Route: /(app)/events/my
 * Organized tab includes drafts (publishable from the detail screen).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { safeBack } from '@/core/navigation/safe-back';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useSession } from '@/core/session/session-provider';
import { createEventApi } from '../services/event-api';
import { BrandColors } from '@/shared/theme/colors';
import { Spacing } from '@/shared/theme/spacing';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/core/api/api-error';
import type { EventItem } from '../types/event-types';
import { EventCard } from '../components/event-card';
import { EventsEmpty, EventsSkeleton } from '../components/event-states';

const PAGE_SIZE = 20;
type Role = 'organized' | 'participating';

export default function MyEventsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient } = useSession();
  const eventApi = React.useMemo(() => createEventApi(apiClient), [apiClient]);

  const [role, setRole] = useState<Role>('organized');
  const [items, setItems] = useState<EventItem[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const r = await eventApi.myEvents(role, 0, PAGE_SIZE);
      setItems(r.items);
      setPage(0);
      setHasMore(r.items.length === PAGE_SIZE);
      setError(null);
    } catch (e) {
      setError(ApiError.isApiError(e) ? e.userMessage : 'Failed to load your events.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [eventApi, role]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setLoading(true); void load(); }, [load]);

  const refresh = useCallback(() => { setRefreshing(true); void load(); }, [load]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const r = await eventApi.myEvents(role, next, PAGE_SIZE);
      setItems(prev => [...prev, ...r.items.filter(i => !prev.some(p => p.event.id === i.event.id))]);
      setPage(next);
      setHasMore(r.items.length === PAGE_SIZE);
    } catch { /* pull-to-refresh retries */ }
    finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, page, role, eventApi]);

  const openDetail = useCallback(
    (eventId: string) => router.push(`/(app)/events/${eventId}` as never),
    [router],
  );

  return (
    <ThemedView style={s.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={s.safeArea} edges={['top', 'left', 'right']}>
        <View style={[s.header, { borderBottomColor: theme.border }]}>
          <Pressable onPress={safeBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={24} color={theme.text} />
          </Pressable>
          <ThemedText type="title" style={s.headerTitle}>My events</ThemedText>
          <View style={s.headerSpacer} />
        </View>

        {/* Role tabs */}
        <View style={[s.tabBar, { borderBottomColor: theme.border }]}>
          {(['organized', 'participating'] as Role[]).map(r => (
            <Pressable
              key={r}
              onPress={() => setRole(r)}
              accessibilityRole="tab"
              accessibilityLabel={r === 'organized' ? 'Events you organize' : 'Events you attend'}
              accessibilityState={{ selected: role === r }}
              style={s.tabBtn}
            >
              <ThemedText style={[s.tabLabel, role === r && { color: BrandColors.primary, fontWeight: '700' }]}>
                {r === 'organized' ? 'Organizing' : 'Attending'}
              </ThemedText>
              {role === r && <View style={[s.tabLine, { backgroundColor: BrandColors.primary }]} />}
            </Pressable>
          ))}
        </View>

        <FlatList
          data={items}
          renderItem={({ item }) => <EventCard item={item} onPress={openDetail} />}
          keyExtractor={item => item.event.id}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={BrandColors.primary} />
          }
          ListHeaderComponent={
            loading && !refreshing ? <EventsSkeleton /> :
            error ? (
              <View style={s.errorRow}>
                <ThemedText style={s.errorText} themeColor="textSecondary">{error}</ThemedText>
                <Pressable onPress={() => void load()} accessibilityRole="button" accessibilityLabel="Retry">
                  <ThemedText style={s.retryText}>Retry</ThemedText>
                </Pressable>
              </View>
            ) : undefined
          }
          ListEmptyComponent={
            !loading && !error ? (
              <EventsEmpty
                title={role === 'organized' ? 'You are not organizing any events' : 'You are not attending any events'}
                message={role === 'organized'
                  ? 'Events you create or manage on behalf of a business account appear here.'
                  : 'Events you RSVP to appear here.'}
                actionLabel={role === 'organized' ? 'Create an event' : 'Browse events'}
                onAction={() => {
                  if (role === 'organized') router.push('/(app)/events/create' as never);
                  else if (router.canGoBack()) router.back();
                  else router.replace('/(app)/events' as never);
                }}
              />
            ) : undefined
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={s.footer}>
                <ThemedText style={s.footerText} themeColor="textSecondary">Loading more…</ThemedText>
              </View>
            ) : undefined
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={items.length === 0 ? { flexGrow: 1 } : undefined}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    paddingHorizontal: Spacing.three, paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 18 },
  headerSpacer: { width: 24 },
  tabBar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two },
  tabLabel: { fontSize: 14, fontWeight: '500' },
  tabLine: { height: 2, width: 36, borderRadius: 1, marginTop: 2 },
  errorRow: { alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.five, paddingHorizontal: Spacing.four },
  errorText: { fontSize: 14, textAlign: 'center' },
  retryText: { color: BrandColors.primary, fontWeight: '700', fontSize: 14 },
  footer: { alignItems: 'center', paddingVertical: Spacing.three },
  footerText: { fontSize: 13 },
});
