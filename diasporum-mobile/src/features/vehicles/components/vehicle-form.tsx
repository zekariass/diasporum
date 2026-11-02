import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useSession } from "@/core/session/session-provider";
import { createBusinessApi } from "@/features/business/services/business-api";
import type { BusinessAccount } from "@/features/business/types/business-types";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { useCommunityNames } from "../hooks/use-community-names";
import { createVehicleApi } from "../services/vehicle-api";
import type {
  VehicleCatalogItem,
  VehicleCategory,
  VehiclePurpose,
  VehicleVisibility,
} from "../types/vehicle-types";
import { vehicleLabel } from "../utils/vehicle-format";
import {
  moveVehicleMedia,
  setVehicleCover,
  vehicleFieldVisible,
  type VehicleFormState,
} from "../utils/vehicle-form";

const MANAGER_ROLES = new Set(["OWNER", "ADMINISTRATOR", "EDITOR", "LISTING_MANAGER"]);
const FUEL = ["PETROL", "DIESEL", "ELECTRIC", "HYBRID", "PLUG_IN_HYBRID", "HYDROGEN", "OTHER", "UNKNOWN"];
const TRANSMISSION = ["MANUAL", "AUTOMATIC", "SEMI_AUTOMATIC", "OTHER", "UNKNOWN"];
const DRIVE = ["FWD", "RWD", "AWD", "FOUR_WD", "OTHER", "UNKNOWN"];
const BODY = ["HATCHBACK", "SALOON", "ESTATE", "SUV", "COUPE", "CONVERTIBLE", "MPV", "VAN", "PICKUP", "MOTORCYCLE", "MOTORHOME", "TRUCK", "OTHER", "UNKNOWN"];
const CONDITION = ["NEW", "EXCELLENT", "GOOD", "FAIR", "POOR", "UNSPECIFIED"];
const SERVICE_HISTORY = ["FULL", "PARTIAL", "NONE", "UNKNOWN"];

