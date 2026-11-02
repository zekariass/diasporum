import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";

export function PropertiesSkeleton() {
  const theme = useTheme();
  return (
    <View accessibilityLabel="Loading properties">
      {[0, 1, 2].map((key) => (
        <View key={key} style={[styles.card, { borderColor: theme.border }]}>
          <View style={[styles.image, { backgroundColor: theme.backgroundElement }]} />
          <View style={styles.lines}>
            {[70, 90, 50].map((width) => (
              <View
                key={width}
                style={[styles.line, { width: `${width}%`, backgroundColor: theme.backgroundElement }]}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

export function PropertiesEmpty({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.icon, { backgroundColor: theme.backgroundElement }]}>
        <Ionicons name="home-outline" size={30} color={theme.textSecondary} />
      </View>
      <ThemedText style={styles.emptyTitle}>{title}</ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.emptyBody}>{message}</ThemedText>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={[styles.action, { backgroundColor: theme.text }]}
        >
          <ThemedText style={[styles.actionText, { color: theme.background }]}>{actionLabel}</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function PropertyListError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.empty}>
      <ThemedText themeColor="textSecondary" style={styles.emptyBody}>{message}</ThemedText>
      <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry">
        <ThemedText style={styles.retry}>Retry</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: BorderRadius.lg, margin: Spacing.three, overflow: "hidden" },
  image: { height: 160 },
  lines: { padding: Spacing.three, gap: Spacing.two },
  line: { height: 12, borderRadius: 6 },
  empty: { alignItems: "center", paddingHorizontal: Spacing.four, paddingTop: Spacing.six, gap: Spacing.two },
  icon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 18, fontWeight: "700", textAlign: "center" },
  emptyBody: { fontSize: 14, lineHeight: 21, textAlign: "center" },
  action: { marginTop: Spacing.two, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.four, paddingVertical: 11 },
  actionText: { fontSize: 14, fontWeight: "700" },
  retry: { color: BrandColors.primary, fontSize: 15, fontWeight: "700", padding: Spacing.two },
});
