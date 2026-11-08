import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { Sheet } from "@/shared/components/sheet";
import { ChoiceChip } from "@/shared/components/form-controls";
import { createPropertyApi } from "../services/property-api";
import type {
  ListingPurpose,
  PropertyDiscoveryFilters,
  PropertySort,
  PropertyType,
} from "../types/property-types";
import { PropertyCard } from "../components/property-card";
import {
  PropertiesEmpty,
  PropertiesSkeleton,
  PropertyListError,
} from "../components/property-states";
import {
  PropertyFiltersSheet,
  type FilterSection,
} from "../components/property-filters-sheet";
import { usePropertyPage } from "../hooks/use-property-page";
import {
  activeFilterCount,
  discoveryFilters,
  emptyFilters,
  normalizeFilters,
} from "../utils/property-filters";

const SORTS: { value: PropertySort; label: string }[] = [
  { value: "NEWEST", label: "Newest first" },
  { value: "PRICE_ASC", label: "Price: low to high" },
  { value: "PRICE_DESC", label: "Price: high to low" },
];

const MENU: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  route: string;
}[] = [
  {
    label: "My properties",
    icon: "person-outline",
    route: "/(app)/properties/my",
  },
  {
    label: "Create property",
    icon: "add-circle-outline",
    route: "/(app)/properties/create",
  },
  {
    label: "Saved properties",
    icon: "bookmark-outline",
    route: "/(app)/properties/saved",
  },
];

