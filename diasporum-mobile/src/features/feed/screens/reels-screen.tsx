/**
 * ReelsScreen — full-screen vertical short-video feed (route: /(app)/reels).
 * REEL posts only. Community mode: /feed/reels/community. Following: filtered
 * followingFeed. Playback URLs resolve through the parent-authorized
 * POST /feed/media/{id}/download-url endpoint — the generic /media/{id}
 * endpoint is owner-scoped and would 403 for every non-author viewer.
 * expo-video: one active player at a time, pause on scroll/blur.
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { ReelPlayer } from "../components/reel-player";
import { createReelPlayback, type ReelPlayback } from "../utils/reel-playback";
import PostDetailScreen from "./post-detail-screen";
import { ApiError } from "@/core/api/api-error";
import { StatusBar } from "expo-status-bar";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Avatar } from "../components/avatar";
import { useReels } from "../hooks/use-reels";
import { useSession } from "@/core/session/session-provider";
import { createFeedApi } from "../services/feed-api";
import { createSocialApi } from "@/features/profile/services/social-api";
import type { ApiClient } from "@/core/api/api-client";
import { BrandColors } from "@/shared/theme/colors";
import { Spacing } from "@/shared/theme/spacing";
import type { FeedItem } from "../types/feed-types";
import { timeAgo } from "../utils/time-ago";

import { getFeedMediaUrl, refreshFeedMediaUrl } from "../utils/media-cache";

const DOUBLE_TAP_MS = 260;
const TEXT_SHADOW = {
  textShadowColor: "rgba(0,0,0,0.75)",
  textShadowRadius: 6,
  textShadowOffset: { width: 0, height: 1 },
} as const;

/** Cheap scrim: stacked translucent bands that read as a gradient. */
function Scrim({ steps, style }: { steps: number[]; style?: object }) {
  return (
    <View style={style} pointerEvents="none">
      {steps.map((o) => (
        <View key={o} style={[styles.scrimStep, { opacity: o }]} />
      ))}
    </View>
  );
}

// ---- Individual reel item ----

