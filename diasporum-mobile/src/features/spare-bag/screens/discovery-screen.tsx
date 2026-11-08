import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ErrorState } from "@/shared/components/error-state";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createSpareBagApi } from "../services/spare-bag-api";
import type {
  Airport,
  Category,
  DiscoveryFilters,
  DiscoverySort,
  Listing,
  ListingCounts,
  ListingType,
} from "../types/spare-bag-types";
import { AirportPicker } from "../components/airport-picker";
import {
  DiscoveryCardSkeleton,
  DiscoveryListingCard,
} from "../components/discovery-card";
import {
  CreateListingSheet,
  DateRangeSheet,
  dateRangeLabel,
  FiltersSheet,
  InfoSheet,
  NumberFilterSheet,
  SortSheet,
  sortLabel,
} from "../components/discovery-sheets";
import {
  formatCurrencyAmount,
  SafetyNotice,
  ScreenHeader,
} from "../components/spare-bag-ui";

type SheetKind =
  | "info"
  | "sort"
  | "dates"
  | "filters"
  | "capacity"
  | "price"
  | "create";

const DEFAULT_SORT: Record<ListingType, DiscoverySort> = {
  PASSENGER_OFFER: "TRAVEL_DATE",
  SENDER_REQUEST: "NEWEST",
};

