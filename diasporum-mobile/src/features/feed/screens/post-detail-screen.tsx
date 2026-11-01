/**
 * PostDetailScreen — original post + comments + reply composer.
 * Route: /(app)/posts/[id]
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams } from 'expo-router';
import { safeBack } from '@/core/navigation/safe-back';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LoadingScreen } from '@/shared/components/loading-screen';
import { ErrorState } from '@/shared/components/error-state';
import { useSession } from '@/core/session/session-provider';
import { createFeedApi } from '../services/feed-api';
import type { CommentRow, PostRow } from '../types/feed-types';
import { timeAgo } from '../utils/time-ago';
import { BrandColors } from '@/shared/theme/colors';
import { Spacing } from '@/shared/theme/spacing';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/core/api/api-error';

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();

  const { apiClient, session } = useSession();
  const feedApi = React.useMemo(() => createFeedApi(apiClient), [apiClient]);

  const [post, setPost] = useState<PostRow | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const loadingMore = useRef(false);

  const [authorMap, setAuthorMap] = useState<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([
        feedApi.getPost(id),
        feedApi.comments(id, 0),
      ]);
      setPost(p);
      setComments(c.items);
      setPage(0);
      setHasMore(c.items.length === 20);
      setError(null);
      // Batch-resolve all authors — post author + comment authors in one call
      const allIds = [...new Set([p.authorId, ...c.items.map(i => i.authorId)])];
      if (allIds.length > 0) {
        const summaries = await feedApi.authorSummaries(allIds);
        setAuthorMap(new Map(summaries.map(a => [a.id, a.displayName ?? a.username])));
      }
    } catch (err) {
      setError(ApiError.isApiError(err) ? err.userMessage : 'Failed to load post.');
    } finally {
      setLoading(false);
    }
  }, [feedApi, id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const loadMoreComments = useCallback(async () => {
    if (!hasMore || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const next = page + 1;
      const c = await feedApi.comments(id, next);
      setComments(prev => [...prev, ...c.items.filter(i => !prev.some(e => e.id === i.id))]);
      setPage(next);
      setHasMore(c.items.length === 20);
    } catch { /* silent — footer shows retry */ }
    finally { loadingMore.current = false; }
  }, [hasMore, page, feedApi, id]);

  async function handleSubmit() {
    const text = body.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await feedApi.comment(id, text, replyTo?.id);
      setComments(prev => [...prev, created]);
      setBody('');
      setReplyTo(null);
    } catch (err) {
      setSubmitError(ApiError.isApiError(err) ? err.userMessage : 'Failed to post comment.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingScreen />;
  if (error || !post) return <ErrorState message={error ?? 'Post not found.'} onRetry={load} />;

  const authorName = post.authorId === session?.me.id
    ? session.profile?.displayName ?? 'You'
    : 'Diasporum member'; // authorId known but ProfileSummary not in PostRow — feed item carries it

  const replies = comments.filter(c => !c.parentCommentId);
  const childMap = comments.reduce<Record<string, CommentRow[]>>((m, c) => {
    if (c.parentCommentId) (m[c.parentCommentId] ??= []).push(c);
    return m;
  }, {});

  const flatComments = replies.flatMap(r => [r, ...(childMap[r.id] ?? [])]);

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.navBar, { borderBottomColor: theme.border }]}>
          <Pressable onPress={() => safeBack()} hitSlop={8} accessibilityLabel="Back">
            <ThemedText style={[styles.backBtn, { color: BrandColors.primary }]}>←</ThemedText>
          </Pressable>
          <ThemedText style={styles.navTitle}>Post</ThemedText>
        </View>

        <KeyboardAvoidingView style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <FlatList
            data={flatComments}
            keyExtractor={c => c.id}
            onEndReached={loadMoreComments}
            onEndReachedThreshold={0.3}
            ListHeaderComponent={
              <View style={[styles.postBlock, { borderBottomColor: theme.border }]}>
                <View style={styles.postHeader}>
                  <View style={[styles.avatar, { backgroundColor: BrandColors.primarySurface }]}>
                    <ThemedText style={[styles.avatarText, { color: BrandColors.primary }]}>
                      {authorName[0].toUpperCase()}
                    </ThemedText>
                  </View>
                  <View>
                    <ThemedText style={styles.postAuthor}>{authorName}</ThemedText>
                    <ThemedText style={styles.postMeta} themeColor="textSecondary">
                      {timeAgo(post.publishedAt)}
                    </ThemedText>
                  </View>
                </View>
                {post.title ? <ThemedText style={styles.postTitle}>{post.title}</ThemedText> : null}
                {post.body ? <ThemedText style={styles.postBody}>{post.body}</ThemedText> : null}
                <View style={styles.postStats}>
                  <ThemedText style={styles.statText} themeColor="textSecondary">
                    💬 {post.commentCount} · ♥ {post.reactionCount}
                  </ThemedText>
                </View>
                {comments.length > 0 && (
                  <ThemedText style={[styles.commentsHeader, { borderTopColor: theme.border }]}>
                    Replies
                  </ThemedText>
                )}
              </View>
            }
            renderItem={({ item: c }) => (
              <CommentItem comment={c} isReply={!!c.parentCommentId}
                authorName={authorMap.get(c.authorId) ?? 'Diasporum member'}
                onReply={() => setReplyTo(c)} theme={theme} />
            )}
            ListEmptyComponent={
              <ThemedText style={styles.noComments} themeColor="textSecondary">
                No replies yet. Be the first.
              </ThemedText>
            }
            showsVerticalScrollIndicator={false}
          />

          {/* Composer */}
          <View style={[styles.composer, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
            {replyTo && (
              <View style={[styles.replyBar, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={styles.replyLabel}>Replying to a comment</ThemedText>
                <Pressable onPress={() => setReplyTo(null)} hitSlop={4}>
                  <ThemedText style={{ color: BrandColors.primary, fontSize: 13 }}>Cancel</ThemedText>
                </Pressable>
              </View>
            )}
            {submitError && (
              <ThemedText style={styles.submitError}>{submitError}</ThemedText>
            )}
            <View style={styles.composerRow}>
              <TextInput
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                placeholder={replyTo ? 'Write a reply…' : 'Add a comment…'}
                placeholderTextColor={theme.textSecondary}
                value={body}
                onChangeText={setBody}
                multiline
                maxLength={2000}
              />
              <Pressable
                onPress={handleSubmit}
                disabled={!body.trim() || submitting}
                style={[styles.sendBtn, { backgroundColor: body.trim() && !submitting ? BrandColors.primary : theme.border }]}
                accessibilityRole="button" accessibilityLabel="Send comment">
                <ThemedText style={styles.sendText}>{submitting ? '…' : '↑'}</ThemedText>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

function CommentItem({ comment, isReply, authorName, onReply, theme }: {
  comment: CommentRow; isReply: boolean; authorName: string; onReply: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={[styles.comment, isReply && styles.replyIndent, { borderBottomColor: theme.border }]}>
      <View style={[styles.commentAvatar, { backgroundColor: BrandColors.primarySurface }]}>
        <ThemedText style={[styles.commentAvatarText, { color: BrandColors.primary }]}>
          {authorName[0]?.toUpperCase() ?? '?'}
        </ThemedText>
      </View>
      <View style={styles.commentBody}>
        <ThemedText style={styles.commentMeta} themeColor="textSecondary">
          {authorName} · {timeAgo(comment.createdAt)}
        </ThemedText>
        <ThemedText style={styles.commentText}>{comment.body}</ThemedText>
        {!isReply && (
          <Pressable onPress={onReply} hitSlop={8}>
            <ThemedText style={[styles.replyAction, { color: BrandColors.primary }]}>Reply</ThemedText>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  navBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.three,
    paddingHorizontal: Spacing.four, paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { fontSize: 22 },
  navTitle: { fontSize: 16, fontWeight: '600' },
  postBlock: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.two },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 17, fontWeight: '700' },
  postAuthor: { fontSize: 14, fontWeight: '600' },
  postMeta: { fontSize: 12 },
  postTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  postBody: { fontSize: 14, lineHeight: 20 },
  postStats: { marginTop: Spacing.two },
  statText: { fontSize: 13 },
  commentsHeader: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.5, paddingTop: Spacing.two, marginTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth },
  comment: {
    flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two + 2, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  replyIndent: { paddingLeft: Spacing.four + 48 },
  commentAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  commentAvatarText: { fontSize: 14, fontWeight: '700' },
  commentBody: { flex: 1, gap: 3 },
  commentMeta: { fontSize: 11 },
  commentText: { fontSize: 14, lineHeight: 20 },
  replyAction: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  noComments: { textAlign: 'center', paddingVertical: Spacing.four, fontSize: 14 },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingBottom: Spacing.two },
  replyBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.four, paddingVertical: Spacing.one + 2 },
  replyLabel: { fontSize: 12, fontWeight: '500' },
  submitError: { fontSize: 12, color: BrandColors.error, paddingHorizontal: Spacing.four, paddingTop: 4 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two,
    paddingHorizontal: Spacing.four, paddingTop: Spacing.two },
  input: { flex: 1, borderRadius: 20, paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two, fontSize: 14, maxHeight: 100 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  sendText: { fontSize: 18, color: '#FFFFFF', fontWeight: '700' },
});
