import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
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
import { PrimaryButton } from "@/shared/components/primary-button";
import { createJobApi } from "../services/job-api";
import type { ApplicationStatus, JobApplication } from "../types/job-types";
import { label } from "../utils/job-format";

const STATUSES: ApplicationStatus[] = [
  "SUBMITTED", "VIEWED", "SHORTLISTED", "REJECTED", "HIRED", "WITHDRAWN",
];

export default function JobApplicationsScreen({ mode }: { mode: "mine" | "employer" }) {
  const { id = "" } = useLocalSearchParams<{ id?: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { apiClient } = useSession();
  const api = React.useMemo(() => createJobApi(apiClient), [apiClient]);
  const [items, setItems] = useState<JobApplication[]>([]);
  const [status, setStatus] = useState<ApplicationStatus | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const title = mode === "mine" ? "My applications" : "Job applications";

  const load = useCallback((nextCursor?: string) => {
    if (loadingRef.current) return Promise.resolve();
    loadingRef.current = true;
    if (nextCursor) setLoadingMore(true);
    const request = mode === "mine"
      ? api.myApplications(nextCursor)
      : api.jobApplications(id, status ?? undefined, nextCursor);
    return request.then((page) => {
      setItems((previous) => {
        if (!nextCursor) return page.items;
        const ids = new Set(previous.map((item) => item.application.id));
        return [...previous, ...page.items.filter((item) => !ids.has(item.application.id))];
      });
      setCursor(page.nextCursor);
      setError(null);
    }).catch((cause: unknown) => {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Failed to load applications.");
    }).finally(() => {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    });
  }, [api, id, mode, status]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems([]);
    setCursor(null);
    setLoading(true);
    void load();
  }, [load]);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Pressable onPress={safeBack} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={25} color={theme.text} />
          </Pressable>
          <ThemedText type="title" style={styles.title}>{title}</ThemedText>
          <View style={styles.spacer} />
        </View>
        {mode === "employer" ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}>
            <Filter label="All" selected={status === null} onPress={() => setStatus(null)} />
            {STATUSES.map((value) => <Filter key={value} label={label(value)}
              selected={status === value} onPress={() => setStatus(value)} />)}
          </ScrollView>
        ) : null}
        <FlatList
          data={items}
          keyExtractor={(item) => item.application.id}
          renderItem={({ item }) => <ApplicationCard item={item} mode={mode}
            onPress={() => router.push(`/(app)/jobs/application/${item.application.id}` as never)} />}
          onEndReached={() => { if (cursor && !loadingRef.current) void load(cursor); }}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={BrandColors.primary}
            onRefresh={() => { setRefreshing(true); void load(); }} />}
          ListEmptyComponent={loading ? (
            <ActivityIndicator style={styles.state} color={BrandColors.primary} accessibilityLabel="Loading applications" />
          ) : error ? (
            <View style={styles.state} accessibilityRole="alert">
              <ThemedText style={styles.message}>{error}</ThemedText>
              <PrimaryButton label="Retry" variant="secondary" onPress={() => void load()} />
            </View>
          ) : (
            <View style={styles.state}>
              <Ionicons name="document-text-outline" size={42} color={theme.textSecondary} />
              <ThemedText type="subtitle">No applications found</ThemedText>
              <ThemedText style={styles.message} themeColor="textSecondary">
                {mode === "mine" ? "Apply to an internal job listing to track it here."
                  : "Applications matching this filter will appear here."}
              </ThemedText>
            </View>
          )}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer}
            color={BrandColors.primary} /> : undefined}
          contentContainerStyle={items.length === 0 ? styles.empty : styles.list}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function Filter({ label: text, selected, onPress }: {
  label: string; selected: boolean; onPress: () => void;
}) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}
    style={[styles.filter, { backgroundColor: selected ? BrandColors.primary : BrandColors.primarySurface }]}>
    <ThemedText style={[styles.filterText, selected && { color: BrandColors.white }]}>{text}</ThemedText>
  </Pressable>;
}

function ApplicationCard({ item, mode, onPress }: {
  item: JobApplication; mode: "mine" | "employer"; onPress: () => void;
}) {
  const theme = useTheme();
  const application = item.application;
  const applicantName = item.applicant?.displayName ?? item.applicant?.username ?? "Applicant";
  return <Pressable onPress={onPress} accessibilityRole="button"
    accessibilityLabel={mode === "mine" ? `Application for ${item.job.title}` : `Application from ${applicantName}`}
    style={({ pressed }) => [styles.card, { borderColor: theme.border,
      backgroundColor: theme.background }, pressed && { opacity: 0.75 }]}>
    <View style={styles.cardHeading}>
      <View style={styles.cardCopy}>
        <ThemedText style={styles.cardTitle} numberOfLines={2}>
          {mode === "mine" ? item.job.title : applicantName}
        </ThemedText>
        <ThemedText themeColor="textSecondary" numberOfLines={1}>
          {mode === "mine" ? item.job.employerName : item.job.title}
        </ThemedText>
      </View>
      <View style={[styles.status, { backgroundColor: BrandColors.primarySurface }]}>
        <ThemedText style={styles.statusText}>{label(application.status)}</ThemedText>
      </View>
    </View>
    <View style={styles.meta}>
      <ThemedText style={styles.metaText} themeColor="textSecondary">
        Submitted {new Date(application.submittedAt).toLocaleDateString()}
      </ThemedText>
      {application.resumeMediaId ? <Ionicons name="attach" size={17} color={theme.textSecondary}
        accessibilityLabel="Résumé attached" /> : null}
      <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: Spacing.four, paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, textAlign: "center", fontSize: 21 },
  spacer: { width: 25 },
  filters: { padding: Spacing.three, gap: Spacing.two },
  filter: { borderRadius: BorderRadius.full, paddingHorizontal: Spacing.three, paddingVertical: 7 },
  filterText: { fontSize: 12, fontWeight: "700" },
  list: { paddingVertical: Spacing.two },
  card: { marginHorizontal: Spacing.four, marginVertical: Spacing.one, borderWidth: 1,
    borderRadius: BorderRadius.lg, padding: Spacing.three, gap: Spacing.three },
  cardHeading: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.two },
  cardCopy: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 16, lineHeight: 21, fontWeight: "700" },
  status: { borderRadius: BorderRadius.full, paddingHorizontal: 9, paddingVertical: 5 },
  statusText: { color: BrandColors.primary, fontSize: 11, fontWeight: "700" },
  meta: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  metaText: { flex: 1, fontSize: 12 },
  state: { alignItems: "center", justifyContent: "center", padding: Spacing.five, gap: Spacing.three },
  message: { textAlign: "center", fontSize: 14 },
  footer: { padding: Spacing.four },
  empty: { flexGrow: 1 },
});
