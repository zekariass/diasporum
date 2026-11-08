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
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ApiError } from "@/core/api/api-error";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { Sheet } from "@/shared/components/sheet";
import { SelectField } from "@/shared/components/select-field";
import { PrimaryButton } from "@/shared/components/primary-button";
import {
  PropertyHeader as MarketplaceHeader,
  HeaderAction,
} from "@/features/property/components/property-marketplace-ui";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { VehicleCard } from "../components/vehicle-card";
import { approximateCoordinate } from "../components/vehicle-form";
import { useCommunityNames } from "../hooks/use-community-names";
import {
  createVehicleApi,
  fromSavedFilters,
  savedSearchKey,
} from "../services/vehicle-api";
import type {
  VehicleCatalogItem,
  VehicleCategory,
  VehicleDiscoveryFilters,
  VehiclePurpose,
  VehicleSavedSearch,
  VehicleSort,
  VehicleView,
} from "../types/vehicle-types";
import { vehicleLabel } from "../utils/vehicle-format";

const FUEL = [
  "PETROL",
  "DIESEL",
  "ELECTRIC",
  "HYBRID",
  "PLUG_IN_HYBRID",
  "HYDROGEN",
  "OTHER",
];
const TRANSMISSION = ["MANUAL", "AUTOMATIC", "SEMI_AUTOMATIC", "OTHER"];
const DRIVE = ["FWD", "RWD", "AWD", "FOUR_WD", "OTHER"];
const BODY = [
  "HATCHBACK",
  "SALOON",
  "ESTATE",
  "SUV",
  "COUPE",
  "CONVERTIBLE",
  "MPV",
  "VAN",
  "PICKUP",
  "MOTORCYCLE",
  "MOTORHOME",
  "TRUCK",
  "OTHER",
];
const CONDITION = ["NEW", "EXCELLENT", "GOOD", "FAIR", "POOR"];

