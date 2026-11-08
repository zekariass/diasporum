/**
 * TagFeedScreen — community-scoped posts for one hashtag.
 * Route: /(app)/posts/tag/[tag]
 * Visibility/membership/block/moderation rules enforced server-side.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, router } from "expo-router";
import { safeBack } from "@/core/navigation/safe-back";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { ErrorState } from "@/shared/components/error-state";
import { useSession } from "@/core/session/session-provider";
import { createFeedApi } from "@/features/feed/services/feed-api";
import { PostItem } from "@/features/feed/components/post-item";
import { openPostDetail } from "@/features/feed/utils/post-detail-seed";
import type { FeedItem } from "@/features/feed/types/feed-types";
import { BrandColors } from "@/shared/theme/colors";
import { Spacing } from "@/shared/theme/spacing";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";

export default function TagFeedScreen() {
  const { tag } = useLocalSearchParams<{ tag: string }>();
  const theme = useTheme();
  const { apiClient, session } = useSession();
  const feedApi = React.useMemo(() => createFeedApi(apiClient), [apiClient]);

  const [items, setItems] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadingMore = useRef(false);
  const communityId = session?.activeCommunityId ?? "";

  const load = useCallback(async () => {
    if (!communityId) {
      setError("No active community.");
      setLoading(false);
      return;
    }
    try {
      const page = await feedApi.tagFeed(tag, communityId);
      setItems(page.items);
      setCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(ApiError.isApiError(err) ? err.userMessage : "Failed to load posts.");
    } finally {
      setLoading(false);
    }
  }, [feedApi, tag, communityId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const page = await feedApi.tagFeed(tag, communityId, cursor);
      setItems((prev) => [
        ...prev,
        ...page.items.filter((i) => !prev.some((e) => e.itemId === i.itemId)),
      ]);
      setCursor(page.nextCursor);
    } catch {
      /* footer retry via pull */
    } finally {
      loadingMore.current = false;
    }
  }, [cursor, feedApi, tag, communityId]);

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.navBar, { borderBottomColor: theme.border }]}>
          <Pressable onPress={() => safeBack()} hitSlop={8} accessibilityLabel="Back">
            <ThemedText style={[styles.backBtn, { color: BrandColors.primary }]}>
              ←
            </ThemedText>
          </Pressable>
          <ThemedText style={styles.navTitle} numberOfLines={1}>
            #{tag}
          </ThemedText>
        </View>
        <FlatList
          data={items}
          keyExtractor={(i) => i.itemId}
          renderItem={({ item }) => (
            <PostItem
              item={item}
              isOwner={item.author?.id === session?.me.id}
              onPress={() => openPostDetail(router, item)}
              onComment={() => openPostDetail(router, item)}
            />
          )}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <ThemedText style={styles.empty} themeColor="textSecondary">
              No posts with #{tag} yet.
            </ThemedText>
          }
          showsVerticalScrollIndicator={false}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { fontSize: 22 },
  navTitle: { fontSize: 16, fontWeight: "600", flex: 1 },
  empty: { textAlign: "center", paddingVertical: Spacing.five, fontSize: 14 },
});
