import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { BorderRadius, Spacing } from '@/shared/theme/spacing';
import {
  ACTIVITY_LEVELS, EDUCATION, HABITS, INTENTIONS, MARITAL_STATUSES,
  MARRIAGE_TIMELINES, RELIGION_IMPORTANCE, WANTS_CHILDREN, optionLabel,
} from '../types/matchmaking-options';
import type { MatchmakingReferenceData, PublicMatchmakingProfile } from '../types/matchmaking-types';
import { ProfilePhoto } from './matchmaking-ui';

export function CandidateCard({ profile, onPress }: {
  profile: PublicMatchmakingProfile;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const open = onPress ?? (() => router.push(`/(app)/matchmaking/profile/${profile.userId}` as never));
  return (
    <Pressable onPress={open} accessibilityRole="button"
      accessibilityLabel={`View ${profile.displayName}'s Matchmaking profile`}
      style={({ pressed }) => [styles.card, { backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}>
      <ProfilePhoto uri={profile.photoUrl} name={profile.displayName} size={82} />
      <View style={styles.cardBody}>
        <View style={styles.nameRow}>
          <ThemedText type="subtitle" numberOfLines={1} style={styles.name}>
            {profile.displayName}{profile.age ? `, ${profile.age}` : ''}
          </ThemedText>
          {profile.verificationStatus === 'VERIFIED' ?
            <Ionicons name="checkmark-circle" size={19} color={theme.primary} accessibilityLabel="Verified" /> : null}
        </View>
        <ThemedText themeColor="textSecondary" numberOfLines={1}>
          {optionLabel(profile.relationshipIntention, INTENTIONS, 'Relationship intention not specified')}
        </ThemedText>
        {profile.occupation ? <ThemedText type="small" numberOfLines={1}>{profile.occupation}</ThemedText> : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
    </Pressable>
  );
}

export function ProfileDetails({ profile, references }: {
  profile: PublicMatchmakingProfile;
  references?: MatchmakingReferenceData | null;
}) {
  const theme = useTheme();
  const referenceLabel = (id: string | null, options: { id: string; label: string }[] | undefined) =>
    options?.find(option => option.id === id)?.label ?? null;
  const yesNo = (value: boolean | null) => value === null ? null : value ? 'Yes' : 'No';
  const rows = [
    ['Gender', referenceLabel(profile.genderKey, references?.genders)],
    ['Nationality', referenceLabel(profile.nationalityCountryId, references?.countries)],
    ['Religion', referenceLabel(profile.religionId, references?.religions)],
    ['Religion importance', optionLabel(profile.religionImportance, RELIGION_IMPORTANCE, '')],
    ['Education', optionLabel(profile.educationLevel, EDUCATION, '')],
    ['Occupation', profile.occupation],
    ['Relationship intention', optionLabel(profile.relationshipIntention, INTENTIONS, '')],
    ['Marital status', optionLabel(profile.maritalStatus, MARITAL_STATUSES, '')],
    ['Has children', yesNo(profile.hasChildren)],
    ['Wants children', optionLabel(profile.wantsChildren, WANTS_CHILDREN, '')],
    ['Marriage timeline', optionLabel(profile.marriageTimeline, MARRIAGE_TIMELINES, '')],
    ['Long-distance relationship', yesNo(profile.longDistanceRelationship)],
    ['Willing to relocate', yesNo(profile.willingToRelocate)],
    ['Smoking', optionLabel(profile.smoking, HABITS, '')],
    ['Drinking', optionLabel(profile.drinking, HABITS, '')],
    ['Activity level', optionLabel(profile.activityLevel, ACTIVITY_LEVELS, '')],
    ['Height', profile.heightCm ? `${profile.heightCm} cm` : null],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return (
    <View style={styles.details}>
      <View style={styles.hero}>
        <ProfilePhoto uri={profile.photoUrl} name={profile.displayName} size={112} />
        <View style={styles.nameRow}>
          <ThemedText type="title">{profile.displayName}{profile.age ? `, ${profile.age}` : ''}</ThemedText>
          {profile.verificationStatus === 'VERIFIED' ?
            <Ionicons name="checkmark-circle" size={22} color={theme.primary} accessibilityLabel="Verified" /> : null}
        </View>
      </View>
      {rows.map(([label, value]) => (
        <View key={label} style={[styles.detailRow, { borderBottomColor: theme.border }]}>
          <ThemedText themeColor="textSecondary" style={styles.detailLabel}>{label}</ThemedText>
          <ThemedText style={styles.detailValue}>{value}</ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.three,
    borderRadius: BorderRadius.lg, padding: Spacing.three,
  },
  pressed: { opacity: 0.75 },
  cardBody: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  name: { flexShrink: 1 },
  details: { gap: Spacing.two },
  hero: { alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three },
  detailRow: { flexDirection: 'row', gap: Spacing.three, paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth },
  detailLabel: { flex: 1, fontSize: 14 },
  detailValue: { flex: 1, fontSize: 14, fontWeight: '600', textAlign: 'right' },
});
