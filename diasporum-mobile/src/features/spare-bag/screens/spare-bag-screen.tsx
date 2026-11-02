import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createSpareBagApi } from "../services/spare-bag-api";
import type {
  Airport,
  Category,
  DiscoveryFilters,
  Listing,
  ListingType,
} from "../types/spare-bag-types";
import { CollectionState, ListingCard, SafetyNotice, ScreenHeader } from "../components/spare-bag-ui";

export default function SpareBagScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient } = useSession();
  const api = useMemo(() => createSpareBagApi(apiClient), [apiClient]);
  const [items, setItems] = useState<Listing[]>([]);
  const [airports, setAirports] = useState<Airport[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filters, setFilters] = useState<DiscoveryFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    Promise.all([api.airports(), api.categories()])
      .then(([airportResult, categoryResult]) => {
        setAirports(airportResult.items);
        setCategories(categoryResult.items);
      })
      .catch(() => undefined);
  }, [api]);

  const load = useCallback((nextCursor?: string) => {
    if (loadingRef.current) return Promise.resolve();
    loadingRef.current = true;
    return Promise.resolve()
      .then(() => { if (nextCursor) setLoadingMore(true); })
      .then(() => api.discover(filters, nextCursor))
      .then((page) => {
        setItems((current) => nextCursor ? [...current, ...page.items] : page.items);
        setCursor(page.nextCursor);
        setError(null);
      })
      .catch((cause) => setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load Spare Bag listings."))
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      });
  }, [api, filters]);

  const filterKey = JSON.stringify(filters);
  const [previousFilterKey, setPreviousFilterKey] = useState(filterKey);
  if (filterKey !== previousFilterKey) {
    setPreviousFilterKey(filterKey);
    setLoading(true);
  }
  useEffect(() => { void load(); }, [load]);

  function patch(value: Partial<DiscoveryFilters>) {
    setFilters((current) => ({ ...current, ...value }));
  }

  const header = (
    <View style={styles.headerContent}>
      <SafetyNotice />
      <View style={styles.actions}>
        <PrimaryButton label="Sender request" onPress={() => router.push("/(app)/spare-bag/create-sender" as never)} />
        <PrimaryButton label="Passenger offer" variant="secondary" onPress={() => router.push("/(app)/spare-bag/create-passenger" as never)} />
      </View>
      <View style={styles.links}>
        <NavLink label="My listings" onPress={() => router.push("/(app)/spare-bag/my" as never)} />
        <NavLink label="Saved" onPress={() => router.push("/(app)/spare-bag/saved" as never)} />
        <NavLink label="Contact requests" onPress={() => router.push("/(app)/spare-bag/contacts" as never)} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Filters" onPress={() => setShowFilters((value) => !value)}>
        <ThemedText type="linkPrimary">{showFilters ? "Hide filters" : "Filters"}</ThemedText>
      </Pressable>
      {showFilters ? (
        <View style={[styles.filters, { borderColor: theme.border }]}>
          <View style={styles.choices}>
            <FilterChoice label="All types" selected={!filters.listingType} onPress={() => patch({ listingType: undefined })} />
            {(["SENDER_REQUEST", "PASSENGER_OFFER"] as ListingType[]).map((type) => (
              <FilterChoice key={type} label={type === "SENDER_REQUEST" ? "Senders" : "Passengers"} selected={filters.listingType === type} onPress={() => patch({ listingType: type })} />
            ))}
          </View>
          <AirportFilter label="Origin" airports={airports} value={filters.originAirportId} onChange={(originAirportId) => patch({ originAirportId })} />
          <AirportFilter label="Destination" airports={airports} value={filters.destinationAirportId} onChange={(destinationAirportId) => patch({ destinationAirportId })} />
          <View style={styles.choices}>
            <FilterChoice label="All categories" selected={!filters.categoryKey} onPress={() => patch({ categoryKey: undefined })} />
            {categories.map((category) => <FilterChoice key={category.key} label={category.displayName} selected={filters.categoryKey === category.key} onPress={() => patch({ categoryKey: category.key })} />)}
          </View>
          <View style={styles.filterInputs}>
            <TextInput accessibilityLabel="Travel from" placeholder="Travel from YYYY-MM-DD" value={filters.dateFrom ?? ""} onChangeText={(dateFrom) => patch({ dateFrom: dateFrom || undefined })} style={[styles.input, { color: theme.text, borderColor: theme.border }]} autoCapitalize="none" />
            <TextInput accessibilityLabel="Travel to" placeholder="Travel to YYYY-MM-DD" value={filters.dateTo ?? ""} onChangeText={(dateTo) => patch({ dateTo: dateTo || undefined })} style={[styles.input, { color: theme.text, borderColor: theme.border }]} autoCapitalize="none" />
            <TextInput accessibilityLabel="Maximum price" placeholder="Max price" keyboardType="decimal-pad" value={filters.maxPrice ?? ""} onChangeText={(maxPrice) => patch({ maxPrice: maxPrice || undefined })} style={[styles.input, { color: theme.text, borderColor: theme.border }]} />
            <TextInput accessibilityLabel="Minimum capacity" placeholder="Minimum kg" keyboardType="decimal-pad" value={filters.minimumCapacityKg ?? ""} onChangeText={(minimumCapacityKg) => patch({ minimumCapacityKg: minimumCapacityKg || undefined })} style={[styles.input, { color: theme.text, borderColor: theme.border }]} />
            <TextInput accessibilityLabel="Price currency" placeholder="Currency" maxLength={3} autoCapitalize="characters" value={filters.priceCurrency ?? ""} onChangeText={(priceCurrency) => patch({ priceCurrency: priceCurrency || undefined })} style={[styles.input, { color: theme.text, borderColor: theme.border }]} />
          </View>
          <PrimaryButton label="Clear filters" variant="ghost" onPress={() => setFilters({})} />
        </View>
      ) : null}
    </View>
  );

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <ScreenHeader title="Spare Bag" />
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ListingCard listing={item} />}
          ListHeaderComponent={header}
          ListEmptyComponent={<CollectionState loading={loading} error={error} empty={!loading && !error} onRetry={() => { setLoading(true); void load(); }} />}
          ListFooterComponent={loadingMore ? <ThemedText style={styles.footer}>Loading more…</ThemedText> : undefined}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
          onEndReached={() => { if (cursor && !loadingRef.current) void load(cursor); }}
          onEndReachedThreshold={0.4}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function NavLink({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}><ThemedText type="linkPrimary">{label}</ThemedText></Pressable>;
}

