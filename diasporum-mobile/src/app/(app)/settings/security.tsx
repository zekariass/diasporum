/**
 * Account & Security — password change, linked providers, active sessions.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { FormInput } from '@/shared/components/form-input';
import { PrimaryButton } from '@/shared/components/primary-button';
import { useAuth } from '@/core/auth/auth-provider';
import { createApiClient } from '@/core/api/api-client';
import { createAuthApi } from '@/features/authentication/services/auth-api';
import {
  getGoogleIdToken,
  getAppleCredential,
  isAppleSignInAvailable,
} from '@/features/authentication/services/provider-signin';
import { ApiError } from '@/core/api/api-error';
import type { SessionView } from '@/core/auth/auth-types';
import { BrandColors } from '@/shared/theme/colors';
import { Spacing } from '@/shared/theme/spacing';
import { useTheme } from '@/hooks/use-theme';

export default function SecurityScreen() {
  const theme = useTheme();
  const auth = useAuth();
  const api = React.useMemo(() => createAuthApi(createApiClient({ authContext: auth })), [auth]);

  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [appleOk, setAppleOk] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await api.sessions());
    } catch (e) {
      if (ApiError.isApiError(e) && e.isUnauthenticated) void auth.logout();
    }
  }, [api, auth]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSessions();
    void isAppleSignInAvailable().then(setAppleOk);
  }, [loadSessions]);

  const msg = (e: unknown, fallback: string) =>
    ApiError.isApiError(e)
      ? e.httpStatus === 409 ? 'That identity is linked to a different account.' :
        e.httpStatus === 401 ? 'Incorrect current password.' : e.userMessage
      : fallback;

  const changePassword = async () => {
    setBusy('pw'); setError(null); setNotice(null);
    try {
      await api.changePassword(curPw, newPw);
      setNotice('Password changed — all sessions were signed out. Please sign in again.');
      // Backend revoked every session incl. this one → return to auth.
      setTimeout(() => void auth.logout(), 1500);
    } catch (e) { setError(msg(e, 'Password change failed.')); }
    finally { setBusy(null); }
  };

  const link = async (provider: 'google' | 'apple') => {
    setBusy(provider); setError(null); setNotice(null);
    try {
      const idToken = provider === 'google'
        ? await getGoogleIdToken() : (await getAppleCredential()).idToken;
      await api.linkIdentity(provider, idToken);
      setNotice(`${provider === 'google' ? 'Google' : 'Apple'} account linked.`);
    } catch (e) { setError(msg(e, 'Linking failed.')); }
    finally { setBusy(null); }
  };

  const unlink = (id: string) =>
    Alert.alert('Unlink sign-in method', 'Remove this linked identity?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unlink', style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(id); setError(null);
            try {
              await api.unlinkIdentity(id);
              setNotice('Identity unlinked.');
            } catch (e) {
              setError(msg(e, 'Could not unlink — it may be your only sign-in method.'));
            } finally { setBusy(null); }
          })();
        },
      },
    ]);

  const revoke = (s: SessionView) =>
    Alert.alert('Revoke session', `Sign out ${s.deviceName ?? s.clientType}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke', style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(s.id);
            try {
              await api.revokeSession(s.id);
              await loadSessions();
              setNotice('Session revoked.');
            } catch (e) { setError(msg(e, 'Revocation failed.')); }
            finally { setBusy(null); }
          })();
        },
      },
    ]);

  const signOut = () =>
    Alert.alert('Sign out', 'Sign out of Diasporum on this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void auth.logout() },
    ]);

  const logoutAll = () =>
    Alert.alert('Sign out everywhere', 'All sessions will be revoked.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out all', style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy('all'); setError(null);
            try {
              await api.logoutAll();
              void auth.logout();
            } catch (e) {
              setError(msg(e, 'Could not sign out everywhere.'));
            } finally { setBusy(null); }
          })();
        },
      },
    ]);

  const currentSid = auth.authState.status === 'authenticated'
    ? auth.authState.user.sessionId : null;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="title">Account &amp; Security</ThemedText>
          {notice ? <ThemedText style={[styles.notice, { color: BrandColors.primary }]}>{notice}</ThemedText> : null}
          {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

          <ThemedText type="subtitle">Change password</ThemedText>
          <FormInput label="Current password" value={curPw} onChangeText={setCurPw} secureTextEntry />
          <FormInput label="New password (8+ chars)" value={newPw} onChangeText={setNewPw} secureTextEntry />
          <PrimaryButton label="Change password" onPress={() => void changePassword()}
            loading={busy === 'pw'} disabled={!curPw || newPw.length < 8 || busy !== null} />
          <ThemedText style={styles.note}>Changing your password signs out all sessions.</ThemedText>

          <ThemedText type="subtitle">Linked sign-in methods</ThemedText>
          <View style={styles.row}>
            <PrimaryButton label="Link Google" variant="secondary" onPress={() => void link('google')}
              loading={busy === 'google'} disabled={busy !== null} />
            {appleOk ? (
              <PrimaryButton label="Link Apple" variant="secondary" onPress={() => void link('apple')}
                loading={busy === 'apple'} disabled={busy !== null} />
            ) : null}
          </View>

          <ThemedText type="subtitle">Active sessions</ThemedText>
          <FlatList
            data={sessions}
            keyExtractor={(s) => s.id}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <View style={[styles.sessionRow, { borderColor: theme.border }]}>
                <View style={styles.sessionInfo}>
                  <ThemedText style={styles.sessionTitle}>
                    {item.deviceName ?? item.clientType}
                    {item.id === currentSid ? '  (this device)' : ''}
                  </ThemedText>
                  <ThemedText style={[styles.sessionMeta, { color: theme.textSecondary }]}>
                    {item.authMethod} · created {new Date(item.createdAt).toLocaleDateString()} ·
                    last used {new Date(item.lastUsedAt).toLocaleDateString()}
                  </ThemedText>
                </View>
                {item.id !== currentSid ? (
                  <ThemedText style={styles.revoke} onPress={() => revoke(item)}>
                    {busy === item.id ? '…' : 'Revoke'}
                  </ThemedText>
                ) : null}
              </View>
            )}
            ListEmptyComponent={
              <ThemedText style={{ color: theme.textSecondary }}>No active sessions.</ThemedText>
            }
          />

          <ThemedText type="subtitle">Sign out</ThemedText>
          <PrimaryButton label="Sign out" variant="danger" onPress={signOut}
            disabled={busy !== null} />
          <PrimaryButton label="Sign out of all sessions" variant="secondary"
            onPress={logoutAll} loading={busy === 'all'} disabled={busy !== null} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  scroll: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
  row: { flexDirection: 'row', gap: Spacing.two },
  notice: { textAlign: 'center' },
  error: { color: '#DC2626', textAlign: 'center' },
  note: { fontSize: 12, color: '#8E8E93' },
  sessionRow: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: Spacing.three, marginBottom: Spacing.two },
  sessionInfo: { flex: 1, gap: 2 },
  sessionTitle: { fontWeight: '600' },
  sessionMeta: { fontSize: 12 },
  revoke: { color: '#DC2626', fontWeight: '600', paddingHorizontal: Spacing.two },
});
