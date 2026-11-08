import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { ErrorState } from "@/shared/components/error-state";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { CandidateCard } from "../components/candidate-profile";
import { BrowseGrid } from "../components/browse-grid";
import { MatchOverlay } from "../components/match-overlay";
import { SwipeDeck } from "../components/swipe-deck";
import {
  DatingBottomNavigation,
  DiscoverySkeleton,
  EmptyState,
  ModeSwitch,
  type DiscoveryMode,
} from "../components/matchmaking-ui";
import { useMatchmakingApi } from "../hooks/use-matchmaking-api";
import { usePagedMatchmaking } from "../hooks/use-paged-matchmaking";
import { matchmakingError } from "../services/matchmaking-errors";
import {
  discoveryModeSnapshot,
  loadDiscoveryMode,
  saveDiscoveryMode,
} from "../utils/discovery-mode";
import type {
  PublicMatchmakingProfile,
  SwipeAction,
  SwipeResult,
} from "../types/matchmaking-types";
import { useSession } from "@/core/session/session-provider";
import { confirmCommunityAction } from "@/core/session/community-actions";

const profileId = (profile: PublicMatchmakingProfile) => profile.userId;

type DiscoveryTab = "discover" | "received" | "sent";

function DecisionButton({
  icon,
  label,
  color,
  backgroundColor,
  size,
  disabled,
  loading = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  backgroundColor: string;
  size: number;
  disabled: boolean;
  loading?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.decisionButton,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor,
          borderColor: color,
        },
        (pressed || disabled) && { opacity: 0.45 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} size="small" />
      ) : (
        <Ionicons name={icon} size={size * 0.43} color={color} />
      )}
    </Pressable>
  );
}

/**
 * Dating discovery uses all space between its compact header and persistent
 * decision/navigation bars for the shared swipe or browse profile queue.
 */
