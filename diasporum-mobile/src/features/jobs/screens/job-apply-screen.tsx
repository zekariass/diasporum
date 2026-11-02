import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ApiError } from "@/core/api/api-error";
import { safeBack } from "@/core/navigation/safe-back";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { ErrorState } from "@/shared/components/error-state";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { PrimaryButton } from "@/shared/components/primary-button";
import { createJobApi, uploadJobMedia } from "../services/job-api";
import type { JobDetail, MediaUploadSelection } from "../types/job-types";

const RESUME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
];

export default function JobApplyScreen() {
  const { id = "" } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = React.useMemo(() => createJobApi(apiClient), [apiClient]);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [coverLetter, setCoverLetter] = useState("");
  const [resume, setResume] = useState<MediaUploadSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => api.detail(id).then((result) => {
    setJob(result);
    setLoadError(null);
  }).catch((cause: unknown) => {
    setLoadError(ApiError.isApiError(cause) ? cause.userMessage : "Failed to load job.");
  }).finally(() => setLoading(false)), [api, id]);

  useEffect(() => { void load(); }, [load]);

  async function pickResume() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: RESUME_TYPES,
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const mimeType = asset.mimeType ?? (asset.name.toLowerCase().endsWith(".txt")
        ? "text/plain" : "application/pdf");
      if (!RESUME_TYPES.includes(mimeType)) {
        setError("Choose a PDF, DOC, DOCX, or plain-text résumé.");
        return;
      }
      setResume({ uri: asset.uri, mimeType, fileName: asset.name });
      setError(null);
    } catch {
      setError("Unable to open the document picker. Please try again.");
    }
  }

  async function submit() {
    if (submitting || !job) return;
    if (coverLetter.length > 12000) {
      setError("The cover letter must be 12,000 characters or fewer.");
      return;
    }
    setSubmitting(true);
    setError(null);
    let uploadedResume: string | null = null;
    try {
      if (resume) uploadedResume = await uploadJobMedia(apiClient, resume, "DOCUMENT");
      const result = await api.apply(id, {
        ...(coverLetter.trim() ? { coverLetter: coverLetter.trim() } : {}),
        ...(uploadedResume ? { resumeMediaId: uploadedResume } : {}),
      });
      router.replace(`/(app)/jobs/application/${result.application.id}` as never);
    } catch (cause) {
      if (uploadedResume) {
        void apiClient.delete(`/api/v1/media/${uploadedResume}`, { authenticated: true }).catch(() => {});
      }
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not submit your application.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingScreen message="Loading application…" />;
  if (loadError || !job) return <ErrorState message={loadError ?? "Job not found."} onRetry={load} />;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Pressable onPress={safeBack} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={25} color={theme.text} />
          </Pressable>
          <ThemedText type="title" style={styles.headerTitle}>Apply for job</ThemedText>
          <View style={styles.spacer} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <View style={[styles.summary, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="subtitle">{job.job.title}</ThemedText>
            <ThemedText themeColor="textSecondary">{job.job.employerName}</ThemedText>
          </View>
          <View style={styles.field}>
            <ThemedText style={styles.label}>Cover letter (optional)</ThemedText>
            <TextInput
              value={coverLetter}
              onChangeText={setCoverLetter}
              multiline
              maxLength={12000}
              textAlignVertical="top"
              placeholder="Introduce yourself and explain why you are a good fit."
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel="Cover letter"
              style={[styles.coverLetter, { color: theme.text, borderColor: theme.border,
                backgroundColor: theme.backgroundElement }]}
            />
            <ThemedText style={styles.counter} themeColor="textSecondary">
              {coverLetter.length}/12,000
            </ThemedText>
          </View>
          <View style={styles.field}>
            <ThemedText style={styles.label}>Résumé (optional)</ThemedText>
            <Pressable onPress={() => void pickResume()} accessibilityRole="button"
              accessibilityLabel={resume ? "Change résumé" : "Choose résumé"}
              style={[styles.resumePicker, { borderColor: theme.border,
                backgroundColor: theme.backgroundElement }]}>
              <Ionicons name="document-text-outline" size={25} color={BrandColors.primary} />
              <View style={styles.resumeCopy}>
                <ThemedText style={styles.resumeName} numberOfLines={1}>
                  {resume?.fileName ?? "Choose a document"}
                </ThemedText>
                <ThemedText style={styles.hint} themeColor="textSecondary">PDF, DOC, DOCX, or TXT</ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={19} color={theme.textSecondary} />
            </Pressable>
            {resume ? (
              <PrimaryButton label="Remove résumé" variant="ghost" onPress={() => setResume(null)} />
            ) : null}
          </View>
          <ThemedText style={styles.privacy} themeColor="textSecondary">
            Your cover letter and résumé are visible only to you and authorized hiring managers.
          </ThemedText>
          {error ? <ThemedText style={styles.error} accessibilityRole="alert">{error}</ThemedText> : null}
          <PrimaryButton label="Submit application" loading={submitting} onPress={() => void submit()} />
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
  spacer: { width: 25 },
  content: { padding: Spacing.four, gap: Spacing.four },
  summary: { borderRadius: BorderRadius.lg, padding: Spacing.four, gap: 4 },
  field: { gap: Spacing.two },
  label: { fontSize: 15, fontWeight: "700" },
  coverLetter: { minHeight: 190, borderWidth: 1, borderRadius: BorderRadius.lg,
    padding: Spacing.three, fontSize: 15, lineHeight: 22 },
  counter: { textAlign: "right", fontSize: 12 },
  resumePicker: { flexDirection: "row", alignItems: "center", borderWidth: 1,
    borderRadius: BorderRadius.lg, padding: Spacing.three, gap: Spacing.three },
  resumeCopy: { flex: 1 },
  resumeName: { fontSize: 15, fontWeight: "600" },
  hint: { fontSize: 12, marginTop: 3 },
  privacy: { fontSize: 13, lineHeight: 19, textAlign: "center" },
  error: { color: BrandColors.error, textAlign: "center" },
});
