import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, RefreshControl, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { ThemedView } from "@/components/themed-view";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { createServiceMarketplaceApi } from "../services/service-marketplace-api";
import type { ServiceRequest, ServiceSort } from "../types/service-marketplace-types";
import { CollectionState, RequestCard, ScreenHeader, serviceStyles } from "../components/service-ui";

export default function RequestCollectionScreen({ mode }: { mode: "mine" | "discover" }) {
  const { providerId } = useLocalSearchParams<{ providerId?: string }>();
  const theme = useTheme();
  const { apiClient, session } = useSession();
  const api = useMemo(() => createServiceMarketplaceApi(apiClient), [apiClient]);
  const [items, setItems] = useState<ServiceRequest[]>([]);
  const [city, setCity] = useState("");
  const [currencyCode, setCurrencyCode] = useState("");
  const [sort, setSort] = useState<ServiceSort>("NEWEST");
  const [status, setStatus] = useState<string>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const countryId = session?.profile?.currentCountryId ?? undefined;

  const load = useCallback(async (nextCursor?: string) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const page = mode === "mine" ? await api.myRequests(status, nextCursor)
        : await api.discoverRequests({
            serviceProviderId: providerId, countryId,
            city: city.trim() || undefined, currencyCode: currencyCode.trim().toUpperCase() || undefined,
            sort, ...(sort === "DISTANCE" ? { maxDistanceKm: 100 } : {}),
          }, nextCursor);
      setItems((current) => nextCursor ? mergeRequests(current, page.items) : page.items);
      setCursor(page.nextCursor);
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load service requests.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, city, countryId, currencyCode, mode, providerId, sort, status]);

  useEffect(() => {
    const task = setTimeout(() => { setLoading(true); void load(); }, 0);
    return () => clearTimeout(task);
  }, [load]);

  return (
    <ThemedView style={serviceStyles.root}>
      <SafeAreaView style={serviceStyles.root} edges={["top", "left", "right"]}>
        <ScreenHeader back title={mode === "mine" ? "My service requests" : "Open service requests"} />
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <RequestCard request={item} providerId={mode === "discover" ? providerId : undefined} />}
          contentContainerStyle={serviceStyles.content}
          ListHeaderComponent={<View style={serviceStyles.actions}>
            {mode === "mine" ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {[undefined, "DRAFT", "OPEN", "PAUSED", "CLOSED"].map((value) => <PrimaryButton key={value ?? "ALL"}
                label={value ?? "All"} variant={status === value ? "primary" : "secondary"}
                onPress={() => setStatus(value)} />)}
            </View> : <>
              <TextInput accessibilityLabel="Filter by city" placeholder="City (requests with a linked address only)"
                value={city} onChangeText={setCity} style={[serviceStyles.input, { color: theme.text, borderColor: theme.border }]} />
              <TextInput accessibilityLabel="Filter by currency" placeholder="Currency for price sorting/filtering" maxLength={3}
                autoCapitalize="characters" value={currencyCode} onChangeText={setCurrencyCode}
                style={[serviceStyles.input, { color: theme.text, borderColor: theme.border }]} />
              <PrimaryButton label={sort === "NEWEST" ? "Sort by price (low first)" : "Sort by newest"} variant="secondary"
                onPress={() => setSort((current) => current === "NEWEST" ? "PRICE_ASC" : "NEWEST")} />
              {providerId ? <PrimaryButton label={sort === "DISTANCE" ? "Stop distance sorting" : "Sort by distance"}
                variant="secondary" onPress={() => setSort((current) => current === "DISTANCE" ? "NEWEST" : "DISTANCE")} /> : null}
            </>}
          </View>}
          ListEmptyComponent={<CollectionState loading={loading} error={error} empty={!loading && !error}
            emptyText={mode === "mine" ? "No service requests yet" : "No matching open requests"}
            onRetry={() => { setLoading(true); void load(); }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
          onEndReached={() => { if (cursor && !loadingRef.current) void load(cursor); }}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

export function mergeRequests(current: ServiceRequest[], incoming: ServiceRequest[]) {
  const ids = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !ids.has(item.id))];
}
