/**
 * Registration screen — email + password with confirmation and terms consent.
 * On success the user is sent to the verification screen.
 */

import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { FormInput } from '@/shared/components/form-input';
import { PasswordInput } from '@/shared/components/password-input';
import { PrimaryButton } from '@/shared/components/primary-button';
import { useAuthFlow } from '@/features/authentication/hooks/use-auth-flow';
import { BrandColors } from '@/shared/theme/colors';
import { Spacing } from '@/shared/theme/spacing';
import { useTheme } from '@/hooks/use-theme';

const MIN_PASSWORD = 8; // backend requirement: 8–128 chars

export default function RegisterScreen() {
  const theme = useTheme();
  const { state, register, clearError } = useAuthFlow();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [touched, setTouched] = useState(false);

  const errors = {
    email: !/\S+@\S+\.\S+/.test(email) ? 'Enter a valid email address.' : null,
    password: password.length < MIN_PASSWORD
      ? `Password must be at least ${MIN_PASSWORD} characters.`
      : password.length > 128 ? 'Password must be at most 128 characters.' : null,
    confirm: confirm !== password ? 'Passwords do not match.' : null,
    terms: !accepted ? 'You must accept the terms to continue.' : null,
  };
  const valid = !errors.email && !errors.password && !errors.confirm && !errors.terms;

  const submit = async () => {
    setTouched(true);
    if (!valid) return;
    const ok = await register(email, password);
    if (ok) {
      // Email verification is disabled — send the user straight to login.
      router.replace('/(auth)/login' as never);
    }
  };

  return (
    <ThemedView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <SafeAreaView style={styles.safeArea}>
          <ThemedText type="title">Create your account</ThemedText>

          {state.error ? (
            <Pressable style={styles.errorBox} onPress={clearError} accessibilityRole="alert">
              <ThemedText style={styles.errorText}>{state.error}</ThemedText>
            </Pressable>
          ) : null}

          <View style={styles.form}>
            <FormInput label="Email" required value={email} onChangeText={setEmail}
              autoCapitalize="none" keyboardType="email-address" autoComplete="email"
              error={touched ? errors.email : null} />
            <PasswordInput label="Password" required value={password} onChangeText={setPassword}
              autoComplete="new-password"
              hint={`At least ${MIN_PASSWORD} characters.`}
              error={touched ? errors.password : null} />
            <PasswordInput label="Confirm password" required value={confirm} onChangeText={setConfirm}
              error={touched ? errors.confirm : null} />

            <Pressable style={styles.termsRow} onPress={() => setAccepted(!accepted)}
              accessibilityRole="checkbox" accessibilityState={{ checked: accepted }}>
              <View style={[styles.checkbox, { borderColor: theme.border },
                accepted && { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary }]} />
              <ThemedText style={styles.termsText}>
                I agree to Diasporum&apos;s Terms of Service and Privacy Policy.
              </ThemedText>
            </Pressable>
            {touched && errors.terms ? (
              <ThemedText style={styles.errorText}>{errors.terms}</ThemedText>
            ) : null}

            <PrimaryButton label="Create account" onPress={() => void submit()}
              loading={state.isLoading} disabled={state.isLoading} />
          </View>

          <ThemedText style={{ color: theme.textSecondary, textAlign: 'center' }}>
            Already have an account?{' '}
            <Link href="/(auth)/login" style={styles.link}>Sign in</Link>
          </ThemedText>
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
  form: { gap: Spacing.two, width: '100%', maxWidth: 380, alignSelf: 'center' },
  termsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2 },
  termsText: { flex: 1, fontSize: 13, lineHeight: 18 },
  errorBox: { backgroundColor: '#FEE2E2', borderRadius: 12, padding: Spacing.three },
  errorText: { color: '#DC2626', fontSize: 13 },
  link: { color: BrandColors.primary, fontWeight: '600' },
});