export default function DiscoveryScreen() {
  const theme = useTheme();
  const api = useMatchmakingApi();
  const { apiClient, session } = useSession();
  const routeParams = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<DiscoveryTab>(() =>
    routeParams.tab === "received" ? "received" : "discover",
  );
  const [viewMode, setViewMode] = useState<DiscoveryMode>(() =>
    discoveryModeSnapshot(),
  );
  const [browseActiveId, setBrowseActiveId] = useState<string | null>(null);
  const fetcher = useCallback(
    (cursor?: string) =>
      tab === "discover"
        ? api.discover(cursor)
        : tab === "sent"
          ? api.sentLikes(cursor)
          : api.receivedLikes(cursor),
    [api, tab],
  );
  const page = usePagedMatchmaking(
    fetcher,
    profileId,
    "Matchmaking profiles could not be loaded.",
  );
  const actingRef = useRef<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [failedSwipe, setFailedSwipe] = useState<{
    profile: PublicMatchmakingProfile;
    action: SwipeAction;
  } | null>(null);
  const [lastLike, setLastLike] = useState<PublicMatchmakingProfile | null>(
    null,
  );
  const [match, setMatch] = useState<{
    result: SwipeResult;
    profile: PublicMatchmakingProfile;
  } | null>(null);

  // Restore the persisted discovery mode (first mount hydrates the snapshot).
  useEffect(() => {
    let active = true;
    void loadDiscoveryMode().then((mode) => {
      if (active) setViewMode(mode);
    });
    return () => {
      active = false;
    };
  }, []);

  const changeViewMode = (mode: DiscoveryMode) => {
    setViewMode(mode);
    saveDiscoveryMode(mode);
  };

  const selectTab = (next: DiscoveryTab) => {
    setTab(next);
    setBrowseActiveId(null);
    setActionError(null);
    setFailedSwipe(null);
  };

  const swipe = async (
    profile: PublicMatchmakingProfile,
    action: SwipeAction,
  ) => {
    if (actingRef.current) return;
    actingRef.current = profile.userId;
    setActing(profile.userId);
    setActionError(null);
    try {
      if (action === "LIKE") {
        const confirmed = await confirmCommunityAction(
          apiClient,
          session?.access,
          {
            actionKey: "EXTENDED_MATCHMAKING_LIKE",
            title: `Like ${profile.displayName}?`,
            confirmLabel: "Like",
          },
        );
        if (!confirmed) return;
      }
      const result = await api.swipe(profile.userId, action);
      setFailedSwipe(null);
      page.remove(profile.userId);
      if (result.matched) {
        setMatch({ result, profile });
        setLastLike(null);
      } else if (action === "LIKE") {
        setLastLike(profile);
      }
    } catch (error) {
      setFailedSwipe({ profile, action });
      setActionError(
        matchmakingError(
          error,
          `${action === "LIKE" ? "Like" : "Pass"} could not be recorded.`,
        ),
      );
    } finally {
      actingRef.current = null;
      setActing(null);
    }
  };

  const rewind = async () => {
    if (actingRef.current) return;
    actingRef.current = "rewind";
    setActing("rewind");
    setActionError(null);
    try {
      await api.rewind();
      setLastLike(null);
      page.refresh();
    } catch (error) {
      setActionError(
        matchmakingError(error, "There is no eligible swipe to rewind."),
      );
    } finally {
      actingRef.current = null;
      setActing(null);
    }
  };

  const cancelLike = async (target = lastLike) => {
    if (!target || actingRef.current) return;
    actingRef.current = target.userId;
    setActing(target.userId);
    setActionError(null);
    try {
      await api.cancelLike(target.userId);
      setLastLike(null);
      page.refresh();
    } catch (error) {
      setActionError(
        matchmakingError(error, "The like could not be cancelled."),
      );
    } finally {
      actingRef.current = null;
      setActing(null);
    }
  };

  // Keep the deck stocked — prefetch the next page when few cards remain.
  const { loading, loadingMore, error: pageError, nextCursor, loadMore } = page;
  const remaining = page.items.length;
  useEffect(() => {
    if (
      tab !== "sent" &&
      viewMode === "swipe" &&
      !loading &&
      !loadingMore &&
      !pageError &&
      nextCursor &&
      remaining < 4
    ) {
      loadMore();
    }
  }, [
    tab,
    viewMode,
    loading,
    loadingMore,
    pageError,
    nextCursor,
    remaining,
    loadMore,
  ]);

  // Returning from a candidate profile re-syncs the shared server-driven queue.
  const firstFocus = useRef(true);
  const { refresh } = page;
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      refresh();
    }, [refresh]),
  );

  const activeProfile =
    viewMode === "browse"
      ? (page.items.find((profile) => profile.userId === browseActiveId) ??
        page.items[0])
      : page.items[0];
  const likeLabel = tab === "received" ? "Like back" : "Like";

  const emptyState = (
    <EmptyState
      title={
        tab === "discover"
          ? "No compatible profiles right now"
          : tab === "sent"
            ? "No outgoing likes"
            : "No received likes yet"
      }
      body={
        tab === "discover"
          ? "Check back later or review your preferences. Your latest eligible swipe can be rewound."
          : tab === "sent"
            ? "Your active likes appear here until matched or canceled."
            : "Incoming active likes from compatible members will appear here."
      }
      action={
        tab === "discover" ? (
          <PrimaryButton
            label="Review preferences"
            variant="secondary"
            onPress={() =>
              router.push("/(app)/matchmaking/preferences" as never)
            }
          />
        ) : undefined
      }
    />
  );

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <View style={styles.headerSide}>
            <ModeSwitch mode={viewMode} onChange={changeViewMode} />
          </View>
          <Pressable
            onPress={() => router.push("/(app)/(tabs)" as never)}
            accessibilityRole="button"
            accessibilityLabel="Go to Posts"
            hitSlop={6}
            style={({ pressed }) => [
              styles.postsButton,
              { backgroundColor: theme.backgroundElement },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Ionicons name="newspaper-outline" size={20} color={theme.primary} />
            <ThemedText
              style={[styles.postsButtonText, { color: theme.primary }]}
            >
              Posts
            </ThemedText>
          </Pressable>
          <View style={[styles.headerSide, styles.headerSideRight]}>
            <Pressable
              onPress={() =>
                router.push("/(app)/matchmaking/preferences" as never)
              }
              accessibilityRole="button"
              accessibilityLabel="Discovery preferences"
              hitSlop={6}
              style={({ pressed }) => [
                styles.preferencesButton,
                { backgroundColor: theme.backgroundElement },
                pressed && { opacity: 0.6 },
              ]}
            >
              <Ionicons
                name="options-outline"
                size={23}
                color={theme.primary}
              />
            </Pressable>
          </View>
        </View>

        {tab !== "discover" ? (
          <View style={styles.likesSwitch}>
            {(["received", "sent"] as const).map((item) => {
              const selected = tab === item;
              return (
                <Pressable
                  key={item}
                  onPress={() => selectTab(item)}
                  disabled={acting !== null}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  style={[
                    styles.likesTab,
                    selected && { backgroundColor: theme.primarySurface },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.likesTabText,
                      { color: selected ? theme.primary : theme.textSecondary },
                    ]}
                  >
                    {item === "received" ? "Received" : "Sent"}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.content}>
          <MatchOverlay
            match={match?.result ?? null}
            profile={match?.profile ?? null}
            onOpenChat={(conversationId) => {
              setMatch(null);
              router.push(`/(app)/messages/${conversationId}` as never);
            }}
            onViewMatch={(matchId) => {
              setMatch(null);
              router.push(`/(app)/matchmaking/matches/${matchId}` as never);
            }}
            onDismiss={() => setMatch(null)}
          />
          {lastLike && !match ? (
            <View
              style={[
                styles.sentCard,
                { backgroundColor: theme.backgroundElement },
              ]}
            >
              <ThemedText style={styles.sentText}>
                Like sent to {lastLike.displayName}
              </ThemedText>
              <PrimaryButton
                label="Cancel like"
                variant="ghost"
                loading={acting === lastLike.userId}
                onPress={() => void cancelLike()}
              />
            </View>
          ) : null}
          {actionError || page.error ? (
            <ThemedText
              style={styles.error}
              themeColor="error"
              accessibilityRole="alert"
            >
              {actionError ?? page.error}
            </ThemedText>
          ) : null}
          {failedSwipe ? (
            <PrimaryButton
              label={`Retry ${failedSwipe.action === "LIKE" ? "like" : "pass"} for ${failedSwipe.profile.displayName}`}
              variant="secondary"
              disabled={acting !== null}
              onPress={() =>
                void swipe(failedSwipe.profile, failedSwipe.action)
              }
            />
          ) : null}
          {page.error && page.items.length > 0 ? (
            <PrimaryButton
              label="Retry loading profiles"
              variant="ghost"
              onPress={page.retry}
            />
          ) : null}
          {page.loading ? (
            <DiscoverySkeleton mode={viewMode} />
          ) : page.error && page.items.length === 0 ? (
            <ErrorState message={page.error} onRetry={page.refresh} />
          ) : tab === "sent" ? (
            <FlatList
              style={styles.profileList}
              data={page.items}
              keyExtractor={profileId}
              contentContainerStyle={styles.sentList}
              refreshing={page.refreshing}
              onRefresh={page.refresh}
              onEndReached={page.loadMore}
              ListEmptyComponent={emptyState}
              renderItem={({ item }) => (
                <View>
                  <CandidateCard profile={item} />
                  <PrimaryButton
                    label={`Cancel like to ${item.displayName}`}
                    variant="ghost"
                    disabled={acting !== null}
                    loading={acting === item.userId}
                    onPress={() => void cancelLike(item)}
                  />
                </View>
              )}
            />
          ) : viewMode === "swipe" ? (
            <SwipeDeck
              items={page.items}
              acting={acting !== null}
              onSwipe={swipe}
              onBlocked={(profile) => page.remove(profile.userId)}
              empty={emptyState}
            />
          ) : (
            <BrowseGrid
              items={page.items}
              refreshing={page.refreshing}
              loadingMore={page.loadingMore}
              onRefresh={page.refresh}
              onLoadMore={page.loadMore}
              onActiveProfileChange={(profile) =>
                setBrowseActiveId(profile.userId)
              }
              empty={emptyState}
            />
          )}
        </View>

        {tab !== "sent" ? (
          <View
            style={[
              styles.decisionBar,
              {
                backgroundColor: theme.background,
                borderTopColor: theme.border,
              },
            ]}
            accessibilityLabel="Profile actions"
          >
            <DecisionButton
              icon="arrow-undo"
              label="Rewind latest swipe"
              color="#D97706"
              backgroundColor={theme.backgroundElement}
              size={46}
              disabled={acting !== null}
              loading={acting === "rewind"}
              onPress={() => void rewind()}
            />
            <DecisionButton
              icon="close"
              label={
                activeProfile ? `Pass on ${activeProfile.displayName}` : "Pass"
              }
              color="#E11D48"
              backgroundColor={theme.backgroundElement}
              size={58}
              disabled={acting !== null || !activeProfile}
              onPress={() => activeProfile && void swipe(activeProfile, "PASS")}
            />
            <DecisionButton
              icon="heart"
              label={
                activeProfile
                  ? `${likeLabel} ${activeProfile.displayName}`
                  : likeLabel
              }
              color="#FFFFFF"
              backgroundColor={theme.primary}
              size={64}
              disabled={acting !== null || !activeProfile}
              loading={acting !== null && acting === activeProfile?.userId}
              onPress={() => activeProfile && void swipe(activeProfile, "LIKE")}
            />
          </View>
        ) : null}

        <DatingBottomNavigation
          active={tab === "discover" ? "home" : "likes"}
          onHome={() => selectTab("discover")}
          onLikes={() => selectTab("received")}
          mode={viewMode}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: { flex: 1, alignItems: "flex-start" },
  headerSideRight: { alignItems: "flex-end" },
  postsButton: {
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  postsButtonText: { fontSize: 14, fontWeight: "700" },
  preferencesButton: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  likesSwitch: {
    flexDirection: "row",
    alignSelf: "center",
    padding: 3,
    marginTop: Spacing.two,
    gap: 3,
  },
  likesTab: {
    minWidth: 104,
    minHeight: 36,
    paddingHorizontal: Spacing.four,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: BorderRadius.full,
  },
  likesTabText: { fontSize: 13, fontWeight: "700" },
  content: { flex: 1 },
  profileList: { flex: 1 },
  sentList: { padding: Spacing.three, gap: Spacing.three, flexGrow: 1 },
  sentCard: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    borderRadius: 16,
    paddingLeft: Spacing.three,
  },
  sentText: { flex: 1, fontSize: 13 },
  error: {
    marginHorizontal: Spacing.four,
    marginVertical: Spacing.two,
    textAlign: "center",
  },
  decisionBar: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 28,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  decisionButton: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
});
