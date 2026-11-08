import React from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
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
import type {
  MatchmakingReferenceData,
  PublicMatchmakingProfile,
} from "../types/matchmaking-types";
import { ProfilePhoto } from "./matchmaking-ui";

const visibleOption = (
  value: string | null,
  options: Parameters<typeof optionLabel>[1],
) =>
  value && value !== "PREFER_NOT_TO_SAY" ? optionLabel(value, options, "") : "";

export function CandidateCard({
  profile,
  onPress,
}: {
  profile: PublicMatchmakingProfile;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const open =
    onPress ??
    (() =>
      router.push(`/(app)/matchmaking/profile/${profile.userId}` as never));
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`View ${profile.displayName}'s Matchmaking profile`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.border,
        },
        pressed && styles.pressed,
      ]}
    >
      <ProfilePhoto
        uri={profile.photoUrl}
        name={profile.displayName}
        size={88}
      />
      <View style={styles.cardBody}>
        <View style={styles.nameRow}>
          <ThemedText type="subtitle" numberOfLines={1} style={styles.name}>
            {profile.displayName}
            {profile.age ? `, ${profile.age}` : ""}
          </ThemedText>
          {profile.verificationStatus === "VERIFIED" ? (
            <Ionicons
              name="checkmark-circle"
              size={19}
              color={theme.primary}
              accessibilityLabel="Verified"
            />
          ) : null}
        </View>
        <ThemedText themeColor="textSecondary" numberOfLines={1}>
          {optionLabel(
            profile.relationshipIntention,
            INTENTIONS,
            "Relationship intention not specified",
          )}
        </ThemedText>
        {profile.publicLocation ? (
          <View style={styles.cardLocation}>
            <Ionicons
              name="location-outline"
              size={14}
              color={theme.textSecondary}
            />
            <ThemedText
              type="small"
              themeColor="textSecondary"
              numberOfLines={1}
            >
              {profile.publicLocation}
            </ThemedText>
          </View>
        ) : null}
        {profile.bio ? (
          <ThemedText type="small" numberOfLines={2} style={styles.cardBio}>
            {profile.bio}
          </ThemedText>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
    </Pressable>
  );
}

export function ProfileHero({
  profile,
  immersive = false,
  onPress,
}: {
  profile: PublicMatchmakingProfile;
  immersive?: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [failedPhoto, setFailedPhoto] = React.useState<string | null>(null);
  const intention = visibleOption(profile.relationshipIntention, INTENTIONS);
  const heroHeight = Math.min(650, Math.max(470, width * 1.2));

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={
        onPress ? `View ${profile.displayName}'s photo full screen` : undefined
      }
      style={({ pressed }) => [
        styles.heroCard,
        immersive
          ? [styles.heroImmersive, { height: heroHeight }]
          : styles.heroContained,
        pressed && onPress && styles.heroPressed,
      ]}
    >
      {profile.photoUrl && failedPhoto !== profile.photoUrl ? (
        <Image
          source={{ uri: profile.photoUrl }}
          style={styles.heroImage}
          contentFit="cover"
          transition={180}
          cachePolicy="memory-disk"
          onError={() => setFailedPhoto(profile.photoUrl)}
          accessibilityLabel={`${profile.displayName}'s authorized profile photo`}
        />
      ) : (
        <View
          style={[
            styles.heroImage,
            styles.hiddenPhoto,
            { backgroundColor: theme.primarySurface },
          ]}
          accessibilityLabel={`${profile.displayName} photo hidden`}
        >
          <View
            style={[
              styles.hiddenPhotoIcon,
              { backgroundColor: theme.backgroundElement },
            ]}
          >
            <Ionicons name="person" size={62} color={theme.primary} />
          </View>
          <ThemedText themeColor="textSecondary">Photo kept private</ThemedText>
        </View>
      )}
      <LinearGradient
        colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.3)", "rgba(0,0,0,0.9)"]}
        locations={[0.35, 0.62, 1]}
        style={styles.heroScrim}
        pointerEvents="none"
      />
      {profile.photoUrl && failedPhoto !== profile.photoUrl && onPress ? (
        <View style={styles.expandPhoto} pointerEvents="none">
          <Ionicons name="expand-outline" size={18} color="#fff" />
        </View>
      ) : null}
      <View style={styles.heroInfo} pointerEvents="none">
        {intention ? (
          <View style={styles.heroIntention}>
            <Ionicons name="heart-outline" size={14} color="#fff" />
            <ThemedText style={styles.heroIntentionText}>
              {intention}
            </ThemedText>
          </View>
        ) : null}
        <View style={styles.nameRow}>
          <ThemedText style={styles.heroName} numberOfLines={1}>
            {profile.displayName}
            {profile.age ? `, ${profile.age}` : ""}
          </ThemedText>
          {profile.verificationStatus === "VERIFIED" ? (
            <Ionicons
              name="checkmark-circle"
              size={24}
              color="#67E8F9"
              accessibilityLabel="Verified"
            />
          ) : null}
        </View>
        {profile.publicLocation ? (
          <View style={styles.heroLocation}>
            <Ionicons
              name="location-sharp"
              size={15}
              color="rgba(255,255,255,0.88)"
            />
            <ThemedText style={styles.heroMeta} numberOfLines={1}>
              {profile.publicLocation}
            </ThemedText>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function DetailSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.detailSection,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}
    >
      <View style={styles.detailSectionHeader}>
        <View
          style={[
            styles.detailSectionIcon,
            { backgroundColor: theme.primarySurface },
          ]}
        >
          <Ionicons name={icon} size={18} color={theme.primary} />
        </View>
        <ThemedText style={styles.detailSectionTitle}>{title}</ThemedText>
      </View>
      {children}
    </View>
  );
}

