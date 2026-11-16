/**
 * ComposerBar — compact creation card with direct post, poll and help links.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
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
  const openComposer = (mode?: "poll" | "help") => {
    router.push({
      pathname: "/(app)/posts/create",
      params: mode ? { mode } : {},
    } as never);
  };

  return (
    <Pressable
      onPress={() => openComposer()}
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
        size={42}
      />
      <View style={styles.textCol}>
        <ThemedText style={styles.handle} numberOfLines={1}>
          {handle}
        </ThemedText>
        <ThemedText style={styles.prompt} themeColor="textSecondary">
          What&apos;s new?
        </ThemedText>
      </View>
      <View style={styles.quickIcons}>
        <Pressable
          onPress={() => openComposer()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Create a photo post"
        >
          <Ionicons
            name="image-outline"
            size={20}
            color={theme.textSecondary}
          />
        </Pressable>
        <Pressable
          onPress={() => openComposer("poll")}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Create a poll"
        >
          <Ionicons
            name="stats-chart-outline"
            size={19}
            color={theme.textSecondary}
          />
        </Pressable>
        <Pressable
          onPress={() => openComposer("help")}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Create a help post"
        >
          <Ionicons
            name="hand-left-outline"
            size={19}
            color={theme.textSecondary}
          />
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three - 2,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pressed: { opacity: 0.6 },
  textCol: { flex: 1, minWidth: 0, gap: 1 },
  handle: { fontSize: 14, fontWeight: "700", lineHeight: 19 },
  prompt: { fontSize: 14, fontWeight: "400", lineHeight: 20 },
  quickIcons: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three - 2,
    paddingLeft: Spacing.two,
  },
});
