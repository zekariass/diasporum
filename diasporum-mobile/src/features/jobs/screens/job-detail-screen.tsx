import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
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
import { ReportSheet } from "../components/job-discovery-sheets";
import { createJobApi } from "../services/job-api";
import type { JobDetail } from "../types/job-types";
import {
  formatDeadline,
  formatLocation,
  formatPosted,
  formatSalary,
  label,
} from "../utils/job-format";

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const { apiClient } = useSession();
  const api = React.useMemo(() => createJobApi(apiClient), [apiClient]);
  const messaging = React.useMemo(
    () => createMessagingApi(apiClient),
    [apiClient],
  );
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const load = useCallback(() => {
    return api
      .detail(id)
      .then(async (result) => {
        setDetail(result);
        setError(null);
        const urls = await Promise.all(
          result.mediaIds.map((mediaId) =>
            api
              .mediaDownloadUrl(id, mediaId)
              .then((response) => response.downloadUrl)
              .catch(() => null),
          ),
        );
        setMediaUrls(urls.filter((url): url is string => Boolean(url)));
      })
      .catch((cause: unknown) => {
        setError(
          ApiError.isApiError(cause)
            ? cause.userMessage
            : "Failed to load job.",
        );
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (action: () => Promise<unknown>, reload = true) => {
      if (busy) return false;
      setBusy(true);
      setActionError(null);
      try {
        await action();
        if (reload) await load();
        return true;
      } catch (cause) {
        setActionError(
          ApiError.isApiError(cause)
            ? cause.userMessage
            : "The action could not be completed.",
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, load],
  );

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

  const submitReport = useCallback(
    async (reason: string, details: string) => {
      if (busy) return;
      setBusy(true);
      setActionError(null);
      try {
        await api.report(id, reason, details || undefined);
        setReportOpen(false);
        Alert.alert(
          "Report submitted",
          "Thank you — our moderators will review this listing.",
        );
      } catch (cause) {
        const duplicate =
          ApiError.isApiError(cause) &&
          (cause.httpStatus === 409 ||
            cause.message.includes("REPORT_DUPLICATE"));
        if (duplicate) {
          setReportOpen(false);
          Alert.alert(
            "Already reported",
            "You've already reported this listing — our moderators are reviewing it.",
          );
        } else {
          setActionError(
            ApiError.isApiError(cause)
              ? cause.userMessage
              : "The action could not be completed.",
          );
        }
      } finally {
        setBusy(false);
      }
    },
    [api, busy, id],
  );

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
    Alert.alert(
      "Delete job?",
      "The listing will be hidden. Applications and audit history are retained.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            void run(async () => {
              await api.remove(id);
              router.replace("/(app)/jobs/my" as never);
            }, false),
        },
      ],
    );
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
  if (error || !detail)
    return <ErrorState message={error ?? "Job not found."} onRetry={load} />;

  const job = detail.job;
  const salary = formatSalary(job);
  const accepting = job.status === "PUBLISHED";
  const canApply = accepting && job.applicationsEnabled;
  const internal = job.applicationMethod === "INTERNAL";
  const posted = formatPosted(job.publishedAt ?? job.createdAt);
  const deadline = formatDeadline(job.closesAt);
  const employment = [
    label(job.employmentType),
    job.workHoursType !== "UNSPECIFIED" ? label(job.workHoursType) : null,
    job.workSchedule ? label(job.workSchedule) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const headerIcon = [
    styles.headerIcon,
    { backgroundColor: theme.backgroundElement },
  ];

  return (
    <ThemedView type="surface" style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View
          style={[
            styles.header,
            {
              backgroundColor: theme.background,
              borderBottomColor: theme.border,
            },
          ]}
        >
          <Pressable
            onPress={safeBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={headerIcon}
          >
            <Ionicons name="chevron-back" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={styles.headerTitle} numberOfLines={1}>
            Job details
          </ThemedText>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => void toggleSave()}
              accessibilityRole="button"
              accessibilityLabel={detail.saved ? "Unsave job" : "Save job"}
              style={headerIcon}
            >
              <Ionicons
                name={detail.saved ? "bookmark" : "bookmark-outline"}
                size={20}
                color={detail.saved ? theme.primary : theme.text}
              />
            </Pressable>
            {!detail.canManage ? (
              <Pressable
                onPress={() => {
                  setActionError(null);
                  setReportOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Report job"
                style={headerIcon}
              >
                <Ionicons name="flag-outline" size={19} color={theme.text} />
              </Pressable>
            ) : null}
          </View>
        </View>
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={BrandColors.primary}
            />
          }
        >
          {mediaUrls.length ? (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
            >
              {mediaUrls.map((uri) => (
                <Image
                  key={uri}
                  source={{ uri }}
                  style={[styles.hero, { width: screenWidth }]}
                  resizeMode="cover"
                  accessibilityLabel={`${job.title} image`}
                />
              ))}
            </ScrollView>
          ) : null}
          <View style={styles.content}>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: theme.background,
                  borderColor: theme.border,
                },
              ]}
            >
              <View style={styles.titleRow}>
                <View style={styles.titleBlock}>
                  <ThemedText style={styles.title}>{job.title}</ThemedText>
                  <View style={styles.employerRow}>
                    <ThemedText
                      style={styles.employer}
                      themeColor="textSecondary"
                      numberOfLines={1}
                    >
                      {job.employerName}
                    </ThemedText>
                    {job.verifiedEmployer ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={16}
                        color={theme.primary}
                      />
                    ) : null}
                  </View>
                </View>
                {detail.canManage ? (
                  <View
                    style={[
                      styles.status,
                      {
                        backgroundColor: accepting
                          ? theme.primarySurface
                          : theme.backgroundElement,
                      },
                    ]}
                  >
                    <ThemedText
                      style={[
                        styles.statusText,
                        accepting && { color: theme.primary },
                      ]}
                    >
                      {label(job.status)}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
              <View style={styles.infoList}>
                <InfoRow
                  icon="location-outline"
                  text={formatLocation(detail.location, job.workplaceType)}
                />
                <InfoRow icon="briefcase-outline" text={employment} />
                <InfoRow
                  icon="globe-outline"
                  text={
                    job.visibilityScope === "COUNTRY"
                      ? "Country-wide"
                      : "Community listing"
                  }
                />
                {deadline ? <InfoRow icon="time-outline" text={deadline} /> : null}
                {detail.businessAccountName ? (
                  <InfoRow
                    icon="business-outline"
                    text={detail.businessAccountName}
                  />
                ) : null}
                {posted ? (
                  <InfoRow icon="calendar-outline" text={posted} />
                ) : null}
              </View>
              {salary ? (
                <View
                  style={[
                    styles.salaryRow,
                    { backgroundColor: theme.primarySurface },
                  ]}
                >
                  <Ionicons name="cash-outline" size={17} color={theme.primary} />
                  <ThemedText style={[styles.salary, { color: theme.primary }]}>
                    {salary}
                  </ThemedText>
                </View>
              ) : null}
              {detail.categories.length ? (
                <View style={styles.categories}>
                  {detail.categories.map((category) => (
                    <View
                      key={category.id}
                      style={[
                        styles.category,
                        { backgroundColor: theme.backgroundElement },
                      ]}
                    >
                      <ThemedText
                        style={styles.categoryText}
                        themeColor="textSecondary"
                      >
                        {category.displayName}
                      </ThemedText>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: theme.background,
                  borderColor: theme.border,
                },
              ]}
            >
              <ThemedText style={styles.sectionTitle}>Description</ThemedText>
              <ThemedText style={styles.description}>
                {job.description}
              </ThemedText>
            </View>
            {detail.myApplicationStatus ? (
              <Pressable
                onPress={() =>
                  detail.myApplicationId &&
                  router.push(
                    `/(app)/jobs/application/${detail.myApplicationId}` as never,
                  )
                }
                accessibilityRole="button"
                style={[
                  styles.card,
                  styles.applicationRow,
                  {
                    backgroundColor: theme.primarySurface,
                    borderColor: theme.primarySurface,
                  },
                ]}
              >
                <View>
                  <ThemedText
                    style={styles.applicationLabel}
                    themeColor="textSecondary"
                  >
                    Your application
                  </ThemedText>
                  <ThemedText
                    style={[styles.applicationValue, { color: theme.primary }]}
                  >
                    {label(detail.myApplicationStatus)}
                  </ThemedText>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={theme.primary}
                />
              </Pressable>
            ) : null}
            {actionError ? (
              <ThemedText style={styles.error} accessibilityRole="alert">
                {actionError}
              </ThemedText>
            ) : null}
            <View style={styles.actions}>
              {!detail.canManage && canApply && !detail.myApplicationId ? (
                <PrimaryButton
                  label={internal ? "Apply now" : "Apply on external website"}
                  onPress={
                    internal
                      ? () => router.push(`/(app)/jobs/apply/${id}` as never)
                      : () => void openExternal()
                  }
                />
              ) : null}
              {!detail.canManage && job.contactEnabled ? (
                <PrimaryButton
                  label="Contact employer"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => void contact()}
                />
              ) : null}
              {detail.canManage ? (
                <>
                  <PrimaryButton
                    label="Review applications"
                    onPress={() =>
                      router.push(`/(app)/jobs/applications/${id}` as never)
                    }
                  />
                  <PrimaryButton
                    label="Edit job"
                    variant="secondary"
                    onPress={() =>
                      router.push(`/(app)/jobs/edit/${id}` as never)
                    }
                  />
                  {["DRAFT", "PAUSED"].includes(job.status) ? (
                    <PrimaryButton
                      label="Publish job"
                      disabled={busy}
                      onPress={() => void run(() => api.publish(id))}
                    />
                  ) : null}
                  {["PUBLISHED", "PAUSED"].includes(job.status) ? (
                    <PrimaryButton
                      label="Close listing"
                      variant="secondary"
                      disabled={busy}
                      onPress={() =>
                        Alert.alert(
                          "Close job?",
                          "It will stop accepting applications.",
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Close",
                              onPress: () => void run(() => api.close(id)),
                            },
                          ],
                        )
                      }
                    />
                  ) : null}
                  <PrimaryButton
                    label="Delete job"
                    variant="danger"
                    disabled={busy}
                    onPress={remove}
                  />
                </>
              ) : null}
            </View>
          </View>
        </ScrollView>
        <ReportSheet
          visible={reportOpen}
          busy={busy}
          error={actionError}
          onSubmit={(reason, details) => void submitReport(reason, details)}
          onClose={() => setReportOpen(false)}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function InfoRow({
  icon,
  text,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  text: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.infoRow}>
      <View
        style={[styles.infoIcon, { backgroundColor: theme.backgroundElement }]}
      >
        <Ionicons name={icon} size={15} color={theme.textSecondary} />
      </View>
      <ThemedText style={styles.infoText}>{text}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingHorizontal: 12,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "700" },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  hero: { height: 230 },
  content: { padding: 12, gap: 12, paddingBottom: Spacing.six },
  card: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
  },
  titleBlock: { flex: 1, gap: 4 },
  title: { fontSize: 26, lineHeight: 32, fontWeight: "800" },
  employerRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  employer: { fontSize: 15, fontWeight: "600", flexShrink: 1 },
  status: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  statusText: { fontSize: 11, fontWeight: "700" },
  infoList: { gap: 12 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  infoIcon: {
    width: 30,
    height: 30,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  infoText: { flex: 1, fontSize: 14, lineHeight: 20 },
  salaryRow: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: BorderRadius.md,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  salary: { fontSize: 14, fontWeight: "800" },
  categories: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  category: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  categoryText: { fontSize: 12 },
  sectionTitle: { fontSize: 17, fontWeight: "800" },
  description: { fontSize: 15, lineHeight: 23 },
  applicationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  applicationLabel: { fontSize: 12 },
  applicationValue: { fontSize: 16, fontWeight: "700" },
  actions: { gap: Spacing.three },
  error: { color: BrandColors.error, textAlign: "center" },
});
