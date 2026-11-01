/**
 * HomeFeedScreen — Threads-style community timeline.
 * Chrome: ☰ · brand · search → composer row → one quiet context row
 * (community · For you/Latest) → category chips → posts. Everything above the
 * posts scrolls with the list; only the header stays fixed.
 */

import React, { useCallback, useRef } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { PostItem } from "../components/post-item";
import { FeedHeader } from "../components/feed-header";
import { CommunityDrawer } from "../components/community-drawer";
import { FeatureNav } from "../components/feature-nav";
import { ComposerBar } from "../components/composer-bar";
import { CategoryFilter } from "../components/feed-controls";
import { FeedSkeleton, FeedEmpty } from "../components/feed-states";
import { useFeed } from "../hooks/use-feed";
import { createFeedApi } from "../services/feed-api";
import { useSession } from "@/core/session/session-provider";
import { Spacing } from "@/shared/theme/spacing";
import { useTheme } from "@/hooks/use-theme";
import type { FeedItem } from "../types/feed-types";

export default function HomeFeedScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { session, apiClient } = useSession();
  const feed = useFeed();
  const feedApi = React.useMemo(() => createFeedApi(apiClient), [apiClient]);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => (
      <PostItem
        item={item}
        isOwner={item.author?.id === session?.me.id}
        onPress={() => router.push(`/(app)/posts/${item.sourceId}` as never)}
        onComment={() => router.push(`/(app)/posts/${item.sourceId}` as never)}
        onReact={(r) => void feed.react(item.sourceId, r)}
        onSave={() => void feed.toggleSave(item.sourceId)}
        onEdit={() =>
          router.push(`/(app)/posts/edit/${item.sourceId}` as never)
        }
        onDelete={() => void feed.deletePost(item.sourceId)}
      />
    ),
    [feed, router, session?.me.id],
  );

  const keyExtractor = useCallback((i: FeedItem) => i.itemId, []);

  // View tracking — deduplicated, ≥50% visibility marks the post viewed.
  const viewedRef = useRef(new Set<string>());
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { item: unknown }[] }) => {
      for (const token of viewableItems) {
        const item = token.item as FeedItem;
        if (!viewedRef.current.has(item.sourceId)) {
          viewedRef.current.add(item.sourceId);
          void feedApi.recordView("FEED_POST", item.sourceId);
        }
      }
    },
    [feedApi],
  );
  const viewabilityConfig = { itemVisiblePercentThreshold: 50 };

  const listHeader = (
    <View>
      <FeatureNav />
      <ComposerBar
        userName={session?.profile?.username}
        displayName={session?.profile?.displayName ?? session?.me.email}
        avatarMediaId={session?.profile?.avatarMediaId}
      />
      <CategoryFilter
        categories={feed.categories}
        selected={feed.categoryId}
        onSelect={feed.setCategory}
      />
      <View style={[styles.divider, { backgroundColor: theme.border }]} />
    </View>
  );

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <FeedHeader onMenu={() => setDrawerOpen(true)} />
        <CommunityDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} />

        <FlatList
          data={feed.items}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ListHeaderComponent={listHeader}
          onEndReached={feed.loadMore}
          onEndReachedThreshold={0.4}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          refreshControl={
            <RefreshControl
              refreshing={feed.refreshing}
              onRefresh={feed.refresh}
              tintColor={theme.textSecondary}
              colors={[theme.text]}
            />
          }
          ListEmptyComponent={
            feed.loading ? (
              <FeedSkeleton />
            ) : (
              <FeedEmpty
                filtered={feed.categoryId != null}
                onCreate={() => router.push("/(app)/posts/create" as never)}
                onClear={() => feed.setCategory(null)}
              />
            )
          }
          ListFooterComponent={
            feed.loadingMore ? (
              <ActivityIndicator
                style={styles.footer}
                color={theme.textSecondary}
              />
            ) : feed.error ? (
              <ThemedText
                style={[styles.footerText, { color: theme.textSecondary }]}
              >
                {feed.error} Pull to retry.
              </ThemedText>
            ) : (
              <View style={styles.footer} />
            )
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
  divider: { height: StyleSheet.hairlineWidth, marginTop: Spacing.one },
  footer: { paddingVertical: Spacing.four },
  footerText: {
    textAlign: "center",
    paddingVertical: Spacing.three,
    fontSize: 13,
  },
});