export default function DiscoveryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { apiClient } = useSession();
  const api = useMemo(() => createSpareBagApi(apiClient), [apiClient]);

  const [items, setItems] = useState<Listing[]>([]);
  const [airports, setAirports] = useState<Airport[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [counts, setCounts] = useState<ListingCounts | null>(null);
  const [filters, setFilters] = useState<DiscoveryFilters>({
    listingType: "PASSENGER_OFFER",
  });
  const [sort, setSort] = useState<DiscoverySort>("TRAVEL_DATE");
  const [originAirport, setOriginAirport] = useState<Airport | null>(null);
  const [destinationAirport, setDestinationAirport] = useState<Airport | null>(
    null,
  );
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const requestSerial = useRef(0);

  const sender = filters.listingType === "SENDER_REQUEST";

  useEffect(() => {
    Promise.all([api.airports(), api.categories()])
      .then(([airportResult, categoryResult]) => {
        setAirports(airportResult.items);
        setCategories(categoryResult.items);
      })
      .catch(() => undefined);
  }, [api]);

  const searchAirports = useCallback(
    (query: string) => api.airports(query).then((result) => result.items),
    [api],
  );

  const load = useCallback(
    (nextCursor?: string) => {
      const request = ++requestSerial.current;
      loadingRef.current = true;
      return Promise.resolve()
        .then(() => {
          if (nextCursor) setLoadingMore(true);
          return api.discover({ ...filters, sort }, nextCursor);
        })
        .then((page) => {
          if (request !== requestSerial.current) return;
          setItems((current) => {
            if (!nextCursor) return page.items;
            const ids = new Set(current.map((item) => item.id));
            return [
              ...current,
              ...page.items.filter((item) => !ids.has(item.id)),
            ];
          });
          setCursor(page.nextCursor);
          setError(null);
        })
        .catch((cause) => {
          if (request !== requestSerial.current) return;
          setError(
            ApiError.isApiError(cause)
              ? cause.userMessage
              : "Could not load Spare Bag listings.",
          );
        })
        .finally(() => {
          if (request !== requestSerial.current) return;
          loadingRef.current = false;
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        });
    },
    [api, filters, sort],
  );

  const filterKey = JSON.stringify({ ...filters, sort });
  const [previousFilterKey, setPreviousFilterKey] = useState(filterKey);
  if (filterKey !== previousFilterKey) {
    setPreviousFilterKey(filterKey);
    setLoading(true);
  }
  useEffect(() => {
    void load();
    return () => {
      requestSerial.current += 1;
    };
  }, [load]);

  // Per-type tab counts share the discovery predicates (minus listingType).
  const countsFilters = useMemo(
    () => ({ ...filters, listingType: undefined }),
    [filters],
  );
  useEffect(() => {
    let active = true;
    api
      .counts(countsFilters)
      .then((result) => {
        if (active) setCounts(result);
      })
      .catch(() => {
        if (active) setCounts(null);
      });
    return () => {
      active = false;
    };
  }, [api, countsFilters]);

  function patch(value: Partial<DiscoveryFilters>) {
    setFilters((current) => ({ ...current, ...value }));
  }

  function switchType(listingType: ListingType) {
    setSort(DEFAULT_SORT[listingType]);
    setFilters((current) => ({
      ...current,
      listingType,
      minimumCapacityKg:
        listingType === "PASSENGER_OFFER"
          ? current.minimumCapacityKg
          : undefined,
      maxWeightKg:
        listingType === "SENDER_REQUEST" ? current.maxWeightKg : undefined,
    }));
  }

  function clearFilters() {
    setOriginAirport(null);
    setDestinationAirport(null);
    setFilters((current) => ({ listingType: current.listingType }));
  }

  function chooseAirport(
    side: "origin" | "destination",
    airport: Airport | null,
  ) {
    if (side === "origin") {
      setOriginAirport(airport);
      patch({ originAirportId: airport?.id });
    } else {
      setDestinationAirport(airport);
      patch({ destinationAirportId: airport?.id });
    }
  }

  function swapAirports() {
    const nextOrigin = destinationAirport;
    const nextDestination = originAirport;
    setOriginAirport(nextOrigin);
    setDestinationAirport(nextDestination);
    patch({
      originAirportId: nextOrigin?.id,
      destinationAirportId: nextDestination?.id,
    });
  }

  async function toggleSave(listing: Listing) {
    setSavingId(listing.id);
    setError(null);
    try {
      if (listing.saved) await api.unsave(listing.id);
      else await api.save(listing.id);
      setItems((current) =>
        current.map((item) =>
          item.id === listing.id ? { ...item, saved: !item.saved } : item,
        ),
      );
    } catch (cause) {
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "Could not update the saved listing.",
      );
    } finally {
      setSavingId(null);
    }
  }

  const activeFilterCount = [
    filters.dateFrom,
    filters.dateTo,
    filters.maxPrice,
    sender ? filters.maxWeightKg : filters.minimumCapacityKg,
    filters.priceCurrency,
    filters.categoryKey,
  ].filter(Boolean).length;

  const priceLabel = sender ? "Budget" : "Price";
  const capacityChipLabel = sender
    ? filters.maxWeightKg
      ? `≤ ${filters.maxWeightKg} kg`
      : "Weight"
    : filters.minimumCapacityKg
      ? `≥ ${filters.minimumCapacityKg} kg`
      : "Capacity";
  const priceChipLabel = filters.maxPrice
    ? `≤ ${formatCurrencyAmount(Number(filters.maxPrice) || 0, filters.priceCurrency || "USD")}`
    : priceLabel;
  const foundCount = counts
    ? sender
      ? counts.senderRequests
      : counts.passengerOffers
    : null;
  const selectedDateLabel =
    filters.dateFrom || filters.dateTo
      ? dateRangeLabel(filters.dateFrom, filters.dateTo)
      : "Any dates";

  const hasActiveFilters = Boolean(
    activeFilterCount ||
    filters.originAirportId ||
    filters.destinationAirportId,
  );

  const header = (
    <View style={styles.headerContent}>
      <ThemedText themeColor="textSecondary" style={styles.subtitle}>
        Find a traveller with spare space, or someone who can carry your parcel.
      </ThemedText>

      <View style={[styles.tabs, { backgroundColor: theme.backgroundElement }]}>
        <ListingTypeTab
          icon="airplane-outline"
          label="Passenger Offers"
          count={counts?.passengerOffers ?? null}
          selected={!sender}
          onPress={() => switchType("PASSENGER_OFFER")}
        />
        <ListingTypeTab
          icon="cube-outline"
          label="Sender Requests"
          count={counts?.senderRequests ?? null}
          selected={sender}
          onPress={() => switchType("SENDER_REQUEST")}
        />
      </View>

      <View style={styles.routeRow}>
        <View
          style={[
            styles.routeBox,
            { borderColor: theme.border, backgroundColor: theme.background },
          ]}
        >
          <AirportPicker
            label="From"
            value={originAirport}
            airports={airports}
            onSearch={searchAirports}
            onChange={(airport) => chooseAirport("origin", airport)}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Swap origin and destination"
            onPress={swapAirports}
            style={({ pressed }) => [
              styles.swap,
              { backgroundColor: theme.primarySurface },
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="swap-horizontal" size={18} color={theme.primary} />
          </Pressable>
          <AirportPicker
            label="To"
            value={destinationAirport}
            airports={airports}
            onSearch={searchAirports}
            onChange={(airport) => chooseAirport("destination", airport)}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Travel dates: ${selectedDateLabel}`}
          onPress={() => setSheet("dates")}
          style={({ pressed }) => [
            styles.datePill,
            { borderColor: theme.border, backgroundColor: theme.background },
            pressed && styles.pressed,
          ]}
        >
          <View
            style={[styles.dateIcon, { backgroundColor: theme.primarySurface }]}
          >
            <Ionicons name="calendar-outline" size={19} color={theme.primary} />
          </View>
          <View style={styles.dateCopy}>
            <ThemedText themeColor="textSecondary" style={styles.dateLabel}>
              Travel dates
            </ThemedText>
            <ThemedText type="smallBold" numberOfLines={1}>
              {selectedDateLabel}
            </ThemedText>
          </View>
          <Ionicons name="chevron-down" size={16} color={theme.textSecondary} />
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filters"
          onPress={() => setSheet("filters")}
          style={[
            styles.chip,
            {
              borderColor: activeFilterCount ? theme.primary : theme.border,
              backgroundColor: activeFilterCount
                ? theme.primarySurface
                : theme.background,
            },
          ]}
        >
          <Ionicons name="funnel-outline" size={16} color={theme.primary} />
          <ThemedText
            type="smallBold"
            style={{ color: activeFilterCount ? theme.primary : theme.text }}
          >
            Filters
          </ThemedText>
          {activeFilterCount ? (
            <View
              style={[styles.chipBadge, { backgroundColor: theme.primary }]}
            >
              <ThemedText style={styles.chipBadgeText}>
                {activeFilterCount}
              </ThemedText>
            </View>
          ) : null}
        </Pressable>
        <FilterChip
          label={dateRangeLabel(filters.dateFrom, filters.dateTo)}
          active={Boolean(filters.dateFrom || filters.dateTo)}
          onPress={() => setSheet("dates")}
        />
        <FilterChip
          label={capacityChipLabel}
          active={Boolean(
            sender ? filters.maxWeightKg : filters.minimumCapacityKg,
          )}
          onPress={() => setSheet("capacity")}
        />
        <FilterChip
          label={priceChipLabel}
          active={Boolean(filters.maxPrice)}
          onPress={() => setSheet("price")}
        />
        {categories.map((category) => (
          <FilterChip
            key={category.key}
            label={category.displayName}
            active={filters.categoryKey === category.key}
            trailingIcon={filters.categoryKey === category.key ? "close" : null}
            onPress={() =>
              patch({
                categoryKey:
                  filters.categoryKey === category.key
                    ? undefined
                    : category.key,
              })
            }
          />
        ))}
        {hasActiveFilters ? (
          <FilterChip
            label="Clear all filters"
            active={false}
            trailingIcon="close-circle-outline"
            onPress={clearFilters}
          />
        ) : null}
      </ScrollView>

      <View style={styles.resultsRow}>
        <View style={styles.resultsCopy}>
          <ThemedText type="smallBold">
            {foundCount != null
              ? `${foundCount} ${sender ? "sender request" : "passenger offer"}${foundCount === 1 ? "" : "s"}`
              : loading
                ? "Searching…"
                : `${items.length} shown`}
          </ThemedText>
          {!loading && !error ? (
            <ThemedText themeColor="textSecondary" style={styles.resultsHint}>
              Matching your search
            </ThemedText>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Sort by ${sortLabel(sort)}`}
          onPress={() => setSheet("sort")}
          style={[styles.sort, { backgroundColor: theme.backgroundElement }]}
        >
          <Ionicons
            name="swap-vertical-outline"
            size={15}
            color={theme.primary}
          />
          <ThemedText type="smallBold" numberOfLines={1}>
            {sortLabel(sort)}
          </ThemedText>
          <Ionicons name="chevron-down" size={14} color={theme.textSecondary} />
        </Pressable>
      </View>
      {error && items.length ? (
        <View
          style={[styles.errorBanner, { backgroundColor: theme.errorSurface }]}
        >
          <Ionicons name="alert-circle-outline" size={18} color={theme.error} />
          <ThemedText
            accessibilityRole="alert"
            style={[styles.errorText, { color: theme.error }]}
          >
            {error}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <ScreenHeader
          back
          centered
          title="Spare Bag Listings"
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="How Spare Bag works"
              onPress={() => setSheet("info")}
              style={styles.infoButton}
            >
              <Ionicons
                name="information-circle-outline"
                size={23}
                color={theme.text}
              />
            </Pressable>
          }
        />
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <DiscoveryListingCard
              client={apiClient}
              listing={item}
              onToggleSave={() => void toggleSave(item)}
              saveLoading={savingId === item.id}
            />
          )}
          ListHeaderComponent={header}
          ListEmptyComponent={
            loading ? (
              <View style={styles.skeletons}>
                <DiscoveryCardSkeleton />
                <DiscoveryCardSkeleton />
                <DiscoveryCardSkeleton />
              </View>
            ) : error ? (
              <ErrorState
                message={error}
                onRetry={() => {
                  setLoading(true);
                  void load();
                }}
              />
            ) : (
              <View style={styles.empty}>
                <View
                  style={[
                    styles.emptyIcon,
                    { backgroundColor: theme.primarySurface },
                  ]}
                >
                  <Ionicons
                    name={sender ? "cube-outline" : "airplane-outline"}
                    size={30}
                    color={theme.primary}
                  />
                </View>
                <ThemedText style={styles.emptyTitle}>
                  {sender
                    ? "No sender requests found."
                    : "No passenger offers found."}
                </ThemedText>
                <ThemedText
                  themeColor="textSecondary"
                  style={styles.emptyMessage}
                >
                  Try a different route or clear filters — or create a listing
                  so another member can find you.
                </ThemedText>
                <View style={styles.emptyActions}>
                  {activeFilterCount ||
                  filters.originAirportId ||
                  filters.destinationAirportId ? (
                    <PrimaryButton
                      label="Clear filters"
                      variant="secondary"
                      onPress={clearFilters}
                    />
                  ) : null}
                  <PrimaryButton
                    label={sender ? "Offer spare space" : "Send a parcel"}
                    onPress={() =>
                      router.push(
                        sender
                          ? ("/(app)/spare-bag/create-passenger" as never)
                          : ("/(app)/spare-bag/create-sender" as never),
                      )
                    }
                  />
                </View>
              </View>
            )
          }
          ListFooterComponent={
            <View style={styles.footer}>
              {loadingMore ? (
                <ActivityIndicator
                  accessibilityLabel="Loading more listings"
                  color={theme.primary}
                  style={styles.loadingMore}
                />
              ) : null}
              {!cursor && items.length ? <SafetyNotice compact /> : null}
            </View>
          }
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={theme.primary}
            />
          }
          onEndReached={() => {
            if (cursor && !loadingRef.current) void load(cursor);
          }}
          onEndReachedThreshold={0.4}
        />
        <View
          style={[
            styles.createBar,
            {
              borderTopColor: theme.border,
              backgroundColor: theme.background,
              paddingBottom: Math.max(insets.bottom, Spacing.two),
            },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create a Listing"
            onPress={() => setSheet("create")}
            style={({ pressed }) => [
              styles.createButton,
              { backgroundColor: theme.primary },
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="add" size={22} color="#fff" />
            <ThemedText style={styles.createLabel}>Create a Listing</ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>

      <InfoSheet visible={sheet === "info"} onClose={() => setSheet(null)} />
      <SortSheet
        visible={sheet === "sort"}
        value={sort}
        onApply={setSort}
        onClose={() => setSheet(null)}
      />
      <DateRangeSheet
        visible={sheet === "dates"}
        dateFrom={filters.dateFrom}
        dateTo={filters.dateTo}
        onApply={(dateFrom, dateTo) => patch({ dateFrom, dateTo })}
        onClose={() => setSheet(null)}
      />
      <NumberFilterSheet
        visible={sheet === "capacity"}
        title={sender ? "Maximum parcel weight" : "Minimum capacity"}
        hint={
          sender
            ? "Only show parcels up to this weight — how much can you carry?"
            : "Only show offers with at least this much spare capacity (kg)."
        }
        value={sender ? filters.maxWeightKg : filters.minimumCapacityKg}
        onApply={(value) =>
          patch(sender ? { maxWeightKg: value } : { minimumCapacityKg: value })
        }
        onClose={() => setSheet(null)}
      />
      <NumberFilterSheet
        visible={sheet === "price"}
        title={sender ? "Maximum budget" : "Maximum price"}
        hint={
          sender
            ? `Only show requests budgeting up to this amount${filters.priceCurrency ? ` (${filters.priceCurrency})` : ""}.`
            : `Only show offers priced up to this amount${filters.priceCurrency ? ` (${filters.priceCurrency})` : ""}.`
        }
        value={filters.maxPrice}
        onApply={(maxPrice) => patch({ maxPrice })}
        onClose={() => setSheet(null)}
      />
      <FiltersSheet
        visible={sheet === "filters"}
        sender={sender}
        filters={filters}
        categories={categories}
        onApply={setFilters}
        onClose={() => setSheet(null)}
      />
      <CreateListingSheet
        visible={sheet === "create"}
        onSelect={(type) =>
          router.push(
            type === "PASSENGER_OFFER"
              ? ("/(app)/spare-bag/create-passenger" as never)
              : ("/(app)/spare-bag/create-sender" as never),
          )
        }
        onClose={() => setSheet(null)}
      />
    </ThemedView>
  );
}

function ListingTypeTab({
  icon,
  label,
  count,
  selected,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  count: number | null;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.tab,
        {
          borderColor: selected ? theme.primary : theme.primaryLight,
          backgroundColor: selected ? theme.primary : theme.background,
        },
      ]}
    >
      <Ionicons
        name={icon}
        size={17}
        color={selected ? "#fff" : theme.primary}
      />
      <ThemedText
        type="smallBold"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        style={[styles.tabLabel, { color: selected ? "#fff" : theme.text }]}
      >
        {label}
        {count != null ? ` (${count})` : ""}
      </ThemedText>
    </Pressable>
  );
}

