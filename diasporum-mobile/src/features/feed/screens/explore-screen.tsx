/**
 * ExploreScreen — discovery hub: People / Communities / Posts / Reels.
 * People: community members + following. Communities: available to join.
 * Posts: community feed. Reels: community reels. Search: client-side filter.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LoadingScreen } from '@/shared/components/loading-screen';
import { useSession } from '@/core/session/session-provider';
import { createExploreApi } from '../services/explore-api';
import { createFeedApi } from '../services/feed-api';
import { BrandColors } from '@/shared/theme/colors';
import { Spacing } from '@/shared/theme/spacing';
import { useTheme } from '@/hooks/use-theme';
import type { ProfileSummary, CommunitySummary, FeedItem } from '../types/feed-types';
import { PostItem } from '../components/post-item';
import { MediaImage } from '../components/media-image';
import { timeAgo } from '../utils/time-ago';
import { ApiError } from '@/core/api/api-error';

type Cat = 'people' | 'communities' | 'posts' | 'reels';
type Rel = { following: boolean; followedBy: boolean; blockedBy: boolean };

export default function ExploreScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient, session } = useSession();
  const exploreApi = React.useMemo(() => createExploreApi(apiClient), [apiClient]);
  const feedApi = React.useMemo(() => createFeedApi(apiClient), [apiClient]);

  const [cat, setCat] = useState<Cat>('people');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [people, setPeople] = useState<ProfileSummary[]>([]);
  const [communities, setCommunities] = useState<CommunitySummary[]>([]);
  const [posts, setPosts] = useState<FeedItem[]>([]);
  const [reels, setReels] = useState<FeedItem[]>([]);
  const [rels, setRels] = useState<Map<string, Rel>>(new Map());
  const [joining, setJoining] = useState<string | null>(null);
  const [following, setFollowing] = useState<Set<string>>(new Set());

  const myId = session?.me.id ?? '';
  const communityId = session?.activeCommunityId ?? '';
  const [communityName, setCommunityName] = useState('Community');

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const load = useCallback(async () => {
    setError(null);
    try {
      const [community, memberRes, availRes, posts, reels] = await Promise.all([
        exploreApi.getCommunity(communityId).catch(() => null),
        exploreApi.communityMembers(communityId).catch(() => ({ items: [] })),
        exploreApi.availableCommunities().catch(() => ({ items: [] })),
        exploreApi.communityPosts(communityId).catch(() => ({ items: [], nextCursor: null })),
        exploreApi.communityReels(communityId).catch(() => ({ items: [], nextCursor: null })),
      ]);
      if (community?.name) setCommunityName(community.name);
      const p = memberRes.items;
      const c = availRes.items;
      // Deduplicate people by id, exclude self
      const me = session?.me.id ?? '';
      const seen = new Set<string>();
      const dedup = p.filter(m => { if (seen.has(m.id) || m.id === me) return false; seen.add(m.id); return true; });
      setPeople(dedup);
      setCommunities(c);
      setPosts(posts.items);
      setReels(reels.items);
      // Batch relationships for visible people
      if (dedup.length > 0) {
        const relPromises = dedup.slice(0, 20).map(m =>
          exploreApi.relationship(m.id).then(r => [m.id, r] as [string, Rel]).catch(() => null)
        );
        const relResults = await Promise.all(relPromises);
        const relMap = new Map<string, Rel>();
        relResults.forEach(r => { if (r) relMap.set(r[0], r[1]); });
        setRels(relMap);
      }
    } catch (e) {
      setError(ApiError.isApiError(e) ? e.userMessage : 'Failed to load.');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [exploreApi, communityId, session?.me.id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const refresh = useCallback(() => { setRefreshing(true); void load(); }, [load]);

  const toggleFollow = useCallback(async (person: ProfileSummary) => {
    if (person.id === myId) return;
    const rel = rels.get(person.id);
    const isFollowing = rel?.following ?? following.has(person.id);
    setFollowing(f => { const n = new Set(f); if (isFollowing) n.delete(person.id); else n.add(person.id); return n; });
    try {
      if (isFollowing) await exploreApi.unfollow(person.id);
      else await exploreApi.follow(person.id);
    } catch { setFollowing(f => { const n = new Set(f); if (isFollowing) n.add(person.id); else n.delete(person.id); return n; }); }
  }, [rels, following, exploreApi, myId]);

  const joinCommunity = useCallback(async (c: CommunitySummary) => {
    if (joining === c.id) return;
    setJoining(c.id);
    try { await exploreApi.joinCommunity(c.id); } catch { /* 403/409 handled server-side */ }
    finally { setJoining(null); }
  }, [joining, exploreApi]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return { people, communities, posts, reels };
    return {
      people: people.filter(p => p.displayName?.toLowerCase().includes(q) || p.username.toLowerCase().includes(q)),
      communities: communities.filter(c => c.name.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q)),
      posts: posts.filter(p => p.title?.toLowerCase().includes(q) || p.body?.toLowerCase().includes(q)),
      reels: reels.filter(r => r.title?.toLowerCase().includes(q) || r.body?.toLowerCase().includes(q)),
    };
  }, [search, people, communities, posts, reels]);

  const isFollowing = useCallback((id: string) => rels.get(id)?.following ?? following.has(id), [rels, following]);

  // ---- Item renderers ----

  const PersonRow = useCallback(({ item }: { item: ProfileSummary }) => {
    const rel = rels.get(item.id);
    const isSelf = item.id === session?.me.id;
    const isBlocked = rel?.blockedBy ?? false;
    const name = item.displayName ?? item.username;
    return (
      <View style={[s.row, { borderBottomColor: theme.border }]}>
        <View style={[s.avatar, { backgroundColor: BrandColors.primarySurface }]}>
          <ThemedText style={[s.avatarLetter, { color: BrandColors.primary }]}>{name[0].toUpperCase()}</ThemedText>
        </View>
        <View style={s.personInfo}>
          <ThemedText style={s.personName}>{name}</ThemedText>
          <ThemedText style={s.personMeta} themeColor="textSecondary">@{item.username}</ThemedText>
        </View>
        {!isSelf && !isBlocked && (
          <Pressable onPress={() => toggleFollow(item)}
            style={[s.followBtn, isFollowing(item.id) && s.followingBtn]}
            accessibilityLabel={isFollowing(item.id) ? `Unfollow ${name}` : `Follow ${name}`}>
            <ThemedText style={[s.followBtnText, isFollowing(item.id) && { color: '#fff' }]}>
              {isFollowing(item.id) ? 'Following' : 'Follow'}
            </ThemedText>
          </Pressable>
        )}
      </View>
    );
  }, [rels, session?.me.id, theme.border, isFollowing, toggleFollow]);

  const CommunityRow = useCallback(({ item }: { item: CommunitySummary }) => (
    <View style={[s.row, { borderBottomColor: theme.border }]}>
      <View style={[s.avatar, { backgroundColor: BrandColors.primarySurface }]}>
        <ThemedText style={[s.avatarLetter, { color: BrandColors.primary }]}>{item.name[0]}</ThemedText>
      </View>
      <View style={s.personInfo}>
        <ThemedText style={s.personName}>{item.name}</ThemedText>
        {item.description && <ThemedText style={s.personMeta} themeColor="textSecondary" numberOfLines={1}>{item.description}</ThemedText>}
      </View>
      <Pressable onPress={() => joinCommunity(item)} disabled={joining === item.id}
        style={[s.followBtn, joining === item.id && { opacity: 0.5 }]}
        accessibilityLabel={`Join ${item.name}`}>
        <ThemedText style={s.followBtnText}>{joining === item.id ? '…' : 'Join'}</ThemedText>
      </Pressable>
    </View>
  ), [theme.border, joining, joinCommunity]);

  const ReelCard = useCallback(({ item }: { item: FeedItem }) => (
    <Pressable onPress={() => router.push(`/(app)/posts/${item.sourceId}` as never)}
      style={[s.reelCard, { borderBottomColor: theme.border }]}
      accessibilityLabel={`Reel by ${item.author?.displayName ?? 'unknown'}`}>
      <View style={s.reelThumb}>
        {item.mediaIds[0] ? <MediaImage mediaId={item.mediaIds[0]} style={s.reelImg} /> :
          <View style={[s.reelImg, { backgroundColor: theme.backgroundElement }]} />}
      </View>
      <View style={s.reelInfo}>
        <ThemedText style={s.personName}>{item.title ?? item.body ?? 'Reel'}</ThemedText>
        <ThemedText style={s.personMeta} themeColor="textSecondary">
          {item.author?.displayName ?? 'Diasporum member'} · {timeAgo(item.publishedAt)}
        </ThemedText>
      </View>
    </Pressable>
  ), [theme.border, theme.backgroundElement, router]);

  // ---- Main render ----

  const data = cat === 'people' ? filtered.people
    : cat === 'communities' ? filtered.communities
    : cat === 'posts' ? filtered.posts : filtered.reels;

  const renderItem = useCallback(({ item }: { item: unknown }) => {
    if (cat === 'people') return <PersonRow item={item as ProfileSummary} />;
    if (cat === 'communities') return <CommunityRow item={item as CommunitySummary} />;
    if (cat === 'posts') return <PostItem item={item as FeedItem}
      onPress={() => router.push(`/(app)/posts/${(item as FeedItem).sourceId}` as never)}
      onComment={() => router.push(`/(app)/posts/${(item as FeedItem).sourceId}` as never)}
      onReact={r => void feedApi.react((item as FeedItem).sourceId, r)}
      onSave={() => { const it = item as FeedItem; void (it.saved ? feedApi.unsave(it.sourceId) : feedApi.save(it.sourceId)); }} />;
    return <ReelCard item={item as FeedItem} />;
  }, [cat, PersonRow, CommunityRow, ReelCard, router, feedApi]);

  const keyExtractor = useCallback((i: unknown) =>
    cat === 'people' ? (i as ProfileSummary).id
    : cat === 'communities' ? (i as CommunitySummary).id
    : (i as FeedItem).itemId, [cat]);

  if (loading && !refreshing) return <LoadingScreen />;

  return (
    <ThemedView style={s.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={s.safeArea}>
        {/* Header */}
        <View style={[s.header, { borderBottomColor: theme.border }]}>
          <ThemedText type="title">Explore</ThemedText>
          <ThemedText style={s.communityLabel} themeColor="textSecondary">{communityName}</ThemedText>
        </View>
        {/* Search */}
        <View style={[s.searchBar, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText style={s.searchIcon}>🔍</ThemedText>
          <TextInput style={[s.searchInput, { color: theme.text }]}
            placeholder="Search people, communities, posts…"
            placeholderTextColor={theme.textSecondary}
            value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} />
          {search.length > 0 && <Pressable onPress={() => setSearch('')} hitSlop={8}><ThemedText style={s.clearBtn}>✕</ThemedText></Pressable>}
        </View>
        {/* Category tabs */}
        <View style={[s.catBar, { borderBottomColor: theme.border }]}>
          {(['people', 'communities', 'posts', 'reels'] as const).map(c => (
            <Pressable key={c} onPress={() => setCat(c)} style={s.catBtn}>
              <ThemedText style={[s.catLabel, cat === c && { color: BrandColors.primary, fontWeight: '700' }]}>
                {c === 'people' ? 'People' : c === 'communities' ? 'Communities' : c === 'posts' ? 'Posts' : 'Reels'}
              </ThemedText>
              {cat === c && <View style={[s.catLine, { backgroundColor: BrandColors.primary }]} />}
            </Pressable>
          ))}
        </View>

        {error ? <View style={s.empty}><ThemedText themeColor="textSecondary">{error}</ThemedText></View> : null}

        <FlatList
          data={data as never[]}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={BrandColors.primary} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <ThemedText style={s.emptyIcon}>
                {cat === 'people' ? '👥' : cat === 'communities' ? '🌍' : cat === 'posts' ? '📝' : '🎬'}
              </ThemedText>
              <ThemedText style={s.emptyTitle}>{search ? `No ${cat} found` : `No ${cat} yet`}</ThemedText>
              {search.length > 0 && <ThemedText style={s.emptyBody} themeColor="textSecondary">Try a different search.</ThemedText>}
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 }, safeArea: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  communityLabel: { fontSize: 12 },
  searchBar: { flexDirection: 'row', alignItems: 'center', margin: Spacing.four, borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.three, height: 44 },
  searchIcon: { fontSize: 16, marginRight: Spacing.two },
  searchInput: { flex: 1, fontSize: 15, height: '100%' },
  clearBtn: { fontSize: 16, color: '#888', paddingHorizontal: 4 },
  catBar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  catBtn: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two },
  catLabel: { fontSize: 14, fontWeight: '500' },
  catLine: { height: 2, width: 32, borderRadius: 1, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, gap: Spacing.two },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: 18, fontWeight: '700' },
  personInfo: { flex: 1 },
  personName: { fontSize: 15, fontWeight: '600' },
  personMeta: { fontSize: 13, marginTop: 2 },
  followBtn: { paddingHorizontal: Spacing.three, paddingVertical: 6, borderRadius: 18, borderWidth: 1.5, borderColor: BrandColors.primary },
  followingBtn: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  followBtnText: { fontSize: 13, fontWeight: '700', color: BrandColors.primary },
  reelCard: { flexDirection: 'row', paddingHorizontal: Spacing.four, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, gap: Spacing.two },
  reelThumb: { width: 80, height: 100, borderRadius: 8, overflow: 'hidden' },
  reelImg: { width: '100%', height: '100%' },
  reelInfo: { flex: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', paddingTop: 80, gap: Spacing.two },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptyBody: { fontSize: 14 },
});
