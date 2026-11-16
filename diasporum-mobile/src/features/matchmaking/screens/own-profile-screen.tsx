import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { ErrorState } from "@/shared/components/error-state";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { useSession } from "@/core/session/session-provider";
import {
  DatingBottomNavigation,
  EmptyState,
  ListCard,
  PillTabBar,
} from "../components/matchmaking-ui";
import { useMatchmakingApi } from "../hooks/use-matchmaking-api";
import { matchmakingError } from "../services/matchmaking-errors";
import type {
  MatchmakingProfile,
  MatchmakingProfilePhoto,
  MatchmakingReferenceData,
} from "../types/matchmaking-types";
import {
  ACTIVITY_LEVELS,
  EDUCATION,
  HABITS,
  INTENTIONS,
  MARITAL_STATUSES,
  MARRIAGE_TIMELINES,
  RELIGION_IMPORTANCE,
  WANTS_CHILDREN,
  optionLabel,
} from "../types/matchmaking-options";

type TabKey =
  | "details"
  | "bio"
  | "photos"
  | "lifestyle"
  | "status"
  | "preferences";

const TABS: {
  key: TabKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: "details", label: "Details", icon: "information-circle-outline" },
  { key: "bio", label: "Bio", icon: "document-text-outline" },
  { key: "photos", label: "Photos", icon: "images-outline" },
  { key: "lifestyle", label: "Lifestyle", icon: "sparkles-outline" },
  { key: "status", label: "Status", icon: "pulse-outline" },
  { key: "preferences", label: "Preferences", icon: "options-outline" },
];

function yesNo(value: boolean | null) {
  return value == null ? null : value ? "Yes" : "No";
}

