/**
 * ProfileStats — compact three-column statistics card (posts / followers /
 * following). Counts render as "—" until the first page arrives.
 */

import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";

interface Props {
  posts: number | null;
  followers: number | null;
  following: number | null;
  onPostsPress?: () => void;
}

function Stat({
  count,
  label,
  onPress,
}: {
  count: number | null;
  label: string;
  onPress?: () => void;
}) {
  const body = (
    <>
      <ThemedText style={styles.count}>{count ?? "—"}</ThemedText>
      <ThemedText style={styles.label} themeColor="textSecondary">
        {label}
      </ThemedText>
    </>
  );
  if (!onPress) {
    return <View style={styles.stat}>{body}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${count ?? 0} ${label} — show my ${label.toLowerCase()}`}
      style={({ pressed }) => [styles.stat, pressed && { opacity: 0.7 }]}
    >
      {body}
    </Pressable>
  );
}

export function ProfileStats({
  posts,
  followers,
  following,
  onPostsPress,
}: Props) {
  const theme = useTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: theme.backgroundElement }]}
      accessibilityLabel="Profile statistics"
    >
      <Stat count={posts} label="Posts" onPress={onPostsPress} />
      <Stat count={followers} label="Followers" />
      <Stat count={following} label="Following" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    marginHorizontal: Spacing.three,
    marginTop: Spacing.three,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.two + 2,
  },
  stat: { flex: 1, alignItems: "center", gap: 1 },
  count: { fontSize: 18, fontWeight: "800", lineHeight: 24 },
  label: { fontSize: 12, lineHeight: 16 },
});
