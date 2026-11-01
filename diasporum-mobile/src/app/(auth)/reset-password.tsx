/**
 * Reset password — handles diasporummobile://reset-password?token=… deep link.
 * Consumes the single-use token against the backend; never logs it.
 */

import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, router, useLocalSearchParams } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { FormInput } from '@/shared/components/form-input';
import { PrimaryButton } from '@/shared/components/primary-button';
import { createAuthApi } from '@/features/authentication/services/auth-api';
import { createApiClient } from '@/core/api/api-client';
import { useAuth } from '@/core/auth/auth-provider';
import { ApiError } from '@/core/api/api-error';
import { BrandColors } from '@/shared/theme/colors';
import { Spacing } from '@/shared/theme/spacing';

const MIN_PASSWORD = 8;

export default function ResetPasswordScreen() {
  const auth = useAuth();
  const api = React.useMemo(() => createAuthApi(createApiClient({ authContext: auth })), [auth]);
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const pwError =
    password.length < MIN_PASSWORD ? `At least ${MIN_PASSWORD} characters.` :
    password.length > 128 ? 'At most 128 characters.' : null;
  const valid = !!token && !pwError && confirm === password;

  const submit = async () => {
    setTouched(true);
    if (!valid || !token) return;
    setLoading(true);
    setError(null);
    try {
      await api.resetPassword(token, password);
      router.replace('/(auth)/login');
    } catch (e) {
      setError(
        ApiError.isApiError(e) && e.httpStatus === 400
          ? 'This reset link is invalid, expired or already used. Request a new one.'
          : 'Reset failed. Please try again.');
    } finally {
      setLoading(false);
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
          <ThemedText type="title">Choose a new password</ThemedText>
          {!token ? (
            <ThemedText style={styles.errorText}>
              This link is missing its reset token. Open the link from your
              email on this device.
            </ThemedText>
          ) : (
            <View style={styles.form}>
              {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}
              <FormInput label="New password" required value={password} onChangeText={setPassword}
                secureTextEntry autoComplete="new-password"
                hint={`At least ${MIN_PASSWORD} characters.`}
                error={touched ? pwError : null} />
              <FormInput label="Confirm password" required value={confirm} onChangeText={setConfirm}
                secureTextEntry
                error={touched && confirm !== password ? 'Passwords do not match.' : null} />
              <PrimaryButton label="Reset password" onPress={() => void submit()}
                loading={loading} disabled={!valid || loading} />
              <ThemedText style={styles.note}>
                Resetting signs out all other sessions — sign back in afterwards.
              </ThemedText>
            </View>
          )}
          <Link href="/(auth)/login" style={styles.link}>Back to sign in</Link>
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
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, justifyContent: 'center', gap: Spacing.five },
  form: { gap: Spacing.three, alignSelf: 'center', maxWidth: 380, width: '100%' },
  errorText: { color: '#DC2626', textAlign: 'center' },
  note: { fontSize: 12, color: '#8E8E93', textAlign: 'center' },
  link: { color: BrandColors.primary, fontWeight: '600', textAlign: 'center' },
});
