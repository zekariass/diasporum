/**
 * Create account — authentication method chooser (design ref: screen 2).
 * Continue with Apple / Google / email; terms + privacy notice.
 * Uses the existing Phase 2 auth flow — no separate auth logic.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PrimaryButton } from '@/shared/components/primary-button';
import { useAuthFlow } from '@/features/authentication/hooks/use-auth-flow';
import { isAppleSignInAvailable } from '@/features/authentication/services/provider-signin';
import { safeBack } from '@/core/navigation/safe-back';
import { BrandColors } from '@/shared/theme/colors';
import { BorderRadius, Spacing } from '@/shared/theme/spacing';
import { useTheme } from '@/hooks/use-theme';

export default function SignUpScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { state, loginWithGoogle, loginWithApple, clearError } = useAuthFlow();
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    void isAppleSignInAvailable().then(setAppleAvailable);
  }, []);

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea}>
        {/* Back */}
        <View style={styles.header}>
          <Pressable
            onPress={() => safeBack()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={({ pressed }) => [
              styles.backBtn,
              { backgroundColor: theme.backgroundElement },
              pressed && styles.backBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Go back">
            <ThemedText style={styles.backArrow}>‹</ThemedText>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}>
          <View style={styles.copy}>
            <View style={[styles.iconChip, { backgroundColor: BrandColors.primarySurface }]}>
              <ThemedText style={styles.iconChipGlyph}>✈️</ThemedText>
            </View>
            <ThemedText style={styles.title}>Create your account</ThemedText>
            <ThemedText style={styles.subtitle} themeColor="textSecondary">
              Get started with Diasporum.
            </ThemedText>
          </View>

          {/* Provider options */}
          <View style={styles.providers}>
            {state.error ? (
              <Pressable
                style={styles.errorBox}
                onPress={clearError}
                accessibilityRole="alert">
                <ThemedText style={styles.errorText}>{state.error}</ThemedText>
              </Pressable>
            ) : null}

            {appleAvailable ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={
                  AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
                }
                buttonStyle={
                  AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                }
                cornerRadius={BorderRadius.full}
                style={styles.appleButton}
                onPress={() => void loginWithApple()}
              />
            ) : null}

            <PrimaryButton
              label="Continue with Google"
              variant="secondary"
              onPress={() => void loginWithGoogle()}
              loading={state.isLoading}
              disabled={state.isLoading}
              style={styles.providerBtn}
            />
            <PrimaryButton
              label="Sign up with Email"
              variant="secondary"
              onPress={() => router.push('/(auth)/register' as never)}
              disabled={state.isLoading}
              style={styles.providerBtn}
            />
          </View>

          <ThemedText style={styles.legal} themeColor="textSecondary">
            By continuing, you agree to our{' '}
            <ThemedText style={styles.legalLink}>Terms of Service</ThemedText> and{' '}
            <ThemedText style={styles.legalLink}>Privacy Policy</ThemedText>.
          </ThemedText>
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
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
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  header: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  backBtnPressed: { opacity: 0.55 },
  backArrow: { fontSize: 24, fontWeight: '400', lineHeight: 28, marginTop: -2 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
    justifyContent: 'center',
    paddingVertical: Spacing.three,
  },
  copy: { gap: Spacing.two },
  iconChip: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  iconChipGlyph: { fontSize: 26 },
  title: { fontSize: 26, fontWeight: '700', lineHeight: 32, letterSpacing: -0.3 },
  subtitle: { fontSize: 15, lineHeight: 22 },
  providers: { gap: Spacing.two, width: '100%', maxWidth: 380, alignSelf: 'center' },
  appleButton: { height: 52, width: '100%' },
  providerBtn: { alignSelf: 'stretch' },
  errorBox: {
    backgroundColor: '#FEE2E2',
    borderRadius: BorderRadius.md,
    padding: Spacing.three,
  },
  errorText: { color: '#DC2626', fontSize: 13, textAlign: 'center' },
  legal: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
  },
  legalLink: { color: BrandColors.primary, fontWeight: '600' },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    alignItems: 'center',
  },
  loginRow: { flexDirection: 'row', padding: Spacing.two },
  loginText: { fontSize: 14, fontWeight: '500' },
});
