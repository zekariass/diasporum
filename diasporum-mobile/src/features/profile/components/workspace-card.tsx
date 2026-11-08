/**
 * WorkspaceCard — prominent Business Workspace entry on the personal profile.
 * Routes to the existing business accounts/workspace flow.
 */

import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";

export function WorkspaceCard({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Open Business Workspace"
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.primarySurface },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.iconTile, { backgroundColor: theme.background }]}>
        <Ionicons name="briefcase" size={22} color={theme.primary} />
      </View>
      <View style={styles.copy}>
        <ThemedText style={styles.title}>Business Workspace</ThemedText>
        <ThemedText style={styles.subtitle} themeColor="textSecondary">
          Manage your businesses, listings and team
        </ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.three,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
  },
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: "800", lineHeight: 20 },
  subtitle: { fontSize: 12, lineHeight: 16 },
  pressed: { opacity: 0.8 },
});
