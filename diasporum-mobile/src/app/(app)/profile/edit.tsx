/**
 * Edit profile screen — loads current profile, allows editing supported fields,
 * saves via PATCH /api/v1/me/profile.
 */

import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { safeBack } from '@/core/navigation/safe-back';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PrimaryButton } from '@/shared/components/primary-button';
import { FormInput } from '@/shared/components/form-input';
import { BrandColors } from '@/shared/theme/colors';
import { Spacing } from '@/shared/theme/spacing';
import { useSession } from '@/core/session/session-provider';
import { ApiError } from '@/core/api/api-error';

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export default function EditProfileScreen() {

  const { session, updateProfile } = useSession();
  const profile = session?.profile;

  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [city, setCity] = useState(profile?.city ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
      await updateProfile({
        displayName: displayName.trim(),
        username: username.trim(),
        bio: bio.trim() || undefined,
        city: city.trim() || undefined,
      });
      setSaved(true);
      setTimeout(() => safeBack(), 1200);
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
  error: { fontSize: 13, color: BrandColors.error, textAlign: 'center' },
  saved: { fontSize: 13, color: BrandColors.success, textAlign: 'center', fontWeight: '600' },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
    paddingTop: Spacing.two,
  },
});
