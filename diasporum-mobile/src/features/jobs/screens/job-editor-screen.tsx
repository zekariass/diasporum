import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ApiError } from "@/core/api/api-error";
import { safeBack } from "@/core/navigation/safe-back";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { Spacing } from "@/shared/theme/spacing";
import { ErrorState } from "@/shared/components/error-state";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { PrimaryButton } from "@/shared/components/primary-button";
import {
  initialJobFormState,
  JobForm,
  jobFormStateFromDetail,
  toCreateJobRequest,
  toUpdateJobRequest,
  validateJobForm,
  type JobFormState,
} from "../components/job-form";
import { createJobApi, uploadJobMedia } from "../services/job-api";
import type { JobDetail } from "../types/job-types";

export default function JobEditorScreen({ edit = false }: { edit?: boolean }) {
  const { id = "" } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { apiClient, session } = useSession();
  const api = React.useMemo(() => createJobApi(apiClient), [apiClient]);
  const [form, setForm] = useState<JobFormState>(() =>
    initialJobFormState(session?.activeCommunityId ?? ""),
  );
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(edit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  async function submit(draft: boolean) {
    if (saving) return;
    const publishing = edit ? detail?.job.status === "PUBLISHED" : !draft;
    const validation = validateJobForm(form, publishing);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
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
      setSaving(false);
    }
  }

  if (loading) return <LoadingScreen message="Loading job…" />;
  if (loadError) return <ErrorState message={loadError} onRetry={load} />;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Pressable onPress={safeBack} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={25} color={theme.text} />
          </Pressable>
          <ThemedText type="title" style={styles.headerTitle}>
            {edit ? "Edit job" : "Create job"}
          </ThemedText>
          <View style={styles.headerSpacer} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">
          <JobForm
            state={form}
            onChange={(patch) => setForm((previous) => ({ ...previous, ...patch }))}
            editingPublished={edit && detail?.job.status === "PUBLISHED"}
          />
          {error ? (
            <ThemedText style={styles.error} accessibilityRole="alert">{error}</ThemedText>
          ) : null}
          <View style={styles.actions}>
            {!edit ? (
              <PrimaryButton label="Save draft" variant="secondary" loading={saving}
                onPress={() => void submit(true)} style={styles.action} />
            ) : null}
            <PrimaryButton
              label={edit ? "Save changes" : "Publish job"}
              loading={saving}
              onPress={() => void submit(false)}
              style={styles.action}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: Spacing.four, paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 22 },
  headerSpacer: { width: 25 },
  error: { color: BrandColors.error, marginHorizontal: Spacing.four,
    padding: Spacing.three, textAlign: "center" },
  actions: { padding: Spacing.four, paddingBottom: Spacing.five, gap: Spacing.three,
    alignItems: "stretch" },
  action: { width: "100%" },
});
