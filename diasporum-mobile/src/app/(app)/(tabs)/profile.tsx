/**
 * Profile tab — displays the user's own profile from backend state.
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

export default function ProfileTabScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { logout } = useAuth();
  const { session } = useSession();
  const profile = session?.profile;

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
            style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}
          >
            <ThemedText
              style={[styles.editBtnText, { color: BrandColors.primary }]}
            >
              Edit
            </ThemedText>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Avatar + name */}
          <View style={styles.identityBlock}>
            <View
              style={[styles.avatar, { backgroundColor: BrandColors.primary }]}
              accessibilityRole="image"
              accessibilityLabel="Profile photo"
            >
              <ThemedText style={styles.avatarLetter}>
                {(profile?.displayName ??
                  profile?.username ??
                  "?")[0].toUpperCase()}
              </ThemedText>
            </View>
            <ThemedText type="subtitle" style={styles.displayName}>
              {profile?.displayName ?? "No name set"}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.username}>
              @{profile?.username ?? "username"}
            </ThemedText>
            {profile?.bio ? (
              <ThemedText style={styles.bio} themeColor="textSecondary">
                {profile.bio}
              </ThemedText>
            ) : null}
          </View>

          <Pressable
            onPress={() => router.push("/(app)/business" as never)}
            accessibilityRole="button"
            accessibilityLabel="Manage Business Accounts"
            style={({ pressed }) => [
              styles.businessCard,
              { backgroundColor: theme.primarySurface },
              pressed && styles.pressed,
            ]}
          >
            <View
              style={[
                styles.businessIcon,
                { backgroundColor: theme.background },
              ]}
            >
              <Ionicons name="briefcase" size={25} color={theme.primary} />
            </View>
            <View style={styles.businessCopy}>
              <ThemedText style={styles.businessTitle}>
                Business Workspace
              </ThemedText>
              <ThemedText
                style={styles.businessDescription}
                themeColor="textSecondary"
              >
                Manage your businesses, listings and team.
              </ThemedText>
              <ThemedText
                style={[styles.businessAction, { color: theme.primary }]}
              >
                Manage Business Accounts
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={21} color={theme.primary} />
          </Pressable>

          <Pressable
            onPress={() => router.push("/(app)/matchmaking" as never)}
            accessibilityRole="button"
            accessibilityLabel="Open Matchmaking"
            style={({ pressed }) => [
              styles.businessCard,
              { backgroundColor: theme.primarySurface },
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.businessIcon, { backgroundColor: theme.background }]}>
              <Ionicons name="heart" size={25} color={theme.primary} />
            </View>
            <View style={styles.businessCopy}>
              <ThemedText style={styles.businessTitle}>Matchmaking</ThemedText>
              <ThemedText style={styles.businessDescription} themeColor="textSecondary">
                Discover compatible adults with privacy-safe profiles.
              </ThemedText>
              <ThemedText style={[styles.businessAction, { color: theme.primary }]}>
                Open Matchmaking
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={21} color={theme.primary} />
          </Pressable>

          <Pressable
            onPress={() => router.push("/(app)/jobs" as never)}
            accessibilityRole="button"
            accessibilityLabel="Explore jobs"
            style={({ pressed }) => [
              styles.businessCard,
              { backgroundColor: theme.backgroundElement },
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.businessIcon, { backgroundColor: theme.primarySurface }]}>
              <Ionicons name="briefcase-outline" size={25} color={theme.primary} />
            </View>
            <View style={styles.businessCopy}>
              <ThemedText style={styles.businessTitle}>Jobs</ThemedText>
              <ThemedText style={styles.businessDescription} themeColor="textSecondary">
                Discover opportunities and manage your listings.
              </ThemedText>
              <ThemedText style={[styles.businessAction, { color: theme.primary }]}>
                Explore jobs
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={21} color={theme.primary} />
          </Pressable>

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
  editBtn: { padding: 4 },
  editBtnText: { fontSize: 15, fontWeight: "600" },
  pressed: { opacity: 0.7 },
  scroll: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.four,
  },
  identityBlock: {
    alignItems: "center",
    gap: Spacing.one,
    paddingTop: Spacing.two,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.two,
  },
  avatarLetter: { fontSize: 36, fontWeight: "700", color: "#FFFFFF" },
  displayName: { textAlign: "center" },
  username: { fontSize: 14 },
  bio: {
    textAlign: "center",
    fontSize: 14,
    lineHeight: 20,
    marginTop: Spacing.one,
  },
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
