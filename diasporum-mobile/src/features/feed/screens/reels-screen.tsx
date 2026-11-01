/**
 * ReelsScreen — full-screen vertical short-video feed.
 * Community mode: /feed/reels/community. Following: filtered followingFeed.
 * expo-video: one active player at a time, pause on blur/scroll.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions, FlatList, Pressable, RefreshControl,
  StyleSheet, View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useReels } from '../hooks/use-reels';
import { useSession } from '@/core/session/session-provider';
import { createFeedApi } from '../services/feed-api';
import { BrandColors } from '@/shared/theme/colors';
import { Spacing } from '@/shared/theme/spacing';
import { useTheme } from '@/hooks/use-theme';
import type { FeedItem } from '../types/feed-types';
import { timeAgo } from '../utils/time-ago';

import { getMediaUrl, refreshMediaUrl } from '../utils/media-cache';

const { height: SCREEN_H } = Dimensions.get('window');

// ---- Individual reel item ----

function ReelItem({ item, active, apiClient }: {
  item: FeedItem; active: boolean;
  apiClient: ReturnType<typeof import('@/core/api/api-client').createApiClient>;
}) {
  const theme = useTheme();
  const router = useRouter();
  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retried, setRetried] = useState(false);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const feedApi = React.useMemo(() => createFeedApi(apiClient), [apiClient]);
  const mediaId = item.mediaIds[0];

  const player = useVideoPlayer(uri ?? null, p => {
    p.loop = true;
    p.muted = true;
  });

  // Fetch signed URL via expiry-aware cache
  useEffect(() => {
    if (uri || failed || !mediaId) return;
    let cancelled = false;
    getMediaUrl(apiClient, mediaId)
      .then(u => { if (!cancelled) { setUri(u); setLoading(false); } })
      .catch(() => { if (!cancelled) { setFailed(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [apiClient, mediaId, uri, failed]);

  // Retry once with fresh URL on playback failure (expired signed URL)
  const handlePlaybackError = useCallback(() => {
    if (retried) { setFailed(true); return; }
    setRetried(true);
    setLoading(true);
    refreshMediaUrl(apiClient, mediaId)
      .then(u => { setUri(u); setLoading(false); setPaused(false); })
      .catch(() => { setFailed(true); setLoading(false); });
  }, [retried, apiClient, mediaId]);

  // Playback error → refresh URL once, then fail gracefully
  useEffect(() => {
    if (!player) return;
    const sub = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'error' || error) handlePlaybackError();
    });
    return () => sub.remove();
  }, [player, handlePlaybackError]);

  // Play/pause based on active state
  useEffect(() => {
    if (!player) return;
    if (active && uri && !paused) player.play();
    else player.pause();
  }, [active, uri, paused, player]);

  // Mute — player.muted is the documented expo-video API for toggling audio
  useEffect(() => {
    if (player) {
      // eslint-disable-next-line react-hooks/immutability
      player.muted = muted;
    }
  }, [muted, player]);

  const authorName = item.author?.displayName ?? 'Diasporum member';
  const authorUsername = item.author?.username ?? 'member';

  function togglePlay() { setPaused(p => !p); }
  function toggleMute() { setMuted(m => !m); }

  return (
    <View style={styles.reel}>
      {failed ? (
        <View style={[styles.videoPlaceholder, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText style={styles.errorIcon}>🎬</ThemedText>
          <ThemedText style={styles.errorText} themeColor="textSecondary">Video unavailable</ThemedText>
        </View>
      ) : loading || !uri ? (
        <View style={[styles.videoPlaceholder, { backgroundColor: '#000' }]}>
          <ThemedText style={styles.loadingText}>Loading…</ThemedText>
        </View>
      ) : (
        <VideoView player={player} style={styles.video} contentFit="cover" nativeControls={false} />
      )}

      {/* Tap overlay */}
      <Pressable style={styles.tapOverlay} onPress={togglePlay} accessibilityLabel="Toggle play">
        {paused && <ThemedText style={styles.pauseIcon}>▶</ThemedText>}
      </Pressable>

      {/* Right action rail */}
      <View style={styles.actionRail}>
        <RailAction icon="♥" count={item.reactionCount} active={!!item.viewerReaction}
          onPress={() => void feedApi.react(item.sourceId, 'LIKE')} activeColor={BrandColors.primary} />
        <RailAction icon="💬" count={item.commentCount}
          onPress={() => router.push(`/(app)/posts/${item.sourceId}` as never)} />
        <RailAction icon={item.saved ? '🔖' : '📑'} count={undefined} active={item.saved}
          onPress={() => void feedApi.save(item.sourceId)} activeColor={BrandColors.primary} />
        <RailAction icon={muted ? '🔇' : '🔊'} count={undefined} onPress={toggleMute} />
      </View>

      {/* Bottom overlay */}
      <View style={styles.bottomOverlay}>
        <View style={styles.authorRow}>
          <View style={[styles.avatar, { backgroundColor: BrandColors.primarySurface }]}>
            <ThemedText style={[styles.avatarText, { color: BrandColors.primary }]}>
              {authorName[0].toUpperCase()}
            </ThemedText>
          </View>
          <View>
            <ThemedText style={styles.authorName}>{authorName}</ThemedText>
            <ThemedText style={styles.authorMeta}>@{authorUsername} · {timeAgo(item.publishedAt)}</ThemedText>
          </View>
        </View>
        {item.title ? <ThemedText style={styles.caption} numberOfLines={2}>{item.title}</ThemedText> : null}
        {item.body ? <ThemedText style={styles.caption} numberOfLines={3}>{item.body}</ThemedText> : null}
      </View>
    </View>
  );
}

