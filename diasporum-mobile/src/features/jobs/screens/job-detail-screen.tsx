import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ApiError } from "@/core/api/api-error";
import { safeBack } from "@/core/navigation/safe-back";
import { useSession } from "@/core/session/session-provider";
import { createMessagingApi } from "@/features/messaging/services/messaging-api";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { ErrorState } from "@/shared/components/error-state";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { PrimaryButton } from "@/shared/components/primary-button";
import { createJobApi } from "../services/job-api";
import type { JobDetail } from "../types/job-types";
import {
  formatDeadline,
  formatLocation,
  formatSalary,
  label,
} from "../utils/job-format";

const REPORT_REASONS = ["SCAM", "SPAM", "MISINFORMATION", "IMPERSONATION", "OTHER"];

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { apiClient } = useSession();
  const api = React.useMemo(() => createJobApi(apiClient), [apiClient]);
  const messaging = React.useMemo(() => createMessagingApi(apiClient), [apiClient]);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    return api.detail(id).then(async (result) => {
      setDetail(result);
      setError(null);
      const urls = await Promise.all(result.mediaIds.map((mediaId) =>
        api.mediaDownloadUrl(id, mediaId).then((response) => response.downloadUrl).catch(() => null)));
      setMediaUrls(urls.filter((url): url is string => Boolean(url)));
    }).catch((cause: unknown) => {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Failed to load job.");
    }).finally(() => {
      setLoading(false);
      setRefreshing(false);
    });
  }, [api, id]);

  useEffect(() => { void load(); }, [load]);

  const run = useCallback(async (action: () => Promise<unknown>, reload = true) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await action();
      if (reload) await load();
    } catch (cause) {
      setActionError(ApiError.isApiError(cause) ? cause.userMessage : "The action could not be completed.");
    } finally {
      setBusy(false);
    }
  }, [busy, load]);

  const toggleSave = useCallback(async () => {
    if (!detail) return;
    const saved = !detail.saved;
    setDetail((previous) => previous && { ...previous, saved });
    try {
      if (saved) await api.save(id);
      else await api.unsave(id);
    } catch {
      setDetail((previous) => previous && { ...previous, saved: !saved });
      setActionError("Could not update saved jobs.");
    }
  }, [api, detail, id]);

  const report = useCallback(() => {
    Alert.alert("Report job", "Why are you reporting this opportunity?", [
      ...REPORT_REASONS.map((reason) => ({
        text: label(reason),
        onPress: () => void run(() => api.report(id, reason), false),
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  }, [api, id, run]);

  const contact = useCallback(async () => {
    if (!detail) return;
    const job = detail.job;
    await run(async () => {
      const conversation = await messaging.createConversation({
        contextType: "JOB_LISTING",
        contextId: id,
        ...(job.businessAccountId
          ? { recipientBusinessAccountId: job.businessAccountId }
          : { recipientUserId: job.employerUserId ?? undefined }),
      });
      router.push(`/messages/${conversation.id}` as never);
    }, false);
  }, [detail, id, messaging, router, run]);

  const remove = useCallback(() => {
    Alert.alert("Delete job?", "The listing will be hidden. Applications and audit history are retained.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void run(async () => {
        await api.remove(id);
        router.replace("/(app)/jobs/my" as never);
      }, false) },
    ]);
  }, [api, id, router, run]);

  const openExternal = useCallback(async () => {
    if (!detail?.job.applicationUrl) return;
    try {
      await Linking.openURL(detail.job.applicationUrl);
    } catch {
      setActionError("Unable to open the external application website.");
    }
  }, [detail]);

  if (loading) return <LoadingScreen message="Loading job…" />;
  if (error || !detail) return <ErrorState message={error ?? "Job not found."} onRetry={load} />;

  const job = detail.job;
  const salary = formatSalary(job);
  const accepting = job.status === "PUBLISHED";
  const internal = job.applicationMethod === "INTERNAL";

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Pressable onPress={safeBack} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={25} color={theme.text} />
          </Pressable>
          <ThemedText type="title" style={styles.headerTitle} numberOfLines={1}>Job details</ThemedText>
          <View style={styles.headerActions}>
            <Pressable onPress={() => void toggleSave()} accessibilityRole="button"
              accessibilityLabel={detail.saved ? "Unsave job" : "Save job"}>
              <Ionicons name={detail.saved ? "bookmark" : "bookmark-outline"} size={23}
                color={detail.saved ? BrandColors.primary : theme.text} />
            </Pressable>
            {!detail.canManage ? (
              <Pressable onPress={report} accessibilityRole="button" accessibilityLabel="Report job">
                <Ionicons name="flag-outline" size={22} color={theme.text} />
              </Pressable>
            ) : null}
          </View>
        </View>
        <ScrollView refreshControl={<RefreshControl refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); void load(); }} tintColor={BrandColors.primary} />}>
          {mediaUrls.length ? (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
              {mediaUrls.map((uri) => <Image key={uri} source={{ uri }} style={styles.hero}
                resizeMode="cover" accessibilityLabel={`${job.title} image`} />)}
            </ScrollView>
          ) : null}
          <View style={styles.content}>
            <View style={styles.titleRow}>
              <View style={styles.titleBlock}>
                <ThemedText type="title" style={styles.title}>{job.title}</ThemedText>
                <ThemedText style={styles.employer}>{job.employerName}</ThemedText>
              </View>
              <View style={[styles.status, { backgroundColor: accepting
                ? BrandColors.primarySurface : theme.backgroundElement }]}>
                <ThemedText style={[styles.statusText, accepting && { color: BrandColors.primary }]}>
                  {label(job.status)}
                </ThemedText>
              </View>
            </View>
            <InfoRow icon="location-outline" text={formatLocation(detail.location, job.workplaceType)} />
            <InfoRow icon="briefcase-outline"
              text={`${label(job.employmentType)} · ${label(job.workHoursType)}${job.workSchedule ? ` · ${label(job.workSchedule)}` : ""}`} />
            <InfoRow icon="globe-outline" text={job.visibilityScope === "COUNTRY" ? "Country-wide" : "Community listing"} />
            {salary ? <InfoRow icon="cash-outline" text={salary} /> : null}
            {formatDeadline(job.closesAt) ? <InfoRow icon="time-outline" text={formatDeadline(job.closesAt) as string} /> : null}
            {detail.businessAccountName ? <InfoRow icon="business-outline" text={detail.businessAccountName} /> : null}
            <View style={styles.categories}>
              {detail.categories.map((category) => (
                <View key={category.id} style={[styles.category, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText style={styles.categoryText} themeColor="textSecondary">{category.displayName}</ThemedText>
                </View>
              ))}
            </View>
            <Section title="Description">
              <ThemedText style={styles.description}>{job.description}</ThemedText>
            </Section>
            {detail.myApplicationStatus ? (
              <Pressable onPress={() => detail.myApplicationId &&
                router.push(`/(app)/jobs/application/${detail.myApplicationId}` as never)}
                accessibilityRole="button" style={[styles.applicationStatus, { borderColor: theme.border }]}>
                <View>
                  <ThemedText style={styles.applicationLabel}>Your application</ThemedText>
                  <ThemedText style={styles.applicationValue}>{label(detail.myApplicationStatus)}</ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
              </Pressable>
            ) : null}
            {actionError ? <ThemedText style={styles.error} accessibilityRole="alert">{actionError}</ThemedText> : null}
            <View style={styles.actions}>
              {!detail.canManage && accepting && !detail.myApplicationId ? (
                <PrimaryButton label={internal ? "Apply now" : "Apply on external website"}
                  onPress={internal ? () => router.push(`/(app)/jobs/apply/${id}` as never) : () => void openExternal()} />
              ) : null}
              {!detail.canManage ? (
                <PrimaryButton label="Contact employer" variant="secondary" disabled={busy}
                  onPress={() => void contact()} />
              ) : null}
              {detail.canManage ? (
                <>
                  <PrimaryButton label="Review applications" onPress={() =>
                    router.push(`/(app)/jobs/applications/${id}` as never)} />
                  <PrimaryButton label="Edit job" variant="secondary" onPress={() =>
                    router.push(`/(app)/jobs/edit/${id}` as never)} />
                  {["DRAFT", "PAUSED"].includes(job.status) ? (
                    <PrimaryButton label="Publish job" disabled={busy}
                      onPress={() => void run(() => api.publish(id))} />
                  ) : null}
                  {["PUBLISHED", "PAUSED"].includes(job.status) ? (
                    <PrimaryButton label="Close listing" variant="secondary" disabled={busy}
                      onPress={() => Alert.alert("Close job?", "It will stop accepting applications.", [
                        { text: "Cancel", style: "cancel" },
                        { text: "Close", onPress: () => void run(() => api.close(id)) },
                      ])} />
                  ) : null}
                  <PrimaryButton label="Delete job" variant="danger" disabled={busy} onPress={remove} />
                </>
              ) : null}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}><ThemedText type="subtitle">{title}</ThemedText>{children}</View>;
}