function birthDateLabel(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Read-only owner view — edit and settings are separate screens. */
export default function OwnProfileScreen() {
  const theme = useTheme();
  const api = useMatchmakingApi();
  const { session } = useSession();
  const [profile, setProfile] = useState<MatchmakingProfile | null>(null);
  const [references, setReferences] = useState<MatchmakingReferenceData | null>(
    null,
  );
  const [optIn, setOptIn] = useState(false);
  const [age, setAge] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("details");

  const dob = session?.profile?.dateOfBirth;
  const load = useCallback(async () => {
    setError(null);
    try {
      const [ownProfile, referenceData, privacy] = await Promise.all([
        api.profile(),
        api.referenceData(),
        api.privacy(),
      ]);
      setProfile(ownProfile);
      setReferences(referenceData);
      setOptIn(privacy.allowMatchmakingDiscovery);
      setAge(
        dob
          ? Math.floor(
              (Date.now() - new Date(dob).getTime()) /
                (365.25 * 24 * 3600 * 1000),
            )
          : null,
      );
    } catch (loadError) {
      setError(
        matchmakingError(
          loadError,
          "Your Matchmaking profile could not be loaded.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [api, dob]);

  // Reload on focus so edits and settings changes appear immediately.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const countryLabel = (id: string | null) =>
    id ? (references?.countries.find((c) => c.id === id)?.label ?? null) : null;
  const religionLabel = (id: string | null) =>
    id ? (references?.religions.find((r) => r.id === id)?.label ?? null) : null;
  const genderLabel = (id: string | null) =>
    id ? (references?.genders.find((g) => g.id === id)?.label ?? id) : null;

  const photos = profile?.photos ?? [];
  const primary = photos.find((photo) => photo.isPrimary) ?? photos[0];
  const editable =
    profile && ["DRAFT", "ACTIVE", "PAUSED"].includes(profile.status);
  const displayName =
    session?.profile?.displayName ?? profile?.anonymousAlias ?? "You";
  const location = [
    session?.profile?.city,
    countryLabel(session?.profile?.currentCountryId ?? null),
  ]
    .filter(Boolean)
    .join(", ");

  const photoCell = (
    photo: MatchmakingProfilePhoto,
    key: string,
    hero = false,
  ) => (
    <View
      key={key}
      style={[
        hero ? styles.heroPhoto : styles.photoCell,
        { borderColor: theme.border, backgroundColor: theme.backgroundElement },
      ]}
    >
      {photo.url ? (
        <Image
          source={{ uri: photo.url }}
          style={styles.photoImage}
          contentFit="cover"
          accessibilityLabel={
            photo.isPrimary ? "Primary profile photo" : "Profile photo"
          }
        />
      ) : (
        <View style={[styles.photoImage, styles.photoPending]}>
          <Ionicons name="hourglass" size={24} color={theme.textSecondary} />
        </View>
      )}
      {photo.isPrimary && !hero ? (
        <View style={[styles.primaryBadge, { backgroundColor: theme.primary }]}>
          <ThemedText style={styles.primaryBadgeText}>Primary</ThemedText>
        </View>
      ) : null}
    </View>
  );

  const routeCta = (label: string, route: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push(route as never)}
      style={({ pressed }) => [
        styles.actionPill,
        styles.routeCta,
        { borderColor: theme.primary, backgroundColor: theme.primarySurface },
        pressed && styles.pressed,
      ]}
    >
      <ThemedText style={[styles.actionPillText, { color: theme.primary }]}>
        {label}
      </ThemedText>
    </Pressable>
  );

  const heroAction = (
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
    onPress: () => void,
  ) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionPill,
        {
          borderColor: theme.border,
          backgroundColor: theme.backgroundElement,
        },
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={16} color={theme.primary} />
      <ThemedText
        numberOfLines={1}
        style={[styles.actionPillText, { color: theme.text }]}
      >
        {label}
      </ThemedText>
    </Pressable>
  );

  const detailItems = profile
    ? [
        { icon: "mail" as const, label: "Email", value: session?.me.email },
        {
          icon: "location" as const,
          label: "Address",
          value: location || null,
        },
        {
          icon: "person" as const,
          label: "Gender",
          value: genderLabel(profile.genderKey),
        },
        {
          icon: "calendar" as const,
          label: "Date of birth",
          value: birthDateLabel(dob)
            ? `${birthDateLabel(dob)}${age != null ? ` (${age})` : ""}`
            : null,
        },
        {
          icon: "flag" as const,
          label: "Nationality",
          value: countryLabel(profile.nationalityCountryId),
        },
        {
          icon: "moon" as const,
          label: "Religion",
          value: religionLabel(profile.religionId),
        },
        {
          icon: "sparkles" as const,
          label: "Religion importance",
          value: optionLabel(
            profile.religionImportance,
            RELIGION_IMPORTANCE,
            "",
          ),
        },
        {
          icon: "school" as const,
          label: "Education",
          value: optionLabel(profile.educationLevel, EDUCATION, ""),
        },
        {
          icon: "briefcase" as const,
          label: "Occupation",
          value: profile.occupation,
        },
        {
          icon: "resize" as const,
          label: "Height",
          value: profile.heightCm ? `${profile.heightCm} cm` : null,
        },
      ].flatMap((item) => (item.value ? [{ ...item, value: item.value }] : []))
    : [];

  const relationshipItems = profile
    ? [
        {
          icon: "heart" as const,
          label: "Intention",
          value: optionLabel(profile.relationshipIntention, INTENTIONS, ""),
        },
        {
          icon: "people" as const,
          label: "Marital status",
          value: optionLabel(profile.maritalStatus, MARITAL_STATUSES, ""),
        },
        {
          icon: "time" as const,
          label: "Marriage timeline",
          value: optionLabel(profile.marriageTimeline, MARRIAGE_TIMELINES, ""),
        },
        {
          icon: "happy" as const,
          label: "Has children",
          value: yesNo(profile.hasChildren),
        },
        {
          icon: "heart-circle" as const,
          label: "Wants children",
          value: optionLabel(profile.wantsChildren, WANTS_CHILDREN, ""),
        },
        {
          icon: "airplane" as const,
          label: "Long-distance relationship",
          value: yesNo(profile.longDistanceRelationship),
        },
        {
          icon: "map" as const,
          label: "Willing to relocate",
          value: yesNo(profile.willingToRelocate),
        },
      ].flatMap((item) => (item.value ? [{ ...item, value: item.value }] : []))
    : [];

  const lifestyleItems = profile
    ? [
        {
          icon: "bonfire" as const,
          label: "Smoking",
          value: optionLabel(profile.smoking, HABITS, ""),
        },
        {
          icon: "wine" as const,
          label: "Drinking",
          value: optionLabel(profile.drinking, HABITS, ""),
        },
        {
          icon: "fitness" as const,
          label: "Activity level",
          value: optionLabel(profile.activityLevel, ACTIVITY_LEVELS, ""),
        },
      ].flatMap((item) => (item.value ? [{ ...item, value: item.value }] : []))
    : [];

  const privacyItems = profile
    ? [
        {
          icon: "contrast" as const,
          label: "Photos blurred until match",
          value: yesNo(profile.blurPhotosUntilMatch) ?? "No",
        },
        {
          icon: "eye-off" as const,
          label: "Name hidden until match",
          value: yesNo(profile.hideNameUntilMatch) ?? "No",
        },
        {
          icon: "compass" as const,
          label: "Discovery",
          value: optIn ? "Allowed" : "Off",
        },
        {
          icon: "shield-checkmark" as const,
          label: "Verification",
          value: profile.verificationStatus.replaceAll("_", " "),
        },
        {
          icon: "pulse" as const,
          label: "Profile status",
          value: profile.status,
        },
      ]
    : [];

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.screenBody}>
          {loading ? (
            <ActivityIndicator style={styles.loader} color={theme.primary} />
          ) : error && (!profile || !references) ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : profile && references ? (
            <>
              <View style={styles.hero}>
                {primary ? (
                  photoCell(primary, "primary", true)
                ) : (
                  <View
                    style={[
                      styles.heroPhoto,
                      styles.photoPending,
                      {
                        borderColor: theme.border,
                        backgroundColor: theme.primarySurface,
                      },
                    ]}
                  >
                    <Ionicons name="person" size={38} color={theme.primary} />
                  </View>
                )}
                <View style={styles.heroCopy}>
                  <ThemedText
                    type="title"
                    style={styles.heroName}
                    numberOfLines={1}
                  >
                    {displayName}
                    {age != null ? `, ${age}` : ""}
                  </ThemedText>
                  <View style={styles.actionRow}>
                    {editable
                      ? heroAction("create-outline", "Edit", () =>
                          router.push(
                            "/(app)/matchmaking/edit-profile" as never,
                          ),
                        )
                      : null}
                    {heroAction("settings-outline", "Settings", () =>
                      router.push("/(app)/matchmaking/settings" as never),
                    )}
                  </View>
                </View>
              </View>

              <PillTabBar
                tabs={TABS}
                active={tab}
                onChange={(key) => setTab(key as TabKey)}
                variant="stacked"
              />

              <ScrollView
                style={styles.contentScroll}
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
              >
                {error ? (
                  <ThemedText type="small" themeColor="error">
                    {error}
                  </ThemedText>
                ) : null}

                {tab === "details" ? (
                  <>
                    <ListCard items={detailItems} />
                    {relationshipItems.length ? (
                      <>
                        <ThemedText style={styles.sectionHeading}>
                          Marriage & relationship
                        </ThemedText>
                        <ListCard items={relationshipItems} />
                      </>
                    ) : null}
                  </>
                ) : null}

                {tab === "bio" ? (
                  session?.profile?.bio ? (
                    <View
                      style={[
                        styles.bioCard,
                        {
                          borderColor: theme.border,
                          backgroundColor: theme.backgroundElement,
                        },
                      ]}
                    >
                      <ThemedText style={styles.sectionHeading}>
                        About me
                      </ThemedText>
                      <ThemedText>{session.profile.bio}</ThemedText>
                    </View>
                  ) : (
                    <EmptyState
                      title="No bio yet"
                      body="Tell members a little about yourself."
                      icon="reader-outline"
                      action={routeCta(
                        "Add bio",
                        "/(app)/matchmaking/edit-profile",
                      )}
                    />
                  )
                ) : null}

                {tab === "photos" ? (
                  photos.length ? (
                    <View style={styles.photoGrid}>
                      {photos.map((photo) => photoCell(photo, photo.id))}
                    </View>
                  ) : (
                    <EmptyState
                      title="No photos yet"
                      body="Add photos so members can see you."
                      icon="images-outline"
                      action={routeCta(
                        "Add photos",
                        "/(app)/matchmaking/edit-profile",
                      )}
                    />
                  )
                ) : null}

                {tab === "lifestyle" ? (
                  lifestyleItems.length ? (
                    <ListCard items={lifestyleItems} />
                  ) : (
                    <EmptyState
                      title="Add your lifestyle"
                      body="Share the habits that help members understand your everyday life."
                      icon="sparkles-outline"
                      action={routeCta(
                        "Edit lifestyle",
                        "/(app)/matchmaking/edit-profile",
                      )}
                    />
                  )
                ) : null}

                {tab === "status" ? (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">
                      Privacy applies until a mutual match. Use Settings to
                      manage discovery, blocked members, and profile visibility.
                    </ThemedText>
                    <ListCard items={privacyItems} />
                    {routeCta(
                      "Open dating settings",
                      "/(app)/matchmaking/settings",
                    )}
                  </>
                ) : null}

                {tab === "preferences" ? (
                  <EmptyState
                    title="Make discovery yours"
                    body="Adjust age range, distance, verification, family, religion, and language preferences."
                    icon="options-outline"
                    action={routeCta(
                      "Edit preferences",
                      "/(app)/matchmaking/preferences",
                    )}
                  />
                ) : null}
              </ScrollView>
            </>
          ) : (
            <EmptyState
              title="No dating profile"
              body="Your dating profile could not be loaded. Create one from Dating setup."
              icon="heart-outline"
            />
          )}
        </View>
        <DatingBottomNavigation active="profile" />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  screenBody: { flex: 1, width: "100%", maxWidth: 720, alignSelf: "center" },
  loader: { flex: 1 },
  contentScroll: { flex: 1 },
  content: {
    padding: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  hero: {
    flexDirection: "row",
    gap: Spacing.three,
    alignItems: "flex-start",
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
  },
  heroCopy: { flex: 1, gap: 2 },
  heroName: { fontSize: 26, lineHeight: 32, fontWeight: "700" },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  actionPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 38,
    minWidth: 86,
    flex: 1,
  },
  actionPillText: { fontWeight: "700", fontSize: 13, flexShrink: 1 },
  routeCta: {
    flex: 0,
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.four,
  },
  pressed: { opacity: 0.72 },
  sectionHeading: { fontSize: 20, lineHeight: 26, fontWeight: "700" },
  bioCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.xl,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  heroPhoto: {
    width: 112,
    height: 142,
    borderWidth: 1,
    borderRadius: BorderRadius.xl,
    overflow: "hidden",
  },
  photoCell: {
    width: 104,
    aspectRatio: 0.78,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
  },
  photoImage: { width: "100%", height: "100%" },
  photoPending: { alignItems: "center", justifyContent: "center" },
  primaryBadge: {
    position: "absolute",
    top: 5,
    left: 5,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  primaryBadgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "700" },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
});
