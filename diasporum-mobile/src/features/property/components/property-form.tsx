import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { ThemedText } from "@/components/themed-text";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createBusinessApi } from "@/features/business/services/business-api";
import { createCommunityApi } from "@/features/communities/services/community-api";
import type { BusinessAccount } from "@/features/business/types/business-types";
import type { CommunityView } from "@/features/communities/types/community-types";
import { createPropertyApi } from "../services/property-api";
import type { Amenity, PropertyImageSelection, PropertyType } from "../types/property-types";
import type { PropertyFormState } from "../utils/property-form-state";
import { Chip, Field, FormSection } from "./property-controls";

interface Props {
  state: PropertyFormState;
  onChange: (patch: Partial<PropertyFormState>) => void;
  existingMediaCount?: number;
}

export function PropertyForm({ state, onChange, existingMediaCount = 0 }: Props) {
  const theme = useTheme();
  const { apiClient, session } = useSession();
  const [types, setTypes] = useState<PropertyType[]>([]);
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [accounts, setAccounts] = useState<BusinessAccount[]>([]);
  const [communities, setCommunities] = useState<CommunityView[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    const propertyApi = createPropertyApi(apiClient);
    const memberIds = new Set((session?.memberships ?? []).filter((member) => member.status === "ACTIVE").map((member) => member.communityId));
    Promise.all([
      propertyApi.types(state.countryId),
      propertyApi.amenities(),
      createBusinessApi(apiClient).accounts().catch(() => ({ items: [] })),
      createCommunityApi(apiClient).availableCommunities().catch(() => ({ items: [] })),
    ]).then(([typeResult, amenityResult, accountResult, communityResult]) => {
      setTypes(typeResult.items);
      setAmenities(amenityResult.items);
      setAccounts(accountResult.items.filter((account) => account.status === "ACTIVE" && ["OWNER", "ADMINISTRATOR", "LISTING_MANAGER"].includes(account.role)));
      setCommunities(communityResult.items.filter((community) => memberIds.has(community.id) && community.destinationCountryId === state.countryId));
    }).catch(() => setFormError("Some form options could not be loaded. Pull back and retry if an option is missing."));
  }, [apiClient, session?.memberships, state.countryId]);

  async function pickImages() {
    if (picking) return;
    setPicking(true);
    setFormError(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setFormError("Media library access is required to add property photos.");
        return;
      }
      const remaining = Math.max(0, 12 - existingMediaCount - state.images.length);
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
        if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
          setFormError("Choose JPEG, PNG, or WebP images only.");
          return;
        }
        selected.push({ uri: asset.uri, mimeType: mime, size: asset.fileSize ?? 0 });
      }
      onChange({ images: [...state.images, ...selected].slice(0, remaining + state.images.length) });
    } finally {
      setPicking(false);
    }
  }

  function toggleAmenity(id: string) {
    onChange({ amenityIds: state.amenityIds.includes(id) ? state.amenityIds.filter((value) => value !== id) : [...state.amenityIds, id] });
  }

  function toggleCommunity(id: string) {
    onChange({ communityIds: state.communityIds.includes(id) ? state.communityIds.filter((value) => value !== id) : [...state.communityIds, id] });
  }

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <FormSection title="Listing">
        <ThemedText themeColor="textSecondary" style={styles.hint}>Create a draft first. You can review it before publishing.</ThemedText>
        <View style={styles.chipWrap}>
          <Chip label="For rent" active={state.listingPurpose === "RENT"} onPress={() => onChange({ listingPurpose: "RENT", pricePeriod: "MONTH" })} />
          <Chip label="For sale" active={state.listingPurpose === "SALE"} onPress={() => onChange({ listingPurpose: "SALE" })} />
        </View>
        <Field label="Title (required)" value={state.title} onChangeText={(title) => onChange({ title })} placeholder="Bright two-bedroom apartment" />
        <Field label="Description (required)" value={state.description} onChangeText={(description) => onChange({ description })} multiline placeholder="Describe the property, neighbourhood, and terms." />
        <ThemedText style={styles.label}>Property type</ThemedText>
        <View style={styles.chipWrap}>{types.map((type) => <Chip key={type.id} label={type.displayName} active={state.propertyTypeId === type.id} onPress={() => onChange({ propertyTypeId: type.id })} />)}</View>
      </FormSection>

      <FormSection title="Owner and audience">
        <ThemedText style={styles.label}>List as</ThemedText>
        <View style={styles.chipWrap}>
          <Chip label="Personal" active={!state.businessAccountId} onPress={() => onChange({ businessAccountId: undefined })} />
          {accounts.map((account) => <Chip key={account.id} label={account.accountName} active={state.businessAccountId === account.id} onPress={() => onChange({ businessAccountId: account.id })} accessibilityLabel={`List as ${account.accountName}`} />)}
        </View>
        <ThemedText themeColor="textSecondary" style={styles.hint}>Business access and listing-manager capability are verified again by the backend.</ThemedText>
        <ThemedText style={styles.label}>Audience</ThemedText>
        <View style={styles.chipWrap}>
          <Chip label="Country" active={state.visibilityScope === "COUNTRY"} onPress={() => onChange({ visibilityScope: "COUNTRY", communityId: undefined })} />
          <Chip label="One community" active={state.visibilityScope === "COMMUNITY"} onPress={() => onChange({ visibilityScope: "COMMUNITY", communityId: session?.activeCommunityId ?? communities[0]?.id })} />
          <Chip label="Selected communities" active={state.visibilityScope === "SELECTED_COMMUNITIES"} onPress={() => onChange({ visibilityScope: "SELECTED_COMMUNITIES", communityId: undefined })} />
        </View>
        {state.visibilityScope === "COMMUNITY" ? <View style={styles.chipWrap}>{communities.map((community) => <Chip key={community.id} label={community.name} active={state.communityId === community.id} onPress={() => onChange({ communityId: community.id })} />)}</View> : null}
        {state.visibilityScope === "SELECTED_COMMUNITIES" ? <View style={styles.chipWrap}>{communities.map((community) => <Chip key={community.id} label={community.name} active={state.communityIds.includes(community.id)} onPress={() => toggleCommunity(community.id)} />)}</View> : null}
      </FormSection>

      <FormSection title="Price and details">
        <View style={styles.twoColumns}>
          <View style={styles.column}><Field label="Price (required)" value={state.priceAmount} onChangeText={(priceAmount) => onChange({ priceAmount })} keyboardType="decimal-pad" /></View>
          <View style={styles.currency}><Field label="Currency" value={state.currencyCode} onChangeText={(currencyCode) => onChange({ currencyCode: currencyCode.toUpperCase().slice(0, 3) })} autoCapitalize="characters" /></View>
        </View>
        {state.listingPurpose === "RENT" ? <View style={styles.chipWrap}>{(["WEEK", "MONTH", "YEAR"] as const).map((period) => <Chip key={period} label={`Per ${period.toLowerCase()}`} active={state.pricePeriod === period} onPress={() => onChange({ pricePeriod: period })} />)}</View> : null}
        <View style={styles.twoColumns}>
          <View style={styles.column}><Field label="Bedrooms" value={state.bedrooms} onChangeText={(bedrooms) => onChange({ bedrooms })} keyboardType="number-pad" /></View>
          <View style={styles.column}><Field label="Bathrooms" value={state.bathrooms} onChangeText={(bathrooms) => onChange({ bathrooms })} keyboardType="number-pad" /></View>
        </View>
        <Field label="Reception rooms" value={state.receptionRooms} onChangeText={(receptionRooms) => onChange({ receptionRooms })} keyboardType="number-pad" />
        <View style={styles.twoColumns}>
          <View style={styles.column}><Field label="Floor area" value={state.floorArea} onChangeText={(floorArea) => onChange({ floorArea })} keyboardType="decimal-pad" /></View>
          <View style={styles.column}><View style={styles.unitButtons}><Chip label="m²" active={state.floorAreaUnit === "SQM"} onPress={() => onChange({ floorAreaUnit: "SQM" })} /><Chip label="ft²" active={state.floorAreaUnit === "SQFT"} onPress={() => onChange({ floorAreaUnit: "SQFT" })} /></View></View>
        </View>
        <ThemedText style={styles.label}>Furnishing</ThemedText>
        <View style={styles.chipWrap}><Chip label="Unspecified" active={!state.furnishedStatus} onPress={() => onChange({ furnishedStatus: undefined })} />{(["FURNISHED", "PART_FURNISHED", "UNFURNISHED"] as const).map((status) => <Chip key={status} label={status.toLowerCase().replaceAll("_", " ")} active={state.furnishedStatus === status} onPress={() => onChange({ furnishedStatus: status })} />)}</View>
        <Field label="Condition (optional)" value={state.conditionKey} onChangeText={(conditionKey) => onChange({ conditionKey: conditionKey.toUpperCase().replaceAll(" ", "_") })} placeholder="GOOD" />
        <Field label="Tenure (optional)" value={state.tenure} onChangeText={(tenure) => onChange({ tenure })} placeholder="Freehold" />
        {state.listingPurpose === "RENT" ? <><Field label="Rental deposit" value={state.rentalDeposit} onChangeText={(rentalDeposit) => onChange({ rentalDeposit })} keyboardType="decimal-pad" /><Field label="Minimum tenancy (months)" value={state.minimumTenancyMonths} onChangeText={(minimumTenancyMonths) => onChange({ minimumTenancyMonths })} keyboardType="number-pad" /><View style={styles.chipWrap}><Chip label={state.billsIncluded ? "Bills included" : "Bills not included"} active={state.billsIncluded} onPress={() => onChange({ billsIncluded: !state.billsIncluded })} /></View></> : null}
        <Field label="Available from (YYYY-MM-DD)" value={state.availabilityDate} onChangeText={(availabilityDate) => onChange({ availabilityDate })} placeholder="2026-08-01" />
      </FormSection>

      <FormSection title="Amenities">
        <View style={styles.chipWrap}>{amenities.map((amenity) => <Chip key={amenity.id} label={amenity.displayName} active={state.amenityIds.includes(amenity.id)} onPress={() => toggleAmenity(amenity.id)} />)}</View>
      </FormSection>

      <FormSection title="Private address and discovery point">
        <ThemedText themeColor="textSecondary" style={styles.hint}>The street address and exact coordinates stay private. Other viewers only receive city/region and an approximate discovery point.</ThemedText>
        <Field label="Street address" value={state.addressLine1} onChangeText={(addressLine1) => onChange({ addressLine1 })} />
        <Field label="Address line 2" value={state.addressLine2} onChangeText={(addressLine2) => onChange({ addressLine2 })} />
        <Field label="City (required)" value={state.city} onChangeText={(city) => onChange({ city })} />
        <Field label="Region" value={state.region} onChangeText={(region) => onChange({ region })} />
        <Field label="Postal code" value={state.postalCode} onChangeText={(postalCode) => onChange({ postalCode })} />
        <View style={styles.twoColumns}>
          <View style={styles.column}><Field label="Exact latitude" value={state.latitude} onChangeText={(latitude) => onChange({ latitude })} keyboardType="decimal-pad" placeholder="50.1109" /></View>
          <View style={styles.column}><Field label="Exact longitude" value={state.longitude} onChangeText={(longitude) => onChange({ longitude })} keyboardType="decimal-pad" placeholder="8.6821" /></View>
        </View>
      </FormSection>

      <FormSection title="Contact (optional)">
        <Field label="Phone" value={state.phone} onChangeText={(phone) => onChange({ phone, preferredMethod: state.preferredMethod ?? "PHONE" })} keyboardType="phone-pad" />
        {state.phone ? <Chip label={state.showPhone ? "Phone visible" : "Phone hidden"} active={state.showPhone} onPress={() => onChange({ showPhone: !state.showPhone })} /> : null}
        <Field label="WhatsApp" value={state.whatsapp} onChangeText={(whatsapp) => onChange({ whatsapp, preferredMethod: state.preferredMethod ?? "WHATSAPP" })} keyboardType="phone-pad" />
        {state.whatsapp ? <Chip label={state.showWhatsapp ? "WhatsApp visible" : "WhatsApp hidden"} active={state.showWhatsapp} onPress={() => onChange({ showWhatsapp: !state.showWhatsapp })} /> : null}
        <Field label="Contact email" value={state.email} onChangeText={(email) => onChange({ email, preferredMethod: state.preferredMethod ?? "EMAIL" })} keyboardType="email-address" />
        {state.email ? <Chip label={state.showEmail ? "Email visible" : "Email hidden"} active={state.showEmail} onPress={() => onChange({ showEmail: !state.showEmail })} /> : null}
      </FormSection>

      <FormSection title="Photos">
        <ThemedText themeColor="textSecondary" style={styles.hint}>At least one image is required before publishing. The first uploaded image becomes the cover unless you choose another.</ThemedText>
        <Pressable onPress={() => void pickImages()} disabled={picking} accessibilityRole="button" accessibilityLabel="Add property photos" style={[styles.photoPicker, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="images-outline" size={22} color={BrandColors.primary} />
          <ThemedText style={styles.photoText}>{picking ? "Choosing…" : "Add property photos"}</ThemedText>
        </Pressable>
        {state.images.map((image, index) => <View key={`${image.uri}-${index}`} style={[styles.pendingImage, { borderColor: theme.border }]}><ThemedText style={styles.pendingText} numberOfLines={1}>New photo {index + 1}</ThemedText><Pressable onPress={() => onChange({ images: state.images.filter((_, itemIndex) => itemIndex !== index) })} accessibilityLabel={`Remove new photo ${index + 1}`}><Ionicons name="close-circle" size={20} color={BrandColors.error} /></Pressable></View>)}
      </FormSection>
      {formError ? <ThemedText style={styles.error}>{formError}</ThemedText> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.five },
  hint: { fontSize: 13, lineHeight: 19 },
  label: { fontSize: 13, fontWeight: "600" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  twoColumns: { flexDirection: "row", gap: Spacing.two, alignItems: "flex-end" },
  column: { flex: 1 },
  currency: { width: 105 },
  unitButtons: { flexDirection: "row", gap: Spacing.two, paddingBottom: 2 },
  photoPicker: { minHeight: 70, borderWidth: 1, borderStyle: "dashed", borderRadius: BorderRadius.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.two },
  photoText: { fontSize: 14, fontWeight: "700" },
  pendingImage: { flexDirection: "row", alignItems: "center", borderWidth: StyleSheet.hairlineWidth, borderRadius: BorderRadius.md, padding: Spacing.two },
  pendingText: { flex: 1, fontSize: 13 },
  error: { color: BrandColors.error, fontSize: 13, lineHeight: 19 },
});
