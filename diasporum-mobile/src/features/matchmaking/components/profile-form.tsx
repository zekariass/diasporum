import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { FormInput } from '@/shared/components/form-input';
import { PrimaryButton } from '@/shared/components/primary-button';
import { useSession } from '@/core/session/session-provider';
import { Spacing } from '@/shared/theme/spacing';
import {
  ACTIVITY_LEVELS, EDUCATION, HABITS, INTENTIONS, MARITAL_STATUSES,
  MARRIAGE_TIMELINES, RELIGION_IMPORTANCE, VISIBILITIES, WANTS_CHILDREN,
} from '../types/matchmaking-options';
import type {
  FieldVisibility, MatchmakingProfile, MatchmakingProfileRequest,
  MatchmakingReferenceData, MatchmakingStatus,
} from '../types/matchmaking-types';
import { pickAndUploadMatchmakingPhoto, type MatchmakingPhotoPurpose } from '../services/matchmaking-media-api';
import { matchmakingError } from '../services/matchmaking-errors';
import { ChoiceChips, ProfilePhoto, Section, ToggleRow } from './matchmaking-ui';

export function profileRequestFrom(profile: MatchmakingProfile | null, references: MatchmakingReferenceData): MatchmakingProfileRequest {
  return {
    genderKey: profile?.genderKey ?? references.genders[0]?.id ?? '',
    addressId: profile?.addressId ?? null,
    nationalityCountryId: profile?.nationalityCountryId ?? null,
    religionId: profile?.religionId ?? null,
    educationLevel: profile?.educationLevel ?? null,
    occupation: profile?.occupation ?? null,
    relationshipIntention: profile?.relationshipIntention ?? null,
    maritalStatus: profile?.maritalStatus ?? null,
    hasChildren: profile?.hasChildren ?? null,
    wantsChildren: profile?.wantsChildren ?? null,
    smoking: profile?.smoking ?? null,
    drinking: profile?.drinking ?? null,
    activityLevel: profile?.activityLevel ?? null,
    heightCm: profile?.heightCm ?? null,
    marriageTimeline: profile?.marriageTimeline ?? null,
    longDistanceRelationship: profile?.longDistanceRelationship ?? null,
    religionImportance: profile?.religionImportance ?? null,
    willingToRelocate: profile?.willingToRelocate ?? null,
    photoMediaId: profile?.photoMediaId ?? null,
    blurredPhotoMediaId: profile?.blurredPhotoMediaId ?? null,
    nameVisibility: profile?.nameVisibility ?? 'BLURRED',
    photoVisibility: profile?.photoVisibility ?? 'HIDDEN',
    anonymousAlias: profile?.anonymousAlias ?? 'Diasporum member',
    status: profile?.status === 'ACTIVE' || profile?.status === 'PAUSED' ? profile.status : 'DRAFT',
  };
}

