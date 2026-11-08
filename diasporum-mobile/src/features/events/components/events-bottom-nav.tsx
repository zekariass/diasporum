/**
 * EventsBottomNav — Eventbrite-style events tab bar pinned to the bottom
 * of the events screens: Discover / Saved / Tickets / Account.
 * Rendered as a normal (non-absolute) child at the end of each screen's
 * SafeAreaView so list content always sits above it.
 */

import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { Spacing } from "@/shared/theme/spacing";

export type EventsTab =
  | "discover"
  | "posts"
  | "saved"
  | "tickets"
  | "account";

const TABS: {
  key: EventsTab;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  iconActive: React.ComponentProps<typeof Ionicons>["name"];
  href: string;
}[] = [
  {
    key: "discover",
    label: "Discover",
    icon: "home-outline",
    iconActive: "home",
    href: "/(app)/events",
  },
  {
    key: "posts",
    label: "Posts",
    icon: "newspaper-outline",
    iconActive: "newspaper",
    href: "/(app)/(tabs)",
  },
  {
    key: "saved",
    label: "Saved",
    icon: "heart-outline",
    iconActive: "heart",
    href: "/(app)/events/saved",
  },
  {
    key: "tickets",
    label: "Tickets",
    icon: "ticket-outline",
    iconActive: "ticket",
    href: "/(app)/events/my",
  },
  {
    key: "account",
    label: "Account",
    icon: "person-outline",
    iconActive: "person",
    href: "/(app)/(tabs)/profile",
  },
];

export function EventsBottomNav({ active }: { active: EventsTab }) {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        s.bar,
        {
          borderTopColor: theme.border,
          backgroundColor: theme.background,
          paddingBottom: Math.max(insets.bottom, Spacing.two),
        },
      ]}
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => router.replace(tab.href as never)}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: isActive }}
            style={s.tab}
          >
            <Ionicons
              name={isActive ? tab.iconActive : tab.icon}
              size={22}
              color={isActive ? BrandColors.primary : theme.textSecondary}
            />
            <ThemedText
              style={[
                s.tabLabel,
                {
                  color: isActive ? BrandColors.primary : theme.textSecondary,
                  fontWeight: isActive ? "700" : "500",
                },
              ]}
            >
              {tab.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
  },
  tab: { flex: 1, alignItems: "center", gap: 2 },
  tabLabel: { fontSize: 11 },
});
