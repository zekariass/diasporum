import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { useLocalSearchParams } from "expo-router";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createServiceMarketplaceApi } from "../services/service-marketplace-api";
import type { ServiceCategory, ServiceProvider } from "../types/service-marketplace-types";
import { CollectionState, ProviderCard, ScreenHeader, serviceStyles } from "../components/service-ui";

export default function ProviderCollectionScreen({ mode }: { mode: "mine" | "discover" | "matching" }) {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = useMemo(() => createServiceMarketplaceApi(apiClient), [apiClient]);
  const [items, setItems] = useState<ServiceProvider[]>([]);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [categoryId, setCategoryId] = useState<string>();
  const [q, setQ] = useState("");
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number }>();
  const [sort, setSort] = useState<"NEWEST" | "DISTANCE">(mode === "matching" ? "DISTANCE" : "NEWEST");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (mode === "discover") api.categories().then(setCategories).catch(() => setCategories([]));
  }, [api, mode]);

  const load = useCallback(async (nextCursor?: string) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const page = mode === "mine"
        ? await api.myProviders(undefined, nextCursor)
        : mode === "matching" && id
          ? await api.matchingProviders(id, 100, sort, nextCursor)
          : await api.discoverProviders({
              categoryId, q: q.trim() || undefined, sort,
              ...(coordinates ? {
                originLatitude: coordinates.latitude, originLongitude: coordinates.longitude,
                radiusKm: 100,
              } : {}),
            }, nextCursor);
      setItems((current) => nextCursor ? mergeProviders(current, page.items) : page.items);
      setCursor(page.nextCursor);
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load providers.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, categoryId, coordinates, id, mode, q, sort]);

  useEffect(() => {
    const task = setTimeout(() => { setLoading(true); void load(); }, 0);
    return () => clearTimeout(task);
  }, [load]);

  async function nearMe() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setError("Location permission is needed for nearby providers and distance sorting.");
      return;
    }
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoordinates({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      setSort("DISTANCE");
    } catch {
      setError("Your location is unavailable. Try again or browse without distance.");
    }
  }

  return (
    <ThemedView style={serviceStyles.root}>
      <SafeAreaView style={serviceStyles.root} edges={["top", "left", "right"]}>
        <ScreenHeader back title={mode === "mine" ? "My provider profiles"
          : mode === "matching" ? "Matching providers" : "Browse providers"} />
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ProviderCard provider={item} />}
          contentContainerStyle={serviceStyles.content}
          ListHeaderComponent={mode !== "mine" ? (
            <View style={serviceStyles.actions}>
              {mode === "matching" ? <PrimaryButton label={sort === "DISTANCE" ? "Sort by newest" : "Sort by distance"}
                variant="secondary" onPress={() => setSort((current) => current === "DISTANCE" ? "NEWEST" : "DISTANCE")} /> : null}
              {mode === "discover" ? <>
              <TextInput accessibilityLabel="Search providers" placeholder="Search by name or description"
                value={q} onChangeText={setQ} style={[serviceStyles.input, { color: theme.text, borderColor: theme.border }]} />
              <View style={styles.categories}>
                {categories.map((category) => (
                  <Pressable key={category.id} accessibilityRole="button" accessibilityState={{ selected: categoryId === category.id }}
                    onPress={() => setCategoryId((current) => current === category.id ? undefined : category.id)}
                    style={[styles.category, { borderColor: categoryId === category.id ? BrandColors.primary : theme.border }]}>
                    <ThemedText type="small">{category.displayName}</ThemedText>
                  </Pressable>
                ))}
              </View>
              <PrimaryButton label={coordinates ? "Refresh nearby location" : "Find providers near me"}
                variant="secondary" onPress={() => void nearMe()} />
              {coordinates ? <PrimaryButton label="Show newest instead" variant="ghost"
                onPress={() => { setCoordinates(undefined); setSort("NEWEST"); }} /> : null}
              </> : null}
            </View>
          ) : undefined}
          ListEmptyComponent={<CollectionState loading={loading} error={error} empty={!loading && !error}
            emptyText={mode === "mine" ? "No provider profiles yet" : "No matching providers"}
            onRetry={() => { setLoading(true); void load(); }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
          onEndReached={() => { if (cursor && !loadingRef.current) void load(cursor); }}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

export function mergeProviders(current: ServiceProvider[], incoming: ServiceProvider[]) {
  const ids = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !ids.has(item.id))];
}

const styles = {
  categories: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: Spacing.two },
  category: { borderWidth: 1, borderRadius: BorderRadius.full, padding: Spacing.two },
};
