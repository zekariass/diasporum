/**
 * HomeFeedScreen — home screen with an inline feature switcher.
 * The FeatureNav strip stays fixed below the header; selecting a feature
 * cross-fades to that feature's content panel without any screen navigation
 * (no white flash). Unimplemented features show a "coming soon" alert.
 */

import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
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
import {
  MatchmakingPanel,
  PropertyPanel,
  VehiclesPanel,
  EventsPanel,
  JobsPanel,
  SpareBagPanel,
  BusinessPanel,
  ServicesPanel,
} from "../components/feature-panels";
import { useFeed } from "../hooks/use-feed";
import { createFeedApi } from "../services/feed-api";
import { useSession } from "@/core/session/session-provider";
import { Spacing } from "@/shared/theme/spacing";
import { useTheme } from "@/hooks/use-theme";
import type { FeedItem, Poll, ReportReason } from "../types/feed-types";
import { ApiError } from "@/core/api/api-error";

/** Features that navigate to a separate route rather than swapping inline */
const ROUTE_FEATURES: Record<string, string> = {
  people: "/(app)/(tabs)/explore",
  reels: "/(app)/(tabs)/reels",
  poll: "/(app)/posts/create?mode=poll",
};

/** Unimplemented features — show an alert */
const COMING_SOON = new Set(["help"]);

const REPORT_REASONS: ReportReason[] = [
  "SPAM",
  "SCAM",
  "HARASSMENT",
  "HATE",
  "SEXUAL_MISCONDUCT",
  "MISINFORMATION",
  "IMPERSONATION",
  "PRIVACY",
  "OTHER",
];

export default function HomeFeedScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { session, apiClient } = useSession();
  const feed = useFeed();
  const feedApi = React.useMemo(() => createFeedApi(apiClient), [apiClient]);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  // Active feature key — 'feed' is the default
  const [activeFeature, setActiveFeature] = useState("feed");

  // Smooth cross-fade — useState initializer avoids the react-hooks/refs lint error
  const [fadeAnim] = useState(() => new Animated.Value(1));

  const handleFeatureSelect = useCallback(
    (key: string) => {
      if (key === activeFeature) return;

      // Route-based features → navigate immediately (no panel swap)
      if (ROUTE_FEATURES[key]) {
        router.push(ROUTE_FEATURES[key] as never);
        return;
      }

      // Unimplemented → alert, no state change
      if (COMING_SOON.has(key)) {
        const label =
          key === "help" ? "Community Help & Offers" : "Service Marketplace";
        Alert.alert("Coming soon", `${label} isn't available yet.`);
        return;
      }

      // Panel swap with cross-fade
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 90,
        useNativeDriver: true,
      }).start(() => {
        setActiveFeature(key);
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 140,
          useNativeDriver: true,
        }).start();
      });
    },
    [activeFeature, fadeAnim, router],
  );

  const updatePoll = useCallback((item: FeedItem, poll: Poll) => {
    feed.updatePost(item.sourceId, {
      payload: { ...item.payload, poll },
    });
  }, [feed]);

  const closePoll = useCallback(async (item: FeedItem) => {
    try {
      const updated = await feedApi.closePoll(item.sourceId);
      updatePoll(item, updated);
    } catch (cause) {
      Alert.alert(
        "Could not close poll",
        ApiError.isApiError(cause) ? cause.userMessage : "Please try again.",
      );
    }
  }, [feedApi, updatePoll]);

  const reportPoll = useCallback((item: FeedItem) => {
    Alert.alert("Report poll", "Why are you reporting this poll?", [
      ...REPORT_REASONS.map((reason) => ({
        text: reason.toLowerCase().replaceAll("_", " "),
        onPress: () => {
          void feedApi.reportPost(item.sourceId, { reason })
            .then(() => Alert.alert("Report submitted", "Our moderation team will review it."))
            .catch((cause) => Alert.alert(
              "Could not report poll",
              ApiError.isApiError(cause) ? cause.userMessage : "Please try again.",
            ));
        },
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  }, [feedApi]);

  // ── Feed content ──────────────────────────────────────────────────────────

  const renderFeedItem = useCallback(
    ({ item }: { item: FeedItem }) => {
      const isOwner = item.author?.id === session?.me.id;
      const canManage = isOwner || session?.memberships.some(
        membership => membership.communityId === item.communityId
          && (membership.role === "MODERATOR" || membership.role === "COMMUNITY_ADMIN"),
      );
      return (
        <PostItem
          item={item}
          isOwner={isOwner}
          canManage={canManage}
          onPress={() => router.push(`/(app)/posts/${item.sourceId}` as never)}
          onComment={() => router.push(`/(app)/posts/${item.sourceId}` as never)}
          onReact={(r) => void feed.react(item.sourceId, r)}
          onSave={() => void feed.toggleSave(item.sourceId)}
          onEdit={() =>
            router.push(`/(app)/posts/edit/${item.sourceId}` as never)
          }
          onDelete={() => void feed.deletePost(item.sourceId)}
          onPollVote={item.contentType === "POLL" ? feedApi.vote : undefined}
          onPollChange={(poll) => updatePoll(item, poll)}
          onClosePoll={() => void closePoll(item)}
          onReport={() => reportPoll(item)}
        />
      );
    },
    [closePoll, feed, feedApi, reportPoll, router, session?.me.id, session?.memberships, updatePoll],
  );

  const keyExtractor = useCallback((i: FeedItem) => i.itemId, []);

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

  const feedListHeader = (
    <View>
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
    </View>
  );

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <FeedHeader onMenu={() => setDrawerOpen(true)} />
        <CommunityDrawer
          visible={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />

        {/* FeatureNav stays fixed — always visible regardless of active panel */}
        <FeatureNav activeKey={activeFeature} onSelect={handleFeatureSelect} />

        {/* Animated container cross-fades between feed and feature panels */}
        <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
          {activeFeature === "feed" ? (
            <FlatList
              data={feed.items}
              renderItem={renderFeedItem}
              keyExtractor={keyExtractor}
              ListHeaderComponent={feedListHeader}
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
                    onCreate={() =>
                      router.push("/(app)/posts/create" as never)
                    }
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
                    style={[
                      styles.footerText,
                      { color: theme.textSecondary },
                    ]}
                  >
                    {feed.error} Pull to retry.
                  </ThemedText>
                ) : (
                  <View style={styles.footer} />
                )
              }
              showsVerticalScrollIndicator={false}
            />
          ) : activeFeature === "dating" ? (
            <MatchmakingPanel />
          ) : activeFeature === "property" ? (
            <PropertyPanel />
          ) : activeFeature === "vehicle" ? (
            <VehiclesPanel />
          ) : activeFeature === "event" ? (
            <EventsPanel />
          ) : activeFeature === "jobs" ? (
            <JobsPanel />
          ) : activeFeature === "spare-bag" ? (
            <SpareBagPanel />
          ) : activeFeature === "business" ? (
            <BusinessPanel />
          ) : activeFeature === "services" ? (
            <ServicesPanel />
          ) : null}
        </Animated.View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  content: { flex: 1 },
  footer: { paddingVertical: Spacing.four },
  footerText: {
    textAlign: "center",
    paddingVertical: Spacing.three,
    fontSize: 13,
  },
});