export default function VehiclesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
  const [showSort, setShowSort] = useState(false);
  const filterScroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const filterSections = useRef<Record<string, number>>({});
  const [filterSection, setFilterSection] = useState("Vehicle type");
  const [mileageUnit, setMileageUnit] = useState("KM");
  const [colour, setColour] = useState("");
  const [pricePeriod, setPricePeriod] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const pendingSaves = useRef(new Set<string>());
  const requestSerial = useRef(0);
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
  const [driveType, setDriveType] = useState("");
  const [bodyType, setBodyType] = useState("");
  const [condition, setCondition] = useState("");
  const [seats, setSeats] = useState("");
  const [doors, setDoors] = useState("");
  const [registrationYearMin, setRegistrationYearMin] = useState("");
  const [registrationYearMax, setRegistrationYearMax] = useState("");
  const [engineSizeMin, setEngineSizeMin] = useState("");
  const [engineSizeMax, setEngineSizeMax] = useState("");
  const [origin, setOrigin] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [radius, setRadius] = useState("50");
  const [attributeFilters, setAttributeFilters] = useState<
    Record<string, string>
  >({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [savedSearches, setSavedSearches] = useState<VehicleSavedSearch[]>([]);
  const [showSearches, setShowSearches] = useState(false);
  const [searchSaveError, setSearchSaveError] = useState<string | null>(null);
  const savingSearch = useRef(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const communityName = useCommunityNames();
  const category = categories.find((item) => item.category.id === categoryId);

  useEffect(() => {
    api
      .categories()
      .then((result) => setCategories(result.items))
      .catch(() => setCategories([]));
    api
      .makes()
      .then((result) => setMakes(result.items))
      .catch(() => setMakes([]));
    api
      .savedSearches()
      .then((result) => setSavedSearches(result.items))
      .catch(() => setSavedSearches([]));
  }, [api]);
  useEffect(() => {
    let active = true;
    const request = makeId
      ? api.models(makeId)
      : Promise.resolve({ items: [] });
    request
      .then((result) => {
        if (active) setModels(result.items);
      })
      .catch(() => {
        if (active) setModels([]);
      });
    return () => {
      active = false;
    };
  }, [api, makeId]);
  useEffect(() => {
    let active = true;
    const request = modelId
      ? api.variants(modelId)
      : Promise.resolve({ items: [] });
    request
      .then((result) => {
        if (active) setVariants(result.items);
      })
      .catch(() => {
        if (active) setVariants([]);
      });
    return () => {
      active = false;
    };
  }, [api, modelId]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(keyword.trim()), 350);
    return () => clearTimeout(timer);
  }, [keyword]);

  const number = (value: string) =>
    value.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined;
  const filters: VehicleDiscoveryFilters = {
    keyword: debouncedKeyword || undefined,
    purpose: purpose ?? undefined,
    categoryId: categoryId || undefined,
    makeId: makeId || undefined,
    modelId: modelId || undefined,
    variantId: variantId || undefined,
    yearMin: number(yearMin),
    yearMax: number(yearMax),
    mileageMin: number(mileageMin),
    mileageMax: number(mileageMax),
    mileageUnit: mileageMin || mileageMax ? mileageUnit : undefined,
    colour: colour.trim() || undefined,
    pricePeriod: purpose === "RENT" ? pricePeriod || undefined : undefined,
    priceMin: number(priceMin),
    priceMax: number(priceMax),
    currency:
      priceMin || priceMax || sort.startsWith("PRICE")
        ? currency.toUpperCase()
        : undefined,
    fuelType: fuelType || undefined,
    transmission: transmission || undefined,
    driveType: driveType || undefined,
    bodyType: bodyType || undefined,
    condition: condition || undefined,
    seats: number(seats),
    doors: number(doors),
    registrationYearMin: number(registrationYearMin),
    registrationYearMax: number(registrationYearMax),
    engineSizeMin: number(engineSizeMin),
    engineSizeMax: number(engineSizeMax),
    countryId: currentCountryOnly
      ? (session?.profile?.currentCountryId ?? undefined)
      : undefined,
    communityId: communityId || undefined,
    city: city.trim() || undefined,
    region: region.trim() || undefined,
    originLatitude: origin?.latitude,
    originLongitude: origin?.longitude,
    radiusMeters: origin ? (number(radius) ?? 50) * 1000 : undefined,
    attributes: Object.fromEntries(
      Object.entries(attributeFilters).filter(([, value]) => value.trim()),
    ),
    sort,
  };
  const filterKey = JSON.stringify(filters);

  const load = useCallback(
    (key: string, nextCursor?: string) => {
      if (nextCursor && loadingRef.current) return Promise.resolve();
      const request = ++requestSerial.current;
      loadingRef.current = true;
      if (nextCursor) setLoadingMore(true);
      return api
        .discover(JSON.parse(key) as VehicleDiscoveryFilters, nextCursor)
        .then((page) => {
          if (request !== requestSerial.current) return;
          setItems((previous) => {
            if (!nextCursor) return page.items;
            const ids = new Set(previous.map((item) => item.listing.id));
            return [
              ...previous,
              ...page.items.filter((item) => !ids.has(item.listing.id)),
            ];
          });
          setCursor(page.nextCursor);
          setTotalCount(page.totalCount ?? null);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (request === requestSerial.current)
            setError(
              ApiError.isApiError(cause)
                ? cause.userMessage
                : "Failed to load vehicles.",
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
    [api],
  );
  const [previousKey, setPreviousKey] = useState(filterKey);
  if (previousKey !== filterKey) {
    setPreviousKey(filterKey);
    setLoading(true);
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(filterKey);
    return () => {
      requestSerial.current += 1;
    };
  }, [load, filterKey]);

  async function requestMyLocation() {
    setLocationError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setLocationError(
          "Location permission was not granted. Manual search remains available.",
        );
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setOrigin({
        latitude: approximateCoordinate(position.coords.latitude),
        longitude: approximateCoordinate(position.coords.longitude),
      });
      setSort("DISTANCE");
    } catch {
      setLocationError(
        "Your location is unavailable. Manual search remains available.",
      );
    }
  }

  function clearFilters() {
    setKeyword("");
    setPurpose(null);
    setCategoryId("");
    setMakeId("");
    setModelId("");
    setVariantId("");
    setSort("NEWEST");
    setCity("");
    setRegion("");
    setCommunityId("");
    setCurrentCountryOnly(false);
    setYearMin("");
    setYearMax("");
    setMileageMin("");
    setMileageMax("");
    setPriceMin("");
    setPriceMax("");
    setFuelType("");
    setTransmission("");
    setDriveType("");
    setBodyType("");
    setCondition("");
    setSeats("");
    setDoors("");
    setRegistrationYearMin("");
    setRegistrationYearMax("");
    setEngineSizeMin("");
    setEngineSizeMax("");
    setOrigin(null);
    setAttributeFilters({});
    setLocationError(null);
    setMileageUnit("KM");
    setRadius("50");
    setCurrency("EUR");
    setColour("");
    setPricePeriod("");
  }

  async function toggleSave(item: VehicleView) {
    if (pendingSaves.current.has(item.listing.id)) return;
    pendingSaves.current.add(item.listing.id);
    setSaveError(null);
    const saved = !item.listing.saved;
    setItems((previous) =>
      previous.map((current) =>
        current.listing.id === item.listing.id
          ? { ...current, listing: { ...current.listing, saved } }
          : current,
      ),
    );
    try {
      if (saved) await api.save(item.listing.id);
      else await api.unsave(item.listing.id);
    } catch {
      setItems((previous) =>
        previous.map((current) =>
          current.listing.id === item.listing.id
            ? { ...current, listing: { ...current.listing, saved: !saved } }
            : current,
        ),
      );
      setSaveError("Could not update saved vehicles. Please try again.");
    } finally {
      pendingSaves.current.delete(item.listing.id);
    }
  }

  async function toggleSavedSearch() {
    if (savingSearch.current) return;
    savingSearch.current = true;
    setSearchSaveError(null);
    const existing = currentSavedSearch;
    try {
      if (existing) {
        await api.deleteSavedSearch(existing.id);
        setSavedSearches((previous) =>
          previous.filter((entry) => entry.id !== existing.id),
        );
      } else {
        const saved = await api.saveSearch(savedSearchName(), filters);
        setSavedSearches((previous) => [
          saved,
          ...previous.filter((entry) => entry.id !== saved.id),
        ]);
      }
    } catch {
      setSearchSaveError(
        "Could not update saved searches. Please try again.",
      );
    } finally {
      savingSearch.current = false;
    }
  }

  async function deleteSavedSearch(id: string) {
    try {
      await api.deleteSavedSearch(id);
      setSavedSearches((previous) =>
        previous.filter((entry) => entry.id !== id),
      );
    } catch {
      setSearchSaveError(
        "Could not update saved searches. Please try again.",
      );
    }
  }

  function applySavedSearch(entry: VehicleSavedSearch) {
    const applied = fromSavedFilters(entry.filters);
    const value = (input: number | null | undefined) =>
      input == null ? "" : String(input);
    setKeyword(applied.keyword ?? "");
    setDebouncedKeyword(applied.keyword ?? "");
    setPurpose(applied.purpose ?? null);
    setCategoryId(applied.categoryId ?? "");
    setMakeId(applied.makeId ?? "");
    setModelId(applied.modelId ?? "");
    setVariantId(applied.variantId ?? "");
    setSort(applied.sort ?? "NEWEST");
    setYearMin(value(applied.yearMin));
    setYearMax(value(applied.yearMax));
    setMileageMin(value(applied.mileageMin));
    setMileageMax(value(applied.mileageMax));
    setMileageUnit(applied.mileageUnit ?? "KM");
    setColour(applied.colour ?? "");
    setPricePeriod(applied.pricePeriod ?? "");
    setPriceMin(value(applied.priceMin));
    setPriceMax(value(applied.priceMax));
    setCurrency(applied.currency ?? "EUR");
    setFuelType(applied.fuelType ?? "");
    setTransmission(applied.transmission ?? "");
    setDriveType(applied.driveType ?? "");
    setBodyType(applied.bodyType ?? "");
    setCondition(applied.condition ?? "");
    setSeats(value(applied.seats));
    setDoors(value(applied.doors));
    setRegistrationYearMin(value(applied.registrationYearMin));
    setRegistrationYearMax(value(applied.registrationYearMax));
    setEngineSizeMin(value(applied.engineSizeMin));
    setEngineSizeMax(value(applied.engineSizeMax));
    setCurrentCountryOnly(Boolean(applied.countryId));
    setCommunityId(applied.communityId ?? "");
    setCity(applied.city ?? "");
    setRegion(applied.region ?? "");
    setOrigin(
      applied.originLatitude != null && applied.originLongitude != null
        ? {
            latitude: applied.originLatitude,
            longitude: applied.originLongitude,
          }
        : null,
    );
    setRadius(
      applied.radiusMeters != null
        ? String(Math.round(applied.radiusMeters / 1000))
        : "50",
    );
    setAttributeFilters(applied.attributes ?? {});
    setShowSearches(false);
  }

  async function contactSeller(item: VehicleView) {
    try {
      const result = await api.contact(item.listing.id);
      router.push(`/messages/${result.conversationId}` as never);
    } catch {
      setSaveError("Could not contact the seller. Please try again.");
    }
  }

  function savedSearchName() {
    const parts: string[] = [];
    const make = makes.find((entry) => entry.id === makeId)?.displayName;
    const model = models.find((entry) => entry.id === modelId)?.displayName;
    if (make || model) {
      parts.push([make, model].filter(Boolean).join(" "));
    } else if (category) {
      parts.push(category.category.displayName);
    }
    if (purpose) parts.push(purpose === "RENT" ? "For rent" : "For sale");
    if (priceMin || priceMax) {
      parts.push(
        priceMin && priceMax
          ? `${currency} ${priceMin}–${priceMax}`
          : priceMin
            ? `${currency} ${priceMin}+`
            : `up to ${currency} ${priceMax}`,
      );
    }
    if (yearMin || yearMax) {
      parts.push(`${yearMin || "any"}–${yearMax || "any"}`);
    }
    if (debouncedKeyword) parts.push(`“${debouncedKeyword}”`);
    return parts.join(" · ") || "All vehicles";
  }

  const activeFilters =
    Object.entries(filters).filter(
      ([key, value]) =>
        !["sort", "attributes", "mileageUnit"].includes(key) &&
        value !== undefined,
    ).length + Object.keys(filters.attributes ?? {}).length;
  const filtered = activeFilters > 0;
  const sortLabel = {
    NEWEST: "Newest first",
    PRICE_ASC: "Lowest price",
    PRICE_DESC: "Highest price",
    DISTANCE: "Nearest first",
  }[sort];
  const resultLabel = loading
    ? "Loading vehicles…"
    : error
      ? "Results unavailable"
      : `${(totalCount ?? items.length).toLocaleString()}${
          totalCount == null && cursor ? "+" : ""
        } results`;
  const currentSavedSearch = savedSearches.find(
    (entry) =>
      savedSearchKey(fromSavedFilters(entry.filters)) ===
      savedSearchKey(filters),
  );
  const openFilters = (section = "Vehicle type") => {
    setFilterSection(section);
    setShowFilters(true);
  };
  const sectionLayout = (name: string, y: number) => {
    filterSections.current[name] = y;
    if (filterSection === name)
      filterScroll.current?.scrollTo({ y, animated: false });
  };
  const contextId = communityId || session?.activeCommunityId;
  const contextName =
    contextId && communityName(contextId) !== contextId
      ? communityName(contextId)
      : "Your communities";
  const catalogueOptions = (values: VehicleCatalogItem[], all: string) => [
    { id: "", label: all },
    ...values.map((value) => ({ id: value.id, label: value.displayName })),
  ];
  return (
    <ThemedView style={styles.root}>
      <SafeAreaView
        style={[styles.root, { backgroundColor: BrandColors.primaryDark }]}
        edges={["top", "left", "right"]}
      >
        <MarketplaceHeader branding>
          <HeaderAction
            icon="car-outline"
            label="My vehicle listings"
            onPress={() => router.push("/(app)/vehicles/my" as never)}
          />
          <HeaderAction
            icon="add"
            label="Create vehicle"
            onPress={() => router.push("/(app)/vehicles/create" as never)}
          />
        </MarketplaceHeader>
        <View style={[styles.body, { backgroundColor: theme.background }]}>
          <FlatList
            ListHeaderComponentStyle={styles.discoveryHeader}
            ListHeaderComponent={
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filterBar}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Toggle vehicle filters"
                    accessibilityState={{ selected: filtered }}
                    onPress={() => openFilters()}
                    style={[
                      styles.filterToggle,
                      { backgroundColor: theme.text },
                    ]}
                  >
                    <Ionicons
                      name="options"
                      size={19}
                      color={theme.background}
                    />
                    {activeFilters ? (
                      <View
                        style={[
                          styles.filterDot,
                          { borderColor: theme.background },
                        ]}
                      />
                    ) : null}
                  </Pressable>
                  <DropdownPill
                    label={`Sort vehicles: ${sortLabel}`}
                    text={sortLabel}
                    active={sort !== "NEWEST"}
                    onPress={() => setShowSort(true)}
                  />
                  <DropdownPill
                    label="Filter by make and model"
                    text={
                      makeId
                        ? (makes.find((entry) => entry.id === makeId)
                            ?.displayName ?? "Make")
                        : "Any make"
                    }
                    active={Boolean(makeId)}
                    onPress={() => openFilters("Make & model")}
                  />
                  <DropdownPill
                    label="Filter by price"
                    text={
                      priceMin || priceMax
                        ? priceMin && priceMax
                          ? `${currency} ${priceMin}–${priceMax}`
                          : priceMin
                            ? `${currency} ${priceMin}+`
                            : `≤ ${currency} ${priceMax}`
                        : "Price"
                    }
                    active={Boolean(priceMin || priceMax)}
                    onPress={() => openFilters("Price range")}
                  />
                  <DropdownPill
                    label="Filter by year"
                    text={
                      yearMin || yearMax
                        ? `${yearMin || "…"}–${yearMax || "…"}`
                        : "Year"
                    }
                    active={Boolean(yearMin || yearMax)}
                    onPress={() => openFilters("Model year")}
                  />
                  <DropdownPill
                    label="Filter by mileage"
                    text={
                      mileageMin || mileageMax
                        ? `${mileageMin || "…"}–${mileageMax || "…"} ${
                            mileageUnit === "MILES" ? "mi" : "km"
                          }`
                        : "Mileage"
                    }
                    active={Boolean(mileageMin || mileageMax)}
                    onPress={() => openFilters("Mileage")}
                  />
                  <DropdownPill
                    label="Filter by fuel type"
                    text={fuelType ? vehicleLabel(fuelType) : "Fuel"}
                    active={Boolean(fuelType)}
                    onPress={() => openFilters("Fuel type")}
                  />
                  <DropdownPill
                    label="Filter by category"
                    text={
                      category ? category.category.displayName : "Category"
                    }
                    active={Boolean(categoryId)}
                    onPress={() => openFilters("Vehicle type")}
                  />
                  <DropdownPill
                    label="Filter by listing purpose"
                    text={
                      purpose === "SALE"
                        ? "For sale"
                        : purpose === "RENT"
                          ? "For rent"
                          : "Buy or rent"
                    }
                    active={Boolean(purpose)}
                    onPress={() => openFilters()}
                  />
                  <DropdownPill
                    label="Search by keyword"
                    text={keyword || "Keyword"}
                    icon="search"
                    active={Boolean(keyword.trim())}
                    onPress={() => openFilters("Keyword")}
                  />
                  <DropdownPill
                    label="Filter by location"
                    text={
                      city.trim()
                        ? city.trim()
                        : origin
                          ? "Nearby"
                          : communityId
                            ? contextName
                            : "Location"
                    }
                    active={Boolean(
                      city.trim() ||
                        region.trim() ||
                        communityId ||
                        origin ||
                        currentCountryOnly,
                    )}
                    onPress={() => openFilters("Location & community")}
                  />
                  {savedSearches.length ? (
                    <DropdownPill
                      label="Saved searches"
                      text={`${savedSearches.length} saved ${
                        savedSearches.length === 1 ? "search" : "searches"
                      }`}
                      icon="bookmark"
                      onPress={() => setShowSearches(true)}
                    />
                  ) : null}
                </ScrollView>
                <View style={styles.resultRow}>
                  <ThemedText
                    style={styles.results}
                    accessibilityLiveRegion="polite"
                  >
                    {resultLabel}
                  </ThemedText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      currentSavedSearch
                        ? "Remove saved search"
                        : "Save search"
                    }
                    onPress={() => void toggleSavedSearch()}
                    style={({ pressed }) => [
                      styles.saveSearch,
                      pressed && styles.pressed,
                    ]}
                  >
                    <ThemedText style={styles.saveSearchText}>
                      Save search
                    </ThemedText>
                    <Ionicons
                      name={
                        currentSavedSearch ? "heart" : "heart-outline"
                      }
                      size={20}
                      color={
                        currentSavedSearch ? BrandColors.error : theme.text
                      }
                    />
                  </Pressable>
                </View>
                {saveError ? (
                  <ThemedText style={styles.error} accessibilityRole="alert">
                    {saveError}
                  </ThemedText>
                ) : null}
                {searchSaveError ? (
                  <ThemedText style={styles.error} accessibilityRole="alert">
                    {searchSaveError}
                  </ThemedText>
                ) : null}
                {locationError ? (
                  <ThemedText style={styles.error} accessibilityRole="alert">
                    {locationError}
                  </ThemedText>
                ) : null}
                {loading && !refreshing ? (
                  <ActivityIndicator
                    style={styles.state}
                    color={BrandColors.primary}
                    accessibilityLabel="Loading vehicles"
                  />
                ) : error ? (
                  <View style={styles.state} accessibilityRole="alert">
                    <ThemedText style={styles.stateText}>{error}</ThemedText>
                    <PrimaryButton
                      label="Retry"
                      variant="secondary"
                      onPress={() => void load(filterKey)}
                    />
                  </View>
                ) : null}
              </>
            }
            testID="vehicles-discovery-list"
            data={items}
            keyExtractor={(item) => item.listing.id}
            renderItem={({ item }) => (
              <VehicleCard
                item={item}
                onToggleSave={(value) => void toggleSave(value)}
                onPress={(id) => router.push(`/(app)/vehicles/${id}` as never)}
                onContact={
                  !item.canManage && item.listing.status === "PUBLISHED"
                    ? (value) => void contactSeller(value)
                    : undefined
                }
              />
            )}
            onEndReached={() => {
              if (cursor && !loadingRef.current)
                void load(filterKey, cursor);
            }}
            onEndReachedThreshold={0.4}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                tintColor={BrandColors.primary}
                onRefresh={() => {
                  setRefreshing(true);
                  void load(filterKey);
                }}
              />
            }
            ListEmptyComponent={
              !loading && !error ? (
                <View style={styles.state}>
                  <Ionicons
                    name="car-outline"
                    size={42}
                    color={theme.textSecondary}
                  />
                  <ThemedText type="subtitle">No vehicles found</ThemedText>
                  <ThemedText
                    style={styles.stateText}
                    themeColor="textSecondary"
                  >
                    {filtered
                      ? "Try changing or clearing your filters."
                      : "Published vehicles will appear here."}
                  </ThemedText>
                </View>
              ) : undefined
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
              items.length === 0
                ? styles.empty
                : [
                    styles.list,
                    { paddingBottom: 88 + insets.bottom },
                  ]
            }
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Saved vehicles"
            onPress={() => router.push("/(app)/vehicles/saved" as never)}
            style={({ pressed }) => [
              styles.savedFab,
              { bottom: Spacing.four + insets.bottom },
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="heart" size={24} color={BrandColors.white} />
          </Pressable>
        </View>
        {showFilters ? (
          <Sheet
            visible
            title="Filter Vehicles"
            onClose={() => setShowFilters(false)}
            scrollRef={filterScroll}
            footer={
              <View style={styles.footerActions}>
                <View style={styles.clearAction}>
                  <PrimaryButton
                    label="Clear all"
                    variant="secondary"
                    onPress={clearFilters}
                  />
                </View>
                <View style={styles.resultsAction}>
                  <PrimaryButton
                    label={loading ? "Updating results…" : "Show results"}
                    onPress={() => setShowFilters(false)}
                  />
                </View>
              </View>
            }
          >
            <PurposeControl value={purpose} onChange={setPurpose} />
            <FilterSection
              title="Keyword"
              icon="search"
              onLayout={sectionLayout}
            >
              <View
                style={[
                  styles.keywordSearch,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                  },
                ]}
              >
                <Ionicons
                  name="search"
                  size={19}
                  color={theme.textSecondary}
                />
                <TextInput
                  value={keyword}
                  onChangeText={setKeyword}
                  placeholder="Search make, model or keyword..."
                  accessibilityLabel="Search vehicles"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.keywordInput, { color: theme.text }]}
                  returnKeyType="search"
                />
                {keyword ? (
                  <Pressable
                    onPress={() => setKeyword("")}
                    accessibilityRole="button"
                    accessibilityLabel="Clear vehicle search"
                  >
                    <Ionicons
                      name="close-circle"
                      size={19}
                      color={theme.textSecondary}
                    />
                  </Pressable>
                ) : null}
              </View>
            </FilterSection>
            <FilterSection
              title="Vehicle type"
              icon="car-outline"
              onLayout={sectionLayout}
            >
              <View style={styles.categoryGrid}>
                {categories.map((item) => (
                  <Pressable
                    key={item.category.id}
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: categoryId === item.category.id,
                    }}
                    onPress={() => {
                      setCategoryId(
                        categoryId === item.category.id ? "" : item.category.id,
                      );
                      setAttributeFilters({});
                    }}
                    style={[
                      styles.categoryTile,
                      {
                        borderColor:
                          categoryId === item.category.id
                            ? theme.primary
                            : theme.border,
                        backgroundColor:
                          categoryId === item.category.id
                            ? theme.primarySurface
                            : theme.background,
                      },
                    ]}
                  >
                    <Ionicons
                      name={categoryIcon(item.category.key)}
                      size={28}
                      color={
                        categoryId === item.category.id
                          ? theme.primary
                          : theme.text
                      }
                    />
                    <ThemedText style={styles.categoryText}>
                      {item.category.displayName}
                    </ThemedText>
                    {categoryId === item.category.id ? (
                      <Ionicons
                        style={styles.categoryCheck}
                        name="checkmark-circle"
                        size={16}
                        color={theme.primary}
                      />
                    ) : null}
                  </Pressable>
                ))}
              </View>
              {!categories.length ? (
                <ThemedText themeColor="textSecondary">
                  Vehicle categories are unavailable. Search is still available.
                </ThemedText>
              ) : null}
            </FilterSection>
            <FilterSection
              title="Make & model"
              icon="car-sport-outline"
              onLayout={sectionLayout}
            >
              <SelectField
                label="Make"
                value={makeId}
                options={catalogueOptions(makes, "Any make")}
                searchPlaceholder="Search makes..."
                onChange={(value) => {
                  setMakeId(value);
                  setModelId("");
                  setVariantId("");
                  setModels([]);
                  setVariants([]);
                }}
              />
              {makeId ? (
                <SelectField
                  label="Model"
                  value={modelId}
                  options={catalogueOptions(models, "Any model")}
                  searchPlaceholder="Search models..."
                  onChange={(value) => {
                    setModelId(value);
                    setVariantId("");
                    setVariants([]);
                  }}
                />
              ) : null}
              {modelId && variants.length ? (
                <SelectField
                  label="Variant"
                  value={variantId}
                  options={catalogueOptions(variants, "Any variant")}
                  onChange={setVariantId}
                />
              ) : null}
            </FilterSection>
            <FilterSection
              title="Price range"
              icon="cash-outline"
              onLayout={sectionLayout}
            >
              <View style={styles.grid}>
                <FilterInput
                  label="Minimum price"
                  value={priceMin}
                  onChangeText={setPriceMin}
                  numeric
                />
                <FilterInput
                  label="Maximum price"
                  value={priceMax}
                  onChangeText={setPriceMax}
                  numeric
                />
              </View>
              <FilterInput
                label="Currency"
                value={currency}
                onChangeText={setCurrency}
              />
              {purpose === "RENT" ? (
                <>
                  <SelectField
                    label="Rental price period"
                    value={pricePeriod}
                    options={[
                      { id: "", label: "Any period" },
                      { id: "DAY", label: "Per day" },
                      { id: "WEEK", label: "Per week" },
                      { id: "MONTH", label: "Per month" },
                    ]}
                    onChange={setPricePeriod}
                  />
                  <ThemedText style={styles.hint} themeColor="textSecondary">
                    Select a period to compare like-for-like rental rates.
                  </ThemedText>
                </>
              ) : null}
            </FilterSection>
            <FilterSection
              title="Model year"
              icon="calendar-outline"
              onLayout={sectionLayout}
            >
              <View style={styles.grid}>
                <FilterInput
                  label="Minimum year"
                  value={yearMin}
                  onChangeText={setYearMin}
                  numeric
                />
                <FilterInput
                  label="Maximum year"
                  value={yearMax}
                  onChangeText={setYearMax}
                  numeric
                />
              </View>
            </FilterSection>
            <FilterSection
              title="Mileage"
              icon="speedometer-outline"
              onLayout={sectionLayout}
            >
              <FilterChoices
                values={["KM", "MILES"]}
                current={mileageUnit}
                onSelect={(value) => {
                  if (value) {
                    setMileageUnit(value);
                    setMileageMin("");
                    setMileageMax("");
                  }
                }}
                renderLabel={(value) =>
                  value === "KM" ? "Kilometers" : "Miles"
                }
              />
              <View style={styles.grid}>
                <FilterInput
                  label="Minimum mileage"
                  value={mileageMin}
                  onChangeText={setMileageMin}
                  numeric
                />
                <FilterInput
                  label="Maximum mileage"
                  value={mileageMax}
                  onChangeText={setMileageMax}
                  numeric
                />
              </View>
            </FilterSection>
            <FilterSection
              title="Fuel type"
              icon="water-outline"
              onLayout={sectionLayout}
            >
              <FilterChoices
                values={FUEL}
                current={fuelType}
                onSelect={setFuelType}
              />
            </FilterSection>
            <FilterSection
              title="Additional filters"
              icon="options-outline"
              onLayout={sectionLayout}
            >
              {[
                ["Transmission", TRANSMISSION, transmission, setTransmission],
                ["Body type", BODY, bodyType, setBodyType],
                ["Drive type", DRIVE, driveType, setDriveType],
                ["Condition", CONDITION, condition, setCondition],
              ].map(([label, values, current, setter]) => (
                <SelectField
                  key={label as string}
                  label={label as string}
                  value={current as string}
                  options={[
                    { id: "", label: "Any" },
                    ...(values as string[]).map((value) => ({
                      id: value,
                      label: vehicleLabel(value),
                    })),
                  ]}
                  onChange={setter as (value: string) => void}
                />
              ))}
              <View style={styles.grid}>
                <FilterInput
                  label="Minimum engine cc"
                  value={engineSizeMin}
                  onChangeText={setEngineSizeMin}
                  numeric
                />
                <FilterInput
                  label="Maximum engine cc"
                  value={engineSizeMax}
                  onChangeText={setEngineSizeMax}
                  numeric
                />
              </View>
              <View style={styles.grid}>
                <FilterInput
                  label="Min registration year"
                  value={registrationYearMin}
                  onChangeText={setRegistrationYearMin}
                  numeric
                />
                <FilterInput
                  label="Max registration year"
                  value={registrationYearMax}
                  onChangeText={setRegistrationYearMax}
                  numeric
                />
              </View>
              <FilterInput
                label="Colour"
                value={colour}
                onChangeText={setColour}
              />
              <View style={styles.grid}>
                <FilterInput
                  label="Seats"
                  value={seats}
                  onChangeText={setSeats}
                  numeric
                />
                <FilterInput
                  label="Doors"
                  value={doors}
                  onChangeText={setDoors}
                  numeric
                />
              </View>
              {category
                ? Object.entries(category.attributes)
                    .filter(([, policy]) => policy.filterable)
                    .map(([key, policy]) =>
                      policy.options.length ? (
                        <SelectField
                          key={key}
                          label={vehicleLabel(key)}
                          value={attributeFilters[key] ?? ""}
                          options={[
                            { id: "", label: "Any" },
                            ...policy.options.map((value) => ({
                              id: value,
                              label: vehicleLabel(value),
                            })),
                          ]}
                          onChange={(value) =>
                            setAttributeFilters((previous) => ({
                              ...previous,
                              [key]: value,
                            }))
                          }
                        />
                      ) : (
                        <FilterInput
                          key={key}
                          label={`${key} attribute`}
                          value={attributeFilters[key] ?? ""}
                          numeric={["NUMBER", "INTEGER"].includes(policy.type)}
                          onChangeText={(value) =>
                            setAttributeFilters((previous) => ({
                              ...previous,
                              [key]: value,
                            }))
                          }
                        />
                      ),
                    )
                : null}
            </FilterSection>
            <FilterSection
              title="Location & community"
              icon="location-outline"
              onLayout={sectionLayout}
            >
              <View style={styles.grid}>
                <FilterInput label="City" value={city} onChangeText={setCity} />
                <FilterInput
                  label="Region"
                  value={region}
                  onChangeText={setRegion}
                />
              </View>
              {session?.profile?.currentCountryId ? (
                <Chip
                  text="Current country only"
                  active={currentCountryOnly}
                  onPress={() => setCurrentCountryOnly((value) => !value)}
                />
              ) : null}
              <SelectField
                label="Community"
                value={communityId}
                options={[
                  { id: "", label: "All accessible communities" },
                  ...(session?.memberships
                    .filter((membership) => membership.status === "ACTIVE")
                    .map((membership) => ({
                      id: membership.communityId,
                      label: communityName(membership.communityId),
                    })) ?? []),
                ]}
                onChange={setCommunityId}
              />
              <PrimaryButton
                label="Use my location"
                variant="secondary"
                onPress={() => void requestMyLocation()}
              />
              {origin ? (
                <PrimaryButton
                  label="Clear nearby search"
                  variant="secondary"
                  onPress={() => {
                    setOrigin(null);
                    if (sort === "DISTANCE") setSort("NEWEST");
                  }}
                />
              ) : null}
              <FilterInput
                label="Radius (km)"
                value={radius}
                onChangeText={setRadius}
                numeric
              />
              {locationError ? (
                <ThemedText style={styles.error} accessibilityRole="alert">
                  {locationError}
                </ThemedText>
              ) : null}
            </FilterSection>
            <ThemedText style={styles.hint} themeColor="textSecondary">
              {resultLabel}
              {cursor ? " loaded. More results are available." : ""}. Filters
              update as you choose.
            </ThemedText>
          </Sheet>
        ) : null}
        <Sheet
          visible={showSort}
          title="Sort vehicles"
          onClose={() => setShowSort(false)}
        >
          {(
            ["NEWEST", "PRICE_ASC", "PRICE_DESC", "DISTANCE"] as VehicleSort[]
          ).map((value) => (
            <Chip
              key={value}
              text={
                {
                  NEWEST: "Newest first",
                  PRICE_ASC: "Lowest price",
                  PRICE_DESC: "Highest price",
                  DISTANCE: "Nearest first",
                }[value]
              }
              active={sort === value}
              onPress={() => {
                if (value === "DISTANCE" && !origin) void requestMyLocation();
                else setSort(value);
                setShowSort(false);
              }}
            />
          ))}
          <FilterInput
            label="Currency"
            value={currency}
            onChangeText={setCurrency}
          />
          <ThemedText style={styles.hint} themeColor="textSecondary">
            Price sorting uses the selected currency. Nearby search asks for
            your location.
          </ThemedText>
          {locationError ? (
            <ThemedText style={styles.error}>{locationError}</ThemedText>
          ) : null}
        </Sheet>
        <Sheet
          visible={showSearches}
          title="Saved searches"
          onClose={() => setShowSearches(false)}
        >
          {savedSearches.length ? (
            savedSearches.map((entry) => (
              <View
                key={entry.id}
                style={[styles.savedRow, { borderBottomColor: theme.border }]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Apply saved search ${entry.name}`}
                  onPress={() => applySavedSearch(entry)}
                  style={({ pressed }) => [
                    styles.savedApply,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    name="bookmark"
                    size={18}
                    color={theme.primary}
                  />
                  <View style={styles.savedInfo}>
                    <ThemedText style={styles.savedName} numberOfLines={1}>
                      {entry.name}
                    </ThemedText>
                    <ThemedText
                      style={styles.savedDate}
                      themeColor="textSecondary"
                    >
                      Saved{" "}
                      {new Date(entry.createdAt).toLocaleDateString(
                        undefined,
                        { day: "numeric", month: "short", year: "numeric" },
                      )}
                    </ThemedText>
                  </View>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete saved search ${entry.name}`}
                  onPress={() => void deleteSavedSearch(entry.id)}
                  style={styles.savedDelete}
                >
                  <Ionicons
                    name="trash-outline"
                    size={19}
                    color={theme.textSecondary}
                  />
                </Pressable>
              </View>
            ))
          ) : (
            <ThemedText themeColor="textSecondary">
              Save the current filters with Save search to reuse them later.
            </ThemedText>
          )}
        </Sheet>
      </SafeAreaView>
    </ThemedView>
  );
}

