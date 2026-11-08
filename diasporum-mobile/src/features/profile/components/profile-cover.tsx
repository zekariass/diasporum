/**
 * ProfileCover — themed cover band with the Diasporum brand mark, overlaid
 * top-right actions (edit profile, settings) and the circular avatar that
 * overlaps the cover's bottom edge. The avatar carries a camera badge that
 * opens the existing profile editor.
 */

import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { Spacing } from "@/shared/theme/spacing";
import { Avatar } from "@/features/feed/components/avatar";

const COVER_HEIGHT = 148;
const AVATAR_SIZE = 92;

interface Props {
  displayName: string | null;
  avatarMediaId: string | null;
  onEditPress: () => void;
  onSettingsPress: () => void;
  onAvatarPress: () => void;
}

function CoverAction({
  icon,
  label,
  onPress,
}: {
  icon: "pencil-outline" | "settings-outline";
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: theme.background + "D9" },
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={18} color={theme.text} />
    </Pressable>
  );
}

export function ProfileCover({
  displayName,
  avatarMediaId,
  onEditPress,
  onSettingsPress,
  onAvatarPress,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.cover,
          { backgroundColor: theme.primarySurface, paddingTop: insets.top },
        ]}
      >
        {/* Brand mark — same badge + wordmark convention as the feed header */}
        <View
          style={styles.brand}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <View
            style={[
              styles.logoBadge,
              { backgroundColor: BrandColors.primary + "59" },
            ]}
          >
            <ThemedText style={styles.logoLetter}>D</ThemedText>
          </View>
          <ThemedText
            style={[styles.wordmark, { color: BrandColors.primary + "59" }]}
          >
            diasporum
          </ThemedText>
        </View>

        {/* Top-right actions over the cover */}
        <View style={[styles.actions, { top: insets.top }]}>
          <CoverAction
            icon="pencil-outline"
            label="Edit profile"
            onPress={onEditPress}
          />
          <CoverAction
            icon="settings-outline"
            label="Settings"
            onPress={onSettingsPress}
          />
        </View>
      </View>

      {/* Avatar overlapping the cover edge */}
      <View style={styles.avatarRow}>
        <View style={[styles.avatarRing, { borderColor: theme.background }]}>
          <Avatar
            name={displayName}
            mediaId={avatarMediaId}
            size={AVATAR_SIZE}
          />
          <Pressable
            onPress={onAvatarPress}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
            style={({ pressed }) => [
              styles.cameraBadge,
              {
                backgroundColor: theme.primary,
                borderColor: theme.background,
              },
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="camera" size={14} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: Spacing.two },
  cover: {
    height: COVER_HEIGHT,
    justifyContent: "center",
    alignItems: "center",
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: -Spacing.three,
  },
  logoBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  logoLetter: { fontSize: 17, fontWeight: "800", color: "#FFFFFF", lineHeight: 20 },
  wordmark: {
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.8,
    fontStyle: "italic",
    lineHeight: 34,
  },
  actions: {
    position: "absolute",
    top: 0,
    right: 0,
    flexDirection: "row",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  action: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarRow: {
    paddingHorizontal: Spacing.three,
    marginTop: -AVATAR_SIZE / 2,
  },
  avatarRing: {
    width: AVATAR_SIZE + 6,
    height: AVATAR_SIZE + 6,
    borderRadius: (AVATAR_SIZE + 6) / 2,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  cameraBadge: {
    position: "absolute",
    right: 0,
    bottom: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2.5,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.75 },
});
