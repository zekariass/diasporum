import React, { useEffect, useMemo, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { PrimaryButton } from "@/shared/components/primary-button";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createServiceMarketplaceApi } from "../services/service-marketplace-api";
import { uploadServiceRequestImage, type ServiceImageSelection } from "../services/service-media";
import type { ServiceCategory, ServiceRequestInput } from "../types/service-marketplace-types";
import { LeadMarketplaceNotice, ScreenHeader, serviceStyles } from "../components/service-ui";

export const MAX_REQUEST_IMAGES = 5;

export interface RequestFormState {
  categoryId: string;
  addressId: string;
  latitude: string;
  longitude: string;
  title: string;
  description: string;
  budgetMin: string;
  budgetMax: string;
  currencyCode: string;
  preferredDate: string;
  expiresAt: string;
  mediaIds: string[];
}

export function validateRequestForm(form: RequestFormState): string | null {
  if (!form.categoryId) return "Select a service category.";
  if (!form.title.trim() || !form.description.trim()) return "Add a title and clear description.";
  const latitude = Number(form.latitude);
  const longitude = Number(form.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return "Provide a valid approximate request location.";
  }
  const hasBudget = Boolean(form.budgetMin.trim() || form.budgetMax.trim());
  if (hasBudget && !/^[A-Za-z]{3}$/.test(form.currencyCode)) return "Add a three-letter budget currency.";
  if (!hasBudget && form.currencyCode.trim()) return "Remove the currency or add a budget.";
  if (form.budgetMin && form.budgetMax && Number(form.budgetMin) > Number(form.budgetMax)) {
    return "Minimum budget cannot exceed maximum budget.";
  }
  if (form.preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.preferredDate)) return "Use preferred date format YYYY-MM-DD.";
  if (form.expiresAt && Number.isNaN(Date.parse(form.expiresAt))) return "Use a valid ISO expiry date/time.";
  if (form.mediaIds.length > MAX_REQUEST_IMAGES) return "A request can contain at most five images.";
  return null;
}

export function toRequestInput(form: RequestFormState, countryId: string): ServiceRequestInput {
  const hasBudget = Boolean(form.budgetMin.trim() || form.budgetMax.trim());
  return {
    serviceCategoryId: form.categoryId, countryId,
    ...(form.addressId.trim() ? { addressId: form.addressId.trim() } : {}),
    latitude: Number(form.latitude), longitude: Number(form.longitude),
    title: form.title.trim(), description: form.description.trim(),
    ...(form.budgetMin.trim() ? { budgetMin: Number(form.budgetMin) } : {}),
    ...(form.budgetMax.trim() ? { budgetMax: Number(form.budgetMax) } : {}),
    ...(hasBudget ? { currencyCode: form.currencyCode.toUpperCase() } : {}),
    ...(form.preferredDate ? { preferredDate: form.preferredDate } : {}),
    ...(form.expiresAt ? { expiresAt: new Date(form.expiresAt).toISOString() } : {}),
    mediaIds: form.mediaIds,
  };
}

