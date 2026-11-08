/**
 * PeopleScreen — the community's people directory.
 * Segmented tabs: Members (active community) / Following / Followers.
 * Real avatars via the block-checked social endpoint, "Follows you" badges,
 * optimistic follow buttons, client-side search, paged infinite scroll.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Avatar } from '@/features/feed/components/avatar';
import { useSession } from '@/core/session/session-provider';
import { createPeopleApi } from '../services/people-api';
import { createExploreApi } from '@/features/feed/services/explore-api';
import { BrandColors } from '@/shared/theme/colors';
import { Spacing } from '@/shared/theme/spacing';
import { useTheme } from '@/hooks/use-theme';
import type { ProfileSummary } from '@/features/feed/types/feed-types';
import type { RelationshipView } from '@/features/profile/services/social-api';
import { ApiError } from '@/core/api/api-error';

type Tab = 'members' | 'following' | 'followers';
const TABS: { key: Tab; label: string }[] = [
  { key: 'members', label: 'Members' },
  { key: 'following', label: 'Following' },
  { key: 'followers', label: 'Followers' },
];

interface TabState {
  items: ProfileSummary[];
  total: number;
  nextPage: number;
  hasMore: boolean;
  loaded: boolean;
}

const EMPTY_TAB: TabState = { items: [], total: 0, nextPage: 0, hasMore: true, loaded: false };
const PAGE_SIZE = 30;

function SkeletonRows() {
  const theme = useTheme();
  return (
    <View style={st.skeletonList}>
      {[0, 1, 2, 3, 4, 5].map(i => (
        <View key={i} style={[st.personCard, st.skeletonCard, { borderColor: theme.border }]}>
          <View style={[st.avatarSk, { backgroundColor: theme.backgroundElement }]} />
          <View style={st.skeletonInfo}>
            <View style={[st.lineSk, { backgroundColor: theme.backgroundElement, width: '58%' }]} />
            <View style={[st.lineSk, { backgroundColor: theme.backgroundElement, width: '38%' }]} />
          </View>
          <View style={[st.btnSk, { backgroundColor: theme.backgroundElement }]} />
        </View>
      ))}
    </View>
  );
}

function ListSeparator() {
  return <View style={st.separator} />;
}

export default function PeopleScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient, session } = useSession();
  const api = useMemo(() => createPeopleApi(apiClient), [apiClient]);
  const exploreApi = useMemo(() => createExploreApi(apiClient), [apiClient]);

  const myId = session?.me.id ?? '';
  const communityId = session?.activeCommunityId ?? '';

  const [tab, setTab] = useState<Tab>('members');
  const [search, setSearch] = useState('');
  const [communityName, setCommunityName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [rels, setRels] = useState<Map<string, RelationshipView>>(new Map());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [tabs, setTabs] = useState<Record<Tab, TabState>>({
    members: EMPTY_TAB,
    following: EMPTY_TAB,
    followers: EMPTY_TAB,
  });

  // Resolve display names for relationship lookups in one pass
  const loadRels = useCallback(async (people: ProfileSummary[]) => {
    const missing = people.filter(p => p.id !== myId).slice(0, PAGE_SIZE);
    if (!missing.length) return;
    const results = await Promise.all(
      missing.map(p =>
        api.relationship(p.id)
          .then(r => [p.id, r] as [string, RelationshipView])
          .catch(() => null)),
    );
    setRels(prev => {
      const next = new Map(prev);
      results.forEach(r => { if (r) next.set(r[0], r[1]); });
      return next;
    });
  }, [api, myId]);

  const fetchPage = useCallback(async (which: Tab, page: number) => {
    if (which === 'members') return api.members(communityId, page, PAGE_SIZE);
    if (which === 'following') return api.following(page, PAGE_SIZE);
    return api.followers(page, PAGE_SIZE);
  }, [api, communityId]);

  const loadTab = useCallback(async (which: Tab, page: number, replace: boolean) => {
    try {
      const res = await fetchPage(which, page);
      const fresh = res.items.filter(p => p.id !== myId);
      setTabs(prev => {
        const cur = prev[which];
        const seen = new Set(replace ? [] : cur.items.map(i => i.id));
        const merged = replace ? fresh : [...cur.items, ...fresh.filter(p => !seen.has(p.id))];
        return {
          ...prev,
          [which]: {
            items: merged,
            total: res.total,
            nextPage: page + 1,
            hasMore: merged.length < res.total && fresh.length > 0,
            loaded: true,
          },
        };
      });
      void loadRels(fresh);
      setError(null);
    } catch (e) {
      setError(ApiError.isApiError(e) ? e.userMessage : 'Failed to load people.');
    } finally {
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [fetchPage, loadRels, myId]);

  // Community name for the subtitle — best effort
  useEffect(() => {
    if (!communityId) return;
    let cancelled = false;
    exploreApi.getCommunity(communityId)
      .then(c => { if (!cancelled && c?.name) setCommunityName(c.name); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [exploreApi, communityId]);

  // First load per tab
  useEffect(() => {
    if (tabs[tab].loaded) return;
    let cancelled = false;
    (async () => { if (!cancelled) await loadTab(tab, 0, true); })();
    return () => { cancelled = true; };
  }, [tab, tabs, loadTab]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void loadTab(tab, 0, true);
  }, [loadTab, tab]);

  const loadMore = useCallback(() => {
    const cur = tabs[tab];
    if (loadingMore || !cur.hasMore || search.trim()) return;
    setLoadingMore(true);
    void loadTab(tab, cur.nextPage, false);
  }, [tabs, tab, loadingMore, loadTab, search]);

  const toggleFollow = useCallback(async (person: ProfileSummary) => {
    if (pending.has(person.id)) return;
    const wasFollowing = rels.get(person.id)?.following ?? false;
    setPending(p => new Set(p).add(person.id));
    // Optimistic
    setRels(prev => {
      const next = new Map(prev);
      const cur = next.get(person.id);
      next.set(person.id, { ...(cur ?? { followedBy: false, mutual: false, friends: false, blockedByMe: false }),
        following: !wasFollowing, mutual: !wasFollowing && (cur?.followedBy ?? false) });
      return next;
    });
    try {
      if (wasFollowing) await api.unfollow(person.id);
      else await api.follow(person.id);
    } catch {
      // Revert
      setRels(prev => {
        const next = new Map(prev);
        const cur = next.get(person.id);
        if (cur) next.set(person.id, { ...cur, following: wasFollowing, mutual: wasFollowing && cur.followedBy });
        return next;
      });
    } finally {
      setPending(p => { const n = new Set(p); n.delete(person.id); return n; });
    }
  }, [api, rels, pending]);

  const filtered = useMemo(() => {
    const items = tabs[tab].items;
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(p =>
      p.displayName?.toLowerCase().includes(q) || p.username.toLowerCase().includes(q));
  }, [tabs, tab, search]);

  const renderPerson = useCallback(({ item }: { item: ProfileSummary }) => {
    const rel = rels.get(item.id);
    const isFollowing = rel?.following ?? false;
    const followsYou = rel?.followedBy ?? false;
    const busy = pending.has(item.id);
    const name = item.displayName ?? item.username;

    return (
      <View style={[st.personCard, { borderColor: theme.border }]}>
        <View style={[st.avatarRing, { borderColor: isFollowing ? theme.primary : theme.border }]}>
          <Avatar name={name} mediaId={item.avatarMediaId} userId={item.id} size={50} />
        </View>
        <View style={st.info}>
          <ThemedText style={st.name} numberOfLines={1}>{name}</ThemedText>
          <ThemedText style={st.handle} themeColor="textSecondary" numberOfLines={1}>
            @{item.username}
          </ThemedText>
          {(followsYou || rel?.mutual) && (
            <View style={st.metaRow}>
              {followsYou && !isFollowing && (
                <View style={[st.chip, { backgroundColor: theme.backgroundElement }]}>
                  <Ionicons name="person-add-outline" size={11} color={theme.textSecondary} />
                  <ThemedText style={[st.chipText, { color: theme.textSecondary }]}>Follows you</ThemedText>
                </View>
              )}
              {rel?.mutual && (
                <View style={[st.chip, { backgroundColor: theme.primarySurface }]}>
                  <Ionicons name="swap-horizontal" size={11} color={theme.primary} />
                  <ThemedText style={[st.chipText, { color: theme.primary }]}>Mutual</ThemedText>
                </View>
              )}
            </View>
          )}
        </View>
        <Pressable
          onPress={() => void toggleFollow(item)}
          disabled={busy}
          hitSlop={6}
          style={({ pressed }) => [st.followBtn,
            isFollowing
              ? { backgroundColor: theme.backgroundElement, borderColor: theme.border }
              : { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
            (busy || pressed) && st.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={isFollowing ? `Unfollow ${name}` : `Follow ${name}`}
          accessibilityState={{ busy, disabled: busy }}
        >
          {busy ? (
            <ActivityIndicator size="small" color={isFollowing ? theme.textSecondary : BrandColors.white} />
          ) : (
            <>
              {isFollowing && <Ionicons name="checkmark" size={14} color={theme.text} />}
              <ThemedText style={[st.followText, { color: isFollowing ? theme.text : BrandColors.white }]}>
                {isFollowing ? 'Following' : followsYou ? 'Follow back' : 'Follow'}
              </ThemedText>
            </>
          )}
        </Pressable>
      </View>
    );
  }, [rels, pending, theme, toggleFollow]);

  const emptyConfig: Record<Tab, { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }> = {
    members: { icon: 'people-outline', title: 'No members yet', body: 'Community members will appear here.' },
    following: { icon: 'person-add-outline', title: 'Not following anyone', body: 'Find people in your community and tap Follow.' },
    followers: { icon: 'heart-outline', title: 'No followers yet', body: 'People who follow you will show up here.' },
  };
  const empty = emptyConfig[tab];
  const active = tabs[tab];
  const sectionTitle = search.trim()
    ? 'Search results'
    : tab === 'members' ? 'Community directory' : tab === 'following' ? 'People you follow' : 'Your followers';

  return (
    <ThemedView style={st.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={st.safe} edges={['top']}>
        {/* Header */}
        <View style={st.header}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)' as never))}
            style={({ pressed }) => [
              st.backBtn,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border },
              pressed && st.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={8}
          >
            <Ionicons name="chevron-back" size={22} color={theme.text} />
          </Pressable>
          <View style={st.headerText}>
            <ThemedText type="title" style={st.title}>People</ThemedText>
            <ThemedText style={st.subtitle} themeColor="textSecondary" numberOfLines={2}>
              {communityName ? `Connect with people in ${communityName}` : 'Discover, connect and grow together'}
            </ThemedText>
          </View>
          <View style={[st.headerBadge, { backgroundColor: theme.primarySurface }]}>
            <Ionicons name="people" size={22} color={theme.primary} />
          </View>
        </View>

        {/* Search */}
        <View style={[st.searchBar, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <Ionicons name="search-outline" size={20} color={theme.textSecondary} />
          <TextInput
            style={[st.searchInput, { color: theme.text }]}
            placeholder="Search by name or username"
            placeholderTextColor={theme.textSecondary}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search people"
          />
          {search.length > 0 && (
            <Pressable
              onPress={() => setSearch('')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              style={({ pressed }) => [pressed && st.pressed]}
            >
              <Ionicons name="close-circle" size={19} color={theme.textSecondary} />
            </Pressable>
          )}
        </View>

        {/* Segmented tabs */}
        <View style={[st.segment, { backgroundColor: theme.backgroundElement }]}>
          {TABS.map(t => {
            const isActive = t.key === tab;
            const count = tabs[t.key].loaded ? tabs[t.key].total : null;
            return (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                style={({ pressed }) => [
                  st.segBtn,
                  isActive && { backgroundColor: theme.background, borderColor: theme.border },
                  pressed && st.pressed,
                ]}
                accessibilityRole="tab"
                accessibilityLabel={`${t.label}${count != null ? `, ${count}` : ''}`}
                accessibilityState={{ selected: isActive }}
              >
                <ThemedText
                  style={[st.segLabel, { color: isActive ? theme.primary : theme.textSecondary }]}
                  numberOfLines={1}
                >
                  {t.label}
                </ThemedText>
                {count != null && (
                  <View style={[
                    st.segCount,
                    { backgroundColor: isActive ? theme.primarySurface : theme.backgroundSelected },
                  ]}>
                    <ThemedText style={[st.segCountText, { color: isActive ? theme.primary : theme.textSecondary }]}>
                      {count}
                    </ThemedText>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {error ? (
          <View style={st.center}>
            <View style={[st.stateIconWrap, { backgroundColor: theme.errorSurface }]}>
              <Ionicons name="cloud-offline-outline" size={30} color={theme.error} />
            </View>
            <ThemedText style={st.emptyTitle}>Couldn&apos;t load people</ThemedText>
            <ThemedText style={st.emptyBody} themeColor="textSecondary">{error}</ThemedText>
            <Pressable
              onPress={refresh}
              style={({ pressed }) => [
                st.retryBtn,
                { backgroundColor: BrandColors.primary },
                pressed && st.pressed,
              ]}
              accessibilityRole="button"
            >
              <Ionicons name="refresh" size={17} color={BrandColors.white} />
              <ThemedText style={st.retryText}>Try again</ThemedText>
            </Pressable>
          </View>
        ) : !active.loaded ? (
          <SkeletonRows />
        ) : (
          <FlatList
            data={filtered}
            renderItem={renderPerson}
            keyExtractor={i => i.id}
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            contentContainerStyle={[st.listContent, filtered.length === 0 && st.emptyListContent]}
            ItemSeparatorComponent={ListSeparator}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={refresh}
                tintColor={BrandColors.primary}
                colors={[BrandColors.primary]}
                progressBackgroundColor={theme.background}
              />
            }
            ListHeaderComponent={
              <View style={st.listHeader}>
                <ThemedText style={st.sectionTitle}>{sectionTitle}</ThemedText>
                <ThemedText style={st.sectionMeta} themeColor="textSecondary">
                  {filtered.length} {filtered.length === 1 ? 'person' : 'people'}
                </ThemedText>
              </View>
            }
            ListFooterComponent={
              loadingMore ? (
                <ActivityIndicator style={st.footerLoader} color={BrandColors.primary} />
              ) : undefined
            }
            ListEmptyComponent={
              <View style={st.emptyState}>
                <View style={[st.stateIconWrap, { backgroundColor: theme.primarySurface }]}>
                  <Ionicons name={empty.icon} size={30} color={theme.primary} />
                </View>
                <ThemedText style={st.emptyTitle}>
                  {search ? `No matches for "${search}"` : empty.title}
                </ThemedText>
                <ThemedText style={st.emptyBody} themeColor="textSecondary">
                  {search ? 'Try a different spelling or search by username.' : empty.body}
                </ThemedText>
                {search.length > 0 && (
                  <Pressable
                    onPress={() => setSearch('')}
                    style={({ pressed }) => [
                      st.secondaryBtn,
                      { borderColor: theme.border },
                      pressed && st.pressed,
                    ]}
                    accessibilityRole="button"
                  >
                    <ThemedText style={[st.secondaryBtnText, { color: theme.primary }]}>Clear search</ThemedText>
                  </Pressable>
                )}
              </View>
            }
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four / 2,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -0.6 },
  subtitle: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  headerBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.four / 2,
    marginBottom: Spacing.three,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: Spacing.three,
    height: 50,
    gap: 10,
  },
  searchInput: { flex: 1, fontSize: 15, height: '100%', paddingVertical: 0 },
  segment: {
    flexDirection: 'row',
    marginHorizontal: Spacing.four / 2,
    marginBottom: Spacing.one,
    borderRadius: 16,
    padding: 4,
    gap: 4,
  },
  segBtn: {
    flex: 1,
    minWidth: 0,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segLabel: { fontSize: 12, fontWeight: '700' },
  segCount: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segCountText: { fontSize: 10, lineHeight: 13, fontWeight: '800' },
  listContent: { paddingHorizontal: Spacing.four / 2, paddingTop: 12, paddingBottom: Spacing.five },
  emptyListContent: { flexGrow: 1 },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  sectionMeta: { fontSize: 12, lineHeight: 16 },
  personCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderWidth: 1,
    borderRadius: 18,
    gap: 12,
  },
  separator: { height: 10 },
  avatarRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, minWidth: 0, gap: 1 },
  name: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  handle: { fontSize: 13, lineHeight: 18 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 5 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  chipText: { fontSize: 10, lineHeight: 14, fontWeight: '700' },
  followBtn: {
    minWidth: 92,
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 12,
    borderRadius: 19,
    borderWidth: 1.5,
  },
  followText: { fontSize: 12, fontWeight: '700' },
  pressed: { opacity: 0.65 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.five,
    paddingBottom: Spacing.six,
    gap: Spacing.two,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: Spacing.six,
    paddingHorizontal: Spacing.two,
    gap: Spacing.two,
  },
  stateIconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  emptyTitle: { fontSize: 18, lineHeight: 24, fontWeight: '700', textAlign: 'center' },
  emptyBody: { fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 290 },
  retryBtn: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
    paddingHorizontal: 20,
    borderRadius: 22,
  },
  retryText: { color: BrandColors.white, fontWeight: '700', fontSize: 14 },
  secondaryBtn: {
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  secondaryBtnText: { fontSize: 13, fontWeight: '700' },
  footerLoader: { padding: Spacing.four },
  skeletonList: { paddingHorizontal: Spacing.four / 2, paddingTop: 12 },
  skeletonCard: { marginBottom: 10 },
  skeletonInfo: { flex: 1, gap: Spacing.two },
  avatarSk: { width: 56, height: 56, borderRadius: 28 },
  lineSk: { height: 12, borderRadius: 6 },
  btnSk: { width: 92, height: 38, borderRadius: 19 },
});
