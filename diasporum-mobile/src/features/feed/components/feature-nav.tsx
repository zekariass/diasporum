/**
 * FeatureNav — horizontal scrollable strip for the Posts content experiences
 * (Feed, Vids, Help, Polls). Other Diasporum features live in the left-side
 * FeatureDrawer. Modern underline-tab style: icon stacked above a short
 * label, active item uses a filled icon variant in the brand colour with a
 * 3 px indicator bar. Stateless: caller owns activeKey and handles onSelect.
 */
import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/shared/theme/spacing";
import { useSession } from "@/core/session/session-provider";
import {
  FEATURE_MODULE_KEYS,
  isCommunityModuleEnabled,
} from "@/core/session/community-capabilities";

type IconName = ComponentProps<typeof Ionicons>["name"];

interface Feature {
  key: string;
  icon: IconName; // outline — inactive
  activeIcon: IconName; // filled — active
  label: string;
}

export const FEATURES: Feature[] = [
  { key: "feed", icon: "home-outline", activeIcon: "home", label: "Feed" },
  {
    key: "reels",
    icon: "play-circle-outline",
    activeIcon: "play-circle",
    label: "Vids",
  },
  {
    key: "help",
    icon: "hand-left-outline",
    activeIcon: "hand-left",
    label: "Help",
  },
  {
    key: "poll",
    icon: "stats-chart-outline",
    activeIcon: "stats-chart",
    label: "Polls",
  },
];

interface FeatureNavProps {
  activeKey: string;
  onSelect: (key: string) => void;
}

export function FeatureNav({ activeKey, onSelect }: FeatureNavProps) {
  const theme = useTheme();
  const { session } = useSession();
  const features = FEATURES.filter((feature) => {
    const moduleKey = FEATURE_MODULE_KEYS[feature.key];
    return (
      moduleKey == null || isCommunityModuleEnabled(session?.access, moduleKey)
    );
  });

  return (
    <View style={[styles.wrap, { borderBottomColor: theme.border }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
      >
        {features.map((feature) => {
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

const ICON_BUBBLE = 38;

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  strip: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.one,
    gap: 0,
  },
  item: {
    alignItems: "center",
    paddingHorizontal: 6,
    minWidth: 60,
    gap: 3,
  },
  itemPressed: {
    opacity: 0.65,
    transform: [{ scale: 0.94 }],
  },
  iconWrap: {
    width: ICON_BUBBLE,
    height: ICON_BUBBLE,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  activeLabel: {
    fontWeight: "800",
  },
  indicator: {
    height: 2,
    width: 24,
    borderRadius: 1,
    marginTop: 2,
    marginBottom: -StyleSheet.hairlineWidth, // sit flush on the bottom border
  },
});
