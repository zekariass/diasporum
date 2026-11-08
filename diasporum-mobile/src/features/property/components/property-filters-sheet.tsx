import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Accuracy,
  getCurrentPositionAsync,
  requestForegroundPermissionsAsync,
} from "expo-location";
import { ThemedText } from "@/components/themed-text";
import { Sheet } from "@/shared/components/sheet";
import { PrimaryButton } from "@/shared/components/primary-button";
import { SelectField } from "@/shared/components/select-field";
import { ChoiceChip, DateField } from "@/shared/components/form-controls";
import { CURRENCY_OPTIONS } from "@/shared/utils/currencies";
import { useTheme } from "@/hooks/use-theme";
import { Spacing, BorderRadius } from "@/shared/theme/spacing";
import type { PropertyApi } from "../services/property-api";
import type {
  PropertyDiscoveryFilters,
  PropertyType,
} from "../types/property-types";
import {
  discoveryFilters,
  emptyFilters,
  filterError,
  normalizeFilters,
  type PropertyFilterState,
} from "../utils/property-filters";
import { Field, RadiusSlider } from "./property-controls";
import { PurposeSelector } from "./property-marketplace-ui";

export type FilterSection = "all" | "type" | "location" | "price" | "bedrooms";
const typeIcons: Record<string, React.ComponentProps<typeof Ionicons>["name"]> =
  {
    HOUSE: "home-outline",
    APARTMENT: "business-outline",
    STUDIO: "cube-outline",
    BUNGALOW: "home-outline",
    LAND: "leaf-outline",
    COMMERCIAL: "storefront-outline",
    ROOM: "bed-outline",
    VILLA: "home-outline",
    TOWNHOUSE: "business-outline",
  };
const conditions = ["NEW", "EXCELLENT", "GOOD", "FAIR", "NEEDS_RENOVATION"];
const humanize = (value: string) => value.toLowerCase().replaceAll("_", " ");

