import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { ThemedText } from "@/components/themed-text";
import { PrimaryButton } from "@/shared/components/primary-button";
import { SelectField } from "@/shared/components/select-field";
import { CURRENCIES } from "@/shared/utils/currencies";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createTaxonomyApi } from "@/features/onboarding/services/taxonomy-api";
import type { CommunityView } from "@/features/communities/types/community-types";
import { createSpareBagApi } from "../services/spare-bag-api";
import { uploadSpareBagImage, type SpareBagImageSelection } from "../services/spare-bag-media";
import type { Airport, Category, Listing, ListingRequest, ListingType, PriceUnit } from "../types/spare-bag-types";
import { DetailRow, formatPrice, quantitySummary, SafetyNotice, SurfaceCard } from "./spare-bag-ui";
import { AirportField, ChoiceChip, DateField, Field, FormInput, SegmentedControl, StepProgress } from "./form-controls";

interface FormState {
  visibilityScope: "COMMUNITY" | "COUNTRY";
  communityId: string;
  originAirportId: string;
  destinationAirportId: string;
  title: string;
  description: string;
  travelDateStart: string;
  travelDateEnd: string;
  weightKg: string;
  parcelCount: string;
  maxSingleParcelKg: string;
  priceAmount: string;
  priceUnit: PriceUnit;
  priceCurrency: string;
  collectionPlace: string;
  handoverPlace: string;
  handoverNotes: string;
  collectionAddressId: string;
  handoverAddressId: string;
  categoryKeys: string[];
  mediaIds: string[];
}

function initialState(listingType: ListingType, listing?: Listing): FormState {
  return {
    visibilityScope: listing?.visibilityScope ?? "COUNTRY",
    communityId: listing?.communityId ?? "",
    originAirportId: listing?.originAirport.id ?? "",
    destinationAirportId: listing?.destinationAirport.id ?? "",
    title: listing?.title ?? "",
    description: listing?.description ?? "",
    travelDateStart: listing?.travelDateStart ?? "",
    travelDateEnd: listing?.travelDateEnd ?? "",
    weightKg: String(listing?.requestedWeightKg ?? listing?.availableCapacityKg ?? ""),
    parcelCount: String(listing?.requestedParcelCount ?? listing?.availableParcelCount ?? ""),
    maxSingleParcelKg: String(listing?.maxSingleParcelKg ?? ""),
    priceAmount: String(listing?.priceAmount ?? ""),
    priceUnit: listing?.priceUnit ?? "PER_KG",
    priceCurrency: listing?.priceCurrency ?? "USD",
    collectionPlace: listing?.collectionPlace ?? "",
    handoverPlace: listing?.handoverPlace ?? "",
    handoverNotes: listing?.handoverNotes ?? "",
    collectionAddressId: listing?.collectionAddress?.id ?? "",
    handoverAddressId: listing?.handoverAddress?.id ?? "",
    categoryKeys: listing?.categories.map((item) => item.key) ?? [],
    mediaIds: listing?.mediaIds ?? [],
  };
}

function optionalNumber(value: string): number | undefined {
  return value.trim() ? Number(value) : undefined;
}

function positiveNumber(value: string): boolean {
  return Boolean(value.trim()) && Number.isFinite(Number(value)) && Number(value) > 0;
}

function validParcelCount(value: string): boolean {
  return !value.trim() || (Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 100);
}

