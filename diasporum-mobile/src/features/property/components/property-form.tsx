import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { ThemedText } from "@/components/themed-text";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { SelectField } from "@/shared/components/select-field";
import { CURRENCY_OPTIONS } from "@/shared/utils/currencies";
import { createBusinessApi } from "@/features/business/services/business-api";
import { createCommunityApi } from "@/features/communities/services/community-api";
import { createDirectoryApi } from "@/features/business-directory/services/directory-api";
import type { BusinessAccount } from "@/features/business/types/business-types";
import type { Business } from "@/features/business-directory/types/directory-types";
import type { CommunityView } from "@/features/communities/types/community-types";
import { createPropertyApi } from "../services/property-api";
import type {
  Amenity,
  PropertyImageSelection,
  PropertyType,
} from "../types/property-types";
import type { PropertyFormState } from "../utils/property-form-state";
import {
  Chip,
  Field,
  FormScrollContext,
  FormSection,
  SegmentedControl,
  StepperInput,
} from "./property-controls";

const CONDITION_OPTIONS = [
  { id: "", label: "Not specified" },
  { id: "NEW", label: "New" },
  { id: "EXCELLENT", label: "Excellent" },
  { id: "GOOD", label: "Good" },
  { id: "FAIR", label: "Fair" },
  { id: "NEEDS_RENOVATION", label: "Needs renovation" },
];

const STEP_CONTENT: readonly {
  title: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    title: "Listing basics",
    hint: "Tell us what you're listing and help it stand out.",
    icon: "home-outline",
  },
  {
    title: "Price & details",
    hint: "Set your price and share the details buyers and tenants care about.",
    icon: "pricetag-outline",
  },
  {
    title: "Audience & location",
    hint: "Choose your audience and add the location. Exact addresses stay private.",
    icon: "location-outline",
  },
  {
    title: "Amenities & contact",
    hint: "Highlight what's included and choose how people can reach you.",
    icon: "sparkles-outline",
  },
  {
    title: "Photos",
    hint: "Add clear, bright photos to make your property stand out.",
    icon: "images-outline",
  },
];

const FURNISHING_OPTIONS = [
  { id: "FURNISHED", label: "Furnished" },
  { id: "PART_FURNISHED", label: "Part furnished" },
  { id: "UNFURNISHED", label: "Unfurnished" },
] as const;

interface Props {
  state: PropertyFormState;
  onChange: (patch: Partial<PropertyFormState>) => void;
  existingMediaCount?: number;
  step?: number;
  mediaSlot?: React.ReactNode;
}

