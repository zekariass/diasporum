/**
 * EventsScreen — event discovery hub.
 * Route: /(app)/events
 * Filter chips (scope / mode / category), server-side search, cursor pagination,
 * links to Saved events, My events and event creation.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useSession } from '@/core/session/session-provider';
import { createEventApi } from '../services/event-api';
import { BrandColors } from '@/shared/theme/colors';
import { Spacing } from '@/shared/theme/spacing';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/core/api/api-error';
import type { EventCategory, EventItem, EventMode, VisibilityScope } from '../types/event-types';
import { EventCard } from '../components/event-card';
import { EventsEmpty, EventsSkeleton } from '../components/event-states';

type ScopeFilter = 'ALL' | VisibilityScope;
type ModeFilter = 'ALL' | EventMode;

export default function EventsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient } = useSession();
  const eventApi = React.useMemo(() => createEventApi(apiClient), [apiClient]);

  const [scope, setScope] = useState<ScopeFilter>('ALL');
  const [mode, setMode] = useState<ModeFilter>('ALL');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categories, setCategories] = useState<EventCategory[]>([]);

  const [items, setItems] = useState<EventItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    eventApi.categories()
      .then(r => setCategories(r.items))
      .catch(() => setCategories([]));
  }, [eventApi]);

  // Debounce search so typing does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  const loadPage = useCallback(async (nextCursor?: string) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (nextCursor) setLoadingMore(true);
    try {
      const page = await eventApi.discover(
        {
          scope: scope === 'ALL' ? undefined : scope,
          mode: mode === 'ALL' ? undefined : mode,
          categoryId: categoryId ?? undefined,
          search: debouncedSearch || undefined,
        },
        nextCursor,
        20,
      );
      setItems(prev => {
        if (!nextCursor) return page.items;
        const seen = new Set(prev.map(i => i.event.id));
        return [...prev, ...page.items.filter(i => !seen.has(i.event.id))];
      });
      setCursor(page.nextCursor);
      setError(null);
    } catch (e) {
      setError(ApiError.isApiError(e) ? e.userMessage : 'Failed to load events.');
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
      setLoading(false);
      setRefreshing(false);
    }
  }, [eventApi, scope, mode, categoryId, debouncedSearch]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setLoading(true); void loadPage(); }, [loadPage]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void loadPage();
  }, [loadPage]);

  const loadMore = useCallback(() => {
    if (cursor && !loadingRef.current) void loadPage(cursor);
  }, [cursor, loadPage]);

  const openDetail = useCallback(
    (eventId: string) => router.push(`/(app)/events/${eventId}` as never),
    [router],
  );

  const hasFilters = scope !== 'ALL' || mode !== 'ALL' || categoryId !== null || debouncedSearch.length > 0;

  const listData = useMemo(() => items, [items]);

  return (
    <ThemedView style={s.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={s.safeArea} edges={['top', 'left', 'right']}>
        {/* Header */}
        <View style={[s.header, { borderBottomColor: theme.border }]}>
          <ThemedText type="title">Events</ThemedText>
          <View style={s.headerActions}>
            <Pressable
              onPress={() => router.push('/(app)/events/saved' as never)}
              accessibilityRole="button"
              accessibilityLabel="Saved events"
              style={s.iconBtn}
            >
              <Ionicons name="bookmark-outline" size={20} color={theme.text} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/(app)/events/my' as never)}
              accessibilityRole="button"
              accessibilityLabel="My events"
              style={s.iconBtn}
            >
              <Ionicons name="person-outline" size={20} color={theme.text} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/(app)/events/create' as never)}
              accessibilityRole="button"
              accessibilityLabel="Create event"
              style={[s.iconBtn, s.createBtn, { backgroundColor: theme.text }]}
            >
              <Ionicons name="add" size={20} color={theme.background} />
            </Pressable>
          </View>
        </View>

        {/* Search */}
        <View style={[s.searchBar, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <Ionicons name="search-outline" size={16} color={theme.textSecondary} />
          <TextInput
            style={[s.searchInput, { color: theme.text }]}
            placeholder="Search events…"
            placeholderTextColor={theme.textSecondary}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close" size={16} color={theme.textSecondary} />
            </Pressable>
          )}
        </View>

        {/* Filters */}
        <View style={s.filters}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
            {(['ALL', 'COMMUNITY', 'COUNTRY'] as ScopeFilter[]).map(f => (
              <Chip key={f} active={scope === f} onPress={() => setScope(f)}
                label={f === 'ALL' ? 'All' : f === 'COMMUNITY' ? 'My communities' : 'Country-wide'} />
            ))}
            {(['ALL', 'IN_PERSON', 'ONLINE_EXTERNAL'] as ModeFilter[]).map(f => (
              <Chip key={f} active={mode === f} onPress={() => setMode(f)}
                label={f === 'ALL' ? 'Any format' : f === 'IN_PERSON' ? 'In person' : 'Online'} />
            ))}
            <View style={s.chipDivider} />
            {categories.map(c => (
              <Chip key={c.id} active={categoryId === c.id}
                onPress={() => setCategoryId(categoryId === c.id ? null : c.id)}
                label={c.displayName} />
            ))}
          </ScrollView>
        </View>

        {/* List */}
        <FlatList
          data={listData}
          renderItem={({ item }) => <EventCard item={item} onPress={openDetail} />}
          keyExtractor={item => item.event.id}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={BrandColors.primary} />
          }
          ListHeaderComponent={
            loading && !refreshing ? <EventsSkeleton /> :
            error && !refreshing ? (
              <View style={s.errorRow}>
                <ThemedText style={s.errorText} themeColor="textSecondary">{error}</ThemedText>
                <Pressable onPress={() => void loadPage()} accessibilityRole="button" accessibilityLabel="Retry loading events">
                  <ThemedText style={s.retryText}>Retry</ThemedText>
                </Pressable>
              </View>
            ) : undefined
          }
          ListEmptyComponent={
            !loading && !error ? (
              <EventsEmpty
                filtered={hasFilters}
                actionLabel={hasFilters ? undefined : 'Create an event'}
                onAction={hasFilters ? undefined : () => router.push('/(app)/events/create' as never)}
              />
            ) : undefined
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={s.footer}><ThemedText style={s.footerText} themeColor="textSecondary">Loading more…</ThemedText></View>
            ) : undefined
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={items.length === 0 ? { flexGrow: 1 } : undefined}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Filter: ${label}`}
      accessibilityState={{ selected: active }}
      style={[
        s.chip,
        {
          backgroundColor: active ? BrandColors.primary : theme.backgroundElement,
          borderColor: active ? BrandColors.primary : theme.border,
        },
      ]}
    >
      <ThemedText style={[s.chipText, active && s.chipTextActive]}>{label}</ThemedText>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  createBtn: { borderRadius: 12 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    margin: Spacing.three, marginHorizontal: Spacing.four,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.three, height: 42,
  },
  searchInput: { flex: 1, fontSize: 15, height: '100%' },
  filters: { paddingBottom: Spacing.one },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.four, paddingVertical: Spacing.one },
  chipDivider: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: Spacing.half },
  chip: {
    minHeight: 32, borderRadius: 16, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 6,
    justifyContent: 'center',
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: BrandColors.white, fontWeight: '700' },
  errorRow: { alignItems: 'center', paddingTop: Spacing.five, gap: Spacing.two, paddingHorizontal: Spacing.four },
  errorText: { fontSize: 14, textAlign: 'center' },
  retryText: { color: BrandColors.primary, fontWeight: '700', fontSize: 14 },
  footer: { alignItems: 'center', paddingVertical: Spacing.three },
  footerText: { fontSize: 13 },
});