export function ReelItem({
  item,
  active,
  shouldLoad,
  height,
  apiClient,
  muted,
  toggleMute,
  playback,
  updateItem,
  onComments,
  onExpand,
  onViewed,
  captionExpanded,
  actionLocks,
}: {
  item: FeedItem;
  active: boolean;
  shouldLoad: boolean;
  height: number;
  apiClient: ApiClient;
  muted: boolean;
  toggleMute: () => void;
  playback: ReelPlayback;
  captionExpanded: boolean;
  actionLocks: Set<string>;
  updateItem: (id: string, patch: Partial<FeedItem>) => void;
  onComments: (item: FeedItem) => void;
  onExpand: (expanded: boolean) => void;
  onViewed: (id: string) => void;
}) {
  const router = useRouter();
  const { session } = useSession();
  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failedState, setFailed] = useState(false);
  const retryUsed = useRef(false);
  const retryInFlight = useRef(false);
  const request = useRef(0);
  const [initialTime, setInitialTime] = useState(0);
  const [playerGeneration, setPlayerGeneration] = useState(0);
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const [overflows, setOverflows] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const pending = useRef(new Set<string>());
  const [pendingActions, setPendingActions] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const mutationVersion = useRef(0);
  const liked = item.viewerReaction != null;
  const saved = item.saved;
  const shareCount = item.shareCount;
  const [following, setFollowing] = useState<boolean | null>(null);
  const feedApi = React.useMemo(() => createFeedApi(apiClient), [apiClient]);
  const socialApi = React.useMemo(
    () => createSocialApi(apiClient),
    [apiClient],
  );
  const mediaId = item.mediaIds[0];
  const authorId = item.author?.id;
  const isOwn = authorId != null && authorId === session?.me.id;

  const recordViewed = useCallback(
    () => onViewed(item.sourceId),
    [onViewed, item.sourceId],
  );

  // useState initializer keeps the stable Animated.Value out of useRef (react-hooks/refs)
  const [likeAnim] = useState(() => new Animated.Value(0));
  const lastTapRef = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Items are filtered to REEL+video upstream; no mediaId is a render-time failure
  const failed = failedState || !mediaId;

  // Fetch signed URL via expiry-aware cache (feed parent-authorized endpoint)
  useEffect(() => {
    if (!shouldLoad || !mediaId) return;
    const token = ++request.current;
    // A newly eligible neighbor must acquire a fresh URL before mounting its player.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getFeedMediaUrl(apiClient, mediaId)
      .then((u) => {
        if (request.current === token) {
          setUri(u);
          setFailed(false);
          setLoading(false);
        }
      })
      .catch(() => {
        if (request.current === token) {
          setFailed(true);
          setLoading(false);
        }
      });
    return () => {
      // This is a request generation counter, not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++request.current;
      retryInFlight.current = false;
    };
  }, [apiClient, mediaId, shouldLoad]);

  // Retry once with fresh URL on playback failure (expired signed URL)
  const handlePlaybackError = useCallback(
    (position: number) => {
      if (retryInFlight.current) return;
      setInitialTime(Number.isFinite(position) ? Math.max(0, position) : 0);
      if (retryUsed.current || !mediaId) {
        setFailed(true);
        return;
      }
      retryUsed.current = true;
      retryInFlight.current = true;
      const token = ++request.current;
      setFailed(false);
      setLoading(true);
      refreshFeedMediaUrl(apiClient, mediaId)
        .then((u) => {
          if (request.current === token) {
            setUri(u);
            setPlayerGeneration((g) => g + 1);
            setLoading(false);
            setFailed(false);
          }
        })
        .catch(() => {
          if (request.current === token) {
            setFailed(true);
            setLoading(false);
          }
        })
        .finally(() => {
          if (request.current === token) retryInFlight.current = false;
        });
    },
    [apiClient, mediaId],
  );

  useEffect(() => {
    if (!active) {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      lastTapRef.current = 0;
    }
  }, [active]);

  // Clear pending single-tap timer on unmount
  useEffect(
    () => () => {
      if (tapTimer.current) clearTimeout(tapTimer.current);
    },
    [],
  );

  // Follow state (only for other authors)
  useEffect(() => {
    if (!active || !authorId || isOwn) return;
    let cancelled = false;
    const version = mutationVersion.current;
    socialApi
      .relationship(authorId)
      .then((r) => {
        if (
          !cancelled &&
          version === mutationVersion.current &&
          !pending.current.has("follow")
        )
          setFollowing(r.following);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [socialApi, authorId, isOwn, active]);

  useEffect(() => {
    if (
      !active ||
      [...actionLocks].some((key) => key.startsWith(`${item.sourceId}:`))
    )
      return;
    let cancelled = false;
    const version = mutationVersion.current;
    feedApi
      .getPost(item.sourceId)
      .then((detail) => {
        if (
          !cancelled &&
          version === mutationVersion.current &&
          pending.current.size === 0
        )
          updateItem(item.sourceId, {
            saved: detail.saved,
            viewerReaction: detail.viewerReaction,
            reactionCount: detail.post.reactionCount,
            commentCount: detail.post.commentCount,
            shareCount: detail.post.shareCount,
          });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active, feedApi, item.sourceId, updateItem, actionLocks]);

  const authorName = item.author?.displayName ?? "Diasporum member";
  const authorUsername = item.author?.username ?? "member";
  const caption = [
    item.title,
    item.body,
    item.tags
      .filter(
        (tag) => !item.body?.toLowerCase().includes(`#${tag.toLowerCase()}`),
      )
      .map((tag) => `#${tag}`)
      .join(" "),
  ]
    .filter(Boolean)
    .join("\n");
  const durMs = item.media?.[0]?.durationMs;
  const durLabel = durMs
    ? ` · ${Math.floor(durMs / 60000)}:${String(Math.round(durMs / 1000) % 60).padStart(2, "0")}`
    : "";

  function togglePlay() {
    setPaused((p) => !p);
  }

  async function action(
    key: string,
    run: () => Promise<unknown>,
    rollback?: () => void,
  ) {
    const lock = `${item.sourceId}:${key}`;
    if (actionLocks.has(lock)) return;
    actionLocks.add(lock);
    ++mutationVersion.current;
    pending.current.add(key);
    setPendingActions([...pending.current]);
    setActionError(null);
    try {
      await run();
    } catch (error) {
      rollback?.();
      setActionError(
        ApiError.isApiError(error)
          ? error.userMessage
          : "Action failed. Please try again.",
      );
    } finally {
      actionLocks.delete(lock);
      pending.current.delete(key);
      setPendingActions([...pending.current]);
    }
  }

  function toggleLike() {
    void action(
      "like",
      async () => {
        updateItem(item.sourceId, {
          viewerReaction: liked ? null : "LIKE",
          reactionCount: Math.max(0, item.reactionCount + (liked ? -1 : 1)),
        });
        await (liked
          ? feedApi.unreact(item.sourceId)
          : feedApi.react(item.sourceId, "LIKE"));
      },
      () =>
        updateItem(item.sourceId, {
          viewerReaction: item.viewerReaction,
          reactionCount: item.reactionCount,
        }),
    );
  }

  function toggleSave() {
    void action(
      "save",
      async () => {
        updateItem(item.sourceId, { saved: !saved });
        await (saved
          ? feedApi.unsave(item.sourceId)
          : feedApi.save(item.sourceId));
      },
      () => updateItem(item.sourceId, { saved }),
    );
  }

  // Native share sheet + recorded share event → feed_posts.share_count
  function share() {
    void action("share", async () => {
      const url = Linking.createURL(`/posts/${item.sourceId}`, {
        scheme: "diasporummobile",
      });
      const result = await Share.share({
        message: `${caption.slice(0, 140) || "Watch this Reel on Diasporum"}\n${url}`,
      });
      if (result.action !== Share.sharedAction) return;
      try {
        const result = await feedApi.sharePost(item.sourceId, "SYSTEM_SHARE");
        updateItem(item.sourceId, { shareCount: result.shareCount });
      } catch {
        /* Sharing succeeded; analytics failure must not invite a duplicate share. */
      }
    });
  }

  function toggleFollow() {
    if (following === null || !authorId) return;
    void action(
      "follow",
      async () => {
        setFollowing(!following);
        await (following
          ? socialApi.unfollow(authorId)
          : socialApi.follow(authorId));
      },
      () => setFollowing(following),
    );
  }

  // Heart burst on double-tap; like only if not already liked
  function burst() {
    likeAnim.setValue(0);
    Animated.sequence([
      Animated.spring(likeAnim, {
        toValue: 1,
        useNativeDriver: true,
        speed: 22,
        bounciness: 10,
      }),
      Animated.timing(likeAnim, {
        toValue: 0,
        delay: 380,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
    if (!liked) toggleLike();
  }

  // Single tap = play/pause (after a short delay); double tap = like
  function handleTap() {
    if (!active) return;
    if (Platform.OS === "web") {
      togglePlay();
      return;
    }
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      if (tapTimer.current) {
        clearTimeout(tapTimer.current);
        tapTimer.current = null;
      }
      lastTapRef.current = 0;
      burst();
    } else {
      lastTapRef.current = now;
      tapTimer.current = setTimeout(() => {
        tapTimer.current = null;
        togglePlay();
      }, DOUBLE_TAP_MS);
    }
  }

  return (
    <View style={[styles.reel, { height }]}>
      {failed ? (
        <View style={styles.videoPlaceholder}>
          <Ionicons
            name="videocam-off-outline"
            size={52}
            color="rgba(255,255,255,0.5)"
          />
          <ThemedText style={styles.errorText}>
            Video unavailable or still processing
          </ThemedText>
          <Pressable
            style={styles.stateBtn}
            accessibilityRole="button"
            accessibilityLabel="Retry video"
            onPress={() => {
              retryUsed.current = false;
              handlePlaybackError(initialTime);
            }}
          >
            <ThemedText style={styles.stateBtnText}>Retry</ThemedText>
          </Pressable>
        </View>
      ) : loading || !uri || !shouldLoad ? (
        <View style={styles.videoPlaceholder}>
          <ActivityIndicator size="large" color="rgba(255,255,255,0.7)" />
        </View>
      ) : (
        <ReelPlayer
          key={`${uri}:${playerGeneration}`}
          id={item.sourceId}
          uri={uri}
          active={active}
          muted={muted}
          paused={paused}
          initialTime={initialTime}
          playback={playback}
          onTap={handleTap}
          onError={handlePlaybackError}
          onViewed={recordViewed}
        />
      )}

      {/* Double-tap heart burst */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.heartBurst,
          {
            opacity: likeAnim,
            transform: [
              {
                scale: likeAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.4, 1.15],
                }),
              },
            ],
          },
        ]}
      >
        <Ionicons name="heart" size={110} color="#fff" />
      </Animated.View>

      {/* Bottom scrim for overlay legibility */}
      <Scrim steps={[0.03, 0.08, 0.16, 0.28]} style={styles.scrimBottom} />

      {/* Right action rail */}
      <View
        style={[
          styles.actionRail,
          { bottom: insets.bottom + 24, gap: height < 600 ? 2 : 14 },
        ]}
      >
        <RailAction
          icon={liked ? "heart" : "heart-outline"}
          count={item.reactionCount}
          iconColor={liked ? "#FF3B5C" : "#fff"}
          onPress={toggleLike}
          label={liked ? "Unlike" : "Like"}
          selected={liked}
          disabled={pendingActions.includes("like")}
        />
        <RailAction
          icon="chatbubble-outline"
          count={item.commentCount}
          onPress={() => onComments(item)}
          label="Comments"
        />
        <RailAction
          icon="paper-plane-outline"
          count={shareCount}
          onPress={share}
          label="Share"
          disabled={pendingActions.includes("share")}
        />
        <RailAction
          icon={saved ? "bookmark" : "bookmark-outline"}
          iconColor={saved ? BrandColors.primaryLight : "#fff"}
          onPress={toggleSave}
          label={saved ? "Unsave" : "Save"}
          selected={saved}
          disabled={pendingActions.includes("save")}
        />
        <RailAction
          icon={muted ? "volume-mute" : "volume-high"}
          onPress={toggleMute}
          label={muted ? "Unmute" : "Mute"}
        />
      </View>

      {/* Bottom overlay — author + caption */}
      <View
        style={[
          styles.bottomOverlay,
          { bottom: insets.bottom },
          captionExpanded && styles.expandedOverlay,
        ]}
      >
        <View style={styles.authorRow}>
          <Avatar
            name={authorName}
            mediaId={item.author?.avatarMediaId}
            userId={item.author?.id}
            size={38}
          />
          <Pressable
            style={styles.authorText}
            accessibilityRole="link"
            accessibilityLabel={`View ${authorName}'s profile`}
            onPress={() =>
              authorId && router.push(`/(app)/people/${authorId}` as never)
            }
          >
            <ThemedText style={styles.authorName} numberOfLines={1}>
              {authorName}
            </ThemedText>
            <ThemedText style={styles.authorMeta} numberOfLines={1}>
              @{authorUsername} · {timeAgo(item.publishedAt)}
              {durLabel}
            </ThemedText>
          </Pressable>
          {!isOwn && following !== null && (
            <Pressable
              onPress={toggleFollow}
              disabled={pendingActions.includes("follow")}
              style={[styles.followBtn, following && styles.followingBtn]}
              accessibilityRole="button"
              accessibilityLabel={following ? "Unfollow" : "Follow"}
            >
              <ThemedText
                style={[
                  styles.followBtnText,
                  following && styles.followingBtnText,
                ]}
              >
                {following ? "Following" : "Follow"}
              </ThemedText>
            </Pressable>
          )}
        </View>
        {caption ? (
          <View>
            <View
              pointerEvents="none"
              style={styles.captionMeasure}
              aria-hidden
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <ThemedText
                testID={`reel-caption-measure-${item.sourceId}`}
                style={styles.caption}
                onTextLayout={(e) =>
                  setOverflows(e.nativeEvent.lines.length > 2)
                }
                onLayout={(e) =>
                  setOverflows(e.nativeEvent.layout.height > 40 * fontScale + 1)
                }
              >
                {caption}
              </ThemedText>
            </View>
            {captionExpanded ? (
              <ScrollView
                style={{ maxHeight: height * 0.42 }}
                nestedScrollEnabled
                accessibilityLabel="Full Reel description"
                showsVerticalScrollIndicator
              >
                <ThemedText style={styles.caption}>{caption}</ThemedText>
              </ScrollView>
            ) : (
              <ThemedText style={styles.caption} numberOfLines={2}>
                {caption}
              </ThemedText>
            )}
            {(overflows || captionExpanded) && (
              <Pressable
                style={styles.descriptionToggle}
                accessibilityRole="button"
                accessibilityLabel={
                  captionExpanded
                    ? "Show less description"
                    : "Show more description"
                }
                accessibilityState={{ expanded: captionExpanded }}
                onPress={() => {
                  onExpand(!captionExpanded);
                }}
              >
                <ThemedText style={styles.descriptionToggleText}>
                  {captionExpanded ? "Less" : "More"}
                </ThemedText>
              </Pressable>
            )}
          </View>
        ) : null}
        {actionError && (
          <Pressable
            onPress={() => setActionError(null)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss action error"
          >
            <ThemedText style={styles.actionError} accessibilityRole="alert">
              {actionError}
            </ThemedText>
          </Pressable>
        )}
      </View>
    </View>
  );
}

type RailIcon = React.ComponentProps<typeof Ionicons>["name"];

function RailAction({
  icon,
  count,
  iconColor,
  onPress,
  label,
  selected,
  disabled,
}: {
  icon: RailIcon;
  count?: number;
  iconColor?: string;
  onPress: () => void;
  label: string;
  selected?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={styles.railBtn}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled, busy: disabled }}
      accessibilityLabel={label}
    >
      <Ionicons
        name={icon}
        size={30}
        color={iconColor ?? "#fff"}
        style={TEXT_SHADOW}
      />
      {count !== undefined && (
        <ThemedText style={[styles.railCount, TEXT_SHADOW]}>{count}</ThemedText>
      )}
    </Pressable>
  );
}

// ---- State pages (loading / error / empty) ----

function StatePage({
  height,
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  height: number;
  icon: RailIcon;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={[styles.statePage, { height }]}>
      <Ionicons name={icon} size={56} color="rgba(255,255,255,0.4)" />
      <ThemedText style={styles.stateTitle}>{title}</ThemedText>
      {body ? <ThemedText style={styles.stateBody}>{body}</ThemedText> : null}
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={styles.stateBtn}
          accessibilityRole="button"
        >
          <ThemedText style={styles.stateBtnText}>{actionLabel}</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---- Main screen ----

export default function ReelsScreen() {
  const router = useRouter();
  const { apiClient } = useSession();
  const reels = useReels();
  const { height: windowHeight } = useWindowDimensions();
  const [screenH, setScreenH] = useState(windowHeight);
  const [selection, setSelection] = useState({ generation: 0, index: 0 });
  const activeIdx =
    selection.generation === reels.generation
      ? Math.min(selection.index, Math.max(0, reels.items.length - 1))
      : 0;
  const [focused, setFocused] = useState(false);
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  const [scrolling, setScrolling] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [comments, setComments] = useState<FeedItem | null>(null);
  const [muted, setMuted] = useState(false);
  const toggleMute = useCallback(() => setMuted((m) => !m), []);
  const [playback] = useState(createReelPlayback);
  const [actionLocks] = useState(() => new Set<string>());
  const { updateItem } = reels;
  const flatRef = useRef<FlatList<FeedItem>>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragging = useRef(false);
  const offset = useRef(0);
  const settledOffset = useRef(0);
  const canPlay = focused && foreground && !scrolling && !comments;
  const activeId = reels.items[activeIdx]?.sourceId ?? null;

  useLayoutEffect(() => {
    playback.allow(canPlay ? activeId : null);
    return () => playback.allow(null);
  }, [playback, canPlay, activeId]);

  useFocusEffect(
    useCallback(() => {
      offset.current = settledOffset.current;
      flatRef.current?.scrollToOffset({
        offset: offset.current,
        animated: false,
      });
      setFocused(true);
      return () => {
        playback.allow(null);
        setFocused(false);
        setExpanded(false);
        dragging.current = false;
        setScrolling(false);
        if (settleTimer.current) clearTimeout(settleTimer.current);
      };
    }, [playback]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        playback.allow(null);
        dragging.current = false;
        setScrolling(false);
        if (settleTimer.current) clearTimeout(settleTimer.current);
      } else {
        offset.current = settledOffset.current;
        flatRef.current?.scrollToOffset({
          offset: offset.current,
          animated: false,
        });
      }
      setForeground(state === "active");
    });
    return () => {
      subscription.remove();
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, [playback]);

  const viewedRef = useRef(new Set<string>());
  const reelsFeedApi = React.useMemo(
    () => createFeedApi(apiClient),
    [apiClient],
  );
  const recordViewed = useCallback(
    (id: string) => {
      if (viewedRef.current.has(id)) return;
      if (viewedRef.current.size >= 1000) viewedRef.current.clear();
      viewedRef.current.add(id);
      void reelsFeedApi.recordView("FEED_POST", id);
    },
    [reelsFeedApi],
  );

  const settle = useCallback(() => {
    if (dragging.current) return;
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    const index = Math.max(
      0,
      Math.min(reels.items.length - 1, Math.round(offset.current / screenH)),
    );
    const target = index * screenH;
    if (Math.abs(offset.current - target) > 1) {
      flatRef.current?.scrollToOffset({ offset: target, animated: true });
      return;
    }
    settledOffset.current = target;
    setSelection({ generation: reels.generation, index });
    setScrolling(false);
    setExpanded(false);
  }, [screenH, reels.generation, reels.items.length]);

  const scheduleSettle = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(settle, 160);
  }, [settle]);

  useLayoutEffect(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    dragging.current = false;
    offset.current = activeIdx * screenH;
    settledOffset.current = offset.current;
    // A replacement pager or resized viewport cannot retain the old native gesture.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScrolling(false);
    setExpanded(false);
    flatRef.current?.scrollToOffset({
      offset: offset.current,
      animated: false,
    });
  }, [screenH, reels.generation]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateCommentCount = useCallback(
    (id: string, count: number) => {
      updateItem(id, { commentCount: count });
    },
    [updateItem],
  );
  const closeComments = useCallback(() => setComments(null), []);
  const openComments = useCallback(
    (item: FeedItem) => {
      playback.allow(null);
      setComments(item);
    },
    [playback],
  );

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/(tabs)" as never);
  }, [router]);

  const renderItem = useCallback(
    ({ item, index }: { item: FeedItem; index: number }) => (
      <ReelItem
        item={item}
        active={canPlay && index === activeIdx}
        shouldLoad={
          index === activeIdx ||
          (focused && foreground && index === activeIdx + 1)
        }
        height={screenH}
        apiClient={apiClient}
        muted={muted}
        toggleMute={toggleMute}
        playback={playback}
        captionExpanded={index === activeIdx && expanded}
        actionLocks={actionLocks}
        updateItem={updateItem}
        onComments={openComments}
        onExpand={setExpanded}
        onViewed={recordViewed}
      />
    ),
    [
      activeIdx,
      canPlay,
      focused,
      foreground,
      apiClient,
      screenH,
      muted,
      toggleMute,
      playback,
      updateItem,
      openComments,
      recordViewed,
      expanded,
      actionLocks,
    ],
  );

  const keyExtractor = useCallback((i: FeedItem) => i.itemId, []);
  const getItemLayout = useCallback(
    (_: unknown, i: number) => ({
      length: screenH,
      offset: screenH * i,
      index: i,
    }),
    [screenH],
  );

  return (
    <ThemedView
      testID="reels-viewport"
      style={styles.root}
      onLayout={(e) => {
        const height = e.nativeEvent.layout.height;
        if (height > 0) setScreenH(height);
      }}
    >
      <StatusBar style="light" />

      <FlatList
        key={reels.generation}
        testID="reels-list"
        ref={flatRef}
        data={reels.items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemLayout={getItemLayout}
        pagingEnabled
        snapToInterval={screenH}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        windowSize={3}
        maxToRenderPerBatch={2}
        initialNumToRender={1}
        removeClippedSubviews={false}
        scrollEnabled={!expanded && !comments}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => {
          dragging.current = true;
          playback.allow(null);
          setScrolling(true);
        }}
        onScroll={(e) => {
          offset.current = e.nativeEvent.contentOffset.y;
          playback.allow(null);
          setScrolling(true);
          scheduleSettle();
        }}
        onScrollEndDrag={() => {
          dragging.current = false;
          scheduleSettle();
        }}
        onMomentumScrollEnd={settle}
        onEndReached={() => {
          if (!reels.error) reels.loadMore();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={reels.refreshing}
            onRefresh={reels.refresh}
            tintColor="#fff"
          />
        }
        ListEmptyComponent={
          reels.loading ? (
            <View style={[styles.statePage, { height: screenH }]}>
              <ActivityIndicator size="large" color="rgba(255,255,255,0.7)" />
            </View>
          ) : reels.error ? (
            <StatePage
              height={screenH}
              icon="cloud-offline-outline"
              title="Couldn't load reels"
              body={reels.error}
              actionLabel="Retry"
              onAction={reels.refresh}
            />
          ) : (
            <StatePage
              height={screenH}
              icon="videocam-outline"
              title={reels.hasMore ? "More reels to discover" : "No reels yet"}
              body={
                reels.hasMore
                  ? "Continue searching the next page."
                  : "Be the first to share a video with your community."
              }
              actionLabel={reels.hasMore ? "Keep browsing" : "Create a reel"}
              onAction={
                reels.hasMore
                  ? reels.loadMore
                  : () => router.push("/(app)/reels/create" as never)
              }
            />
          )
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Header — top scrim + back + mode switcher, floats over the video */}
      <Scrim steps={[0.28, 0.16, 0.08, 0.03]} style={styles.scrimTop} />
      <SafeAreaView
        edges={["top"]}
        style={styles.header}
        pointerEvents="box-none"
      >
        <View style={styles.headerRow} pointerEvents="box-none">
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </Pressable>
          <View style={styles.modeBar}>
            {(["community", "following"] as const).map((m) => (
              <Pressable
                key={m}
                onPress={() => {
                  if (reels.mode === m) return;
                  playback.allow(null);
                  setExpanded(false);
                  reels.switchMode(m);
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: reels.mode === m }}
                style={styles.modeBtn}
              >
                <ThemedText
                  style={[
                    styles.modeLabel,
                    TEXT_SHADOW,
                    reels.mode === m && styles.modeLabelActive,
                  ]}
                >
                  {m === "community" ? "Community" : "Following"}
                </ThemedText>
                {reels.mode === m && <View style={styles.modeLine} />}
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={() => router.push("/(app)/reels/create" as never)}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Create reel"
          >
            <Ionicons name="add" size={26} color="#fff" />
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Paging spinner while fetching the next page */}
      {reels.loadingMore && (
        <ActivityIndicator
          style={styles.moreSpinner}
          color="rgba(255,255,255,0.7)"
        />
      )}

      {!!reels.items.length &&
        !reels.loadingMore &&
        reels.hasMore &&
        activeIdx === reels.items.length - 1 &&
        !reels.error && (
          <Pressable
            style={styles.pagingError}
            onPress={reels.loadMore}
            accessibilityRole="button"
            accessibilityLabel="Load more reels"
          >
            <ThemedText style={styles.stateBtnText}>Keep browsing</ThemedText>
          </Pressable>
        )}
      {!!reels.items.length && reels.error && (
        <Pressable
          style={styles.pagingError}
          onPress={reels.loadMore}
          accessibilityRole="button"
          accessibilityLabel="Retry loading more reels"
        >
          <ThemedText style={styles.stateBtnText}>
            Couldn’t load more. Retry
          </ThemedText>
        </Pressable>
      )}
      <Modal
        visible={comments !== null}
        transparent
        animationType="slide"
        onRequestClose={closeComments}
      >
        <KeyboardAvoidingView
          testID="reels-comments-keyboard"
          style={styles.modalRoot}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Pressable
            style={styles.sheetBackdrop}
            onPress={closeComments}
            accessibilityLabel="Close comments"
          />
          <View style={styles.sheetContent} accessibilityViewIsModal>
            {comments && (
              <PostDetailScreen
                key={comments.sourceId}
                postId={comments.sourceId}
                commentsOnly
                onClose={closeComments}
                onCommentCountChange={updateCommentCount}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  header: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.two,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginVertical: Spacing.two,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  modeBar: { flex: 1, flexDirection: "row", justifyContent: "center" },
  modeBtn: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  pagingError: {
    position: "absolute",
    top: 100,
    alignSelf: "center",
    backgroundColor: BrandColors.primary,
    padding: 12,
    borderRadius: 20,
  },
  modeLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 15,
    fontWeight: "500",
  },
  modeLabelActive: { color: "#fff", fontWeight: "700" },
  modeLine: {
    height: 2,
    width: 32,
    borderRadius: 1,
    backgroundColor: "#fff",
    marginTop: 2,
  },
  reel: { backgroundColor: "#000", overflow: "hidden" },
  videoPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
  },
  errorText: { color: "rgba(255,255,255,0.6)", fontSize: 14 },
  heartBurst: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  scrimStep: { height: 34, backgroundColor: "#000" },
  scrimTop: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 5 },
  scrimBottom: { position: "absolute", bottom: 0, left: 0, right: 0 },
  actionRail: {
    position: "absolute",
    right: Spacing.three,
    bottom: 120,
    alignItems: "center",
    gap: Spacing.four,
  },
  railBtn: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 48,
    minHeight: 48,
  },
  expandedOverlay: {
    backgroundColor: "rgba(0,0,0,0.78)",
    borderTopRightRadius: 20,
  },
  captionMeasure: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    opacity: 0,
  },
  descriptionToggle: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingRight: 24,
  },
  descriptionToggleText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  actionError: {
    color: "#fff",
    backgroundColor: "rgba(100,0,20,0.85)",
    padding: 8,
    borderRadius: 8,
  },
  modalRoot: { flex: 1 },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)" },
  sheetContent: {
    height: "74%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
  },
  railCount: { fontSize: 11, color: "#fff", marginTop: 2, fontWeight: "600" },
  bottomOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 88,
    padding: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.two,
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  authorText: {
    flex: 1,
    minWidth: 100,
    minHeight: 44,
    justifyContent: "center",
  },
  authorName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
    ...TEXT_SHADOW,
  },
  authorMeta: { fontSize: 11, color: "rgba(255,255,255,0.8)", ...TEXT_SHADOW },
  followBtn: {
    marginLeft: Spacing.two,
    borderWidth: 1,
    borderColor: "#fff",
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: 5,
    minHeight: 44,
    justifyContent: "center",
  },
  followingBtn: {
    borderColor: "rgba(255,255,255,0.4)",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  followBtnText: { fontSize: 12, fontWeight: "700", color: "#fff" },
  followingBtnText: { color: "rgba(255,255,255,0.85)" },
  caption: { fontSize: 14, color: "#fff", lineHeight: 20, ...TEXT_SHADOW },
  statePage: {
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.five,
  },
  stateTitle: { fontSize: 18, fontWeight: "700", color: "#fff" },
  stateBody: {
    fontSize: 14,
    color: "rgba(255,255,255,0.6)",
    textAlign: "center",
  },
  stateBtn: {
    marginTop: Spacing.three,
    backgroundColor: BrandColors.primary,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.two,
    borderRadius: 20,
    minHeight: 44,
    justifyContent: "center",
  },
  stateBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  moreSpinner: { position: "absolute", bottom: 110, alignSelf: "center" },
});
