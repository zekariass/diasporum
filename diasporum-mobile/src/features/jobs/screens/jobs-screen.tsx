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
import { JobCard } from "../components/job-card";
import { createJobApi } from "../services/job-api";
import type {
  EmploymentType,
  JobCategory,
  JobItem,
  VisibilityScope,
  WorkplaceType,
} from "../types/job-types";
import { label } from "../utils/job-format";

const EMPLOYMENT: EmploymentType[] = [
  "PERMANENT",
  "FIXED_TERM",
  "CONTRACT",
  "TEMPORARY",
  "INTERNSHIP",
  "FREELANCE",
];
const WORKPLACES: WorkplaceType[] = ["ONSITE", "HYBRID", "REMOTE"];

export default function JobsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient } = useSession();
  const api = React.useMemo(() => createJobApi(apiClient), [apiClient]);
  const [categories, setCategories] = useState<JobCategory[]>([]);
  const [items, setItems] = useState<JobItem[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [scope, setScope] = useState<VisibilityScope | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [employmentType, setEmploymentType] = useState<EmploymentType | null>(
    null,
  );
  const [workplaceType, setWorkplaceType] = useState<WorkplaceType | null>(
    null,
  );
  const [sort, setSort] = useState<"NEWEST" | "CLOSING">("NEWEST");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [city, setCity] = useState("");
  const [salaryMin, setSalaryMin] = useState("");
  const [salaryMax, setSalaryMax] = useState("");
  const [publishedFrom, setPublishedFrom] = useState("");
  const [publishedTo, setPublishedTo] = useState("");
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
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const loadPage = useCallback(
    (nextCursor?: string) => {
      if (loadingRef.current) return Promise.resolve();
      loadingRef.current = true;
      if (nextCursor) setLoadingMore(true);
      const number = (value: string) =>
        value.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined;
      const date = (value: string, end = false) =>
        /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? `${value}T${end ? "23:59:59" : "00:00:00"}Z`
          : undefined;
      return api
        .discover(
          {
            scope: scope ?? undefined,
            categoryId: categoryId ?? undefined,
            employmentType: employmentType ?? undefined,
            workplaceType: workplaceType ?? undefined,
            city: city.trim() || undefined,
            salaryMin: number(salaryMin),
            salaryMax: number(salaryMax),
            publishedFrom: date(publishedFrom),
            publishedTo: date(publishedTo, true),
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
    [
      api,
      categoryId,
      city,
      debouncedSearch,
      employmentType,
      publishedFrom,
      publishedTo,
      salaryMax,
      salaryMin,
      scope,
      sort,
      workplaceType,
    ],
  );

  const filterKey = JSON.stringify([
    scope,
    categoryId,
    employmentType,
    workplaceType,
    city,
    salaryMin,
    salaryMax,
    publishedFrom,
    publishedTo,
    debouncedSearch,
    sort,
  ]);
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
  const filtered = filterKey !== JSON.stringify([
    null, null, null, null, "", "", "", "", "", "", "NEWEST",
  ]);

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
        <View
          style={[
            styles.search,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}
        >
          <Ionicons name="search" size={17} color={theme.textSecondary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search title, employer or description"
            placeholderTextColor={theme.textSecondary}
            style={[styles.searchInput, { color: theme.text }]}
            returnKeyType="search"
          />
          <Pressable
            onPress={() => setShowAdvanced((value) => !value)}
            accessibilityLabel="Toggle advanced job filters"
            accessibilityRole="button"
          >
            <Ionicons name="options-outline" size={20} color={theme.text} />
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          <Chip
            text="All jobs"
            active={scope === null}
            onPress={() => setScope(null)}
          />
          <Chip
            text="Community"
            active={scope === "COMMUNITY"}
            onPress={() => setScope("COMMUNITY")}
          />
          <Chip
            text="Country"
            active={scope === "COUNTRY"}
            onPress={() => setScope("COUNTRY")}
          />
          <Chip
            text="Newest"
            active={sort === "NEWEST"}
            onPress={() => setSort("NEWEST")}
          />
          <Chip
            text="Closing soon"
            active={sort === "CLOSING"}
            onPress={() => setSort("CLOSING")}
          />
          {WORKPLACES.map((value) => (
            <Chip
              key={value}
              text={label(value)}
              active={workplaceType === value}
              onPress={() =>
                setWorkplaceType(workplaceType === value ? null : value)
              }
            />
          ))}
          {categories.map((category) => (
            <Chip
              key={category.id}
              text={category.displayName}
              active={categoryId === category.id}
              onPress={() =>
                setCategoryId(categoryId === category.id ? null : category.id)
              }
            />
          ))}
        </ScrollView>
        {showAdvanced ? (
          <View
            style={[
              styles.advanced,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border },
            ]}
          >
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chips}>
                {EMPLOYMENT.map((value) => (
                  <Chip
                    key={value}
                    text={label(value)}
                    active={employmentType === value}
                    onPress={() =>
                      setEmploymentType(employmentType === value ? null : value)
                    }
                  />
                ))}
              </View>
            </ScrollView>
            <View style={styles.advancedGrid}>
              <FilterInput label="City" value={city} onChangeText={setCity} />
              <FilterInput
                label="Minimum salary"
                value={salaryMin}
                onChangeText={setSalaryMin}
                numeric
              />
              <FilterInput
                label="Maximum salary"
                value={salaryMax}
                onChangeText={setSalaryMax}
                numeric
              />
              <FilterInput
                label="Published from (YYYY-MM-DD)"
                value={publishedFrom}
                onChangeText={setPublishedFrom}
              />
              <FilterInput
                label="Published to (YYYY-MM-DD)"
                value={publishedTo}
                onChangeText={setPublishedTo}
              />
            </View>
          </View>
        ) : null}
        <FlatList
          testID="jobs-discovery-list"
          data={items}
          keyExtractor={(item) => item.job.id}
          renderItem={({ item }) => <JobCard item={item} onPress={openJob} />}
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
            loading && !refreshing ? (
              <ActivityIndicator
                style={styles.state}
                color={BrandColors.primary}
                accessibilityLabel="Loading jobs"
              />
            ) : error && !refreshing ? (
              <View style={styles.state} accessibilityRole="alert">
                <ThemedText style={styles.stateText}>{error}</ThemedText>
                <Pressable onPress={() => void loadPage()} accessibilityRole="button">
                  <ThemedText style={styles.retry}>Retry</ThemedText>
                </Pressable>
              </View>
            ) : undefined
          }
          ListEmptyComponent={
            !loading && !error ? (
              <View style={styles.state}>
                <Ionicons
                  name="briefcase-outline"
                  size={40}
                  color={theme.textSecondary}
                />
                <ThemedText type="subtitle">No jobs found</ThemedText>
                <ThemedText style={styles.stateText} themeColor="textSecondary">
                  {filtered
                    ? "Try changing or clearing your filters."
                    : "New opportunities will appear here."}
                </ThemedText>
              </View>
            ) : undefined
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator style={styles.footer} color={BrandColors.primary} />
            ) : undefined
          }
          contentContainerStyle={items.length === 0 ? styles.emptyContainer : styles.list}
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

export function Chip({
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

function FilterInput({
  label: placeholder,
  value,
  onChangeText,
  numeric = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  numeric?: boolean;
}) {
  const theme = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.textSecondary}
      keyboardType={numeric ? "decimal-pad" : "default"}
      style={[
        styles.filterInput,
        { color: theme.text, borderColor: theme.border, backgroundColor: theme.background },
      ]}
    />
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
  search: {
    margin: Spacing.three,
    marginHorizontal: Spacing.four,
    borderWidth: 1,
    borderRadius: 12,
    height: 44,
    paddingHorizontal: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  searchInput: { flex: 1, height: "100%", fontSize: 14 },
  chips: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.one,
  },
  chip: {
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontSize: 12, fontWeight: "600" },
  activeChip: { color: BrandColors.white },
  advanced: {
    marginHorizontal: Spacing.four,
    marginVertical: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: Spacing.two,
  },
  advancedGrid: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  filterInput: {
    borderWidth: 1,
    borderRadius: 9,
    minHeight: 40,
    paddingHorizontal: Spacing.two,
    fontSize: 13,
  },
  list: { paddingVertical: Spacing.two },
  state: { alignItems: "center", padding: Spacing.five, gap: Spacing.two },
  stateText: { textAlign: "center", fontSize: 14 },
  retry: { color: BrandColors.primary, fontWeight: "700" },
  footer: { padding: Spacing.four },
  emptyContainer: { flexGrow: 1 },
});