function FilterChip({
  label,
  active,
  trailingIcon = "chevron-down",
  onPress,
}: {
  label: string;
  active: boolean;
  trailingIcon?: keyof typeof Ionicons.glyphMap | null;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: active ? theme.primary : theme.border,
          backgroundColor: active ? theme.primarySurface : theme.background,
        },
        pressed && styles.pressed,
      ]}
    >
      <ThemedText
        type="smallBold"
        style={{ color: active ? theme.primary : theme.text }}
      >
        {label}
      </ThemedText>
      {trailingIcon ? (
        <Ionicons
          name={trailingIcon}
          size={14}
          color={active ? theme.primary : theme.textSecondary}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  listContent: {
    padding: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.three,
    flexGrow: 1,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  headerContent: { gap: Spacing.three, paddingBottom: Spacing.one },
  subtitle: {
    textAlign: "center",
    paddingHorizontal: Spacing.three,
    marginTop: -Spacing.two,
    lineHeight: 21,
  },
  tabs: {
    flexDirection: "row",
    gap: Spacing.one,
    padding: Spacing.one,
    borderRadius: BorderRadius.lg,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.one,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.one,
  },
  tabLabel: { flexShrink: 1, fontSize: 13, lineHeight: 18 },
  routeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "stretch",
    gap: Spacing.two,
  },
  routeBox: {
    flexGrow: 1,
    flexBasis: 250,
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  swap: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  datePill: {
    flexGrow: 1,
    flexBasis: 180,
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  dateIcon: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  dateCopy: { flex: 1, minWidth: 0, gap: 1 },
  dateLabel: { fontSize: 11, lineHeight: 15, fontWeight: "600" },
  chipsRow: { gap: Spacing.two, paddingRight: Spacing.three },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 40,
  },
  chipBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  chipBadgeText: {
    color: "#fff",
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "800",
  },
  resultsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
    marginTop: -Spacing.one,
  },
  resultsCopy: { flex: 1, minWidth: 0, gap: 1 },
  resultsHint: { fontSize: 12, lineHeight: 16 },
  sort: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    minHeight: 38,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.two,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
    borderRadius: BorderRadius.md,
    padding: Spacing.three,
  },
  errorText: { flex: 1, fontSize: 14, lineHeight: 20 },
  infoButton: {
    width: 40,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  skeletons: { gap: Spacing.three },
  loadingMore: { padding: Spacing.three },
  empty: {
    alignItems: "center",
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    gap: Spacing.two,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.one,
  },
  emptyTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700",
    textAlign: "center",
  },
  emptyMessage: { textAlign: "center", maxWidth: 340 },
  emptyActions: {
    gap: Spacing.two,
    marginTop: Spacing.two,
    alignSelf: "stretch",
    alignItems: "center",
  },
  footer: { paddingTop: Spacing.one },
  createBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  createButton: {
    minHeight: 52,
    width: "100%",
    maxWidth: 688,
    alignSelf: "center",
    borderRadius: BorderRadius.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
  },
  createLabel: {
    color: "#fff",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
  },
  pressed: { opacity: 0.82 },
});