export default function PropertiesScreen() {
  const { session } = useSession();
  // Country/community changes reset the entire discovery state, including stale filters.
  return (
    <PropertyBrowser
      key={`${session?.me.id}:${session?.profile?.currentCountryId}:${session?.activeCommunityId}`}
    />
  );
}
function PropertyBrowser() {
  const theme = useTheme();
  const accent = theme.info;
  const router = useRouter();
  const { apiClient, session } = useSession();
  const api = useMemo(() => createPropertyApi(apiClient), [apiClient]);
  const countryId = session?.profile?.currentCountryId ?? undefined;
  const communityId = session?.activeCommunityId ?? undefined;
  const [types, setTypes] = useState<PropertyType[]>([]);
  const [typesError, setTypesError] = useState(false);
  const [typesRetry, setTypesRetry] = useState(0);
  const [applied, setApplied] = useState(() => emptyFilters());
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<PropertySort>("NEWEST");
  const [section, setSection] = useState<FilterSection | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [nearby, setNearby] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [radiusKm, setRadiusKm] = useState(25);

  useEffect(() => {
    let active = true;
    if (countryId)
      api
        .types(countryId)
        .then((page) => {
          if (active) {
            setTypes(page.items);
            setTypesError(false);
          }
        })
        .catch(() => {
          if (active) setTypesError(true);
        });
    return () => {
      active = false;
    };
  }, [api, countryId, typesRetry]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const context: PropertyDiscoveryFilters = {
    countryId,
    communityId,
    search: debouncedSearch || undefined,
  };
  const queryKey = JSON.stringify({
    ...context,
    ...discoveryFilters(applied),
    sort,
    ...(nearby ? { ...nearby, radiusKm } : {}),
  });
  const fetchPage = useCallback(
    (cursor?: string) =>
      api.discover(
        JSON.parse(queryKey) as PropertyDiscoveryFilters,
        cursor,
        20,
      ),
    [api, queryKey],
  );
  const results = usePropertyPage(fetchPage);
  const active = activeFilterCount(applied) + (nearby ? 1 : 0);
  const clear = () => {
    setApplied(emptyFilters(applied.listingPurpose));
    setSearch("");
    setNearby(null);
    setRadiusKm(25);
  };
  const openDetail = useCallback(
    (id: string) =>
      router.push(`/(app)/properties/${encodeURIComponent(id)}` as never),
    [router],
  );
  const priceLabel = () => {
    const { minPrice, maxPrice, currencyCode } = applied;
    if (!minPrice && !maxPrice) return "Any price";
    const money = (raw: string) => {
      const amount = Number(raw);
      return currencyCode
        ? `${currencyCode} ${amount.toLocaleString()}`
        : amount.toLocaleString();
    };
    if (minPrice && maxPrice) return `${money(minPrice)} – ${money(maxPrice)}`;
    return minPrice ? `${money(minPrice)}+` : `Up to ${money(maxPrice)}`;
  };
  const count = results.page.totalCount;
  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <SafeAreaView
        edges={["top"]}
        style={{ backgroundColor: theme.backgroundElement }}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Menu"
            onPress={() => setMenuOpen(true)}
            style={styles.headerButton}
          >
            <Ionicons name="menu" size={24} color={theme.text} />
          </Pressable>
          <View
            style={[styles.divider, { backgroundColor: theme.border }]}
          />
          <View style={styles.brand}>
            <View style={[styles.brandMark, { borderColor: accent }]}>
              <Ionicons name="home" size={15} color={accent} />
            </View>
            <ThemedText style={[styles.brandText, { color: accent }]}>
              Diasporum
            </ThemedText>
          </View>
          <View style={styles.spacer} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Saved properties"
            onPress={() => router.push("/(app)/properties/saved" as never)}
            style={styles.headerButton}
          >
            <ThemedText style={[styles.savedText, { color: accent }]}>
              Saved
            </ThemedText>
          </Pressable>
        </View>
        <View style={[styles.accentLine, { backgroundColor: accent }]} />
      </SafeAreaView>
      <SafeAreaView edges={["left", "right", "bottom"]} style={styles.root}>
        <FlatList
          data={
            results.loading && !results.refreshing ? [] : results.page.items
          }
          keyExtractor={(item) => item.property.id}
          renderItem={({ item }) => (
            <PropertyCard item={item} onPress={openDetail} origin={nearby} />
          )}
          onEndReached={results.more}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={results.refreshing}
              onRefresh={results.refresh}
              tintColor={accent}
            />
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          ListHeaderComponent={
            <>
              <View style={styles.searchRow}>
                <View
                  style={[
                    styles.search,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <Ionicons
                    name="search-outline"
                    size={18}
                    color={theme.textSecondary}
                  />
                  <TextInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Search city, area or property..."
                    placeholderTextColor={theme.textSecondary}
                    accessibilityLabel="Search properties"
                    style={[styles.searchInput, { color: theme.text }]}
                  />
                  {search ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Clear search"
                      onPress={() => setSearch("")}
                      style={[styles.clearBox, { borderColor: theme.border }]}
                    >
                      <Ionicons name="close" size={13} color={theme.text} />
                    </Pressable>
                  ) : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    active ? `Filters (${active})` : "Filters"
                  }
                  onPress={() => setSection("all")}
                  style={[
                    styles.filterButton,
                    {
                      borderColor: active ? accent : theme.border,
                      backgroundColor: theme.backgroundElement,
                    },
                  ]}
                >
                  <Ionicons
                    name="options-outline"
                    size={19}
                    color={active ? accent : theme.text}
                  />
                  {active ? (
                    <View
                      style={[styles.filterDot, { backgroundColor: accent }]}
                    />
                  ) : null}
                </Pressable>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.toolbar}
              >
                <PurposeChips
                  value={applied.listingPurpose}
                  onChange={(listingPurpose) =>
                    setApplied((previous) =>
                      normalizeFilters({ ...previous, listingPurpose }, types),
                    )
                  }
                />
                <Shortcut
                  label={priceLabel()}
                  selected={Boolean(
                    applied.minPrice ||
                    applied.maxPrice ||
                    applied.currencyCode,
                  )}
                  onPress={() => setSection("price")}
                />
                <Shortcut
                  label={
                    applied.bedrooms
                      ? `${applied.bedrooms}${applied.bedrooms === "4" ? "+" : ""} ${applied.bedrooms === "1" ? "bed" : "beds"}`
                      : "Any beds"
                  }
                  selected={Boolean(applied.bedrooms)}
                  onPress={() => setSection("bedrooms")}
                />
                <Shortcut
                  label={nearby ? `Within ${radiusKm} km` : "Any distance"}
                  selected={Boolean(nearby)}
                  onPress={() => setSection("location")}
                />
                <Shortcut
                  label={
                    types.find((type) => type.id === applied.propertyTypeId)
                      ?.displayName ?? "Any type"
                  }
                  selected={Boolean(applied.propertyTypeId)}
                  onPress={() => setSection("type")}
                />
                {active || search ? (
                  <Shortcut
                    label="Clear"
                    icon="close"
                    accessibilityLabel="Clear property filters"
                    onPress={clear}
                  />
                ) : null}
              </ScrollView>
              <View style={styles.actions}>
                <ActionButton
                  label="My properties"
                  icon="person-outline"
                  onPress={() => router.push("/(app)/properties/my" as never)}
                />
                <ActionButton
                  label="Create property"
                  icon="add"
                  onPress={() =>
                    router.push("/(app)/properties/create" as never)
                  }
                />
              </View>
              <View style={styles.sortRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Sort properties"
                  onPress={() => setSortOpen(true)}
                  style={styles.sortButton}
                >
                  <ThemedText style={styles.sortText}>
                    Sort by:{" "}
                    <ThemedText style={styles.sortValue}>
                      {SORTS.find((option) => option.value === sort)?.label}
                    </ThemedText>
                  </ThemedText>
                  <Ionicons name="chevron-down" size={14} color={theme.text} />
                </Pressable>
                {!results.loading && !results.error ? (
                  <ThemedText themeColor="textSecondary" style={styles.count}>
                    {count == null
                      ? `${results.page.items.length}${results.page.nextCursor ? "+" : ""} ${results.page.items.length === 1 && !results.page.nextCursor ? "property" : "properties"}`
                      : `${count} ${count === 1 ? "property" : "properties"}`}
                  </ThemedText>
                ) : null}
              </View>
              {sort !== "NEWEST" &&
              (!applied.currencyCode ||
                (applied.listingPurpose === "RENT" && !applied.pricePeriod)) ? (
                <ThemedText style={styles.sortHint} themeColor="textSecondary">
                  Sorted by asking amount. Use Price filters to compare the same
                  currency and rent period.
                </ThemedText>
              ) : null}
              {results.loading && !results.refreshing ? (
                <PropertiesSkeleton />
              ) : null}
              {results.error ? (
                <PropertyListError
                  message={results.error}
                  onRetry={results.retry}
                />
              ) : null}
            </>
          }
          ListEmptyComponent={
            !results.loading && !results.error ? (
              <PropertiesEmpty
                title={
                  active || search ? "No properties match" : "No properties yet"
                }
                message={
                  active || search
                    ? "Try a different location or adjust your filters."
                    : "Properties for this purpose will appear here when advertised."
                }
                actionLabel={
                  active || search
                    ? "Clear property filters"
                    : "Create property"
                }
                onAction={
                  active || search
                    ? clear
                    : () => router.push("/(app)/properties/create" as never)
                }
              />
            ) : undefined
          }
          ListFooterComponent={
            results.loadingMore ? (
              <ActivityIndicator
                style={styles.inset}
                color={accent}
                accessibilityLabel="Loading more properties"
              />
            ) : undefined
          }
        />
      </SafeAreaView>
      {section ? (
        <PropertyFiltersSheet
          applied={applied}
          types={types}
          typesError={typesError}
          onRetryTypes={() => setTypesRetry((value) => value + 1)}
          section={section}
          context={context}
          api={api}
          onApply={(value, point, radius) => {
            setApplied(value);
            setNearby(point);
            setRadiusKm(radius);
          }}
          onClose={() => setSection(null)}
          radiusKm={radiusKm}
          nearby={nearby}
        />
      ) : null}
      <Sheet
        visible={sortOpen}
        title="Sort properties"
        onClose={() => setSortOpen(false)}
      >
        {SORTS.map((option) => (
          <ChoiceChip
            key={option.value}
            label={option.label}
            selected={sort === option.value}
            onPress={() => {
              setSort(option.value);
              setSortOpen(false);
            }}
          />
        ))}
      </Sheet>
      <Sheet
        visible={menuOpen}
        title="Menu"
        onClose={() => setMenuOpen(false)}
      >
        {MENU.map((entry) => (
          <Pressable
            key={entry.route}
            accessibilityRole="button"
            accessibilityLabel={entry.label}
            onPress={() => {
              setMenuOpen(false);
              router.push(entry.route as never);
            }}
            style={styles.menuItem}
          >
            <Ionicons name={entry.icon} size={21} color={theme.text} />
            <ThemedText style={styles.menuText}>{entry.label}</ThemedText>
          </Pressable>
        ))}
      </Sheet>
    </View>
  );
}
function PurposeChips({
  value,
  onChange,
}: {
  value: ListingPurpose;
  onChange: (purpose: ListingPurpose) => void;
}) {
  const theme = useTheme();
  const accent = theme.info;
  return (
    <View style={[styles.purpose, { borderColor: theme.border }]}>
      {(["SALE", "RENT"] as const).map((purpose, index) => (
        <Pressable
          key={purpose}
          accessibilityRole="button"
          accessibilityLabel={purpose === "SALE" ? "Buy" : "Rent"}
          accessibilityState={{ selected: value === purpose }}
          onPress={() => onChange(purpose)}
          style={[
            styles.purposeItem,
            index > 0 && {
              borderLeftWidth: StyleSheet.hairlineWidth,
              borderLeftColor: theme.border,
            },
            value === purpose && { backgroundColor: theme.infoSurface },
          ]}
        >
          <ThemedText
            style={[
              styles.shortcutText,
              value === purpose && { color: accent },
            ]}
          >
            {purpose === "SALE" ? "Buy" : "Rent"}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}
function ActionButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.actionButton,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.border,
        },
      ]}
    >
      <Ionicons name={icon} size={17} color={theme.text} />
      <ThemedText style={styles.actionText}>{label}</ThemedText>
    </Pressable>
  );
}
function Shortcut({
  label,
  selected = false,
  icon = "chevron-down",
  accessibilityLabel,
  onPress,
}: {
  label: string;
  selected?: boolean;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const accent = theme.info;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.shortcut,
        {
          borderColor: selected ? accent : theme.border,
          backgroundColor: selected
            ? theme.infoSurface
            : theme.backgroundElement,
        },
      ]}
    >
      <ThemedText
        style={[styles.shortcutText, selected && { color: accent }]}
      >
        {label}
      </ThemedText>
      <Ionicons
        name={icon}
        size={13}
        color={selected ? accent : theme.textSecondary}
      />
    </Pressable>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingBottom: Spacing.four },
  header: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
    paddingHorizontal: Spacing.one,
  },
  headerButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  divider: { width: StyleSheet.hairlineWidth, height: 26 },
  spacer: { flex: 1 },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingLeft: Spacing.three,
  },
  brandMark: {
    width: 28,
    height: 28,
    borderRadius: BorderRadius.full,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  brandText: { fontSize: 19, fontWeight: "700" },
  savedText: { fontSize: 15, fontWeight: "700" },
  accentLine: { height: 2.5 },
  inset: { marginHorizontal: Spacing.three, marginBottom: Spacing.three },
  searchRow: {
    flexDirection: "row",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  search: {
    flex: 1,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.one,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  searchInput: { flex: 1, minHeight: 46, fontSize: 14 },
  clearBox: {
    width: 30,
    height: 30,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  filterButton: {
    width: 48,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  filterDot: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  toolbar: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  purpose: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    overflow: "hidden",
  },
  purposeItem: {
    minHeight: 40,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  shortcut: {
    minHeight: 40,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: BorderRadius.full,
  },
  shortcutText: { fontSize: 13, fontWeight: "600" },
  actions: {
    flexDirection: "row",
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  actionButton: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
  },
  actionText: { fontSize: 15, fontWeight: "600" },
  sortRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  sortButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    minHeight: 44,
    flexShrink: 1,
  },
  sortText: { fontSize: 12 },
  sortValue: { fontSize: 12, fontWeight: "700" },
  count: { fontSize: 11 },
  sortHint: { fontSize: 11, lineHeight: 17, marginHorizontal: Spacing.three },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    minHeight: 48,
  },
  menuText: { fontSize: 15, fontWeight: "600" },
});
