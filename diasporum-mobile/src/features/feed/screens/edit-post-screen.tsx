/**
 * EditPostScreen — edit an existing post's title/body.
 * Route: /(app)/posts/[id]/edit
 * Only editable fields: title, body, linkUrl (per backend PATCH contract).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams } from 'expo-router';
import { safeBack } from '@/core/navigation/safe-back';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PrimaryButton } from '@/shared/components/primary-button';
import { LoadingScreen } from '@/shared/components/loading-screen';
import { ErrorState } from '@/shared/components/error-state';
import { useSession } from '@/core/session/session-provider';
import { createFeedApi } from '../services/feed-api';
import { BrandColors } from '@/shared/theme/colors';
import { Spacing } from '@/shared/theme/spacing';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/core/api/api-error';
import type { Poll, PostType } from '../types/feed-types';
import {
  emptyPollFormValue,
  pollFormValueFromPoll,
  PollForm,
  updatePollRequest,
  validatePollForm,
} from '../components/poll-form';

export default function EditPostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();

  const { apiClient, session } = useSession();
  const feedApi = React.useMemo(() => createFeedApi(apiClient), [apiClient]);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [postType, setPostType] = useState<PostType | null>(null);
  const [poll, setPoll] = useState<Poll | null>(null);
  const [pollValue, setPollValue] = useState(emptyPollFormValue);
  const [pollConfigurationLocked, setPollConfigurationLocked] = useState(false);

  const myId = session?.me.id ?? '';
  const memberships = session?.memberships;

  const load = useCallback(async () => {
    try {
      const p = await feedApi.getPost(id);
      const canManagePoll = p.postType === 'POLL' && memberships?.some(
        membership => membership.communityId === p.communityId
          && (membership.role === 'MODERATOR' || membership.role === 'COMMUNITY_ADMIN'),
      );
      if (p.authorId !== myId && !canManagePoll) {
        setError('You can only edit your own posts.');
        return;
      }
      setPostType(p.postType);
      setTitle(p.title ?? '');
      setBody(p.body ?? '');
      setLinkUrl(p.linkUrl ?? '');
      if (p.postType === 'POLL') {
        const loadedPoll = await feedApi.getPoll(id);
        setPoll(loadedPoll);
        setPollValue(pollFormValueFromPoll(loadedPoll));
        setPollConfigurationLocked(
          (loadedPoll.totalVoters ?? 0) > 0 || loadedPoll.myVotes.length > 0,
        );
      }
      setError(null);
    } catch (err) {
      setError(ApiError.isApiError(err) ? err.userMessage : 'Failed to load post.');
    } finally {
      setLoading(false);
    }
  }, [feedApi, id, memberships, myId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const pollReadOnly = postType === 'POLL' && poll?.status !== 'ACTIVE';

  async function handleSave() {
    if (pollReadOnly) return;
    if (postType === 'POLL') {
      const validationError = validatePollForm(pollValue, false);
      if (validationError) {
        setSaveError(validationError);
        return;
      }
    }
    setSaving(true);
    setSaveError(null);
    try {
      if (postType === 'POLL') {
        const updated = await feedApi.updatePoll(id,
          updatePollRequest(pollValue, !pollConfigurationLocked));
        setPoll(updated);
        setPollValue(pollFormValueFromPoll(updated));
      } else {
        await feedApi.updatePost(id, {
          title: title.trim() || undefined,
          body: body.trim() || undefined,
          linkUrl: linkUrl.trim() || undefined,
        });
      }
      setSaved(true);
      setTimeout(() => safeBack(), 1200);
    } catch (err) {
      if (postType === 'POLL' && ApiError.isApiError(err) && err.httpStatus === 409) {
        setPollConfigurationLocked(true);
      }
      setSaveError(ApiError.isApiError(err) ? err.userMessage : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <KeyboardAvoidingView style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <SafeAreaView style={styles.safeArea}>
          <View style={[styles.navBar, { borderBottomColor: theme.border }]}>
            <Pressable onPress={() => safeBack()} hitSlop={8}>
              <ThemedText style={{ color: theme.textSecondary }}>Cancel</ThemedText>
            </Pressable>
            <ThemedText style={styles.navTitle}>{postType === 'POLL' ? 'Edit poll' : 'Edit post'}</ThemedText>
            <View style={{ width: 50 }} />
          </View>
          <ScrollView contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled">
            {postType === 'POLL' ? (
              <PollForm
                value={pollValue}
                onChange={setPollValue}
                configurationLocked={pollConfigurationLocked}
                readOnly={pollReadOnly}
                disabled={saving}
                allowDeadlineClear={false}
              />
            ) : (
              <>
                <ThemedText style={styles.label}>Title</ThemedText>
                <TextInput
                  style={[styles.input, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
                  value={title} onChangeText={setTitle}
                  placeholder="Title (optional)" placeholderTextColor={theme.textSecondary}
                  maxLength={200}
                />
                <ThemedText style={styles.label}>Body</ThemedText>
                <TextInput
                  style={[styles.input, styles.bodyInput, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
                  value={body} onChangeText={setBody}
                  placeholder="What's on your mind?" placeholderTextColor={theme.textSecondary}
                  multiline numberOfLines={6} maxLength={4000}
                />
                <ThemedText style={styles.label}>Link URL</ThemedText>
                <TextInput
                  style={[styles.input, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
                  value={linkUrl} onChangeText={setLinkUrl}
                  placeholder="https://… (optional)" placeholderTextColor={theme.textSecondary}
                  autoCapitalize="none" autoCorrect={false} keyboardType="url"
                />
              </>
            )}
            {saveError && <ThemedText style={styles.error}>{saveError}</ThemedText>}
            {saved && <ThemedText style={styles.savedText}>Saved ✓</ThemedText>}
          </ScrollView>
          {!pollReadOnly ? (
            <View style={styles.footer}>
              <PrimaryButton label="Save changes" onPress={handleSave}
                loading={saving} disabled={saving} />
            </View>
          ) : null}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  safeArea: { flex: 1 },
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.four, paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navTitle: { fontSize: 15, fontWeight: '600' },
  scroll: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.two },
  label: { fontSize: 13, fontWeight: '600', marginTop: Spacing.one },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 15, minHeight: 48 },
  bodyInput: { minHeight: 120, textAlignVertical: 'top' },
  error: { fontSize: 13, color: BrandColors.error, textAlign: 'center' },
  savedText: { fontSize: 13, color: BrandColors.success, textAlign: 'center', fontWeight: '600' },
  footer: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.five, paddingTop: Spacing.two },
});
