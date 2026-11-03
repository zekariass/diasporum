import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
import type { ProviderInput, ServiceCategory } from "../types/service-marketplace-types";
import { LeadMarketplaceNotice, ScreenHeader, serviceStyles } from "../components/service-ui";

export interface ProviderFormState {
  businessAccountId: string;
  displayName: string;
  description: string;
  latitude: string;
  longitude: string;
  radiusKm: string;
  categoryIds: string[];
}

export function validateProviderForm(form: ProviderFormState): string | null {
  if (!form.displayName.trim()) return "Add a provider display name.";
  if (!form.categoryIds.length) return "Select at least one service category.";
  const latitude = Number(form.latitude);
  const longitude = Number(form.longitude);
  const radius = Number(form.radiusKm);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return "Use your current location or enter valid base coordinates.";
  }
  if (!Number.isFinite(radius) || radius < 1 || radius > 300) return "Radius must be between 1 and 300 km.";
  return null;
}

export function toProviderInput(form: ProviderFormState): ProviderInput {
  return {
    ...(form.businessAccountId.trim() ? { businessAccountId: form.businessAccountId.trim() } : {}),
    displayName: form.displayName.trim(),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    baseLatitude: Number(form.latitude), baseLongitude: Number(form.longitude),
    radiusKm: Number(form.radiusKm), categoryIds: form.categoryIds,
  };
}

export default function ProviderEditorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = useMemo(() => createServiceMarketplaceApi(apiClient), [apiClient]);
  const [form, setForm] = useState<ProviderFormState>({
    businessAccountId: "", displayName: "", description: "", latitude: "", longitude: "",
    radiusKm: "25", categoryIds: [],
  });
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.categories().then(setCategories).catch(() => setError("Could not load service categories."));
    if (id) {
      api.provider(id).then((provider) => {
        setForm({
          businessAccountId: provider.businessAccountId ?? "", displayName: provider.displayName,
          description: provider.description ?? "", latitude: String(provider.baseLatitude ?? ""),
          longitude: String(provider.baseLongitude ?? ""), radiusKm: String(provider.radiusKm ?? 25),
          categoryIds: provider.categories.map((item) => item.id),
        });
      }).catch((cause) => setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load provider."))
        .finally(() => setLoading(false));
    }
  }, [api, id]);

  function patch(value: Partial<ProviderFormState>) {
    setForm((current) => ({ ...current, ...value }));
  }

  async function pickCurrentLocation() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setError("Location permission was denied. Enter approximate base coordinates instead.");
      return;
    }
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      patch({ latitude: String(position.coords.latitude), longitude: String(position.coords.longitude) });
    } catch {
      setError("Location is unavailable. Enter approximate base coordinates.");
    }
  }

  async function save() {
    const validation = validateProviderForm(form);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input = toProviderInput(form);
      const provider = id ? await api.updateProvider(id, input) : await api.createProvider(input);
      router.replace(`/(app)/services/providers/${provider.id}` as never);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not save the provider profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ThemedView style={serviceStyles.root}>
      <SafeAreaView style={serviceStyles.root} edges={["top", "left", "right"]}>
        <ScreenHeader back title={id ? "Edit provider profile" : "Offer services"} />
        {loading ? <LoadingScreen /> : (
          <ScrollView contentContainerStyle={serviceStyles.content} keyboardShouldPersistTaps="handled">
            <LeadMarketplaceNotice />
            {!id ? <TextInput accessibilityLabel="Business account ID" placeholder="Business account ID (optional; blank for personal)"
              autoCapitalize="none" value={form.businessAccountId} onChangeText={(value) => patch({ businessAccountId: value })}
              style={[serviceStyles.input, { color: theme.text, borderColor: theme.border }]} /> : null}
            <TextInput accessibilityLabel="Provider display name" placeholder="Provider display name" value={form.displayName}
              onChangeText={(value) => patch({ displayName: value })} maxLength={120}
              style={[serviceStyles.input, { color: theme.text, borderColor: theme.border }]} />
            <TextInput accessibilityLabel="Provider description" placeholder="Services, experience, and working hours"
              value={form.description} onChangeText={(value) => patch({ description: value })} multiline maxLength={4000}
              style={[serviceStyles.input, serviceStyles.multiline, { color: theme.text, borderColor: theme.border }]} />
            <ThemedText type="smallBold">Service categories</ThemedText>
            <View style={styles.categories}>
              {categories.map((category) => {
                const selected = form.categoryIds.includes(category.id);
                return <Pressable key={category.id} accessibilityRole="button" accessibilityState={{ selected }}
                  onPress={() => patch({ categoryIds: selected
                    ? form.categoryIds.filter((item) => item !== category.id) : [...form.categoryIds, category.id] })}
                  style={[styles.category, { borderColor: selected ? BrandColors.primary : theme.border }]}>
                  <ThemedText type="small">{category.displayName}</ThemedText></Pressable>;
              })}
            </View>
            <PrimaryButton label="Use current location" variant="secondary" onPress={() => void pickCurrentLocation()} />
            <TextInput accessibilityLabel="Base latitude" placeholder="Approximate base latitude" keyboardType="decimal-pad"
              value={form.latitude} onChangeText={(value) => patch({ latitude: value })}
              style={[serviceStyles.input, { color: theme.text, borderColor: theme.border }]} />
            <TextInput accessibilityLabel="Base longitude" placeholder="Approximate base longitude" keyboardType="decimal-pad"
              value={form.longitude} onChangeText={(value) => patch({ longitude: value })}
              style={[serviceStyles.input, { color: theme.text, borderColor: theme.border }]} />
            <TextInput accessibilityLabel="Service radius" placeholder="Service radius in km (1–300)" keyboardType="decimal-pad"
              value={form.radiusKm} onChangeText={(value) => patch({ radiusKm: value })}
              style={[serviceStyles.input, { color: theme.text, borderColor: theme.border }]} />
            {error ? <ThemedText accessibilityRole="alert" style={{ color: BrandColors.error }}>{error}</ThemedText> : null}
            <PrimaryButton label={id ? "Save provider profile" : "Create provider profile"} loading={saving} onPress={() => void save()} />
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = {
  categories: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: Spacing.two },
  category: { borderWidth: 1, borderRadius: BorderRadius.full, padding: Spacing.two },
};
