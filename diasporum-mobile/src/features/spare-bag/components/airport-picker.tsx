import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/shared/theme/spacing";
import type { Airport } from "../types/spare-bag-types";
import { AirportPickerModal } from "./form-controls";

/** Compact route-bar airport selector — prominent IATA code per the dashboard
 * reference; opens the shared searchable airport modal. */
export function AirportPicker({
  label,
  value,
  airports,
  onSearch,
  onChange,
}: {
  label: string;
  value: Airport | null;
  airports: Airport[];
  onSearch: (query: string) => Promise<Airport[]>;
  onChange: (airport: Airport | null) => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.root}>
      <ThemedText themeColor="textSecondary" style={styles.label}>
        {label}
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          value
            ? `${label} airport: ${value.iataCode} — ${value.city}`
            : `${label} airport: choose`
        }
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      >
        <Ionicons name="airplane" size={16} color={theme.primary} />
        <ThemedText
          type="smallBold"
          numberOfLines={1}
          style={[styles.code, !value && { color: theme.textSecondary }]}
        >
          {value ? value.iataCode : "Any"}
        </ThemedText>
        <Ionicons name="chevron-down" size={14} color={theme.textSecondary} />
      </Pressable>
      <ThemedText
        themeColor="textSecondary"
        numberOfLines={1}
        style={styles.city}
      >
        {value?.city ?? "Any airport"}
      </ThemedText>
      <AirportPickerModal
        visible={open}
        title={`${label} airport`}
        airports={airports}
        selectedId={value?.id ?? ""}
        allowAny
        onSearch={onSearch}
        onSelect={onChange}
        onClose={() => setOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, gap: 1 },
  label: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    minHeight: 30,
  },
  code: { flexShrink: 1, fontSize: 18, lineHeight: 24 },
  city: { fontSize: 11, lineHeight: 15 },
  pressed: { opacity: 0.65 },
});
