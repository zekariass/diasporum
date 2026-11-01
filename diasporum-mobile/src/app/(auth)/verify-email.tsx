/**
 * Email verification screen — post-registration notice + deep-link handler.
 * diasporummobile://verify-email?token=… lands here via ?token param.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, useLocalSearchParams } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PrimaryButton } from '@/shared/components/primary-button';
import { createAuthApi } from '@/features/authentication/services/auth-api';
import { createApiClient } from '@/core/api/api-client';
import { useAuth } from '@/core/auth/auth-provider';
import { ApiError } from '@/core/api/api-error';
import { BrandColors } from '@/shared/theme/colors';
import { Spacing } from '@/shared/theme/spacing';
import { useTheme } from '@/hooks/use-theme';

const RESEND_COOLDOWN_S = 60;

export default function VerifyEmailScreen() {
  const theme = useTheme();
  const auth = useAuth();
  const { email, token } = useLocalSearchParams<{ email?: string; token?: string }>();
  const api = React.useMemo(() => createAuthApi(createApiClient({ authContext: auth })), [auth]);

  const [verifying, setVerifying] = useState(Boolean(token));
  const [verified, setVerified] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);

  // Deep-link verification: consume ?token= once.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        await api.verifyEmail(token);
        if (!cancelled) setVerified(true);
      } catch (e) {
        if (!cancelled) {
          setVerifyError(
            ApiError.isApiError(e)
              ? 'This verification link is invalid or has expired.'
              : 'Verification failed. Please try again.');
        }
      } finally {
        if (!cancelled) setVerifying(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, api]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const resend = async () => {
    if (!email || sending || cooldown > 0) return;
    setSending(true);
    try {
      await api.resendVerification(email);
      setResent(true);
      setCooldown(RESEND_COOLDOWN_S);
    } catch {
      // Endpoint is always-204 by design; only network errors reach here.
      setVerifyError('Could not resend right now. Please try again shortly.');
    } finally {
      setSending(false);
    }
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.center}>
          {verified ? 'Email verified' : verifying ? 'Verifying…' : 'Check your email'}
        </ThemedText>

        <View style={styles.body}>
          {verified ? (
            <ThemedText style={styles.center}>
              Your email is confirmed. You can sign in now.
            </ThemedText>
          ) : verifying ? (
            <ThemedText style={[styles.center, { color: theme.textSecondary }]}>
              Confirming your verification link…
            </ThemedText>
          ) : (
            <>
              {verifyError ? (
                <ThemedText style={styles.errorText}>{verifyError}</ThemedText>
              ) : (
                <ThemedText style={[styles.center, { color: theme.textSecondary }]}>
                  We sent a verification link{email ? ` to ${email}` : ''}. Open it
                  on this device to activate your account.
                </ThemedText>
              )}
              {resent ? (
                <ThemedText style={[styles.center, { color: BrandColors.primary }]}>
                  Verification email resent.
                </ThemedText>
              ) : null}
              {email ? (
                <PrimaryButton
                  label={cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
                  onPress={() => void resend()}
                  loading={sending}
                  disabled={cooldown > 0 || sending}
                  variant="secondary"
                />
              ) : null}
            </>
          )}
        </View>

        <Link href="/(auth)/login" style={styles.link}>
          {verified ? 'Continue to sign in' : 'Back to sign in'}
        </Link>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, justifyContent: 'center', gap: Spacing.five },
  center: { textAlign: 'center' },
  body: { gap: Spacing.three, alignSelf: 'center', maxWidth: 380, width: '100%' },
  errorText: { color: '#DC2626', textAlign: 'center' },
  link: { color: BrandColors.primary, fontWeight: '600', textAlign: 'center' },
});