function DropdownPill({
  text,
  active = false,
  onPress,
  icon,
  label,
}: {
  text: string;
  active?: boolean;
  onPress: () => void;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  label?: string;
}) {
  const theme = useTheme();
  const accent = theme.primary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? text}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.pill,
        {
          borderColor: active ? accent : theme.border,
          backgroundColor: active ? theme.primarySurface : theme.background,
        },
        pressed && styles.pressed,
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={15}
          color={active ? accent : theme.text}
        />
      ) : active ? (
        <Ionicons name="checkmark" size={15} color={accent} />
      ) : null}
      <ThemedText
        style={[styles.pillText, active && { color: accent }]}
        numberOfLines={1}
      >
        {text}
      </ThemedText>
      <Ionicons
        name="chevron-down"
        size={14}
        color={active ? accent : theme.textSecondary}
      />
    </Pressable>
  );
}

function Chip({
  text,
  active,
  onPress,
  icon,
  label,
}: {
  text: string;
  active: boolean;
  onPress: () => void;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  label?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
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
      {icon ? (
        <Ionicons
          name={icon}
          size={16}
          color={active ? BrandColors.white : theme.text}
        />
      ) : null}
      <ThemedText style={[styles.chipText, active && styles.activeChip]}>
        {text}
      </ThemedText>
    </Pressable>
  );
}

