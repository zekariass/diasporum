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
import { Accuracy, getCurrentPositionAsync, requestForegroundPermissionsAsync } from "expo-location";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createPropertyApi } from "../services/property-api";
import type {
  FurnishedStatus,
  ListingPurpose,
  PropertyDiscoveryFilters,
  PropertyItem,
  PropertyType,
} from "../types/property-types";
import { PropertyCard } from "../components/property-card";
import { PropertiesEmpty, PropertiesSkeleton, PropertyListError } from "../components/property-states";
import { Chip, Field } from "../components/property-controls";

const PAGE_SIZE = 20;

export default function PropertiesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient, session } = useSession();
  const api = React.useMemo(() => createPropertyApi(apiClient), [apiClient]);
  const countryId = session?.profile?.currentCountryId ?? undefined;
  const [purpose, setPurpose] = useState<ListingPurpose | undefined>();
  const [propertyTypeId, setPropertyTypeId] = useState<string | undefined>();
  const [furnishedStatus, setFurnishedStatus] = useState<FurnishedStatus | undefined>();
  const [types, setTypes] = useState<PropertyType[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [city, setCity] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minBedrooms, setMinBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [nearby, setNearby] = useState<{ latitude: number; longitude: number; radiusKm: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [items, setItems] = useState<PropertyItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (!countryId) return;
    api.types(countryId).then((result) => setTypes(result.items)).catch(() => setTypes([]));
  }, [api, countryId]);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(timeout);
  }, [search]);

  const filters: PropertyDiscoveryFilters = {
    countryId,
    listingPurpose: purpose,
    propertyTypeId,
    furnishedStatus,
    city: city.trim() || undefined,
    search: debouncedSearch || undefined,
    minPrice: minPrice.trim() ? Number(minPrice) : undefined,
    maxPrice: maxPrice.trim() ? Number(maxPrice) : undefined,
    minBedrooms: minBedrooms.trim() ? Number(minBedrooms) : undefined,
    bathrooms: bathrooms.trim() ? Number(bathrooms) : undefined,
    ...nearby,
  };
  const filterKey = JSON.stringify(filters);
  const loadPage = useCallback((nextCursor?: string) => {
    if (loadingRef.current) return Promise.resolve();
    loadingRef.current = true;
    const parsed = JSON.parse(filterKey) as PropertyDiscoveryFilters;
    return api.discover(parsed, nextCursor, PAGE_SIZE)
      .then((page) => {
        setItems((previous) => {
          if (!nextCursor) return page.items;
          const seen = new Set(previous.map((entry) => entry.property.id));
          return [...previous, ...page.items.filter((entry) => !seen.has(entry.property.id))];
        });
        setCursor(page.nextCursor);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(ApiError.isApiError(cause) ? cause.userMessage : "Failed to load properties.");
      })
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      });
  }, [api, filterKey]);

  const [previousFilterKey, setPreviousFilterKey] = useState(filterKey);
  if (previousFilterKey !== filterKey) {
    setPreviousFilterKey(filterKey);
    setLoading(true);
  }

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const clearFilters = useCallback(() => {
    setPurpose(undefined);
    setPropertyTypeId(undefined);
    setFurnishedStatus(undefined);
    setSearch("");
    setCity("");
    setMinPrice("");
    setMaxPrice("");
    setMinBedrooms("");
    setBathrooms("");
    setNearby(null);
  }, []);

  const findNearby = useCallback(async () => {
    if (nearby) {
      setNearby(null);
      setLocationError(null);
      return;
    }
    setLocating(true);
    setLocationError(null);
    try {
      const permission = await requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setLocationError("Location access was not granted. You can still search by city and other filters.");
        return;
      }
      const position = await getCurrentPositionAsync({ accuracy: Accuracy.Balanced });
      setNearby({ latitude: position.coords.latitude, longitude: position.coords.longitude, radiusKm: 25 });
    } catch {
      setLocationError("Could not determine your location. Try a city search instead.");
    } finally {
      setLocating(false);
    }
  }, [nearby]);

  const hasFilters = Boolean(purpose || propertyTypeId || furnishedStatus || search || city || minPrice || maxPrice || minBedrooms || bathrooms || nearby);
  const openDetail = useCallback((id: string) => router.push(`/(app)/properties/${id}` as never), [router]);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <ThemedText type="title">Property</ThemedText>
          <View style={styles.headerActions}>
            <HeaderButton label="Saved properties" icon="bookmark-outline" onPress={() => router.push("/(app)/properties/saved" as never)} />
            <HeaderButton label="My properties" icon="person-outline" onPress={() => router.push("/(app)/properties/my" as never)} />
            <HeaderButton label="Create property" icon="add" onPress={() => router.push("/(app)/properties/create" as never)} filled />
          </View>
        </View>
        <FlatList
          data={items}
          keyExtractor={(item) => item.property.id}
          renderItem={({ item }) => <PropertyCard item={item} onPress={openDetail} />}
          onEndReached={() => { if (cursor && !loadingRef.current) { setLoadingMore(true); void loadPage(cursor); } }}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadPage(); }} tintColor={BrandColors.primary} />}
          ListHeaderComponent={
            <View>
              <View style={[styles.search, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                <Ionicons name="search-outline" size={17} color={theme.textSecondary} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search homes and rentals…"
                  placeholderTextColor={theme.textSecondary}
                  accessibilityLabel="Search properties"
                  style={[styles.searchInput, { color: theme.text }]}
                />
                {search ? <Pressable onPress={() => setSearch("")} accessibilityLabel="Clear search"><Ionicons name="close" size={17} color={theme.textSecondary} /></Pressable> : null}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                <Chip label="All" active={!purpose} onPress={() => setPurpose(undefined)} accessibilityLabel="All listing purposes" />
                <Chip label="For sale" active={purpose === "SALE"} onPress={() => setPurpose("SALE")} />
                <Chip label="For rent" active={purpose === "RENT"} onPress={() => setPurpose("RENT")} />
                <Chip label={showFilters ? "Hide filters" : "More filters"} active={showFilters} onPress={() => setShowFilters((value) => !value)} />
                <Chip label={locating ? "Locating…" : nearby ? "Nearby: 25 km" : "Near me"} active={Boolean(nearby)} onPress={() => void findNearby()} accessibilityLabel="Search near my current location" />
                {hasFilters ? <Chip label="Clear" active={false} onPress={clearFilters} accessibilityLabel="Clear property filters" /> : undefined}
              </ScrollView>
              {locationError ? <ThemedText style={styles.locationError}>{locationError}</ThemedText> : null}
              {showFilters ? (
                <View style={[styles.filterPanel, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
                  <ThemedText style={styles.filterTitle}>Property type</ThemedText>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeChips}>
                    <Chip label="Any type" active={!propertyTypeId} onPress={() => setPropertyTypeId(undefined)} />
                    {types.map((type) => <Chip key={type.id} label={type.displayName} active={propertyTypeId === type.id} onPress={() => setPropertyTypeId(type.id)} />)}
                  </ScrollView>
                  <View style={styles.fieldGrid}>
                    <Field label="City" value={city} onChangeText={setCity} placeholder="e.g. Frankfurt" />
                    <Field label="Minimum price" value={minPrice} onChangeText={setMinPrice} keyboardType="numeric" />
                    <Field label="Maximum price" value={maxPrice} onChangeText={setMaxPrice} keyboardType="numeric" />
                    <Field label="Minimum bedrooms" value={minBedrooms} onChangeText={setMinBedrooms} keyboardType="number-pad" />
                    <Field label="Bathrooms" value={bathrooms} onChangeText={setBathrooms} keyboardType="number-pad" />
                  </View>
                  <ThemedText style={styles.filterTitle}>Furnishing</ThemedText>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeChips}>
                    <Chip label="Any" active={!furnishedStatus} onPress={() => setFurnishedStatus(undefined)} />
                    {(["FURNISHED", "PART_FURNISHED", "UNFURNISHED"] as FurnishedStatus[]).map((status) => <Chip key={status} label={status.toLowerCase().replaceAll("_", " ")} active={furnishedStatus === status} onPress={() => setFurnishedStatus(status)} />)}
                  </ScrollView>
                </View>
              ) : null}
              {loading && !refreshing ? <PropertiesSkeleton /> : error ? <PropertyListError message={error} onRetry={() => void loadPage()} /> : undefined}
            </View>
          }
          ListEmptyComponent={!loading && !error ? <PropertiesEmpty title={hasFilters ? "No properties match" : "No properties yet"} message={hasFilters ? "Clear or adjust your search filters." : "Property listings from your communities and country will appear here."} actionLabel={hasFilters ? "Clear property filters" : "Create property"} onAction={hasFilters ? clearFilters : () => router.push("/(app)/properties/create" as never)} /> : undefined}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} color={BrandColors.primary} accessibilityLabel="Loading more properties" /> : undefined}
          contentContainerStyle={items.length === 0 ? styles.emptyContent : styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function HeaderButton({ label, icon, onPress, filled }: { label: string; icon: React.ComponentProps<typeof Ionicons>["name"]; onPress: () => void; filled?: boolean }) {
  const theme = useTheme();
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={[styles.iconButton, filled && { backgroundColor: theme.text }]}><Ionicons name={icon} size={20} color={filled ? theme.background : theme.text} /></Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  headerActions: { flexDirection: "row", gap: Spacing.two },
  iconButton: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  search: { flexDirection: "row", alignItems: "center", gap: Spacing.two, margin: Spacing.three, marginBottom: Spacing.two, borderWidth: 1, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.three },
  searchInput: { flex: 1, minHeight: 42, fontSize: 14 },
  chips: { gap: Spacing.two, paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
  locationError: { color: BrandColors.error, fontSize: 13, lineHeight: 19, marginHorizontal: Spacing.three, marginBottom: Spacing.two },
  filterPanel: { marginHorizontal: Spacing.three, marginBottom: Spacing.two, padding: Spacing.three, borderWidth: 1, borderRadius: BorderRadius.lg, gap: Spacing.two },
  filterTitle: { fontSize: 13, fontWeight: "700" },
  typeChips: { gap: Spacing.two },
  fieldGrid: { gap: Spacing.two },
  footer: { padding: Spacing.three },
  listContent: { paddingBottom: Spacing.four },
  emptyContent: { flexGrow: 1 },
});
