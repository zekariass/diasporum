/**
 * FeatureNav — horizontal scrollable strip of Diasporum modules.
 * Feed is active on this screen; People → Discover; modules that aren't
 * implemented yet show a "coming soon" notice rather than a fake screen.
 */
import React from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { Spacing } from "@/shared/theme/spacing";

type IconName = ComponentProps<typeof Ionicons>["name"];

const FEATURES: { key: string; icon: IconName; label: string }[] = [
  { key: "feed", icon: "home-outline", label: "Feed" },
  { key: "reels", icon: "play-outline", label: "Vids" },
  { key: "people", icon: "people-outline", label: "People" },
  { key: "dating", icon: "heart-outline", label: "Matchmaking / Dating" },
  { key: "help", icon: "hand-left-outline", label: "Community Help & Offers" },
  { key: "services", icon: "construct-outline", label: "Service Marketplace" },
  { key: "property", icon: "business-outline", label: "Property" },
  { key: "vehicle", icon: "car-outline", label: "Vehicle" },
  { key: "event", icon: "calendar-outline", label: "Events" },
  { key: "business", icon: "storefront-outline", label: "Business" },
  { key: "jobs", icon: "briefcase-outline", label: "Jobs" },
  { key: "poll", icon: "stats-chart-outline", label: "Polls" },
];

export function FeatureNav() {
  const theme = useTheme();
  const router = useRouter();

  function go(key: string, label: string) {
    switch (key) {
      case "feed":
        return;
      case "people":
        router.push("/(app)/(tabs)/explore" as never);
        return;
      case "reels":
        router.push("/(app)/(tabs)/reels" as never);
        return;
      case "poll":
        router.push("/(app)/posts/create" as never);
        return;
      case "event":
        router.push("/(app)/events" as never);
        return;
      default:
        Alert.alert("Coming soon", `${label} isn't available yet.`);
    }
  }

  return (
    <View style={[styles.wrap, { borderBottomColor: theme.border }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
      >
        {FEATURES.map((feature) => {
          const active = feature.key === "feed";
          const color = active ? BrandColors.white : theme.textSecondary;
          return (
            <Pressable
              key={feature.key}
              onPress={() => go(feature.key, feature.label)}
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