function FilterChoices({
  values,
  current,
  onSelect,
  renderLabel = vehicleLabel,
}: {
  values: string[];
  current: string;
  onSelect: (value: string) => void;
  renderLabel?: (value: string) => string;
}) {
  return (
    <View style={styles.choices}>
      {values.map((value) => (
        <Chip
          key={value}
          text={renderLabel(value)}
          active={current === value}
          onPress={() => onSelect(current === value ? "" : value)}
        />
      ))}
    </View>
  );
}

function FilterInput({
  label,
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
    <View style={styles.inputGroup}>
      <ThemedText style={styles.inputLabel}>{label}</ThemedText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={label}
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        keyboardType={numeric ? "decimal-pad" : "default"}
        style={[
          styles.filterInput,
          {
            color: theme.text,
            borderColor: theme.border,
            backgroundColor: theme.background,
          },
        ]}
      />
    </View>
  );
}

function categoryIcon(
  key: string,
): React.ComponentProps<typeof Ionicons>["name"] {
  const icons: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
    CAR: "car-sport-outline",
    VAN: "car-outline",
    MOTORBIKE: "bicycle-outline",
    MOTORCYCLE: "bicycle-outline",
    TRUCK: "bus-outline",
    BUS: "bus-outline",
  };
  return icons[key] ?? "ellipsis-horizontal";
}

