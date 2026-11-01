/**
 * ComposerBar — Threads-style composer row: avatar · bold username ·
 * muted "What's new?" prompt. Tapping anywhere opens the create-post screen.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/shared/theme/spacing";
import { Avatar } from "./avatar";

interface Props {
  userName?: string | null;
  displayName?: string | null;
  avatarMediaId?: string | null;
}

export function ComposerBar({ userName, displayName, avatarMediaId }: Props) {
  const theme = useTheme();
  const router = useRouter();
  const handle = userName ?? displayName ?? "you";
  return (
    <Pressable
      onPress={() => router.push("/(app)/posts/create" as never)}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: theme.border },
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel="Create a post"
    >
      <Avatar
        name={displayName ?? userName}
        mediaId={avatarMediaId}
        size={48}
      />
      <View style={styles.textCol}>
        <ThemedText style={styles.handle} numberOfLines={1}>
          {handle}
        </ThemedText>
        <ThemedText style={styles.prompt} themeColor="textSecondary">
          What&apos;s new?
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pressed: { opacity: 0.7 },
  textCol: { flex: 1, gap: 2 },
  handle: { fontSize: 17, fontWeight: "700", lineHeight: 22 },
  prompt: { fontSize: 17, fontWeight: "400", lineHeight: 22 },
});
