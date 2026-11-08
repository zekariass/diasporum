/**
 * PostItem — polished, type-aware feed card.
 * Regular posts expose reactions and replies; polls keep the focus on voting
 * and use a distinct branded surface with share/save actions only.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { ThemedText } from "@/components/themed-text";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type {
  FeedItem,
  MediaAttachment,
  Poll,
  ReactionKey,
} from "../types/feed-types";
import {
  getFeedMediaUrl,
  peekFeedMediaUrl,
  refreshFeedMediaUrl,
} from "../utils/media-cache";
import { timeAgo } from "../utils/time-ago";
import { AudioAttachment } from "./audio-attachment";
import { Avatar } from "./avatar";
import { HashtagText } from "./hashtag-text";
import { MediaImage } from "./media-image";
import { PhotoViewerModal } from "@/shared/components/photo-viewer-modal";
import { PollCard } from "./poll-card";

const TYPE_LABEL: Record<string, string> = {
  ANNOUNCEMENT: "Announcement",
  COMMUNITY_HELP: "Community help",
  POLL: "Community poll",
  REEL: "Video",
};

const TYPE_ICON: Record<string, ComponentProps<typeof Ionicons>["name"]> = {
  ANNOUNCEMENT: "megaphone-outline",
  COMMUNITY_HELP: "hand-left-outline",
  POLL: "stats-chart",
  REEL: "play",
};

const LIKE_COLOR = "#FF3040";
const MEDIA_RADIUS = 12;
const MEDIA_MAX_HEIGHT = 320;
const MIN_RATIO = 0.56; // 9:16 portrait
const MAX_RATIO = 1.91; // wide landscape

/** Measured image aspect ratios — shared across mounts (feed → detail) so the
 * media frame keeps its real shape instead of resizing after the bitmap lands. */
const mediaRatios = new Map<string, number>();
function clampRatio(w: number, h: number) {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, w / h));
}

interface Props {
  item: FeedItem;
  isOwner?: boolean;
  canManage?: boolean;
  onPress?: () => void;
  onComment?: () => void;
  onReact?: (r: ReactionKey) => void;
  onSave?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPollVote?: (optionId: string, withdraw: boolean) => Promise<Poll>;
  onPollChange?: (poll: Poll) => void;
  onClosePoll?: () => void;
  onReport?: () => void;
}

