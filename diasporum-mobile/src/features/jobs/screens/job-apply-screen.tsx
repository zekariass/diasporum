import React, { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ApiError } from "@/core/api/api-error";
import { safeBack } from "@/core/navigation/safe-back";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { ErrorState } from "@/shared/components/error-state";
import { Field } from "@/shared/components/form-controls";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { PrimaryButton } from "@/shared/components/primary-button";
import { createJobApi, uploadJobMedia } from "../services/job-api";
import type { JobDetail, MediaUploadSelection } from "../types/job-types";
import { formatLocation } from "../utils/job-format";

const RESUME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
];
const MAX_COVER_LETTER = 12000;

export default function JobApplyScreen() {
  const { id = "" } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
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
    if (coverLetter.length > MAX_COVER_LETTER) {
      setError(`The cover letter must be ${MAX_COVER_LETTER.toLocaleString()} characters or fewer.`);
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

  const location = formatLocation(job.location, job.job.workplaceType);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Pressable onPress={safeBack} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={8}>
            <Ionicons name="chevron-back" size={25} color={theme.text} />
          </Pressable>
          <ThemedText type="title" style={styles.headerTitle}>Apply for job</ThemedText>
          <View style={styles.spacer} />
        </View>
        <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <View style={[styles.summary, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
              <View style={[styles.summaryIcon, { backgroundColor: theme.primarySurface }]}>
                <Ionicons name="briefcase-outline" size={21} color={theme.primary} />
              </View>
              <View style={styles.summaryCopy}>
                <ThemedText type="small" themeColor="textSecondary">Applying for</ThemedText>
                <ThemedText type="smallBold" numberOfLines={2}>{job.job.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {job.job.employerName} · {location}
                </ThemedText>
              </View>
            </View>

            <Field label="Cover letter" hint="Optional — introduce yourself and explain why you are a good fit.">
              <TextInput
                value={coverLetter}
                onChangeText={setCoverLetter}
                multiline
                maxLength={MAX_COVER_LETTER}
                textAlignVertical="top"
                placeholder="Dear hiring team, …"
                placeholderTextColor={theme.textSecondary}
                accessibilityLabel="Cover letter"
                style={[styles.coverLetter, { color: theme.text, borderColor: theme.border,
                  backgroundColor: theme.backgroundElement }]}
              />
              <ThemedText style={styles.counter} themeColor="textSecondary">
                {coverLetter.length.toLocaleString()}/{MAX_COVER_LETTER.toLocaleString()}
              </ThemedText>
            </Field>

            <Field label="Résumé" hint="Optional — PDF, DOC, DOCX, or TXT.">
              <Pressable onPress={() => void pickResume()} accessibilityRole="button"
                accessibilityLabel={resume ? "Change résumé" : "Choose résumé"}
                style={[styles.resumePicker, { borderColor: resume ? theme.primary : theme.border,
                  backgroundColor: theme.backgroundElement }]}>
                <View style={[styles.resumeIcon, { backgroundColor: theme.primarySurface }]}>
                  <Ionicons name={resume ? "document-text" : "document-text-outline"} size={20} color={theme.primary} />
                </View>
                <View style={styles.resumeCopy}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {resume?.fileName ?? "Attach your résumé"}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {resume ? "Tap to choose a different file" : "PDF, DOC, DOCX, or TXT"}
                  </ThemedText>
                </View>
                {resume ? (
                  <Pressable onPress={() => setResume(null)} accessibilityRole="button"
                    accessibilityLabel="Remove résumé" hitSlop={8}>
                    <Ionicons name="close-circle" size={22} color={theme.textSecondary} />
                  </Pressable>
                ) : (
                  <Ionicons name="chevron-forward" size={19} color={theme.textSecondary} />
                )}
              </Pressable>
            </Field>

            <View style={[styles.privacy, { backgroundColor: theme.primarySurface }]}>
              <Ionicons name="shield-checkmark-outline" size={18} color={theme.primary} />
              <ThemedText type="small" style={styles.privacyText}>
                Your cover letter and résumé are visible only to you and authorized hiring managers.
              </ThemedText>
            </View>
          </ScrollView>
          {error ? (
            <ThemedText style={[styles.error, { color: theme.error }]} accessibilityRole="alert">{error}</ThemedText>
          ) : null}
          <View style={[styles.footer, { borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, Spacing.two) }]}>
            <PrimaryButton label="Submit application" loading={submitting} onPress={() => void submit()} />
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
  spacer: { width: 25 },
  content: { padding: Spacing.three, gap: Spacing.three },
  summary: { flexDirection: "row", alignItems: "center", gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: BorderRadius.lg, padding: Spacing.three },
  summaryIcon: { width: 44, height: 44, borderRadius: BorderRadius.md, alignItems: "center", justifyContent: "center" },
  summaryCopy: { flex: 1, minWidth: 0, gap: 2 },
  coverLetter: { minHeight: 200, borderWidth: 1, borderRadius: BorderRadius.md,
    padding: Spacing.three, fontSize: 15, lineHeight: 22 },
  counter: { textAlign: "right", fontSize: 12 },
  resumePicker: { flexDirection: "row", alignItems: "center", borderWidth: 1,
    borderRadius: BorderRadius.md, padding: Spacing.two, gap: Spacing.two },
  resumeIcon: { width: 42, height: 42, borderRadius: BorderRadius.md, alignItems: "center", justifyContent: "center" },
  resumeCopy: { flex: 1, minWidth: 0, gap: 2 },
  privacy: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.two,
    borderRadius: BorderRadius.md, padding: Spacing.three },
  privacyText: { flex: 1 },
  error: { fontSize: 13, lineHeight: 19, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, textAlign: "center" },
  footer: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
});
