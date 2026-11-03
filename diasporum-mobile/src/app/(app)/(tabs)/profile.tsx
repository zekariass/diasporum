/**
 * Profile tab — displays the user's own profile from backend state.
 * Avatar and name/handle are laid out side by side in a compact header row.
 * Provides navigation to edit profile.
 */

import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useAuth } from "@/core/auth/auth-provider";
import { useSession } from "@/core/session/session-provider";
import { BrandColors } from "@/shared/theme/colors";
import { Spacing, BorderRadius } from "@/shared/theme/spacing";
import { useTheme } from "@/hooks/use-theme";
import { MediaImage } from "@/features/feed/components/media-image";

const AVATAR_SIZE = 72;

function AvatarLetter({ letter }: { letter: string }) {
  return (
    <View style={[styles.avatar, { backgroundColor: BrandColors.primary }]}>
      <ThemedText style={styles.avatarLetter}>{letter}</ThemedText>
    </View>
  );
}

function IdentityBlock({
  displayName,
  username,
  bio,
  avatarMediaId,
  completed,
}: {
  displayName: string;
  username: string;
  bio: string | null;
  avatarMediaId: string | null;
  completed: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <View style={styles.identityBlock}>
      {/* Avatar — left */}
      <View style={styles.avatarWrap}>
        {avatarMediaId ? (
          <MediaImage
            mediaId={avatarMediaId}
            style={styles.avatarImage}
          />
        ) : (
          <AvatarLetter
            letter={(displayName ?? username ?? "?")[0].toUpperCase()}
          />
        )}
      </View>

      {/* Name / handle / bio — right */}
      <View style={styles.identityText}>
        <View style={styles.nameRow}>
          <ThemedText type="subtitle" numberOfLines={1}>
            {displayName ?? "No name set"}
          </ThemedText>
          {completed ? (
            <Ionicons
              name="checkmark-circle"
              size={16}
              color={BrandColors.primary}
              style={styles.verifyIcon}
            />
          ) : null}
        </View>

        <ThemedText themeColor="textSecondary" style={styles.username}>
          @{username ?? "username"}
        </ThemedText>

        {bio ? (
          <ThemedText
            themeColor="textSecondary"
            style={styles.bio}
            numberOfLines={2}
          >
            {bio}
          </ThemedText>
        ) : null}

        <Pressable
          onPress={() => router.push("/(app)/profile/edit" as never)}
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
          style={({ pressed }) => [
            styles.editPill,
            { borderColor: theme.border },
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="pencil-outline" size={12} color={theme.primary} />
          <ThemedText
            style={[styles.editPillText, { color: theme.primary }]}
          >
            Edit profile
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

export default function ProfileTabScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { logout } = useAuth();
  const { session } = useSession();
  const profile = session?.profile;

  const quickLinks = [
    {
      icon: "briefcase" as const,
      label: "Business Workspace",
      description: "Manage your businesses, listings and team.",
      cta: "Manage Business Accounts",
      route: "/(app)/business",
      accent: true,
    },
    {
      icon: "heart" as const,
      label: "Matchmaking",
      description: "Discover compatible adults with privacy-safe profiles.",
      cta: "Open Matchmaking",
      route: "/(app)/matchmaking",
      accent: true,
    },
    {
      icon: "briefcase-outline" as const,
      label: "Jobs",
      description: "Discover opportunities and manage your listings.",
      cta: "Explore jobs",
      route: "/(app)/jobs",
      accent: false,
    },
    {
      icon: "car-outline" as const,
      label: "Vehicles",
      description: "Discover vehicles and manage your listings.",
      cta: "Explore vehicles",
      route: "/(app)/vehicles",
      accent: false,
    },
  ];

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <ThemedText type="title">Profile</ThemedText>
          <Pressable
            onPress={() => router.push("/(app)/profile/edit")}
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
            style={({ pressed }) => [styles.headerEditBtn, pressed && styles.pressed]}
          >
            <ThemedText
              style={[styles.headerEditText, { color: BrandColors.primary }]}
            >
              Edit
            </ThemedText>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Avatar + name side by side */}
          <IdentityBlock
            displayName={profile?.displayName ?? "No name set"}
            username={profile?.username ?? "username"}
            bio={profile?.bio ?? null}
            avatarMediaId={profile?.avatarMediaId ?? null}
            completed={profile?.profileCompleted ?? false}
          />

          {/* Quick links */}
          {quickLinks.map(
            ({ icon, label, description, cta, route, accent }) => (
              <Pressable
                key={label}
                onPress={() => router.push(route as never)}
                accessibilityRole="button"
                accessibilityLabel={cta}
                style={({ pressed }) => [
                  styles.businessCard,
                  {
                    backgroundColor: accent
                      ? theme.primarySurface
                      : theme.backgroundElement,
                  },
                  pressed && styles.pressed,
                ]}
              >
                <View
                  style={[
                    styles.businessIcon,
                    {
                      backgroundColor: accent
                        ? theme.background
                        : theme.primarySurface,
                    },
                  ]}
                >
                  <Ionicons name={icon} size={25} color={theme.primary} />
                </View>
                <View style={styles.businessCopy}>
                  <ThemedText style={styles.businessTitle}>
                    {label}
                  </ThemedText>
                  <ThemedText
                    style={styles.businessDescription}
                    themeColor="textSecondary"
                  >
                    {description}
                  </ThemedText>
                  <ThemedText
                    style={[styles.businessAction, { color: theme.primary }]}
                  >
                    {cta}
                  </ThemedText>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={21}
                  color={theme.primary}
                />
              </Pressable>
            ),
          )}

          {/* Details */}
          <View
            style={[
              styles.detailsCard,
              { backgroundColor: theme.backgroundElement },
            ]}
          >
            {[
              { label: "City", value: profile?.city },
              { label: "Date of birth", value: profile?.dateOfBirth },
              {
                label: "Origin country",
                value: profile?.originCountryId ? "Set" : "Not set",
              },
              {
                label: "Current country",
                value: profile?.currentCountryId ? "Set" : "Not set",
              },
              {
                label: "Profile status",
                value: profile?.profileCompleted ? "Complete ✓" : "Incomplete",
              },
            ].map(({ label, value }) => (
              <View key={label} style={styles.detailRow}>
                <ThemedText
                  style={styles.detailLabel}
                  themeColor="textSecondary"
                >
                  {label}
                </ThemedText>
                <ThemedText style={styles.detailValue}>
                  {value ?? "—"}
                </ThemedText>
              </View>
            ))}
          </View>

          {/* Actions */}
          <PrimaryButton
            label="Edit profile"
            onPress={() => router.push("/(app)/profile/edit")}
            variant="secondary"
          />
          <PrimaryButton
            label="Account & security"
            onPress={() => router.push("/(app)/settings/security" as never)}
            variant="secondary"
          />
          <PrimaryButton
            label="Sign out"
            onPress={() => void logout()}
            variant="danger"
          />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  headerEditBtn: { padding: 4 },
  headerEditText: { fontSize: 15, fontWeight: "600" },
  pressed: { opacity: 0.7 },
  scroll: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.four,
  },

  /* ── Identity block ── */
  identityBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.three,
    paddingTop: Spacing.two,
  },
  avatarWrap: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    overflow: "hidden",
    flexShrink: 0,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: { fontSize: 28, fontWeight: "700", color: "#FFFFFF" },
  avatarImage: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  identityText: {
    flex: 1,
    gap: 3,
    paddingTop: 2,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  verifyIcon: { marginTop: 1 },
  username: { fontSize: 13 },
  bio: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  editPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.two,
    paddingVertical: 5,
    marginTop: Spacing.one,
  },
  editPillText: { fontSize: 11, fontWeight: "600" },

  /* ── Cards ── */
  businessCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
  },
  businessIcon: {
    width: 50,
    height: 50,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  businessCopy: { flex: 1, marginHorizontal: Spacing.three },
  businessTitle: { fontSize: 16, lineHeight: 21, fontWeight: "800" },
  businessDescription: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  businessAction: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    marginTop: Spacing.one,
  },
  detailsCard: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  detailRow: { flexDirection: "row", justifyContent: "space-between" },
  detailLabel: { fontSize: 13 },
  detailValue: { fontSize: 13, fontWeight: "500" },
});
