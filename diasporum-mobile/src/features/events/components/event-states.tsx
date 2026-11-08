/**
 * Event list states — skeleton rows for loading and empty-state notice.
 */

import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";

export function EventsSkeleton() {
  const theme = useTheme();
  const bg = { backgroundColor: theme.backgroundSelected };
  return (
    <View accessibilityLabel="Loading events">
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={[
            styles.skRow,
            { borderColor: theme.border, backgroundColor: theme.backgroundElement },
          ]}
        >
          <View style={[styles.skCover, bg]} />
          <View style={styles.skBody}>
            <View style={[styles.skLine, bg, { width: "38%" }]} />
            <View style={[styles.skLine, bg, { width: "90%" }]} />
            <View style={[styles.skLine, bg, { width: "55%" }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function EventsEmpty({
  filtered,
  title,
  message,
  actionLabel,
  onAction,
}: {
  filtered?: boolean;
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <View
        style={[styles.emptyIcon, { backgroundColor: theme.backgroundElement }]}
      >
        <Ionicons
          name="calendar-outline"
          size={28}
          color={theme.textSecondary}
        />
      </View>
      <ThemedText style={styles.emptyTitle}>
        {title ?? (filtered ? "No events match" : "No events yet")}
      </ThemedText>
      <ThemedText style={styles.emptyBody} themeColor="textSecondary">
        {message ??
          (filtered
            ? "Try changing the filters or search."
            : "Events from your communities and country will appear here.")}
      </ThemedText>
      {actionLabel && onAction && (
        <Pressable
          onPress={onAction}
          style={[styles.emptyBtn, { backgroundColor: theme.text }]}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <ThemedText
            style={[styles.emptyBtnText, { color: theme.background }]}
          >
            {actionLabel}
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  skRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.lg,
    marginHorizontal: Spacing.one,
    marginVertical: Spacing.two,
    padding: Spacing.two,
  },
  skCover: { width: "100%", aspectRatio: 16 / 9, borderRadius: BorderRadius.md },
  skBody: { gap: 10, padding: Spacing.two, paddingTop: Spacing.three },
  skLine: { height: 12, borderRadius: 6 },
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
