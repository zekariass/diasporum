/**
 * HomeFeedScreen — the "Posts" destination: the community timeline plus the
 * FeatureNav strip that switches between the four content experiences
 * (Feed, Vids, Help, Polls). Feature navigation lives in the left drawer;
 * community switching in the right drawer — both mounted at the (app) layout.
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
import { useFocusEffect, useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { PostItem } from "../components/post-item";
import { FeedHeader } from "../components/feed-header";
import { FeatureNav } from "../components/feature-nav";
import { ComposerBar } from "../components/composer-bar";
import { CategoryFilter } from "../components/feed-controls";
import { FeedSkeleton, FeedEmpty } from "../components/feed-states";
import { useFeed } from "../hooks/use-feed";
import { createFeedApi } from "../services/feed-api";
import { openPostDetail } from "../utils/post-detail-seed";
import { useSession } from "@/core/session/session-provider";
import { Spacing } from "@/shared/theme/spacing";
import { useTheme } from "@/hooks/use-theme";
import type { FeedItem, Poll, ReportReason } from "../types/feed-types";
import { ApiError } from "@/core/api/api-error";
import {
  FEATURE_MODULE_KEYS,
  isCommunityModuleEnabled,
} from "@/core/session/community-capabilities";

/** Content experiences that live on their own route rather than inline */
const ROUTE_FEATURES: Record<string, string> = {
  reels: "/(app)/reels",
  help: "/(app)/posts/create?mode=help",
  poll: "/(app)/posts/create?mode=poll",
};

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

  // Active feature key — 'feed' is the default and the safe capability fallback
  const [selectedFeature, setSelectedFeature] = useState("feed");
  const selectedModuleKey = FEATURE_MODULE_KEYS[selectedFeature];
  const activeFeature =
    selectedModuleKey &&
    !isCommunityModuleEnabled(session?.access, selectedModuleKey)
      ? "feed"
      : selectedFeature;

  // Smooth cross-fade — useState initializer avoids the react-hooks/refs lint error
  const [fadeAnim] = useState(() => new Animated.Value(1));

  const handleFeatureSelect = useCallback(
    (key: string) => {
      if (key === activeFeature) return;
      const moduleKey = FEATURE_MODULE_KEYS[key];
      if (moduleKey && !isCommunityModuleEnabled(session?.access, moduleKey))
        return;

      // Route-based features → navigate immediately (no panel swap)
      if (ROUTE_FEATURES[key]) {
        router.push(ROUTE_FEATURES[key] as never);
        return;
      }

      // Panel swap with cross-fade
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 90,
        useNativeDriver: true,
      }).start(() => {
        setSelectedFeature(key);
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 140,
          useNativeDriver: true,
        }).start();
      });
    },
    [activeFeature, fadeAnim, router, session?.access],
  );

  const updatePoll = useCallback(
    (item: FeedItem, poll: Poll) => {
      feed.updatePost(item.sourceId, {
        payload: { ...item.payload, poll },
      });
    },
    [feed],
  );

  const closePoll = useCallback(
    async (item: FeedItem) => {
      try {
        const updated = await feedApi.closePoll(item.sourceId);
        updatePoll(item, updated);
      } catch (cause) {
        Alert.alert(
          "Could not close poll",
          ApiError.isApiError(cause) ? cause.userMessage : "Please try again.",
        );
      }
    },
    [feedApi, updatePoll],
  );

  const reportPoll = useCallback(
    (item: FeedItem) => {
      Alert.alert("Report poll", "Why are you reporting this poll?", [
        ...REPORT_REASONS.map((reason) => ({
          text: reason.toLowerCase().replaceAll("_", " "),
          onPress: () => {
            void feedApi
              .reportPost(item.sourceId, { reason })
              .then(() =>
                Alert.alert(
                  "Report submitted",
                  "Our moderation team will review it.",
                ),
              )
              .catch((cause) =>
                Alert.alert(
                  "Could not report poll",
                  ApiError.isApiError(cause)
                    ? cause.userMessage
                    : "Please try again.",
                ),
              );
          },
        })),
        { text: "Cancel", style: "cancel" as const },
      ]);
    },
    [feedApi],
  );

  // ── Feed content ──────────────────────────────────────────────────────────

  // Refetch the last opened post on return — picks up comments/likes/saves
  // made on the detail screen so counts stay current without a full refresh.
  const openedPostRef = useRef<string | null>(null);
  const { updatePost } = feed;
  useFocusEffect(
    useCallback(() => {
      const postId = openedPostRef.current;
      if (!postId) return;
      openedPostRef.current = null;
      void feedApi
        .getPost(postId)
        .then((detail) =>
          updatePost(postId, {
            commentCount: detail.post.commentCount,
            reactionCount: detail.post.reactionCount,
            shareCount: detail.post.shareCount,
          }),
        )
        .catch(() => {});
    }, [feedApi, updatePost]),
  );

  const openPost = useCallback(
    (item: FeedItem) => {
      openedPostRef.current = item.sourceId;
      openPostDetail(router, item);
    },
    [router],
  );

  const renderFeedItem = useCallback(
    ({ item }: { item: FeedItem }) => {
      const isOwner = item.author?.id === session?.me.id;
      const canManage =
        isOwner ||
        session?.memberships.some(
          (membership) =>
            membership.communityId === item.communityId &&
            (membership.role === "MODERATOR" ||
              membership.role === "COMMUNITY_ADMIN"),
        );
      return (
        <PostItem
          item={item}
          isOwner={isOwner}
          canManage={canManage}
          onPress={() => openPost(item)}
          onComment={() => openPost(item)}
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
    [
      closePoll,
      feed,
      feedApi,
      openPost,
      reportPoll,
      router,
      session?.me.id,
      session?.memberships,
      updatePoll,
    ],
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
        <FeedHeader />

        {/* FeatureNav stays fixed — the Posts experiences (Feed/Vids/Help/Polls) */}
        <FeatureNav activeKey={activeFeature} onSelect={handleFeatureSelect} />

        {/* Animated container cross-fades between content experiences */}
        <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
          {activeFeature === "feed" ? (
            <FlatList
              data={feed.items}
              renderItem={renderFeedItem}
              keyExtractor={keyExtractor}
              style={[
                styles.feedList,
                { backgroundColor: theme.backgroundElement },
              ]}
              contentContainerStyle={styles.feedContent}
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
              keyboardShouldPersistTaps="handled"
            />
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
  feedList: { flex: 1 },
  feedContent: { paddingBottom: Spacing.six, flexGrow: 1 },
  footer: { paddingVertical: Spacing.four },
  footerText: {
    textAlign: "center",
    paddingVertical: Spacing.three,
    fontSize: 13,
  },
});
