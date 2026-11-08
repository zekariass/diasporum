import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ApiError } from "@/core/api/api-error";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { PrimaryButton } from "@/shared/components/primary-button";
import { BrandColors } from "@/shared/theme/colors";
import { Spacing } from "@/shared/theme/spacing";
import { BusinessCard } from "../components/business-card";
import {
  DirectoryEmpty,
  DirectoryHeader,
  DirectoryMessage,
} from "../components/directory-ui";
import { createDirectoryApi } from "../services/directory-api";
import type { Business } from "../types/directory-types";

export default function BusinessCollectionScreen({
  mode,
}: {
  mode: "saved" | "managed";
}) {
  const router = useRouter();
  const theme = useTheme();
  const { accountId } = useLocalSearchParams<{ accountId?: string }>();
  const { apiClient } = useSession();
  const api = React.useMemo(() => createDirectoryApi(apiClient), [apiClient]);
  const [items, setItems] = useState<Business[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const saved = mode === "saved";

  const load = useCallback(
    async (nextCursor?: string) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      if (nextCursor) setLoadingMore(true);
      try {
        const page = saved
          ? await api.saved(nextCursor)
          : await api.managed(accountId || undefined, nextCursor);
        setItems((previous) => {
          if (!nextCursor) return page.items;
          const seen = new Set(previous.map((item) => item.id));
          return [
            ...previous,
            ...page.items.filter((item) => !seen.has(item.id)),
          ];
        });
        setCursor(page.nextCursor);
        setError(null);
      } catch (cause) {
        setError(
          ApiError.isApiError(cause)
            ? cause.userMessage
            : `Failed to load ${saved ? "saved" : "managed"} businesses.`,
        );
      } finally {
        loadingRef.current = false;
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [accountId, api, saved],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loading && items.length === 0) return <LoadingScreen />;

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <DirectoryHeader
          title={saved ? "Saved businesses" : "Business profiles"}
          action={
            saved ? undefined : (
              <Pressable
                onPress={() =>
                  router.push(
                    `/(app)/businesses/create${accountId ? `?accountId=${accountId}` : ""}` as never,
                  )
                }
                accessibilityLabel="Create business profile"
                hitSlop={8}
              >
                <Ionicons name="add" size={25} color={theme.text} />
              </Pressable>
            )
          }
        />
        {!saved && accountId ? (
          <ThemedText style={styles.accountNote} themeColor="textSecondary">
            Public Business Profiles managed by this Business Account. Listings
            published under a profile appear on it.
          </ThemedText>
        ) : null}
        {error ? (
          <View style={styles.error}>
            <DirectoryMessage error>{error}</DirectoryMessage>
            <Pressable onPress={() => void load()} accessibilityLabel="Retry business list">
              <ThemedText style={styles.retry}>Try again</ThemedText>
            </Pressable>
          </View>
        ) : null}
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <BusinessCard
              business={item}
              onPress={() =>
                router.push(`/(app)/businesses/${item.id}` as never)
              }
            />
          )}
          contentContainerStyle={styles.list}
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
          onEndReached={() => {
            if (cursor && !loadingRef.current) void load(cursor);
          }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <DirectoryEmpty
              title={saved ? "No saved businesses" : "No business profiles yet"}
              body={
                saved
                  ? "Save a business from its public profile and it will stay here while it remains visible to you."
                  : "Create a personal or Business Account-owned profile, add its public details, and publish it when ready."
              }
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={BrandColors.primary} style={styles.more} />
            ) : undefined
          }
        />
        {!saved ? (
          <View style={styles.footer}>
            <PrimaryButton
              label="Create Business Profile"
              onPress={() =>
                router.push(
                  `/(app)/businesses/create${accountId ? `?accountId=${accountId}` : ""}` as never,
                )
              }
            />
          </View>
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  list: { padding: Spacing.four, gap: Spacing.three, flexGrow: 1 },
  error: {
    margin: Spacing.four,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  retry: { color: BrandColors.primary, fontWeight: "700" },
  more: { padding: Spacing.three },
  accountNote: {
    fontSize: 12,
    lineHeight: 17,
    marginHorizontal: Spacing.four,
    marginTop: Spacing.two,
  },
  footer: { padding: Spacing.four },
});
