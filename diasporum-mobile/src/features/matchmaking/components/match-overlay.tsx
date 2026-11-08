/**
 * MatchOverlay — full-screen celebration shown the moment a mutual match is
 * created. Mirrors the "It's a Match!" moment in modern dating apps: dark
 * backdrop, haloed photo, headline, and the two primary next steps.
 */

import React from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type {
  PublicMatchmakingProfile,
  SwipeResult,
} from "../types/matchmaking-types";

function OverlayButton({
  label,
  onPress,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "ghost";
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" && { backgroundColor: theme.primary },
        pressed && styles.buttonPressed,
      ]}
    >
      <ThemedText
        style={[
          styles.buttonLabel,
          { color: variant === "primary" ? "#fff" : "rgba(255,255,255,0.9)" },
        ]}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

export function MatchOverlay({
  match,
  profile,
  onOpenChat,
  onViewMatch,
  onDismiss,
}: {
  match: SwipeResult | null;
  profile: PublicMatchmakingProfile | null;
  onOpenChat: (conversationId: string) => void;
  onViewMatch: (matchId: string) => void;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  if (!match || !profile) return null;
  return (
    <Modal
      transparent
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.backdrop}>
        <View style={styles.content}>
          {/* Haloed photo with heart badge */}
          <View style={styles.photoWrap}>
            <View
              style={[
                styles.halo,
                { backgroundColor: theme.primary, opacity: 0.18 },
              ]}
            />
            <View
              style={[
                styles.haloInner,
                { backgroundColor: theme.primary, opacity: 0.3 },
              ]}
            />
            {profile.photoUrl ? (
              <Image
                source={{ uri: profile.photoUrl }}
                style={styles.photo}
                contentFit="cover"
                accessibilityLabel={`${profile.displayName} profile photo`}
              />
            ) : (
              <View
                style={[
                  styles.photo,
                  styles.photoFallback,
                  { backgroundColor: theme.primaryDark },
                ]}
                accessibilityLabel={`${profile.displayName} photo hidden`}
              >
                <Ionicons name="person" size={64} color="#fff" />
              </View>
            )}
            <View
              style={[styles.heartBadge, { backgroundColor: theme.primary }]}
            >
              <Ionicons name="heart" size={22} color="#fff" />
            </View>
          </View>

          <ThemedText style={styles.headline}>It&#39;s a Match!</ThemedText>
          <ThemedText style={styles.subline}>
            You have a new mutual match
          </ThemedText>
          <ThemedText style={styles.nameLine}>
            Say hello to {profile.displayName}
          </ThemedText>

          <View style={styles.actions}>
            {match.conversationId ? (
              <OverlayButton
                label="Open chat"
                onPress={() => onOpenChat(match.conversationId!)}
              />
            ) : null}
            {match.matchId ? (
              <OverlayButton
                label="View match"
                variant="ghost"
                onPress={() => onViewMatch(match.matchId!)}
              />
            ) : null}
            <OverlayButton
              label="Keep discovering"
              variant="ghost"
              onPress={onDismiss}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const PHOTO = 156;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(10,6,24,0.92)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.four,
  },
  content: {
    alignItems: "center",
    alignSelf: "stretch",
    gap: Spacing.three,
  },
  photoWrap: {
    width: PHOTO + 56,
    height: PHOTO + 56,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.two,
  },
  halo: {
    position: "absolute",
    width: PHOTO + 56,
    height: PHOTO + 56,
    borderRadius: BorderRadius.full,
  },
  haloInner: {
    position: "absolute",
    width: PHOTO + 28,
    height: PHOTO + 28,
    borderRadius: BorderRadius.full,
  },
  photo: {
    width: PHOTO,
    height: PHOTO,
    borderRadius: PHOTO / 2,
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.9)",
  },
  photoFallback: { alignItems: "center", justifyContent: "center" },
  heartBadge: {
    position: "absolute",
    bottom: 22,
    right: 22,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#fff",
  },
  headline: {
    color: "#fff",
    fontSize: 40,
    fontWeight: "900",
    fontStyle: "italic",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  subline: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 15,
    textAlign: "center",
  },
  nameLine: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    textAlign: "center",
    marginTop: -Spacing.two,
    marginBottom: Spacing.three,
  },
  actions: { alignSelf: "stretch", gap: Spacing.two, maxWidth: 340 },
  button: {
    minHeight: 52,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.five,
  },
  buttonPressed: { opacity: 0.85 },
  buttonLabel: { fontSize: 16, fontWeight: "700" },
});
