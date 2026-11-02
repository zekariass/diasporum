import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { safeBack } from "@/core/navigation/safe-back";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { ErrorState } from "@/shared/components/error-state";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { PrimaryButton } from "@/shared/components/primary-button";
import { BrandColors } from "@/shared/theme/colors";
import { Spacing } from "@/shared/theme/spacing";
import { VehicleForm } from "../components/vehicle-form";
import { createVehicleApi, uploadVehicleMedia } from "../services/vehicle-api";
import type { VehicleCategory, VehicleView } from "../types/vehicle-types";
import { vehicleErrorMessage } from "../utils/vehicle-error";
import {
  initialVehicleFormState,
  toVehicleRequest,
  validateVehicleForm,
  vehicleFormStateFromDetail,
  type VehicleFormState,
} from "../utils/vehicle-form";

export default function VehicleEditorScreen({ edit = false }: { edit?: boolean }) {
  const { id = "" } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { apiClient, session } = useSession();
  const api = useMemo(() => createVehicleApi(apiClient), [apiClient]);
  const [form, setForm] = useState<VehicleFormState>(() => initialVehicleFormState(session?.activeCommunityId ?? ""));
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [detail, setDetail] = useState<VehicleView | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(edit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const effectiveEdit = edit || createdId !== null;
  const category = categories.find((item) => item.category.id === form.categoryId);

  useEffect(() => {
    api.categories().then((result) => setCategories(result.items)).catch(() => setCategories([]));
  }, [api]);

  const load = useCallback(() => {
    if (!edit) return Promise.resolve();
    return api.detail(id)
      .then((result) => {
        setDetail(result);
        setForm(vehicleFormStateFromDetail(result));
        setLoadError(null);
      })
      .catch((cause: unknown) => setLoadError(vehicleErrorMessage(cause, "Failed to load vehicle.")))
      .finally(() => setLoading(false));
  }, [api, edit, id]);
  useEffect(() => { void load(); }, [load]);

  async function submit(draft: boolean) {
    if (saving) return;
    const publishing = !draft && (!edit || detail?.listing.status === "PUBLISHED");
    const validation = validateVehicleForm(form, publishing, new Date(), category);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError(null);
    const uploaded: string[] = [];
    let mediaCommitted = false;
    try {
      for (const item of form.media.filter((item) => item.selection)) {
        uploaded.push(await uploadVehicleMedia(apiClient, item.selection!));
      }
      const uploadedIterator = uploaded.values();
      const mediaIds = form.media.map((item) => item.selection ? uploadedIterator.next().value as string : item.id);
      const cover = form.media.find((item) => item.cover) ?? form.media[0];
      const coverMediaId = cover ? mediaIds[form.media.findIndex((item) => item.id === cover.id)] : undefined;
      const targetId = edit ? id : createdId;
      let result = targetId
        ? await api.update(targetId, toVehicleRequest(form, true, category))
        : await api.create(toVehicleRequest(form, false, category));
      if (!edit && !createdId) {
        setCreatedId(result.listing.id);
        setDetail(result);
      }
      result = await api.replaceMedia(result.listing.id, mediaIds, coverMediaId);
      mediaCommitted = true;
      setDetail(result);
      if (!draft && !edit) result = await api.publish(result.listing.id);
      router.replace(`/(app)/vehicles/${result.listing.id}` as never);
    } catch (cause) {
      if (!mediaCommitted) {
        await Promise.all(uploaded.map((mediaId) => apiClient
          .delete(`/api/v1/media/${mediaId}`, { authenticated: true })
          .catch(() => {})));
      }
      const message = vehicleErrorMessage(cause, "Could not save the vehicle.");
      setError(createdId || edit ? message : `${message} If a draft was created, it remains available in My vehicle listings.`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingScreen message="Loading vehicle…" />;
  if (loadError) return <ErrorState message={loadError} onRetry={load} />;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Pressable onPress={safeBack} accessibilityRole="button" accessibilityLabel="Go back"><Ionicons name="chevron-back" size={25} color={theme.text} /></Pressable>
          <ThemedText type="title" style={styles.headerTitle}>{effectiveEdit ? "Edit vehicle" : "Create vehicle"}</ThemedText>
          <View style={styles.headerSpacer} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">
          <VehicleForm state={form} editing={effectiveEdit}
            onChange={(patch) => setForm((previous) => ({ ...previous, ...patch }))} />
          {error ? <ThemedText style={styles.error} accessibilityRole="alert">{error}</ThemedText> : null}
          <View style={styles.actions}>
            {!effectiveEdit ? <PrimaryButton label="Save draft" variant="secondary" loading={saving}
              onPress={() => void submit(true)} style={styles.action} /> : null}
            <PrimaryButton label={edit ? "Save changes" : "Publish vehicle"} loading={saving}
              onPress={() => void submit(false)} style={styles.action} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.four, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 22 },
  headerSpacer: { width: 25 },
  error: { color: BrandColors.error, marginHorizontal: Spacing.four, padding: Spacing.three, textAlign: "center" },
  actions: { padding: Spacing.four, paddingBottom: Spacing.five, gap: Spacing.three, alignItems: "stretch" },
  action: { width: "100%" },
});
