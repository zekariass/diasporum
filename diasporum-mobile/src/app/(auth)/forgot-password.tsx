/**
 * Forgot password — sends a reset link. The backend always returns 204, so
 * the UI never reveals whether the email is registered.
 */

import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';

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
import { useTheme } from '@/hooks/use-theme';

export default function ForgotPasswordScreen() {
  const theme = useTheme();
  const auth = useAuth();
  const api = React.useMemo(() => createAuthApi(createApiClient({ authContext: auth })), [auth]);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.forgotPassword(email.trim());
      setSent(true); // generic success — no account-existence leak
    } catch (e) {
      setError(ApiError.isApiError(e) ? e.userMessage : 'Request failed. Try again.');
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
          <ThemedText type="title">Reset your password</ThemedText>
          {sent ? (
            <View style={styles.body}>
              <ThemedText style={[styles.center, { color: theme.textSecondary }]}>
                If an account exists for {email}, a reset link is on its way.
                Open it on this device.
              </ThemedText>
            </View>
          ) : (
            <View style={styles.form}>
              {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}
              <FormInput label="Email" required value={email} onChangeText={setEmail}
                autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
              <PrimaryButton label="Send reset link" onPress={() => void submit()}
                loading={loading} disabled={!/\S+@\S+\.\S+/.test(email) || loading} />
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
  body: { gap: Spacing.three, alignSelf: 'center', maxWidth: 380 },
  center: { textAlign: 'center', lineHeight: 22 },
  errorText: { color: '#DC2626', textAlign: 'center' },
  link: { color: BrandColors.primary, fontWeight: '600', textAlign: 'center' },
});