function compact(n: number): string {
  if (n <= 0) return "";
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

function fmtSize(bytes?: number | null): string {
  if (!bytes) return "Document";
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Video attachment — feed-authorized source, native controls. */
function VideoAttachment({ mediaId }: { mediaId: string }) {
  const { apiClient } = useSession();
  const [uri, setUri] = useState<string | null>(() =>
    peekFeedMediaUrl(mediaId),
  );
  useEffect(() => {
    let cancelled = false;
    getFeedMediaUrl(apiClient, mediaId)
      .then((u) => !cancelled && setUri(u))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [apiClient, mediaId]);
  const player = useVideoPlayer(uri);
  return (
    <VideoView
      player={player}
      style={styles.video}
      contentFit="contain"
      nativeControls
      accessibilityLabel="Post video"
    />
  );
}

function DocumentChip({ attachment }: { attachment: MediaAttachment }) {
  const theme = useTheme();
  return (
    <View
      style={[styles.docChip, { backgroundColor: theme.backgroundElement }]}
      accessibilityLabel={`Document attachment, ${fmtSize(attachment.sizeBytes)}`}
    >
      <Ionicons
        name="document-text-outline"
        size={22}
        color={BrandColors.primary}
      />
      <ThemedText style={styles.docText} themeColor="textSecondary">
        {fmtSize(attachment.sizeBytes)}
      </ThemedText>
    </View>
  );
}

/** Kind-aware media: image gallery, video player, audio player, document chip. */
export function PostMedia({
  media,
  onImagePress,
}: {
  media: MediaAttachment[];
  /** When set, image taps call this instead of opening the photo viewer. */
  onImagePress?: (index: number) => void;
}) {
  const { apiClient } = useSession();
  const images = media.filter((m) => m.purpose === "FEED_IMAGE");
  const others = media.filter((m) => m.purpose !== "FEED_IMAGE");
  const firstImageId = images.length === 1 ? images[0].id : null;
  // aspectRatio keeps the frame at the photo's real shape from the first
  // layout — no measure pass, no post-load resize. Cached ratios (persisted
  // across mounts) make revisits flicker-free; onDimensions corrects the rest.
  const [ratio, setRatio] = useState(
    () => (firstImageId ? mediaRatios.get(firstImageId) : undefined) ?? 4 / 5,
  );
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const onDimensions = (w: number, h: number) => {
    const r = clampRatio(w, h);
    if (firstImageId) mediaRatios.set(firstImageId, r);
    setRatio(r);
  };
  const resolveViewer = useCallback(
    (id: string) => getFeedMediaUrl(apiClient, id),
    [apiClient],
  );
  const refreshViewer = useCallback(
    (id: string) => refreshFeedMediaUrl(apiClient, id),
    [apiClient],
  );
  const pressImage = useCallback(
    (i: number) => (onImagePress ? onImagePress(i) : setViewerIndex(i)),
    [onImagePress],
  );

  return (
    <>
      {images.length === 1 && (
        <View style={styles.mediaWrap}>
          <Pressable
            onPress={() => pressImage(0)}
            accessibilityRole="imagebutton"
            accessibilityLabel={
              onImagePress ? "Open post" : "View photo full screen"
            }
          >
            <MediaImage
              mediaId={images[0].id}
              feed
              onDimensions={onDimensions}
              style={{
                width: "100%",
                aspectRatio: ratio,
                maxHeight: MEDIA_MAX_HEIGHT,
                borderRadius: MEDIA_RADIUS,
              }}
            />
          </Pressable>
        </View>
      )}
      {images.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.gallery}
          contentContainerStyle={styles.galleryContent}
        >
          {images.map((m, i) => (
            <Pressable
              key={m.id}
              onPress={() => pressImage(i)}
              accessibilityRole="imagebutton"
              accessibilityLabel={
                onImagePress
                  ? "Open post"
                  : `View photo ${i + 1} of ${images.length}`
              }
            >
              <MediaImage mediaId={m.id} feed style={styles.galleryItem} />
            </Pressable>
          ))}
        </ScrollView>
      )}
      <PhotoViewerModal
        visible={viewerIndex !== null}
        mediaIds={images.map((m) => m.id)}
        resolve={resolveViewer}
        refresh={refreshViewer}
        initialIndex={viewerIndex ?? 0}
        onClose={() => setViewerIndex(null)}
      />
      {others.map((m) =>
        m.purpose === "FEED_AUDIO" ? (
          <AudioAttachment
            key={m.id}
            mediaId={m.id}
            durationMs={m.durationMs}
          />
        ) : m.purpose === "FEED_VIDEO" ? (
          <VideoAttachment key={m.id} mediaId={m.id} />
        ) : (
          <DocumentChip key={m.id} attachment={m} />
        ),
      )}
    </>
  );
}

export const PostItem = React.memo(function PostItem({
  item,
  isOwner = false,
  canManage = isOwner,
  onPress,
  onComment,
  onReact,
  onSave,
  onEdit,
  onDelete,
  onPollVote,
  onPollChange,
  onClosePoll,
  onReport,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const moreRef = useRef<React.ComponentRef<typeof Pressable>>(null);
  const { width: winW, height: winH } = useWindowDimensions();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const theme = useTheme();
  const typeLabel = TYPE_LABEL[item.contentType];
  const helpKind = item.payload?.helpKind as string | undefined;
  const helpStatus = item.payload?.helpStatus as string | undefined;
  const categoryName = item.payload?.categoryName as string | undefined;
  const isPoll = item.contentType === "POLL";
  const poll = isPoll ? item.payload.poll : undefined;
  const typeIcon = TYPE_ICON[item.contentType];
  const handle = item.author?.username ?? item.author?.displayName ?? "member";
  const reacted = !!item.viewerReaction;

  const share = () => {
    void Share.share({
      message: item.body
        ? `${item.body.slice(0, 140)}`
        : "Check this out on Diasporum",
    });
  };
  const closeMenu = () => {
    setMenuOpen(false);
    setConfirmDelete(false);
    setConfirmClose(false);
  };
  const openMenu = () => {
    // Fallback position — refined by measureInWindow the same frame it returns
    setMenuPos({ top: Math.max(8, winH * 0.3), left: Math.max(8, winW - 208) });
    setMenuOpen(true);
    moreRef.current?.measureInWindow?.(
      (x: number, y: number, w: number, h: number) => {
        const MENU_W = 200;
        const MENU_H = 240;
        const left = Math.min(Math.max(8, x + w - MENU_W), winW - MENU_W - 8);
        const below = y + h + 4;
        const top = below + MENU_H > winH ? Math.max(8, y - MENU_H - 4) : below;
        setMenuPos({ top, left });
      },
    );
  };

  return (
    <Pressable
      onPress={isPoll ? undefined : onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: isPoll ? theme.primarySurface : theme.background,
          borderColor: isPoll ? theme.primaryLight : theme.border,
        },
        pressed && styles.cardPressed,
      ]}
      testID={isPoll ? "poll-post-card" : "post-card"}
      accessibilityRole={isPoll ? undefined : "button"}
    >
      {/* Avatar column */}
      <View style={styles.avatarCol}>
        <Avatar
          name={item.author?.displayName}
          mediaId={item.author?.avatarMediaId}
          userId={item.author?.id}
          size={42}
        />
      </View>

      {/* Content column */}
      <View style={styles.body}>
        {/* Header: username · time … ··· */}
        <View style={styles.header}>
          <ThemedText style={styles.name} numberOfLines={1}>
            {handle}
          </ThemedText>
          <ThemedText style={styles.time} themeColor="textSecondary">
            {timeAgo(item.publishedAt)}
          </ThemedText>
          {categoryName ? (
            <ThemedText
              style={styles.category}
              themeColor="textSecondary"
              numberOfLines={1}
            >
              · {categoryName}
            </ThemedText>
          ) : null}
          <Pressable
            ref={moreRef}
            onPress={() => (menuOpen ? closeMenu() : openMenu())}
            hitSlop={10}
            accessibilityLabel="Post options"
            accessibilityRole="button"
            style={styles.moreBtn}
          >
            <Ionicons
              name="ellipsis-horizontal"
              size={20}
              color={theme.textSecondary}
            />
          </Pressable>
        </View>

        {/* Type badge gives special content a clear visual identity. */}
        {typeLabel ? (
          <View
            style={[
              styles.typeBadge,
              {
                backgroundColor: isPoll
                  ? BrandColors.primary
                  : theme.primarySurface,
              },
            ]}
          >
            {typeIcon ? (
              <Ionicons
                name={typeIcon}
                size={13}
                color={isPoll ? BrandColors.white : theme.primary}
              />
            ) : null}
            <ThemedText
              style={[
                styles.typeLabel,
                { color: isPoll ? BrandColors.white : theme.primary },
              ]}
            >
              {typeLabel}
              {helpKind
                ? ` · ${helpKind === "REQUEST" ? "Requesting help" : "Offering help"}`
                : ""}
              {helpStatus && helpStatus !== "OPEN"
                ? ` · ${helpStatus.toLowerCase()}`
                : ""}
            </ThemedText>
          </View>
        ) : null}

        {/* Title + body */}
        {item.title ? (
          <ThemedText style={styles.title} numberOfLines={3}>
            {item.title}
          </ThemedText>
        ) : null}
        {item.body && !poll ? (
          <HashtagText body={item.body} style={styles.text} />
        ) : null}
        {poll ? (
          <PollCard poll={poll} onVote={onPollVote} onChange={onPollChange} />
        ) : null}

        {/* Media — kind-aware: images, video, audio, documents */}
        {item.media.length > 0 ? (
          <PostMedia media={item.media} onImagePress={onPress} />
        ) : item.mediaIds.length > 0 ? (
          <PostMedia
            media={item.mediaIds.map((id) => ({
              id,
              purpose: "FEED_IMAGE",
              mimeType: null,
              durationMs: null,
              sizeBytes: null,
            }))}
            onImagePress={onPress}
          />
        ) : null}

        {/* Tag chips — explicit tags that may not appear in the body text */}
        {item.tags.length > 0 && (
          <View style={styles.tagRow}>
            {item.tags.map((t) => (
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

        {/* Overflow menu — anchored to the ⋯ button via a transparent modal */}
        <Modal
          visible={menuOpen}
          transparent
          animationType="fade"
          statusBarTranslucent
          onRequestClose={closeMenu}
        >
          <Pressable
            style={styles.menuBackdrop}
            onPress={closeMenu}
            accessibilityLabel="Close menu"
          />
          <View
            style={[
              styles.menu,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
                top: menuPos.top,
                left: menuPos.left,
              },
            ]}
          >
            {confirmDelete || confirmClose ? (
              <>
                <ThemedText style={styles.confirmText}>
                  {confirmClose
                    ? "Close this poll? This cannot be undone."
                    : "Delete this post?"}
                </ThemedText>
                <View style={styles.confirmRow}>
                  <Pressable
                    onPress={closeMenu}
                    style={styles.confirmBtn}
                    accessibilityLabel={
                      confirmClose ? "Cancel close" : "Cancel delete"
                    }
                  >
                    <ThemedText style={{ color: theme.textSecondary }}>
                      Cancel
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      closeMenu();
                      if (confirmClose) onClosePoll?.();
                      else onDelete?.();
                    }}
                    style={[styles.confirmBtn, styles.deleteBtn]}
                    accessibilityLabel={
                      confirmClose ? "Confirm close poll" : "Confirm delete"
                    }
                  >
                    <ThemedText style={styles.deleteBtnText}>
                      {confirmClose ? "Close poll" : "Delete"}
                    </ThemedText>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Pressable
                  onPress={() => {
                    closeMenu();
                    onSave?.();
                  }}
                  style={styles.menuItem}
                  accessibilityLabel="Save post"
                >
                  <Ionicons
                    name={item.saved ? "bookmark" : "bookmark-outline"}
                    size={18}
                    color={theme.text}
                  />
                  <ThemedText style={styles.menuText}>
                    {item.saved ? "Unsave" : "Save"}
                  </ThemedText>
                </Pressable>
                {canManage && onEdit ? (
                  <Pressable
                    onPress={() => {
                      closeMenu();
                      onEdit();
                    }}
                    style={styles.menuItem}
                    accessibilityLabel="Edit post"
                  >
                    <Ionicons
                      name="create-outline"
                      size={18}
                      color={theme.text}
                    />
                    <ThemedText style={styles.menuText}>Edit</ThemedText>
                  </Pressable>
                ) : null}
                {canManage && onDelete ? (
                  <Pressable
                    onPress={() => setConfirmDelete(true)}
                    style={styles.menuItem}
                    accessibilityLabel="Delete post"
                  >
                    <Ionicons
                      name="trash-outline"
                      size={18}
                      color={theme.error}
                    />
                    <ThemedText
                      style={[styles.menuText, { color: theme.error }]}
                    >
                      Delete
                    </ThemedText>
                  </Pressable>
                ) : null}
                {canManage && poll?.status === "ACTIVE" && onClosePoll ? (
                  <Pressable
                    onPress={() => setConfirmClose(true)}
                    style={styles.menuItem}
                    accessibilityLabel="Close poll"
                  >
                    <Ionicons
                      name="lock-closed-outline"
                      size={18}
                      color={theme.text}
                    />
                    <ThemedText style={styles.menuText}>Close poll</ThemedText>
                  </Pressable>
                ) : null}
                {!isOwner && item.contentType === "POLL" && onReport ? (
                  <Pressable
                    onPress={() => {
                      closeMenu();
                      onReport();
                    }}
                    style={styles.menuItem}
                    accessibilityLabel="Report poll"
                  >
                    <Ionicons
                      name="flag-outline"
                      size={18}
                      color={theme.error}
                    />
                    <ThemedText
                      style={[styles.menuText, { color: theme.error }]}
                    >
                      Report
                    </ThemedText>
                  </Pressable>
                ) : null}
              </>
            )}
          </View>
        </Modal>

        {/* Polls are voting surfaces, not discussion/reaction posts. */}
        <View style={[styles.actions, isPoll && styles.pollActions]}>
          {!isPoll ? (
            <>
              <Pressable
                onPress={() => onReact?.("LIKE")}
                style={({ pressed }) => [
                  styles.action,
                  pressed && styles.actionPressed,
                ]}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={reacted ? "Unlike" : "Like"}
              >
                <Ionicons
                  name={reacted ? "heart" : "heart-outline"}
                  size={22}
                  color={reacted ? LIKE_COLOR : theme.textSecondary}
                />
                <ThemedText
                  style={[
                    styles.count,
                    { color: reacted ? LIKE_COLOR : theme.textSecondary },
                  ]}
                >
                  {compact(item.reactionCount)}
                </ThemedText>
              </Pressable>

              <Pressable
                onPress={onComment}
                style={({ pressed }) => [
                  styles.action,
                  pressed && styles.actionPressed,
                ]}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`${item.commentCount} replies`}
              >
                <Ionicons
                  name="chatbubble-outline"
                  size={21}
                  color={theme.textSecondary}
                />
                <ThemedText
                  style={[styles.count, { color: theme.textSecondary }]}
                >
                  {compact(item.commentCount)}
                </ThemedText>
              </Pressable>
            </>
          ) : null}

          <Pressable
            onPress={share}
            style={({ pressed }) => [
              styles.action,
              isPoll && styles.pollAction,
              pressed && styles.actionPressed,
            ]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Share post"
          >
            <Ionicons
              name="paper-plane-outline"
              size={20}
              color={theme.textSecondary}
            />
            {isPoll ? (
              <ThemedText
                style={[styles.count, { color: theme.textSecondary }]}
              >
                Share
              </ThemedText>
            ) : null}
          </Pressable>

          <Pressable
            onPress={onSave}
            style={({ pressed }) => [
              styles.action,
              styles.saveAction,
              isPoll && styles.pollAction,
              pressed && styles.actionPressed,
            ]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={item.saved ? "Unsave post" : "Save post"}
          >
            <Ionicons
              name={item.saved ? "bookmark" : "bookmark-outline"}
              size={20}
              color={item.saved ? theme.primary : theme.textSecondary}
            />
            {isPoll ? (
              <ThemedText
                style={[
                  styles.count,
                  { color: item.saved ? theme.primary : theme.textSecondary },
                ]}
              >
                {item.saved ? "Saved" : "Save"}
              </ThemedText>
            ) : null}
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: 12,
    width: "97%",
    maxWidth: 720,
    alignSelf: "center",
    marginTop: 12,
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.xl,
    shadowColor: BrandColors.black,
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  cardPressed: { opacity: 0.96, transform: [{ scale: 0.995 }] },
  avatarCol: { width: 42, flexShrink: 0, paddingTop: 1 },
  body: { flex: 1, minWidth: 0, gap: 4 },
  header: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 24 },
  name: { fontSize: 15, fontWeight: "700", lineHeight: 21, flexShrink: 1 },
  time: { fontSize: 13, fontWeight: "400", lineHeight: 20 },
  category: { fontSize: 12, fontWeight: "400", lineHeight: 20, flexShrink: 1 },
  moreBtn: { marginLeft: "auto", paddingLeft: 8 },
  typeBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    marginTop: 2,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: BorderRadius.full,
  },
  typeLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
    lineHeight: 14,
  },
  title: { fontSize: 17, fontWeight: "700", lineHeight: 24, marginTop: 3 },
  text: { fontSize: 15, fontWeight: "400", lineHeight: 23 },
  mediaWrap: { marginTop: 10, width: "100%" },
  video: {
    marginTop: 10,
    width: "100%",
    height: MEDIA_MAX_HEIGHT,
    borderRadius: MEDIA_RADIUS,
    backgroundColor: "#000",
  },
  docChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    alignSelf: "flex-start",
    borderRadius: BorderRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  docText: { fontSize: 13, fontWeight: "500" },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  tag: { fontSize: 14, fontWeight: "600", color: BrandColors.primary },
  gallery: { marginTop: 10, marginRight: -Spacing.two },
  galleryContent: { gap: 8, paddingRight: Spacing.two },
  galleryItem: {
    width: 200,
    height: 250,
    aspectRatio: undefined,
    borderRadius: MEDIA_RADIUS,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
    marginTop: 8,
    marginLeft: -4,
    paddingTop: 4,
  },
  pollActions: { gap: 8, marginLeft: 0 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 4,
    borderRadius: BorderRadius.full,
  },
  pollAction: { paddingHorizontal: 10 },
  saveAction: { marginLeft: "auto" },
  actionPressed: { opacity: 0.55 },
  count: { fontSize: 13, fontWeight: "600", lineHeight: 18 },
  menuBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  menu: {
    position: "absolute",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.md,
    paddingVertical: 4,
    minWidth: 190,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 8,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
  },
  menuText: { fontSize: 15, fontWeight: "500" },
  confirmText: {
    fontSize: 14,
    fontWeight: "600",
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
  },
  confirmRow: {
    flexDirection: "row",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: 6,
  },
  confirmBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: BorderRadius.sm,
  },
  deleteBtn: { backgroundColor: BrandColors.error },
  deleteBtnText: { color: "#FFFFFF", fontWeight: "600" },
});
