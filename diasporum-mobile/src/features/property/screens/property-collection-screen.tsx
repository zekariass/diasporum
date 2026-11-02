import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { ApiError } from "@/core/api/api-error";
import { useSession } from "@/core/session/session-provider";
import { BrandColors } from "@/shared/theme/colors";
import { Spacing } from "@/shared/theme/spacing";
import { createPropertyApi } from "../services/property-api";
import type { PropertyItem, PropertyStatus } from "../types/property-types";
import { PropertyCard } from "../components/property-card";
import { PropertiesEmpty, PropertiesSkeleton, PropertyListError } from "../components/property-states";
import { Chip, PropertyScreen } from "../components/property-controls";

const PAGE_SIZE = 20;
const STATUSES: (PropertyStatus | "ALL")[] = ["ALL", "DRAFT", "PUBLISHED", "PAUSED", "CLOSED"];

export default function PropertyCollectionScreen({ mode }: { mode: "mine" | "saved" }) {
  const router = useRouter();
  const { apiClient } = useSession();
  const api = React.useMemo(() => createPropertyApi(apiClient), [apiClient]);
  const [status, setStatus] = useState<PropertyStatus | "ALL">("ALL");
  const [items, setItems] = useState<PropertyItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback((nextCursor?: string) => {
    if (loadingRef.current) return Promise.resolve();
    loadingRef.current = true;
    if (nextCursor) setLoadingMore(true);
    const request = mode === "mine"
      ? api.mine(status === "ALL" ? undefined : status, undefined, nextCursor, PAGE_SIZE)
      : api.saved(nextCursor, PAGE_SIZE);
    return request.then((page) => {
      setItems((previous) => {
        if (!nextCursor) return page.items;
        const seen = new Set(previous.map((entry) => entry.property.id));
        return [...previous, ...page.items.filter((entry) => !seen.has(entry.property.id))];
      });
      setCursor(page.nextCursor);
      setError(null);
    }).catch((cause: unknown) => {
      setError(ApiError.isApiError(cause) ? cause.userMessage : `Failed to load ${mode === "mine" ? "your" : "saved"} properties.`);
    }).finally(() => {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    });
  }, [api, mode, status]);

  const [previousStatus, setPreviousStatus] = useState(status);
  if (previousStatus !== status) {
    setPreviousStatus(status);
    setLoading(true);
  }

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const openDetail = useCallback((id: string) => router.push(`/(app)/properties/${id}` as never), [router]);
  const empty = mode === "mine"
    ? { title: status === "ALL" ? "No property listings yet" : `No ${status.toLowerCase()} properties`, message: "Personal and business properties you manage appear here.", actionLabel: "Create property", onAction: () => router.push("/(app)/properties/create" as never) }
    : { title: "No saved properties yet", message: "Bookmark properties you want to revisit.", actionLabel: "Browse properties", onAction: () => router.push("/(app)/properties" as never) };

  return (
    <PropertyScreen title={mode === "mine" ? "My properties" : "Saved properties"}>
      {mode === "mine" ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{STATUSES.map((value) => <Chip key={value} label={value === "ALL" ? "All" : value.toLowerCase()} active={status === value} onPress={() => setStatus(value)} accessibilityLabel={value === "ALL" ? "All my properties" : `${value.toLowerCase()} properties`} />)}</ScrollView> : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item.property.id}
        renderItem={({ item }) => <PropertyCard item={item} onPress={openDetail} />}
        onEndReached={() => { if (cursor && !loadingRef.current) void load(cursor); }}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={BrandColors.primary} />}
        ListHeaderComponent={loading && !refreshing ? <PropertiesSkeleton /> : error ? <PropertyListError message={error} onRetry={() => void load()} /> : undefined}
        ListEmptyComponent={!loading && !error ? <PropertiesEmpty {...empty} /> : undefined}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} color={BrandColors.primary} accessibilityLabel="Loading more properties" /> : undefined}
        contentContainerStyle={items.length === 0 ? styles.emptyContent : styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </PropertyScreen>
  );
}

const styles = StyleSheet.create({
  tabs: { gap: Spacing.two, padding: Spacing.three },
  footer: { padding: Spacing.three },
  listContent: { paddingBottom: Spacing.four },
  emptyContent: { flexGrow: 1 },
});
