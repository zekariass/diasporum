import React, { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ApiError } from "@/core/api/api-error";
import { safeBack } from "@/core/navigation/safe-back";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { ErrorState } from "@/shared/components/error-state";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { PrimaryButton } from "@/shared/components/primary-button";
import { StepProgress } from "@/shared/components/form-controls";
import { Spacing } from "@/shared/theme/spacing";
import { JobForm } from "../components/job-form";
import { createJobApi, uploadJobMedia } from "../services/job-api";
import type { JobDetail } from "../types/job-types";
import {
  initialJobFormState,
  JOB_STEP_TITLES,
  jobFormStateFromDetail,
  toCreateJobRequest,
  toUpdateJobRequest,
  validateJobForm,
  validateJobStep,
  type JobFormState,
} from "../utils/job-form-state";

export default function JobEditorScreen({ edit = false }: { edit?: boolean }) {
  const { id = "" } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { apiClient, session } = useSession();
  const api = React.useMemo(() => createJobApi(apiClient), [apiClient]);
  const [form, setForm] = useState<JobFormState>(() =>
    initialJobFormState(session?.activeCommunityId ?? ""),
  );
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(edit);
  const [saving, setSaving] = useState<"draft" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastStep = JOB_STEP_TITLES.length - 1;

  const load = useCallback(() => {
    if (!edit) return Promise.resolve();
    return api.detail(id)
      .then((result) => {
        setDetail(result);
        setForm(jobFormStateFromDetail(result));
        setLoadError(null);
      })
      .catch((cause: unknown) => {
        setLoadError(ApiError.isApiError(cause) ? cause.userMessage : "Failed to load job.");
      })
      .finally(() => setLoading(false));
  }, [api, edit, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onChange = useCallback((patch: Partial<JobFormState>) => {
    setError(null);
    setForm((previous) => ({ ...previous, ...patch }));
  }, []);

  const advance = useCallback(() => {
    const message = validateJobStep(form, step);
    setError(message);
    if (!message) setStep((current) => Math.min(current + 1, lastStep));
  }, [form, step, lastStep]);

  const back = useCallback(() => {
    setError(null);
    setStep((current) => Math.max(0, current - 1));
  }, []);

  async function submit(draft: boolean) {
    if (saving) return;
    const publishing = edit ? detail?.job.status === "PUBLISHED" : !draft;
    const validation = validateJobForm(form, publishing);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(draft ? "draft" : "publish");
    setError(null);
    try {
      const uploaded = form.image
        ? await uploadJobMedia(apiClient, form.image, "JOB")
        : null;
      const mediaIds = uploaded ? [...form.mediaIds, uploaded] : form.mediaIds;
      const result = edit
        ? await api.update(id, toUpdateJobRequest(form, detail?.job.status === "PUBLISHED", mediaIds))
        : await api.create(toCreateJobRequest(form, draft, mediaIds));
      router.replace(`/(app)/jobs/${result.job.id}` as never);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not save the job.");
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <LoadingScreen message="Loading job…" />;
  if (loadError) return <ErrorState message={loadError} onRetry={load} />;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Pressable onPress={safeBack} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={8}>
            <Ionicons name="chevron-back" size={25} color={theme.text} />
          </Pressable>
          <ThemedText type="title" style={styles.headerTitle}>
            {edit ? "Edit job" : "Create job"}
          </ThemedText>
          <View style={styles.headerSpacer} />
        </View>
        <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.progress}>
            <StepProgress step={step} titles={JOB_STEP_TITLES} />
          </View>
          <JobForm
            state={form}
            onChange={onChange}
            step={step}
            editingPublished={edit && detail?.job.status === "PUBLISHED"}
            lockOwnership={edit}
          />
          {error ? (
            <ThemedText style={[styles.error, { color: theme.error }]} accessibilityRole="alert">{error}</ThemedText>
          ) : null}
          <View style={[styles.footer, { borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, Spacing.two) }]}>
            <View style={styles.actions}>
              {step > 0 ? (
                <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Previous step" style={[styles.backButton, { borderColor: theme.border }]}>
                  <Ionicons name="chevron-back" size={16} color={theme.text} />
                  <ThemedText style={styles.backLabel}>Back</ThemedText>
                </Pressable>
              ) : null}
              {step < lastStep ? (
                <View style={styles.actionGrow}>
                  <PrimaryButton label="Continue" onPress={advance} />
                </View>
              ) : edit ? (
                <View style={styles.actionGrow}>
                  <PrimaryButton label="Save changes" loading={saving === "publish"} disabled={saving !== null} onPress={() => void submit(false)} style={styles.actionButton} />
                </View>
              ) : (
                <>
                  <View style={styles.actionGrow}>
                    <PrimaryButton label="Save draft" variant="secondary" loading={saving === "draft"} disabled={saving !== null} onPress={() => void submit(true)} style={styles.actionButton} />
                  </View>
                  <View style={styles.actionGrow}>
                    <PrimaryButton label="Publish job" loading={saving === "publish"} disabled={saving !== null} onPress={() => void submit(false)} style={styles.actionButton} />
                  </View>
                </>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  keyboard: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: Spacing.four, paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 22 },
  headerSpacer: { width: 25 },
  progress: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.one },
  error: { fontSize: 13, lineHeight: 19, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, textAlign: "center" },
  footer: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
  actions: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  backButton: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.two },
  backLabel: { fontSize: 14, fontWeight: "600" },
  actionGrow: { flex: 1 },
  actionButton: { minWidth: 0, paddingHorizontal: Spacing.two },
});
