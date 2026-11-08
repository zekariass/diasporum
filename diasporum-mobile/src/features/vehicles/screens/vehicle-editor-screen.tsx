import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
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
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { VehicleForm } from "../components/vehicle-form";
import { createVehicleApi, uploadVehicleMedia } from "../services/vehicle-api";
import type { VehicleCategory, VehicleView } from "../types/vehicle-types";
import { vehicleErrorMessage } from "../utils/vehicle-error";
import {
  VEHICLE_STEP_TITLES,
  initialVehicleFormState,
  toVehicleRequest,
  validateVehicleForm,
  validateVehicleStep,
  vehicleFormStateFromDetail,
  type VehicleFormState,
} from "../utils/vehicle-form";

export default function VehicleEditorScreen({
  edit = false,
}: {
  edit?: boolean;
}) {
  const {
    id = "",
    businessAccountId = "",
    businessListingId = "",
  } = useLocalSearchParams<{
    id?: string;
    businessAccountId?: string;
    businessListingId?: string;
  }>();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { apiClient, session } = useSession();
  const api = useMemo(() => createVehicleApi(apiClient), [apiClient]);
  const [form, setForm] = useState<VehicleFormState>(() => ({
    ...initialVehicleFormState(session?.activeCommunityId ?? ""),
    businessAccountId: businessAccountId || null,
    businessListingId: businessAccountId ? businessListingId || null : null,
  }));
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [detail, setDetail] = useState<VehicleView | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(edit);
  const [savingMode, setSavingMode] = useState<"draft" | "publish" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const saving = savingMode !== null;
  const effectiveEdit = edit || createdId !== null;
  const lastStep = VEHICLE_STEP_TITLES.length - 1;
  const category = categories.find(
    (item) => item.category.id === form.categoryId,
  );

  useEffect(() => {
    api
      .categories()
      .then((result) => setCategories(result.items))
      .catch(() => setCategories([]));
  }, [api]);

  const load = useCallback(() => {
    if (!edit) return Promise.resolve();
    return api
      .detail(id)
      .then((result) => {
        setDetail(result);
        setForm(vehicleFormStateFromDetail(result));
        setLoadError(null);
      })
      .catch((cause: unknown) =>
        setLoadError(vehicleErrorMessage(cause, "Failed to load vehicle.")),
      )
      .finally(() => setLoading(false));
  }, [api, edit, id]);
  useEffect(() => {
    void load();
  }, [load]);

  const onChange = useCallback((patch: Partial<VehicleFormState>) => {
    setForm((previous) => ({ ...previous, ...patch }));
    setError(null);
  }, []);

  const advance = useCallback(() => {
    const message = validateVehicleStep(form, step, true, new Date(), category);
    setError(message);
    if (!message) setStep((current) => Math.min(current + 1, lastStep));
  }, [category, form, lastStep, step]);

  const back = useCallback(() => {
    setError(null);
    setStep((current) => Math.max(0, current - 1));
  }, []);

  async function submit(draft: boolean) {
    if (saving) return;
    const publishing =
      !draft && (!edit || detail?.listing.status === "PUBLISHED");
    const now = new Date();
    const validation = validateVehicleForm(form, publishing, now, category);
    if (validation) {
      const errorStep = VEHICLE_STEP_TITLES.slice(0, -1).findIndex(
        (_, index) =>
          validateVehicleStep(form, index, publishing, now, category) !== null,
      );
      setStep(errorStep >= 0 ? errorStep : lastStep);
      setError(validation);
      return;
    }
    setSavingMode(draft ? "draft" : "publish");
    setError(null);
    const uploaded: string[] = [];
    let mediaCommitted = false;
    try {
      for (const item of form.media.filter((item) => item.selection)) {
        uploaded.push(await uploadVehicleMedia(apiClient, item.selection!));
      }
      const uploadedIterator = uploaded.values();
      const mediaIds = form.media.map((item) =>
        item.selection ? (uploadedIterator.next().value as string) : item.id,
      );
      const cover = form.media.find((item) => item.cover) ?? form.media[0];
      const coverMediaId = cover
        ? mediaIds[form.media.findIndex((item) => item.id === cover.id)]
        : undefined;
      const targetId = edit ? id : createdId;
      let result = targetId
        ? await api.update(targetId, toVehicleRequest(form, true, category))
        : await api.create(toVehicleRequest(form, false, category));
      if (!edit && !createdId) {
        setCreatedId(result.listing.id);
        setDetail(result);
      }
      result = await api.replaceMedia(
        result.listing.id,
        mediaIds,
        coverMediaId,
      );
      mediaCommitted = true;
      setDetail(result);
      if (!draft && !edit) result = await api.publish(result.listing.id);
      router.replace(`/(app)/vehicles/${result.listing.id}` as never);
    } catch (cause) {
      if (!mediaCommitted) {
        await Promise.all(
          uploaded.map((mediaId) =>
            apiClient
              .delete(`/api/v1/media/${mediaId}`, { authenticated: true })
              .catch(() => {}),
          ),
        );
      }
      const message = vehicleErrorMessage(cause, "Could not save the vehicle.");
      setError(
        createdId || edit
          ? message
          : `${message} If a draft was created, it remains available in My vehicle listings.`,
      );
    } finally {
      setSavingMode(null);
    }
  }

  if (loading) return <LoadingScreen message="Loading vehicle…" />;
  if (loadError) return <ErrorState message={loadError} onRetry={load} />;

  return (
    <ThemedView
      style={[styles.root, { backgroundColor: theme.backgroundElement }]}
    >
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View
          style={[
            styles.header,
            {
              borderBottomColor: theme.border,
              backgroundColor: theme.background,
            },
          ]}
        >
          <Pressable
            onPress={safeBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
            style={styles.headerButton}
          >
            <Ionicons name="chevron-back" size={24} color={theme.text} />
          </Pressable>
          <View style={styles.headerHeading}>
            <ThemedText type="title" style={styles.headerTitle}>
              {effectiveEdit ? "Edit vehicle" : "Create vehicle"}
            </ThemedText>
            <ThemedText
              themeColor="textSecondary"
              style={styles.headerSubtitle}
            >
              {VEHICLE_STEP_TITLES[step]}
            </ThemedText>
          </View>
          <View style={styles.headerButton}>
            <Ionicons
              name="car-sport-outline"
              size={22}
              color={theme.primary}
            />
          </View>
        </View>
        <KeyboardAvoidingView
          style={styles.keyboard}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View
            style={[
              styles.progress,
              {
                backgroundColor: theme.background,
                borderBottomColor: theme.border,
              },
            ]}
          >
            <View style={styles.progressRow}>
              <ThemedText
                style={[styles.stepCaption, { color: theme.primary }]}
              >
                Step {step + 1} of {VEHICLE_STEP_TITLES.length}
              </ThemedText>
              <ThemedText
                themeColor="textSecondary"
                style={styles.progressLabel}
              >
                {Math.round(((step + 1) / VEHICLE_STEP_TITLES.length) * 100)}%
                complete
              </ThemedText>
            </View>
            <View
              style={styles.progressTrack}
              accessibilityLabel={`Listing progress: step ${step + 1} of ${VEHICLE_STEP_TITLES.length}`}
            >
              {VEHICLE_STEP_TITLES.map((title, index) => (
                <View
                  key={title}
                  style={[
                    styles.progressSegment,
                    {
                      backgroundColor:
                        index <= step
                          ? theme.primary
                          : theme.backgroundSelected,
                    },
                  ]}
                />
              ))}
            </View>
          </View>
          <VehicleForm
            state={form}
            editing={effectiveEdit}
            step={step}
            onChange={onChange}
          />
          <View
            style={[
              styles.footer,
              {
                backgroundColor: theme.background,
                borderTopColor: theme.border,
                paddingBottom: Math.max(insets.bottom, Spacing.two),
              },
            ]}
          >
            {error ? (
              <View
                style={[
                  styles.errorBanner,
                  { backgroundColor: theme.errorSurface },
                ]}
                accessibilityRole="alert"
              >
                <Ionicons name="alert-circle" size={19} color={theme.error} />
                <ThemedText style={[styles.error, { color: theme.error }]}>
                  {error}
                </ThemedText>
              </View>
            ) : null}
            <View style={styles.actions}>
              {step > 0 ? (
                <Pressable
                  onPress={back}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel="Previous step"
                  accessibilityState={{ disabled: saving }}
                  style={({ pressed }) => [
                    styles.backButton,
                    {
                      borderColor: theme.border,
                      backgroundColor: theme.background,
                    },
                    pressed && { opacity: 0.7 },
                    saving && { opacity: 0.5 },
                  ]}
                >
                  <Ionicons name="chevron-back" size={18} color={theme.text} />
                  <ThemedText style={styles.backLabel}>Back</ThemedText>
                </Pressable>
              ) : null}
              <PrimaryButton
                label={
                  step < lastStep
                    ? "Continue"
                    : edit
                      ? "Save changes"
                      : "Publish vehicle"
                }
                loading={step === lastStep && savingMode === "publish"}
                disabled={saving}
                onPress={step < lastStep ? advance : () => void submit(false)}
                style={styles.primaryAction}
              />
            </View>
            {!effectiveEdit ? (
              <PrimaryButton
                label="Save draft"
                variant="ghost"
                loading={savingMode === "draft"}
                disabled={saving}
                onPress={() => void submit(true)}
                style={styles.secondaryAction}
              />
            ) : edit && step < lastStep ? (
              <PrimaryButton
                label="Save changes"
                variant="ghost"
                loading={savingMode === "publish"}
                disabled={saving}
                onPress={() => void submit(false)}
                style={styles.secondaryAction}
              />
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  keyboard: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    width: 32,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerHeading: { flex: 1, alignItems: "center", gap: 1 },
  headerTitle: { fontSize: 18, lineHeight: 24 },
  headerSubtitle: { fontSize: 11, lineHeight: 15 },
  progress: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  stepCaption: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  progressLabel: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
  progressTrack: { flexDirection: "row", gap: 6 },
  progressSegment: { flex: 1, height: 4, borderRadius: BorderRadius.full },
  footer: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.one,
  },
  actions: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  primaryAction: { flex: 1, minWidth: 0, borderRadius: BorderRadius.md },
  secondaryAction: {
    width: "100%",
    minHeight: 42,
    paddingVertical: Spacing.two,
  },
  backButton: {
    minWidth: 88,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.half,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.two,
  },
  backLabel: { fontSize: 14, fontWeight: "700" },
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
    borderRadius: BorderRadius.md,
    padding: Spacing.two,
    marginBottom: Spacing.one,
  },
  error: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "600" },
});
