/**
 * MyEventsScreen — events the user created/manages or participates in.
 * Route: /(app)/events/my
 * Organized tab includes drafts (publishable from the detail screen).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  SectionList,
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
type Role = "organized" | "participating";

export default function MyEventsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient } = useSession();
  const eventApi = React.useMemo(() => createEventApi(apiClient), [apiClient]);

  const [role, setRole] = useState<Role>("organized");
  const [items, setItems] = useState<EventItem[]>([]);
  // Sampled once at mount — "started/past" only needs an approximate boundary.
  const [now] = useState(() => Date.now());
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  // State updates live in promise continuations so the load effect never
  // sets state synchronously (react-hooks/set-state-in-effect).
  const load = useCallback(() => {
    if (loadingRef.current) return Promise.resolve();
    loadingRef.current = true;
    return eventApi
      .myEvents(role, 0, PAGE_SIZE)
      .then((r) => {
        setItems(r.items);
        setPage(0);
        setHasMore(r.items.length === PAGE_SIZE);
        setError(null);
      })
      .catch((e: unknown) => {
        setError(
          ApiError.isApiError(e) ? e.userMessage : "Failed to load your events.",
        );
      })
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
        setRefreshing(false);
      });
  }, [eventApi, role]);

  // Show the skeleton again when the tab changes — adjusted during render
  // instead of in the effect (set-state-in-effect).
  const [prevRole, setPrevRole] = useState(role);
  if (prevRole !== role) {
    setPrevRole(role);
    setLoading(true);
  }

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
      const r = await eventApi.myEvents(role, next, PAGE_SIZE);
      setItems((prev) => [
        ...prev,
        ...r.items.filter((i) => !prev.some((p) => p.event.id === i.event.id)),
      ]);
      setPage(next);
      setHasMore(r.items.length === PAGE_SIZE);
    } catch {
      /* pull-to-refresh retries */
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, page, role, eventApi]);

  const openDetail = useCallback(
    (eventId: string) => router.push(`/(app)/events/${eventId}` as never),
    [router],
  );

  const toggleSave = useCallback(
    async (eventId: string, saved: boolean) => {
      setItems((prev) =>
        prev.map((i) => (i.event.id === eventId ? { ...i, saved } : i)),
      );
      try {
        if (saved) await eventApi.saveEvent(eventId);
        else await eventApi.unsaveEvent(eventId);
      } catch {
        setItems((prev) =>
          prev.map((i) =>
            i.event.id === eventId ? { ...i, saved: !saved } : i,
          ),
        );
      }
    },
    [eventApi],
  );

  // Group loaded rows into meaningful sections using the mount-time "now".
  const sections = useMemo(() => {
    const started = (i: EventItem) =>
      new Date(i.event.startsAt).getTime() <= now;
    const cancelled = (i: EventItem) => i.event.cancelledAt !== null;
    const groups = new Map<string, EventItem[]>();
    const add = (key: string, item: EventItem) => {
      const g = groups.get(key);
      if (g) g.push(item);
      else groups.set(key, [item]);
    };
    if (role === "organized") {
      for (const item of items) {
        if (item.event.status === "DRAFT") add("Drafts", item);
        else if (cancelled(item)) add("Cancelled", item);
        else if (started(item)) add("Past", item);
        else add("Upcoming", item);
      }
    } else {
      const RSVP_SECTION: Record<string, string> = {
        GOING: "Going",
        INTERESTED: "Interested",
        WAITLISTED: "Waitlisted",
      };
      for (const item of items) {
        if (cancelled(item)) add("Cancelled", item);
        else if (started(item)) add("Past", item);
        else add(RSVP_SECTION[item.myRsvp ?? ""] ?? "Other", item);
      }
    }
    const ORDER =
      role === "organized"
        ? ["Upcoming", "Drafts", "Cancelled", "Past"]
        : ["Going", "Interested", "Waitlisted", "Cancelled", "Past", "Other"];
    return ORDER.filter((k) => groups.has(k)).map((k) => ({
      title: k,
      data: groups.get(k) as EventItem[],
    }));
  }, [items, role, now]);

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
            My events
          </ThemedText>
          <View style={s.headerSpacer} />
        </View>

        {/* Role tabs */}
        <View style={[s.tabBar, { borderBottomColor: theme.border }]}>
          {(["organized", "participating"] as Role[]).map((r) => (
            <Pressable
              key={r}
              onPress={() => setRole(r)}
              accessibilityRole="tab"
              accessibilityLabel={
                r === "organized" ? "Events you organize" : "Events you attend"
              }
              accessibilityState={{ selected: role === r }}
              style={s.tabBtn}
            >
              <ThemedText
                style={[
                  s.tabLabel,
                  role === r && {
                    color: BrandColors.primary,
                    fontWeight: "700",
                  },
                ]}
              >
                {r === "organized" ? "Organizing" : "Attending"}
              </ThemedText>
              {role === r && (
                <View
                  style={[s.tabLine, { backgroundColor: BrandColors.primary }]}
                />
              )}
            </Pressable>
          ))}
        </View>

        <SectionList
          sections={sections}
          renderItem={({ item }) => (
            <EventCard
              item={item}
              onPress={openDetail}
              onToggleSave={toggleSave}
            />
          )}
          renderSectionHeader={({ section }) => (
            <ThemedText
              style={[s.sectionHeader, { backgroundColor: theme.background }]}
              themeColor="textSecondary"
            >
              {section.title}
            </ThemedText>
          )}
          stickySectionHeadersEnabled={false}
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
                title={
                  role === "organized"
                    ? "You are not organizing any events"
                    : "You are not attending any events"
                }
                message={
                  role === "organized"
                    ? "Events you create or manage on behalf of a business account appear here."
                    : "Events you RSVP to appear here."
                }
                actionLabel={
                  role === "organized" ? "Create an event" : "Browse events"
                }
                onAction={() => {
                  if (role === "organized")
                    router.push("/(app)/events/create" as never);
                  else if (router.canGoBack()) router.back();
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
      <EventsBottomNav active="tickets" />
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
  tabBar: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: Spacing.two },
  tabLabel: { fontSize: 14, fontWeight: "500" },
  tabLine: { height: 2, width: 36, borderRadius: 1, marginTop: 2 },
  sectionHeader: {
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.one,
  },
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
