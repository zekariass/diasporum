import React, { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
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
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { ErrorState } from "@/shared/components/error-state";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { PrimaryButton } from "@/shared/components/primary-button";
import { createJobApi } from "../services/job-api";
import type { ApplicationStatus, JobApplication } from "../types/job-types";
import { canTransitionApplication, formatLocation, label } from "../utils/job-format";

const STATUS_ACTIONS = [
  { status: "VIEWED", label: "Mark as viewed" },
  { status: "SHORTLISTED", label: "Shortlist applicant" },
  { status: "HIRED", label: "Mark as hired" },
  { status: "REJECTED", label: "Reject application" },
] as const;

export default function JobApplicationDetailScreen() {
  const { id = "" } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = React.useMemo(() => createJobApi(apiClient), [apiClient]);
  const [item, setItem] = useState<JobApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => api.application(id).then((result) => {
    setItem(result);
    setError(null);
  }).catch((cause: unknown) => {
    setError(ApiError.isApiError(cause) ? cause.userMessage : "Failed to load application.");
  }).finally(() => {
    setLoading(false);
    setRefreshing(false);
  }), [api, id]);

  useEffect(() => { void load(); }, [load]);

  const run = useCallback(async (action: () => Promise<JobApplication>) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      setItem(await action());
    } catch (cause) {
      setActionError(ApiError.isApiError(cause) ? cause.userMessage : "The action could not be completed.");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const updateStatus = useCallback((status: Exclude<ApplicationStatus, "SUBMITTED" | "WITHDRAWN">) => {
    const execute = () => void run(() => api.updateApplicationStatus(id, status));
    if (status === "REJECTED" || status === "HIRED") {
      Alert.alert(`${label(status)} application?`, "This completes the application review and cannot be undone.", [
        { text: "Cancel", style: "cancel" },
        { text: label(status), style: status === "REJECTED" ? "destructive" : "default", onPress: execute },
      ]);
    } else execute();
  }, [api, id, run]);

  const withdraw = useCallback(() => {
    Alert.alert("Withdraw application?", "The employer will no longer consider this application.", [
      { text: "Cancel", style: "cancel" },
      { text: "Withdraw", style: "destructive", onPress: () => void run(() => api.withdraw(id)) },
    ]);
  }, [api, id, run]);

  const openResume = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await api.resumeDownloadUrl(id);
      await Linking.openURL(result.downloadUrl);
    } catch (cause) {
      setActionError(ApiError.isApiError(cause) ? cause.userMessage : "Unable to open the résumé.");
    } finally {
      setBusy(false);
    }
  }, [api, id]);

  if (loading) return <LoadingScreen message="Loading application…" />;
  if (error || !item) return <ErrorState message={error ?? "Application not found."} onRetry={load} />;

  const application = item.application;
  const applicantName = item.applicant?.displayName ?? item.applicant?.username ?? "Applicant";
  const actions = STATUS_ACTIONS.filter(({ status }) =>
    canTransitionApplication(application.status, status));

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Pressable onPress={safeBack} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={25} color={theme.text} />
          </Pressable>
          <ThemedText type="title" style={styles.headerTitle}>Application</ThemedText>
          <View style={styles.spacer} />
        </View>
        <ScrollView refreshControl={<RefreshControl refreshing={refreshing} tintColor={BrandColors.primary}
          onRefresh={() => { setRefreshing(true); void load(); }} />} contentContainerStyle={styles.content}>
          <View style={styles.heading}>
            <View style={styles.headingCopy}>
              <ThemedText type="title" style={styles.title}>
                {item.canManage ? applicantName : item.job.title}
              </ThemedText>
              <ThemedText style={styles.subtitle} themeColor="textSecondary">
                {item.canManage ? item.job.title : item.job.employerName}
              </ThemedText>
            </View>
            <View style={[styles.status, { backgroundColor: BrandColors.primarySurface }]}>
              <ThemedText style={styles.statusText}>{label(application.status)}</ThemedText>
            </View>
          </View>
          <Pressable onPress={() => router.push(`/(app)/jobs/${item.job.id}` as never)}
            accessibilityRole="button" style={[styles.jobCard, { backgroundColor: theme.backgroundElement }]}>
            <Ionicons name="briefcase-outline" size={22} color={BrandColors.primary} />
            <View style={styles.jobCopy}>
              <ThemedText style={styles.jobTitle}>{item.job.title}</ThemedText>
              <ThemedText style={styles.jobMeta} themeColor="textSecondary">
                {item.job.employerName} · {formatLocation(null, item.job.workplaceType)}
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={19} color={theme.textSecondary} />
          </Pressable>
          <View style={styles.dates}>
            <ThemedText themeColor="textSecondary">Submitted {new Date(application.submittedAt).toLocaleString()}</ThemedText>
            <ThemedText themeColor="textSecondary">Updated {new Date(application.updatedAt).toLocaleString()}</ThemedText>
          </View>
          <View style={styles.section}>
            <ThemedText type="subtitle">Cover letter</ThemedText>
            <ThemedText style={styles.coverLetter}>
              {application.coverLetter?.trim() || "No cover letter was provided."}
            </ThemedText>
          </View>
          <View style={styles.section}>
            <ThemedText type="subtitle">Résumé</ThemedText>
            {application.resumeMediaId ? (
              <PrimaryButton label="View résumé" variant="secondary" disabled={busy}
                onPress={() => void openResume()} />
            ) : <ThemedText themeColor="textSecondary">No résumé was attached.</ThemedText>}
          </View>
          {actionError ? <ThemedText style={styles.error} accessibilityRole="alert">{actionError}</ThemedText> : null}
          {item.canManage && actions.length ? (
            <View style={styles.section}>
              <ThemedText type="subtitle">Review application</ThemedText>
              <View style={styles.actions}>
                {actions.map((action) => <PrimaryButton key={action.status} label={action.label}
                  variant={action.status === "REJECTED" ? "danger" : action.status === "VIEWED" ? "secondary" : "primary"}
                  disabled={busy} onPress={() => updateStatus(action.status)} />)}
              </View>
            </View>
          ) : null}
          {item.canWithdraw ? <PrimaryButton label="Withdraw application" variant="danger"
            disabled={busy} onPress={withdraw} /> : null}
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
  heading: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.two },
  headingCopy: { flex: 1 },
  title: { fontSize: 25, lineHeight: 31 },
  subtitle: { fontSize: 15, marginTop: 4 },
  status: { borderRadius: BorderRadius.full, paddingHorizontal: 10, paddingVertical: 6 },
  statusText: { color: BrandColors.primary, fontSize: 12, fontWeight: "700" },
  jobCard: { flexDirection: "row", alignItems: "center", borderRadius: BorderRadius.lg,
    padding: Spacing.three, gap: Spacing.three },
  jobCopy: { flex: 1 },
  jobTitle: { fontSize: 15, fontWeight: "700" },
  jobMeta: { fontSize: 12, marginTop: 3 },
  dates: { gap: 4 },
  section: { gap: Spacing.three },
  coverLetter: { fontSize: 15, lineHeight: 23 },
  actions: { gap: Spacing.three },
  error: { color: BrandColors.error, textAlign: "center" },
});
