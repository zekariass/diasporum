/**
 * Step 4 of 5 — Complete your profile.
 * Optional photo (uploaded via /media/uploads purpose=AVATAR, linked through
 * PATCH /me/profile avatarMediaId), display name, username with debounced
 * availability check, optional bio. Continues to the completion screen.
 * Design ref: screen 6 — profile-setup artwork, avatar with camera badge.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PrimaryButton } from '@/shared/components/primary-button';
import { OnboardingHeader } from '@/shared/components/onboarding-header';
import { FormInput } from '@/shared/components/form-input';
import { BrandColors } from '@/shared/theme/colors';
import { Spacing } from '@/shared/theme/spacing';
import { useOnboarding } from '@/features/onboarding/hooks/use-onboarding';
import { createProfileApi } from '@/features/profile/services/profile-api';
import { useSession } from '@/core/session/session-provider';
import { ApiError } from '@/core/api/api-error';

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
const BIO_MAX = 160;

export default function ProfileInfoScreen() {
  const router = useRouter();
  const { apiClient } = useSession();
  const { session, updateProfile } = useOnboarding();

  const [displayName, setDisplayName] = useState(
    session?.profile?.displayName ?? ''
  );
  const [username, setUsername] = useState(session?.profile?.username ?? '');
  const [bio, setBio] = useState(session?.profile?.bio ?? '');

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoMime, setPhotoMime] = useState<string>('image/jpeg');
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [usernameStatus, setUsernameStatus] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'reserved'
  >('idle');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileApi = React.useMemo(() => createProfileApi(apiClient), [apiClient]);

  // Debounced username availability check
  const checkUsername = useCallback(
    async (value: string) => {
      if (!value || value === session?.profile?.username) {
        setUsernameStatus('idle');
        return;
      }
      if (!USERNAME_PATTERN.test(value)) {
        setUsernameStatus('invalid');
        return;
      }
      setUsernameStatus('checking');
      try {
        const res = await profileApi.usernameAvailability(value);
        setUsernameStatus(
          res.available ? 'available' : res.reason === 'RESERVED' ? 'reserved' : 'taken'
        );
      } catch {
        setUsernameStatus('idle');
      }
    },
    [profileApi, session?.profile?.username]
  );

  function handleUsernameChange(value: string) {
    const normalized = value.toLowerCase().trim();
    setUsername(normalized);
    setUsernameStatus('idle');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void checkUsername(normalized), 500);
  }

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

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
    setPhotoUri(asset.uri);
    setPhotoMime(asset.mimeType ?? 'image/jpeg');
  }

  /** Upload the picked photo and return its media asset id (null if none). */
  async function uploadAvatar(): Promise<string | null> {
    if (!photoUri) return null;
    const init = await apiClient.post<{ assetId: string; uploadUrl: string }>(
      '/api/v1/media/uploads',
      { purpose: 'AVATAR', mimeType: photoMime },
      { authenticated: true }
    );
    const fileRes = await fetch(photoUri);
    const blob = await fileRes.blob();
    const uploadRes = await fetch(init.uploadUrl, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': photoMime },
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
      errs.username = '3–20 characters; lowercase letters, numbers and underscores only.';
    if (usernameStatus === 'taken') errs.username = 'This username is taken.';
    if (usernameStatus === 'reserved') errs.username = 'This username is reserved.';
    if (bio.length > BIO_MAX) errs.bio = `Maximum ${BIO_MAX} characters.`;
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleNext() {
    if (!validate()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const avatarMediaId = await uploadAvatar();
      await updateProfile({
        displayName: displayName.trim(),
        username: username.trim(),
        bio: bio.trim() || undefined,
        ...(avatarMediaId ? { avatarMediaId } : {}),
      });
      router.push('/(onboarding)/complete' as never);
    } catch (err) {
      if (ApiError.isApiError(err) && err.httpStatus === 409) {
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

  const usernameHint =
    usernameStatus === 'checking'
      ? 'Checking availability…'
      : usernameStatus === 'available'
      ? '✓ Available'
      : usernameStatus === 'invalid'
      ? '3–20 chars; lowercase, numbers, underscores only'
      : undefined;

  const avatarInitial = (displayName.trim()[0] ?? '?').toUpperCase();

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea}>
        <OnboardingHeader
          currentStep="profile"
          showBack
          onBack={() => router.replace('/(onboarding)/community-preview')}
        />

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>

            {/* Hero */}
            <View style={styles.hero}>
              <ThemedText style={styles.title}>Complete your profile</ThemedText>
              <ThemedText style={styles.subtitle} themeColor="textSecondary">
                Help your community know you better.
              </ThemedText>
            </View>

            {/* Avatar picker */}
            <View style={styles.avatarWrap}>
              <Pressable
                onPress={() => void pickPhoto()}
                accessibilityRole="button"
                accessibilityLabel="Add profile photo">
                <View style={[styles.avatar, { backgroundColor: BrandColors.primarySurface }]}>
                  {photoUri ? (
                    <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : (
                    <ThemedText style={[styles.avatarInitial, { color: BrandColors.primary }]}>
                      {avatarInitial}
                    </ThemedText>
                  )}
                </View>
                <View style={[styles.cameraBadge, { backgroundColor: BrandColors.primary }]}>
                  <ThemedText style={styles.cameraIcon}>📷</ThemedText>
                </View>
              </Pressable>
              {photoError ? (
                <ThemedText style={styles.photoError}>{photoError}</ThemedText>
              ) : null}
            </View>

            {/* Form fields */}
            <View style={styles.form}>
              <FormInput
                label="Display name"
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="e.g. Abebe Tesfaye"
                error={errors.displayName}
                required
                maxLength={80}
                autoCapitalize="words"
              />

              <View>
                <FormInput
                  label="Username"
                  value={username}
                  onChangeText={handleUsernameChange}
                  placeholder="e.g. abebe.t"
                  error={errors.username}
                  required
                  maxLength={20}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {usernameHint ? (
                  <ThemedText
                    style={[
                      styles.usernameHint,
                      {
                        color:
                          usernameStatus === 'available'
                            ? BrandColors.success
                            : usernameStatus === 'checking'
                            ? '#9CA3AF'
                            : BrandColors.error,
                      },
                    ]}>
                    {usernameHint}
                  </ThemedText>
                ) : null}
              </View>

              <View>
                <FormInput
                  label="Bio (optional)"
                  value={bio}
                  onChangeText={setBio}
                  placeholder="A short introduction"
                  error={errors.bio}
                  maxLength={BIO_MAX}
                  multiline
                  numberOfLines={3}
                  style={{ minHeight: 88, textAlignVertical: 'top' }}
                />
                <ThemedText style={styles.charCount} themeColor="textSecondary">
                  {bio.length}/{BIO_MAX}
                </ThemedText>
              </View>
            </View>

            {saveError ? (
              <ThemedText style={styles.saveError} accessibilityRole="alert">
                {saveError}
              </ThemedText>
            ) : null}

            <ThemedText style={styles.legal} themeColor="textSecondary">
              By continuing, you agree to our{' '}
              <ThemedText style={styles.legalLink}>Community Guidelines</ThemedText>,{' '}
              <ThemedText style={styles.legalLink}>Terms of Service</ThemedText> and{' '}
              <ThemedText style={styles.legalLink}>Privacy Policy</ThemedText>.
            </ThemedText>

            <PrimaryButton
              label="Continue"
              onPress={() => void handleNext()}
              loading={saving}
              disabled={saving || usernameStatus === 'checking'}
              style={styles.cta}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  hero: { gap: Spacing.one },
  title: { fontSize: 26, fontWeight: '700', lineHeight: 32, letterSpacing: -0.3 },
  subtitle: { fontSize: 15, lineHeight: 22 },
  avatarWrap: { alignItems: 'center', gap: Spacing.one },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarInitial: { fontSize: 36, fontWeight: '700' },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  cameraIcon: { fontSize: 14 },
  photoError: { fontSize: 12, color: BrandColors.error, textAlign: 'center' },
  form: { gap: Spacing.three },
  usernameHint: { fontSize: 12, marginTop: 4, marginLeft: 2 },
  charCount: { fontSize: 11, textAlign: 'right', marginTop: 4 },
  saveError: { fontSize: 13, color: BrandColors.error, textAlign: 'center' },
  legal: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
  legalLink: { color: BrandColors.primary, fontWeight: '600' },
  cta: { marginTop: Spacing.one },
});
