/**
 * Step 3 of 5 — Community preview (the key onboarding screen).
 * Explains which community the user will automatically join, derived from
 * origin + current country. Informational only — membership is created on
 * the completion screen via POST /me/onboarding/complete.
 * Routes to 'profile' next (or 'complete' when the profile is already done).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PrimaryButton } from '@/shared/components/primary-button';
import { OnboardingHeader } from '@/shared/components/onboarding-header';
import { ErrorState } from '@/shared/components/error-state';
import { LoadingScreen } from '@/shared/components/loading-screen';
import { BrandColors } from '@/shared/theme/colors';
import { BorderRadius, Spacing } from '@/shared/theme/spacing';
import { useOnboarding } from '@/features/onboarding/hooks/use-onboarding';
import { createCommunityApi } from '@/features/communities/services/community-api';
import { useSession } from '@/core/session/session-provider';
import type { CommunityPreviewResponse } from '@/features/communities/types/community-types';
import { ApiError } from '@/core/api/api-error';
import { useTheme } from '@/hooks/use-theme';

export default function CommunityPreviewScreen() {
  const router = useRouter();
  const { apiClient } = useSession();
  const { session } = useOnboarding();
  const theme = useTheme();

  const [preview, setPreview] = useState<CommunityPreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isProfileDone = session?.profile?.profileCompleted === true;

  const load = useCallback(async () => {
    try {
      const api = createCommunityApi(apiClient);
      const res = await api.communityPreview();
      setPreview(res);
      setError(null);
    } catch (err) {
      if (ApiError.isApiError(err) && err.httpStatus === 404) {
        setError('No community found for your country combination.');
      } else if (ApiError.isApiError(err) && err.httpStatus === 422) {
        setError('Your countries are not set yet. Please go back and select them.');
      } else {
        setError(ApiError.isApiError(err) ? err.userMessage : 'Failed to load community preview.');
      }
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  const retry = () => { setLoading(true); setError(null); void load(); };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  function handleContinue() {
    router.push((isProfileDone ? '/(onboarding)/complete' : '/(onboarding)/profile') as never);
  }

  if (loading) {
    return (
      <ThemedView style={styles.root}>
        <LoadingScreen message="Finding your community…" />
      </ThemedView>
    );
  }

  if (error) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.safeArea}>
          <OnboardingHeader
            currentStep="community-preview"
            showBack
            onBack={() => router.replace('/(onboarding)/country-current')}
          />
          <View style={styles.centered}>
            <ErrorState message={error} onRetry={retry} />
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const { community, originCountry, destinationCountry } = preview!;
  const originFlag = originCountry?.flagEmoji ?? '🌍';
  const destFlag = destinationCountry?.flagEmoji ?? '🌍';
  const demonym = originCountry?.demonym ?? 'diaspora';

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea}>
        <OnboardingHeader
          currentStep="community-preview"
          showBack
          onBack={() => router.replace('/(onboarding)/country-current')}
        />

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}>

          {/* Hero */}
          <View style={styles.hero}>
            <ThemedText style={styles.title}>Your Diasporum community</ThemedText>
            <ThemedText style={styles.subtitle} themeColor="textSecondary">
              Based on your country of origin and where you currently live,
              you&apos;ll automatically join:
            </ThemedText>
          </View>

          {/* Community card */}
          <View
            style={[
              styles.communityCard,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border },
            ]}>
            {/* Origin → destination */}
            <View style={styles.flagsRow}>
              <ThemedText style={styles.flagEmoji}>{originFlag}</ThemedText>
              <ThemedText style={[styles.flagArrow, { color: BrandColors.primary }]}>→</ThemedText>
              <ThemedText style={styles.flagEmoji}>{destFlag}</ThemedText>
            </View>
            <ThemedText style={styles.countryLine} themeColor="textSecondary">
              {originCountry?.name} → {destinationCountry?.name}
            </ThemedText>

            <ThemedText style={styles.communityName}>{community.name}</ThemedText>

            {/* Default community badge */}
            <View style={[styles.badge, { backgroundColor: BrandColors.primarySurface }]}>
              <ThemedText style={[styles.badgeText, { color: BrandColors.primaryDark }]}>
                👑 Your default community
              </ThemedText>
            </View>
          </View>

          {/* Explanation */}
          <View style={styles.explanation}>
            <View style={styles.explainRow}>
              <ThemedText style={[styles.checkmark, { color: BrandColors.primary }]}>✓</ThemedText>
              <ThemedText style={styles.explainText} themeColor="textSecondary">
                This will be your main community when you start using Diasporum.
              </ThemedText>
            </View>
            <View style={styles.explainRow}>
              <ThemedText style={[styles.checkmark, { color: BrandColors.primary }]}>✓</ThemedText>
              <ThemedText style={styles.explainText} themeColor="textSecondary">
                You can join other {demonym} communities in different countries
                and switch between them anytime from the Communities section.
              </ThemedText>
            </View>
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={[styles.footer, { borderTopColor: theme.border }]}>
          <PrimaryButton label="Continue" onPress={handleContinue} />
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
    paddingBottom: Spacing.three,
  },
  hero: { gap: Spacing.one },
  title: { fontSize: 26, fontWeight: '700', lineHeight: 32, letterSpacing: -0.3 },
  subtitle: { fontSize: 15, lineHeight: 22 },
  // Community card
  communityCard: {
    borderWidth: 1.5,
    borderRadius: BorderRadius.xl,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  flagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  flagEmoji: { fontSize: 44 },
  flagArrow: { fontSize: 26, fontWeight: '700' },
  countryLine: { fontSize: 13, fontWeight: '500' },
  communityName: {
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
    textAlign: 'center',
    marginTop: Spacing.one,
  },
  badge: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    marginTop: Spacing.one,
  },
  badgeText: { fontSize: 13, fontWeight: '700' },
  explanation: { gap: Spacing.two, paddingHorizontal: Spacing.one },
  explainRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  checkmark: { fontSize: 16, fontWeight: '700', lineHeight: 22 },
  explainText: { flex: 1, fontSize: 14, lineHeight: 22 },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
