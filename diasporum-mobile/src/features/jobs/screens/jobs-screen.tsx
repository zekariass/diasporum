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
import { createCommunityApi } from "@/features/communities/services/community-api";
import { JobCard, JobCardSkeleton } from "../components/job-card";
import {
  countActiveFilters,
  EMPTY_JOB_FILTERS,
  EMPLOYMENT_TYPES,
  FiltersSheet,
  jobPublishedFrom,
  LocationSheet,
  SortSheet,
  sortLabel,
  type CommunityOption,
  type JobsFilterState,
  type JobSort,
} from "../components/job-discovery-sheets";
import { createJobApi } from "../services/job-api";
import type { JobCategory, JobItem } from "../types/job-types";
import { label } from "../utils/job-format";

type SheetKind = "location" | "filters" | "sort";

export default function JobsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient, session } = useSession();
  const api = React.useMemo(() => createJobApi(apiClient), [apiClient]);
  const [categories, setCategories] = useState<JobCategory[]>([]);
  const [communities, setCommunities] = useState<CommunityOption[]>([]);
  const [items, setItems] = useState<JobItem[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState<JobsFilterState>(EMPTY_JOB_FILTERS);
  const [sort, setSort] = useState<JobSort>("NEWEST");
  const [sheet, setSheet] = useState<SheetKind | null>(null);
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

  useEffect(() => {
    const memberships = (session?.memberships ?? []).filter(
      (membership) => membership.status === "ACTIVE",
    );
    if (!memberships.length) return;
    let active = true;
    const communityApi = createCommunityApi(apiClient);
    void Promise.all(
      memberships.map((membership) =>
        communityApi
          .community(membership.communityId)
          .then((community) => ({ id: community.id, name: community.name }))
          .catch(() => null),
      ),
    ).then((list) => {
      if (active) {
        setCommunities(list.filter((c): c is CommunityOption => c !== null));
      }
    });
    return () => {
      active = false;
    };
  }, [apiClient, session]);

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
            entry.job.id === item.job.id ? { ...entry, saved: item.saved } : entry,
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
  const filtered = filterCount > 0 || Boolean(debouncedSearch) || sort !== "NEWEST";
  const locationLabel = filters.city.trim()
    || communities.find((community) => community.id === filters.communityId)?.name
    || (filters.communityId ? "Selected community" : "Anywhere");
  const countLabel = items.length === 1 && !cursor
    ? "1 job"
    : `${items.length}${cursor ? "+" : ""} jobs`;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <ThemedText type="title">Jobs</ThemedText>
          <View style={styles.headerActions}>
            <HeaderButton
              icon="document-text-outline"
              label="My applications"
              onPress={() => router.push("/(app)/jobs/my-applications" as never)}
            />
            <HeaderButton
              icon="bookmark-outline"
              label="Saved jobs"
              onPress={() => router.push("/(app)/jobs/saved" as never)}
            />
            <HeaderButton
              icon="person-outline"
              label="My job listings"
              onPress={() => router.push("/(app)/jobs/my" as never)}
            />
            <HeaderButton
              icon="add"
              label="Create job"
              onPress={() => router.push("/(app)/jobs/create" as never)}
              filled
            />
          </View>
        </View>

        <View style={styles.intro}>
          <ThemedText style={styles.introTitle}>Find your next opportunity</ThemedText>
          <ThemedText style={styles.introText} themeColor="textSecondary">
            Discover jobs in your community and beyond.
          </ThemedText>
        </View>

        <View
          style={[
            styles.search,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
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
          />
          {search ? (
            <Pressable
              onPress={() => setSearch("")}
              accessibilityLabel="Clear search"
              accessibilityRole="button"
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.controls}>
          <Pressable
            onPress={() => setSheet("location")}
            accessibilityRole="button"
            accessibilityLabel={`Location: ${locationLabel}`}
            style={[styles.control, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
          >
            <Ionicons name="location-outline" size={16} color={BrandColors.primary} />
            <ThemedText style={styles.controlText} numberOfLines={1}>{locationLabel}</ThemedText>
            <Ionicons name="chevron-down" size={14} color={theme.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => setSheet("filters")}
            accessibilityRole="button"
            accessibilityLabel="Filters"
            style={[styles.control, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
          >
            <Ionicons name="options-outline" size={16} color={BrandColors.primary} />
            <ThemedText style={styles.controlText}>Filters</ThemedText>
            {filterCount ? (
              <View style={[styles.badge, { backgroundColor: BrandColors.primary }]}>
                <ThemedText style={styles.badgeText}>{filterCount}</ThemedText>
              </View>
            ) : (
              <Ionicons name="chevron-down" size={14} color={theme.textSecondary} />
            )}
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
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
                patchFilters({ employmentType: filters.employmentType === value ? null : value })
              }
            />
          ))}
        </ScrollView>

        <View style={styles.resultsRow}>
          <ThemedText style={styles.resultsCount} themeColor="textSecondary">
            {loading && items.length === 0 ? "Searching…" : items.length === 0 ? "" : countLabel}
          </ThemedText>
          <Pressable
            onPress={() => setSheet("sort")}
            accessibilityRole="button"
            accessibilityLabel="Sort jobs"
            style={styles.sortButton}
          >
            <ThemedText style={[styles.sortText, { color: BrandColors.primary }]}>
              {sortLabel(sort)}
            </ThemedText>
            <Ionicons name="chevron-down" size={14} color={BrandColors.primary} />
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
                <Ionicons name="cloud-offline-outline" size={40} color={theme.textSecondary} />
                <ThemedText style={styles.stateText}>{error}</ThemedText>
                <PrimaryButton label="Retry" variant="secondary" onPress={() => void loadPage()} />
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
                  <PrimaryButton label="Clear filters" variant="secondary" onPress={clearAll} />
                ) : null}
              </View>
            )
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator style={styles.footer} color={BrandColors.primary} />
            ) : undefined
          }
          contentContainerStyle={items.length === 0 ? styles.emptyContainer : styles.list}
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
        <FiltersSheet
          visible={sheet === "filters"}
          filters={filters}
          categories={categories}
          communities={communities}
          activeCommunityId={activeCommunityId}
          onApply={(next) => setFilters(next)}
          onClose={() => setSheet(null)}
        />
        <SortSheet
          visible={sheet === "sort"}
          value={sort}
          onApply={setSort}
          onClose={() => setSheet(null)}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function HeaderButton({
  icon,
  label: accessibilityLabel,
  onPress,
  filled = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  filled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.headerButton,
        filled && { backgroundColor: theme.text },
      ]}
    >
      <Ionicons
        name={icon}
        size={19}
        color={filled ? theme.background : theme.text}
      />
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
          backgroundColor: active ? BrandColors.primary : theme.backgroundElement,
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
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerActions: { flexDirection: "row", gap: 4 },
  headerButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  intro: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: 2 },
  introTitle: { fontSize: 20, lineHeight: 26, fontWeight: "800" },
  introText: { fontSize: 13, lineHeight: 18 },
  search: {
    marginTop: Spacing.three,
    marginHorizontal: Spacing.four,
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    height: 46,
    paddingHorizontal: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  searchInput: { flex: 1, height: "100%", fontSize: 14 },
  controls: {
    flexDirection: "row",
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
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
    maxWidth: "60%",
  },
  controlText: { fontSize: 13, fontWeight: "600", flexShrink: 1 },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  badgeText: { color: BrandColors.white, fontSize: 11, fontWeight: "800" },
  chips: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.one,
  },
  resultsCount: { fontSize: 13, fontWeight: "600" },
  sortButton: { flexDirection: "row", alignItems: "center", gap: 3, padding: Spacing.one },
  sortText: { fontSize: 13, fontWeight: "700" },
  list: { paddingVertical: Spacing.two },
  state: { alignItems: "center", padding: Spacing.five, gap: Spacing.three },
  stateText: { textAlign: "center", fontSize: 14 },
  footer: { padding: Spacing.four },
  emptyContainer: { flexGrow: 1 },
});
