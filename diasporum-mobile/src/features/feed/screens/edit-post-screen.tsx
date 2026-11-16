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
import { Spacing, BorderRadius } from '@/shared/theme/spacing';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/core/api/api-error';
import type { Poll, PostType, TargetMode } from '../types/feed-types';
import {
  emptyPollFormValue,
  pollFormValueFromPoll,
  PollForm,
  updatePollRequest,
  validatePollForm,
} from '../components/poll-form';
import { FormattingToolbar, continueList } from '../components/formatting-toolbar';
import { MultiSelectField } from '@/shared/components/multi-select-field';
import { friendlyTargetModeMessage } from '../utils/target-mode-errors';

const TARGET_MODE_OPTIONS: { value: TargetMode; label: string }[] = [
  { value: 'SINGLE_COMMUNITY', label: 'Just this community' },
  { value: 'SELECTED_COMMUNITIES', label: 'Selected communities' },
  { value: 'ALL_SAME_ORIGIN', label: 'Everyone from my origin' },
  { value: 'ALL_SAME_CURRENT_COUNTRY', label: 'Everyone in my country' },
];

export default function EditPostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();

  const { apiClient, session } = useSession();
  const feedApi = React.useMemo(() => createFeedApi(apiClient), [apiClient]);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [bodySel, setBodySel] = useState({ start: 0, end: 0 });
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
  const [targetMode, setTargetMode] = useState<TargetMode>('SINGLE_COMMUNITY');
  const [targetCommunityIds, setTargetCommunityIds] = useState<string[]>([]);
  const [targetingDirty, setTargetingDirty] = useState(false);
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');

  const myId = session?.me.id ?? '';
  const memberships = session?.memberships;

  const memberCommunityIds = React.useMemo(
    () => new Set((memberships ?? []).filter(m => m.status === 'ACTIVE').map(m => m.communityId)),
    [memberships],
  );
  const targetableCommunities = React.useMemo(
    () => (session?.access?.communities ?? []).filter(c => memberCommunityIds.has(c.communityId)),
    [session?.access, memberCommunityIds],
  );

  function markTargetingDirty() {
    setTargetingDirty(true);
  }

  const load = useCallback(async () => {
    try {
      const p = (await feedApi.getPost(id)).post;
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
      setTargetMode(p.targetMode);
      // Note: PostRow (GET /feed/posts/{id}) doesn't return targetCommunityIds
      // — that list is only resolved for feed-listing items, not single-post
      // detail. For a SELECTED_COMMUNITIES post the selection starts empty;
      // the user re-picks communities if they want to change targeting.
      setTargetCommunityIds([]);
      setTargetingDirty(false);
      setCtaLabel(p.ctaLabel ?? '');
      setCtaUrl(p.ctaUrl ?? '');
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

  function validateTargetingAndCta(): string | null {
    if (targetingDirty && targetMode === 'SELECTED_COMMUNITIES' && targetCommunityIds.length === 0) {
      return 'Choose at least one community to post to.';
    }
    const ctaLabelTrim = ctaLabel.trim();
    const ctaUrlTrim = ctaUrl.trim();
    if ((ctaLabelTrim && !ctaUrlTrim) || (!ctaLabelTrim && ctaUrlTrim)) {
      return 'Add both a button label and a link, or leave both blank.';
    }
    if (ctaLabelTrim.length > 60) {
      return 'Button label must be 60 characters or fewer.';
    }
    if (ctaUrlTrim && !/^https?:\/\//i.test(ctaUrlTrim)) {
      return 'Button link must start with http:// or https://.';
    }
    return null;
  }

  async function handleSave() {
    if (pollReadOnly) return;
    if (postType === 'POLL') {
      const validationError = validatePollForm(pollValue, false);
      if (validationError) {
        setSaveError(validationError);
        return;
      }
    } else {
      const validationError = validateTargetingAndCta();
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
        const ctaLabelTrim = ctaLabel.trim();
        const ctaUrlTrim = ctaUrl.trim();
        await feedApi.updatePost(id, {
          title: title.trim() || undefined,
          body: body.trim() || undefined,
          linkUrl: linkUrl.trim() || undefined,
          ctaLabel: ctaLabelTrim || undefined,
          ctaUrl: ctaUrlTrim || undefined,
          ...(targetingDirty
            ? {
                targetMode,
                targetCommunityIds:
                  targetMode === 'SELECTED_COMMUNITIES' ? targetCommunityIds : undefined,
              }
            : {}),
        });
      }
      setSaved(true);
      setTimeout(() => safeBack(), 1200);
    } catch (err) {
      if (postType === 'POLL' && ApiError.isApiError(err) && err.httpStatus === 409) {
        setPollConfigurationLocked(true);
      }
      setSaveError(friendlyTargetModeMessage(err) ??
        (ApiError.isApiError(err) ? err.userMessage : 'Failed to save.'));
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
                <FormattingToolbar
                  text={body}
                  selection={bodySel}
                  disabled={saving}
                  onChange={({ text, selection }) => {
                    setBody(text.slice(0, 4000));
                    setBodySel(selection);
                  }}
                />
                <TextInput
                  style={[styles.input, styles.bodyInput, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
                  value={body}
                  onChangeText={(t) => {
                    const cont = continueList(body, bodySel, t);
                    if (cont) {
                      setBody(cont.text);
                      setBodySel(cont.selection);
                    } else {
                      setBody(t);
                    }
                  }}
                  selection={bodySel}
                  onSelectionChange={(e) => setBodySel(e.nativeEvent.selection)}
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

                <ThemedText style={styles.label}>Post to</ThemedText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.targetChips}>
                  {TARGET_MODE_OPTIONS.map((opt) => {
                    const selected = targetMode === opt.value;
                    return (
                      <Pressable
                        key={opt.value}
                        onPress={() => {
                          setTargetMode(opt.value);
                          markTargetingDirty();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={opt.label}
                        accessibilityState={{ selected }}
                        style={[
                          styles.targetChip,
                          {
                            borderColor: selected ? BrandColors.primary : theme.border,
                            backgroundColor: selected ? BrandColors.primarySurface : 'transparent',
                          },
                        ]}
                      >
                        <ThemedText style={{
                          color: selected ? BrandColors.primary : theme.textSecondary,
                          fontSize: 13, fontWeight: '600',
                        }}>
                          {opt.label}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                {targetMode === 'SELECTED_COMMUNITIES' && (
                  <MultiSelectField
                    label="Communities"
                    values={targetCommunityIds}
                    options={targetableCommunities.map(c => ({ id: c.communityId, label: c.communityName }))}
                    onChange={(ids) => {
                      setTargetCommunityIds(ids);
                      markTargetingDirty();
                    }}
                    required
                    placeholder="Choose communities"
                    modalTitle="Select communities"
                    searchPlaceholder="Search communities…"
                    hint={targetingDirty ? undefined : 'Re-select communities to change targeting.'}
                  />
                )}

                <ThemedText style={styles.label}>Call to action (optional)</ThemedText>
                <TextInput
                  style={[styles.input, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
                  value={ctaLabel} onChangeText={setCtaLabel}
                  placeholder="Button label, e.g. Learn more" placeholderTextColor={theme.textSecondary}
                  maxLength={60}
                />
                <TextInput
                  style={[styles.input, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
                  value={ctaUrl} onChangeText={setCtaUrl}
                  placeholder="https://example.com" placeholderTextColor={theme.textSecondary}
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
  targetChips: { flexDirection: 'row', gap: Spacing.two },
  targetChip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three, paddingVertical: 6,
  },
  error: { fontSize: 13, color: BrandColors.error, textAlign: 'center' },
  savedText: { fontSize: 13, color: BrandColors.success, textAlign: 'center', fontWeight: '600' },
  footer: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.five, paddingTop: Spacing.two },
});
