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
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ApiError } from "@/core/api/api-error";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { VehicleCard } from "../components/vehicle-card";
import { approximateCoordinate } from "../components/vehicle-form";
import { useCommunityNames } from "../hooks/use-community-names";
import { createVehicleApi } from "../services/vehicle-api";
import type {
  VehicleCatalogItem,
  VehicleCategory,
  VehicleDiscoveryFilters,
  VehiclePurpose,
  VehicleSort,
  VehicleView,
} from "../types/vehicle-types";
import { vehicleLabel } from "../utils/vehicle-format";

const FUEL = ["PETROL", "DIESEL", "ELECTRIC", "HYBRID", "PLUG_IN_HYBRID", "HYDROGEN", "OTHER"];
const TRANSMISSION = ["MANUAL", "AUTOMATIC", "SEMI_AUTOMATIC", "OTHER"];
const BODY = ["HATCHBACK", "SALOON", "ESTATE", "SUV", "COUPE", "CONVERTIBLE", "MPV", "VAN", "PICKUP", "MOTORCYCLE", "MOTORHOME", "TRUCK", "OTHER"];
const CONDITION = ["NEW", "EXCELLENT", "GOOD", "FAIR", "POOR"];

export default function VehiclesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient, session } = useSession();
  const api = React.useMemo(() => createVehicleApi(apiClient), [apiClient]);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [makes, setMakes] = useState<VehicleCatalogItem[]>([]);
  const [models, setModels] = useState<VehicleCatalogItem[]>([]);
  const [variants, setVariants] = useState<VehicleCatalogItem[]>([]);
  const [items, setItems] = useState<VehicleView[]>([]);
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [purpose, setPurpose] = useState<VehiclePurpose | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [makeId, setMakeId] = useState("");
  const [modelId, setModelId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [sort, setSort] = useState<VehicleSort>("NEWEST");
  const [showFilters, setShowFilters] = useState(false);
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [communityId, setCommunityId] = useState("");
  const [currentCountryOnly, setCurrentCountryOnly] = useState(false);
  const [yearMin, setYearMin] = useState("");
  const [yearMax, setYearMax] = useState("");
  const [mileageMin, setMileageMin] = useState("");
  const [mileageMax, setMileageMax] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [fuelType, setFuelType] = useState("");
  const [transmission, setTransmission] = useState("");
  const [bodyType, setBodyType] = useState("");
  const [condition, setCondition] = useState("");
  const [engineSizeMin, setEngineSizeMin] = useState("");
  const [engineSizeMax, setEngineSizeMax] = useState("");
  const [origin, setOrigin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [radius, setRadius] = useState("50");
  const [attributeFilters, setAttributeFilters] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const communityName = useCommunityNames();
  const category = categories.find((item) => item.category.id === categoryId);

  useEffect(() => {
    api.categories().then((result) => setCategories(result.items)).catch(() => setCategories([]));
    api.makes().then((result) => setMakes(result.items)).catch(() => setMakes([]));
  }, [api]);
  useEffect(() => {
    if (!makeId) return setModels([]);
    api.models(makeId).then((result) => setModels(result.items)).catch(() => setModels([]));
  }, [api, makeId]);
  useEffect(() => {
    if (!modelId) return setVariants([]);
    api.variants(modelId).then((result) => setVariants(result.items)).catch(() => setVariants([]));
  }, [api, modelId]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(keyword.trim()), 350);
    return () => clearTimeout(timer);
  }, [keyword]);

  const number = (value: string) => value.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined;
  const filters: VehicleDiscoveryFilters = {
    keyword: debouncedKeyword || undefined,
    purpose: purpose ?? undefined,
    categoryId: categoryId || undefined,
    makeId: makeId || undefined,
    modelId: modelId || undefined,
    variantId: variantId || undefined,
    yearMin: number(yearMin), yearMax: number(yearMax),
    mileageMin: number(mileageMin), mileageMax: number(mileageMax),
    priceMin: number(priceMin), priceMax: number(priceMax),
    currency: priceMin || priceMax || sort.startsWith("PRICE") ? currency.toUpperCase() : undefined,
    fuelType: fuelType || undefined, transmission: transmission || undefined,
    bodyType: bodyType || undefined, condition: condition || undefined,
    engineSizeMin: number(engineSizeMin), engineSizeMax: number(engineSizeMax),
    countryId: currentCountryOnly ? session?.profile?.currentCountryId ?? undefined : undefined,
    communityId: communityId || undefined,
    city: city.trim() || undefined, region: region.trim() || undefined,
    originLatitude: origin?.latitude, originLongitude: origin?.longitude,
    radiusMeters: origin ? (number(radius) ?? 50) * 1000 : undefined,
    attributes: Object.fromEntries(Object.entries(attributeFilters).filter(([, value]) => value.trim())),
    sort,
  };
  const filterKey = JSON.stringify(filters);

  const load = useCallback((nextCursor?: string) => {
    if (loadingRef.current) return Promise.resolve();
    loadingRef.current = true;
    if (nextCursor) setLoadingMore(true);
    return api.discover(JSON.parse(filterKey) as VehicleDiscoveryFilters, nextCursor)
      .then((page) => {
        setItems((previous) => {
          if (!nextCursor) return page.items;
          const ids = new Set(previous.map((item) => item.listing.id));
          return [...previous, ...page.items.filter((item) => !ids.has(item.listing.id))];
        });
        setCursor(page.nextCursor);
        setError(null);
      })
      .catch((cause: unknown) => setError(ApiError.isApiError(cause) ? cause.userMessage : "Failed to load vehicles."))
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      });
  }, [api, filterKey]);
  const [previousKey, setPreviousKey] = useState(filterKey);
  if (previousKey !== filterKey) {
    setPreviousKey(filterKey);
    setLoading(true);
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function requestMyLocation() {
    setLocationError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setLocationError("Location permission was not granted. Manual search remains available.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setOrigin({
        latitude: approximateCoordinate(position.coords.latitude),
        longitude: approximateCoordinate(position.coords.longitude),
      });
      setSort("DISTANCE");
    } catch {
      setLocationError("Your location is unavailable. Manual search remains available.");
    }
  }

  function clearFilters() {
    setKeyword(""); setPurpose(null); setCategoryId(""); setMakeId(""); setModelId(""); setVariantId("");
    setSort("NEWEST"); setCity(""); setRegion(""); setCommunityId(""); setCurrentCountryOnly(false);
    setYearMin(""); setYearMax(""); setMileageMin(""); setMileageMax(""); setPriceMin(""); setPriceMax("");
    setFuelType(""); setTransmission(""); setBodyType(""); setCondition(""); setEngineSizeMin(""); setEngineSizeMax("");
    setOrigin(null); setAttributeFilters({}); setLocationError(null);
  }

  async function toggleSave(item: VehicleView) {
    const saved = !item.listing.saved;
    setItems((previous) => previous.map((current) => current.listing.id === item.listing.id
      ? { ...current, listing: { ...current.listing, saved } } : current));
    try {
      if (saved) await api.save(item.listing.id);
      else await api.unsave(item.listing.id);
    } catch {
      setItems((previous) => previous.map((current) => current.listing.id === item.listing.id
        ? { ...current, listing: { ...current.listing, saved: !saved } } : current));
    }
  }

  const filtered = filterKey !== JSON.stringify({ sort: "NEWEST" });
  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <ThemedText type="title">Vehicles</ThemedText>
          <View style={styles.headerActions}>
            <HeaderButton icon="bookmark-outline" label="Saved vehicles" onPress={() => router.push("/(app)/vehicles/saved" as never)} />
            <HeaderButton icon="car-outline" label="My vehicle listings" onPress={() => router.push("/(app)/vehicles/my" as never)} />
            <HeaderButton icon="add" label="Create vehicle" filled onPress={() => router.push("/(app)/vehicles/create" as never)} />
          </View>
        </View>
        <View style={[styles.search, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <Ionicons name="search" size={18} color={theme.textSecondary} />
          <TextInput value={keyword} onChangeText={setKeyword} placeholder="Search vehicles"
            placeholderTextColor={theme.textSecondary} style={[styles.searchInput, { color: theme.text }]} returnKeyType="search" />
          <Pressable onPress={() => setShowFilters((value) => !value)} accessibilityRole="button" accessibilityLabel="Toggle vehicle filters">
            <Ionicons name="options-outline" size={21} color={theme.text} />
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip text="All" active={purpose === null} onPress={() => setPurpose(null)} />
          <Chip text="For sale" active={purpose === "SALE"} onPress={() => setPurpose("SALE")} />
          <Chip text="For rent" active={purpose === "RENT"} onPress={() => setPurpose("RENT")} />
          <Chip text="Newest" active={sort === "NEWEST"} onPress={() => setSort("NEWEST")} />
          <Chip text="Price low" active={sort === "PRICE_ASC"} onPress={() => setSort("PRICE_ASC")} />
          <Chip text="Price high" active={sort === "PRICE_DESC"} onPress={() => setSort("PRICE_DESC")} />
          <Chip text="Clear filters" active={false} onPress={clearFilters} />
        </ScrollView>
        {showFilters ? (
          <ScrollView style={styles.filterPanel} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            <ThemedText type="subtitle">Filters</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={styles.chips}>
              {categories.map((item) => <Chip key={item.category.id} text={item.category.displayName} active={categoryId === item.category.id}
                onPress={() => { setCategoryId(categoryId === item.category.id ? "" : item.category.id); setAttributeFilters({}); }} />)}
            </View></ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={styles.chips}>
              {makes.map((make) => <Chip key={make.id} text={make.displayName} active={makeId === make.id}
                onPress={() => { setMakeId(makeId === make.id ? "" : make.id); setModelId(""); setVariantId(""); }} />)}
            </View></ScrollView>
            {makeId && models.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={styles.chips}>
              {models.map((model) => <Chip key={model.id} text={model.displayName} active={modelId === model.id}
                onPress={() => { setModelId(modelId === model.id ? "" : model.id); setVariantId(""); }} />)}
            </View></ScrollView> : null}
            {modelId && variants.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={styles.chips}>
              {variants.map((variant) => <Chip key={variant.id} text={variant.displayName} active={variantId === variant.id}
                onPress={() => setVariantId(variantId === variant.id ? "" : variant.id)} />)}
            </View></ScrollView> : null}
            <View style={styles.grid}>
              <FilterInput label="City" value={city} onChangeText={setCity} />
              <FilterInput label="Region" value={region} onChangeText={setRegion} />
              <FilterInput label="Minimum year" value={yearMin} onChangeText={setYearMin} numeric />
              <FilterInput label="Maximum year" value={yearMax} onChangeText={setYearMax} numeric />
              <FilterInput label="Minimum mileage" value={mileageMin} onChangeText={setMileageMin} numeric />
              <FilterInput label="Maximum mileage" value={mileageMax} onChangeText={setMileageMax} numeric />
              <FilterInput label="Minimum price" value={priceMin} onChangeText={setPriceMin} numeric />
              <FilterInput label="Maximum price" value={priceMax} onChangeText={setPriceMax} numeric />
              <FilterInput label="Currency" value={currency} onChangeText={setCurrency} />
              <FilterInput label="Minimum engine cc" value={engineSizeMin} onChangeText={setEngineSizeMin} numeric />
              <FilterInput label="Maximum engine cc" value={engineSizeMax} onChangeText={setEngineSizeMax} numeric />
            </View>
            <FilterChoices values={FUEL} current={fuelType} onSelect={setFuelType} />
            <FilterChoices values={TRANSMISSION} current={transmission} onSelect={setTransmission} />
            <FilterChoices values={BODY} current={bodyType} onSelect={setBodyType} />
            <FilterChoices values={CONDITION} current={condition} onSelect={setCondition} />
            {session?.profile?.currentCountryId ? <Chip text="Current country only" active={currentCountryOnly} onPress={() => setCurrentCountryOnly((value) => !value)} /> : null}
            <FilterChoices values={session?.memberships.filter((membership) => membership.status === "ACTIVE").map((membership) => membership.communityId) ?? []}
              current={communityId} onSelect={setCommunityId} renderLabel={communityName} />
            {category ? Object.entries(category.attributes).filter(([, policy]) => policy.filterable).map(([key, policy]) => (
              policy.options.length ? <FilterChoices key={key} values={policy.options} current={attributeFilters[key] ?? ""}
                onSelect={(value) => setAttributeFilters((previous) => ({ ...previous, [key]: value }))} /> :
                <FilterInput key={key} label={`${key} attribute`} value={attributeFilters[key] ?? ""}
                  numeric={["NUMBER", "INTEGER"].includes(policy.type)}
                  onChangeText={(value) => setAttributeFilters((previous) => ({ ...previous, [key]: value }))} />
            )) : null}
            <View style={styles.locationActions}>
              <Pressable onPress={() => void requestMyLocation()} accessibilityRole="button" accessibilityLabel="Use my location">
                <ThemedText style={styles.actionText}>Use my location</ThemedText>
              </Pressable>
              {origin ? <Pressable onPress={() => { setOrigin(null); if (sort === "DISTANCE") setSort("NEWEST"); }} accessibilityRole="button"><ThemedText style={styles.actionText}>Clear nearby search</ThemedText></Pressable> : null}
              <View style={styles.radius}><FilterInput label="Radius (km)" value={radius} onChangeText={setRadius} numeric /></View>
            </View>
            {locationError ? <ThemedText style={styles.error} accessibilityRole="alert">{locationError}</ThemedText> : null}
          </ScrollView>
        ) : null}
        <FlatList
          testID="vehicles-discovery-list"
          data={items}
          keyExtractor={(item) => item.listing.id}
          renderItem={({ item }) => <VehicleCard item={item} onToggleSave={(value) => void toggleSave(value)}
            onPress={(id) => router.push(`/(app)/vehicles/${id}` as never)} />}
          onEndReached={() => { if (cursor && !loadingRef.current) void load(cursor); }}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={BrandColors.primary}
            onRefresh={() => { setRefreshing(true); void load(); }} />}
          ListHeaderComponent={loading && !refreshing ? <ActivityIndicator style={styles.state} color={BrandColors.primary} accessibilityLabel="Loading vehicles" />
            : error && !refreshing ? <View style={styles.state} accessibilityRole="alert"><ThemedText style={styles.stateText}>{error}</ThemedText><Pressable onPress={() => void load()}><ThemedText style={styles.actionText}>Retry</ThemedText></Pressable></View> : undefined}
          ListEmptyComponent={!loading && !error ? <View style={styles.state}><Ionicons name="car-outline" size={42} color={theme.textSecondary} />
            <ThemedText type="subtitle">No vehicles found</ThemedText><ThemedText style={styles.stateText} themeColor="textSecondary">
              {filtered ? "Try changing or clearing your filters." : "Published vehicles will appear here."}
            </ThemedText></View> : undefined}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} color={BrandColors.primary} /> : undefined}
          contentContainerStyle={items.length === 0 ? styles.empty : styles.list}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function HeaderButton({ icon, label, onPress, filled = false }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; onPress: () => void; filled?: boolean }) {
  const theme = useTheme();
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
    style={[styles.headerButton, filled && { backgroundColor: theme.text }]}>
    <Ionicons name={icon} size={20} color={filled ? theme.background : theme.text} />
  </Pressable>;
}

