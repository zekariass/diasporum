/**
 * FeedHeader — Threads-style top bar: ☰ (community switcher) · centred
 * brand mark · search. Transparent on the page background, no divider.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { Spacing } from "@/shared/theme/spacing";

export function FeedHeader({ onMenu }: { onMenu: () => void }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => router.push("/(app)/(tabs)/explore" as never)}
        hitSlop={10}
        style={styles.side}
        accessibilityRole="button"
        accessibilityLabel="Search"
      >
        <Ionicons name="search-outline" size={26} color={theme.text} />
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

      <Pressable
        onPress={onMenu}
        hitSlop={10}
        style={[styles.side, styles.sideRight]}
        accessibilityRole="button"
        accessibilityLabel="Switch community"
      >
        <Ionicons name="menu-outline" size={30} color={theme.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
    height: 56,
  },
  side: { width: 44, alignItems: "flex-start", justifyContent: "center" },
  sideRight: { alignItems: "flex-end" },
  brand: { flexDirection: "row", alignItems: "center", gap: 6 },
  logoBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  logoLetter: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFF",
    lineHeight: 18,
  },
  wordmark: {
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.8,
    fontStyle: "italic",
    lineHeight: 30,
  },
});
