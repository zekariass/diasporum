/**
 * Shared content-section states for the profile tabs — section header,
 * loading skeleton, empty state, error row, media grid tile.
 */

import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { MediaImage } from "@/features/feed/components/media-image";
import type { FeedItem } from "@/features/feed/types/feed-types";
import type { IconName } from "../types/profile-content";

/** "My X" section title + optional count + optional See all link. */
export function SectionHeader({
  title,
  count,
  seeAllLabel,
  onSeeAll,
}: {
  title: string;
  count: number | null;
  seeAllLabel?: string;
  onSeeAll?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      {count != null ? (
        <ThemedText style={styles.sectionCount} themeColor="textSecondary">
          {count}
        </ThemedText>
      ) : null}
      <View style={styles.flex} />
      {onSeeAll ? (
        <Pressable
          onPress={onSeeAll}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={seeAllLabel ?? `See all ${title}`}
        >
          <ThemedText style={[styles.seeAll, { color: theme.primary }]}>
            See all
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Neutral loading block shown while a tab fetches its first page. */
export function ProfileListSkeleton() {
  const theme = useTheme();
  return (
    <View
      style={styles.skeletonWrap}
      accessibilityLabel="Loading content"
      accessibilityRole="progressbar"
    >
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={[styles.skeletonRow, { backgroundColor: theme.backgroundElement }]}
        >
          <View style={[styles.skeletonAvatar, { backgroundColor: theme.border }]} />
          <View style={styles.skeletonLines}>
            <View style={[styles.skeletonLine, { backgroundColor: theme.border, width: "55%" }]} />
            <View style={[styles.skeletonLine, { backgroundColor: theme.border, width: "85%" }]} />
            <View style={[styles.skeletonLine, { backgroundColor: theme.border, width: "70%" }]} />
          </View>
        </View>
      ))}
      <ActivityIndicator style={styles.skeletonSpinner} color={BrandColors.primary} />
    </View>
  );
}

/** Empty tab content — explains what appears here + optional create CTA. */
export function ProfileEmpty({
  icon,
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon: IconName;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundElement }]}>
        <Ionicons name={icon} size={30} color={theme.textSecondary} />
      </View>
      <ThemedText style={styles.emptyTitle}>{title}</ThemedText>
      <ThemedText style={styles.emptyMessage} themeColor="textSecondary">
        {message}
      </ThemedText>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [
            styles.emptyCta,
            { backgroundColor: theme.primary },
            pressed && { opacity: 0.85 },
          ]}
        >
          <ThemedText style={styles.emptyCtaText}>{actionLabel}</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Inline error with retry — used both for empty lists and page failures. */
export function ProfileError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.errorWrap} accessibilityRole="alert">
      <ThemedText style={styles.errorText} themeColor="textSecondary">
        {message}
      </ThemedText>
      <Pressable
        onPress={onRetry}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Retry loading content"
      >
        <ThemedText style={[styles.retry, { color: theme.primary }]}>
          Retry
        </ThemedText>
      </Pressable>
    </View>
  );
}

/** Square media tile for the Media tab grid — opens the owning post. */
export function MediaTile({
  post,
  mediaId,
  onPress,
}: {
  post: FeedItem;
  mediaId: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const multi = post.mediaIds.length > 1;
  const isVideo = post.contentType === "REEL";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        isVideo ? "Open video post" : "Open post image"
      }
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: theme.backgroundElement },
        pressed && { opacity: 0.85 },
      ]}
    >
      <MediaImage mediaId={mediaId} style={styles.tileImage} />
      {multi || isVideo ? (
        <View style={styles.tileBadge}>
          <Ionicons
            name={isVideo ? "play" : "copy-outline"}
            size={13}
            color="#FFFFFF"
          />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.three,
    marginBottom: Spacing.one,
  },
  sectionTitle: { fontSize: 16, fontWeight: "800", lineHeight: 22 },
  sectionCount: { fontSize: 13, lineHeight: 18 },
  seeAll: { fontSize: 13, fontWeight: "700" },

  skeletonWrap: { paddingVertical: Spacing.three, gap: Spacing.three },
  skeletonRow: {
    flexDirection: "row",
    gap: Spacing.three,
    marginHorizontal: Spacing.three,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
  },
  skeletonAvatar: { width: 40, height: 40, borderRadius: 20 },
  skeletonLines: { flex: 1, gap: 8, justifyContent: "center" },
  skeletonLine: { height: 10, borderRadius: 5 },
  skeletonSpinner: { marginTop: Spacing.one },

  empty: {
    alignItems: "center",
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    gap: Spacing.two,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.one,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", textAlign: "center" },
  emptyMessage: { fontSize: 13, lineHeight: 19, textAlign: "center" },
  emptyCta: {
    marginTop: Spacing.two,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: 9,
  },
  emptyCtaText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },

  errorWrap: {
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.five,
    paddingHorizontal: Spacing.four,
  },
  errorText: { fontSize: 14, textAlign: "center" },
  retry: { fontSize: 14, fontWeight: "700" },

  tile: { flex: 1, aspectRatio: 1 },
  tileImage: { width: "100%", aspectRatio: 1, borderRadius: 0 },
  tileBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 10,
    padding: 3,
  },
});
