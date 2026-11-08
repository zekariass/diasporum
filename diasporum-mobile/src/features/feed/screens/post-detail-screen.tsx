/**
 * PostDetailScreen — original post + comments + reply composer.
 * Route: /(app)/posts/[id]
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { safeBack } from "@/core/navigation/safe-back";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { ErrorState } from "@/shared/components/error-state";
import { useSession } from "@/core/session/session-provider";
import { createFeedApi } from "../services/feed-api";
import type {
  CommentRow,
  MediaAttachment,
  Poll,
  PostRow,
  ProfileSummary,
  ReactionKey,
} from "../types/feed-types";
import { timeAgo } from "../utils/time-ago";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import { PollCard } from "../components/poll-card";
import { PostMedia } from "../components/post-item";
import { HashtagText } from "../components/hashtag-text";
import { Avatar } from "../components/avatar";
import { consumePostDetailSeed } from "../utils/post-detail-seed";
import { publishFeedUpdate } from "../utils/feed-updates";

const LIKE_COLOR = "#FF3040";

export default function PostDetailScreen({
  postId,
  commentsOnly = false,
  onClose,
  onCommentCountChange,
}: {
  postId?: string;
  commentsOnly?: boolean;
  onClose?: () => void;
  onCommentCountChange?: (id: string, count: number) => void;
} = {}) {
  const params = useLocalSearchParams<{ id: string }>();
  const id = postId ?? params.id;
  const theme = useTheme();

  const { apiClient, session } = useSession();
  const feedApi = React.useMemo(() => createFeedApi(apiClient), [apiClient]);

  // Seed — instant paint from the feed snapshot; consumed once, then the
  // detail fetch refreshes every field in place (no loading-screen swap).
  const [seed] = useState(() => consumePostDetailSeed(id));
  const [post, setPost] = useState<PostRow | null>(seed?.post ?? null);
  const [tags, setTags] = useState<string[]>(seed?.tags ?? []);
  const [media, setMedia] = useState<MediaAttachment[]>(seed?.media ?? []);
  const [poll, setPoll] = useState<Poll | null>(seed?.poll ?? null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  // Full-screen loader only when nothing was seeded (deep link / direct nav);
  // comments get their own localized spinner so the post paints instantly.
  const [loading, setLoading] = useState(seed == null);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const loadingMore = useRef(false);
  const submittingRef = useRef(false);
  const deleting = useRef(new Set<string>());
  const [pageError, setPageError] = useState<string | null>(null);
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const listRef = useRef<FlatList<CommentRow>>(null);

  // Engagement state — seeded from the feed item, then corrected by the fetch
  const [viewerReaction, setViewerReaction] = useState<ReactionKey | null>(
    seed?.viewerReaction ?? null,
  );
  const [reactionCount, setReactionCount] = useState(
    seed?.post.reactionCount ?? 0,
  );
  const [saved, setSaved] = useState(seed?.saved ?? false);
  const [shareCount, setShareCount] = useState(seed?.post.shareCount ?? 0);

  const [authorMap, setAuthorMap] = useState<Map<string, ProfileSummary>>(
    () => new Map(seed?.author ? [[seed.author.id, seed.author]] : []),
  );
  const authorOf = useCallback(
    (userId: string | null | undefined): ProfileSummary | null =>
      (userId ? authorMap.get(userId) : null) ?? null,
    [authorMap],
  );
  const nameOf = useCallback(
    (userId: string) =>
      authorOf(userId)?.displayName ?? authorOf(userId)?.username ?? "Member",
    [authorOf],
  );

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([
        feedApi.getPost(id),
        feedApi.comments(id, 0),
      ]);
      const loadedPoll =
        p.post.postType === "POLL" ? await feedApi.getPoll(id) : null;
      setPost(p.post);
      setTags(p.tags);
      setMedia(p.media);
      setPoll(loadedPoll);
      setComments(c.items);
      setPage(0);
      setHasMore(c.items.length === 20);
      setViewerReaction(p.viewerReaction);
      setReactionCount(p.post.reactionCount);
      setSaved(p.saved);
      setShareCount(p.post.shareCount);
      setError(null);
      // Batch-resolve authors in the background — post author may already be
      // seeded; merge rather than replace so seeded data never pops out.
      const allIds = [
        ...new Set([p.post.authorId, ...c.items.map((i) => i.authorId)]),
      ];
      if (allIds.length > 0) {
        feedApi
          .authorSummaries(allIds)
          .then((summaries) =>
            setAuthorMap((prev) => {
              const merged = new Map(prev);
              for (const a of summaries) merged.set(a.id, a);
              return merged;
            }),
          )
          .catch(() => {});
      }
    } catch (err) {
      // 403/404 (deleted/hidden/inaccessible) always surface; transient
      // failures keep seeded content on screen — pull-to-refresh retries.
      const blocking =
        commentsOnly ||
        !seed ||
        !ApiError.isApiError(err) ||
        err.httpStatus === 403 ||
        err.httpStatus === 404;
      if (blocking) {
        setError(
          ApiError.isApiError(err) ? err.userMessage : "Failed to load post.",
        );
      }
    } finally {
      setLoading(false);
      setCommentsLoading(false);
      setRefreshing(false);
    }
  }, [feedApi, id, seed, commentsOnly]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const loadMoreComments = useCallback(async () => {
    if (!hasMore || loadingMore.current) return;
    loadingMore.current = true;
    setPageError(null);
    try {
      const next = page + 1;
      const c = await feedApi.comments(id, next);
      setComments((prev) => [
        ...prev,
        ...c.items.filter((i) => !prev.some((e) => e.id === i.id)),
      ]);
      setPage(next);
      setHasMore(c.items.length === 20);
      const summaries = await feedApi.authorSummaries([
        ...new Set(c.items.map((i) => i.authorId)),
      ]);
      setAuthorMap(
        (prev) =>
          new Map([...prev, ...summaries.map((a) => [a.id, a] as const)]),
      );
    } catch {
      setPageError("Could not load more comments. Tap to retry.");
    } finally {
      loadingMore.current = false;
    }
  }, [hasMore, page, feedApi, id]);

  useEffect(() => {
    if (post) {
      onCommentCountChange?.(id, post.commentCount);
      publishFeedUpdate(apiClient, id, (item) => ({
        ...item,
        commentCount: post.commentCount,
      }));
    }
  }, [apiClient, id, post, onCommentCountChange]);

  const bumpCommentCount = useCallback((delta: number) => {
    setPost((p) =>
      p ? { ...p, commentCount: Math.max(0, p.commentCount + delta) } : p,
    );
  }, []);

  async function handleSubmit() {
    const text = body.trim();
    if (!text || submittingRef.current || !post?.commentsEnabled) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await feedApi.comment(id, text, replyTo?.id);
      setComments((prev) => [...prev, created]);
      bumpCommentCount(1);
      setBody("");
      setReplyTo(null);
    } catch (err) {
      setSubmitError(
        ApiError.isApiError(err) ? err.userMessage : "Failed to post comment.",
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const toggleReact = async () => {
    if (!post) return;
    const next = viewerReaction === "LIKE" ? null : ("LIKE" as const);
    const prevReaction = viewerReaction;
    const prevCount = reactionCount;
    setViewerReaction(next);
    setReactionCount(Math.max(0, prevCount + (next ? 1 : -1)));
    try {
      if (next) await feedApi.react(post.id, next);
      else await feedApi.unreact(post.id);
    } catch {
      setViewerReaction(prevReaction);
      setReactionCount(prevCount);
    }
  };

  const toggleSave = async () => {
    if (!post) return;
    const next = !saved;
    setSaved(next);
    try {
      if (next) await feedApi.save(post.id);
      else await feedApi.unsave(post.id);
    } catch {
      setSaved(!next);
    }
  };

  const share = async () => {
    if (!post) return;
    try {
      const res = await feedApi.sharePost(post.id, "SYSTEM_SHARE");
      setShareCount(res.shareCount);
    } catch {
      /* tracking is best-effort — still open the sheet */
    }
    void Share.share({
      message: post.body
        ? post.body.slice(0, 140)
        : "Check this out on Diasporum",
    });
  };

  const deleteComment = async (c: CommentRow) => {
    if (deleting.current.has(c.id)) return;
    deleting.current.add(c.id);
    setSubmitError(null);
    try {
      await feedApi.deleteComment(c.id);
      setComments((prev) => prev.filter((x) => x.id !== c.id));
      bumpCommentCount(-1);
    } catch {
      setSubmitError("Could not delete comment. Please try again.");
    } finally {
      deleting.current.delete(c.id);
    }
  };

  if (loading) return <LoadingScreen />;
  if (error || !post)
    return <ErrorState message={error ?? "Post not found."} onRetry={load} />;

  const author = authorOf(post.authorId);
  const authorName =
    post.authorId === session?.me.id
      ? (session.profile?.displayName ?? "You")
      : (author?.displayName ?? author?.username ?? "Member");

  const replies = comments.filter(
    (c) =>
      !c.parentCommentId || !comments.some((p) => p.id === c.parentCommentId),
  );
  const childMap = comments.reduce<Record<string, CommentRow[]>>((m, c) => {
    if (c.parentCommentId) (m[c.parentCommentId] ??= []).push(c);
    return m;
  }, {});

  const flatComments = replies.flatMap((r) => [r, ...(childMap[r.id] ?? [])]);

  return (
    <ThemedView style={styles.root}>
      {!commentsOnly && <StatusBar style="auto" />}
      <SafeAreaView
        style={styles.safeArea}
        edges={commentsOnly ? ["bottom"] : ["top", "bottom"]}
      >
        <View style={[styles.navBar, { borderBottomColor: theme.border }]}>
          <Pressable
            onPress={() => (onClose ? onClose() : safeBack())}
            hitSlop={8}
            accessibilityLabel={commentsOnly ? "Close comments" : "Back"}
            accessibilityRole="button"
            style={[
              styles.backCircle,
              { backgroundColor: theme.backgroundElement },
            ]}
          >
            <Ionicons name="chevron-back" size={20} color={theme.text} />
          </Pressable>
          <ThemedText style={styles.navTitle}>
            {commentsOnly ? "Comments" : "Post"}
          </ThemedText>
          <View style={styles.navSpacer} />
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          enabled={!commentsOnly}
        >
          <FlatList
            ref={listRef}
            data={flatComments}
            keyExtractor={(c) => c.id}
            onEndReached={() => {
              if (!pageError) void loadMoreComments();
            }}
            keyboardShouldPersistTaps="handled"
            ListFooterComponent={
              pageError ? (
                <Pressable
                  onPress={loadMoreComments}
                  style={styles.noCommentsWrap}
                  accessibilityRole="button"
                  accessibilityLabel="Retry comments"
                >
                  <ThemedText>{pageError}</ThemedText>
                </Pressable>
              ) : undefined
            }
            onEndReachedThreshold={0.3}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  void load();
                }}
                tintColor={BrandColors.primary}
              />
            }
            ListHeaderComponent={
              commentsOnly ? undefined : (
                <View
                  style={[
                    styles.postBlock,
                    { borderBottomColor: theme.border },
                  ]}
                >
                  <View style={styles.postHeader}>
                    <Avatar
                      name={authorName}
                      mediaId={author?.avatarMediaId}
                      userId={post.authorId}
                      size={42}
                    />
                    <View style={styles.authorCopy}>
                      <ThemedText style={styles.postAuthor} numberOfLines={1}>
                        {authorName}
                      </ThemedText>
                      <ThemedText
                        style={styles.postMeta}
                        themeColor="textSecondary"
                      >
                        {author?.username ? `@${author.username} · ` : ""}
                        {timeAgo(post.publishedAt)}
                      </ThemedText>
                    </View>
                  </View>
                  {post.title ? (
                    <ThemedText style={styles.postTitle}>
                      {post.title}
                    </ThemedText>
                  ) : null}
                  {post.body && !poll ? (
                    <HashtagText body={post.body} style={styles.postBody} />
                  ) : null}
                  {poll ? (
                    <PollCard
                      poll={poll}
                      onVote={feedApi.vote}
                      onChange={setPoll}
                    />
                  ) : null}
                  {media.length > 0 && <PostMedia media={media} />}
                  {tags.length > 0 && (
                    <View style={styles.tagRow}>
                      {tags.map((t) => (
                        <Pressable
                          key={t}
                          onPress={() =>
                            router.push({
                              pathname: "/(app)/posts/tag/[tag]",
                              params: { tag: t.toLowerCase() },
                            })
                          }
                          accessibilityRole="link"
                          accessibilityLabel={`Hashtag ${t}`}
                        >
                          <ThemedText style={styles.tag}>#{t}</ThemedText>
                        </Pressable>
                      ))}
                    </View>
                  )}

                  {/* Action row — like · reply · share · save */}
                  <View
                    style={[styles.actions, { borderTopColor: theme.border }]}
                  >
                    <Pressable
                      onPress={() => void toggleReact()}
                      style={styles.action}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={viewerReaction ? "Unlike" : "Like"}
                    >
                      <Ionicons
                        name={viewerReaction ? "heart" : "heart-outline"}
                        size={23}
                        color={
                          viewerReaction ? LIKE_COLOR : theme.textSecondary
                        }
                      />
                      {reactionCount > 0 ? (
                        <ThemedText
                          style={[
                            styles.count,
                            viewerReaction && { color: LIKE_COLOR },
                          ]}
                        >
                          {reactionCount}
                        </ThemedText>
                      ) : null}
                    </Pressable>
                    <Pressable
                      onPress={() => inputRef.current?.focus()}
                      style={styles.action}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Comments"
                    >
                      <Ionicons
                        name="chatbubble-outline"
                        size={21}
                        color={theme.textSecondary}
                      />
                      {post.commentCount > 0 ? (
                        <ThemedText style={styles.count}>
                          {post.commentCount}
                        </ThemedText>
                      ) : null}
                    </Pressable>
                    <Pressable
                      onPress={() => void share()}
                      style={styles.action}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Share post"
                    >
                      <Ionicons
                        name="paper-plane-outline"
                        size={21}
                        color={theme.textSecondary}
                      />
                      {shareCount > 0 ? (
                        <ThemedText style={styles.count}>
                          {shareCount}
                        </ThemedText>
                      ) : null}
                    </Pressable>
                    <View style={styles.actionSpacer} />
                    <Pressable
                      onPress={() => void toggleSave()}
                      style={styles.action}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={saved ? "Unsave post" : "Save post"}
                    >
                      <Ionicons
                        name={saved ? "bookmark" : "bookmark-outline"}
                        size={21}
                        color={
                          saved ? BrandColors.primary : theme.textSecondary
                        }
                      />
                    </Pressable>
                  </View>

                  {comments.length > 0 && (
                    <ThemedText style={styles.commentsHeader}>
                      Replies
                    </ThemedText>
                  )}
                </View>
              )
            }
            renderItem={({ item: c }) => (
              <CommentItem
                comment={c}
                isReply={!!c.parentCommentId}
                author={authorOf(c.authorId)}
                authorName={nameOf(c.authorId)}
                isOwn={c.authorId === session?.me.id}
                onReply={() => {
                  setReplyTo(c);
                  inputRef.current?.focus();
                }}
                onDelete={() => void deleteComment(c)}
                theme={theme}
              />
            )}
            ListEmptyComponent={
              commentsLoading ? (
                <View style={styles.noCommentsWrap}>
                  <ActivityIndicator size="small" color={BrandColors.primary} />
                </View>
              ) : (
                <View style={styles.noCommentsWrap}>
                  <Ionicons
                    name="chatbubble-ellipses-outline"
                    size={34}
                    color={theme.textSecondary}
                  />
                  <ThemedText
                    style={styles.noComments}
                    themeColor="textSecondary"
                  >
                    No replies yet. Be the first.
                  </ThemedText>
                </View>
              )
            }
            showsVerticalScrollIndicator={false}
          />

          <View
            style={[
              styles.composer,
              {
                borderTopColor: theme.border,
                backgroundColor: theme.background,
              },
            ]}
          >
            {replyTo && (
              <View
                style={[
                  styles.replyBar,
                  { backgroundColor: theme.backgroundElement },
                ]}
              >
                <ThemedText
                  style={styles.replyLabel}
                  themeColor="textSecondary"
                >
                  Replying to{" "}
                  <ThemedText style={styles.replyName}>
                    {nameOf(replyTo.authorId)}
                  </ThemedText>
                </ThemedText>
                <Pressable
                  onPress={() => setReplyTo(null)}
                  hitSlop={8}
                  accessibilityLabel="Cancel reply"
                >
                  <Ionicons
                    name="close"
                    size={17}
                    color={theme.textSecondary}
                  />
                </Pressable>
              </View>
            )}
            {submitError && (
              <ThemedText style={styles.submitError}>{submitError}</ThemedText>
            )}
            <View style={styles.composerRow}>
              <TextInput
                ref={inputRef}
                style={[
                  styles.input,
                  {
                    color: theme.text,
                    backgroundColor: theme.backgroundElement,
                  },
                ]}
                placeholder={
                  !post.commentsEnabled
                    ? "Comments are disabled"
                    : replyTo
                      ? "Write a reply…"
                      : "Add a comment…"
                }
                accessibilityLabel="Comment"
                editable={post.commentsEnabled && !submitting}
                placeholderTextColor={theme.textSecondary}
                value={body}
                onChangeText={setBody}
                multiline
                maxLength={2000}
              />
              <Pressable
                onPress={handleSubmit}
                disabled={!body.trim() || submitting || !post.commentsEnabled}
                style={[
                  styles.sendBtn,
                  {
                    backgroundColor:
                      body.trim() && !submitting
                        ? BrandColors.primary
                        : theme.border,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Send comment"
              >
                {submitting ? (
                  <Ionicons
                    name="ellipsis-horizontal"
                    size={18}
                    color="#FFFFFF"
                  />
                ) : (
                  <Ionicons name="arrow-up" size={19} color="#FFFFFF" />
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

function CommentItem({
  comment,
  isReply,
  author,
  authorName,
  isOwn,
  onReply,
  onDelete,
  theme,
}: {
  comment: CommentRow;
  isReply: boolean;
  author: ProfileSummary | null;
  authorName: string;
  isOwn: boolean;
  onReply: () => void;
  onDelete: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View
      style={[
        styles.comment,
        isReply && styles.replyIndent,
        { borderBottomColor: theme.border },
      ]}
    >
      <Avatar
        name={authorName}
        mediaId={author?.avatarMediaId}
        userId={comment.authorId}
        size={34}
      />
      <View style={styles.commentBody}>
        <View style={styles.commentMetaRow}>
          <ThemedText style={styles.commentAuthor} numberOfLines={1}>
            {authorName}
          </ThemedText>
          <ThemedText style={styles.commentMeta} themeColor="textSecondary">
            {timeAgo(comment.createdAt)}
          </ThemedText>
        </View>
        <ThemedText style={styles.commentText}>{comment.body}</ThemedText>
        <View style={styles.commentActions}>
          {!isReply && (
            <Pressable
              onPress={onReply}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Reply to comment"
            >
              <ThemedText
                style={[styles.replyAction, { color: BrandColors.primary }]}
              >
                Reply
              </ThemedText>
            </Pressable>
          )}
          {isOwn && (
            <Pressable
              onPress={onDelete}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Delete comment"
            >
              <ThemedText
                style={[styles.replyAction, { color: theme.textSecondary }]}
              >
                Delete
              </ThemedText>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  navTitle: { fontSize: 17, fontWeight: "700" },
  navSpacer: { flex: 1 },
  postBlock: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  postHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two + 2,
    marginBottom: Spacing.two,
  },
  authorCopy: { flex: 1, minWidth: 0, gap: 1 },
  postAuthor: { fontSize: 15, fontWeight: "700" },
  postMeta: { fontSize: 13 },
  postTitle: { fontSize: 16, fontWeight: "700", marginBottom: 4, marginTop: 4 },
  postBody: { fontSize: 15, lineHeight: 22 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  tag: { fontSize: 14, fontWeight: "600", color: BrandColors.primary },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 30,
    marginTop: Spacing.three,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  action: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 28 },
  actionSpacer: { flex: 1 },
  count: { fontSize: 14, fontWeight: "500" },
  commentsHeader: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: Spacing.three,
    color: "#8E8E93",
  },
  comment: {
    flexDirection: "row",
    gap: Spacing.two + 2,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two + 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  replyIndent: { paddingLeft: Spacing.four + 44 },
  commentBody: { flex: 1, gap: 3 },
  commentMetaRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: Spacing.two,
  },
  commentAuthor: { fontSize: 14, fontWeight: "700", flexShrink: 1 },
  commentMeta: { fontSize: 12 },
  commentText: { fontSize: 14, lineHeight: 20 },
  commentActions: { flexDirection: "row", gap: Spacing.four, marginTop: 2 },
  replyAction: { fontSize: 12, fontWeight: "600", paddingVertical: 12 },
  noCommentsWrap: {
    alignItems: "center",
    paddingVertical: Spacing.five,
    gap: Spacing.two,
  },
  noComments: { fontSize: 14 },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: Spacing.two,
  },
  replyBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  replyLabel: { fontSize: 12, fontWeight: "500" },
  replyName: { fontWeight: "700" },
  submitError: {
    fontSize: 12,
    color: BrandColors.error,
    paddingHorizontal: Spacing.four,
    paddingTop: 4,
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  input: {
    flex: 1,
    borderRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
    maxHeight: 100,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
});
