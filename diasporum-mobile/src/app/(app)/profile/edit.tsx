/**
 * Edit profile screen — loads current profile, allows editing supported fields,
 * saves via PATCH /api/v1/me/profile.
 */

import React, { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';

import { safeBack } from '@/core/navigation/safe-back';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PrimaryButton } from '@/shared/components/primary-button';
import { FormInput } from '@/shared/components/form-input';
import { BrandColors } from '@/shared/theme/colors';
import { BorderRadius, Spacing } from '@/shared/theme/spacing';
import { useSession } from '@/core/session/session-provider';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/core/api/api-error';
import { Avatar } from '@/features/feed/components/avatar';
import { DobSelect } from '@/shared/components/dob-select';
import { formatDob, toIsoDate } from '@/shared/utils/date-of-birth';

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
const AVATAR_SIZE = 96;

export default function EditProfileScreen() {

  const theme = useTheme();
  const { session, apiClient, updateProfile } = useSession();
  const profile = session?.profile;

  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [city, setCity] = useState(profile?.city ?? '');
  // DOB is one-time immutable: when a value exists it renders read-only and
  // is never re-sent (the backend rejects a second write with 409 anyway).
  const dobStored = Boolean(profile?.dateOfBirth);
  const [dob, setDob] = useState(profile?.dateOfBirth ?? '');
  const [photo, setPhoto] = useState<{ uri: string; mime: string } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function pickPhoto() {
    setPhotoError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setPhotoError('Photo library access is required to add a photo.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    setPhoto({ uri: asset.uri, mime: asset.mimeType ?? 'image/jpeg' });
  }

  /** Upload the picked photo and return its media asset id (null if none). */
  async function uploadAvatar(): Promise<string | null> {
    if (!photo) return null;
    const init = await apiClient.post<{ assetId: string; uploadUrl: string }>(
      '/api/v1/media/uploads',
      { purpose: 'AVATAR', mimeType: photo.mime },
      { authenticated: true }
    );
    const fileRes = await fetch(photo.uri);
    const blob = await fileRes.blob();
    const uploadRes = await fetch(init.uploadUrl, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': photo.mime },
    });
    if (!uploadRes.ok) throw new Error('Photo upload failed');
    await apiClient.post(
      `/api/v1/media/uploads/${init.assetId}/complete`,
      {},
      { authenticated: true }
    );
    return init.assetId;
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!displayName.trim()) errs.displayName = 'Display name is required.';
    else if (displayName.trim().length > 80) errs.displayName = 'Maximum 80 characters.';
    if (!username.trim()) errs.username = 'Username is required.';
    else if (!USERNAME_PATTERN.test(username))
      errs.username = '3–20 chars; lowercase letters, numbers and underscores only.';
    if (bio.length > 800) errs.bio = 'Maximum 800 characters.';
    if (city.length > 120) errs.city = 'Maximum 120 characters.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const avatarMediaId = await uploadAvatar();
      await updateProfile({
        displayName: displayName.trim(),
        username: username.trim(),
        bio: bio.trim() || undefined,
        city: city.trim() || undefined,
        ...(dob && !dobStored ? { dateOfBirth: dob } : {}),
        ...(avatarMediaId ? { avatarMediaId } : {}),
      });
      setSaved(true);
      setTimeout(() => safeBack(), 1200);
    } catch (err) {
      if (ApiError.isApiError(err) && err.httpStatus === 409
          && /DATE_OF_BIRTH/i.test(err.message ?? '')) {
        setSaveError('Your date of birth is already set and cannot be changed.');
      } else if (ApiError.isApiError(err) && err.httpStatus === 409) {
        setErrors((e) => ({ ...e, username: 'This username is taken.' }));
      } else {
        setSaveError(
          ApiError.isApiError(err) ? err.userMessage : 'Failed to save profile.'
        );
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.header}>
            <ThemedText type="title">Edit profile</ThemedText>
          </View>
          <ScrollView contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled">
            <View style={styles.avatarWrap}>
              <View style={styles.avatarRing}>
                {photo ? (
                  <Image source={{ uri: photo.uri }} style={styles.avatarImage} />
                ) : (
                  <Avatar
                    name={displayName}
                    mediaId={profile?.avatarMediaId}
                    size={AVATAR_SIZE}
                  />
                )}
                <Pressable
                  onPress={() => void pickPhoto()}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Change profile photo"
                  style={({ pressed }) => [
                    styles.cameraBadge,
                    { backgroundColor: BrandColors.primary, borderColor: theme.background },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Ionicons name="camera" size={14} color="#FFFFFF" />
                </Pressable>
              </View>
              <Pressable
                onPress={() => void pickPhoto()}
                accessibilityRole="button"
                accessibilityLabel="Choose profile photo"
              >
                <ThemedText style={[styles.changePhoto, { color: BrandColors.primary }]}>
                  {photo || profile?.avatarMediaId ? 'Change photo' : 'Add photo'}
                </ThemedText>
              </Pressable>
              {photoError ? (
                <ThemedText style={styles.error} accessibilityRole="alert">
                  {photoError}
                </ThemedText>
              ) : null}
            </View>
            <FormInput
              label="Display name"
              value={displayName}
              onChangeText={setDisplayName}
              error={errors.displayName}
              required
              maxLength={80}
              autoCapitalize="words"
            />
            <FormInput
              label="Username"
              value={username}
              onChangeText={(v) => setUsername(v.toLowerCase())}
              error={errors.username}
              required
              maxLength={20}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <FormInput
              label="Bio"
              value={bio}
              onChangeText={setBio}
              error={errors.bio}
              maxLength={800}
              multiline
              numberOfLines={4}
              style={{ minHeight: 100, textAlignVertical: 'top' }}
            />
            <FormInput
              label="City"
              value={city}
              onChangeText={setCity}
              error={errors.city}
              maxLength={120}
              autoCapitalize="words"
            />

            {/* Date of birth — required for Dating eligibility (18+),
                one-time immutable once stored. */}
            <View style={styles.dobField}>
              <ThemedText style={styles.dobLabel}>Date of birth</ThemedText>
              {dobStored ? (
                <View
                  style={[styles.dobInput, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                  accessibilityLabel={`Date of birth, ${formatDob(dob)}`}>
                  <ThemedText style={styles.dobValue}>{formatDob(dob)}</ThemedText>
                  <Ionicons name="lock-closed-outline" size={16} color={theme.textSecondary} />
                </View>
              ) : (
                <DobSelect
                  value={dob ? new Date(`${dob}T00:00:00`) : null}
                  onChange={(date) => setDob(date ? toIsoDate(date) : '')} />
              )}
              <ThemedText style={styles.dobHint} themeColor="textSecondary">
                {dobStored
                  ? "Date of birth can't be changed."
                  : 'Required for Dating — members must be 18 or older. Set once, cannot be changed.'}
              </ThemedText>
            </View>

            {saveError ? (
              <ThemedText style={styles.error} accessibilityRole="alert">
                {saveError}
              </ThemedText>
            ) : null}
            {saved ? (
              <ThemedText style={styles.saved}>Profile updated ✓</ThemedText>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton
              label="Save changes"
              onPress={handleSave}
              loading={saving}
              disabled={saving}
            />
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  scroll: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  avatarWrap: { alignItems: 'center', gap: Spacing.two },
  avatarRing: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarImage: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  changePhoto: { fontSize: 14, fontWeight: '700' },
  error: { fontSize: 13, color: BrandColors.error, textAlign: 'center' },
  saved: { fontSize: 13, color: BrandColors.success, textAlign: 'center', fontWeight: '600' },
  dobField: { gap: Spacing.one },
  dobLabel: { fontSize: 14, fontWeight: '600' },
  dobInput: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dobValue: { fontSize: 15 },
  dobHint: { fontSize: 12, lineHeight: 16 },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
    paddingTop: Spacing.two,
  },
});