export function ProfileForm({ profile, references, status, saving, submitLabel, onSubmit }: {
  profile: MatchmakingProfile | null;
  references: MatchmakingReferenceData;
  status: Extract<MatchmakingStatus, 'DRAFT' | 'ACTIVE' | 'PAUSED'>;
  saving: boolean;
  submitLabel: string;
  onSubmit: (request: MatchmakingProfileRequest) => void;
}) {
  const { apiClient } = useSession();
  const [form, setForm] = useState<MatchmakingProfileRequest>(() => ({
    ...profileRequestFrom(profile, references), status,
  }));
  const [height, setHeight] = useState(form.heightCm?.toString() ?? '');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [blurredPhotoUri, setBlurredPhotoUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState<MatchmakingPhotoPurpose | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof MatchmakingProfileRequest, value: string | number | boolean | null) => {
    setForm(current => ({ ...current, [field]: value }));
  };
  const single = (field: keyof MatchmakingProfileRequest) => (value: string | null | string[]) => {
    set(field, Array.isArray(value) ? value[0] ?? null : value);
  };
  const upload = async (purpose: MatchmakingPhotoPurpose) => {
    if (uploading) return;
    setUploading(purpose);
    setError(null);
    try {
      const uploaded = await pickAndUploadMatchmakingPhoto(apiClient, purpose);
      if (uploaded) {
        if (purpose === 'MATCHMAKING_PROFILE_PHOTO') {
          set('photoMediaId', uploaded.assetId);
          setPhotoUri(uploaded.localUri);
        } else {
          set('blurredPhotoMediaId', uploaded.assetId);
          setBlurredPhotoUri(uploaded.localUri);
        }
      }
    } catch (uploadError) {
      setError(matchmakingError(uploadError,
        uploadError instanceof Error ? uploadError.message : 'The photo could not be uploaded.'));
    } finally {
      setUploading(null);
    }
  };
  const submit = () => {
    const parsedHeight = height.trim() ? Number(height) : null;
    if (!form.genderKey || !form.anonymousAlias.trim()) {
      setError('Gender and an anonymous alias are required.');
      return;
    }
    if (parsedHeight !== null && (!Number.isInteger(parsedHeight) || parsedHeight < 80 || parsedHeight > 250)) {
      setError('Height must be a whole number between 80 and 250 cm.');
      return;
    }
    setError(null);
    onSubmit({ ...form, anonymousAlias: form.anonymousAlias.trim(),
      occupation: form.occupation?.trim() || null, heightCm: parsedHeight, status });
  };

  return (
    <View style={styles.form}>
      <Section title="Identity" hint="Only the visibility-approved name and photo are shown to candidates.">
        <ChoiceChips label="Gender" choices={references.genders} value={form.genderKey}
          onChange={single('genderKey')} required />
        <FormInput label="Anonymous alias" value={form.anonymousAlias} maxLength={80}
          onChangeText={value => set('anonymousAlias', value)} required />
        <ChoiceChips label="Name visibility" choices={VISIBILITIES} value={form.nameVisibility}
          onChange={value => set('nameVisibility', value as FieldVisibility)} required />
        <ChoiceChips label="Photo visibility" choices={VISIBILITIES} value={form.photoVisibility}
          onChange={value => set('photoVisibility', value as FieldVisibility)} required />
        <View style={styles.photoRow}>
          <View style={styles.photoItem}>
            <ProfilePhoto uri={photoUri} name="Original" size={76} />
            <PrimaryButton label={form.photoMediaId ? 'Replace photo' : 'Upload photo'} variant="secondary"
              loading={uploading === 'MATCHMAKING_PROFILE_PHOTO'} disabled={uploading !== null}
              onPress={() => void upload('MATCHMAKING_PROFILE_PHOTO')} />
          </View>
          <View style={styles.photoItem}>
            <ProfilePhoto uri={blurredPhotoUri} name="Blurred" size={76} />
            <PrimaryButton label={form.blurredPhotoMediaId ? 'Replace blurred' : 'Upload blurred'} variant="secondary"
              loading={uploading === 'MATCHMAKING_PROFILE_BLURRED'} disabled={uploading !== null}
              onPress={() => void upload('MATCHMAKING_PROFILE_BLURRED')} />
          </View>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          Blurred visibility requires a separate, already-blurred image. Hidden visibility shows no photo.
        </ThemedText>
      </Section>

      <Section title="Background">
        <ChoiceChips label="Nationality" choices={references.countries} value={form.nationalityCountryId}
          onChange={single('nationalityCountryId')} />
        <ChoiceChips label="Religion" choices={references.religions} value={form.religionId}
          onChange={single('religionId')} />
        <ChoiceChips label="Religion importance" choices={RELIGION_IMPORTANCE} value={form.religionImportance}
          onChange={single('religionImportance')} />
        <ChoiceChips label="Private discovery location" choices={references.addresses} value={form.addressId}
          onChange={single('addressId')} />
        <ThemedText type="small" themeColor="textSecondary">
          Only your saved private addresses are listed. Exact coordinates and address details are never shared.
        </ThemedText>
        <ChoiceChips label="Education" choices={EDUCATION} value={form.educationLevel}
          onChange={single('educationLevel')} />
        <FormInput label="Occupation" value={form.occupation ?? ''} maxLength={160}
          onChangeText={value => set('occupation', value)} />
        <FormInput label="Height (cm)" value={height} keyboardType="number-pad" maxLength={3}
          onChangeText={setHeight} hint="Optional, 80–250 cm" />
      </Section>

      <Section title="Relationship">
        <ChoiceChips label="Intention" choices={INTENTIONS} value={form.relationshipIntention}
          onChange={single('relationshipIntention')} />
        <ChoiceChips label="Marital status" choices={MARITAL_STATUSES} value={form.maritalStatus}
          onChange={single('maritalStatus')} />
        <ToggleRow label="I have children" value={form.hasChildren ?? false}
          onChange={value => set('hasChildren', value)} />
        <ChoiceChips label="Wants children" choices={WANTS_CHILDREN} value={form.wantsChildren}
          onChange={single('wantsChildren')} />
        <ChoiceChips label="Marriage timeline" choices={MARRIAGE_TIMELINES} value={form.marriageTimeline}
          onChange={single('marriageTimeline')} />
        <ToggleRow label="Open to a long-distance relationship" value={form.longDistanceRelationship ?? false}
          onChange={value => set('longDistanceRelationship', value)} />
        <ToggleRow label="Willing to relocate" value={form.willingToRelocate ?? false}
          onChange={value => set('willingToRelocate', value)} />
      </Section>

      <Section title="Lifestyle">
        <ChoiceChips label="Smoking" choices={HABITS} value={form.smoking} onChange={single('smoking')} />
        <ChoiceChips label="Drinking" choices={HABITS} value={form.drinking} onChange={single('drinking')} />
        <ChoiceChips label="Activity level" choices={ACTIVITY_LEVELS} value={form.activityLevel}
          onChange={single('activityLevel')} />
      </Section>

      {error ? <ThemedText themeColor="error" accessibilityRole="alert">{error}</ThemedText> : null}
      <PrimaryButton label={submitLabel} onPress={submit} loading={saving} disabled={uploading !== null} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: Spacing.five },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.four },
  photoItem: { alignItems: 'center', gap: Spacing.two, flex: 1, minWidth: 145 },
});