export function toListingRequest(listingType: ListingType, form: FormState): ListingRequest {
  const sender = listingType === "SENDER_REQUEST";
  return {
    listingType,
    visibilityScope: form.visibilityScope,
    ...(form.visibilityScope === "COMMUNITY" && form.communityId.trim() ? { communityId: form.communityId.trim() } : {}),
    originAirportId: form.originAirportId,
    destinationAirportId: form.destinationAirportId,
    title: form.title.trim(),
    description: form.description.trim(),
    travelDateStart: form.travelDateStart,
    ...(form.travelDateEnd ? { travelDateEnd: form.travelDateEnd } : {}),
    ...(sender ? {
      requestedWeightKg: optionalNumber(form.weightKg),
      requestedParcelCount: optionalNumber(form.parcelCount),
    } : {
      availableCapacityKg: optionalNumber(form.weightKg),
      availableParcelCount: optionalNumber(form.parcelCount),
      maxSingleParcelKg: optionalNumber(form.maxSingleParcelKg),
    }),
    priceAmount: Number(form.priceAmount),
    priceUnit: form.priceUnit,
    priceCurrency: form.priceCurrency.trim().toUpperCase(),
    ...(form.collectionPlace.trim() ? { collectionPlace: form.collectionPlace.trim() } : {}),
    ...(form.collectionAddressId ? { collectionAddressId: form.collectionAddressId } : {}),
    ...(form.handoverPlace.trim() ? { handoverPlace: form.handoverPlace.trim() } : {}),
    ...(form.handoverAddressId ? { handoverAddressId: form.handoverAddressId } : {}),
    ...(form.handoverNotes.trim() ? { handoverNotes: form.handoverNotes.trim() } : {}),
    categoryKeys: form.categoryKeys,
    mediaIds: form.mediaIds,
  };
}

function validateRoute(form: FormState): string | null {
  if (!form.originAirportId || !form.destinationAirportId) return "Select both airports.";
  if (form.originAirportId === form.destinationAirportId) return "Origin and destination must differ.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.travelDateStart)) return "Use travel date format YYYY-MM-DD.";
  if (form.travelDateEnd && !/^\d{4}-\d{2}-\d{2}$/.test(form.travelDateEnd)) return "Use end date format YYYY-MM-DD.";
  if (form.travelDateEnd && form.travelDateEnd < form.travelDateStart) return "End date cannot be before start date.";
  return null;
}

function validateQuantities(form: FormState, listingType: ListingType): string | null {
  const sender = listingType === "SENDER_REQUEST";
  if (form.weightKg.trim() && !positiveNumber(form.weightKg)) return "Weight or capacity must be greater than zero.";
  if (!validParcelCount(form.parcelCount)) return "Parcel count must be a whole number between 1 and 100.";
  if (sender && !form.weightKg && !form.parcelCount) return "Add a weight or parcel count.";
  if (!sender && !positiveNumber(form.weightKg)) return "Add available capacity in kilograms.";
  if (!sender && form.maxSingleParcelKg.trim()) {
    if (!positiveNumber(form.maxSingleParcelKg)) return "Maximum parcel weight must be greater than zero.";
    if (positiveNumber(form.weightKg) && Number(form.maxSingleParcelKg) > Number(form.weightKg)) return "Maximum parcel weight cannot exceed available capacity.";
  }
  return null;
}

function validatePriceAndHandover(form: FormState): string | null {
  if (form.priceUnit === "PER_KG" && !positiveNumber(form.weightKg)) return "Per-kg pricing requires a positive weight or capacity.";
  if (form.priceUnit === "PER_PARCEL" && (!form.parcelCount || !validParcelCount(form.parcelCount))) return "Per-parcel pricing requires a parcel count between 1 and 100.";
  if (!form.priceAmount || !Number.isFinite(Number(form.priceAmount)) || Number(form.priceAmount) < 0 || !/^[A-Za-z]{3}$/.test(form.priceCurrency)) {
    return "Add a valid price and three-letter currency.";
  }
  if (!form.collectionPlace.trim() && !form.handoverPlace.trim() && !form.collectionAddressId && !form.handoverAddressId) {
    return "Add a public collection or handover place.";
  }
  return null;
}

export function validateListingForm(form: FormState, listingType: ListingType): string | null {
  if (!form.title.trim() || !form.description.trim()) return "Add a title and truthful description.";
  return validateRoute(form)
    ?? validateQuantities(form, listingType)
    ?? validatePriceAndHandover(form)
    ?? (form.visibilityScope === "COMMUNITY" && !form.communityId.trim() ? "Select a compatible community." : null);
}

/** Code-first options so the closed field shows "USD" while rows stay searchable by code, name, or symbol. */
const CURRENCY_FIELD_OPTIONS = CURRENCIES.map((currency) => ({
  id: currency.code,
  label: currency.code,
  sublabel: `${currency.name}${currency.symbol ? ` ${currency.symbol}` : ""}`,
}));

