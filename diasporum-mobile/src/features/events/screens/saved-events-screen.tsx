/**
 * SavedEventsScreen — bookmarked events (page-based).
 * Route: /(app)/events/saved
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { safeBack } from "@/core/navigation/safe-back";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useSession } from "@/core/session/session-provider";
import { createEventApi } from "../services/event-api";
import { BrandColors } from "@/shared/theme/colors";
import { Spacing } from "@/shared/theme/spacing";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import type { EventItem } from "../types/event-types";
import { EventCard } from "../components/event-card";
import { EventsBottomNav } from "../components/events-bottom-nav";
import { EventsEmpty, EventsSkeleton } from "../components/event-states";

const PAGE_SIZE = 20;

export default function SavedEventsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient } = useSession();
  const eventApi = React.useMemo(() => createEventApi(apiClient), [apiClient]);

  const [items, setItems] = useState<EventItem[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  // State updates live in promise continuations so the mount effect never
  // sets state synchronously (react-hooks/set-state-in-effect).
  const load = useCallback(() => {
    if (loadingRef.current) return Promise.resolve();
    loadingRef.current = true;
    return eventApi
      .savedEvents(0, PAGE_SIZE)
      .then((r) => {
        setItems(r.items);
        setPage(0);
        setHasMore(r.items.length === PAGE_SIZE);
        setError(null);
      })
      .catch((e: unknown) => {
        setError(
          ApiError.isApiError(e) ? e.userMessage : "Failed to load saved events.",
        );
      })
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
        setRefreshing(false);
      });
  }, [eventApi]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const r = await eventApi.savedEvents(next, PAGE_SIZE);
      setItems((prev) => [
        ...prev,
        ...r.items.filter((i) => !prev.some((p) => p.event.id === i.event.id)),
      ]);
      setPage(next);
      setHasMore(r.items.length === PAGE_SIZE);
    } catch {
      /* footer retry via pull-to-refresh */
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, page, eventApi]);

  const openDetail = useCallback(
    (eventId: string) => router.push(`/(app)/events/${eventId}` as never),
    [router],
  );

  // Unsaving removes the row from the saved list — restoring re-marks it.
  const toggleSave = useCallback(
    async (eventId: string, saved: boolean) => {
      const previous = items;
      setItems((prev) =>
        saved
          ? prev.map((i) =>
              i.event.id === eventId ? { ...i, saved: true } : i,
            )
          : prev.filter((i) => i.event.id !== eventId),
      );
      try {
        if (saved) await eventApi.saveEvent(eventId);
        else await eventApi.unsaveEvent(eventId);
      } catch {
        setItems(previous);
      }
    },
    [eventApi, items],
  );

  return (
    <ThemedView style={s.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={s.safeArea} edges={["top", "left", "right"]}>
        <View style={[s.header, { borderBottomColor: theme.border }]}>
          <Pressable
            onPress={safeBack}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={24} color={theme.text} />
          </Pressable>
          <ThemedText type="title" style={s.headerTitle}>
            Saved events
          </ThemedText>
          <View style={s.headerSpacer} />
        </View>

        <FlatList
          data={items}
          renderItem={({ item }) => (
            <EventCard
              item={item}
              onPress={openDetail}
              onToggleSave={toggleSave}
            />
          )}
          keyExtractor={(item) => item.event.id}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={BrandColors.primary}
            />
          }
          ListHeaderComponent={
            loading && !refreshing ? (
              <EventsSkeleton />
            ) : error ? (
              <View style={s.errorRow}>
                <ThemedText style={s.errorText} themeColor="textSecondary">
                  {error}
                </ThemedText>
                <Pressable
                  onPress={() => void load()}
                  accessibilityRole="button"
                  accessibilityLabel="Retry"
                >
                  <ThemedText style={s.retryText}>Retry</ThemedText>
                </Pressable>
              </View>
            ) : undefined
          }
          ListEmptyComponent={
            !loading && !error ? (
              <EventsEmpty
                title="No saved events yet"
                message="Bookmark events you want to keep an eye on."
                actionLabel="Browse events"
                onAction={() => {
                  if (router.canGoBack()) router.back();
                  else router.replace("/(app)/events" as never);
                }}
              />
            ) : undefined
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={s.footer}>
                <ThemedText style={s.footerText} themeColor="textSecondary">
                  Loading more…
                </ThemedText>
              </View>
            ) : undefined
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={
            items.length === 0 ? { flexGrow: 1 } : undefined
          }
        />
      </SafeAreaView>
      <EventsBottomNav active="saved" />
    </ThemedView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 18 },
  headerSpacer: { width: 24 },
  errorRow: {
    alignItems: "center",
    gap: Spacing.two,
    paddingTop: Spacing.five,
    paddingHorizontal: Spacing.four,
  },
  errorText: { fontSize: 14, textAlign: "center" },
  retryText: { color: BrandColors.primary, fontWeight: "700", fontSize: 14 },
  footer: { alignItems: "center", paddingVertical: Spacing.three },
  footerText: { fontSize: 13 },
});
