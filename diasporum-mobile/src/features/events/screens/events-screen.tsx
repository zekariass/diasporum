/**
 * EventsScreen — event discovery hub.
 * Route: /(app)/events
 * Single Filters button opens a left drawer (date / format / visibility /
 * category); applied filters show as removable chips. Server-side search,
 * cursor pagination, links to Saved events, My events and event creation.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useSession } from "@/core/session/session-provider";
import { createEventApi } from "../services/event-api";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import type { EventCategory, EventItem } from "../types/event-types";
import { EventCard } from "../components/event-card";
import { EventsBottomNav } from "../components/events-bottom-nav";
import { EventsEmpty, EventsSkeleton } from "../components/event-states";
import {
  activeFilterCount,
  EMPTY_FILTER_SELECTION,
  EventFilterDrawer,
  type DateFilter,
  type EventFilterSelection,
} from "../components/event-filter-drawer";

const DATE_CHIP_LABEL: Record<Exclude<DateFilter, "ANY">, string> = {
  TODAY: "Today",
  WEEK: "This week",
  MONTH: "This month",
};

/** Viewer-relative date window — instant bounds for the server-side filter. */
function dateRange(f: DateFilter): { from?: string; to?: string } {
  if (f === "ANY") return {};
  const now = new Date();
  const end = new Date(now);
  if (f === "TODAY") {
    end.setHours(23, 59, 59, 999);
  } else if (f === "WEEK") {
    // Through the upcoming Sunday end-of-day.
    end.setDate(end.getDate() + ((7 - end.getDay()) % 7));
    end.setHours(23, 59, 59, 999);
  } else {
    end.setMonth(end.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
  }
  return { from: now.toISOString(), to: end.toISOString() };
}

export default function EventsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient, session } = useSession();
  const eventApi = React.useMemo(() => createEventApi(apiClient), [apiClient]);

  // "in {community}" line in the search pill — closest place-like label
  // available from the session's access context.
  const locationLabel =
    session?.access?.communities.find(
      (c) => c.communityId === session.activeCommunityId,
    )?.communityName ?? "your community";

  const [filters, setFilters] = useState<EventFilterSelection>(
    EMPTY_FILTER_SELECTION,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categories, setCategories] = useState<EventCategory[]>([]);

  const [items, setItems] = useState<EventItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    eventApi
      .categories()
      .then((r) => setCategories(r.items))
      .catch(() => setCategories([]));
  }, [eventApi]);

  // Debounce search so typing does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  // State updates live in promise continuations so the load effect never
  // sets state synchronously (react-hooks/set-state-in-effect).
  const loadPage = useCallback(
    (nextCursor?: string) => {
      if (loadingRef.current) return Promise.resolve();
      loadingRef.current = true;
      return Promise.resolve()
        .then(() => {
          if (nextCursor) setLoadingMore(true);
        })
        .then(() =>
          eventApi.discover(
            {
              scope: filters.scope === "ALL" ? undefined : filters.scope,
              mode: filters.mode === "ALL" ? undefined : filters.mode,
              categoryId: filters.categoryId ?? undefined,
              ...dateRange(filters.date),
              search: debouncedSearch || undefined,
            },
            nextCursor,
            20,
          ),
        )
        .then((page) => {
          setItems((prev) => {
            if (!nextCursor) return page.items;
            const seen = new Set(prev.map((i) => i.event.id));
            return [...prev, ...page.items.filter((i) => !seen.has(i.event.id))];
          });
          setCursor(page.nextCursor);
          setError(null);
        })
        .catch((e: unknown) => {
          setError(
            ApiError.isApiError(e) ? e.userMessage : "Failed to load events.",
          );
        })
        .finally(() => {
          loadingRef.current = false;
          setLoadingMore(false);
          setLoading(false);
          setRefreshing(false);
        });
    },
    [eventApi, filters, debouncedSearch],
  );

  // Show the skeleton again when the filters change — adjusted during
  // render instead of in the effect (set-state-in-effect).
  const filterKey = `${filters.scope}|${filters.mode}|${filters.date}|${filters.categoryId ?? ""}|${debouncedSearch}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setLoading(true);
  }

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void loadPage();
  }, [loadPage]);

  const loadMore = useCallback(() => {
    if (cursor && !loadingRef.current) void loadPage(cursor);
  }, [cursor, loadPage]);

  const openDetail = useCallback(
    (eventId: string) => router.push(`/(app)/events/${eventId}` as never),
    [router],
  );

  const filterCount = activeFilterCount(filters);
  const hasFilters = filterCount > 0 || debouncedSearch.length > 0;

  const toggleSave = useCallback(
    async (eventId: string, saved: boolean) => {
      // Optimistic flip — rolled back if the request fails.
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

  // Removable chips describing the applied filters.
  const chips = useMemo(() => {
    const list: { key: string; label: string; clear: () => void }[] = [];
    if (filters.scope !== "ALL") {
      list.push({
        key: "scope",
        label:
          filters.scope === "COMMUNITY" ? "My communities" : "Country-wide",
        clear: () => setFilters((f) => ({ ...f, scope: "ALL" })),
      });
    }
    if (filters.mode !== "ALL") {
      list.push({
        key: "mode",
        label: filters.mode === "IN_PERSON" ? "In person" : "Online",
        clear: () => setFilters((f) => ({ ...f, mode: "ALL" })),
      });
    }
    if (filters.date !== "ANY") {
      list.push({
        key: "date",
        label: DATE_CHIP_LABEL[filters.date],
        clear: () => setFilters((f) => ({ ...f, date: "ANY" })),
      });
    }
    if (filters.categoryId) {
      list.push({
        key: "category",
        label:
          categories.find((c) => c.id === filters.categoryId)?.displayName ??
          "Category",
        clear: () => setFilters((f) => ({ ...f, categoryId: null })),
      });
    }
    return list;
  }, [filters, categories]);

  const listData = useMemo(() => items, [items]);

  return (
    <ThemedView style={s.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={s.safeArea} edges={["top", "left", "right"]}>
        {/* Header — Eventbrite-style search/location pill + filters circle */}
        <View style={s.headerRow}>
          <View
            style={[
              s.searchPill,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
              },
            ]}
          >
            <Ionicons
              name="search"
              size={19}
              color={theme.text}
              style={s.searchIcon}
            />
            <View style={s.searchTextCol}>
              <TextInput
                style={[s.searchInput, { color: theme.text }]}
                placeholder="Find things to do"
                placeholderTextColor={theme.textSecondary}
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              <ThemedText style={s.searchLocation} numberOfLines={1}>
                in {locationLabel}
              </ThemedText>
            </View>
            {search.length > 0 && (
              <Pressable
                onPress={() => setSearch("")}
                hitSlop={8}
                accessibilityLabel="Clear search"
                style={s.searchClear}
              >
                <Ionicons
                  name="close-circle"
                  size={16}
                  color={theme.textSecondary}
                />
              </Pressable>
            )}
            <Pressable
              onPress={() => setDrawerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Open filters"
              style={[
                s.filtersCircle,
                { backgroundColor: theme.background, borderColor: theme.border },
              ]}
            >
              <Ionicons name="options-outline" size={17} color={theme.text} />
              {filterCount > 0 && (
                <View style={s.filtersDot}>
                  <ThemedText style={s.filtersDotText}>{filterCount}</ThemedText>
                </View>
              )}
            </Pressable>
          </View>
        </View>

        {/* Applied-filter chips */}
        {chips.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.chipRow}
            style={s.chipsScroll}
          >
            {chips.map((chip) => (
              <Pressable
                key={chip.key}
                onPress={chip.clear}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${chip.label} filter`}
                style={[s.chip, { backgroundColor: BrandColors.primarySurface }]}
              >
                <ThemedText style={[s.chipText, { color: BrandColors.primary }]}>
                  {chip.label}
                </ThemedText>
                <Ionicons name="close" size={13} color={BrandColors.primary} />
              </Pressable>
            ))}
            {chips.length > 1 && (
              <Pressable
                onPress={() => setFilters(EMPTY_FILTER_SELECTION)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear all filters"
              >
                <ThemedText style={s.clearAll} themeColor="textSecondary">
                  Clear all
                </ThemedText>
              </Pressable>
            )}
          </ScrollView>
        )}

        {/* List */}
        <FlatList
          data={listData}
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
            ) : error && !refreshing ? (
              <View style={s.errorRow}>
                <ThemedText style={s.errorText} themeColor="textSecondary">
                  {error}
                </ThemedText>
                <Pressable
                  onPress={() => void loadPage()}
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading events"
                >
                  <ThemedText style={s.retryText}>Retry</ThemedText>
                </Pressable>
              </View>
            ) : undefined
          }
          ListEmptyComponent={
            !loading && !error ? (
              <EventsEmpty
                filtered={hasFilters}
                actionLabel={hasFilters ? undefined : "Create an event"}
                onAction={
                  hasFilters
                    ? undefined
                    : () => router.push("/(app)/events/create" as never)
                }
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
            items.length === 0 ? { flexGrow: 1 } : { paddingBottom: Spacing.three }
          }
        />
      </SafeAreaView>

      <EventsBottomNav active="discover" />

      {drawerOpen && (
        <EventFilterDrawer
          selection={filters}
          categories={categories}
          onApply={(sel) => {
            setFilters(sel);
            setDrawerOpen(false);
          }}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </ThemedView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.one,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  searchPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.one,
    paddingVertical: 7,
    minHeight: 56,
  },
  searchIcon: { marginRight: Spacing.two },
  searchTextCol: { flex: 1, justifyContent: "center" },
  searchInput: { fontSize: 13, padding: 0, margin: 0 },
  searchLocation: { fontSize: 15, fontWeight: "700", marginTop: 1 },
  searchClear: { marginRight: Spacing.one },
  filtersCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  filtersDot: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: BrandColors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  filtersDotText: {
    color: BrandColors.white,
    fontSize: 10,
    fontWeight: "800",
  },
  chipsScroll: { flexGrow: 0, marginBottom: Spacing.two },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.one,
    paddingRight: Spacing.one,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  chipText: { fontSize: 12, fontWeight: "700" },
  clearAll: { fontSize: 12, fontWeight: "700" },
  errorRow: {
    alignItems: "center",
    paddingTop: Spacing.five,
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  errorText: { fontSize: 14, textAlign: "center" },
  retryText: { color: BrandColors.primary, fontWeight: "700", fontSize: 14 },
  footer: { alignItems: "center", paddingVertical: Spacing.three },
  footerText: { fontSize: 13 },
});
