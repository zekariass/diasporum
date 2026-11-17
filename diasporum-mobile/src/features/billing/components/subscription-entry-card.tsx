/** Profile entry point to the member's subscription / billing screens. */

import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";

export function SubscriptionEntryCard({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Open subscription"
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.backgroundElement },
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name="card-outline" size={22} color={theme.primary} />
      <View style={styles.copy}>
        <ThemedText style={styles.title}>Subscription</ThemedText>
        <ThemedText style={styles.subtitle} themeColor="textSecondary">
          View your plan, pay or renew
        </ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
  },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: "800", lineHeight: 20 },
  subtitle: { fontSize: 12, lineHeight: 16 },
  pressed: { opacity: 0.8 },
});
