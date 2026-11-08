import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useSession } from "@/core/session/session-provider";
import { createBusinessApi } from "@/features/business/services/business-api";
import { createDirectoryApi } from "@/features/business-directory/services/directory-api";
import type { BusinessAccount } from "@/features/business/types/business-types";
import type { Business } from "@/features/business-directory/types/directory-types";
import { useTheme } from "@/hooks/use-theme";
import { SelectField } from "@/shared/components/select-field";
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

const MANAGER_ROLES = new Set([
  "OWNER",
  "ADMINISTRATOR",
  "EDITOR",
  "LISTING_MANAGER",
]);
const FUEL = [
  "PETROL",
  "DIESEL",
  "ELECTRIC",
  "HYBRID",
  "PLUG_IN_HYBRID",
  "HYDROGEN",
  "OTHER",
  "UNKNOWN",
];
const TRANSMISSION = [
  "MANUAL",
  "AUTOMATIC",
  "SEMI_AUTOMATIC",
  "OTHER",
  "UNKNOWN",
];
const DRIVE = ["FWD", "RWD", "AWD", "FOUR_WD", "OTHER", "UNKNOWN"];
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
  "UNKNOWN",
];
const CONDITION = ["NEW", "EXCELLENT", "GOOD", "FAIR", "POOR", "UNSPECIFIED"];
const SERVICE_HISTORY = ["FULL", "PARTIAL", "NONE", "UNKNOWN"];

const STEP_CONTENT = [
  {
    title: "Tell us about your vehicle",
    hint: "Start with the essentials. You can refine the details next.",
    icon: "car-sport-outline",
  },
  {
    title: "Add the useful details",
    hint: "Help buyers understand the specification, condition and features.",
    icon: "options-outline",
  },
  {
    title: "Set your price",
    hint: "Choose a clear price and, for rentals, your rental terms.",
    icon: "pricetag-outline",
  },
  {
    title: "Choose your audience",
    hint: "List personally or as a business, then decide how people can contact you.",
    icon: "people-outline",
  },
  {
    title: "Location & photos",
    hint: "Add a public general area and photos that show your vehicle clearly.",
    icon: "images-outline",
  },
  {
    title: "Review your listing",
    hint: "Check everything looks right before you publish.",
    icon: "checkmark-circle-outline",
  },
] as const;

