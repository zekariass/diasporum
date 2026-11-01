/**
 * Login screen — email + password sign-in with native Google/Apple options.
 */

import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Link } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { FormInput } from '@/shared/components/form-input';
import { PasswordInput } from '@/shared/components/password-input';
import { PrimaryButton } from '@/shared/components/primary-button';
import { useAuthFlow } from '@/features/authentication/hooks/use-auth-flow';
import { isAppleSignInAvailable } from '@/features/authentication/services/provider-signin';
import { BrandColors } from '@/shared/theme/colors';
import { Spacing } from '@/shared/theme/spacing';
import { useTheme } from '@/hooks/use-theme';

export default function LoginScreen() {
  const theme = useTheme();
  const { state, loginWithPassword, loginWithGoogle, loginWithApple, clearError } =
    useAuthFlow();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [appleAvailable, setAppleAvailable] = useState(false);

  React.useEffect(() => {
    void isAppleSignInAvailable().then(setAppleAvailable);
  }, []);

  const valid = /\S+@\S+\.\S+/.test(email) && password.length > 0;

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <SafeAreaView style={styles.safeArea}>
          <View style={styles.hero}>
            <View style={[styles.logoBadge, { backgroundColor: BrandColors.primary }]}>
              <ThemedText style={styles.logoLetter}>D</ThemedText>
            </View>
            <ThemedText type="title">Diasporum</ThemedText>
            <ThemedText type="subtitle" style={{ color: theme.textSecondary }}>
              Your diaspora community
            </ThemedText>
          </View>

          {state.error ? (
            <Pressable style={styles.errorBox} onPress={clearError} accessibilityRole="alert">
              <ThemedText style={styles.errorText}>{state.error}</ThemedText>
            </Pressable>
          ) : null}

          <View style={styles.form}>
            <FormInput
              label="Email"
              required
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <PasswordInput
              label="Password"
              required
              value={password}
              onChangeText={setPassword}
              autoComplete="password"
              textContentType="password"
            />
            <Link href={"/(auth)/forgot-password" as never} style={styles.forgot}>
              Forgot password?
            </Link>
            <PrimaryButton
              label="Sign in"
              onPress={() => void loginWithPassword(email, password)}
              loading={state.isLoading}
              disabled={!valid || state.isLoading}
            />
          </View>

          <View style={styles.dividerRow}>
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <ThemedText style={{ color: theme.textSecondary }}>or</ThemedText>
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
          </View>

          <View style={styles.social}>
            <PrimaryButton
              label="Continue with Google"
              variant="secondary"
              onPress={() => void loginWithGoogle()}
              disabled={state.isLoading}
            />
            {appleAvailable ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={10}
                style={styles.appleButton}
                onPress={() => void loginWithApple()}
              />
            ) : null}
          </View>

          <View style={styles.footer}>
            <ThemedText style={{ color: theme.textSecondary }}>
              New here?{' '}
              <Link href={"/(auth)/register" as never} style={styles.link}>
                Create an account
              </Link>
            </ThemedText>
            {Platform.OS === 'android' && (
              <ThemedText style={[styles.devNote, { color: theme.textSecondary }]}>
                Emulator: use 10.0.2.2 for the backend host.
              </ThemedText>
            )}
          </View>
          </SafeAreaView>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, justifyContent: 'center', gap: Spacing.four, paddingVertical: Spacing.six },
  hero: { alignItems: 'center', gap: Spacing.two },
  logoBadge: { width: 84, height: 84, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.two },
  logoLetter: { fontSize: 44, fontWeight: '700', color: BrandColors.white },
  form: { gap: Spacing.two, width: '100%', maxWidth: 380, alignSelf: 'center' },
  forgot: { alignSelf: 'flex-end', color: BrandColors.primary, fontSize: 14 },
  errorBox: { backgroundColor: '#FEE2E2', borderRadius: 12, padding: Spacing.three, alignSelf: 'stretch' },
  errorText: { color: '#DC2626', fontSize: 14, textAlign: 'center' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, alignSelf: 'stretch', maxWidth: 380 },
  divider: { flex: 1, height: StyleSheet.hairlineWidth },
  social: { gap: Spacing.two, width: '100%', maxWidth: 380, alignSelf: 'center' },
  appleButton: { height: 48, width: '100%' },
  footer: { alignItems: 'center', gap: Spacing.two },
  link: { color: BrandColors.primary, fontWeight: '600' },
  devNote: { fontSize: 11, fontStyle: 'italic', textAlign: 'center' },
});
