import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { ErrorState } from "@/shared/components/error-state";
import { ApiError } from "@/core/api/api-error";
import { useSession } from "@/core/session/session-provider";
import { createBusinessApi } from "@/features/business/services/business-api";
import { BrandColors } from "@/shared/theme/colors";
import { Spacing } from "@/shared/theme/spacing";
import { createPropertyApi } from "../services/property-api";
import { uploadPropertyImage } from "../services/property-media";
import type { PropertyDetail } from "../types/property-types";
import { PropertyForm } from "../components/property-form";
import { PropertyMediaManager } from "../components/property-media-manager";
import { ActionButton, PropertyScreen } from "../components/property-controls";
import { initialPropertyForm, propertyCommandFromForm, propertyFormFromDetail, validatePropertyForm, type PropertyFormState } from "../utils/property-form-state";

export default function PropertyFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { apiClient, session } = useSession();
  const api = React.useMemo(() => createPropertyApi(apiClient), [apiClient]);
  const countryId = session?.profile?.currentCountryId ?? "";
  const [form, setForm] = useState<PropertyFormState>(() => initialPropertyForm(countryId, session?.activeCommunityId ?? undefined));
  const [detail, setDetail] = useState<PropertyDetail | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return Promise.resolve();
    return api.detail(id).then((result) => {
      setDetail(result);
      setForm(propertyFormFromDetail(result));
      setLoadError(null);
    }).catch((cause: unknown) => {
      setLoadError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load the property draft.");
    }).finally(() => setLoading(false));
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onChange = useCallback((patch: Partial<PropertyFormState>) => {
    setForm((previous) => ({ ...previous, ...patch }));
  }, []);

  const submit = useCallback(async (review: boolean) => {
    if (submitting) return;
    const validation = validatePropertyForm(form);
    if (validation) {
      setError(validation);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (form.businessAccountId) {
        const workspace = await createBusinessApi(apiClient).workspace(form.businessAccountId);
        if (workspace.status !== "ACTIVE" || !workspace.capabilities.manageListings) {
          setError("This business account no longer grants property listing management.");
          return;
        }
      }
      const command = propertyCommandFromForm(form);
      let saved = id ? await api.update(id, command) : await api.create(command);
      for (const image of form.images) {
        const mediaId = await uploadPropertyImage(apiClient, image);
        saved = await api.attachMedia(saved.item.property.id, mediaId);
      }
      setDetail(saved);
      setForm((previous) => ({ ...previous, images: [] }));
      if (review) router.replace(`/(app)/properties/${saved.item.property.id}` as never);
      else router.replace(id ? `/(app)/properties/${id}` as never : "/(app)/properties/my" as never);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not save the property. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [api, apiClient, form, id, router, submitting]);

  if (loading) return <LoadingScreen />;
  if (loadError) return <ErrorState message={loadError} onRetry={load} />;

  return (
    <PropertyScreen title={id ? "Edit property" : "Create property"}>
      <View style={styles.form}><PropertyForm state={form} onChange={onChange} existingMediaCount={detail?.media.length ?? 0} /></View>
      {id && detail && detail.item.property.status !== "CLOSED" ? <PropertyMediaManager detail={detail} onChange={setDetail} /> : null}
      {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
      <View style={styles.actions}>
        <ActionButton label={id ? "Save changes" : "Save draft"} onPress={() => void submit(false)} loading={submitting} />
        <ActionButton label="Review listing" onPress={() => void submit(true)} disabled={submitting} />
      </View>
      <ThemedText style={styles.note}>Review the saved draft, then publish it from the property details screen. Publishing requires at least one uploaded photo.</ThemedText>
    </PropertyScreen>
  );
}

const styles = StyleSheet.create({
  form: { flex: 1 },
  actions: { flexDirection: "row", gap: Spacing.two, paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  error: { color: BrandColors.error, fontSize: 13, lineHeight: 19, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  note: { fontSize: 12, lineHeight: 18, textAlign: "center", paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
});
