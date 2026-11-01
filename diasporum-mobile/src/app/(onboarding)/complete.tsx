/**
 * Step 5 of 5 — Onboarding completion ("You're in").
 * Creates the user's default community membership via
 * POST /me/onboarding/complete (idempotent, backend-authoritative) on mount,
 * celebrates the join, then hands off to the main app.
 * Design ref: screen 7 — celebration artwork + next-step highlights.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { createCommunityApi } from '@/features/communities/services/community-api';
import { useSession } from '@/core/session/session-provider';
import type { OnboardingCompleteResponse } from '@/features/communities/types/community-types';
import { ApiError } from '@/core/api/api-error';
import { useTheme } from '@/hooks/use-theme';

const NEXT_STEPS = [
  { icon: '🧑‍🤝‍🧑', label: 'Connect with people' },
  { icon: '📅', label: 'Join community events' },
  { icon: '💼', label: 'Explore jobs and opportunities' },
  { icon: '🧭', label: 'Discover other communities' },
] as const;

export default function CompleteScreen() {
  const router = useRouter();
  const { apiClient, refresh } = useSession();
  const theme = useTheme();

  const [result, setResult] = useState<OnboardingCompleteResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  const started = useRef(false);

  const join = useCallback(async () => {
    try {
      const api = createCommunityApi(apiClient);
      const res = await api.completeOnboarding();
      setResult(res);
      setError(null);
    } catch (err) {
      if (ApiError.isApiError(err) && err.httpStatus === 404) {
        setError('Community not available. Please contact support.');
      } else {
        setError(
          ApiError.isApiError(err) ? err.userMessage : 'Something went wrong. Please try again.'
        );
      }
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  const retry = () => { setLoading(true); setError(null); void join(); };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void join();
  }, [join]);

  async function handleGoHome() {
    setEntering(true);
    try {
      // Refresh session state so the app lands on the new active community.
      await refresh();
    } finally {
      router.replace('/(app)/(tabs)' as never);
    }
  }

  if (loading) {
    return (
      <ThemedView style={styles.root}>
        <LoadingScreen message="Setting up your community…" />
      </ThemedView>
    );
  }

  if (error) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.safeArea}>
          <OnboardingHeader
            currentStep="complete"
            showBack
            onBack={() => router.replace('/(onboarding)/profile')}
          />
          <View style={styles.centered}>
            <ErrorState message={error} onRetry={retry} />
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea}>
        <OnboardingHeader
          currentStep="complete"
          showBack
          onBack={() => router.replace('/(onboarding)/profile')}
        />

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}>

          {/* Success emblem */}
          <View style={styles.checkWrap}>
            <View style={[styles.checkRing, { backgroundColor: BrandColors.successSurface }]}>
              <View style={[styles.checkCircle, { backgroundColor: BrandColors.success }]}>
                <ThemedText style={styles.checkGlyph}>✓</ThemedText>
              </View>
            </View>
          </View>

          <View style={styles.hero}>
            <ThemedText style={styles.title}>You&apos;re in!</ThemedText>
            <ThemedText style={styles.subtitle}>Welcome to Diasporum.</ThemedText>
            <ThemedText style={styles.joined} themeColor="textSecondary">
              You&apos;ve joined{' '}
              <ThemedText style={[styles.joined, { color: BrandColors.primary, fontWeight: '700' }]}>
                {result?.community.name}
              </ThemedText>
              .
            </ThemedText>
          </View>

          {/* Next steps */}
          <View style={styles.nextSteps}>
            {NEXT_STEPS.map((s) => (
              <View
                key={s.label}
                style={[styles.nextRow, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={styles.nextIcon}>{s.icon}</ThemedText>
                <ThemedText style={styles.nextLabel}>{s.label}</ThemedText>
              </View>
            ))}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton
            label="Go to Home →"
            onPress={() => void handleGoHome()}
            loading={entering}
            disabled={entering}
          />
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
    justifyContent: 'center',
    paddingBottom: Spacing.three,
  },
  checkWrap: { alignItems: 'center' },
  checkRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkGlyph: { fontSize: 38, fontWeight: '700', color: '#FFFFFF', lineHeight: 44 },
  hero: { alignItems: 'center', gap: Spacing.one },
  title: { fontSize: 32, fontWeight: '700', lineHeight: 38, letterSpacing: -0.4 },
  subtitle: { fontSize: 20, fontWeight: '700', lineHeight: 26 },
  joined: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: Spacing.one },
  nextSteps: { gap: Spacing.two },
  nextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - 4,
    gap: Spacing.three,
  },
  nextIcon: { fontSize: 18 },
  nextLabel: { fontSize: 14, fontWeight: '600' },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    paddingTop: Spacing.two,
  },
});
