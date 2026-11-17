import React from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/shared/theme/spacing";

export function DetailRow({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText
        selectable
        style={emphasized ? styles.emphasized : styles.value}
      >
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 2, paddingVertical: Spacing.one },
  value: { fontSize: 15, fontWeight: "600" },
  emphasized: { fontSize: 18, fontWeight: "800" },
});
