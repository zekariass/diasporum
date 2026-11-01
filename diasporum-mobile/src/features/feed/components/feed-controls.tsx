/**
 * FeedControls — CategoryFilter (quiet outlined chips, backend-driven) and
 * ModeToggle (For You / Latest pill). Both restrained so the timeline leads.
 */
import React from "react";
import { Pressable, ScrollView, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type { CategoryView, FeedMode } from "../types/feed-types";

export function CategoryFilter({
  categories,
  selected,
  onSelect,
}: {
  categories: CategoryView[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const theme = useTheme();
  if (categories.length === 0) return null;

  const chip = (active: boolean) => [
    styles.chip,
    active
      ? { backgroundColor: theme.text, borderColor: theme.text }
      : { backgroundColor: "transparent", borderColor: theme.border },
  ];
  const chipText = (active: boolean) => [
    styles.chipText,
    { color: active ? theme.background : theme.text },
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
    >
      <Pressable
        onPress={() => onSelect(null)}
        style={chip(selected === null)}
        accessibilityRole="button"
        accessibilityState={{ selected: selected === null }}
        accessibilityLabel="All posts"
      >
        <ThemedText style={chipText(selected === null)}>All</ThemedText>
      </Pressable>
      {categories.map((c) => {
        const active = c.id === selected;
        return (
          <Pressable
            key={c.id}
            onPress={() => onSelect(active ? null : c.id)}
            style={chip(active)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={c.name}
          >
            <ThemedText style={chipText(active)}>{c.name}</ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const MODE_LABEL: Record<FeedMode, string> = {
  FOR_YOU: "For you",
  LATEST: "Latest",
};

export function ModeToggle({
  mode,
  onChange,
}: {
  mode: FeedMode;
  onChange: (m: FeedMode) => void;
}) {
  const theme = useTheme();
  const next: FeedMode = mode === "FOR_YOU" ? "LATEST" : "FOR_YOU";
  return (
    <Pressable
      onPress={() => onChange(next)}
      style={({ pressed }) => [
        styles.mode,
        { backgroundColor: theme.backgroundElement },
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Feed mode: ${MODE_LABEL[mode]}. Tap for ${MODE_LABEL[next]}.`}
    >
      <ThemedText style={styles.modeText}>{MODE_LABEL[mode]}</ThemedText>
      <Ionicons name="chevron-down" size={14} color={theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontWeight: "600", lineHeight: 18 },
  mode: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
  },
  modeText: { fontSize: 13, fontWeight: "600", lineHeight: 18 },
  pressed: { opacity: 0.7 },
});