export function approximateCoordinate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function VehicleForm({
  state,
  onChange,
  editing = false,
  step = 0,
}: {
  state: VehicleFormState;
  onChange: (patch: Partial<VehicleFormState>) => void;
  editing?: boolean;
  step?: number;
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
  const [profiles, setProfiles] = useState<Business[]>([]);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const category = categories.find(
    (item) => item.category.id === state.categoryId,
  );
  const visible = (field: string) => vehicleFieldVisible(category, field);
  const currentStep = STEP_CONTENT[step] ?? STEP_CONTENT[0];

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
      .catch(
        () =>
          active &&
          setCatalogueError(
            "The vehicle catalogue could not be loaded. Try again later.",
          ),
      );
    createBusinessApi(apiClient)
      .accounts()
      .then(
        (result) =>
          active &&
          setAccounts(
            result.items.filter(
              (account) =>
                account.status === "ACTIVE" && MANAGER_ROLES.has(account.role),
            ),
          ),
      )
      .catch(() => active && setAccounts([]));
    return () => {
      active = false;
    };
  }, [api, apiClient]);

  useEffect(() => {
    let active = true;
    const request = state.businessAccountId
      ? createDirectoryApi(apiClient).managed(state.businessAccountId)
      : Promise.resolve({ items: [] });
    request
      .then((result) => active && setProfiles(result.items))
      .catch(() => active && setProfiles([]));
    return () => {
      active = false;
    };
  }, [apiClient, state.businessAccountId]);

  useEffect(() => {
    let active = true;
    const request = state.makeId
      ? api.models(state.makeId)
      : Promise.resolve({ items: [] });
    request
      .then((result) => active && setModels(result.items))
      .catch(() => active && setModels([]));
    return () => {
      active = false;
    };
  }, [api, state.makeId]);

  useEffect(() => {
    let active = true;
    const request = state.modelId
      ? api.variants(state.modelId)
      : Promise.resolve({ items: [] });
    request
      .then((result) => active && setVariants(result.items))
      .catch(() => active && setVariants([]));
    return () => {
      active = false;
    };
  }, [api, state.modelId]);

  async function pickImages() {
    if (picking || state.media.length >= 5) return;
    setPicking(true);
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: 5 - state.media.length,
        quality: 0.9,
      });
      if (result.canceled) return;
      const additions = result.assets
        .slice(0, 5 - state.media.length)
        .map((asset, index) => ({
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
      onChange({
        media:
          media.some((item) => item.cover) || !media.length
            ? media
            : setVehicleCover(media, media[0].id),
      });
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
        setLocationError(
          "Location permission was not granted. Enter a public general area instead.",
        );
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      onChange({
        discoveryLatitude: approximateCoordinate(position.coords.latitude),
        discoveryLongitude: approximateCoordinate(position.coords.longitude),
      });
    } catch {
      setLocationError(
        "Your location is unavailable. Enter a public general area instead.",
      );
    } finally {
      setLocating(false);
    }
  }

  const memberships =
    session?.memberships.filter(
      (membership) => membership.status === "ACTIVE",
    ) ?? [];
  const communityName = useCommunityNames();
  const allowedFeatures = category?.allowedFeatures.length
    ? features.filter((feature) =>
        category.allowedFeatures.includes(feature.key),
      )
    : features;
  const catalogueOptions = (items: VehicleCatalogItem[]) => [
    { id: "", label: "Not specified" },
    ...items.map((item) => ({ id: item.id, label: item.displayName })),
  ];
  const valueOptions = (values: string[]) =>
    values.map((value) => ({ id: value, label: vehicleLabel(value) }));

  return (
    <ScrollView
      key={step}
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <View style={styles.stepIntro}>
        <View
          style={[styles.stepIcon, { backgroundColor: theme.primarySurface }]}
        >
          <Ionicons name={currentStep.icon} size={25} color={theme.primary} />
        </View>
        <View style={styles.stepHeading}>
          <ThemedText style={styles.stepTitle}>{currentStep.title}</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.stepHint}>
            {currentStep.hint}
          </ThemedText>
        </View>
      </View>

      {step === 0 ? (
        <>
          <Section
            title="Listing setup"
            description="What are you advertising?"
            icon="swap-horizontal-outline"
          >
            <ChoiceRow
              values={["SALE", "RENT"] as VehiclePurpose[]}
              current={state.listingPurpose}
              onSelect={(listingPurpose) =>
                onChange({
                  listingPurpose,
                  pricePeriod: listingPurpose === "SALE" ? "TOTAL" : "DAY",
                })
              }
              renderLabel={(value) =>
                value === "SALE" ? "For sale" : "For rent"
              }
            />
            <View style={styles.fieldGroup}>
              <ThemedText style={styles.groupLabel}>
                Vehicle category
              </ThemedText>
              <ChoiceRow
                values={categories.map((item) => item.category.id)}
                current={state.categoryId}
                onSelect={(categoryId) =>
                  onChange({
                    categoryId,
                    additionalAttributes: {},
                    featureIds: [],
                  })
                }
                renderLabel={(id) =>
                  categories.find((item) => item.category.id === id)?.category
                    .displayName ?? "Category"
                }
              />
            </View>
            {categories.length === 0 ? (
              <View
                style={[
                  styles.inlineNotice,
                  { backgroundColor: theme.backgroundElement },
                ]}
              >
                <Ionicons
                  name="information-circle-outline"
                  size={18}
                  color={theme.textSecondary}
                />
                <ThemedText style={styles.hint} themeColor="textSecondary">
                  {catalogueError ??
                    "No active vehicle categories are configured yet. Listing creation is unavailable until catalogue data is supplied."}
                </ThemedText>
              </View>
            ) : null}
          </Section>
          <Section
            title="Create a strong listing"
            description="A specific title and honest description attract better enquiries."
            icon="create-outline"
          >
            <Field
              label="Title"
              value={state.title}
              placeholder="e.g. 2022 Volvo XC60 AWD"
              icon="car-outline"
              onChangeText={(title) => onChange({ title })}
            />
            <Field
              label="Description"
              value={state.description}
              multiline
              icon="document-text-outline"
              placeholder="Describe the condition, history and anything a buyer should know."
              hint="Include the details you would want to know before making an enquiry."
              onChangeText={(description) => onChange({ description })}
            />
          </Section>
          <Section
            title="Make & model"
            description="Optional, but it helps people find the right vehicle."
            icon="search-outline"
          >
            <SelectField
              label="Make"
              value={state.makeId}
              options={catalogueOptions(makes)}
              leadingIcon="bookmark-outline"
              placeholder="Select a make"
              onChange={(makeId) =>
                onChange({ makeId, modelId: "", variantId: "" })
              }
            />
            {state.makeId ? (
              <SelectField
                label="Model"
                value={state.modelId}
                options={catalogueOptions(models)}
                placeholder="Select a model"
                onChange={(modelId) => onChange({ modelId, variantId: "" })}
              />
            ) : null}
            {state.modelId && variants.length ? (
              <SelectField
                label="Variant"
                value={state.variantId}
                options={catalogueOptions(variants)}
                placeholder="Select a variant"
                onChange={(variantId) => onChange({ variantId })}
              />
            ) : null}
          </Section>
        </>
      ) : null}

      {step === 1 ? (
        <>
          <Section
            title="Key specifications"
            description="Share the numbers buyers usually ask for first."
            icon="speedometer-outline"
          >
            <View style={styles.grid}>
              {visible("modelYear") ? (
                <View style={styles.gridItem}>
                  <Field
                    label="Model year"
                    value={state.modelYear}
                    numeric
                    placeholder="2022"
                    onChangeText={(modelYear) => onChange({ modelYear })}
                  />
                </View>
              ) : null}
              {visible("registrationYear") ? (
                <View style={styles.gridItem}>
                  <Field
                    label="Registration year"
                    value={state.registrationYear}
                    numeric
                    placeholder="2022"
                    onChangeText={(registrationYear) =>
                      onChange({ registrationYear })
                    }
                  />
                </View>
              ) : null}
            </View>
            {visible("mileage") ? (
              <Field
                label="Mileage"
                value={state.mileage}
                numeric
                placeholder="e.g. 32000"
                icon="speedometer-outline"
                onChangeText={(mileage) => onChange({ mileage })}
              />
            ) : null}
            {visible("mileageUnit") ? (
              <ChoiceRow
                label="Mileage unit"
                values={["KM", "MILES"]}
                current={state.mileageUnit}
                onSelect={(mileageUnit) => onChange({ mileageUnit })}
                renderLabel={vehicleLabel}
              />
            ) : null}
            {visible("fuelType") ? (
              <SelectField
                label="Fuel type"
                value={state.fuelType}
                options={valueOptions(FUEL)}
                leadingIcon="flash-outline"
                onChange={(fuelType) => onChange({ fuelType })}
              />
            ) : null}
            {visible("transmission") ? (
              <SelectField
                label="Transmission"
                value={state.transmission}
                options={valueOptions(TRANSMISSION)}
                leadingIcon="git-branch-outline"
                onChange={(transmission) => onChange({ transmission })}
              />
            ) : null}
            {visible("driveType") ? (
              <SelectField
                label="Drive type"
                value={state.driveType}
                options={valueOptions(DRIVE)}
                onChange={(driveType) => onChange({ driveType })}
              />
            ) : null}
            {visible("bodyType") ? (
              <SelectField
                label="Body type"
                value={state.bodyType}
                options={valueOptions(BODY)}
                leadingIcon="car-sport-outline"
                onChange={(bodyType) => onChange({ bodyType })}
              />
            ) : null}
          </Section>
          <Section
            title="Condition & history"
            description="Optional details that make your listing more informative."
            icon="clipboard-outline"
          >
            <View style={styles.grid}>
              {visible("engineSizeCc") ? (
                <View style={styles.gridItem}>
                  <Field
                    label="Engine size (cc)"
                    value={state.engineSizeCc}
                    numeric
                    onChangeText={(engineSizeCc) => onChange({ engineSizeCc })}
                  />
                </View>
              ) : null}
              {visible("colour") ? (
                <View style={styles.gridItem}>
                  <Field
                    label="Colour"
                    value={state.colour}
                    onChangeText={(colour) => onChange({ colour })}
                  />
                </View>
              ) : null}
              {visible("doors") ? (
                <View style={styles.gridItem}>
                  <Field
                    label="Doors"
                    value={state.doors}
                    numeric
                    onChangeText={(doors) => onChange({ doors })}
                  />
                </View>
              ) : null}
              {visible("seats") ? (
                <View style={styles.gridItem}>
                  <Field
                    label="Seats"
                    value={state.seats}
                    numeric
                    onChangeText={(seats) => onChange({ seats })}
                  />
                </View>
              ) : null}
              {visible("previousOwners") ? (
                <View style={styles.gridItem}>
                  <Field
                    label="Previous owners"
                    value={state.previousOwners}
                    numeric
                    onChangeText={(previousOwners) =>
                      onChange({ previousOwners })
                    }
                  />
                </View>
              ) : null}
              {visible("motExpiry") ? (
                <View style={styles.gridItem}>
                  <Field
                    label="MOT expiry"
                    placeholder="YYYY-MM-DD"
                    value={state.motExpiry}
                    onChangeText={(motExpiry) => onChange({ motExpiry })}
                  />
                </View>
              ) : null}
            </View>
            {visible("condition") ? (
              <SelectField
                label="Condition"
                value={state.condition}
                options={[
                  { id: "", label: "Not specified" },
                  ...valueOptions(CONDITION),
                ]}
                onChange={(condition) => onChange({ condition })}
              />
            ) : null}
            {visible("serviceHistory") ? (
              <SelectField
                label="Service history"
                value={state.serviceHistory}
                options={[
                  { id: "", label: "Not specified" },
                  ...valueOptions(SERVICE_HISTORY),
                ]}
                onChange={(serviceHistory) => onChange({ serviceHistory })}
              />
            ) : null}
          </Section>
          {category && Object.keys(category.attributes).length ? (
            <Section
              title="More specifications"
              description="Details specific to this vehicle category."
              icon="list-outline"
            >
              {Object.entries(category.attributes).map(([key, policy]) => {
                const value = state.additionalAttributes[key] ?? "";
                const update = (next: string) =>
                  onChange({
                    additionalAttributes: {
                      ...state.additionalAttributes,
                      [key]: next,
                    },
                  });
                if (policy.options.length || policy.type === "BOOLEAN") {
                  const options =
                    policy.type === "BOOLEAN"
                      ? ["true", "false"]
                      : policy.options;
                  return (
                    <SelectField
                      key={key}
                      label={`${key}${policy.required ? " *" : ""}`}
                      value={value}
                      options={[
                        { id: "", label: "Not specified" },
                        ...valueOptions(options),
                      ]}
                      onChange={update}
                    />
                  );
                }
                return (
                  <Field
                    key={key}
                    label={`${key}${policy.required ? " *" : ""}`}
                    value={value}
                    numeric={["NUMBER", "INTEGER"].includes(policy.type)}
                    onChangeText={update}
                  />
                );
              })}
            </Section>
          ) : null}
          {allowedFeatures.length ? (
            <Section
              title="Features"
              description="Select everything included with the vehicle."
              icon="sparkles-outline"
            >
              <View style={styles.wrap}>
                {allowedFeatures.map((feature) => {
                  const selected = state.featureIds.includes(feature.id);
                  return (
                    <SelectChip
                      key={feature.id}
                      text={feature.displayName}
                      active={selected}
                      onPress={() =>
                        onChange({
                          featureIds: selected
                            ? state.featureIds.filter((id) => id !== feature.id)
                            : [...state.featureIds, feature.id],
                        })
                      }
                    />
                  );
                })}
              </View>
            </Section>
          ) : null}
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Section
            title={
              state.listingPurpose === "SALE" ? "Asking price" : "Rental price"
            }
            description="Use a clear price so buyers know what to expect."
            icon="cash-outline"
          >
            <View style={styles.grid}>
              <View style={styles.priceField}>
                <Field
                  label={
                    state.listingPurpose === "SALE"
                      ? "Sale price"
                      : "Rental price"
                  }
                  value={state.priceAmount}
                  numeric
                  placeholder="0.00"
                  icon="wallet-outline"
                  onChangeText={(priceAmount) => onChange({ priceAmount })}
                />
              </View>
              <View style={styles.currencyField}>
                <Field
                  label="Currency"
                  value={state.currencyCode}
                  autoCapitalize="characters"
                  placeholder="EUR"
                  onChangeText={(currencyCode) => onChange({ currencyCode })}
                />
              </View>
            </View>
            {state.listingPurpose === "RENT" ? (
              <>
                <ChoiceRow
                  label="Charge per"
                  values={["DAY", "WEEK", "MONTH"]}
                  current={state.pricePeriod}
                  onSelect={(pricePeriod) =>
                    onChange({
                      pricePeriod: pricePeriod as "DAY" | "WEEK" | "MONTH",
                    })
                  }
                  renderLabel={vehicleLabel}
                />
                <Field
                  label="Rental deposit (optional)"
                  value={state.rentalDeposit}
                  numeric
                  onChangeText={(rentalDeposit) => onChange({ rentalDeposit })}
                />
                <Field
                  label="Mileage allowance (optional)"
                  value={state.mileageAllowance}
                  numeric
                  onChangeText={(mileageAllowance) =>
                    onChange({ mileageAllowance })
                  }
                />
                <Field
                  label="Rental conditions (optional)"
                  value={state.rentalConditions}
                  multiline
                  onChangeText={(rentalConditions) =>
                    onChange({ rentalConditions })
                  }
                />
              </>
            ) : null}
          </Section>
          <Section
            title="Listing duration"
            description="Optionally choose when this listing should expire."
            icon="calendar-outline"
          >
            <Field
              label="Listing expiry (optional)"
              placeholder="YYYY-MM-DD"
              value={state.expiresAt}
              icon="calendar-outline"
              hint="Leave blank to keep the listing active without an expiry date."
              onChangeText={(expiresAt) => onChange({ expiresAt })}
            />
          </Section>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <Section
            title="List as"
            description="Advertise personally or through a business account you manage."
            icon="person-circle-outline"
          >
            {!editing ? (
              <ChoiceRow
                values={
                  [null, ...accounts.map((account) => account.id)] as (
                    | string
                    | null
                  )[]
                }
                current={state.businessAccountId}
                onSelect={(businessAccountId) =>
                  onChange({ businessAccountId, businessListingId: null })
                }
                renderLabel={(id) =>
                  id === null
                    ? "Personal"
                    : (accounts.find((account) => account.id === id)
                        ?.accountName ?? "Business")
                }
              />
            ) : (
              <ThemedText style={styles.hint} themeColor="textSecondary">
                Ownership cannot be changed after creation.
              </ThemedText>
            )}
            {state.businessAccountId ? (
              <>
                <ChoiceRow
                  label="Public business profile"
                  values={
                    [null, ...profiles.map((profile) => profile.id)] as (
                      | string
                      | null
                    )[]
                  }
                  current={state.businessListingId}
                  onSelect={(businessListingId) =>
                    onChange({ businessListingId })
                  }
                  renderLabel={(id) =>
                    id === null
                      ? "No public profile"
                      : (profiles.find((profile) => profile.id === id)?.name ??
                        "Business Profile")
                  }
                />
                <ThemedText style={styles.hint} themeColor="textSecondary">
                  The profile is the public business identity shown on your
                  listing.
                </ThemedText>
              </>
            ) : null}
          </Section>
          <Section
            title="Who can see this listing?"
            description="Choose the audience that best fits your vehicle."
            icon="globe-outline"
          >
            <ChoiceRow
              values={
                [
                  "COMMUNITY",
                  "COUNTRY",
                  "SELECTED_COMMUNITIES",
                ] as VehicleVisibility[]
              }
              current={state.visibilityScope}
              onSelect={(visibilityScope) =>
                onChange({
                  visibilityScope,
                  communityId:
                    visibilityScope === "COMMUNITY" ? state.communityId : "",
                  selectedCommunityIds:
                    visibilityScope === "SELECTED_COMMUNITIES"
                      ? state.selectedCommunityIds
                      : [],
                })
              }
              renderLabel={(value) =>
                value === "SELECTED_COMMUNITIES"
                  ? "Selected communities"
                  : vehicleLabel(value)
              }
            />
            {state.visibilityScope === "COMMUNITY" ? (
              <ChoiceRow
                label="Community"
                values={memberships.map((membership) => membership.communityId)}
                current={state.communityId}
                onSelect={(communityId) => onChange({ communityId })}
                renderLabel={communityName}
              />
            ) : null}
            {state.visibilityScope === "SELECTED_COMMUNITIES" ? (
              <View style={styles.wrap}>
                {memberships.map((membership) => {
                  const id = membership.communityId;
                  const selected = state.selectedCommunityIds.includes(id);
                  return (
                    <SelectChip
                      key={id}
                      text={communityName(id)}
                      active={selected}
                      onPress={() =>
                        onChange({
                          selectedCommunityIds: selected
                            ? state.selectedCommunityIds.filter(
                                (item) => item !== id,
                              )
                            : [...state.selectedCommunityIds, id],
                        })
                      }
                    />
                  );
                })}
              </View>
            ) : null}
            {memberships.length === 0 && state.visibilityScope !== "COUNTRY" ? (
              <ThemedText style={styles.error} accessibilityRole="alert">
                No accessible active community is available for this audience.
              </ThemedText>
            ) : null}
          </Section>
          <Section
            title="Contact preferences"
            description="In-app messaging is always available. Other channels are optional."
            icon="chatbubbles-outline"
          >
            <Field
              label="Phone"
              value={state.contactPhone}
              keyboardType="phone-pad"
              icon="call-outline"
              onChangeText={(contactPhone) => onChange({ contactPhone })}
            />
            {state.contactPhone.trim() ? (
              <SelectChip
                text={
                  state.contactShowPhone
                    ? "Phone visible to viewers"
                    : "Show phone to viewers"
                }
                active={state.contactShowPhone}
                onPress={() =>
                  onChange({ contactShowPhone: !state.contactShowPhone })
                }
              />
            ) : null}
            <Field
              label="WhatsApp"
              value={state.contactWhatsapp}
              keyboardType="phone-pad"
              icon="logo-whatsapp"
              onChangeText={(contactWhatsapp) => onChange({ contactWhatsapp })}
            />
            {state.contactWhatsapp.trim() ? (
              <SelectChip
                text={
                  state.contactShowWhatsapp
                    ? "WhatsApp visible to viewers"
                    : "Show WhatsApp to viewers"
                }
                active={state.contactShowWhatsapp}
                onPress={() =>
                  onChange({ contactShowWhatsapp: !state.contactShowWhatsapp })
                }
              />
            ) : null}
            <Field
              label="Email"
              value={state.contactEmail}
              keyboardType="email-address"
              icon="mail-outline"
              autoCapitalize="none"
              onChangeText={(contactEmail) => onChange({ contactEmail })}
            />
            {state.contactEmail.trim() ? (
              <SelectChip
                text={
                  state.contactShowEmail
                    ? "Email visible to viewers"
                    : "Show email to viewers"
                }
                active={state.contactShowEmail}
                onPress={() =>
                  onChange({ contactShowEmail: !state.contactShowEmail })
                }
              />
            ) : null}
            <ChoiceRow
              label="Preferred contact method"
              values={["MESSAGING", "PHONE", "WHATSAPP", "EMAIL"]}
              current={state.contactPreferredMethod}
              onSelect={(contactPreferredMethod) =>
                onChange({ contactPreferredMethod })
              }
              renderLabel={(value) =>
                value === "MESSAGING"
                  ? "In-app messaging"
                  : vehicleLabel(value.toLowerCase())
              }
            />
          </Section>
        </>
      ) : null}

      {step === 4 ? (
        <>
          <Section
            title="Public general location"
            description="Only share a general area — never a street or postal address."
            icon="location-outline"
          >
            <View style={styles.grid}>
              <View style={styles.gridItem}>
                <Field
                  label="City"
                  value={state.city}
                  onChangeText={(city) => onChange({ city })}
                />
              </View>
              <View style={styles.gridItem}>
                <Field
                  label="Region"
                  value={state.region}
                  onChangeText={(region) => onChange({ region })}
                />
              </View>
            </View>
            <Field
              label="General area"
              placeholder="e.g. Frankfurt, Hesse"
              value={state.formattedAddress}
              hint="This public description should not contain your exact address."
              onChangeText={(formattedAddress) =>
                onChange({ formattedAddress })
              }
            />
            <Pressable
              onPress={() => void requestMyLocation()}
              disabled={locating}
              accessibilityRole="button"
              accessibilityLabel="Use my location"
              style={[
                styles.locationButton,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.backgroundElement,
                },
              ]}
            >
              {locating ? (
                <ActivityIndicator color={theme.primary} />
              ) : (
                <Ionicons
                  name="locate-outline"
                  size={20}
                  color={theme.primary}
                />
              )}
              <ThemedText style={styles.locationButtonText}>
                Use my approximate location
              </ThemedText>
            </Pressable>
            {state.discoveryLatitude !== null ? (
              <View style={styles.successRow}>
                <Ionicons
                  name="checkmark-circle"
                  size={17}
                  color={theme.success}
                />
                <ThemedText style={styles.hint} themeColor="textSecondary">
                  Approximate discovery point added. Your exact position stays
                  private.
                </ThemedText>
              </View>
            ) : null}
            {locationError ? (
              <ThemedText style={styles.error} accessibilityRole="alert">
                {locationError}
              </ThemedText>
            ) : null}
          </Section>
          <Section
            title={`Vehicle photos · ${state.media.length}/5`}
            description="Use bright, clear photos. The first or selected cover appears in search results."
            icon="camera-outline"
          >
            {state.media.length < 5 ? (
              <Pressable
                onPress={() => void pickImages()}
                disabled={picking}
                accessibilityRole="button"
                accessibilityLabel="Add vehicle images"
                style={[
                  styles.upload,
                  {
                    borderColor: theme.primary,
                    backgroundColor: theme.primarySurface,
                  },
                ]}
              >
                {picking ? (
                  <ActivityIndicator color={theme.primary} />
                ) : (
                  <View
                    style={[
                      styles.uploadIcon,
                      { backgroundColor: theme.background },
                    ]}
                  >
                    <Ionicons name="add" size={25} color={theme.primary} />
                  </View>
                )}
                <ThemedText
                  style={[styles.uploadText, { color: theme.primary }]}
                >
                  {state.media.length
                    ? "Add more photos"
                    : "Add vehicle photos"}
                </ThemedText>
                <ThemedText themeColor="textSecondary" style={styles.hint}>
                  Choose up to {5 - state.media.length} more
                </ThemedText>
              </Pressable>
            ) : null}
            <View style={styles.mediaGrid}>
              {state.media.map((item, index) => (
                <View
                  key={item.id}
                  style={[
                    styles.mediaCard,
                    {
                      borderColor: theme.border,
                      backgroundColor: theme.backgroundElement,
                    },
                  ]}
                >
                  <View>
                    {item.uri ? (
                      <Image
                        source={{ uri: item.uri }}
                        style={styles.thumbnail}
                        accessibilityLabel={`Vehicle image ${index + 1}`}
                      />
                    ) : null}
                    {item.cover ? (
                      <View style={styles.coverBadge}>
                        <ThemedText style={styles.coverText}>Cover</ThemedText>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.mediaActions}>
                    {!item.cover ? (
                      <Pressable
                        onPress={() =>
                          onChange({
                            media: setVehicleCover(state.media, item.id),
                          })
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Set image ${index + 1} as cover`}
                      >
                        <ThemedText
                          style={[
                            styles.mediaActionText,
                            { color: theme.primary },
                          ]}
                        >
                          Set cover
                        </ThemedText>
                      </Pressable>
                    ) : (
                      <View style={styles.coverSpacer} />
                    )}
                    <View style={styles.reorder}>
                      <Pressable
                        disabled={index === 0}
                        onPress={() =>
                          onChange({
                            media: moveVehicleMedia(state.media, item.id, -1),
                          })
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Move image ${index + 1} up`}
                        hitSlop={6}
                      >
                        <Ionicons
                          name="arrow-back"
                          size={18}
                          color={index === 0 ? theme.textMuted : theme.text}
                        />
                      </Pressable>
                      <Pressable
                        disabled={index === state.media.length - 1}
                        onPress={() =>
                          onChange({
                            media: moveVehicleMedia(state.media, item.id, 1),
                          })
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Move image ${index + 1} down`}
                        hitSlop={6}
                      >
                        <Ionicons
                          name="arrow-forward"
                          size={18}
                          color={
                            index === state.media.length - 1
                              ? theme.textMuted
                              : theme.text
                          }
                        />
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          const media = state.media.filter(
                            (mediaItem) => mediaItem.id !== item.id,
                          );
                          onChange({
                            media:
                              media.some((mediaItem) => mediaItem.cover) ||
                              !media.length
                                ? media
                                : setVehicleCover(media, media[0].id),
                          });
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove image ${index + 1}`}
                        hitSlop={6}
                      >
                        <Ionicons
                          name="trash-outline"
                          size={18}
                          color={theme.error}
                        />
                      </Pressable>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </Section>
        </>
      ) : null}

      {step === 5 ? (
        <VehiclePreview
          form={state}
          categoryName={category?.category.displayName ?? null}
        />
      ) : null}
    </ScrollView>
  );
}

function Section({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.section,
        { borderColor: theme.border, backgroundColor: theme.background },
      ]}
    >
      <View style={styles.sectionHeader}>
        <View
          style={[
            styles.sectionIcon,
            { backgroundColor: theme.primarySurface },
          ]}
        >
          <Ionicons name={icon} size={18} color={theme.primary} />
        </View>
        <View style={styles.sectionHeading}>
          <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
          {description ? (
            <ThemedText
              themeColor="textSecondary"
              style={styles.sectionDescription}
            >
              {description}
            </ThemedText>
          ) : null}
        </View>
      </View>
      {children}
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  numeric = false,
  autoCapitalize = "sentences",
  keyboardType,
  icon,
  hint,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  numeric?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: KeyboardTypeOptions;
  icon?: keyof typeof Ionicons.glyphMap;
  hint?: string;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <ThemedText style={styles.label}>{label}</ThemedText>
      <View
        style={[
          styles.inputShell,
          {
            borderColor: focused ? theme.primary : theme.border,
            backgroundColor: focused
              ? theme.background
              : theme.backgroundElement,
          },
          multiline && styles.multilineShell,
        ]}
      >
        {icon ? (
          <Ionicons
            name={icon}
            size={18}
            color={focused ? theme.primary : theme.textSecondary}
            style={multiline ? styles.multilineIcon : undefined}
          />
        ) : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder ?? label}
          placeholderTextColor={theme.textSecondary}
          selectionColor={theme.primary}
          multiline={multiline}
          keyboardType={keyboardType ?? (numeric ? "decimal-pad" : "default")}
          autoCapitalize={autoCapitalize}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={label}
          style={[
            styles.input,
            { color: theme.text },
            icon && styles.inputWithIcon,
            multiline && styles.multiline,
          ]}
        />
      </View>
      {hint ? (
        <ThemedText themeColor="textSecondary" style={styles.fieldHint}>
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

function ChoiceRow<T>({
  values,
  current,
  onSelect,
  renderLabel,
  label,
}: {
  values: T[];
  current: T | null;
  onSelect: (value: T) => void;
  renderLabel: (value: T) => string;
  label?: string;
}) {
  return (
    <View style={styles.fieldGroup}>
      {label ? (
        <ThemedText style={styles.groupLabel}>{label}</ThemedText>
      ) : null}
      <View style={styles.wrap}>
        {values.map((value, index) => (
          <SelectChip
            key={`${String(value)}-${index}`}
            text={renderLabel(value)}
            active={current === value}
            onPress={() => onSelect(value)}
          />
        ))}
      </View>
    </View>
  );
}

function SelectChip({
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
      accessibilityLabel={text}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: active ? theme.primary : theme.border,
          backgroundColor: active
            ? theme.primarySurface
            : theme.backgroundElement,
        },
        pressed && { opacity: 0.75 },
      ]}
    >
      {active ? (
        <Ionicons name="checkmark-circle" size={16} color={theme.primary} />
      ) : null}
      <ThemedText style={[styles.chipText, active && { color: theme.primary }]}>
        {text}
      </ThemedText>
    </Pressable>
  );
}

function VehiclePreview({
  form,
  categoryName,
}: {
  form: VehicleFormState;
  categoryName: string | null;
}) {
  const theme = useTheme();
  const cover = form.media.find((item) => item.cover) ?? form.media[0];
  const price = form.priceAmount.trim()
    ? `${form.currencyCode.toUpperCase()} ${form.priceAmount.trim()}${form.listingPurpose === "RENT" ? ` / ${vehicleLabel(form.pricePeriod).toLowerCase()}` : ""}`
    : "Price not set";
  const location = [form.city, form.region, form.formattedAddress]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(", ");
  const rows = [
    ["Purpose", form.listingPurpose === "SALE" ? "For sale" : "For rent"],
    ["Category", categoryName ?? ""],
    ["Model year", form.modelYear],
    ["Registration year", form.registrationYear],
    [
      "Mileage",
      form.mileage
        ? `${form.mileage} ${form.mileageUnit === "KM" ? "km" : "miles"}`
        : "",
    ],
    ["Fuel", vehicleLabel(form.fuelType)],
    ["Transmission", vehicleLabel(form.transmission)],
    ["Drive", vehicleLabel(form.driveType)],
    ["Body", vehicleLabel(form.bodyType)],
    ["Condition", form.condition ? vehicleLabel(form.condition) : ""],
    ["Visibility", vehicleLabel(form.visibilityScope)],
  ].filter(
    ([, value]) => value && value !== "Not specified" && value !== "Unknown",
  );
  return (
    <View style={styles.preview}>
      <View
        style={[styles.readyCard, { backgroundColor: theme.primarySurface }]}
      >
        <Ionicons name="checkmark-circle" size={23} color={theme.primary} />
        <View style={styles.readyText}>
          <ThemedText style={[styles.readyTitle, { color: theme.primary }]}>
            Ready for a final check
          </ThemedText>
          <ThemedText style={styles.hint}>
            Your listing will not be published until you confirm below.
          </ThemedText>
        </View>
      </View>
      <View
        style={[
          styles.previewCard,
          { borderColor: theme.border, backgroundColor: theme.background },
        ]}
      >
        {cover?.uri ? (
          <Image
            source={{ uri: cover.uri }}
            style={styles.previewCover}
            resizeMode="cover"
            accessibilityLabel="Cover image preview"
          />
        ) : (
          <View
            style={[
              styles.previewCover,
              styles.previewPlaceholder,
              { backgroundColor: theme.backgroundElement },
            ]}
          >
            <Ionicons
              name="car-sport-outline"
              size={58}
              color={theme.textSecondary}
            />
            <ThemedText themeColor="textSecondary">
              No cover photo added
            </ThemedText>
          </View>
        )}
        <View style={styles.previewBody}>
          <ThemedText style={styles.previewTitle}>
            {form.title.trim() || "Untitled vehicle"}
          </ThemedText>
          <ThemedText style={[styles.previewPrice, { color: theme.primary }]}>
            {price}
          </ThemedText>
          {location ? (
            <View style={styles.previewLocation}>
              <Ionicons
                name="location-outline"
                size={16}
                color={theme.textSecondary}
              />
              <ThemedText themeColor="textSecondary" style={styles.previewMeta}>
                {location}
              </ThemedText>
            </View>
          ) : null}
          {form.description.trim() ? (
            <ThemedText
              themeColor="textSecondary"
              style={styles.previewDescription}
              numberOfLines={4}
            >
              {form.description.trim()}
            </ThemedText>
          ) : null}
        </View>
      </View>
      <Section
        title="Listing details"
        description="The key information shown to potential buyers."
        icon="list-outline"
      >
        {rows.map(([label, value]) => (
          <View
            key={label}
            style={[styles.previewRow, { borderBottomColor: theme.border }]}
          >
            <ThemedText themeColor="textSecondary" style={styles.previewLabel}>
              {label}
            </ThemedText>
            <ThemedText style={styles.previewValue}>{value}</ThemedText>
          </View>
        ))}
        <ThemedText themeColor="textSecondary" style={styles.previewMeta}>
          {form.media.length
            ? `${form.media.length} photo${form.media.length === 1 ? "" : "s"}`
            : "No photos"}{" "}
          ·{" "}
          {form.featureIds.length
            ? `${form.featureIds.length} features`
            : "No features selected"}
        </ThemedText>
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    padding: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  stepIntro: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.three,
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.two,
  },
  stepIcon: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  stepHeading: { flex: 1, gap: Spacing.one },
  stepTitle: {
    fontSize: 23,
    lineHeight: 29,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  stepHint: { fontSize: 14, lineHeight: 20 },
  section: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
  },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionHeading: { flex: 1, gap: Spacing.half },
  sectionTitle: { fontSize: 16, lineHeight: 22, fontWeight: "800" },
  sectionDescription: { fontSize: 12, lineHeight: 18 },
  field: { gap: Spacing.two },
  fieldGroup: { gap: Spacing.two },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  groupLabel: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  inputShell: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingLeft: Spacing.three,
  },
  multilineShell: { alignItems: "flex-start" },
  multilineIcon: { marginTop: 16 },
  input: {
    flex: 1,
    minHeight: 50,
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
    fontSize: 16,
    lineHeight: 22,
  },
  inputWithIcon: { paddingLeft: 0 },
  multiline: { minHeight: 128, textAlignVertical: "top" },
  fieldHint: { fontSize: 12, lineHeight: 17 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.three },
  gridItem: { flexGrow: 1, flexBasis: 140 },
  priceField: { flexGrow: 3, flexBasis: 180 },
  currencyField: { flexGrow: 1, flexBasis: 100 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  chip: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  chipText: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  hint: { flex: 1, fontSize: 12, lineHeight: 18 },
  error: { color: BrandColors.error, fontSize: 13, lineHeight: 18 },
  inlineNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
    borderRadius: BorderRadius.md,
    padding: Spacing.three,
  },
  locationButton: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    padding: Spacing.two,
  },
  locationButtonText: { flexShrink: 1, fontSize: 14, fontWeight: "700" },
  successRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
  },
  upload: {
    minHeight: 148,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    padding: Spacing.three,
  },
  uploadIcon: {
    width: 42,
    height: 42,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadText: { fontSize: 15, fontWeight: "800" },
  mediaGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.three },
  mediaCard: {
    width: "47%",
    flexGrow: 1,
    minWidth: 145,
    maxWidth: 220,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
  },
  thumbnail: {
    width: "100%",
    height: 132,
    backgroundColor: BrandColors.primarySurface,
  },
  coverBadge: {
    position: "absolute",
    top: Spacing.two,
    left: Spacing.two,
    backgroundColor: BrandColors.primary,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  coverText: { color: BrandColors.white, fontSize: 11, fontWeight: "800" },
  mediaActions: { padding: Spacing.two, gap: Spacing.two },
  mediaActionText: { fontSize: 12, lineHeight: 18, fontWeight: "700" },
  coverSpacer: { height: 18 },
  reorder: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  preview: { gap: Spacing.three },
  readyCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
  },
  readyText: { flex: 1, gap: Spacing.one },
  readyTitle: { fontSize: 14, fontWeight: "800" },
  previewCard: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
  },
  previewCover: { width: "100%", height: 240 },
  previewPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
  },
  previewBody: { padding: Spacing.four, gap: Spacing.two },
  previewTitle: { fontSize: 23, lineHeight: 29, fontWeight: "800" },
  previewPrice: { fontSize: 20, fontWeight: "800" },
  previewLocation: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  previewDescription: { fontSize: 14, lineHeight: 21, marginTop: Spacing.two },
  previewMeta: { flex: 1, fontSize: 13, lineHeight: 19 },
  previewRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: Spacing.two,
  },
  previewLabel: { flex: 1, fontSize: 13 },
  previewValue: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "right",
  },
});
