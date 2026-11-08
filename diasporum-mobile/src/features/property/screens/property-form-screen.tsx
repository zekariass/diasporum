import React, { useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { ErrorState } from "@/shared/components/error-state";
import { ApiError } from "@/core/api/api-error";
import { useSession } from "@/core/session/session-provider";
import { createBusinessApi } from "@/features/business/services/business-api";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createPropertyApi } from "../services/property-api";
import { uploadPropertyImage } from "../services/property-media";
import type { PropertyDetail } from "../types/property-types";
import { PropertyForm } from "../components/property-form";
import { PropertyMediaManager } from "../components/property-media-manager";
import { ActionButton, PropertyScreen } from "../components/property-controls";
import {
  PROPERTY_STEP_TITLES,
  initialPropertyForm,
  propertyCommandFromForm,
  propertyFormFromDetail,
  validatePropertyForm,
  validatePropertyStep,
  type PropertyFormState,
} from "../utils/property-form-state";

export default function PropertyFormScreen() {
  const { id, businessAccountId, businessListingId } = useLocalSearchParams<{
    id?: string;
    businessAccountId?: string;
    businessListingId?: string;
  }>();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { apiClient, session } = useSession();
  const api = React.useMemo(() => createPropertyApi(apiClient), [apiClient]);
  const countryId = session?.profile?.currentCountryId ?? "";
  const [form, setForm] = useState<PropertyFormState>(() => ({
    ...initialPropertyForm(countryId, session?.activeCommunityId ?? undefined),
    businessAccountId: businessAccountId || undefined,
    businessListingId: businessAccountId
      ? businessListingId || undefined
      : undefined,
  }));
  const [detail, setDetail] = useState<PropertyDetail | null>(null);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(Boolean(id));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitMode, setSubmitMode] = useState<"draft" | "review" | null>(null);
  const submitting = submitMode !== null;
  const [error, setError] = useState<string | null>(null);
  const lastStep = PROPERTY_STEP_TITLES.length - 1;

  const load = useCallback(() => {
    if (!id) return Promise.resolve();
    return api
      .detail(id)
      .then((result) => {
        setDetail(result);
        setForm(propertyFormFromDetail(result));
        setLoadError(null);
      })
      .catch((cause: unknown) => {
        setLoadError(
          ApiError.isApiError(cause)
            ? cause.userMessage
            : "Could not load the property draft.",
        );
      })
      .finally(() => setLoading(false));
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onChange = useCallback((patch: Partial<PropertyFormState>) => {
    setForm((previous) => ({ ...previous, ...patch }));
  }, []);

  const advance = useCallback(() => {
    const message = validatePropertyStep(form, step);
    setError(message);
    if (!message) setStep((current) => Math.min(current + 1, lastStep));
  }, [form, step, lastStep]);

  const back = useCallback(() => {
    setError(null);
    setStep((current) => Math.max(0, current - 1));
  }, []);

  const submit = useCallback(
    async (review: boolean) => {
      if (submitting) return;
      const validation = validatePropertyForm(form);
      if (validation) {
        setError(validation);
        return;
      }
      setSubmitMode(review ? "review" : "draft");
      setError(null);
      try {
        if (form.businessAccountId) {
          const workspace = await createBusinessApi(apiClient).workspace(
            form.businessAccountId,
          );
          if (
            workspace.status !== "ACTIVE" ||
            !workspace.capabilities.manageListings
          ) {
            setError(
              "This business account no longer grants property listing management.",
            );
            return;
          }
        }
        const command = propertyCommandFromForm(form);
        let saved = id
          ? await api.update(id, command)
          : await api.create(command);
        for (const image of form.images) {
          const mediaId = await uploadPropertyImage(apiClient, image);
          saved = await api.attachMedia(saved.item.property.id, mediaId);
        }
        setDetail(saved);
        setForm((previous) => ({ ...previous, images: [] }));
        if (review)
          router.replace(
            `/(app)/properties/${saved.item.property.id}` as never,
          );
        else
          router.replace(
            id
              ? (`/(app)/properties/${id}` as never)
              : ("/(app)/properties/my" as never),
          );
      } catch (cause) {
        setError(
          ApiError.isApiError(cause)
            ? cause.userMessage
            : "Could not save the property. Please try again.",
        );
      } finally {
        setSubmitMode(null);
      }
    },
    [api, apiClient, form, id, router, submitting],
  );

  if (loading) return <LoadingScreen />;
  if (loadError) return <ErrorState message={loadError} onRetry={load} />;

  const mediaSlot =
    id && detail && detail.item.property.status !== "CLOSED" ? (
      <PropertyMediaManager detail={detail} onChange={setDetail} />
    ) : null;

  const previousButton =
    step > 0 ? (
      <Pressable
        onPress={back}
        disabled={submitting}
        accessibilityRole="button"
        accessibilityLabel="Previous step"
        accessibilityState={{ disabled: submitting }}
        style={({ pressed }) => [
          styles.backButton,
          { borderColor: theme.border, backgroundColor: theme.background },
          pressed && { opacity: 0.7 },
          submitting && { opacity: 0.5 },
        ]}
      >
        <Ionicons name="chevron-back" size={17} color={theme.text} />
        <ThemedText style={styles.backLabel}>Back</ThemedText>
      </Pressable>
    ) : null;

  return (
    <PropertyScreen title={id ? "Edit property" : "Create property"}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={[styles.progress, { backgroundColor: theme.background }]}>
          <View style={styles.progressRow}>
            <ThemedText style={[styles.stepCaption, { color: theme.primary }]}>
              Step {step + 1} of {PROPERTY_STEP_TITLES.length}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.progressLabel}>
              {Math.round(((step + 1) / PROPERTY_STEP_TITLES.length) * 100)}%
              complete
            </ThemedText>
          </View>
          <View
            style={styles.progressTrack}
            accessibilityLabel={`Listing progress: step ${step + 1} of ${PROPERTY_STEP_TITLES.length}`}
          >
            {PROPERTY_STEP_TITLES.map((title, index) => (
              <View
                key={title}
                style={[
                  styles.progressSegment,
                  {
                    backgroundColor:
                      index <= step ? theme.primary : theme.backgroundSelected,
                  },
                ]}
              />
            ))}
          </View>
        </View>
        <View style={styles.form}>
          <PropertyForm
            state={form}
            onChange={onChange}
            existingMediaCount={detail?.media.length ?? 0}
            step={step}
            mediaSlot={mediaSlot}
          />
        </View>
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
          {step === lastStep ? (
            <View
              style={[
                styles.noteCard,
                { backgroundColor: theme.primarySurface },
              ]}
            >
              <Ionicons
                name="eye-off-outline"
                size={17}
                color={theme.primary}
              />
              <ThemedText style={styles.note}>
                Nothing is published yet. Review your listing before publishing.
              </ThemedText>
            </View>
          ) : null}
          {step < lastStep ? (
            <View style={styles.actions}>
              {previousButton}
              <View style={styles.actionGrow}>
                <ActionButton
                  label="Continue"
                  onPress={advance}
                  icon="arrow-forward"
                />
              </View>
            </View>
          ) : (
            <View style={styles.finalActions}>
              <ActionButton
                label="Review listing"
                onPress={() => void submit(true)}
                loading={submitMode === "review"}
                disabled={submitting}
                icon="arrow-forward"
              />
              <View style={styles.actions}>
                {previousButton}
                <View style={styles.actionGrow}>
                  <ActionButton
                    label={id ? "Save changes" : "Save draft"}
                    onPress={() => void submit(false)}
                    loading={submitMode === "draft"}
                    disabled={submitting}
                    variant="secondary"
                    icon="checkmark"
                  />
                </View>
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </PropertyScreen>
  );
}

const styles = StyleSheet.create({
  keyboard: { flex: 1 },
  progress: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
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
  form: { flex: 1 },
  footer: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.three,
  },
  actions: { flexDirection: "row", alignItems: "center", gap: Spacing.three },
  finalActions: { gap: Spacing.three },
  backButton: {
    minWidth: 92,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.half,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.three,
  },
  backLabel: { fontSize: 14, fontWeight: "700" },
  actionGrow: { flex: 1 },
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
    borderRadius: BorderRadius.md,
    padding: Spacing.three,
  },
  error: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: "600" },
  noteCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  note: { flex: 1, fontSize: 12, lineHeight: 17 },
});
