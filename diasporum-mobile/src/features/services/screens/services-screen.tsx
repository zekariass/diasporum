import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { createServiceMarketplaceApi } from "../services/service-marketplace-api";
import type { ServiceProvider } from "../types/service-marketplace-types";
import { CollectionState, LeadMarketplaceNotice, ProviderCard, ScreenHeader, serviceStyles } from "../components/service-ui";

export default function ServicesScreen() {
  const router = useRouter();
  const { apiClient } = useSession();
  const api = useMemo(() => createServiceMarketplaceApi(apiClient), [apiClient]);
  const [items, setItems] = useState<ServiceProvider[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async (nextCursor?: string) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const page = await api.discoverProviders({ sort: "NEWEST" }, nextCursor, 20);
      setItems((current) => {
        if (!nextCursor) return page.items;
        const ids = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !ids.has(item.id))];
      });
      setCursor(page.nextCursor);
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load service providers.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  return (
    <ThemedView style={serviceStyles.root}>
      <SafeAreaView style={serviceStyles.root} edges={["top", "left", "right"]}>
        <ScreenHeader title="Services" />
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ProviderCard provider={item} />}
          contentContainerStyle={serviceStyles.content}
          ListHeaderComponent={
            <View style={serviceStyles.actions}>
              <ThemedText type="title">Find trusted local help</ThemedText>
              <LeadMarketplaceNotice />
              <PrimaryButton label="Request a service" onPress={() => router.push("/(app)/services/requests/create" as never)} />
              <PrimaryButton label="Offer services" variant="secondary" onPress={() => router.push("/(app)/services/providers/create" as never)} />
              <PrimaryButton label="Browse providers and filters" variant="secondary" onPress={() => router.push("/(app)/services/providers" as never)} />
              <PrimaryButton label="My service requests" variant="ghost" onPress={() => router.push("/(app)/services/requests/mine" as never)} />
              <PrimaryButton label="My provider profiles" variant="ghost" onPress={() => router.push("/(app)/services/providers/mine" as never)} />
              <PrimaryButton label="My responses" variant="ghost" onPress={() => router.push("/(app)/services/responses" as never)} />
            </View>
          }
          ListEmptyComponent={<CollectionState loading={loading} error={error} empty={!loading && !error}
            emptyText="No service providers yet" onRetry={() => { setLoading(true); void load(); }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
          onEndReached={() => { if (cursor && !loadingRef.current) void load(cursor); }}
        />
      </SafeAreaView>
    </ThemedView>
  );
}