function Chip({ text, active, onPress }: { text: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}
    style={[styles.chip, { backgroundColor: active ? BrandColors.primary : theme.backgroundElement, borderColor: active ? BrandColors.primary : theme.border }]}>
    <ThemedText style={[styles.chipText, active && styles.activeChip]}>{text}</ThemedText>
  </Pressable>;
}

function FilterChoices({ values, current, onSelect, renderLabel = vehicleLabel }: { values: string[]; current: string; onSelect: (value: string) => void; renderLabel?: (value: string) => string }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={styles.chips}>
    {values.map((value) => <Chip key={value} text={renderLabel(value)} active={current === value} onPress={() => onSelect(current === value ? "" : value)} />)}
  </View></ScrollView>;
}

function FilterInput({ label, value, onChangeText, numeric = false }: { label: string; value: string; onChangeText: (value: string) => void; numeric?: boolean }) {
  const theme = useTheme();
  return <TextInput value={value} onChangeText={onChangeText} placeholder={label} placeholderTextColor={theme.textSecondary}
    keyboardType={numeric ? "decimal-pad" : "default"}
    style={[styles.filterInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.background }]} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  headerActions: { flexDirection: "row", gap: 4 },
  headerButton: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  search: { margin: Spacing.three, marginHorizontal: Spacing.four, borderWidth: 1, borderRadius: 12, height: 44, paddingHorizontal: Spacing.three, flexDirection: "row", alignItems: "center", gap: Spacing.two },
  searchInput: { flex: 1, height: "100%", fontSize: 14 },
  chips: { flexDirection: "row", alignItems: "center", gap: Spacing.two, paddingHorizontal: Spacing.four, paddingVertical: Spacing.one },
  chip: { borderWidth: 1, borderRadius: BorderRadius.full, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 12, fontWeight: "600" },
  activeChip: { color: BrandColors.white },
  filterPanel: { maxHeight: 430, marginHorizontal: Spacing.four, marginVertical: Spacing.two, gap: Spacing.two },
  grid: { paddingHorizontal: Spacing.four, gap: Spacing.two },
  filterInput: { borderWidth: 1, borderRadius: 9, minHeight: 40, paddingHorizontal: Spacing.two, fontSize: 13, marginVertical: 2 },
  locationActions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: Spacing.three, paddingHorizontal: Spacing.four },
  radius: { flex: 1, minWidth: 110 },
  list: { paddingVertical: Spacing.two },
  state: { alignItems: "center", justifyContent: "center", padding: Spacing.five, gap: Spacing.two },
  stateText: { textAlign: "center", fontSize: 14 },
  actionText: { color: BrandColors.primary, fontWeight: "700" },
  error: { color: BrandColors.error, paddingHorizontal: Spacing.four },
  footer: { padding: Spacing.four },
  empty: { flexGrow: 1 },
});
