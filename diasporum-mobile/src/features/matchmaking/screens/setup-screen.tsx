import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { ErrorState } from '@/shared/components/error-state';
import { PrimaryButton } from '@/shared/components/primary-button';
import { useSession } from '@/core/session/session-provider';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/shared/theme/spacing';
import { ProfileForm } from '../components/profile-form';
import { EmptyState, ScreenHeader, ToggleRow } from '../components/matchmaking-ui';
import { useMatchmakingApi } from '../hooks/use-matchmaking-api';
import { isMissingResource, matchmakingError } from '../services/matchmaking-errors';
import { isAdultDateOfBirth } from '../utils/adult-eligibility';
import type {
  MatchmakingProfile, MatchmakingProfileRequest, MatchmakingReferenceData,
} from '../types/matchmaking-types';

export default function SetupScreen() {
  const theme = useTheme();
  const api = useMatchmakingApi();
  const { session } = useSession();
  const [profile, setProfile] = useState<MatchmakingProfile | null>(null);
  const [references, setReferences] = useState<MatchmakingReferenceData | null>(null);
  const [optIn, setOptIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ownProfile, referenceData, privacy] = await Promise.all([
        api.profile().catch(reason => isMissingResource(reason) ? null : Promise.reject(reason)),
        api.referenceData(),
        api.privacy(),
      ]);
      setProfile(ownProfile);
      setReferences(referenceData);
      setOptIn(privacy.allowMatchmakingDiscovery);
    } catch (loadError) {
      setError(matchmakingError(loadError, 'Matchmaking setup could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [api]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const changeOptIn = async (value: boolean) => {
    if (savingPrivacy) return;
    setSavingPrivacy(true);
    setError(null);
    try {
      const privacy = await api.setDiscoveryOptIn(value);
      setOptIn(privacy.allowMatchmakingDiscovery);
    } catch (privacyError) {
      setError(matchmakingError(privacyError, 'Discovery privacy could not be updated.'));
    } finally {
      setSavingPrivacy(false);
    }
  };
  const save = async (request: MatchmakingProfileRequest) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.saveProfile(request);
      router.push('/(app)/matchmaking/preferences?activate=true' as never);
    } catch (saveError) {
      setError(matchmakingError(saveError, 'Your Matchmaking profile could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  const adult = isAdultDateOfBirth(session?.profile?.dateOfBirth ?? null);
  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title="Matchmaking setup" subtitle="Private by default, visible only on your terms" />
        {loading ? <ActivityIndicator style={styles.loader} color={theme.primary} /> :
          error && !references ? <ErrorState message={error} onRetry={() => void load()} /> : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {!session?.profile?.dateOfBirth ? (
              <EmptyState title="Date of birth required" icon="calendar-outline"
                body="Add your date of birth to your personal profile before joining Matchmaking. You must be at least 18."
                action={<PrimaryButton label="Edit personal profile" onPress={() => router.push('/(app)/profile/edit')} />} />
            ) : !adult ? (
              <EmptyState title="Matchmaking is for adults" icon="shield-checkmark-outline"
                body="Matchmaking is available only to members aged 18 or older." />
            ) : references ? (
              <>
                <ToggleRow label="Allow Matchmaking discovery" value={optIn} disabled={savingPrivacy}
                  hint="Required for activation. You can pause or delete your Matchmaking profile later."
                  onChange={value => void changeOptIn(value)} />
                {error ? <ThemedText themeColor="error" accessibilityRole="alert">{error}</ThemedText> : null}
                <ProfileForm profile={profile} references={references} status="DRAFT" saving={saving}
                  submitLabel="Save and set preferences" onSubmit={request => void save(request)} />
              </>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loader: { marginTop: Spacing.six },
  content: { padding: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four, flexGrow: 1 },
});
