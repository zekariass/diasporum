import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ApiError } from "@/core/api/api-error";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { PrimaryButton } from "@/shared/components/primary-button";
import { JobCard, JobCardSkeleton } from "../components/job-card";
import {
  countActiveFilters,
  EMPTY_JOB_FILTERS,
  EMPLOYMENT_TYPES,
  jobPublishedFrom,
  LocationSheet,
  SortSheet,
  sortLabel,
  type CommunityOption,
  type JobsFilterState,
  type JobSort,
} from "../components/job-discovery-sheets";
import { JobsFilterDrawer, JobsMenuDrawer } from "../components/job-drawers";
import { createJobApi } from "../services/job-api";
import type { JobCategory, JobItem } from "../types/job-types";
import { label } from "../utils/job-format";

type SheetKind = "location" | "sort";
type DrawerKind = "filters" | "menu";

export default function JobsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient, session } = useSession();
  const api = React.useMemo(() => createJobApi(apiClient), [apiClient]);
  const [categories, setCategories] = useState<JobCategory[]>([]);
  const [items, setItems] = useState<JobItem[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState<JobsFilterState>(EMPTY_JOB_FILTERS);
  const [sort, setSort] = useState<JobSort>("NEWEST");
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [drawer, setDrawer] = useState<DrawerKind | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    api
      .categories()
      .then((result) => setCategories(result.items))
      .catch(() => setCategories([]));
  }, [api]);

  const communities = React.useMemo<CommunityOption[]>(() => {
    const contexts = session?.access?.communities ?? [];
    return (session?.memberships ?? [])
      .filter((membership) => membership.status === "ACTIVE")
      .map((membership) => {
        const context = contexts.find(
          (candidate) => candidate.communityId === membership.communityId,
        );
        return context
          ? { id: context.communityId, name: context.communityName }
          : null;
      })
      .filter((c): c is CommunityOption => c !== null);
  }, [session]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const number = (value: string) =>
    value.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined;

  const loadPage = useCallback(
    (nextCursor?: string) => {
      if (loadingRef.current) return Promise.resolve();
      loadingRef.current = true;
      if (nextCursor) setLoadingMore(true);
      return api
        .discover(
          {
            communityId: filters.communityId ?? undefined,
            scope: filters.scope ?? undefined,
            categoryId: filters.categoryId ?? undefined,
            employmentType: filters.employmentType ?? undefined,
            workplaceType: filters.workplaceType ?? undefined,
            city: filters.city.trim() || undefined,
            salaryMin: number(filters.salaryMin),
            salaryMax: number(filters.salaryMax),
            publishedFrom: jobPublishedFrom(filters.datePosted),
            search: debouncedSearch || undefined,
            sort,
          },
          nextCursor,
          20,
        )
        .then((page) => {
          setItems((previous) => {
            if (!nextCursor) return page.items;
            const ids = new Set(previous.map((item) => item.job.id));
            return [
              ...previous,
              ...page.items.filter((item) => !ids.has(item.job.id)),
            ];
          });
          setCursor(page.nextCursor);
          setError(null);
        })
        .catch((cause: unknown) => {
          setError(
            ApiError.isApiError(cause)
              ? cause.userMessage
              : "Failed to load jobs.",
          );
        })
        .finally(() => {
          loadingRef.current = false;
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        });
    },
    [api, debouncedSearch, filters, sort],
  );

  const filterKey = JSON.stringify([filters, debouncedSearch, sort]);
  const [previousKey, setPreviousKey] = useState(filterKey);
  if (previousKey !== filterKey) {
    setPreviousKey(filterKey);
    setLoading(true);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPage();
  }, [loadPage]);

  const openJob = useCallback(
    (jobId: string) => router.push(`/(app)/jobs/${jobId}` as never),
    [router],
  );

  const toggleSave = useCallback(
    async (item: JobItem) => {
      const target = !item.saved;
      setItems((previous) =>
        previous.map((entry) =>
          entry.job.id === item.job.id ? { ...entry, saved: target } : entry,
        ),
      );
      try {
        if (target) await api.save(item.job.id);
        else await api.unsave(item.job.id);
      } catch {
        setItems((previous) =>
          previous.map((entry) =>
            entry.job.id === item.job.id
              ? { ...entry, saved: item.saved }
              : entry,
          ),
        );
      }
    },
    [api],
  );

  const patchFilters = useCallback((patch: Partial<JobsFilterState>) => {
    setFilters((current) => ({ ...current, ...patch }));
  }, []);

  const clearAll = useCallback(() => {
    setFilters(EMPTY_JOB_FILTERS);
    setSearch("");
  }, []);

  const activeCommunityId = session?.activeCommunityId ?? null;
  const filterCount = countActiveFilters(filters);
  const filtered =
    filterCount > 0 || Boolean(debouncedSearch) || sort !== "NEWEST";
  const locationLabel =
    filters.city.trim() ||
    communities.find((community) => community.id === filters.communityId)
      ?.name ||
    (filters.communityId ? "Selected community" : "Anywhere");
  const countLabel =
    items.length === 1 && !cursor
      ? "1 job"
      : `${items.length}${cursor ? "+" : ""} jobs`;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Pressable
            onPress={() => setDrawer("filters")}
            accessibilityRole="button"
            accessibilityLabel="Filters"
            style={[
              styles.headerIcon,
              { backgroundColor: theme.backgroundElement },
            ]}
          >
            <Ionicons
              name="options-outline"
              size={20}
              color={theme.text}
            />
            {filterCount > 0 ? (
              <View style={styles.headerBadge}>
                <ThemedText style={styles.headerBadgeText}>
                  {filterCount}
                </ThemedText>
              </View>
            ) : null}
          </Pressable>
          <View style={styles.headerCopy} />
          <PostJobButton
            onPress={() => router.push("/(app)/jobs/create" as never)}
          />
          <Pressable
            onPress={() => setDrawer("menu")}
            accessibilityRole="button"
            accessibilityLabel="Jobs menu"
            style={[
              styles.headerIcon,
              { backgroundColor: theme.backgroundElement },
            ]}
          >
            <Ionicons name="menu" size={22} color={theme.text} />
          </Pressable>
        </View>

        <View
          style={[
            styles.search,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
            },
          ]}
        >
          <Ionicons name="search" size={18} color={theme.textSecondary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Job title, company or keyword"
            placeholderTextColor={theme.textSecondary}
            accessibilityLabel="Search jobs"
            style={[styles.searchInput, { color: theme.text }]}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={() => setDebouncedSearch(search.trim())}
          />
          {search ? (
            <Pressable
              onPress={() => setSearch("")}
              accessibilityLabel="Clear search"
              accessibilityRole="button"
              hitSlop={8}
            >
              <Ionicons
                name="close-circle"
                size={18}
                color={theme.textSecondary}
              />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.controls}>
          <Pressable
            onPress={() => setSheet("location")}
            accessibilityRole="button"
            accessibilityLabel={`Location: ${locationLabel}`}
            style={[
              styles.control,
              {
                borderColor: theme.border,
                backgroundColor: theme.backgroundElement,
              },
            ]}
          >
            <Ionicons
              name="location-outline"
              size={16}
              color={BrandColors.primary}
            />
            <ThemedText style={styles.controlText} numberOfLines={1}>
              {locationLabel}
            </ThemedText>
            <Ionicons
              name="chevron-down"
              size={14}
              color={theme.textSecondary}
            />
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsScroll}
          contentContainerStyle={styles.chips}
        >
          <QuickChip
            text="All Jobs"
            active={filters.employmentType === null}
            onPress={() => patchFilters({ employmentType: null })}
          />
          {EMPLOYMENT_TYPES.map((value) => (
            <QuickChip
              key={value}
              text={label(value)}
              active={filters.employmentType === value}
              onPress={() =>
                patchFilters({
                  employmentType:
                    filters.employmentType === value ? null : value,
                })
              }
            />
          ))}
        </ScrollView>

        <View style={styles.resultsRow}>
          <ThemedText style={styles.resultsCount} themeColor="textSecondary">
            {loading && items.length === 0
              ? "Searching…"
              : items.length === 0
                ? ""
                : countLabel}
          </ThemedText>
          <Pressable
            onPress={() => setSheet("sort")}
            accessibilityRole="button"
            accessibilityLabel="Sort jobs"
            style={styles.sortButton}
          >
            <ThemedText
              style={[styles.sortText, { color: BrandColors.primary }]}
            >
              {sortLabel(sort)}
            </ThemedText>
            <Ionicons
              name="chevron-down"
              size={14}
              color={BrandColors.primary}
            />
          </Pressable>
        </View>

        <FlatList
          testID="jobs-discovery-list"
          data={items}
          keyExtractor={(item) => item.job.id}
          renderItem={({ item }) => (
            <JobCard item={item} onPress={openJob} onToggleSave={toggleSave} />
          )}
          onEndReached={() => {
            if (cursor && !loadingRef.current) void loadPage(cursor);
          }}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void loadPage();
              }}
              tintColor={BrandColors.primary}
            />
          }
          ListHeaderComponent={
            error && items.length > 0 ? (
              <View style={styles.state} accessibilityRole="alert">
                <ThemedText style={styles.stateText}>{error}</ThemedText>
              </View>
            ) : undefined
          }
          ListEmptyComponent={
            loading && !refreshing ? (
              <View>
                <JobCardSkeleton />
                <JobCardSkeleton />
                <JobCardSkeleton />
              </View>
            ) : error ? (
              <View style={styles.state} accessibilityRole="alert">
                <Ionicons
                  name="cloud-offline-outline"
                  size={40}
                  color={theme.textSecondary}
                />
                <ThemedText style={styles.stateText}>{error}</ThemedText>
                <PrimaryButton
                  label="Retry"
                  variant="secondary"
                  onPress={() => void loadPage()}
                />
              </View>
            ) : (
              <View style={styles.state}>
                <Ionicons
                  name="briefcase-outline"
                  size={40}
                  color={theme.textSecondary}
                />
                <ThemedText type="subtitle">No jobs found</ThemedText>
                <ThemedText style={styles.stateText} themeColor="textSecondary">
                  {filtered
                    ? "Try changing your search or filters to find more opportunities."
                    : "New opportunities will appear here."}
                </ThemedText>
                {filtered ? (
                  <PrimaryButton
                    label="Clear filters"
                    variant="secondary"
                    onPress={clearAll}
                  />
                ) : null}
              </View>
            )
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator
                style={styles.footer}
                color={BrandColors.primary}
              />
            ) : undefined
          }
          contentContainerStyle={
            items.length === 0 ? styles.emptyContainer : styles.list
          }
        />

        <LocationSheet
          visible={sheet === "location"}
          communities={communities}
          activeCommunityId={activeCommunityId}
          communityId={filters.communityId}
          city={filters.city}
          onApply={(value) => patchFilters(value)}
          onClose={() => setSheet(null)}
        />
        <SortSheet
          visible={sheet === "sort"}
          value={sort}
          onApply={setSort}
          onClose={() => setSheet(null)}
        />
        {drawer === "filters" ? (
          <JobsFilterDrawer
            filters={filters}
            categories={categories}
            communities={communities}
            activeCommunityId={activeCommunityId}
            onApply={(next) => {
              setFilters(next);
              setDrawer(null);
            }}
            onClose={() => setDrawer(null)}
          />
        ) : null}
        {drawer === "menu" ? (
          <JobsMenuDrawer onClose={() => setDrawer(null)} />
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

function PostJobButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Create job"
      style={({ pressed }) => [
        styles.postButton,
        { backgroundColor: theme.primary },
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name="add" size={19} color={BrandColors.white} />
      <ThemedText style={styles.postButtonText}>Post a job</ThemedText>
    </Pressable>
  );
}

function QuickChip({
  text,
  active,
  onPress,
}: {
  text: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{ selected: active }}
      style={[
        styles.chip,
        {
          backgroundColor: active
            ? BrandColors.primary
            : theme.backgroundElement,
          borderColor: active ? BrandColors.primary : theme.border,
        },
      ]}
    >
      <ThemedText style={[styles.chipText, active && styles.activeChip]}>
        {text}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
    paddingHorizontal: 12,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCopy: { flex: 1, gap: 1 },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 17,
    height: 17,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 4,
    backgroundColor: BrandColors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBadgeText: {
    color: BrandColors.white,
    fontSize: 10,
    fontWeight: "800",
  },
  postButton: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.three,
  },
  postButtonText: { color: BrandColors.white, fontSize: 13, fontWeight: "700" },
  pressed: { opacity: 0.72 },
  search: {
    marginTop: Spacing.two,
    marginHorizontal: 12,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    height: 48,
    paddingHorizontal: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  searchInput: { flex: 1, height: "100%", fontSize: 14 },
  controls: {
    flexDirection: "row",
    gap: Spacing.two,
    paddingHorizontal: 12,
    marginTop: Spacing.two,
  },
  control: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 40,
    flex: 1,
  },
  controlText: { fontSize: 13, fontWeight: "600", flexShrink: 1 },
  chipsScroll: { flexGrow: 0 },
  chips: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: 12,
    paddingVertical: Spacing.two,
  },
  chip: {
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontSize: 12, fontWeight: "600" },
  activeChip: { color: BrandColors.white },
  resultsRow: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: Spacing.one,
  },
  resultsCount: { fontSize: 13, fontWeight: "700" },
  sortButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    padding: Spacing.one,
  },
  sortText: { fontSize: 13, fontWeight: "700" },
  list: { paddingVertical: Spacing.two },
  state: { alignItems: "center", padding: Spacing.five, gap: Spacing.three },
  stateText: { textAlign: "center", fontSize: 14 },
  footer: { padding: Spacing.four },
  emptyContainer: { flexGrow: 1 },
});