/** Mounted on opening: applied filters are stable until Show results is pressed. */
export function PropertyFiltersSheet({
  applied,
  types,
  typesError,
  onRetryTypes,
  section,
  context,
  api,
  onApply,
  onClose,
  radiusKm,
  nearby,
}: {
  applied: PropertyFilterState;
  types: PropertyType[];
  typesError: boolean;
  onRetryTypes: () => void;
  section: FilterSection;
  context: PropertyDiscoveryFilters;
  api: PropertyApi;
  onApply: (
    value: PropertyFilterState,
    nearby: { latitude: number; longitude: number } | null,
    radius: number,
  ) => void;
  onClose: () => void;
  radiusKm: number;
  nearby: { latitude: number; longitude: number } | null;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState(applied);
  const [radius, setRadius] = useState(radiusKm);
  const [draftNearby, setDraftNearby] = useState(nearby);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const locationBusy = useRef(false);
  const onNearby = async () => {
    if (locationBusy.current) return;
    if (draftNearby) {
      setDraftNearby(null);
      return;
    }
    locationBusy.current = true;
    setLocating(true);
    setLocationError(null);
    try {
      const permission = await requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setLocationError(
          "Location access was not granted. You can still search by city or area.",
        );
        return;
      }
      const position = await getCurrentPositionAsync({
        accuracy: Accuracy.Balanced,
      });
      setDraftNearby({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
    } catch {
      setLocationError(
        "Could not determine your location. Try a city search instead.",
      );
    } finally {
      locationBusy.current = false;
      setLocating(false);
    }
  };
  const [count, setCount] = useState<{
    key: string;
    value: number | null;
  } | null>(null);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const scrolled = useRef(false);
  const patch = (value: Partial<PropertyFilterState>) =>
    setDraft((previous) => normalizeFilters({ ...previous, ...value }, types));
  const error = filterError(draft);
  const countKey = JSON.stringify({
    ...context,
    ...discoveryFilters(draft),
    ...(draftNearby ? { ...draftNearby, radiusKm: radius } : {}),
  });
  useEffect(() => {
    if (error) return;
    let active = true;
    const timer = setTimeout(() => {
      api
        .discover(
          JSON.parse(countKey) as PropertyDiscoveryFilters,
          undefined,
          1,
        )
        .then((page) => {
          if (active)
            setCount({ key: countKey, value: page.totalCount ?? null });
        })
        .catch(() => {
          if (active) setCount({ key: countKey, value: null });
        });
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, countKey, error]);
  const focusSection = (target: FilterSection, y: number) => {
    if (section === target && !scrolled.current) {
      scrolled.current = true;
      scroll.current?.scrollTo({ y, animated: false });
    }
  };
  const type = types.find(
    (entry) => entry.id === draft.propertyTypeId,
  )?.typeKey;
  const resultCount = count?.key === countKey ? count.value : null;
  return (
    <Sheet
      visible
      title="Filter Properties"
      onClose={onClose}
      scrollRef={scroll}
      footer={
        <>
          {error ? (
            <ThemedText
              accessibilityRole="alert"
              style={{ color: theme.error, marginBottom: Spacing.two }}
            >
              {error}
            </ThemedText>
          ) : null}
          <View style={styles.actions}>
            <PrimaryButton
              label="Clear all"
              variant="secondary"
              onPress={() => {
                setDraft(emptyFilters(draft.listingPurpose));
                setRadius(25);
                setDraftNearby(null);
              }}
              style={styles.clear}
            />
            <PrimaryButton
              label={
                resultCount == null
                  ? "Show results"
                  : `Show ${resultCount} ${resultCount === 1 ? "property" : "properties"}`
              }
              disabled={Boolean(error)}
              onPress={() => {
                onApply(draft, draftNearby, radius);
                onClose();
              }}
              style={styles.grow}
            />
          </View>
        </>
      }
    >
      <PurposeSelector
        value={draft.listingPurpose}
        onChange={(listingPurpose) => patch({ listingPurpose })}
      />
      <ThemedText type="small" themeColor="textSecondary">
        Your changes apply when you select Show results.
      </ThemedText>
      <View
        style={styles.group}
        onLayout={(event) => focusSection("type", event.nativeEvent.layout.y)}
      >
        <Heading title="Property type" icon="home-outline" />
        {typesError ? (
          <PrimaryButton
            variant="ghost"
            label="Retry property types"
            onPress={onRetryTypes}
          />
        ) : null}
        <View style={styles.typeGrid}>
          {[{ id: "", typeKey: "ANY", displayName: "Any type" }, ...types].map(
            (entry) => (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                accessibilityLabel={entry.displayName}
                accessibilityState={{
                  selected: draft.propertyTypeId === entry.id,
                }}
                onPress={() => patch({ propertyTypeId: entry.id })}
                style={[
                  styles.typeCard,
                  {
                    borderColor:
                      draft.propertyTypeId === entry.id
                        ? theme.primary
                        : theme.border,
                    backgroundColor:
                      draft.propertyTypeId === entry.id
                        ? theme.primarySurface
                        : theme.background,
                  },
                ]}
              >
                <Ionicons
                  name={typeIcons[entry.typeKey] ?? "grid-outline"}
                  size={26}
                  color={theme.primary}
                />
                <ThemedText style={styles.typeName}>
                  {entry.displayName}
                </ThemedText>
              </Pressable>
            ),
          )}
        </View>
      </View>
      <View
        style={styles.group}
        onLayout={(event) =>
          focusSection("location", event.nativeEvent.layout.y)
        }
      >
        <Heading title="Location" icon="location-outline" />
        <Field
          label="City or area"
          value={draft.city}
          onChangeText={(city) => patch({ city })}
          placeholder="Any city or region in your country"
        />
        <ChoiceChip
          label={
            locating
              ? "Finding your location…"
              : draftNearby
                ? "Nearby search enabled"
                : "Search near my current location"
          }
          selected={Boolean(draftNearby)}
          onPress={() => void onNearby()}
          icon="navigate-outline"
        />
        <RadiusSlider value={radius} onCommit={setRadius} />
        {locationError ? (
          <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>
            {locationError}
          </ThemedText>
        ) : null}
      </View>
      <View
        style={styles.group}
        onLayout={(event) => focusSection("price", event.nativeEvent.layout.y)}
      >
        <Heading title="Price range" icon="cash-outline" />
        <SelectField
          label="Currency"
          value={draft.currencyCode}
          options={[{ id: "", label: "Any currency" }, ...CURRENCY_OPTIONS]}
          onChange={(currencyCode) => patch({ currencyCode })}
          searchPlaceholder="Search currencies"
        />
        <View style={styles.row}>
          <View style={styles.grow}>
            <Field
              label="Minimum price"
              value={draft.minPrice}
              onChangeText={(minPrice) => patch({ minPrice })}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.grow}>
            <Field
              label="Maximum price"
              value={draft.maxPrice}
              onChangeText={(maxPrice) => patch({ maxPrice })}
              keyboardType="decimal-pad"
            />
          </View>
        </View>
        {draft.listingPurpose === "RENT" ? (
          <SelectField
            label="Rent period"
            value={draft.pricePeriod}
            options={[
              { id: "", label: "Any period" },
              { id: "WEEK", label: "Per week" },
              { id: "MONTH", label: "Per month" },
              { id: "YEAR", label: "Per year" },
            ]}
            onChange={(pricePeriod) => patch({ pricePeriod })}
          />
        ) : null}
        <ThemedText type="small" themeColor="textSecondary">
          Prices are asking amounts, without currency conversion. Choose a
          currency{draft.listingPurpose === "RENT" ? " and rent period" : ""} to
          compare like for like.
        </ThemedText>
      </View>
      {type !== "LAND" && type !== "COMMERCIAL" ? (
        <View
          style={styles.group}
          onLayout={(event) =>
            focusSection("bedrooms", event.nativeEvent.layout.y)
          }
        >
          <Heading title="Bedrooms" icon="bed-outline" />
          <Rooms
            label="Bedrooms"
            value={draft.bedrooms}
            onChange={(bedrooms) => patch({ bedrooms })}
          />
        </View>
      ) : null}
      {type !== "LAND" ? (
        <View style={styles.group}>
          <Heading title="Bathrooms" icon="water-outline" />
          <Rooms
            label="Bathrooms"
            value={draft.bathrooms}
            onChange={(bathrooms) => patch({ bathrooms })}
          />
        </View>
      ) : null}
      <View style={styles.group}>
        <Heading title="Other filters" icon="options-outline" />
        <SelectField
          label="Floor area unit"
          value={draft.floorAreaUnit}
          options={[
            { id: "SQM", label: "Square meters (m²)" },
            { id: "SQFT", label: "Square feet (ft²)" },
          ]}
          onChange={(floorAreaUnit) => patch({ floorAreaUnit })}
        />
        <View style={styles.row}>
          <View style={styles.grow}>
            <Field
              label="Minimum floor area"
              value={draft.minFloorArea}
              onChangeText={(minFloorArea) => patch({ minFloorArea })}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.grow}>
            <Field
              label="Maximum floor area"
              value={draft.maxFloorArea}
              onChangeText={(maxFloorArea) => patch({ maxFloorArea })}
              keyboardType="decimal-pad"
            />
          </View>
        </View>
        {type !== "LAND" ? (
          <SelectField
            label="Furnishing"
            value={draft.furnishedStatus}
            options={[
              { id: "", label: "Any" },
              ...["FURNISHED", "PART_FURNISHED", "UNFURNISHED"].map(
                (value) => ({ id: value, label: humanize(value) }),
              ),
            ]}
            onChange={(furnishedStatus) => patch({ furnishedStatus })}
          />
        ) : null}
        <DateField
          label="Available by"
          value={draft.availableBy}
          onChange={(availableBy) => patch({ availableBy })}
          optional
        />
        {draft.listingPurpose === "RENT" ? (
          <>
            <Field
              label="Maximum rental deposit"
              value={draft.maxDeposit}
              onChangeText={(maxDeposit) => patch({ maxDeposit })}
              keyboardType="decimal-pad"
            />
            <SelectField
              label="Bills included"
              value={draft.billsIncluded}
              options={[
                { id: "", label: "Any" },
                { id: "YES", label: "Yes" },
                { id: "NO", label: "No" },
              ]}
              onChange={(billsIncluded) => patch({ billsIncluded })}
            />
            <Field
              label="Maximum minimum tenancy (months)"
              value={draft.maxTenancyMonths}
              onChangeText={(maxTenancyMonths) => patch({ maxTenancyMonths })}
              keyboardType="number-pad"
            />
          </>
        ) : (
          <>
            <Field
              label="Tenure"
              value={draft.tenure}
              onChangeText={(tenure) => patch({ tenure })}
              placeholder="Any tenure"
            />
            {type !== "LAND" ? (
              <SelectField
                label="Property condition"
                value={draft.conditionKey}
                options={[
                  { id: "", label: "Any" },
                  ...conditions.map((value) => ({
                    id: value,
                    label: humanize(value),
                  })),
                ]}
                onChange={(conditionKey) => patch({ conditionKey })}
              />
            ) : null}
          </>
        )}
      </View>
    </Sheet>
  );
}
function Heading({
  title,
  icon,
}: {
  title: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={20} color={theme.text} />
      <ThemedText type="smallBold">{title}</ThemedText>
    </View>
  );
}
function Rooms({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      {["", "1", "2", "3", "4"].map((entry) => (
        <Pressable
          key={entry}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${entry === "4" ? "4 or more" : entry || "Any"}`}
          accessibilityState={{ selected: value === entry }}
          onPress={() => onChange(entry)}
          style={[
            styles.room,
            {
              borderColor: value === entry ? theme.primary : theme.border,
              backgroundColor:
                value === entry ? theme.primarySurface : theme.background,
            },
          ]}
        >
          <ThemedText type="smallBold">
            {entry === "4" ? "4+" : entry || "Any"}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: Spacing.two },
  clear: { flex: 0.7 },
  grow: { flex: 1, minWidth: 0 },
  group: { gap: Spacing.two },
  row: { flexDirection: "row", gap: Spacing.two, alignItems: "center" },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  typeCard: {
    width: "31%",
    minHeight: 78,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.two,
    gap: Spacing.one,
  },
  typeName: { fontSize: 12, lineHeight: 18, textAlign: "center" },
  room: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
});