export function PropertyForm({
  state,
  onChange,
  existingMediaCount = 0,
  step = 0,
  mediaSlot,
}: Props) {
  const theme = useTheme();
  const { apiClient, session } = useSession();
  const [types, setTypes] = useState<PropertyType[]>([]);
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [accounts, setAccounts] = useState<BusinessAccount[]>([]);
  const [profiles, setProfiles] = useState<Business[]>([]);
  const [communities, setCommunities] = useState<CommunityView[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const scrollOffset = useRef(0);
  const keyboardHeight = useRef(0);
  const [keyboardPad, setKeyboardPad] = useState(0);
  const focusedInput = useRef<React.ComponentRef<typeof TextInput> | null>(
    null,
  );
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { height: windowHeight } = useWindowDimensions();

  // Focus-driven keyboard handling: while any field is focused the content
  // gets scroll room below it and the field is scrolled above the computed
  // visible boundary. This does not depend on keyboard events — focus itself
  // implies the keyboard — so it works even when the platform cannot resize
  // the window or deliver reliable events. Real keyboard height is used when
  // measurable; otherwise ~40% of the window is assumed.
  const formScroll = useMemo(
    () => ({
      reveal(input: React.ComponentRef<typeof TextInput>) {
        if (blurTimer.current) clearTimeout(blurTimer.current);
        focusedInput.current = input;
        const metrics = Keyboard.metrics();
        const keyboard =
          metrics && metrics.height > 0
            ? metrics.height
            : Math.max(keyboardHeight.current, windowHeight * 0.4);
        keyboardHeight.current = keyboard;
        setKeyboardPad(keyboard);
        setTimeout(() => {
          const scrollView = scrollRef.current;
          if (!scrollView || focusedInput.current !== input) return;
          input.measureInWindow(
            (_x: number, inputY: number, _w: number, inputHeight: number) => {
              scrollView.measureInWindow(
                (
                  _sx: number,
                  viewY: number,
                  _sw: number,
                  viewHeight: number,
                ) => {
                  const visibleBottom = Math.min(
                    viewY + viewHeight,
                    Dimensions.get("screen").height - keyboard,
                  );
                  const hidden =
                    inputY + inputHeight - visibleBottom + Spacing.four;
                  if (hidden > 0)
                    scrollView.scrollTo({
                      y: scrollOffset.current + hidden,
                      animated: true,
                    });
                },
              );
            },
          );
        }, 300);
      },
      blur() {
        if (blurTimer.current) clearTimeout(blurTimer.current);
        blurTimer.current = setTimeout(() => {
          focusedInput.current = null;
          keyboardHeight.current = 0;
          setKeyboardPad(0);
        }, 200);
      },
    }),
    [windowHeight],
  );

  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", (event) => {
      keyboardHeight.current = event.endCoordinates.height;
      setKeyboardPad(event.endCoordinates.height);
      const input = focusedInput.current;
      if (input) formScroll.reveal(input);
    });
    const hidden = Keyboard.addListener("keyboardDidHide", () => {
      keyboardHeight.current = 0;
      if (!focusedInput.current) setKeyboardPad(0);
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [formScroll]);

  useEffect(() => {
    const propertyApi = createPropertyApi(apiClient);
    const memberIds = new Set(
      (session?.memberships ?? [])
        .filter((member) => member.status === "ACTIVE")
        .map((member) => member.communityId),
    );
    Promise.all([
      propertyApi.types(state.countryId),
      propertyApi.amenities(),
      createBusinessApi(apiClient)
        .accounts()
        .catch(() => ({ items: [] })),
      createCommunityApi(apiClient)
        .availableCommunities()
        .catch(() => ({ items: [] })),
    ])
      .then(([typeResult, amenityResult, accountResult, communityResult]) => {
        setTypes(typeResult.items);
        setAmenities(amenityResult.items);
        setAccounts(
          accountResult.items.filter(
            (account) =>
              account.status === "ACTIVE" &&
              ["OWNER", "ADMINISTRATOR", "LISTING_MANAGER"].includes(
                account.role,
              ),
          ),
        );
        setCommunities(
          communityResult.items.filter(
            (community) =>
              memberIds.has(community.id) &&
              community.destinationCountryId === state.countryId,
          ),
        );
      })
      .catch(() =>
        setFormError(
          "Some form options could not be loaded. Pull back and retry if an option is missing.",
        ),
      );
  }, [apiClient, session?.memberships, state.countryId]);

  // Eligible public Business Profiles for the selected owning account.
  const [profilesAccountId, setProfilesAccountId] = useState<
    string | undefined
  >();
  useEffect(() => {
    const accountId = state.businessAccountId;
    if (!accountId) return;
    let cancelled = false;
    createDirectoryApi(apiClient)
      .managed(accountId)
      .then((page) => {
        if (cancelled) return;
        setProfilesAccountId(accountId);
        setProfiles(page.items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiClient, state.businessAccountId]);
  const accountProfiles =
    state.businessAccountId && profilesAccountId === state.businessAccountId
      ? profiles
      : [];

  async function pickImages() {
    if (picking) return;
    setPicking(true);
    setFormError(null);
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setFormError(
          "Media library access is required to add property photos.",
        );
        return;
      }
      const remaining = Math.max(
        0,
        12 - existingMediaCount - state.images.length,
      );
      if (!remaining) {
        setFormError("A property can have at most 12 images.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        allowsEditing: false,
        quality: 0.9,
      });
      if (result.canceled) return;
      const selected: PropertyImageSelection[] = [];
      for (const asset of result.assets) {
        const mime = (asset.mimeType ?? "image/jpeg").toLowerCase();
        if (
          mime !== "image/jpeg" &&
          mime !== "image/png" &&
          mime !== "image/webp"
        ) {
          setFormError("Choose JPEG, PNG, or WebP images only.");
          return;
        }
        selected.push({
          uri: asset.uri,
          mimeType: mime,
          size: asset.fileSize ?? 0,
        });
      }
      onChange({
        images: [...state.images, ...selected].slice(
          0,
          remaining + state.images.length,
        ),
      });
    } finally {
      setPicking(false);
    }
  }

  function toggleAmenity(id: string) {
    onChange({
      amenityIds: state.amenityIds.includes(id)
        ? state.amenityIds.filter((value) => value !== id)
        : [...state.amenityIds, id],
    });
  }

  function toggleCommunity(id: string) {
    onChange({
      communityIds: state.communityIds.includes(id)
        ? state.communityIds.filter((value) => value !== id)
        : [...state.communityIds, id],
    });
  }

  const currentStep = STEP_CONTENT[step] ?? STEP_CONTENT[0];
  const totalPhotos = existingMediaCount + state.images.length;
  const remainingPhotos = Math.max(0, 12 - totalPhotos);

  return (
    <FormScrollContext.Provider value={formScroll}>
      <ScrollView
        key={step}
        ref={scrollRef}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: styles.content.paddingBottom + keyboardPad },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        onScroll={(event) => {
          scrollOffset.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
        <View style={styles.intro}>
          <View
            style={[
              styles.introIcon,
              { backgroundColor: theme.primarySurface },
            ]}
          >
            <Ionicons name={currentStep.icon} size={25} color={theme.primary} />
          </View>
          <View style={styles.introCopy}>
            <ThemedText style={styles.introTitle}>
              {currentStep.title}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.hint}>
              {currentStep.hint}
            </ThemedText>
          </View>
        </View>

        {step === 0 ? (
          <View style={styles.step}>
            <FormSection
              title="Listing purpose"
              description="Choose how you want to market this property."
              icon="swap-horizontal-outline"
            >
              <SegmentedControl
                options={[
                  { id: "RENT", label: "For rent", icon: "key-outline" },
                  { id: "SALE", label: "For sale", icon: "pricetag-outline" },
                ]}
                value={state.listingPurpose}
                onChange={(purpose) =>
                  onChange(
                    purpose === "RENT"
                      ? { listingPurpose: purpose, pricePeriod: "MONTH" }
                      : { listingPurpose: purpose },
                  )
                }
              />
            </FormSection>
            <FormSection
              title="Property details"
              description="A clear title and useful description attract better enquiries."
              icon="create-outline"
            >
              <SelectField
                label="Property type (required)"
                value={state.propertyTypeId}
                options={types.map((propertyType) => ({
                  id: propertyType.id,
                  label: propertyType.displayName,
                }))}
                onChange={(propertyTypeId) => onChange({ propertyTypeId })}
                modalTitle="Property type"
                searchPlaceholder="Search property types"
                inputStyle={styles.selectInput}
                leadingIcon="business-outline"
                hint="Options are based on your current country."
              />
              <Field
                label="Title (required)"
                value={state.title}
                onChangeText={(title) => onChange({ title })}
                placeholder="e.g. Bright two-bedroom apartment"
                maxLength={220}
                hint={`${state.title.length}/220 characters`}
              />
              <Field
                label="Description (required)"
                value={state.description}
                onChangeText={(description) => onChange({ description })}
                multiline
                placeholder="Describe the property, neighbourhood, key features, and terms."
                maxLength={20000}
                hint="Include the details that would matter most to you as a buyer or tenant."
              />
            </FormSection>
          </View>
        ) : null}

        {step === 1 ? (
          <View style={styles.step}>
            <FormSection
              title="Asking price"
              description={
                state.listingPurpose === "RENT"
                  ? "Set the rent and how often it is paid."
                  : "Set the total asking price for the property."
              }
              icon="cash-outline"
            >
              <View style={styles.twoColumns}>
                <View style={styles.column}>
                  <Field
                    label="Price (required)"
                    value={state.priceAmount}
                    onChangeText={(priceAmount) => onChange({ priceAmount })}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                  />
                </View>
                <View style={styles.currency}>
                  <SelectField
                    label="Currency"
                    value={state.currencyCode}
                    options={CURRENCY_OPTIONS}
                    onChange={(currencyCode) => onChange({ currencyCode })}
                    modalTitle="Currency"
                    searchPlaceholder="Search currencies"
                    inputStyle={styles.selectInput}
                  />
                </View>
              </View>
              {state.listingPurpose === "RENT" ? (
                <View style={styles.fieldGroup}>
                  <ThemedText style={styles.label}>Rental period</ThemedText>
                  <SegmentedControl
                    options={[
                      { id: "WEEK", label: "Weekly" },
                      { id: "MONTH", label: "Monthly" },
                      { id: "YEAR", label: "Yearly" },
                    ]}
                    value={state.pricePeriod}
                    onChange={(pricePeriod) => onChange({ pricePeriod })}
                    accessibilityLabel="Rental period"
                  />
                </View>
              ) : null}
            </FormSection>
            <FormSection
              title="Rooms & space"
              description="Add the key facts people use to compare properties."
              icon="bed-outline"
            >
              <View style={styles.stepperGroup}>
                <StepperInput
                  label="Bedrooms"
                  value={state.bedrooms}
                  onChange={(bedrooms) => onChange({ bedrooms })}
                />
                <StepperInput
                  label="Bathrooms"
                  value={state.bathrooms}
                  onChange={(bathrooms) => onChange({ bathrooms })}
                />
                <StepperInput
                  label="Reception rooms"
                  value={state.receptionRooms}
                  onChange={(receptionRooms) => onChange({ receptionRooms })}
                />
              </View>
              <View style={styles.twoColumns}>
                <View style={styles.column}>
                  <Field
                    label="Floor area"
                    value={state.floorArea}
                    onChangeText={(floorArea) => onChange({ floorArea })}
                    keyboardType="decimal-pad"
                    placeholder="e.g. 85"
                  />
                </View>
                <View style={styles.column}>
                  <View style={styles.fieldGroup}>
                    <ThemedText style={styles.label}>Unit</ThemedText>
                    <SegmentedControl
                      options={[
                        { id: "SQM", label: "m²" },
                        { id: "SQFT", label: "ft²" },
                      ]}
                      value={state.floorAreaUnit}
                      onChange={(floorAreaUnit) => onChange({ floorAreaUnit })}
                      accessibilityLabel="Floor area unit"
                    />
                  </View>
                </View>
              </View>
            </FormSection>
            <FormSection
              title="Additional details"
              description="Optional details help people decide if the property is right for them."
              icon="options-outline"
            >
              <View style={styles.fieldGroup}>
                <ThemedText style={styles.label}>Furnishing</ThemedText>
                <View style={styles.chipWrap}>
                  <Chip
                    label="Not specified"
                    active={!state.furnishedStatus}
                    onPress={() => onChange({ furnishedStatus: undefined })}
                  />
                  {FURNISHING_OPTIONS.map((option) => (
                    <Chip
                      key={option.id}
                      label={option.label}
                      active={state.furnishedStatus === option.id}
                      onPress={() => onChange({ furnishedStatus: option.id })}
                    />
                  ))}
                </View>
              </View>
              <View style={styles.twoColumns}>
                <View style={styles.column}>
                  <SelectField
                    label="Condition"
                    value={state.conditionKey}
                    options={CONDITION_OPTIONS}
                    onChange={(conditionKey) => onChange({ conditionKey })}
                    modalTitle="Condition"
                    searchPlaceholder="Search conditions"
                    inputStyle={styles.selectInput}
                  />
                </View>
                {state.listingPurpose === "SALE" ? (
                  <View style={styles.column}>
                    <Field
                      label="Tenure"
                      value={state.tenure}
                      onChangeText={(tenure) => onChange({ tenure })}
                      placeholder="e.g. Freehold"
                    />
                  </View>
                ) : null}
              </View>
            </FormSection>
            {state.listingPurpose === "RENT" ? (
              <FormSection
                title="Rental terms"
                description="Set clear expectations for prospective tenants."
                icon="document-text-outline"
              >
                <Field
                  label="Deposit"
                  value={state.rentalDeposit}
                  onChangeText={(rentalDeposit) => onChange({ rentalDeposit })}
                  keyboardType="decimal-pad"
                  placeholder={`Amount in ${state.currencyCode}`}
                  icon="wallet-outline"
                />
                <StepperInput
                  label="Minimum tenancy"
                  hint="months"
                  value={state.minimumTenancyMonths}
                  onChange={(minimumTenancyMonths) =>
                    onChange({ minimumTenancyMonths })
                  }
                  max={36}
                />
                <View style={styles.chipWrap}>
                  <Chip
                    label={
                      state.billsIncluded
                        ? "Bills included"
                        : "Bills not included"
                    }
                    active={state.billsIncluded}
                    onPress={() =>
                      onChange({ billsIncluded: !state.billsIncluded })
                    }
                  />
                </View>
              </FormSection>
            ) : null}
            <FormSection
              title="Availability"
              description="Let people know when the property can be occupied."
              icon="calendar-outline"
            >
              <Field
                label="Available from (YYYY-MM-DD)"
                value={state.availabilityDate}
                onChangeText={(availabilityDate) =>
                  onChange({ availabilityDate })
                }
                placeholder="YYYY-MM-DD"
                icon="calendar-outline"
                hint="Optional — leave blank if the date is flexible."
              />
            </FormSection>
          </View>
        ) : null}

        {step === 2 ? (
          <View style={styles.step}>
            <FormSection
              title="List as"
              description="Advertise personally or through a business account you manage."
              icon="person-circle-outline"
            >
              <View style={styles.chipWrap}>
                <Chip
                  label="Personal"
                  active={!state.businessAccountId}
                  onPress={() =>
                    onChange({
                      businessAccountId: undefined,
                      businessListingId: undefined,
                    })
                  }
                />
                {accounts.map((account) => (
                  <Chip
                    key={account.id}
                    label={account.accountName}
                    active={state.businessAccountId === account.id}
                    onPress={() =>
                      onChange({
                        businessAccountId: account.id,
                        businessListingId:
                          state.businessAccountId === account.id
                            ? state.businessListingId
                            : undefined,
                      })
                    }
                    accessibilityLabel={`List as ${account.accountName}`}
                  />
                ))}
              </View>
              {accounts.length ? (
                <ThemedText themeColor="textSecondary" style={styles.smallHint}>
                  Business permissions are verified again when you save.
                </ThemedText>
              ) : null}
            </FormSection>
            {state.businessAccountId ? (
              <FormSection
                title="Public business profile"
                description="Optionally connect this listing to one of the account's public profiles."
                icon="storefront-outline"
              >
                <View style={styles.chipWrap}>
                  <Chip
                    label="No public profile"
                    active={!state.businessListingId}
                    onPress={() => onChange({ businessListingId: undefined })}
                  />
                  {accountProfiles.map((profile) => (
                    <Chip
                      key={profile.id}
                      label={profile.name}
                      active={state.businessListingId === profile.id}
                      onPress={() =>
                        onChange({ businessListingId: profile.id })
                      }
                      accessibilityLabel={`Publish under ${profile.name}`}
                    />
                  ))}
                </View>
              </FormSection>
            ) : null}
            <FormSection
              title="Audience"
              description="Control who can discover this listing after it is published."
              icon="globe-outline"
            >
              <SegmentedControl
                options={[
                  { id: "COUNTRY", label: "Country" },
                  { id: "COMMUNITY", label: "Community" },
                  { id: "SELECTED_COMMUNITIES", label: "Selected" },
                ]}
                value={state.visibilityScope}
                onChange={(visibilityScope) =>
                  onChange(
                    visibilityScope === "COMMUNITY"
                      ? {
                          visibilityScope,
                          communityId:
                            session?.activeCommunityId ?? communities[0]?.id,
                        }
                      : { visibilityScope, communityId: undefined },
                  )
                }
                accessibilityLabel="Audience"
              />
              {state.visibilityScope === "COMMUNITY" ? (
                <View style={styles.chipWrap}>
                  {communities.map((community) => (
                    <Chip
                      key={community.id}
                      label={community.name}
                      active={state.communityId === community.id}
                      onPress={() => onChange({ communityId: community.id })}
                    />
                  ))}
                </View>
              ) : null}
              {state.visibilityScope === "SELECTED_COMMUNITIES" ? (
                <View style={styles.chipWrap}>
                  {communities.map((community) => (
                    <Chip
                      key={community.id}
                      label={community.name}
                      active={state.communityIds.includes(community.id)}
                      onPress={() => toggleCommunity(community.id)}
                    />
                  ))}
                </View>
              ) : null}
            </FormSection>
            <FormSection
              title="Property location"
              description="Your street address and exact coordinates are never shown publicly."
              icon="lock-closed-outline"
            >
              <View
                style={[
                  styles.privacyNote,
                  { backgroundColor: theme.primarySurface },
                ]}
              >
                <Ionicons
                  name="shield-checkmark-outline"
                  size={18}
                  color={theme.primary}
                />
                <ThemedText style={styles.smallHint}>
                  Viewers only see the city, region, and an approximate map
                  location.
                </ThemedText>
              </View>
              <Field
                label="Street address"
                value={state.addressLine1}
                onChangeText={(addressLine1) => onChange({ addressLine1 })}
                placeholder="House number and street"
                icon="home-outline"
              />
              <Field
                label="Address line 2"
                value={state.addressLine2}
                onChangeText={(addressLine2) => onChange({ addressLine2 })}
                placeholder="Apartment, building, or unit (optional)"
              />
              <View style={styles.twoColumns}>
                <View style={styles.column}>
                  <Field
                    label="City (required)"
                    value={state.city}
                    onChangeText={(city) => onChange({ city })}
                    placeholder="City"
                  />
                </View>
                <View style={styles.column}>
                  <Field
                    label="Region"
                    value={state.region}
                    onChangeText={(region) => onChange({ region })}
                    placeholder="Area or region"
                  />
                </View>
              </View>
              <Field
                label="Postal code"
                value={state.postalCode}
                onChangeText={(postalCode) => onChange({ postalCode })}
                placeholder="Postal or ZIP code (if applicable)"
              />
              <View style={styles.coordinateFields}>
                <ThemedText style={styles.label}>
                  Exact coordinates (optional)
                </ThemedText>
                <ThemedText themeColor="textSecondary" style={styles.smallHint}>
                  Leave both empty for a city-only public location.
                </ThemedText>
                <View style={styles.twoColumns}>
                  <View style={styles.column}>
                    <Field
                      label="Exact latitude (optional)"
                      value={state.latitude}
                      onChangeText={(latitude) => onChange({ latitude })}
                      keyboardType="decimal-pad"
                      placeholder="50.1109"
                    />
                  </View>
                  <View style={styles.column}>
                    <Field
                      label="Exact longitude (optional)"
                      value={state.longitude}
                      onChangeText={(longitude) => onChange({ longitude })}
                      keyboardType="decimal-pad"
                      placeholder="8.6821"
                    />
                  </View>
                </View>
              </View>
            </FormSection>
          </View>
        ) : null}

        {step === 3 ? (
          <View style={styles.step}>
            <FormSection
              title="Amenities"
              description="Select everything included with the property."
              icon="sparkles-outline"
            >
              <View style={styles.chipWrap}>
                {amenities.map((amenity) => (
                  <Chip
                    key={amenity.id}
                    label={amenity.displayName}
                    active={state.amenityIds.includes(amenity.id)}
                    onPress={() => toggleAmenity(amenity.id)}
                  />
                ))}
              </View>
              {!amenities.length ? (
                <ThemedText themeColor="textSecondary" style={styles.smallHint}>
                  No amenities configured for this country yet.
                </ThemedText>
              ) : null}
            </FormSection>
            <FormSection
              title="Contact details"
              description="Add only the methods you want buyers or tenants to use. Each one has its own privacy control."
              icon="chatbubbles-outline"
            >
              <View style={styles.contactField}>
                <Field
                  label="Phone"
                  value={state.phone}
                  onChangeText={(phone) =>
                    onChange({
                      phone,
                      preferredMethod: state.preferredMethod ?? "PHONE",
                    })
                  }
                  keyboardType="phone-pad"
                  placeholder="Include country code"
                  icon="call-outline"
                />
                {state.phone ? (
                  <ContactVisibility
                    label="Phone"
                    visible={state.showPhone}
                    onPress={() => onChange({ showPhone: !state.showPhone })}
                  />
                ) : null}
              </View>
              <View style={styles.contactField}>
                <Field
                  label="WhatsApp"
                  value={state.whatsapp}
                  onChangeText={(whatsapp) =>
                    onChange({
                      whatsapp,
                      preferredMethod: state.preferredMethod ?? "WHATSAPP",
                    })
                  }
                  keyboardType="phone-pad"
                  placeholder="Include country code"
                  icon="logo-whatsapp"
                />
                {state.whatsapp ? (
                  <ContactVisibility
                    label="WhatsApp"
                    visible={state.showWhatsapp}
                    onPress={() =>
                      onChange({ showWhatsapp: !state.showWhatsapp })
                    }
                  />
                ) : null}
              </View>
              <View style={styles.contactField}>
                <Field
                  label="Contact email"
                  value={state.email}
                  onChangeText={(email) =>
                    onChange({
                      email,
                      preferredMethod: state.preferredMethod ?? "EMAIL",
                    })
                  }
                  keyboardType="email-address"
                  placeholder="you@example.com"
                  icon="mail-outline"
                  autoCapitalize="none"
                />
                {state.email ? (
                  <ContactVisibility
                    label="Email"
                    visible={state.showEmail}
                    onPress={() => onChange({ showEmail: !state.showEmail })}
                  />
                ) : null}
              </View>
            </FormSection>
          </View>
        ) : null}

        {step === 4 ? (
          <View style={styles.step}>
            <FormSection
              title="Property gallery"
              description="Listings with bright, high-quality photos attract more attention."
              icon="images-outline"
            >
              <Pressable
                onPress={() => void pickImages()}
                disabled={picking}
                accessibilityRole="button"
                accessibilityLabel="Add property photos"
                accessibilityState={{ busy: picking }}
                style={({ pressed }) => [
                  styles.photoPicker,
                  {
                    borderColor: pressed ? theme.primary : theme.border,
                    backgroundColor: theme.backgroundElement,
                  },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <View
                  style={[
                    styles.photoIcon,
                    { backgroundColor: theme.primarySurface },
                  ]}
                >
                  <Ionicons name="add" size={25} color={theme.primary} />
                </View>
                <View style={styles.photoCopy}>
                  <ThemedText style={styles.photoText}>
                    {picking ? "Choosing photos…" : "Add property photos"}
                  </ThemedText>
                  <ThemedText
                    themeColor="textSecondary"
                    style={styles.smallHint}
                  >
                    JPEG, PNG or WebP · {remainingPhotos} remaining
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.photoCount,
                    { backgroundColor: theme.primarySurface },
                  ]}
                >
                  <ThemedText
                    style={[styles.photoCountText, { color: theme.primary }]}
                  >
                    {totalPhotos}/12
                  </ThemedText>
                </View>
              </Pressable>
              {state.images.length ? (
                <View style={styles.newPhotos}>
                  <View style={styles.photoHeader}>
                    <ThemedText style={styles.photoGridTitle}>
                      Ready to upload
                    </ThemedText>
                    <ThemedText
                      themeColor="textSecondary"
                      style={styles.smallHint}
                    >
                      {state.images.length}{" "}
                      {state.images.length === 1 ? "photo" : "photos"}
                    </ThemedText>
                  </View>
                  <View style={styles.photoGrid}>
                    {state.images.map((image, index) => (
                      <View
                        key={`${image.uri}-${index}`}
                        style={[
                          styles.photoCell,
                          { borderColor: theme.border },
                        ]}
                      >
                        <Image
                          source={{ uri: image.uri }}
                          style={styles.photo}
                          accessibilityLabel={`New photo ${index + 1}`}
                        />
                        {index === 0 && existingMediaCount === 0 ? (
                          <View
                            style={[
                              styles.coverBadge,
                              { backgroundColor: theme.primary },
                            ]}
                          >
                            <ThemedText style={styles.coverBadgeText}>
                              Cover
                            </ThemedText>
                          </View>
                        ) : null}
                        <Pressable
                          onPress={() =>
                            onChange({
                              images: state.images.filter(
                                (_, itemIndex) => itemIndex !== index,
                              ),
                            })
                          }
                          accessibilityLabel={`Remove new photo ${index + 1}`}
                          accessibilityRole="button"
                          style={styles.photoRemove}
                          hitSlop={6}
                        >
                          <Ionicons
                            name="close"
                            size={18}
                            color={BrandColors.white}
                          />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
              <View style={styles.photoTip}>
                <Ionicons
                  name="information-circle-outline"
                  size={18}
                  color={theme.primary}
                />
                <ThemedText themeColor="textSecondary" style={styles.smallHint}>
                  Your first photo becomes the cover. You can reorder uploaded
                  photos below.
                </ThemedText>
              </View>
            </FormSection>
            {mediaSlot}
          </View>
        ) : null}

        {formError ? (
          <View
            style={[
              styles.errorBanner,
              { backgroundColor: theme.errorSurface },
            ]}
            accessibilityRole="alert"
          >
            <Ionicons name="alert-circle" size={19} color={theme.error} />
            <ThemedText style={[styles.error, { color: theme.error }]}>
              {formError}
            </ThemedText>
          </View>
        ) : null}
      </ScrollView>
    </FormScrollContext.Provider>
  );
}

function ContactVisibility({
  label,
  visible,
  onPress,
}: {
  label: string;
  visible: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${visible ? "visible" : "hidden"}`}
      accessibilityState={{ selected: visible }}
      style={[
        styles.visibilityToggle,
        {
          backgroundColor: visible
            ? theme.primarySurface
            : theme.backgroundElement,
        },
      ]}
    >
      <Ionicons
        name={visible ? "eye-outline" : "eye-off-outline"}
        size={17}
        color={visible ? theme.primary : theme.textSecondary}
      />
      <ThemedText
        style={[
          styles.visibilityText,
          { color: visible ? theme.primary : theme.textSecondary },
        ]}
      >
        {visible ? "Visible to viewers" : "Hidden from viewers"}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
    padding: Spacing.three,
    gap: Spacing.four,
    paddingBottom: Spacing.five,
  },
  step: { gap: Spacing.three },
  intro: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  introIcon: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  introCopy: { flex: 1, gap: Spacing.one },
  introTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  hint: { fontSize: 14, lineHeight: 20 },
  smallHint: { flex: 1, fontSize: 12, lineHeight: 17 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  fieldGroup: { gap: Spacing.two },
  stepperGroup: { gap: Spacing.two },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  twoColumns: {
    flexDirection: "row",
    gap: Spacing.three,
    alignItems: "flex-start",
  },
  column: { flex: 1, minWidth: 0 },
  currency: { width: 124 },
  selectInput: { minHeight: 52, paddingHorizontal: Spacing.three },
  coordinateFields: { gap: Spacing.two },
  privacyNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
    borderRadius: BorderRadius.md,
    padding: Spacing.three,
  },
  contactField: { gap: Spacing.two },
  visibilityToggle: {
    minHeight: 44,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  visibilityText: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  photoPicker: {
    minHeight: 104,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: BorderRadius.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    padding: Spacing.three,
  },
  photoIcon: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  photoCopy: { flex: 1, gap: Spacing.one },
  photoText: { fontSize: 15, lineHeight: 20, fontWeight: "700" },
  photoCount: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  photoCountText: { fontSize: 12, lineHeight: 16, fontWeight: "800" },
  newPhotos: { gap: Spacing.three },
  photoHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  photoGridTitle: { fontSize: 14, lineHeight: 19, fontWeight: "700" },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  photoCell: {
    width: "31.5%",
    aspectRatio: 0.88,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  photo: { width: "100%", height: "100%" },
  photoRemove: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 32,
    height: 32,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.62)",
  },
  coverBadge: {
    position: "absolute",
    left: 6,
    bottom: 6,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  coverBadgeText: {
    color: BrandColors.white,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
  },
  photoTip: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
    borderRadius: BorderRadius.md,
    padding: Spacing.three,
  },
  error: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: "600" },
});
