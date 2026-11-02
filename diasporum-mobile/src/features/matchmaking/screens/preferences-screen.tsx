import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { ErrorState } from '@/shared/components/error-state';
import { FormInput } from '@/shared/components/form-input';
import { PrimaryButton } from '@/shared/components/primary-button';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/shared/theme/spacing';
import { ChoiceChips, ScreenHeader, Section, ToggleRow } from '../components/matchmaking-ui';
import { profileRequestFrom } from '../components/profile-form';
import { useMatchmakingApi } from '../hooks/use-matchmaking-api';
import { isMissingResource, matchmakingError } from '../services/matchmaking-errors';
import { CHILDREN_PREFERENCES, WANTS_CHILDREN_PREFERENCES } from '../types/matchmaking-options';
import type {
  MatchmakingPreferencesRequest, MatchmakingProfile, MatchmakingReferenceData,
} from '../types/matchmaking-types';

const DEFAULTS: MatchmakingPreferencesRequest = {
  minAge: 18, maxAge: 110, maxDistanceKm: null, showVerifiedOnly: false,
  hasChildrenPreference: 'ANY', wantsChildrenPreference: 'ANY',
  genderKeys: [], religionIds: [], languageIds: [],
};

export default function PreferencesScreen() {
  const theme = useTheme();
  const api = useMatchmakingApi();
  const params = useLocalSearchParams<{ activate?: string }>();
  const [profile, setProfile] = useState<MatchmakingProfile | null>(null);
  const [references, setReferences] = useState<MatchmakingReferenceData | null>(null);
  const [form, setForm] = useState<MatchmakingPreferencesRequest>(DEFAULTS);
  const [minAge, setMinAge] = useState('18');
  const [maxAge, setMaxAge] = useState('110');
  const [distance, setDistance] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ownProfile, preferenceData, referenceData] = await Promise.all([
        api.profile(),
        api.preferences().catch(reason => isMissingResource(reason) ? null : Promise.reject(reason)),
        api.referenceData(),
      ]);
      const preferences = preferenceData ?? DEFAULTS;
      setProfile(ownProfile);
      setReferences(referenceData);
      setForm({
        minAge: preferences.minAge, maxAge: preferences.maxAge,
        maxDistanceKm: preferences.maxDistanceKm,
        showVerifiedOnly: preferences.showVerifiedOnly,
        hasChildrenPreference: preferences.hasChildrenPreference,
        wantsChildrenPreference: preferences.wantsChildrenPreference,
        genderKeys: preferences.genderKeys, religionIds: preferences.religionIds,
        languageIds: preferences.languageIds,
      });
      setMinAge(String(preferences.minAge));
      setMaxAge(String(preferences.maxAge));
      setDistance(preferences.maxDistanceKm?.toString() ?? '');
    } catch (loadError) {
      setError(matchmakingError(loadError, 'Preferences could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [api]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof MatchmakingPreferencesRequest>(key: K, value: MatchmakingPreferencesRequest[K]) => {
    setForm(current => ({ ...current, [key]: value }));
  };
  const multi = (key: 'genderKeys' | 'religionIds' | 'languageIds') => (value: string | null | string[]) => {
    set(key, Array.isArray(value) ? value : value ? [value] : []);
  };
  const save = async () => {
    if (saving) return;
    const min = Number(minAge);
    const max = Number(maxAge);
    const maxDistance = distance.trim() ? Number(distance) : null;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 18 || max > 110 || min > max) {
      setError('Age range must use whole numbers from 18 to 110, with minimum no greater than maximum.');
      return;
    }
    if (maxDistance !== null && (!Number.isInteger(maxDistance) || maxDistance < 1 || maxDistance > 20000)) {
      setError('Maximum distance must be blank or a whole number from 1 to 20,000 km.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const request = { ...form, minAge: min, maxAge: max, maxDistanceKm: maxDistance };
      await api.savePreferences(request);
      if (params.activate === 'true' && profile && references) {
        await api.saveProfile({ ...profileRequestFrom(profile, references), status: 'ACTIVE' });
        router.replace('/(app)/matchmaking' as never);
      } else {
        router.back();
      }
    } catch (saveError) {
      setError(matchmakingError(saveError, 'Preferences could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title="Discovery preferences" subtitle="Preferences are applied reciprocally" />
        {loading ? <ActivityIndicator style={styles.loader} color={theme.primary} /> :
          error && !references ? <ErrorState message={error} onRetry={() => void load()} /> : references ? (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Section title="Age and distance">
              <View style={styles.numberRow}>
                <View style={styles.numberField}><FormInput label="Minimum age" value={minAge}
                  onChangeText={setMinAge} keyboardType="number-pad" maxLength={3} required /></View>
                <View style={styles.numberField}><FormInput label="Maximum age" value={maxAge}
                  onChangeText={setMaxAge} keyboardType="number-pad" maxLength={3} required /></View>
              </View>
              <FormInput label="Maximum distance (km)" value={distance} onChangeText={setDistance}
                keyboardType="number-pad" maxLength={5} hint="Leave blank for no distance limit" />
              <ToggleRow label="Show verified profiles only" value={form.showVerifiedOnly}
                onChange={value => set('showVerifiedOnly', value)} />
            </Section>
            <Section title="Family" hint="Empty selections and Any do not restrict that attribute.">
              <ChoiceChips label="Children" choices={CHILDREN_PREFERENCES} value={form.hasChildrenPreference}
                onChange={value => set('hasChildrenPreference', value as MatchmakingPreferencesRequest['hasChildrenPreference'])} required />
              <ChoiceChips label="Wants children" choices={WANTS_CHILDREN_PREFERENCES} value={form.wantsChildrenPreference}
                onChange={value => set('wantsChildrenPreference', value as MatchmakingPreferencesRequest['wantsChildrenPreference'])} required />
            </Section>
            <Section title="Gender, religion, and language" hint="Select none to include any active option.">
              <ChoiceChips label="Genders" choices={references.genders} value={form.genderKeys}
                onChange={multi('genderKeys')} multi />
              <ChoiceChips label="Religions" choices={references.religions} value={form.religionIds}
                onChange={multi('religionIds')} multi />
              <ChoiceChips label="Languages" choices={references.languages} value={form.languageIds}
                onChange={multi('languageIds')} multi />
            </Section>
            {error ? <ThemedText themeColor="error" accessibilityRole="alert">{error}</ThemedText> : null}
            <PrimaryButton label={params.activate === 'true' ? 'Save and activate' : 'Save preferences'}
              onPress={() => void save()} loading={saving} />
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loader: { marginTop: Spacing.six },
  content: { padding: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.five },
  numberRow: { flexDirection: 'row', gap: Spacing.three },
  numberField: { flex: 1 },
});
