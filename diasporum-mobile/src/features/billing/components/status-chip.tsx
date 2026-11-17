import React from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { statusLabel } from "../utils/billing-format";

export function StatusChip({ status }: { status: string }) {
  const theme = useTheme();
  const good = status === "ACTIVE" || status === "TRIALING";
  const bad = status === "EXPIRED" || status === "CANCELED" || status === "PAST_DUE";
  const bg = good ? theme.successSurface : bad ? theme.errorSurface : theme.warningSurface;
  const fg = good ? theme.success : bad ? theme.error : theme.warning;
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <ThemedText style={[styles.text, { color: fg }]}>{statusLabel(status)}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
  },
  text: { fontSize: 12, fontWeight: "700" },
});
