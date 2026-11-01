import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";

type IconName = ComponentProps<typeof Ionicons>["name"];

const ROOM_TYPES: {
  key: string;
  title: string;
  description: string;
  icon: IconName;
  color: string;
}[] = [
  {
    key: "text",
    title: "Text chat rooms",
    description:
      "Community conversations, announcements, and topic-based chats will appear here.",
    icon: "chatbubbles-outline",
    color: BrandColors.primary,
  },
  {
    key: "voice",
    title: "Voice chat rooms",
    description:
      "Live audio spaces will let you listen and speak with other community members.",
    icon: "mic-outline",
    color: "#DB2777",
  },
];

export default function RoomsScreen() {
  const theme = useTheme();

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <ThemedText style={styles.title}>Rooms</ThemedText>
            <ThemedText style={styles.subtitle} themeColor="textSecondary">
              Text and voice spaces for your community
            </ThemedText>
          </View>

          <View
            style={[
              styles.communityBanner,
              { backgroundColor: theme.backgroundElement },
            ]}
          >
            <View style={styles.communityIcon}>
              <Ionicons name="people" size={22} color={BrandColors.white} />
            </View>
            <View style={styles.communityCopy}>
              <ThemedText style={styles.communityTitle}>
                Your community, closer together
              </ThemedText>
              <ThemedText
                style={styles.communityText}
                themeColor="textSecondary"
              >
                Drop into a conversation or listen to a live discussion.
              </ThemedText>
            </View>
          </View>

          <ThemedText style={styles.sectionTitle}>Community spaces</ThemedText>
          <View style={styles.roomList}>
            {ROOM_TYPES.map((room) => (
              <View
                key={room.key}
                style={[
                  styles.roomCard,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.roomIcon,
                    { backgroundColor: `${room.color}18` },
                  ]}
                >
                  <Ionicons name={room.icon} size={28} color={room.color} />
                </View>
                <View style={styles.roomCopy}>
                  <View style={styles.roomHeading}>
                    <ThemedText style={styles.roomTitle}>
                      {room.title}
                    </ThemedText>
                    <View
                      style={[
                        styles.badge,
                        { backgroundColor: theme.backgroundSelected },
                      ]}
                    >
                      <ThemedText
                        style={styles.badgeText}
                        themeColor="textSecondary"
                      >
                        Coming soon
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText
                    style={styles.roomDescription}
                    themeColor="textSecondary"
                  >
                    {room.description}
                  </ThemedText>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.availabilityNote}>
            <Ionicons
              name="information-circle-outline"
              size={18}
              color={theme.textSecondary}
            />
            <ThemedText style={styles.noteText} themeColor="textSecondary">
              Room listing and participation will be enabled when community chat
              services become available.
            </ThemedText>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  content: { padding: Spacing.four, paddingBottom: Spacing.six },
  header: { marginBottom: Spacing.four },
  title: { fontSize: 30, lineHeight: 38, fontWeight: "800" },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: Spacing.one },
  communityBanner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.xl,
    padding: Spacing.four,
    marginBottom: Spacing.four,
  },
  communityIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.primary,
  },
  communityCopy: { flex: 1, marginLeft: Spacing.three },
  communityTitle: { fontSize: 15, lineHeight: 20, fontWeight: "700" },
  communityText: { fontSize: 12, lineHeight: 17, marginTop: Spacing.one },
  sectionTitle: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "700",
    marginBottom: Spacing.three,
  },
  roomList: { gap: Spacing.three },
  roomCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1,
    borderRadius: BorderRadius.xl,
    padding: Spacing.four,
  },
  roomIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  roomCopy: { flex: 1, marginLeft: Spacing.three },
  roomHeading: { gap: Spacing.two },
  roomTitle: { fontSize: 17, lineHeight: 23, fontWeight: "700" },
  badge: {
    alignSelf: "flex-start",
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  roomDescription: { fontSize: 13, lineHeight: 19, marginTop: Spacing.two },
  availabilityNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    marginTop: Spacing.four,
  },
  noteText: { flex: 1, fontSize: 12, lineHeight: 18 },
});
