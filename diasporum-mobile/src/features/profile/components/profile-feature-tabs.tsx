/**
 * ProfileFeatureTabs — horizontally scrollable own-content switcher.
 * Active chip uses the primary theme tint; inactive chips stay neutral.
 * Tabs never compress — the strip scrolls on narrow devices.
 */

import React from "react";
import { Pressable, ScrollView, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import {
  PROFILE_TABS,
  type ProfileTabKey,
} from "../types/profile-content";

interface Props {
  active: ProfileTabKey;
  onSelect: (key: ProfileTabKey) => void;
}

export function ProfileFeatureTabs({ active, onSelect }: Props) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.strip}
      contentContainerStyle={styles.stripContent}
      accessibilityRole="tablist"
    >
      {PROFILE_TABS.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onSelect(tab.key)}
            accessibilityRole="tab"
            accessibilityLabel={`${tab.label} tab`}
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: selected
                  ? theme.primarySurface
                  : "transparent",
              },
              pressed && !selected && { opacity: 0.6 },
            ]}
          >
            <Ionicons
              name={tab.icon}
              size={16}
              color={selected ? theme.primary : theme.textSecondary}
            />
            <ThemedText
              style={[
                styles.label,
                {
                  color: selected ? theme.primary : theme.textSecondary,
                  fontWeight: selected ? "700" : "500",
                },
              ]}
            >
              {tab.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { marginTop: Spacing.three },
  stripContent: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
  },
  label: { fontSize: 13, lineHeight: 18 },
});