type DetailRow = { label: string; value: string | null };

export function ProfileDetails({
  profile,
  references,
  showHero = true,
}: {
  profile: PublicMatchmakingProfile;
  references?: MatchmakingReferenceData | null;
  showHero?: boolean;
}) {
  const theme = useTheme();
  const referenceLabel = (
    id: string | null,
    options: { id: string; label: string }[] | undefined,
  ) => options?.find((option) => option.id === id)?.label ?? null;
  const yesNo = (value: boolean | null) =>
    value === null ? null : value ? "Yes" : "No";
  const intention = visibleOption(profile.relationshipIntention, INTENTIONS);
  const quickFacts = [
    { icon: "heart-outline" as const, value: intention },
    { icon: "briefcase-outline" as const, value: profile.occupation },
    {
      icon: "school-outline" as const,
      value: visibleOption(profile.educationLevel, EDUCATION),
    },
    {
      icon: "resize-outline" as const,
      value: profile.heightCm ? `${profile.heightCm} cm` : null,
    },
  ].filter((fact) => Boolean(fact.value));
  const groupDefinitions: {
    title: string;
    icon: keyof typeof Ionicons.glyphMap;
    rows: DetailRow[];
  }[] = [
    {
      title: "The basics",
      icon: "person-outline",
      rows: [
        {
          label: "Gender",
          value: referenceLabel(profile.genderKey, references?.genders),
        },
        {
          label: "Nationality",
          value: referenceLabel(
            profile.nationalityCountryId,
            references?.countries,
          ),
        },
        {
          label: "Religion",
          value: referenceLabel(profile.religionId, references?.religions),
        },
        {
          label: "Religion importance",
          value: visibleOption(profile.religionImportance, RELIGION_IMPORTANCE),
        },
        {
          label: "Education",
          value: visibleOption(profile.educationLevel, EDUCATION),
        },
        { label: "Occupation", value: profile.occupation },
      ],
    },
    {
      title: "Relationship & future",
      icon: "heart-outline",
      rows: [
        { label: "Relationship intention", value: intention },
        {
          label: "Marital status",
          value: visibleOption(profile.maritalStatus, MARITAL_STATUSES),
        },
        {
          label: "Marriage timeline",
          value: visibleOption(profile.marriageTimeline, MARRIAGE_TIMELINES),
        },
        {
          label: "Long-distance relationship",
          value: yesNo(profile.longDistanceRelationship),
        },
        {
          label: "Willing to relocate",
          value: yesNo(profile.willingToRelocate),
        },
      ],
    },
    {
      title: "Family",
      icon: "people-outline",
      rows: [
        { label: "Has children", value: yesNo(profile.hasChildren) },
        {
          label: "Wants children",
          value: visibleOption(profile.wantsChildren, WANTS_CHILDREN),
        },
      ],
    },
    {
      title: "Everyday life",
      icon: "sunny-outline",
      rows: [
        { label: "Smoking", value: visibleOption(profile.smoking, HABITS) },
        { label: "Drinking", value: visibleOption(profile.drinking, HABITS) },
        {
          label: "Activity level",
          value: visibleOption(profile.activityLevel, ACTIVITY_LEVELS),
        },
        {
          label: "Height",
          value: profile.heightCm ? `${profile.heightCm} cm` : null,
        },
      ],
    },
  ];
  const groups = groupDefinitions
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row): row is DetailRow & { value: string } =>
        Boolean(row.value),
      ),
    }))
    .filter((group) => group.rows.length > 0);

  return (
    <View style={styles.details}>
      {showHero ? (
        <View style={styles.hero}>
          <ProfileHero profile={profile} />
          {profile.photoVisibility === "BLURRED" ? (
            <View style={styles.privacyNote}>
              <Ionicons
                name="shield-checkmark-outline"
                size={15}
                color={theme.textSecondary}
              />
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={styles.privacyText}
              >
                This member chose a private, blurred photo
              </ThemedText>
            </View>
          ) : null}
        </View>
      ) : null}
      {quickFacts.length ? (
        <DetailSection title="At a glance" icon="sparkles-outline">
          <View style={styles.tags}>
            {quickFacts.map((fact) => (
              <View
                key={`${fact.icon}-${fact.value}`}
                style={[styles.factTag, { backgroundColor: theme.background }]}
              >
                <Ionicons name={fact.icon} size={15} color={theme.primary} />
                <ThemedText type="small" style={styles.factText}>
                  {fact.value}
                </ThemedText>
              </View>
            ))}
          </View>
        </DetailSection>
      ) : null}
      {profile.bio ? (
        <DetailSection
          title={`About ${profile.displayName}`}
          icon="chatbubble-ellipses-outline"
        >
          <ThemedText style={styles.bio}>{profile.bio}</ThemedText>
        </DetailSection>
      ) : null}
      {profile.interests?.length || profile.languages?.length ? (
        <DetailSection title="Things we can connect over" icon="planet-outline">
          {profile.interests?.length ? (
            <View style={styles.tags}>
              {profile.interests.map((interest) => (
                <View
                  key={interest}
                  style={[
                    styles.tag,
                    { backgroundColor: theme.primarySurface },
                  ]}
                >
                  <ThemedText type="small" style={{ color: theme.primary }}>
                    {interest}
                  </ThemedText>
                </View>
              ))}
            </View>
          ) : null}
          {profile.languages?.length ? (
            <View style={styles.languageRow}>
              <Ionicons
                name="language-outline"
                size={18}
                color={theme.textSecondary}
              />
              <ThemedText
                themeColor="textSecondary"
                style={styles.languageText}
              >
                Speaks {profile.languages.join(", ")}
              </ThemedText>
            </View>
          ) : null}
        </DetailSection>
      ) : null}
      {groups.map((group) => (
        <DetailSection key={group.title} title={group.title} icon={group.icon}>
          <View>
            {group.rows.map((row, index) => (
              <View
                key={row.label}
                style={[
                  styles.detailRow,
                  { borderBottomColor: theme.border },
                  index === group.rows.length - 1 && styles.detailRowLast,
                ]}
              >
                <ThemedText
                  themeColor="textSecondary"
                  style={styles.detailLabel}
                >
                  {row.label}
                </ThemedText>
                <ThemedText style={styles.detailValue}>{row.value}</ThemedText>
              </View>
            ))}
          </View>
        </DetailSection>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    borderRadius: BorderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
  },
  pressed: { opacity: 0.75 },
  cardBody: { flex: 1, gap: 5 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: Spacing.one },
  name: { flexShrink: 1 },
  cardLocation: { flexDirection: "row", alignItems: "center", gap: 3 },
  cardBio: { lineHeight: 18, marginTop: 2 },
  details: { gap: Spacing.three },
  hero: { gap: Spacing.two },
  heroCard: {
    width: "100%",
    overflow: "hidden",
    backgroundColor: "#17131f",
  },
  heroContained: {
    aspectRatio: 4 / 5,
    maxHeight: 520,
    borderRadius: BorderRadius.xl,
  },
  heroImmersive: {
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  heroPressed: { opacity: 0.94 },
  heroImage: { width: "100%", height: "100%" },
  heroScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "52%",
  },
  heroInfo: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  heroIntention: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.3)",
  },
  heroIntentionText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  heroName: {
    color: "#fff",
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "800",
    flexShrink: 1,
  },
  heroLocation: { flexDirection: "row", alignItems: "center", gap: 4 },
  heroMeta: { color: "rgba(255,255,255,0.9)", fontSize: 14, fontWeight: "500" },
  hiddenPhoto: {
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.three,
  },
  hiddenPhotoIcon: {
    width: 116,
    height: 116,
    borderRadius: 58,
    alignItems: "center",
    justifyContent: "center",
  },
  expandPhoto: {
    position: "absolute",
    right: Spacing.three,
    bottom: 112,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  privacyNote: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 12,
  },
  privacyText: { flexShrink: 1 },
  detailSection: {
    borderRadius: BorderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  detailSectionHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  detailSectionIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  detailSectionTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "800",
    flex: 1,
  },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  factTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  factText: { fontWeight: "600" },
  bio: { fontSize: 15, lineHeight: 24 },
  tag: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  languageRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  languageText: { flex: 1, lineHeight: 20 },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.three,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  detailRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  detailLabel: { flex: 1, fontSize: 14, lineHeight: 20 },
  detailValue: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    textAlign: "right",
  },
});
