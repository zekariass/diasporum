import React, { useEffect, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { ThemedText } from "@/components/themed-text";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createSpareBagApi } from "../services/spare-bag-api";
import { uploadSpareBagImage, type SpareBagImageSelection } from "../services/spare-bag-media";
import type {
  Airport,
  Category,
  Listing,
  ListingRequest,
  ListingType,
  PriceUnit,
} from "../types/spare-bag-types";
import { SafetyNotice } from "./spare-bag-ui";

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

export function toListingRequest(listingType: ListingType, form: FormState): ListingRequest {
  const sender = listingType === "SENDER_REQUEST";
  return {
    listingType,
    visibilityScope: form.visibilityScope,
    ...(form.visibilityScope === "COMMUNITY" && form.communityId.trim()
      ? { communityId: form.communityId.trim() } : {}),
    originAirportId: form.originAirportId,
    destinationAirportId: form.destinationAirportId,
    title: form.title.trim(),
    description: form.description.trim(),
    travelDateStart: form.travelDateStart,
    ...(form.travelDateEnd ? { travelDateEnd: form.travelDateEnd } : {}),
    ...(sender
      ? {
          requestedWeightKg: optionalNumber(form.weightKg),
          requestedParcelCount: optionalNumber(form.parcelCount),
        }
      : {
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

export function validateListingForm(form: FormState, listingType: ListingType): string | null {
  if (!form.originAirportId || !form.destinationAirportId) return "Select both airports.";
  if (form.originAirportId === form.destinationAirportId) return "Origin and destination must differ.";
  if (!form.title.trim() || !form.description.trim()) return "Add a title and truthful description.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.travelDateStart)) return "Use travel date format YYYY-MM-DD.";
  if (form.travelDateEnd && form.travelDateEnd < form.travelDateStart) return "End date cannot be before start date.";
  if (listingType === "PASSENGER_OFFER" && (!form.weightKg || Number(form.weightKg) <= 0)) {
    return "Add available capacity in kilograms.";
  }
  if (listingType === "SENDER_REQUEST" && !form.weightKg && !form.parcelCount) {
    return "Add a weight or parcel count.";
  }
  if (form.priceUnit === "PER_KG" && !form.weightKg) return "Per-kg pricing requires a weight.";
  if (form.priceUnit === "PER_PARCEL" && !form.parcelCount) return "Per-parcel pricing requires a parcel count.";
  if (form.visibilityScope === "COMMUNITY" && !form.communityId.trim()) return "Add the community ID.";
  if (!form.priceAmount || !Number.isFinite(Number(form.priceAmount)) || Number(form.priceAmount) < 0 || !/^[A-Za-z]{3}$/.test(form.priceCurrency)) {
    return "Add a valid price and three-letter currency.";
  }
  if (!form.collectionPlace.trim() && !form.handoverPlace.trim()) return "Add a collection or handover place.";
  return null;
}

export function ListingForm({
  listingType,
  listing,
  onSubmit,
}: {
  listingType: ListingType;
  listing?: Listing;
  onSubmit: (request: ListingRequest) => Promise<Listing>;
}) {
  const theme = useTheme();
  const { apiClient } = useSession();
  const [form, setForm] = useState(() => initialState(listingType, listing));
  const [airports, setAirports] = useState<Airport[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selection, setSelection] = useState<SpareBagImageSelection | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sender = listingType === "SENDER_REQUEST";

  useEffect(() => {
    const api = createSpareBagApi(apiClient);
    Promise.all([api.airports(), api.categories()])
      .then(([airportPage, categoryPage]) => {
        setAirports(airportPage.items);
        setCategories(categoryPage.items);
      })
      .catch(() => setError("Could not load airports and categories."));
  }, [apiClient]);

  function patch(value: Partial<FormState>) {
    setForm((current) => ({ ...current, ...value }));
  }

  async function pickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsMultipleSelection: false,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (asset) {
      setSelection({
        uri: asset.uri,
        mimeType: (asset.mimeType ?? "image/jpeg").toLowerCase(),
        size: asset.fileSize ?? 0,
      });
    }
  }

  async function submit() {
    const validation = validateListingForm(form, listingType);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const mediaIds = selection
        ? [...form.mediaIds, await uploadSpareBagImage(apiClient, selection)]
        : form.mediaIds;
      await onSubmit(toListingRequest(listingType, { ...form, mediaIds }));
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not save the listing.");
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = [styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }];
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <SafetyNotice />
      <ThemedText type="subtitle" style={styles.section}>
        {sender ? "Request spare bag space" : "Offer your spare bag space"}
      </ThemedText>
      <Field label="Title"><TextInput accessibilityLabel="Title" value={form.title} onChangeText={(title) => patch({ title })} style={inputStyle} /></Field>
      <Field label="Description"><TextInput accessibilityLabel="Description" value={form.description} onChangeText={(description) => patch({ description })} style={[inputStyle, styles.multiline]} multiline /></Field>
      <Field label="Origin airport"><AirportChoices airports={airports} value={form.originAirportId} onChange={(originAirportId) => patch({ originAirportId })} /></Field>
      <Field label="Destination airport"><AirportChoices airports={airports} value={form.destinationAirportId} onChange={(destinationAirportId) => patch({ destinationAirportId })} /></Field>
      <View style={styles.row}>
        <Field label="Travel start"><TextInput accessibilityLabel="Travel start" placeholder="YYYY-MM-DD" value={form.travelDateStart} onChangeText={(travelDateStart) => patch({ travelDateStart })} style={inputStyle} autoCapitalize="none" /></Field>
        <Field label="Travel end (optional)"><TextInput accessibilityLabel="Travel end" placeholder="YYYY-MM-DD" value={form.travelDateEnd} onChangeText={(travelDateEnd) => patch({ travelDateEnd })} style={inputStyle} autoCapitalize="none" /></Field>
      </View>
      <Field label={sender ? "Requested weight (kg)" : "Available capacity (kg)"}><TextInput accessibilityLabel="Weight in kilograms" keyboardType="decimal-pad" value={form.weightKg} onChangeText={(weightKg) => patch({ weightKg })} style={inputStyle} /></Field>
      <Field label={sender ? "Requested parcel count" : "Available parcel count"}><TextInput accessibilityLabel="Parcel count" keyboardType="number-pad" value={form.parcelCount} onChangeText={(parcelCount) => patch({ parcelCount })} style={inputStyle} /></Field>
      {!sender ? <Field label="Maximum single parcel (kg)"><TextInput accessibilityLabel="Maximum single parcel" keyboardType="decimal-pad" value={form.maxSingleParcelKg} onChangeText={(maxSingleParcelKg) => patch({ maxSingleParcelKg })} style={inputStyle} /></Field> : null}
      <View style={styles.row}>
        <Field label="Price"><TextInput accessibilityLabel="Price" keyboardType="decimal-pad" value={form.priceAmount} onChangeText={(priceAmount) => patch({ priceAmount })} style={inputStyle} /></Field>
        <Field label="Currency"><TextInput accessibilityLabel="Currency" maxLength={3} autoCapitalize="characters" value={form.priceCurrency} onChangeText={(priceCurrency) => patch({ priceCurrency })} style={inputStyle} /></Field>
      </View>
      <ChoiceRow label="Price unit" values={["PER_KG", "PER_PARCEL"]} value={form.priceUnit} onChange={(priceUnit) => patch({ priceUnit: priceUnit as PriceUnit })} />
      <ChoiceRow label="Visibility" values={["COUNTRY", "COMMUNITY"]} value={form.visibilityScope} onChange={(visibilityScope) => patch({ visibilityScope: visibilityScope as "COUNTRY" | "COMMUNITY" })} />
      {form.visibilityScope === "COMMUNITY" ? <Field label="Community ID"><TextInput accessibilityLabel="Community ID" autoCapitalize="none" value={form.communityId} onChangeText={(communityId) => patch({ communityId })} style={inputStyle} /></Field> : null}
      <Field label="Public collection place"><TextInput accessibilityLabel="Collection place" value={form.collectionPlace} onChangeText={(collectionPlace) => patch({ collectionPlace })} style={inputStyle} /></Field>
      <Field label="Public handover place"><TextInput accessibilityLabel="Handover place" value={form.handoverPlace} onChangeText={(handoverPlace) => patch({ handoverPlace })} style={inputStyle} /></Field>
      <ThemedText type="small" themeColor="textSecondary">Exact private addresses are only shown to both owners after acceptance.</ThemedText>
      <Field label="Handover notes"><TextInput accessibilityLabel="Handover notes" value={form.handoverNotes} onChangeText={(handoverNotes) => patch({ handoverNotes })} style={inputStyle} /></Field>
      <Field label="Categories"><View style={styles.choices}>{categories.map((category) => {
        const selected = form.categoryKeys.includes(category.key);
        return <Choice key={category.key} label={category.displayName} selected={selected} onPress={() => patch({ categoryKeys: selected ? form.categoryKeys.filter((key) => key !== category.key) : [...form.categoryKeys, category.key] })} />;
      })}</View></Field>
      <PrimaryButton label="Add listing image" onPress={() => void pickImage()} variant="secondary" />
      {selection ? <Image source={{ uri: selection.uri }} style={styles.preview} accessibilityLabel="Selected listing image" /> : null}
      {error ? <ThemedText accessibilityRole="alert" style={{ color: BrandColors.error }}>{error}</ThemedText> : null}
      <PrimaryButton label={listing ? "Save changes" : "Save draft for review"} loading={saving} onPress={() => void submit()} />
    </ScrollView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={styles.field}><ThemedText type="smallBold">{label}</ThemedText>{children}</View>;
}

function AirportChoices({ airports, value, onChange }: { airports: Airport[]; value: string; onChange: (id: string) => void }) {
  return <View style={styles.choices}>{airports.map((airport) => <Choice key={airport.id} label={`${airport.iataCode} — ${airport.city}`} selected={value === airport.id} onPress={() => onChange(airport.id)} />)}</View>;
}

function ChoiceRow({ label, values, value, onChange }: { label: string; values: string[]; value: string; onChange: (value: string) => void }) {
  return <Field label={label}><View style={styles.choices}>{values.map((item) => <Choice key={item} label={item.replace("_", " ")} selected={value === item} onPress={() => onChange(item)} />)}</View></Field>;
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={[styles.choice, { borderColor: selected ? BrandColors.primary : theme.border, backgroundColor: selected ? BrandColors.primarySurface : theme.backgroundElement }]}><ThemedText type="small">{label}</ThemedText></Pressable>;
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  section: { fontSize: 22, lineHeight: 28 },
  field: { gap: Spacing.one, flex: 1 },
  row: { flexDirection: "row", gap: Spacing.two },
  input: { borderWidth: 1, borderRadius: BorderRadius.md, padding: Spacing.three, minHeight: 48 },
  multiline: { minHeight: 110, textAlignVertical: "top" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  choice: { borderWidth: 1, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  preview: { width: "100%", height: 200, borderRadius: BorderRadius.md },
});