export default function RequestEditorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { apiClient, session } = useSession();
  const api = useMemo(() => createServiceMarketplaceApi(apiClient), [apiClient]);
  const [form, setForm] = useState<RequestFormState>({
    categoryId: "", addressId: "", latitude: "", longitude: "", title: "", description: "",
    budgetMin: "", budgetMax: "", currencyCode: "", preferredDate: "", expiresAt: "", mediaIds: [],
  });
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [pendingImages, setPendingImages] = useState<ServiceImageSelection[]>([]);
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishedEdit, setPublishedEdit] = useState(false);
  const [requestCountryId, setRequestCountryId] = useState("");
  const countryId = session?.profile?.currentCountryId ?? "";

  useEffect(() => {
    api.categories().then(setCategories).catch(() => setError("Could not load service categories."));
    if (id) {
      api.request(id).then((request) => {
        setForm({
          categoryId: request.serviceCategoryId, addressId: request.addressId ?? "",
          latitude: String(request.latitude), longitude: String(request.longitude), title: request.title,
          description: request.description, budgetMin: String(request.budgetMin ?? ""),
          budgetMax: String(request.budgetMax ?? ""), currencyCode: request.currencyCode ?? "",
          preferredDate: request.preferredDate ?? "", expiresAt: request.expiresAt ?? "", mediaIds: request.mediaIds,
        });
        setRequestCountryId(request.countryId);
        setPublishedEdit(request.status === "OPEN" || request.status === "PAUSED");
      }).catch((cause) => setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load request."))
        .finally(() => setLoading(false));
    }
  }, [api, id]);

  function patch(value: Partial<RequestFormState>) {
    setForm((current) => ({ ...current, ...value }));
  }

  async function pickCurrentLocation() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setError("Location permission was denied. Enter approximate coordinates instead.");
      return;
    }
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      patch({ latitude: String(position.coords.latitude), longitude: String(position.coords.longitude) });
    } catch {
      setError("Location is unavailable. Enter approximate coordinates.");
    }
  }

  async function pickImage() {
    if (form.mediaIds.length + pendingImages.length >= MAX_REQUEST_IMAGES) {
      setError("A request can contain at most five images.");
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo library permission is needed to attach an image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    setPendingImages((current) => [...current, {
      uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg", size: asset.fileSize ?? 0,
    }]);
  }

  async function save() {
    const validation = validateRequestForm(form);
    const effectiveCountryId = requestCountryId || countryId;
    if (validation || !effectiveCountryId) {
      setError(validation ?? "Your profile needs a current country before creating a request.");
      return;
    }
    setSaving(true);
    setError(null);
    const uploaded: string[] = [];
    try {
      for (const selection of pendingImages) uploaded.push(await uploadServiceRequestImage(apiClient, selection));
      const input = toRequestInput({ ...form, mediaIds: [...form.mediaIds, ...uploaded] }, effectiveCountryId);
      const request = id ? await api.updateRequest(id, input) : await api.createRequest(input);
      router.replace(`/(app)/services/requests/${request.id}` as never);
    } catch (cause) {
      await Promise.all(uploaded.map((mediaId) =>
        apiClient.delete(`/api/v1/media/${mediaId}`, { authenticated: true }).catch(() => undefined)));
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not save the request. Uploads were rolled back.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ThemedView style={serviceStyles.root}>
      <SafeAreaView style={serviceStyles.root} edges={["top", "left", "right"]}>
        <ScreenHeader back title={id ? "Edit request" : "Request a service"} />
        {loading ? <LoadingScreen /> : <KeyboardAvoidingView style={serviceStyles.keyboard}
          behavior={Platform.OS === "ios" ? "padding" : "height"}><ScrollView
          contentContainerStyle={serviceStyles.content} keyboardShouldPersistTaps="handled">
          <LeadMarketplaceNotice />
          <ThemedText type="smallBold">Category</ThemedText>
          <View style={styles.categories}>{categories.map((category) => (
            <Pressable key={category.id} accessibilityRole="button" disabled={publishedEdit}
              accessibilityState={{ selected: form.categoryId === category.id, disabled: publishedEdit }}
              onPress={() => patch({ categoryId: category.id })}
              style={[styles.category, { borderColor: form.categoryId === category.id ? BrandColors.primary : theme.border }]}>
              <ThemedText type="small">{category.displayName}</ThemedText></Pressable>
          ))}</View>
          <TextInput accessibilityLabel="Request title" placeholder="What service do you need?" value={form.title}
            onChangeText={(value) => patch({ title: value })} maxLength={160}
            style={[serviceStyles.input, { color: theme.text, borderColor: theme.border }]} />
          <TextInput accessibilityLabel="Request description" placeholder="Describe scope, timing, and important details"
            value={form.description} onChangeText={(value) => patch({ description: value })} multiline maxLength={6000}
            style={[serviceStyles.input, serviceStyles.multiline, { color: theme.text, borderColor: theme.border }]} />
          {publishedEdit ? <ThemedText type="small" themeColor="textSecondary">
            Category, country, approximate location, and private address are fixed after publication.
          </ThemedText> : <PrimaryButton label="Use approximate current location" variant="secondary"
            onPress={() => void pickCurrentLocation()} />}
          <TextInput accessibilityLabel="Request latitude" placeholder="Approximate latitude" keyboardType="decimal-pad"
            editable={!publishedEdit} value={form.latitude} onChangeText={(value) => patch({ latitude: value })}
            style={[serviceStyles.input, { color: theme.text, borderColor: theme.border }]} />
          <TextInput accessibilityLabel="Request longitude" placeholder="Approximate longitude" keyboardType="decimal-pad"
            editable={!publishedEdit} value={form.longitude} onChangeText={(value) => patch({ longitude: value })}
            style={[serviceStyles.input, { color: theme.text, borderColor: theme.border }]} />
          <TextInput accessibilityLabel="Private address ID" placeholder="Private address ID (optional; only used for city/contact unlock)"
            autoCapitalize="none" editable={!publishedEdit} value={form.addressId}
            onChangeText={(value) => patch({ addressId: value })}
            style={[serviceStyles.input, { color: theme.text, borderColor: theme.border }]} />
          <TextInput accessibilityLabel="Minimum budget" placeholder="Minimum budget (optional)" keyboardType="decimal-pad"
            value={form.budgetMin} onChangeText={(value) => patch({ budgetMin: value })}
            style={[serviceStyles.input, { color: theme.text, borderColor: theme.border }]} />
          <TextInput accessibilityLabel="Maximum budget" placeholder="Maximum budget (optional)" keyboardType="decimal-pad"
            value={form.budgetMax} onChangeText={(value) => patch({ budgetMax: value })}
            style={[serviceStyles.input, { color: theme.text, borderColor: theme.border }]} />
          <TextInput accessibilityLabel="Budget currency" placeholder="Currency, e.g. USD" autoCapitalize="characters" maxLength={3}
            value={form.currencyCode} onChangeText={(value) => patch({ currencyCode: value })}
            style={[serviceStyles.input, { color: theme.text, borderColor: theme.border }]} />
          <TextInput accessibilityLabel="Preferred date" placeholder="Preferred date YYYY-MM-DD (optional)"
            value={form.preferredDate} onChangeText={(value) => patch({ preferredDate: value })}
            style={[serviceStyles.input, { color: theme.text, borderColor: theme.border }]} />
          <TextInput accessibilityLabel="Expiry date" placeholder="Expiry ISO date/time (optional)"
            value={form.expiresAt} onChangeText={(value) => patch({ expiresAt: value })}
            style={[serviceStyles.input, { color: theme.text, borderColor: theme.border }]} />
          <PrimaryButton label="Add request image" variant="secondary" onPress={() => void pickImage()} />
          <View style={styles.images}>{pendingImages.map((image, index) => (
            <Image key={image.uri} source={{ uri: image.uri }} style={styles.preview} accessibilityLabel={`Pending image ${index + 1}`} />
          ))}</View>
          {form.mediaIds.map((mediaId) => <Pressable key={mediaId} accessibilityRole="button" accessibilityLabel="Remove attached image"
            onPress={() => patch({ mediaIds: form.mediaIds.filter((item) => item !== mediaId) })}>
            <ThemedText type="small">Remove attached image {mediaId.slice(0, 8)}</ThemedText></Pressable>)}
          {error ? <ThemedText accessibilityRole="alert" style={{ color: BrandColors.error }}>{error}</ThemedText> : null}
          <PrimaryButton label={id ? "Save changes" : "Create draft request"} loading={saving} onPress={() => void save()} />
          <ThemedText type="small" themeColor="textSecondary">{publishedEdit
            ? "Safe edits do not use another SERVICE_JOB_POST quota unit."
            : "Draft creation is free. Publishing uses one SERVICE_JOB_POST quota unit."}</ThemedText>
        </ScrollView></KeyboardAvoidingView>}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = {
  categories: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: Spacing.two },
  category: { borderWidth: 1, borderRadius: BorderRadius.full, padding: Spacing.two },
  images: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: Spacing.two },
  preview: { width: 96, height: 96, borderRadius: BorderRadius.md },
};
