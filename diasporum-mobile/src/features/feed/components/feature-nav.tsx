/**
 * FeatureNav — horizontal scrollable feature category strip.
 * Modern underline-tab style: icon stacked above a short label, active item
 * uses a filled icon variant in the brand colour with a 3 px indicator bar.
 * Stateless: caller owns activeKey and handles onSelect.
 */
import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/shared/theme/spacing";

type IconName = ComponentProps<typeof Ionicons>["name"];

interface Feature {
  key: string;
  icon: IconName;       // outline — inactive
  activeIcon: IconName; // filled — active
  label: string;
}

export const FEATURES: Feature[] = [
  { key: "feed",      icon: "home-outline",          activeIcon: "home",           label: "Feed" },
  { key: "reels",     icon: "play-circle-outline",   activeIcon: "play-circle",    label: "Vids" },
  { key: "people",    icon: "people-outline",         activeIcon: "people",         label: "People" },
  { key: "dating",    icon: "heart-outline",          activeIcon: "heart",          label: "Dating" },
  { key: "property",  icon: "business-outline",       activeIcon: "business",       label: "Property" },
  { key: "vehicle",   icon: "car-outline",            activeIcon: "car",            label: "Vehicles" },
  { key: "event",     icon: "calendar-outline",       activeIcon: "calendar",       label: "Events" },
  { key: "spare-bag", icon: "bag-handle-outline",     activeIcon: "bag-handle",     label: "Spare Bag" },
  { key: "business",  icon: "storefront-outline",     activeIcon: "storefront",     label: "Business" },
  { key: "jobs",      icon: "briefcase-outline",      activeIcon: "briefcase",      label: "Jobs" },
  { key: "poll",      icon: "stats-chart-outline",    activeIcon: "stats-chart",    label: "Polls" },
  { key: "help",      icon: "hand-left-outline",      activeIcon: "hand-left",      label: "Help" },
  { key: "services",  icon: "construct-outline",      activeIcon: "construct",      label: "Services" },
];

interface FeatureNavProps {
  activeKey: string;
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
          const iconColor = active ? theme.primary : theme.textSecondary;

          return (
            <Pressable
              key={feature.key}
              onPress={() => onSelect(feature.key)}
              accessibilityRole="button"
              accessibilityLabel={feature.label}
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.item,
                pressed && styles.itemPressed,
              ]}
            >
              {/* Icon in a subtle tinted bubble when active */}
              <View
                style={[
                  styles.iconWrap,
                  active && {
                    backgroundColor: theme.primarySurface,
                  },
                ]}
              >
                <Ionicons
                  name={active ? feature.activeIcon : feature.icon}
                  size={22}
                  color={iconColor}
                />
              </View>

              {/* Label */}
              <ThemedText
                style={[
                  styles.label,
                  { color: active ? theme.primary : theme.textSecondary },
                  active && styles.activeLabel,
                ]}
                numberOfLines={1}
              >
                {feature.label}
              </ThemedText>

              {/* Active indicator bar */}
              <View
                style={[
                  styles.indicator,
                  { backgroundColor: active ? theme.primary : "transparent" },
                ]}
              />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const ICON_BUBBLE = 40;

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  strip: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.px,
  },
  item: {
    alignItems: "center",
    paddingHorizontal: Spacing.two,
    minWidth: 58,
    gap: 4,
  },
  itemPressed: {
    opacity: 0.65,
    transform: [{ scale: 0.94 }],
  },
  iconWrap: {
    width: ICON_BUBBLE,
    height: ICON_BUBBLE,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  activeLabel: {
    fontWeight: "700",
  },
  indicator: {
    height: 3,
    width: 24,
    borderRadius: 2,
    marginTop: 3,
    marginBottom: -StyleSheet.hairlineWidth, // sit flush on the bottom border
  },
});
