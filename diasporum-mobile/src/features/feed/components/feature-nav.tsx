/**
 * FeatureNav — horizontal scrollable strip of Diasporum modules.
 * Stateless: caller tracks the active key and handles selection.
 * Implemented features update content in-place on the home screen;
 * unimplemented ones show a "coming soon" alert raised by the caller.
 */
import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { Spacing } from "@/shared/theme/spacing";

type IconName = ComponentProps<typeof Ionicons>["name"];

export const FEATURES: { key: string; icon: IconName; label: string }[] = [
  { key: "feed", icon: "home-outline", label: "Feed" },
  { key: "reels", icon: "play-outline", label: "Vids" },
  { key: "people", icon: "people-outline", label: "People" },
  { key: "dating", icon: "heart-outline", label: "Matchmaking / Dating" },
  { key: "help", icon: "hand-left-outline", label: "Community Help & Offers" },
  { key: "services", icon: "construct-outline", label: "Service Marketplace" },
  { key: "property", icon: "business-outline", label: "Property" },
  { key: "vehicle", icon: "car-outline", label: "Vehicle" },
  { key: "event", icon: "calendar-outline", label: "Events" },
  { key: "spare-bag", icon: "bag-handle-outline", label: "Spare Bag" },
  { key: "business", icon: "storefront-outline", label: "Business" },
  { key: "jobs", icon: "briefcase-outline", label: "Jobs" },
  { key: "poll", icon: "stats-chart-outline", label: "Polls" },
];

interface FeatureNavProps {
  /** Currently active feature key */
  activeKey: string;
  /** Called when the user taps a feature button */
  onSelect: (key: string) => void;
}

export function FeatureNav({ activeKey, onSelect }: FeatureNavProps) {
  const theme = useTheme();

  return (
    <View style={[styles.wrap, { borderBottomColor: theme.border }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
      >
        {FEATURES.map((feature) => {
          const active = feature.key === activeKey;
          const color = active ? BrandColors.white : theme.textSecondary;
          return (
            <Pressable
              key={feature.key}
              onPress={() => onSelect(feature.key)}
              accessibilityRole="button"
              accessibilityLabel={feature.label}
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.item,
                {
                  backgroundColor: active
                    ? BrandColors.primary
                    : theme.backgroundElement,
                  borderColor: active ? BrandColors.primary : theme.border,
                },
                pressed && styles.itemPressed,
              ]}
            >
              <Ionicons name={feature.icon} size={17} color={color} />
              <ThemedText
                style={[styles.label, { color }, active && styles.activeLabel]}
              >
                {feature.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth },
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  item: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
  },
  itemPressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  label: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
  activeLabel: { fontWeight: "700" },
});
