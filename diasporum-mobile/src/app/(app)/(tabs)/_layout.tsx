/**
 * Bottom tab navigator — labeled line icons, filled when
 * active, with a central rounded-square Create action.
 * Home, Rooms, +Create, Messages, Profile.
 * Explore and Communities remain routable but are not tab items.
 */

import { useState, type ComponentProps } from "react";
import { Tabs } from "expo-router";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ColorValue,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/hooks/use-theme";
import { CreateSheet } from "@/shared/components/create-sheet";
import { useSession } from "@/core/session/session-provider";
import { isCommunityModuleEnabled } from "@/core/session/community-capabilities";

type IconName = ComponentProps<typeof Ionicons>["name"];

const TAB_ICONS: Record<string, { active: IconName; inactive: IconName }> = {
  index: { active: "home", inactive: "home-outline" },
  rooms: { active: "chatbubbles", inactive: "chatbubbles-outline" },
  messages: {
    active: "chatbubble-ellipses",
    inactive: "chatbubble-ellipses-outline",
  },
  profile: { active: "person", inactive: "person-outline" },
};

function tabIcon(route: keyof typeof TAB_ICONS) {
  return function TabIcon({
    color,
    focused,
  }: {
    color: ColorValue;
    focused: boolean;
  }) {
    const icons = TAB_ICONS[route];
    return (
      <Ionicons
        name={focused ? icons.active : icons.inactive}
        size={24}
        color={typeof color === "string" ? color : undefined}
      />
    );
  };
}

export default function TabsLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const [createOpen, setCreateOpen] = useState(false);
  const roomsEnabled = isCommunityModuleEnabled(session?.access, "VOICE_ROOMS");

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.text,
          tabBarInactiveTintColor: theme.textSecondary,
          tabBarLabelStyle: styles.tabLabel,
          tabBarStyle: {
            backgroundColor: theme.background,
            borderTopColor: theme.border,
            borderTopWidth: StyleSheet.hairlineWidth,
            // Bar content + the system nav/gesture inset, so icons sit above it.
            height: 62 + insets.bottom,
            paddingTop: 6,
            paddingBottom: insets.bottom,
            ...Platform.select({
              android: { elevation: 0 },
              ios: { shadowOpacity: 0 },
            }),
          },
          tabBarItemStyle: styles.tabItem,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{ title: "Home", tabBarIcon: tabIcon("index") }}
        />
        <Tabs.Screen
          name="rooms"
          options={{
            title: "Rooms",
            tabBarIcon: tabIcon("rooms"),
            href: roomsEnabled ? undefined : null,
          }}
        />
        <Tabs.Screen
          name="create"
          options={{
            title: "Create",
            tabBarLabel: () => null,
            tabBarButton: () => (
              <View style={styles.createWrap}>
                <Pressable
                  onPress={() => setCreateOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Create"
                  style={({ pressed }) => [
                    styles.createBtn,
                    { backgroundColor: theme.backgroundElement },
                    pressed && styles.createPressed,
                  ]}
                >
                  <Ionicons name="add" size={24} color={theme.text} />
                </Pressable>
                <Text style={[styles.tabLabel, { color: theme.textSecondary }]}>
                  Create
                </Text>
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="messages"
          options={{ title: "Messages", tabBarIcon: tabIcon("messages") }}
        />
        <Tabs.Screen
          name="profile"
          options={{ title: "Profile", tabBarIcon: tabIcon("profile") }}
        />
        {/* Kept routable, hidden from the tab bar. Reels moved to /(app)/reels. */}
        <Tabs.Screen name="explore" options={{ href: null }} />
        <Tabs.Screen name="communities" options={{ href: null }} />
      </Tabs>
      <CreateSheet visible={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  tabItem: { paddingVertical: 0 },
  tabLabel: { fontSize: 10, lineHeight: 13, fontWeight: "600", marginTop: 2 },
  createWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  createBtn: {
    width: 56,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  createPressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
});
