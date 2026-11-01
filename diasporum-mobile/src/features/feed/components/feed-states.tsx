/**
 * Feed states — FeedSkeleton (loading placeholders) and FeedEmpty.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";

export function FeedSkeleton() {
  const theme = useTheme();
  const bg = { backgroundColor: theme.backgroundElement };
  return (
    <View accessibilityLabel="Loading feed">
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={[styles.skRow, { borderBottomColor: theme.border }]}
        >
          <View style={[styles.skAvatar, bg]} />
          <View style={styles.skBody}>
            <View style={[styles.skLine, bg, { width: "40%" }]} />
            <View style={[styles.skLine, bg, { width: "92%" }]} />
            <View style={[styles.skLine, bg, { width: "70%" }]} />
            {i === 0 && <View style={[styles.skMedia, bg]} />}
            <View style={styles.skActions}>
              {[0, 1, 2, 3].map((a) => (
                <View key={a} style={[styles.skIcon, bg]} />
              ))}
            </View>
          </View>
        </View>
      ))}
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
        style={[styles.emptyIcon, { backgroundColor: theme.backgroundElement }]}
      >
        <Ionicons
          name="chatbubbles-outline"
          size={28}
          color={theme.textSecondary}
        />
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
        style={[styles.emptyBtn, { backgroundColor: theme.text }]}
        accessibilityRole="button"
      >
        <ThemedText style={[styles.emptyBtnText, { color: theme.background }]}>
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
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  skAvatar: { width: 40, height: 40, borderRadius: 20 },
  skBody: { flex: 1, gap: 10, paddingTop: 4 },
  skLine: { height: 12, borderRadius: 6 },
  skMedia: { width: "72%", height: 220, borderRadius: 12, marginTop: 4 },
  skActions: { flexDirection: "row", gap: 26, marginTop: 6 },
  skIcon: { width: 22, height: 22, borderRadius: 11 },
  empty: {
    alignItems: "center",
    paddingTop: Spacing.six,
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
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