function InfoRow({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }) {
  const theme = useTheme();
  return <View style={styles.infoRow}><Ionicons name={icon} size={18} color={theme.textSecondary} />
    <ThemedText style={styles.infoText}>{text}</ThemedText></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: Spacing.four, paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 21 },
  headerActions: { flexDirection: "row", gap: Spacing.three },
  hero: { width: 360, height: 230, marginRight: 2 },
  content: { padding: Spacing.four, gap: Spacing.three },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.two },
  titleBlock: { flex: 1 },
  title: { fontSize: 26, lineHeight: 32 },
  employer: { fontSize: 16, fontWeight: "600", marginTop: 4 },
  status: { borderRadius: BorderRadius.full, paddingHorizontal: 9, paddingVertical: 5 },
  statusText: { fontSize: 11, fontWeight: "700" },
  infoRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  infoText: { flex: 1, fontSize: 14, lineHeight: 20 },
  categories: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  category: { borderRadius: BorderRadius.full, paddingHorizontal: 10, paddingVertical: 5 },
  categoryText: { fontSize: 12 },
  section: { gap: Spacing.two, paddingTop: Spacing.two },
  description: { fontSize: 15, lineHeight: 23 },
  applicationStatus: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 1, borderRadius: 12, padding: Spacing.three },
  applicationLabel: { fontSize: 12 },
  applicationValue: { fontSize: 16, color: BrandColors.primary, fontWeight: "700" },
  actions: { gap: Spacing.three, paddingBottom: Spacing.five },
  error: { color: BrandColors.error, textAlign: "center" },
});
