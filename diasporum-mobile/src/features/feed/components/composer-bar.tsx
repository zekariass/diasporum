/**
 * ComposerBar — compact creation card with direct post, poll and help links.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
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
    <View
      style={[
        styles.container,
        { backgroundColor: theme.background, borderColor: theme.border },
      ]}
    >
      <Pressable
        onPress={() => openComposer()}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Create a post"
      >
        <Avatar
          name={displayName ?? userName}
          mediaId={avatarMediaId}
          size={44}
        />
        <View style={styles.textCol}>
          <ThemedText style={styles.handle} numberOfLines={1}>
            {handle}
          </ThemedText>
          <ThemedText style={styles.prompt} themeColor="textSecondary">
            Share something with your community…
          </ThemedText>
        </View>
        <View
          style={[styles.createIcon, { backgroundColor: theme.primarySurface }]}
        >
          <Ionicons name="add" size={22} color={theme.primary} />
        </View>
      </Pressable>

      <View style={[styles.quickActions, { borderTopColor: theme.border }]}>
        <Pressable
          onPress={() => openComposer()}
          style={({ pressed }) => [
            styles.quickAction,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Create a photo post"
        >
          <Ionicons name="image-outline" size={18} color={theme.primary} />
          <ThemedText style={styles.quickLabel}>Photo</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => openComposer("poll")}
          style={({ pressed }) => [
            styles.quickAction,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Create a poll"
        >
          <Ionicons
            name="stats-chart-outline"
            size={18}
            color={theme.primary}
          />
          <ThemedText style={styles.quickLabel}>Poll</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => openComposer("help")}
          style={({ pressed }) => [
            styles.quickAction,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Create a help post"
        >
          <Ionicons name="hand-left-outline" size={18} color={theme.primary} />
          <ThemedText style={styles.quickLabel}>Help</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "97%",
    maxWidth: 720,
    alignSelf: "center",
    marginTop: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.xl,
    overflow: "hidden",
    shadowColor: BrandColors.black,
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three - 2,
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three - 2,
  },
  pressed: { opacity: 0.6 },
  textCol: { flex: 1, minWidth: 0, gap: 1 },
  handle: { fontSize: 14, fontWeight: "700", lineHeight: 19 },
  prompt: { fontSize: 14, fontWeight: "400", lineHeight: 20 },
  createIcon: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  quickActions: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  quickAction: {
    flex: 1,
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: BorderRadius.md,
  },
  quickLabel: { fontSize: 12, fontWeight: "600", lineHeight: 17 },
});
