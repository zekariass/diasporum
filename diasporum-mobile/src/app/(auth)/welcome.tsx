/**
 * Welcome — the application's introduction (unauthenticated).
 * Design ref: screen 1 — Diasporum identity, headline, full-screen welcome
 * artwork (01_welcome_diaspora), "Get Started" + a clear login route.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PrimaryButton } from '@/shared/components/primary-button';
import { BrandColors } from '@/shared/theme/colors';
import { Spacing } from '@/shared/theme/spacing';

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea}>
        {/* Brand */}
        <View style={styles.brandRow}>
          <View style={[styles.logoBadge, { backgroundColor: BrandColors.primary }]}>
            <ThemedText style={styles.logoLetter}>D</ThemedText>
          </View>
          <ThemedText style={styles.appName}>Diasporum</ThemedText>
        </View>

        {/* Emblem — concentric rings with community glyphs, replaces artwork */}
        <View style={styles.emblemArea}>
          <View style={[styles.ringOuter, { backgroundColor: BrandColors.primarySurface }]}>
            <View style={[styles.ringMid, { backgroundColor: BrandColors.primaryLight + '55' }]}>
              <View style={[styles.emblemCore, { backgroundColor: BrandColors.primary }]}>
                <ThemedText style={styles.emblemGlyph}>🌍</ThemedText>
              </View>
            </View>
            <View style={[styles.orbitDot, styles.dotTL]}>
              <ThemedText style={styles.orbitGlyph}>🤝</ThemedText>
            </View>
            <View style={[styles.orbitDot, styles.dotBR]}>
              <ThemedText style={styles.orbitGlyph}>✈️</ThemedText>
            </View>
            <View style={[styles.orbitDot, styles.dotBL]}>
              <ThemedText style={styles.orbitGlyph}>💬</ThemedText>
            </View>
          </View>
        </View>

        {/* Copy + CTA anchored to the lower third, above the CTA footer */}
        <View style={styles.lower}>
          <View style={styles.copy}>
            <ThemedText style={styles.headline}>
              Connect with your diaspora community
            </ThemedText>
            <ThemedText style={styles.subline} themeColor="textSecondary">
              People, opportunities, support and more — for diaspora communities
              worldwide.
            </ThemedText>
          </View>

          <View style={styles.footer}>
            <PrimaryButton
              label="Get Started"
              onPress={() => router.push('/(auth)/sign-up' as never)}
            />
            <Pressable
              onPress={() => router.push('/(auth)/login' as never)}
              accessibilityRole="button"
              accessibilityLabel="Log in"
              style={styles.loginRow}>
              <ThemedText style={styles.loginText} themeColor="textSecondary">
                Already have an account?{' '}
              </ThemedText>
              <ThemedText style={[styles.loginText, { color: BrandColors.primary }]}>
                Log in
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  logoBadge: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoLetter: { fontSize: 20, fontWeight: '700', color: '#FFFFFF', lineHeight: 24 },
  appName: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  emblemArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ringOuter: {
    width: 230,
    height: 230,
    borderRadius: 115,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringMid: {
    width: 168,
    height: 168,
    borderRadius: 84,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emblemCore: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emblemGlyph: { fontSize: 46 },
  orbitDot: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  dotTL: { top: 8, left: 18 },
  dotBR: { bottom: 12, right: 14 },
  dotBL: { bottom: 26, left: -6 },
  orbitGlyph: { fontSize: 22 },
  lower: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
    paddingBottom: Spacing.four,
  },
  copy: { gap: Spacing.two, alignItems: 'center' },
  headline: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  subline: { fontSize: 15, lineHeight: 22, textAlign: 'center', paddingHorizontal: Spacing.two },
  footer: { gap: Spacing.two, alignItems: 'center' },
  loginRow: { flexDirection: 'row', padding: Spacing.two },
  loginText: { fontSize: 14, fontWeight: '500' },
});
