/**
 * PostItem — Threads-style timeline post.
 * Avatar column · bold username · muted time · ··· overflow. 16pt body,
 * rounded media sized to the photo's real aspect ratio, and a line-icon
 * action row: ♡ n · 💬 n · ➤ share · 🔖 save. Hairline separator only.
 */

import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type { FeedItem, Poll, ReactionKey } from "../types/feed-types";
import { timeAgo } from "../utils/time-ago";
import { Avatar } from "./avatar";
import { MediaImage } from "./media-image";
import { PollCard } from "./poll-card";

const TYPE_LABEL: Record<string, string> = {
  ANNOUNCEMENT: "Announcement",
  COMMUNITY_HELP: "Community help",
  POLL: "Poll",
  REEL: "Video",
};

const LIKE_COLOR = "#FF3040";
const MEDIA_RADIUS = 12;
const MEDIA_MAX_HEIGHT = 320;
const MIN_RATIO = 0.56; // 9:16 portrait
const MAX_RATIO = 1.91; // wide landscape

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

/** Single image sized to its natural ratio (height-capped); several images scroll horizontally. */
function PostMedia({ mediaIds }: { mediaIds: string[] }) {
  const [colWidth, setColWidth] = useState(0);
  const [ratio, setRatio] = useState(4 / 5);
  const onDimensions = useCallback((w: number, h: number) => {
    setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, w / h)));
  }, []);

  if (mediaIds.length === 1) {
    const height = Math.min(
      MEDIA_MAX_HEIGHT,
      colWidth > 0 ? colWidth / ratio : MEDIA_MAX_HEIGHT,
    );
    const width = Math.min(colWidth || 0, height * ratio);
    return (
      <View
        style={styles.mediaWrap}
        onLayout={(e) => setColWidth(e.nativeEvent.layout.width)}
      >
        {colWidth > 0 && (
          <MediaImage
            mediaId={mediaIds[0]}
            onDimensions={onDimensions}
            style={{
              width,
              height,
              aspectRatio: undefined,
              borderRadius: MEDIA_RADIUS,
            }}
          />
        )}
      </View>
    );
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.gallery}
      contentContainerStyle={styles.galleryContent}
    >
      {mediaIds.map((id) => (
        <MediaImage key={id} mediaId={id} style={styles.galleryItem} />
      ))}
    </ScrollView>
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const theme = useTheme();
  const typeLabel = TYPE_LABEL[item.contentType];
  const helpKind = item.payload?.helpKind as string | undefined;
  const helpStatus = item.payload?.helpStatus as string | undefined;
  const categoryName = item.payload?.categoryName as string | undefined;
  const poll = item.contentType === "POLL" ? item.payload.poll : undefined;
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

  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, { borderBottomColor: theme.border }]}
      accessibilityRole="button"
    >
      {/* Avatar column */}
      <View style={styles.avatarCol}>
        <Avatar
          name={item.author?.displayName}
          mediaId={item.author?.avatarMediaId}
          size={40}
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
            onPress={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
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

        {/* Type label (announcement / poll / help) */}
        {typeLabel ? (
          <ThemedText
            style={[styles.typeLabel, { color: BrandColors.primary }]}
          >
            {typeLabel}
            {helpKind
              ? ` · ${helpKind === "REQUEST" ? "Requesting help" : "Offering help"}`
              : ""}
            {helpStatus && helpStatus !== "OPEN"
              ? ` · ${helpStatus.toLowerCase()}`
              : ""}
          </ThemedText>
        ) : null}

        {/* Title + body */}
        {item.title ? (
          <ThemedText style={styles.title} numberOfLines={3}>
            {item.title}
          </ThemedText>
        ) : null}
        {item.body && !poll ? (
          <ThemedText style={styles.text}>{item.body}</ThemedText>
        ) : null}
        {poll ? (
          <PollCard poll={poll} onVote={onPollVote} onChange={onPollChange} />
        ) : null}

        {/* Media */}
        {item.mediaIds.length > 0 && <PostMedia mediaIds={item.mediaIds} />}

        {/* Overflow menu */}
        {menuOpen && (
          <View
            style={[
              styles.menu,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
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
                    accessibilityLabel={confirmClose ? "Cancel close" : "Cancel delete"}
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
                    accessibilityLabel={confirmClose ? "Confirm close poll" : "Confirm delete"}
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
                    <Ionicons name="lock-closed-outline" size={18} color={theme.text} />
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
                    <Ionicons name="flag-outline" size={18} color={theme.error} />
                    <ThemedText style={[styles.menuText, { color: theme.error }]}>
                      Report
                    </ThemedText>
                  </Pressable>
                ) : null}
              </>
            )}
          </View>
        )}

        {/* Action row: ♡ n · 💬 n · ➤ · 🔖 */}
        <View style={styles.actions}>
          <Pressable
            onPress={() => onReact?.("LIKE")}
            style={styles.action}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={reacted ? "Unlike" : "Like"}
          >
            <Ionicons
              name={reacted ? "heart" : "heart-outline"}
              size={24}
              color={reacted ? LIKE_COLOR : theme.text}
            />
            <ThemedText
              style={[styles.count, reacted && { color: LIKE_COLOR }]}
            >
              {compact(item.reactionCount)}
            </ThemedText>
          </Pressable>

          <Pressable
            onPress={onComment}
            style={styles.action}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${item.commentCount} replies`}
          >
            <Ionicons name="chatbubble-outline" size={22} color={theme.text} />
            <ThemedText style={styles.count}>
              {compact(item.commentCount)}
            </ThemedText>
          </Pressable>

          <Pressable
            onPress={share}
            style={styles.action}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Share post"
          >
            <Ionicons name="paper-plane-outline" size={22} color={theme.text} />
          </Pressable>

          <Pressable
            onPress={onSave}
            style={styles.action}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={item.saved ? "Unsave post" : "Save post"}
          >
            <Ionicons
              name={item.saved ? "bookmark" : "bookmark-outline"}
              size={22}
              color={item.saved ? BrandColors.primary : theme.text}
            />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: Spacing.three,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatarCol: { width: 40, flexShrink: 0, paddingTop: 2 },
  body: { flex: 1, minWidth: 0, gap: 2 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  name: { fontSize: 16, fontWeight: "700", lineHeight: 22, flexShrink: 1 },
  time: { fontSize: 15, fontWeight: "400", lineHeight: 22 },
  category: { fontSize: 14, fontWeight: "400", lineHeight: 22, flexShrink: 1 },
  moreBtn: { marginLeft: "auto", paddingLeft: 8 },
  typeLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 2,
  },
  title: { fontSize: 16, fontWeight: "600", lineHeight: 22, marginTop: 2 },
  text: { fontSize: 16, fontWeight: "400", lineHeight: 22 },
  mediaWrap: { marginTop: 10, width: "100%" },
  gallery: { marginTop: 10, marginRight: -Spacing.three },
  galleryContent: { gap: 8, paddingRight: Spacing.three },
  galleryItem: {
    width: 200,
    height: 250,
    aspectRatio: undefined,
    borderRadius: MEDIA_RADIUS,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 26,
    marginTop: 12,
    marginLeft: -2,
  },
  action: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 28 },
  count: { fontSize: 15, fontWeight: "400", lineHeight: 20 },
  menu: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.two,
    paddingVertical: 4,
    alignSelf: "flex-start",
    minWidth: 160,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
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