function FilterChoice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={[styles.choice, { borderColor: selected ? BrandColors.primary : theme.border, backgroundColor: selected ? BrandColors.primarySurface : theme.backgroundElement }]}><ThemedText type="small">{label}</ThemedText></Pressable>;
}

function AirportFilter({ label, airports, value, onChange }: { label: string; airports: Airport[]; value?: string; onChange: (value?: string) => void }) {
  return <View style={styles.filterGroup}><ThemedText type="smallBold">{label}</ThemedText><View style={styles.choices}><FilterChoice label="Any" selected={!value} onPress={() => onChange(undefined)} />{airports.map((airport) => <FilterChoice key={airport.id} label={airport.iataCode} selected={value === airport.id} onPress={() => onChange(airport.id)} />)}</View></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  listContent: { padding: Spacing.three, gap: Spacing.three, flexGrow: 1 },
  headerContent: { gap: Spacing.three },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  links: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.three },
  filters: { borderWidth: 1, borderRadius: BorderRadius.md, padding: Spacing.three, gap: Spacing.three },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  choice: { borderWidth: 1, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  filterGroup: { gap: Spacing.one },
  filterInputs: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  input: { borderWidth: 1, borderRadius: BorderRadius.md, padding: Spacing.two, minWidth: 100, flex: 1 },
  footer: { textAlign: "center", padding: Spacing.three },
});