function PurposeControl({
  value,
  onChange,
}: {
  value: VehiclePurpose | null;
  onChange: (value: VehiclePurpose | null) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={[styles.segment, { backgroundColor: theme.backgroundElement }]}
    >
      {([null, "SALE", "RENT"] as const).map((purpose) => (
        <Pressable
          key={purpose ?? "all"}
          accessibilityRole="button"
          accessibilityState={{ selected: value === purpose }}
          onPress={() => onChange(purpose)}
          style={[
            styles.segmentItem,
            value === purpose && { backgroundColor: BrandColors.primaryDark },
          ]}
        >
          <ThemedText
            style={[styles.segmentText, value === purpose && styles.activeChip]}
          >
            {purpose === "SALE"
              ? "For Sale"
              : purpose === "RENT"
                ? "For Rent"
                : "All listings"}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

function FilterSection({
  title,
  icon,
  onLayout,
  children,
}: {
  title: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onLayout: (name: string, y: number) => void;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      onLayout={(event) => onLayout(title, event.nativeEvent.layout.y)}
      style={[styles.filterSection, { borderBottomColor: theme.border }]}
    >
      <View style={styles.sectionHeading}>
        <Ionicons name={icon} size={21} color={theme.text} />
        <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, width: "100%", maxWidth: 720, alignSelf: "center" },
  discoveryHeader: { gap: 4, paddingTop: 4 },
  pressed: { opacity: 0.7 },
  filterBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  filterToggle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  filterDot: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: BrandColors.error,
    borderWidth: 1.5,
  },
  pill: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 14,
  },
  pillText: { fontSize: 14, fontWeight: "600", maxWidth: 170 },
  resultRow: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.two,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  results: { fontSize: 15, fontWeight: "700" },
  saveSearch: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    minHeight: 44,
  },
  saveSearchText: { fontSize: 15, fontWeight: "600" },
  savedFab: {
    position: "absolute",
    right: Spacing.four,
    bottom: Spacing.four,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: BrandColors.error,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: BrandColors.black,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 5,
  },
  keywordSearch: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: Spacing.two,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  keywordInput: { flex: 1, fontSize: 14, minHeight: 44 },
  savedRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.two,
  },
  savedApply: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: 44,
  },
  savedInfo: { flex: 1 },
  savedName: { fontSize: 15, fontWeight: "600" },
  savedDate: { fontSize: 12 },
  savedDelete: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  segment: { flexDirection: "row", borderRadius: 24, padding: 3 },
  segmentItem: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    minHeight: 44,
  },
  segmentText: { fontSize: 13, fontWeight: "700" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterSection: {
    gap: 12,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: "700" },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryTile: {
    width: "31%",
    flexGrow: 1,
    minHeight: 76,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  categoryText: { fontSize: 12, fontWeight: "600" },
  categoryCheck: { position: "absolute", top: 5, right: 5 },
  inputGroup: { flexGrow: 1, minWidth: 120, gap: 4 },
  inputLabel: { fontSize: 12, lineHeight: 18, fontWeight: "600" },
  hint: { fontSize: 12, lineHeight: 18 },
  footerActions: { flexDirection: "row", gap: 10 },
  clearAction: { flex: 1 },
  resultsAction: { flex: 1.6 },
  chip: {
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  chipText: { fontSize: 12, fontWeight: "600" },
  activeChip: { color: BrandColors.white },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  filterInput: {
    borderWidth: 1,
    borderRadius: 9,
    minHeight: 40,
    paddingHorizontal: Spacing.two,
    fontSize: 13,
    marginVertical: 2,
  },
  list: { paddingBottom: 88 },
  state: {
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.five,
    gap: Spacing.two,
  },
  stateText: { textAlign: "center", fontSize: 14 },
  error: { color: BrandColors.error, paddingHorizontal: Spacing.four },
  footer: { padding: Spacing.four },
  empty: { flexGrow: 1 },
});
