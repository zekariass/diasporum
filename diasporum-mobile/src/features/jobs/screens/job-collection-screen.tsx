import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ApiError } from "@/core/api/api-error";
import { safeBack } from "@/core/navigation/safe-back";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { Spacing } from "@/shared/theme/spacing";
import { PrimaryButton } from "@/shared/components/primary-button";
import { JobCard } from "../components/job-card";
import { createJobApi } from "../services/job-api";
import type { JobItem } from "../types/job-types";

export default function JobCollectionScreen({ mode }: { mode: "my" | "saved" }) {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient } = useSession();
  const api = React.useMemo(() => createJobApi(apiClient), [apiClient]);
  const [items, setItems] = useState<JobItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const title = mode === "my" ? "My job listings" : "Saved jobs";

  const load = useCallback((nextCursor?: string) => {
    if (loadingRef.current) return Promise.resolve();
    loadingRef.current = true;
    if (nextCursor) setLoadingMore(true);
    const request = mode === "my" ? api.myJobs(nextCursor) : api.savedJobs(nextCursor);
    return request.then((page) => {
      setItems((previous) => {
        if (!nextCursor) return page.items;
        const ids = new Set(previous.map((item) => item.job.id));
        return [...previous, ...page.items.filter((item) => !ids.has(item.job.id))];
      });
      setCursor(page.nextCursor);
      setError(null);
    }).catch((cause: unknown) => {
      setError(ApiError.isApiError(cause) ? cause.userMessage : `Failed to load ${title.toLowerCase()}.`);
    }).finally(() => {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    });
  }, [api, mode, title]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Pressable onPress={safeBack} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={25} color={theme.text} />
          </Pressable>
          <ThemedText type="title" style={styles.title}>{title}</ThemedText>
          {mode === "my" ? (
            <Pressable onPress={() => router.push("/(app)/jobs/create" as never)}
              accessibilityRole="button" accessibilityLabel="Create job">
              <Ionicons name="add" size={26} color={theme.text} />
            </Pressable>
          ) : <View style={styles.spacer} />}
        </View>
        <FlatList
          data={items}
          keyExtractor={(item) => item.job.id}
          renderItem={({ item }) => (
            <JobCard item={item} onPress={(jobId) => router.push(`/(app)/jobs/${jobId}` as never)} />
          )}
          onEndReached={() => { if (cursor && !loadingRef.current) void load(cursor); }}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={BrandColors.primary}
            onRefresh={() => { setRefreshing(true); void load(); }} />}
          ListEmptyComponent={loading ? (
            <ActivityIndicator style={styles.state} color={BrandColors.primary} accessibilityLabel={`Loading ${title}`} />
          ) : error ? (
            <View style={styles.state} accessibilityRole="alert">
              <ThemedText style={styles.message}>{error}</ThemedText>
              <PrimaryButton label="Retry" variant="secondary" onPress={() => void load()} />
            </View>
          ) : (
            <View style={styles.state}>
              <Ionicons name={mode === "my" ? "briefcase-outline" : "bookmark-outline"}
                size={42} color={theme.textSecondary} />
              <ThemedText type="subtitle">{mode === "my" ? "No job listings yet" : "No saved jobs"}</ThemedText>
              <ThemedText style={styles.message} themeColor="textSecondary">
                {mode === "my" ? "Create an opportunity for your community." : "Save a job to find it here later."}
              </ThemedText>
              {mode === "my" ? <PrimaryButton label="Create job"
                onPress={() => router.push("/(app)/jobs/create" as never)} /> : null}
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

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: Spacing.four, paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, textAlign: "center", fontSize: 21 },
  spacer: { width: 26 },
  list: { paddingVertical: Spacing.two },
  state: { alignItems: "center", justifyContent: "center", padding: Spacing.five,
    gap: Spacing.three },
  message: { textAlign: "center", fontSize: 14 },
  footer: { padding: Spacing.four },
  empty: { flexGrow: 1 },
});