export function approximateCoordinate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function VehicleForm({
  state,
  onChange,
  editing = false,
}: {
  state: VehicleFormState;
  onChange: (patch: Partial<VehicleFormState>) => void;
  editing?: boolean;
}) {
  const theme = useTheme();
  const { apiClient, session } = useSession();
  const api = useMemo(() => createVehicleApi(apiClient), [apiClient]);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [makes, setMakes] = useState<VehicleCatalogItem[]>([]);
  const [models, setModels] = useState<VehicleCatalogItem[]>([]);
  const [variants, setVariants] = useState<VehicleCatalogItem[]>([]);
  const [features, setFeatures] = useState<VehicleCatalogItem[]>([]);
  const [accounts, setAccounts] = useState<BusinessAccount[]>([]);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const category = categories.find((item) => item.category.id === state.categoryId);
  const visible = (field: string) => vehicleFieldVisible(category, field);

  useEffect(() => {
    let active = true;
    Promise.all([api.categories(), api.makes(), api.features()])
      .then(([categoryPage, makePage, featurePage]) => {
        if (!active) return;
        setCategories(categoryPage.items);
        setMakes(makePage.items);
        setFeatures(featurePage.items);
        setCatalogueError(null);
      })
      .catch(() => active && setCatalogueError("The vehicle catalogue could not be loaded. Try again later."));
    createBusinessApi(apiClient).accounts()
      .then((result) => active && setAccounts(result.items.filter((account) =>
        account.status === "ACTIVE" && MANAGER_ROLES.has(account.role))))
      .catch(() => active && setAccounts([]));
    return () => { active = false; };
  }, [api, apiClient]);

  useEffect(() => {
    if (!state.makeId) {
      setModels([]);
      return;
    }
    let active = true;
    api.models(state.makeId)
      .then((result) => active && setModels(result.items))
      .catch(() => active && setModels([]));
    return () => { active = false; };
  }, [api, state.makeId]);

  useEffect(() => {
    if (!state.modelId) {
      setVariants([]);
      return;
    }
    let active = true;
    api.variants(state.modelId)
      .then((result) => active && setVariants(result.items))
      .catch(() => active && setVariants([]));
    return () => { active = false; };
  }, [api, state.modelId]);

  async function pickImages() {
    if (picking || state.media.length >= 5) return;
    setPicking(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: 5 - state.media.length,
        quality: 0.9,
      });
      if (result.canceled) return;
      const additions = result.assets.slice(0, 5 - state.media.length).map((asset, index) => ({
        id: `new-${Date.now()}-${index}`,
        uri: asset.uri,
        selection: {
          uri: asset.uri,
          mimeType: (asset.mimeType ?? "image/jpeg").toLowerCase(),
          fileName: asset.fileName ?? undefined,
        },
        cover: false,
      }));
      const media = [...state.media, ...additions];
      onChange({ media: media.some((item) => item.cover) || !media.length ? media : setVehicleCover(media, media[0].id) });
    } finally {
      setPicking(false);
    }
  }

  async function requestMyLocation() {
    if (locating) return;
    setLocating(true);
    setLocationError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setLocationError("Location permission was not granted. Enter a public general area instead.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      onChange({
        discoveryLatitude: approximateCoordinate(position.coords.latitude),
        discoveryLongitude: approximateCoordinate(position.coords.longitude),
      });
    } catch {
      setLocationError("Your location is unavailable. Enter a public general area instead.");
    } finally {
      setLocating(false);
    }
  }

  const memberships = session?.memberships.filter((membership) => membership.status === "ACTIVE") ?? [];
  const communityName = useCommunityNames();
  const allowedFeatures = category?.allowedFeatures.length
    ? features.filter((feature) => category.allowedFeatures.includes(feature.key))
    : features;

  return (
    <View style={styles.form}>
      <Section title="Ownership & audience">
        {!editing ? (
          <ChoiceRow
            values={[null, ...accounts.map((account) => account.id)] as (string | null)[]}
            current={state.businessAccountId}
            onSelect={(businessAccountId) => onChange({ businessAccountId })}
            renderLabel={(id) => id === null ? "Personal" : accounts.find((account) => account.id === id)?.accountName ?? "Business"}
          />
        ) : (
          <ThemedText style={styles.hint} themeColor="textSecondary">
            Ownership cannot be changed after creation.
          </ThemedText>
        )}
        <ChoiceRow
          values={["COMMUNITY", "COUNTRY", "SELECTED_COMMUNITIES"] as VehicleVisibility[]}
          current={state.visibilityScope}
          onSelect={(visibilityScope) => onChange({
            visibilityScope,
            communityId: visibilityScope === "COMMUNITY" ? state.communityId : "",
            selectedCommunityIds: visibilityScope === "SELECTED_COMMUNITIES" ? state.selectedCommunityIds : [],
          })}
          renderLabel={(value) => value === "SELECTED_COMMUNITIES" ? "Selected communities" : vehicleLabel(value)}
        />
        {state.visibilityScope === "COMMUNITY" ? (
          <ChoiceRow values={memberships.map((membership) => membership.communityId)}
            current={state.communityId} onSelect={(communityId) => onChange({ communityId })}
            renderLabel={communityName} />
        ) : null}
        {state.visibilityScope === "SELECTED_COMMUNITIES" ? (
          <View style={styles.wrap}>{memberships.map((membership) => {
            const id = membership.communityId;
            const selected = state.selectedCommunityIds.includes(id);
            return <SelectChip key={id} text={communityName(id)} active={selected} onPress={() => onChange({
              selectedCommunityIds: selected
                ? state.selectedCommunityIds.filter((item) => item !== id)
                : [...state.selectedCommunityIds, id],
            })} />;
          })}</View>
        ) : null}
        {memberships.length === 0 && state.visibilityScope !== "COUNTRY" ? (
          <ThemedText style={styles.error} accessibilityRole="alert">
            No accessible active community is available for this audience.
          </ThemedText>
        ) : null}
      </Section>

      <Section title="Vehicle">
        <ChoiceRow values={["SALE", "RENT"] as VehiclePurpose[]} current={state.listingPurpose}
          onSelect={(listingPurpose) => onChange({
            listingPurpose,
            pricePeriod: listingPurpose === "SALE" ? "TOTAL" : "DAY",
          })} renderLabel={(value) => value === "SALE" ? "For sale" : "For rent"} />
        <ChoiceRow values={categories.map((item) => item.category.id)} current={state.categoryId}
          onSelect={(categoryId) => onChange({ categoryId, additionalAttributes: {}, featureIds: [] })}
          renderLabel={(id) => categories.find((item) => item.category.id === id)?.category.displayName ?? "Category"} />
        {categories.length === 0 ? (
          <ThemedText style={styles.hint} themeColor="textSecondary">
            {catalogueError ?? "No active vehicle categories are configured yet. Listing creation is unavailable until catalogue data is supplied."}
          </ThemedText>
        ) : null}
        <Field label="Title" value={state.title} onChangeText={(title) => onChange({ title })} />
        <Field label="Description" value={state.description} multiline
          onChangeText={(description) => onChange({ description })} />
        <ChoiceRow values={makes.map((make) => make.id)} current={state.makeId}
          onSelect={(makeId) => onChange({ makeId: state.makeId === makeId ? "" : makeId, modelId: "", variantId: "" })}
          renderLabel={(id) => makes.find((make) => make.id === id)?.displayName ?? "Make"} />
        {state.makeId ? <ChoiceRow values={models.map((model) => model.id)} current={state.modelId}
          onSelect={(modelId) => onChange({ modelId: state.modelId === modelId ? "" : modelId, variantId: "" })}
          renderLabel={(id) => models.find((model) => model.id === id)?.displayName ?? "Model"} /> : null}
        {state.modelId && variants.length ? <ChoiceRow values={variants.map((variant) => variant.id)} current={state.variantId}
          onSelect={(variantId) => onChange({ variantId: state.variantId === variantId ? "" : variantId })}
          renderLabel={(id) => variants.find((variant) => variant.id === id)?.displayName ?? "Variant"} /> : null}
      </Section>

      <Section title="Specifications">
        {visible("modelYear") ? <Field label="Model year" value={state.modelYear} numeric onChangeText={(modelYear) => onChange({ modelYear })} /> : null}
        {visible("registrationYear") ? <Field label="Registration year" value={state.registrationYear} numeric onChangeText={(registrationYear) => onChange({ registrationYear })} /> : null}
        {visible("mileage") ? <Field label="Mileage" value={state.mileage} numeric onChangeText={(mileage) => onChange({ mileage })} /> : null}
        {visible("mileageUnit") ? <ChoiceRow values={["KM", "MILES"]} current={state.mileageUnit} onSelect={(mileageUnit) => onChange({ mileageUnit })} renderLabel={vehicleLabel} /> : null}
        {visible("fuelType") ? <ChoiceRow values={FUEL} current={state.fuelType} onSelect={(fuelType) => onChange({ fuelType })} renderLabel={vehicleLabel} /> : null}
        {visible("transmission") ? <ChoiceRow values={TRANSMISSION} current={state.transmission} onSelect={(transmission) => onChange({ transmission })} renderLabel={vehicleLabel} /> : null}
        {visible("driveType") ? <ChoiceRow values={DRIVE} current={state.driveType} onSelect={(driveType) => onChange({ driveType })} renderLabel={vehicleLabel} /> : null}
        {visible("bodyType") ? <ChoiceRow values={BODY} current={state.bodyType} onSelect={(bodyType) => onChange({ bodyType })} renderLabel={vehicleLabel} /> : null}
        {visible("engineSizeCc") ? <Field label="Engine size (cc)" value={state.engineSizeCc} numeric onChangeText={(engineSizeCc) => onChange({ engineSizeCc })} /> : null}
        {visible("colour") ? <Field label="Colour" value={state.colour} onChangeText={(colour) => onChange({ colour })} /> : null}
        {visible("doors") ? <Field label="Doors" value={state.doors} numeric onChangeText={(doors) => onChange({ doors })} /> : null}
        {visible("seats") ? <Field label="Seats" value={state.seats} numeric onChangeText={(seats) => onChange({ seats })} /> : null}
        {visible("condition") ? <ChoiceRow values={CONDITION} current={state.condition} onSelect={(condition) => onChange({ condition: state.condition === condition ? "" : condition })} renderLabel={vehicleLabel} /> : null}
        {visible("previousOwners") ? <Field label="Previous owners" value={state.previousOwners} numeric onChangeText={(previousOwners) => onChange({ previousOwners })} /> : null}
        {visible("motExpiry") ? <Field label="MOT expiry (YYYY-MM-DD)" value={state.motExpiry} onChangeText={(motExpiry) => onChange({ motExpiry })} /> : null}
        {visible("serviceHistory") ? <ChoiceRow values={SERVICE_HISTORY} current={state.serviceHistory} onSelect={(serviceHistory) => onChange({ serviceHistory: state.serviceHistory === serviceHistory ? "" : serviceHistory })} renderLabel={vehicleLabel} /> : null}
      </Section>

      {category && Object.keys(category.attributes).length ? (
        <Section title="Additional specifications">
          {Object.entries(category.attributes).map(([key, policy]) => {
            const value = state.additionalAttributes[key] ?? "";
            const update = (next: string) => onChange({
              additionalAttributes: { ...state.additionalAttributes, [key]: next },
            });
            if (policy.options.length || policy.type === "BOOLEAN") {
              const options = policy.type === "BOOLEAN" ? ["true", "false"] : policy.options;
              return <View key={key} style={styles.attribute}>
                <ThemedText style={styles.attributeLabel}>{key}{policy.required ? " *" : ""}</ThemedText>
                <ChoiceRow values={options} current={value} onSelect={update} renderLabel={vehicleLabel} />
              </View>;
            }
            return <Field key={key} label={`${key}${policy.required ? " *" : ""}`} value={value}
              numeric={["NUMBER", "INTEGER"].includes(policy.type)} onChangeText={update} />;
          })}
        </Section>
      ) : null}

      {allowedFeatures.length ? (
        <Section title="Features">
          <View style={styles.wrap}>{allowedFeatures.map((feature) => {
            const selected = state.featureIds.includes(feature.id);
            return <SelectChip key={feature.id} text={feature.displayName} active={selected} onPress={() => onChange({
              featureIds: selected ? state.featureIds.filter((id) => id !== feature.id) : [...state.featureIds, feature.id],
            })} />;
          })}</View>
        </Section>
      ) : null}

      <Section title="Pricing & expiry">
        <Field label={state.listingPurpose === "SALE" ? "Sale price" : "Rental price"} value={state.priceAmount} numeric
          onChangeText={(priceAmount) => onChange({ priceAmount })} />
        <Field label="Currency (three letters)" value={state.currencyCode} autoCapitalize="characters"
          onChangeText={(currencyCode) => onChange({ currencyCode })} />
        {state.listingPurpose === "RENT" ? (
          <>
            <ChoiceRow values={["DAY", "WEEK", "MONTH"]} current={state.pricePeriod}
              onSelect={(pricePeriod) => onChange({ pricePeriod: pricePeriod as "DAY" | "WEEK" | "MONTH" })} renderLabel={vehicleLabel} />
            <Field label="Rental deposit (optional)" value={state.rentalDeposit} numeric onChangeText={(rentalDeposit) => onChange({ rentalDeposit })} />
            <Field label="Mileage allowance (optional)" value={state.mileageAllowance} numeric onChangeText={(mileageAllowance) => onChange({ mileageAllowance })} />
            <Field label="Rental conditions (optional)" value={state.rentalConditions} multiline onChangeText={(rentalConditions) => onChange({ rentalConditions })} />
          </>
        ) : null}
        <Field label="Listing expiry (YYYY-MM-DD, optional)" value={state.expiresAt}
          onChangeText={(expiresAt) => onChange({ expiresAt })} />
      </Section>

      <Section title="Public general location">
        <Field label="City" value={state.city} onChangeText={(city) => onChange({ city })} />
        <Field label="Region" value={state.region} onChangeText={(region) => onChange({ region })} />
        <Field label="General area (no street or postal address)" value={state.formattedAddress}
          onChangeText={(formattedAddress) => onChange({ formattedAddress })} />
        <Pressable onPress={() => void requestMyLocation()} disabled={locating} accessibilityRole="button"
          accessibilityLabel="Use my location" style={[styles.locationButton, { borderColor: theme.border }]}>
          {locating ? <ActivityIndicator color={BrandColors.primary} /> : <Ionicons name="locate-outline" size={20} color={BrandColors.primary} />}
          <ThemedText style={styles.locationButtonText}>Use my location for approximate discovery</ThemedText>
        </Pressable>
        {state.discoveryLatitude !== null ? <ThemedText style={styles.hint} themeColor="textSecondary">
          Approximate discovery point added. It will not be shown as an exact public address.
        </ThemedText> : null}
        {locationError ? <ThemedText style={styles.error} accessibilityRole="alert">{locationError}</ThemedText> : null}
      </Section>

      <Section title={`Images (${state.media.length}/5)`}>
        <Pressable onPress={() => void pickImages()} disabled={picking || state.media.length >= 5}
          accessibilityRole="button" accessibilityLabel="Add vehicle images"
          style={[styles.upload, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
          {picking ? <ActivityIndicator color={BrandColors.primary} /> : <Ionicons name="images-outline" size={25} color={theme.text} />}
          <ThemedText style={styles.uploadText}>Add up to five images</ThemedText>
        </Pressable>
        {state.media.map((item, index) => (
          <View key={item.id} style={[styles.mediaRow, { borderColor: theme.border }]}>
            {item.uri ? <Image source={{ uri: item.uri }} style={styles.thumbnail} accessibilityLabel={`Vehicle image ${index + 1}`} /> : null}
            <View style={styles.mediaActions}>
              <SelectChip text={item.cover ? "Cover" : "Set as cover"} active={item.cover} onPress={() => onChange({ media: setVehicleCover(state.media, item.id) })} />
              <View style={styles.reorder}>
                <Pressable disabled={index === 0} onPress={() => onChange({ media: moveVehicleMedia(state.media, item.id, -1) })} accessibilityRole="button" accessibilityLabel={`Move image ${index + 1} up`}><Ionicons name="arrow-up" size={20} color={theme.text} /></Pressable>
                <Pressable disabled={index === state.media.length - 1} onPress={() => onChange({ media: moveVehicleMedia(state.media, item.id, 1) })} accessibilityRole="button" accessibilityLabel={`Move image ${index + 1} down`}><Ionicons name="arrow-down" size={20} color={theme.text} /></Pressable>
                <Pressable onPress={() => {
                  const media = state.media.filter((mediaItem) => mediaItem.id !== item.id);
                  onChange({ media: media.some((mediaItem) => mediaItem.cover) || !media.length ? media : setVehicleCover(media, media[0].id) });
                }} accessibilityRole="button" accessibilityLabel={`Remove image ${index + 1}`}><Ionicons name="trash-outline" size={20} color={BrandColors.error} /></Pressable>
              </View>
            </View>
          </View>
        ))}
      </Section>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return <View style={[styles.section, { borderColor: theme.border }]}>
    <ThemedText type="subtitle" style={styles.sectionTitle}>{title}</ThemedText>{children}
  </View>;
}

function Field({ label: placeholder, value, onChangeText, multiline = false, numeric = false, autoCapitalize = "sentences" }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  numeric?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  const theme = useTheme();
  return <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder}
    placeholderTextColor={theme.textSecondary} multiline={multiline}
    keyboardType={numeric ? "decimal-pad" : "default"} autoCapitalize={autoCapitalize}
    style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }, multiline && styles.multiline]} />;
}