const senderSteps = ["Your parcel", "Route & dates", "Price & handover", "Review"];
const passengerSteps = ["Your journey", "Spare capacity", "Price & handover", "Review"];

export function ListingForm({
  listingType,
  listing,
  onSubmit,
}: {
  listingType: ListingType;
  listing?: Listing;
  onSubmit: (request: ListingRequest, publish?: boolean) => Promise<Listing>;
}) {
  const theme = useTheme();
  const { apiClient, session } = useSession();
  const api = useMemo(() => createSpareBagApi(apiClient), [apiClient]);
  const [form, setForm] = useState(() => initialState(listingType, listing));
  const [airports, setAirports] = useState<Airport[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [communities, setCommunities] = useState<CommunityView[]>([]);
  const [selection, setSelection] = useState<SpareBagImageSelection | null>(null);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState<"draft" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sender = listingType === "SENDER_REQUEST";
  const canPublish = !listing || listing.status === "DRAFT" || listing.status === "PAUSED";
  const steps = sender ? senderSteps : passengerSteps;

  useEffect(() => {
    Promise.all([api.airports(), api.categories(), createTaxonomyApi(apiClient).communities({ active: true })])
      .then(([airportPage, categoryPage, communityPage]) => {
        setAirports(airportPage.items);
        setCategories(categoryPage.items);
        setCommunities(communityPage.items);
      })
      .catch(() => setError("Could not load airports, categories, and communities."));
  }, [api, apiClient]);

  const searchAirports = useCallback((query: string) => api.airports(query).then((result) => result.items), [api]);
  const origin = airports.find((airport) => airport.id === form.originAirportId) ?? listing?.originAirport;
  const destination = airports.find((airport) => airport.id === form.destinationAirportId) ?? listing?.destinationAirport;
  const activeMemberships = useMemo(() => new Set(
    (session?.memberships ?? []).filter((membership) => membership.status === "ACTIVE").map((membership) => membership.communityId),
  ), [session?.memberships]);
  const compatibleCommunities = useMemo(() => communities.filter((community) =>
    activeMemberships.has(community.id)
    && community.active
    && community.destinationCountryId != null
    && community.destinationCountryId === origin?.countryId,
  ), [activeMemberships, communities, origin?.countryId]);

  function patch(value: Partial<FormState>) {
    setForm((current) => ({ ...current, ...value }));
    setError(null);
  }

  function changeOrigin(originAirportId: string) {
    const nextOrigin = airports.find((airport) => airport.id === originAirportId);
    const selected = communities.find((community) => community.id === form.communityId);
    patch({
      originAirportId,
      ...(selected && selected.destinationCountryId !== nextOrigin?.countryId ? { communityId: "" } : {}),
    });
  }

  function validateStep(index: number): string | null {
    if (sender && index === 0) {
      if (!form.title.trim() || !form.description.trim()) return "Add a title and truthful description.";
      return validateQuantities(form, listingType);
    }
    if ((!sender && index === 0) || (sender && index === 1)) return validateRoute(form);
    if (!sender && index === 1) return validateQuantities(form, listingType);
    if (index === 2) return validatePriceAndHandover(form);
    if (index === 3 && form.visibilityScope === "COMMUNITY") {
      if (!form.communityId) return "Select a compatible community or choose Country visibility.";
      if (!compatibleCommunities.some((community) => community.id === form.communityId)) return "The selected community is not compatible with your active membership and origin country.";
    }
    return null;
  }

  function next() {
    const validation = validateStep(step);
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);
    setStep((current) => Math.min(3, current + 1));
  }

  async function pickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Allow photo library access to add a listing image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, allowsMultipleSelection: false });
    const asset = result.canceled ? null : result.assets[0];
    if (asset) {
      setSelection({ uri: asset.uri, mimeType: (asset.mimeType ?? "image/jpeg").toLowerCase(), size: asset.fileSize ?? 0 });
    }
  }

  async function submit(publish = false) {
    const validation = validateListingForm(form, listingType);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(publish ? "publish" : "draft");
    setError(null);
    try {
      const mediaIds = selection ? [...form.mediaIds, await uploadSpareBagImage(apiClient, selection)] : form.mediaIds;
      await onSubmit(toListingRequest(listingType, { ...form, mediaIds }), publish);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : publish ? "The listing was not published. Check your entitlement and try again." : "Could not save the listing.");
    } finally {
      setSaving(null);
    }
  }

  const reviewListing = listing ?? {
    priceAmount: Number(form.priceAmount || 0),
    priceCurrency: form.priceCurrency,
    priceUnit: form.priceUnit,
    requestedWeightKg: sender ? optionalNumber(form.weightKg) ?? null : null,
    requestedParcelCount: sender ? optionalNumber(form.parcelCount) ?? null : null,
    availableCapacityKg: sender ? null : optionalNumber(form.weightKg) ?? null,
    availableParcelCount: sender ? null : optionalNumber(form.parcelCount) ?? null,
    listingType,
  } as Listing;

  return (
    <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <StepProgress step={step} titles={steps} />
      <ThemedText style={styles.title}>{steps[step]}</ThemedText>

      {sender && step === 0 ? (
        <SurfaceCard>
          <FormInput label="Title" value={form.title} onChangeText={(title) => patch({ title })} placeholder="e.g. Documents to London" maxLength={160} />
          <FormInput label="Description" value={form.description} onChangeText={(description) => patch({ description })} placeholder="Describe the contents accurately and include anything a traveller should know" multiline maxLength={4000} />
          <Field label="Parcel categories" hint="Choose all that apply">
            <View style={styles.choices}>{categories.map((category) => {
              const selected = form.categoryKeys.includes(category.key);
              return <ChoiceChip key={category.key} label={category.displayName} selected={selected} onPress={() => patch({ categoryKeys: selected ? form.categoryKeys.filter((key) => key !== category.key) : [...form.categoryKeys, category.key] })} />;
            })}</View>
          </Field>
          <FormInput label="Estimated weight (kg)" value={form.weightKg} onChangeText={(weightKg) => patch({ weightKg })} keyboardType="decimal-pad" placeholder="e.g. 3.5" />
          <FormInput label="Requested parcel count" value={form.parcelCount} onChangeText={(parcelCount) => patch({ parcelCount })} keyboardType="number-pad" placeholder="1–100" hint="Required for per-parcel pricing" />
        </SurfaceCard>
      ) : null}

      {((sender && step === 1) || (!sender && step === 0)) ? (
        <SurfaceCard>
          <AirportField label="Origin airport" airports={airports} value={form.originAirportId} onChange={changeOrigin} onSearch={searchAirports} />
          <AirportField label="Destination airport" airports={airports} value={form.destinationAirportId} onChange={(destinationAirportId) => patch({ destinationAirportId })} onSearch={searchAirports} />
          <View style={styles.dateColumns}>
            <View style={styles.flex}><DateField label="Travel start" value={form.travelDateStart} onChange={(travelDateStart) => patch({ travelDateStart })} /></View>
            <View style={styles.flex}><DateField label="Travel end" value={form.travelDateEnd} onChange={(travelDateEnd) => patch({ travelDateEnd })} optional /></View>
          </View>
          <ThemedText type="small" themeColor="textSecondary">Matching uses the exact route and overlapping dates.</ThemedText>
        </SurfaceCard>
      ) : null}

      {!sender && step === 1 ? (
        <SurfaceCard>
          <View style={[styles.capacityHero, { backgroundColor: theme.primarySurface }]}>
            <ThemedText style={[styles.capacityNumber, { color: theme.primary }]}>{form.weightKg || "0"}</ThemedText>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>kg available</ThemedText>
          </View>
          <FormInput label="Available capacity (kg)" value={form.weightKg} onChangeText={(weightKg) => patch({ weightKg })} keyboardType="decimal-pad" placeholder="Total spare capacity" />
          <FormInput label="Available parcel count" value={form.parcelCount} onChangeText={(parcelCount) => patch({ parcelCount })} keyboardType="number-pad" placeholder="1–100" hint="Required for per-parcel pricing" />
          <FormInput label="Maximum single parcel (kg)" value={form.maxSingleParcelKg} onChangeText={(maxSingleParcelKg) => patch({ maxSingleParcelKg })} keyboardType="decimal-pad" placeholder="Cannot exceed total capacity" />
          <FormInput label="Offer title" value={form.title} onChangeText={(title) => patch({ title })} placeholder="e.g. Spare space ADD to LHR" maxLength={160} />
          <FormInput label="Journey notes" value={form.description} onChangeText={(description) => patch({ description })} placeholder="Describe what you can carry and any truthful restrictions" multiline maxLength={4000} />
          <Field label="Accepted parcel categories"><View style={styles.choices}>{categories.map((category) => {
            const selected = form.categoryKeys.includes(category.key);
            return <ChoiceChip key={category.key} label={category.displayName} selected={selected} onPress={() => patch({ categoryKeys: selected ? form.categoryKeys.filter((key) => key !== category.key) : [...form.categoryKeys, category.key] })} />;
          })}</View></Field>
        </SurfaceCard>
      ) : null}

      {step === 2 ? (
        <>
          <SurfaceCard>
            <View style={styles.priceColumns}>
              <View style={styles.priceGrow}><FormInput label={sender ? "Budget" : "Price"} value={form.priceAmount} onChangeText={(priceAmount) => patch({ priceAmount })} keyboardType="decimal-pad" placeholder="0.00" /></View>
              <View style={styles.currency}><SelectField label="Currency" value={form.priceCurrency} options={CURRENCY_FIELD_OPTIONS} onChange={(priceCurrency) => patch({ priceCurrency })} modalTitle="Currency" searchPlaceholder="Search currencies" /></View>
            </View>
            <SegmentedControl label="Price unit" value={form.priceUnit} values={[{ value: "PER_KG", label: "Per KG" }, { value: "PER_PARCEL", label: "Per parcel" }]} onChange={(priceUnit) => patch({ priceUnit })} />
          </SurfaceCard>
          <SurfaceCard>
            <ThemedText style={styles.sectionTitle}>Public handover arrangements</ThemedText>
            <FormInput label="Collection place" value={form.collectionPlace} onChangeText={(collectionPlace) => patch({ collectionPlace })} placeholder="A safe public meeting place" />
            <FormInput label="Handover place" value={form.handoverPlace} onChangeText={(handoverPlace) => patch({ handoverPlace })} placeholder="Optional alternative handover place" />
            <FormInput label="Handover notes" value={form.handoverNotes} onChangeText={(handoverNotes) => patch({ handoverNotes })} placeholder="Timing or public-place instructions" multiline />
            {form.collectionAddressId || form.handoverAddressId ? <ThemedText type="small" themeColor="textSecondary">Saved private addresses stay hidden until both participants are authorised.</ThemedText> : <ThemedText type="small" themeColor="textSecondary">Public places only — no private addresses or phone numbers.</ThemedText>}
            <PrimaryButton label="Add listing image" onPress={() => void pickImage()} variant="secondary" />
            {selection ? <Image source={{ uri: selection.uri }} style={styles.preview} accessibilityLabel="Selected listing image" /> : null}
          </SurfaceCard>
          <SafetyNotice compact />
        </>
      ) : null}

      {step === 3 ? (
        <>
          <SurfaceCard>
            <SegmentedControl label="Visibility" value={form.visibilityScope} values={[{ value: "COUNTRY", label: "Country", icon: "earth-outline" }, { value: "COMMUNITY", label: "Community", icon: "people-outline" }]} onChange={(visibilityScope) => patch({ visibilityScope, ...(visibilityScope === "COUNTRY" ? { communityId: "" } : {}) })} />
            {form.visibilityScope === "COUNTRY" ? <ThemedText type="small" themeColor="textSecondary">Visible to eligible members in the origin country.</ThemedText> : (
              <Field label="Compatible communities" hint="Only memberships matching the origin country are shown">
                {compatibleCommunities.length ? <View style={styles.choices}>{compatibleCommunities.map((community) => <ChoiceChip key={community.id} label={community.name} selected={form.communityId === community.id} onPress={() => patch({ communityId: community.id })} />)}</View> : <ThemedText type="small" themeColor="textSecondary">No compatible active community membership is available for this origin country.</ThemedText>}
              </Field>
            )}
          </SurfaceCard>
          <SurfaceCard>
            <ThemedText style={styles.sectionTitle}>Review {sender ? "request" : "offer"}</ThemedText>
            <ThemedText style={styles.reviewTitle}>{form.title || "Untitled listing"}</ThemedText>
            <ThemedText themeColor="textSecondary">{form.description}</ThemedText>
            <DetailRow icon="airplane-outline" label="Route" value={`${origin?.iataCode ?? "—"} ${origin?.city ?? ""} → ${destination?.iataCode ?? "—"} ${destination?.city ?? ""}`} />
            <DetailRow icon="calendar-outline" label="Travel dates" value={`${form.travelDateStart || "—"}${form.travelDateEnd ? ` – ${form.travelDateEnd}` : ""}`} />
            <DetailRow icon="cube-outline" label={sender ? "Requested quantity" : "Available capacity"} value={quantitySummary(reviewListing)} />
            {!sender && form.maxSingleParcelKg ? <DetailRow icon="briefcase-outline" label="Maximum single parcel" value={`${form.maxSingleParcelKg} kg`} /> : null}
            <DetailRow icon="pricetag-outline" label={sender ? "Proposed budget" : "Proposed price"} value={formatPrice(reviewListing)} />
            <DetailRow icon="location-outline" label="Public handover" value={form.collectionPlace || form.handoverPlace || "Private address reference"} />
            {form.categoryKeys.length ? <ThemedText type="small">Categories: {categories.filter((category) => form.categoryKeys.includes(category.key)).map((category) => category.displayName).join(", ")}</ThemedText> : null}
          </SurfaceCard>
          <ThemedText type="small" themeColor="textSecondary">Publishing uses your listing entitlement; moderation rules apply.</ThemedText>
        </>
      ) : null}

      {error ? <View style={[styles.error, { backgroundColor: theme.errorSurface }]}><ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{error}</ThemedText></View> : null}
      <View style={styles.navigation}>
        {step > 0 ? <PrimaryButton label="Back" variant="secondary" onPress={() => { setError(null); setStep((current) => current - 1); }} /> : null}
        {step < 3 ? <PrimaryButton label="Continue" onPress={next} /> : null}
        {listing ? <PrimaryButton label="Save changes" loading={saving === "draft"} disabled={saving != null} onPress={() => void submit(false)} /> : null}
        {step === 3 && !listing ? <PrimaryButton label="Save draft for review" variant="secondary" loading={saving === "draft"} disabled={saving != null} onPress={() => void submit(false)} /> : null}
        {step === 3 && canPublish ? <PrimaryButton label={listing ? "Save & publish" : sender ? "Publish Request" : "Publish Offer"} loading={saving === "publish"} disabled={saving != null} onPress={() => void submit(true)} /> : null}
      </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboard: { flex: 1 },
  content: { paddingVertical: Spacing.three, paddingHorizontal: Spacing.two, gap: Spacing.three, paddingBottom: Spacing.seven },
  title: { fontSize: 28, lineHeight: 34, fontWeight: "800" },
  sectionTitle: { fontSize: 20, lineHeight: 26, fontWeight: "700" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  dateColumns: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  flex: { flex: 1, minWidth: 145 },
  capacityHero: { minHeight: 110, alignItems: "center", justifyContent: "center", borderRadius: BorderRadius.lg },
  capacityNumber: { fontSize: 42, lineHeight: 50, fontWeight: "800" },
  priceColumns: { flexDirection: "row", gap: Spacing.two },
  priceGrow: { flex: 1 },
  currency: { width: 105 },
  preview: { width: "100%", height: 200, borderRadius: BorderRadius.lg },
  reviewTitle: { fontSize: 20, lineHeight: 26, fontWeight: "700" },
  error: { padding: Spacing.three, borderRadius: BorderRadius.md },
  navigation: { gap: Spacing.two },
});
