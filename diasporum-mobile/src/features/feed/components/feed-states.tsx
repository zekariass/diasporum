/**
 * Feed states — FeedSkeleton (animated loading placeholders), FeedError and
 * FeedEmpty.
 */
import React, { useEffect, useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";

export function FeedSkeleton() {
  const theme = useTheme();
  const bg = { backgroundColor: theme.backgroundElement };
  const [pulse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={{ opacity: pulse }}
      accessibilityLabel="Loading feed"
    >
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          style={[styles.skRow, { borderBottomColor: theme.border }]}
        >
          <View style={styles.skAvatarCol}>
            <View style={[styles.skAvatar, bg]} />
            {i % 2 === 0 ? <View style={[styles.skThread, bg]} /> : null}
          </View>
          <View style={styles.skBody}>
            <View style={[styles.skLine, bg, { width: "40%" }]} />
            <View style={[styles.skLine, bg, { width: "92%" }]} />
            <View style={[styles.skLine, bg, { width: "70%" }]} />
            {i === 0 && <View style={[styles.skMedia, bg]} />}
            <View style={styles.skActions}>
              {[0, 1, 2].map((a) => (
                <View key={a} style={[styles.skIcon, bg]} />
              ))}
            </View>
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

export function FeedError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <View
        style={[styles.emptyIcon, { backgroundColor: theme.primarySurface }]}
      >
        <Ionicons
          name="cloud-offline-outline"
          size={28}
          color={theme.primary}
        />
      </View>
      <ThemedText style={styles.emptyTitle}>Couldn&apos;t load the feed</ThemedText>
      <ThemedText style={styles.emptyBody} themeColor="textSecondary">
        {message}
      </ThemedText>
      <Pressable
        onPress={onRetry}
        style={[styles.emptyBtn, { backgroundColor: theme.primary }]}
        accessibilityRole="button"
        accessibilityLabel="Retry loading the feed"
      >
        <ThemedText style={[styles.emptyBtnText, { color: "#FFFFFF" }]}>
          Try again
        </ThemedText>
      </Pressable>
    </View>
  );
}

export function FeedEmpty({
  filtered,
  onCreate,
  onClear,
}: {
  filtered: boolean;
  onCreate: () => void;
  onClear: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <View
        style={[styles.emptyIcon, { backgroundColor: theme.primarySurface }]}
      >
        <Ionicons name="chatbubbles-outline" size={28} color={theme.primary} />
      </View>
      <ThemedText style={styles.emptyTitle}>
        {filtered ? "Nothing in this category yet" : "No posts yet"}
      </ThemedText>
      <ThemedText style={styles.emptyBody} themeColor="textSecondary">
        {filtered
          ? "No community posts match this filter yet."
          : "Be the first to share with your community."}
      </ThemedText>
      <Pressable
        onPress={filtered ? onClear : onCreate}
        style={[styles.emptyBtn, { backgroundColor: theme.primary }]}
        accessibilityRole="button"
      >
        <ThemedText style={[styles.emptyBtnText, { color: "#FFFFFF" }]}>
          {filtered ? "Show all posts" : "Create a post"}
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  skRow: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: Spacing.three,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  skAvatarCol: { width: 42, alignItems: "center" },
  skAvatar: { width: 42, height: 42, borderRadius: 21 },
  skThread: { width: 2, flexGrow: 1, marginTop: 6, borderRadius: 1, minHeight: 20 },
  skBody: { flex: 1, gap: 10, paddingTop: 4 },
  skLine: { height: 12, borderRadius: 6 },
  skMedia: { width: "72%", height: 220, borderRadius: 12, marginTop: 4 },
  skActions: { flexDirection: "row", gap: 26, marginTop: 6 },
  skIcon: { width: 22, height: 22, borderRadius: 11 },
  empty: {
    alignItems: "center",
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    marginTop: Spacing.three,
    paddingVertical: Spacing.six,
    gap: Spacing.two,
    paddingHorizontal: Spacing.three - Spacing.one,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.one,
  },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  emptyBody: { textAlign: "center", fontSize: 14, lineHeight: 20 },
  emptyBtn: {
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: 10,
    borderRadius: BorderRadius.full,
  },
  emptyBtnText: { fontWeight: "700", fontSize: 14 },
});
