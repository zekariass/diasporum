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
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ApiError } from "@/core/api/api-error";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { BusinessCard } from "../components/business-card";
import {
  DirectoryChip,
  DirectoryEmpty,
  DirectoryInput,
  DirectoryMessage,
} from "../components/directory-ui";
import { createDirectoryApi } from "../services/directory-api";
import type {
  Business,
  BusinessCategory,
  DiscoveryFilters,
} from "../types/directory-types";

export default function BusinessesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient, session } = useSession();
  const api = React.useMemo(() => createDirectoryApi(apiClient), [apiClient]);
  const [categories, setCategories] = useState<BusinessCategory[]>([]);
  const [items, setItems] = useState<Business[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [communityOnly, setCommunityOnly] = useState(false);
  const [city, setCity] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [showNearby, setShowNearby] = useState(false);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [radius, setRadius] = useState("25");
  const [sort, setSort] = useState<"newest" | "distance">("newest");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const countryId = session?.profile?.currentCountryId ?? undefined;
  const activeCommunityId = session?.activeCommunityId ?? undefined;

  useEffect(() => {
    api
      .categories(countryId)
      .then((result) => setCategories(result.items))
      .catch(() => setCategories([]));
  }, [api, countryId]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const loadPage = useCallback(
    (nextCursor?: string) => {
      if (loadingRef.current) return Promise.resolve();
      loadingRef.current = true;
      const lat = latitude.trim() ? Number(latitude) : undefined;
      const lon = longitude.trim() ? Number(longitude) : undefined;
      const radiusKm = radius.trim() ? Number(radius) : undefined;
      const coordinatesValid =
        lat !== undefined &&
        lon !== undefined &&
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        lat >= -90 &&
        lat <= 90 &&
        lon >= -180 &&
        lon <= 180;
      const filters: DiscoveryFilters = {
        countryId,
        communityId: communityOnly ? activeCommunityId : undefined,
        categoryId: categoryId ?? undefined,
        city: city.trim() || undefined,
        search: debouncedSearch || undefined,
        verifiedOnly: verifiedOnly || undefined,
        latitude: coordinatesValid ? lat : undefined,
        longitude: coordinatesValid ? lon : undefined,
        radiusMeters:
          coordinatesValid && radiusKm && radiusKm > 0
            ? Math.round(radiusKm * 1000)
            : undefined,
        sort,
      };
      return Promise.resolve()
        .then(() => {
          if (nextCursor) setLoadingMore(true);
          if (
            (sort === "distance" && !coordinatesValid) ||
            (radius.trim() &&
              (!Number.isFinite(radiusKm) || !radiusKm || radiusKm <= 0))
          ) {
            throw new Error(
              "Enter valid latitude, longitude, and a radius above zero for nearby search.",
            );
          }
          return api.discover(filters, nextCursor, 20);
        })
        .then((page) => {
          setItems((previous) => {
            if (!nextCursor) return page.items;
            const seen = new Set(previous.map((item) => item.id));
            return [
              ...previous,
              ...page.items.filter((item) => !seen.has(item.id)),
            ];
          });
          setCursor(page.nextCursor);
          setError(null);
        })
        .catch((cause: unknown) => {
          setError(
            ApiError.isApiError(cause)
              ? cause.userMessage
              : cause instanceof Error
                ? cause.message
                : "Failed to load businesses.",
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
      activeCommunityId,
      categoryId,
      city,
      communityOnly,
      countryId,
      debouncedSearch,
      latitude,
      longitude,
      radius,
      sort,
      verifiedOnly,
    ],
  );

  const filterKey = `${categoryId}|${communityOnly}|${city}|${verifiedOnly}|${debouncedSearch}|${latitude}|${longitude}|${radius}|${sort}`;
  const [previousFilterKey, setPreviousFilterKey] = useState(filterKey);
  if (previousFilterKey !== filterKey) {
    setPreviousFilterKey(filterKey);
    setLoading(true);
  }

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void loadPage();
  }, [loadPage]);

  if (loading && items.length === 0 && !refreshing) return <LoadingScreen />;

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <ThemedText type="title">Businesses</ThemedText>
          <View style={styles.headerActions}>
            <HeaderButton
              label="Saved businesses"
              icon="bookmark-outline"
              onPress={() => router.push("/(app)/businesses/saved" as never)}
            />
            <HeaderButton
              label="Manage business profiles"
              icon="briefcase-outline"
              onPress={() => router.push("/(app)/businesses/manage" as never)}
            />
            <HeaderButton
              label="Create business profile"
              icon="add"
              onPress={() => router.push("/(app)/businesses/create" as never)}
              primary
            />
          </View>
        </View>

        <View
          style={[
            styles.search,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}
        >
          <Ionicons name="search-outline" size={18} color={theme.textSecondary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search businesses…"
            placeholderTextColor={theme.textSecondary}
            accessibilityLabel="Search businesses"
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.searchInput, { color: theme.text }]}
          />
          {search ? (
            <Pressable onPress={() => setSearch("")} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.filters}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              <DirectoryChip
                label="All categories"
                active={categoryId === null}
                onPress={() => setCategoryId(null)}
              />
              {categories.map((category) => (
                <DirectoryChip
                  key={category.id}
                  label={category.name}
                  active={categoryId === category.id}
                  onPress={() =>
                    setCategoryId(categoryId === category.id ? null : category.id)
                  }
                />
              ))}
            </View>
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              <DirectoryChip
                label="All visible"
                active={!communityOnly}
                onPress={() => setCommunityOnly(false)}
              />
              {activeCommunityId ? (
                <DirectoryChip
                  label="My community"
                  active={communityOnly}
                  onPress={() => setCommunityOnly(true)}
                />
              ) : null}
              <DirectoryChip
                label="Verified only"
                active={verifiedOnly}
                onPress={() => setVerifiedOnly((value) => !value)}
              />
              <DirectoryChip
                label="Newest"
                active={sort === "newest"}
                onPress={() => setSort("newest")}
              />
              <DirectoryChip
                label="Nearest"
                active={sort === "distance"}
                onPress={() => {
                  setSort("distance");
                  setShowNearby(true);
                }}
              />
              <DirectoryChip
                label="Nearby filters"
                active={showNearby}
                onPress={() => setShowNearby((value) => !value)}
              />
            </View>
          </ScrollView>
          <View style={styles.cityInput}>
            <DirectoryInput
              label="City filter"
              value={city}
              onChangeText={setCity}
              placeholder="Filter by branch city"
            />
          </View>
          {showNearby ? (
            <View style={styles.nearbyPanel}>
              <ThemedText style={styles.filterTitle}>Nearby search</ThemedText>
              <ThemedText style={styles.filterHint} themeColor="textSecondary">
                Enter discovery coordinates and a radius in kilometres. Exact
                private address points are never requested.
              </ThemedText>
              <View style={styles.coordinateRow}>
                <View style={styles.coordinateField}>
                  <DirectoryInput
                    label="Latitude"
                    value={latitude}
                    onChangeText={setLatitude}
                    placeholder="52.5200"
                    keyboardType="decimal-pad"
                    autoCapitalize="none"
                  />
                </View>
                <View style={styles.coordinateField}>
                  <DirectoryInput
                    label="Longitude"
                    value={longitude}
                    onChangeText={setLongitude}
                    placeholder="13.4050"
                    keyboardType="decimal-pad"
                    autoCapitalize="none"
                  />
                </View>
                <View style={styles.radiusField}>
                  <DirectoryInput
                    label="Radius (km)"
                    value={radius}
                    onChangeText={setRadius}
                    keyboardType="decimal-pad"
                    autoCapitalize="none"
                  />
                </View>
              </View>
            </View>
          ) : null}
        </View>

        {error ? (
          <View style={styles.errorWrap}>
            <DirectoryMessage error>{error}</DirectoryMessage>
            <Pressable onPress={() => void loadPage()} accessibilityLabel="Retry businesses">
              <ThemedText style={styles.retry}>Try again</ThemedText>
            </Pressable>
          </View>
        ) : null}

        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <BusinessCard
              business={item}
              onPress={() =>
                router.push(`/(app)/businesses/${item.id}` as never)
              }
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={BrandColors.primary}
            />
          }
          onEndReached={() => {
            if (cursor && !loadingRef.current) void loadPage(cursor);
          }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            loading ? undefined : (
              <DirectoryEmpty
                title="No businesses found"
                body="Try another search or clear some filters. New public profiles will appear here after publication."
              />
            )
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={BrandColors.primary} style={styles.more} />
            ) : undefined
          }
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function HeaderButton({
  label,
  icon,
  onPress,
  primary = false,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  primary?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.headerButton, primary && { backgroundColor: theme.text }]}
    >
      <Ionicons
        name={icon}
        size={20}
        color={primary ? theme.background : theme.text}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    minHeight: 58,
    paddingHorizontal: Spacing.four,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerActions: { flexDirection: "row", gap: Spacing.two },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  search: {
    height: 44,
    margin: Spacing.four,
    marginBottom: Spacing.two,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  searchInput: { flex: 1, fontSize: 15, height: "100%" },
  filters: { gap: Spacing.two, paddingBottom: Spacing.two },
  chipRow: {
    flexDirection: "row",
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  cityInput: { paddingHorizontal: Spacing.four },
  nearbyPanel: { paddingHorizontal: Spacing.four, gap: 5 },
  filterTitle: { fontSize: 13, fontWeight: "800" },
  filterHint: { fontSize: 11, lineHeight: 16 },
  coordinateRow: { flexDirection: "row", gap: Spacing.two },
  coordinateField: { flex: 1 },
  radiusField: { width: 92 },
  errorWrap: {
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  retry: { color: BrandColors.primary, fontWeight: "700" },
  list: { padding: Spacing.four, gap: Spacing.three, flexGrow: 1 },
  more: { padding: Spacing.three },
});