function ChoiceRow<T>({ values, current, onSelect, renderLabel }: {
  values: T[];
  current: T | null;
  onSelect: (value: T) => void;
  renderLabel: (value: T) => string;
}) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
    <View style={styles.choiceRow}>{values.map((value, index) => <SelectChip key={`${String(value)}-${index}`}
      text={renderLabel(value)} active={current === value} onPress={() => onSelect(value)} />)}</View>
  </ScrollView>;
}

function SelectChip({ text, active, onPress }: { text: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}
    style={[styles.chip, { borderColor: active ? BrandColors.primary : theme.border,
      backgroundColor: active ? BrandColors.primary : theme.backgroundElement }]}>
    <ThemedText style={[styles.chipText, active && styles.selectedChip]}>{text}</ThemedText>
  </Pressable>;
}

const styles = StyleSheet.create({
  form: { padding: Spacing.four, gap: Spacing.three },
  section: { borderWidth: StyleSheet.hairlineWidth, borderRadius: BorderRadius.lg, padding: Spacing.three, gap: Spacing.three },
  sectionTitle: { fontSize: 16 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 14 },
  multiline: { minHeight: 110, textAlignVertical: "top" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  choiceRow: { flexDirection: "row", gap: Spacing.two, paddingRight: Spacing.three },
  chip: { borderWidth: 1, borderRadius: BorderRadius.full, paddingHorizontal: 11, paddingVertical: 7 },
  chipText: { fontSize: 12, fontWeight: "600" },
  selectedChip: { color: BrandColors.white },
  hint: { fontSize: 12, lineHeight: 18 },
  error: { color: BrandColors.error, fontSize: 13, lineHeight: 18 },
  attribute: { gap: Spacing.two },
  attributeLabel: { fontSize: 13, fontWeight: "600" },
  locationButton: { minHeight: 46, borderWidth: 1, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.two, padding: Spacing.two },
  locationButtonText: { flexShrink: 1, fontSize: 13, fontWeight: "600" },
  upload: { minHeight: 76, borderWidth: 1, borderStyle: "dashed", borderRadius: 12, alignItems: "center", justifyContent: "center", gap: Spacing.two },
  uploadText: { fontSize: 13, fontWeight: "600" },
  mediaRow: { borderWidth: 1, borderRadius: 12, padding: Spacing.two, flexDirection: "row", alignItems: "center", gap: Spacing.three },
  thumbnail: { width: 76, height: 76, borderRadius: 9 },
  mediaActions: { flex: 1, alignItems: "flex-start", gap: Spacing.three },
  reorder: { flexDirection: "row", gap: Spacing.four },
});
