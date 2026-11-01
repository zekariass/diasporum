/**
 * Step 1 of 5 — Country of origin selection.
 * Fetches active countries from the Taxonomy API; saves via PATCH /me/profile.
 * Design ref: screen 3 — heritage artwork banner + searchable country list.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PrimaryButton } from '@/shared/components/primary-button';
import { OnboardingHeader } from '@/shared/components/onboarding-header';
import { SearchableList, type SearchableListItem } from '@/shared/components/searchable-list';
import { BrandColors } from '@/shared/theme/colors';
import { BorderRadius, Spacing } from '@/shared/theme/spacing';
import { useOnboarding } from '@/features/onboarding/hooks/use-onboarding';
import { createTaxonomyApi } from '@/features/onboarding/services/taxonomy-api';
import { useSession } from '@/core/session/session-provider';
import type { CountryView } from '@/features/communities/types/community-types';
import { ApiError } from '@/core/api/api-error';

export default function CountryOriginScreen() {
  const router = useRouter();
  const { apiClient } = useSession();
  const { session, updateProfile } = useOnboarding();

  const [countries, setCountries] = useState<CountryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    session?.profile?.originCountryId ?? null
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const api = createTaxonomyApi(apiClient);
      const res = await api.countries({ active: true });
      setCountries(res.items);
      setError(null);
    } catch (err) {
      setError(ApiError.isApiError(err) ? err.userMessage : 'Failed to load countries.');
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  const retry = () => { setLoading(true); setError(null); void load(); };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const items: SearchableListItem[] = countries.map((c) => ({
    id: c.id,
    label: c.name,
    sublabel: c.demonym ?? undefined,
    emoji: c.flagEmoji ?? undefined,
    selected: c.id === selectedId,
  }));

  const selectedCountry = countries.find((c) => c.id === selectedId);

  async function handleNext() {
    if (!selectedId) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updateProfile({ originCountryId: selectedId });
      router.push('/(onboarding)/country-current');
    } catch (err) {
      setSaveError(
        ApiError.isApiError(err) ? err.userMessage : 'Failed to save. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.safeArea}>
          <OnboardingHeader
            currentStep="country-origin"
            showBack={false}
          />

          <View style={styles.content}>
            {/* Hero */}
            <View style={styles.hero}>
              <View style={[styles.iconChip, { backgroundColor: BrandColors.primarySurface }]}>
                <ThemedText style={styles.iconChipGlyph}>🌍</ThemedText>
              </View>
              <ThemedText style={styles.title}>Where are you from?</ThemedText>
              <ThemedText style={styles.subtitle} themeColor="textSecondary">
                Select your country of origin — the country you are from or have
                roots in.
              </ThemedText>
            </View>

            <SearchableList
              items={items}
              loading={loading}
              error={error}
              onRetry={retry}
              onSelect={(item) => setSelectedId(item.id)}
              selectedId={selectedId}
              searchPlaceholder="Search country"
              emptyLabel="No countries found"
            />
          </View>

          {/* Sticky footer */}
          <View style={styles.footer}>
            {selectedCountry ? (
              <View style={[styles.selectionBadge, { backgroundColor: BrandColors.primarySurface }]}>
                <ThemedText style={styles.selectionFlag}>
                  {selectedCountry.flagEmoji ?? '🏳️'}
                </ThemedText>
                <ThemedText style={[styles.selectionName, { color: BrandColors.primary }]}>
                  {selectedCountry.name}
                </ThemedText>
              </View>
            ) : null}
            {saveError ? (
              <ThemedText style={styles.errorText} accessibilityRole="alert">
                {saveError}
              </ThemedText>
            ) : null}
            <PrimaryButton
              label="Continue"
              onPress={handleNext}
              loading={saving}
              disabled={!selectedId || saving}
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
  content: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  hero: { gap: Spacing.two },
  iconChip: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconChipGlyph: { fontSize: 26 },
  title: { fontSize: 26, fontWeight: '700', lineHeight: 32, letterSpacing: -0.3 },
  subtitle: { fontSize: 15, lineHeight: 22 },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  selectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: BorderRadius.md,
  },
  selectionFlag: { fontSize: 20 },
  selectionName: { fontSize: 14, fontWeight: '600' },
  errorText: { fontSize: 13, color: BrandColors.error, textAlign: 'center' },
});