function RailAction({ icon, count, active, onPress, activeColor }: {
  icon: string; count?: number; active?: boolean; onPress: () => void; activeColor?: string;
}) {
  return (
    <Pressable onPress={onPress} style={styles.railBtn} accessibilityRole="button">
      <ThemedText style={[styles.railIcon, active && activeColor ? { color: activeColor } : {}]}>
        {icon}
      </ThemedText>
      {count !== undefined && <ThemedText style={styles.railCount}>{count}</ThemedText>}
    </Pressable>
  );
}

// ---- Main screen ----

export default function ReelsScreen() {
  const router = useRouter();
  const { apiClient } = useSession();
  const reels = useReels();
  const [activeIdx, setActiveIdx] = useState(0);
  const flatRef = useRef<FlatList<FeedItem>>(null);

  const viewedRef = useRef(new Set<string>());
  const reelsFeedApi = React.useMemo(() => createFeedApi(apiClient), [apiClient]);
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: { index?: number; item: unknown }[] }) => {
    const idx = viewableItems[0]?.index;
    if (idx !== undefined) {
      setActiveIdx(idx);
      const item = viewableItems[0]?.item as FeedItem;
      if (item && !viewedRef.current.has(item.sourceId)) {
        viewedRef.current.add(item.sourceId);
        void reelsFeedApi.recordView('FEED_POST', item.sourceId);
      }
    }
  }, [reelsFeedApi]);
  const viewabilityConfig = { itemVisiblePercentThreshold: 80 };

  useFocusEffect(useCallback(() => {
    return () => setActiveIdx(-1); // pause all on blur
  }, []));

  const renderItem = useCallback(({ item, index }: { item: FeedItem; index: number }) => (
    <ReelItem item={item} active={index === activeIdx} apiClient={apiClient} />
  ), [activeIdx, apiClient]);

  const keyExtractor = useCallback((i: FeedItem) => i.itemId, []);
  const getItemLayout = useCallback((_: unknown, i: number) => ({
    length: SCREEN_H, offset: SCREEN_H * i, index: i,
  }), []);

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="light" />
      {/* Header */}
      <SafeAreaView edges={['top']} style={styles.header}>
        <View style={[styles.modeBar, { backgroundColor: 'transparent' }]}>
          {(['community', 'following'] as const).map(m => (
            <Pressable key={m} onPress={() => reels.switchMode(m)} style={styles.modeBtn}>
              <ThemedText style={[styles.modeLabel,
                reels.mode === m && { color: '#fff', fontWeight: '700' }]}>
                {m === 'community' ? 'Community' : 'Following'}
              </ThemedText>
              {reels.mode === m && <View style={styles.modeLine} />}
            </Pressable>
          ))}
        </View>
      </SafeAreaView>

      <FlatList
        ref={flatRef}
        data={reels.items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemLayout={getItemLayout}
        pagingEnabled
        snapToInterval={SCREEN_H}
        snapToAlignment="start"
        decelerationRate="fast"
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onEndReached={reels.loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={reels.refreshing} onRefresh={reels.refresh} tintColor="#fff" />}
        ListEmptyComponent={
          reels.loading ? undefined : (
            <View style={[styles.empty, { height: SCREEN_H }]}>
              <ThemedText style={styles.emptyIcon}>🎬</ThemedText>
              <ThemedText style={styles.emptyTitle}>No reels yet</ThemedText>
              <ThemedText style={styles.emptyBody}>Be the first to share a video.</ThemedText>
            </View>
          )
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Create reel FAB */}
      <Pressable
        onPress={() => router.push('/(app)/reels/create' as never)}
        style={[styles.fab, { backgroundColor: BrandColors.primary }]}
        accessibilityRole="button" accessibilityLabel="Create reel">
        <ThemedText style={styles.fabText}>+</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  modeBar: { flexDirection: 'row', justifyContent: 'center', paddingTop: Spacing.two },
  modeBtn: { alignItems: 'center', paddingHorizontal: Spacing.four, paddingVertical: Spacing.one },
  modeLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 15, fontWeight: '500' },
  modeLine: { height: 2, width: 32, borderRadius: 1, backgroundColor: '#fff', marginTop: 2 },
  reel: { height: SCREEN_H, backgroundColor: '#000' },
  video: { flex: 1 },
  videoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: 'rgba(255,255,255,0.6)', fontSize: 15 },
  errorIcon: { fontSize: 48 },
  errorText: { color: 'rgba(255,255,255,0.6)', fontSize: 14, marginTop: 8 },
  tapOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  pauseIcon: { fontSize: 60, color: 'rgba(255,255,255,0.8)' },
  actionRail: {
    position: 'absolute', right: Spacing.two, bottom: 120,
    alignItems: 'center', gap: Spacing.three,
  },
  railBtn: { alignItems: 'center' },
  railIcon: { fontSize: 28, color: '#fff' },
  railCount: { fontSize: 11, color: '#fff', marginTop: 2 },
  bottomOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 80,
    padding: Spacing.four, gap: Spacing.one,
  },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontWeight: '700' },
  authorName: { fontSize: 14, fontWeight: '700', color: '#fff' },
  authorMeta: { fontSize: 11, color: 'rgba(255,255,255,0.7)' },
  caption: { fontSize: 14, color: '#fff', lineHeight: 20 },
  empty: { alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  emptyBody: { fontSize: 14, color: 'rgba(255,255,255,0.6)' },
  fab: {
    position: 'absolute', bottom: 100, right: Spacing.four,
    width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  fabText: { fontSize: 26, color: '#fff', lineHeight: 30 },
});
