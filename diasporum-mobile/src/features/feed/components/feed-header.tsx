/**
 * FeedHeader — compact brand bar. Left: hamburger for the feature drawer.
 * Right: search + community switching (opens the right-side drawer).
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { useNavigationDrawers } from "@/core/navigation/drawer-context";

export function FeedHeader() {
  const theme = useTheme();
  const router = useRouter();
  const { openLeft, openRight } = useNavigationDrawers();
  return (
    <View style={styles.row}>
      <Pressable
        onPress={openLeft}
        hitSlop={10}
        style={[styles.side, { backgroundColor: theme.backgroundElement }]}
        accessibilityRole="button"
        accessibilityLabel="Open navigation menu"
      >
        <Ionicons name="menu-outline" size={24} color={theme.text} />
      </Pressable>

      <View
        style={styles.brand}
        accessibilityRole="header"
        accessibilityLabel="Diasporum"
      >
        <View
          style={[styles.logoBadge, { backgroundColor: BrandColors.primary }]}
        >
          <ThemedText style={styles.logoLetter}>D</ThemedText>
        </View>
        <ThemedText style={styles.wordmark}>diasporum</ThemedText>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={() => router.push("/(app)/(tabs)/explore" as never)}
          hitSlop={10}
          style={[styles.side, { backgroundColor: theme.backgroundElement }]}
          accessibilityRole="button"
          accessibilityLabel="Search"
        >
          <Ionicons name="search-outline" size={22} color={theme.text} />
        </Pressable>
        <Pressable
          onPress={openRight}
          hitSlop={10}
          style={[styles.side, { backgroundColor: theme.backgroundElement }]}
          accessibilityRole="button"
          accessibilityLabel="Switch community"
        >
          <Ionicons name="swap-horizontal-outline" size={24} color={theme.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    height: 60,
  },
  side: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  logoBadge: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  logoLetter: {
    fontSize: 16,
    fontWeight: "800",
    color: BrandColors.white,
    lineHeight: 20,
  },
  wordmark: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.9,
    lineHeight: 29,
  },
});
