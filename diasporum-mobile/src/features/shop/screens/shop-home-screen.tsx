import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { ErrorState } from "@/shared/components/error-state";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import { createShopApi } from "../services/shop-api";
import { useMarket } from "../services/use-market";
import { Chip, ShopEmpty, ShopProductCard } from "../components/shop-ui";
import type { Category, ProductCard } from "../types/shop-types";

const SORTS = [
  { key: "NEWEST", label: "Newest" },
  { key: "POPULAR", label: "Popular" },
  { key: "PRICE_ASC", label: "Price ↑" },
  { key: "PRICE_DESC", label: "Price ↓" },
];

/** Marketplace home — Vinted-style discovery: search bar, category chips, product grid. */
export default function ShopHomeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);
  const { market, loading: marketLoading, error: marketError, reload } = useMarket();
  const { width } = useWindowDimensions();
  const cardWidth = (width - 16 * 2 - 12) / 2;

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [sort, setSort] = useState("NEWEST");
  const [items, setItems] = useState<ProductCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async (nextCursor?: string) => {
    if (!market || loadingRef.current) return;
    loadingRef.current = true;
    try {
      const page = await api.search({
        marketCountryId: market.countryId,
        categoryId: categoryId ?? undefined,
        sort,
      }, nextCursor, 20);
      setItems((current) => {
        if (!nextCursor) return page.items;
        const ids = new Set(current.map((i) => i.id));
        return [...current, ...page.items.filter((i) => !ids.has(i.id))];
      });
      setCursor(page.nextCursor);
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load items.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, market, categoryId, sort]);

  useEffect(() => {
    queueMicrotask(() => {
      if (!market) return;
      setLoading(true);
      setItems([]);
      setCursor(null);
      void load();
    });
  }, [market, load]);

  useEffect(() => {
    if (!market) return;
    api.categories().then(setCategories).catch(() => setCategories([]));
  }, [api, market]);

  const toggleFavourite = useCallback((product: ProductCard) => {
    setItems((current) => current.map((i) => i.id === product.id
        ? { ...i, favourited: !i.favourited, favouriteCount: i.favouriteCount + (i.favourited ? -1 : 1) }
        : i));
    (product.favourited ? api.unfavourite(product.id) : api.favourite(product.id))
        .catch(() => setItems((current) => current.map((i) => i.id === product.id
            ? { ...i, favourited: product.favourited, favouriteCount: product.favouriteCount } : i)));
  }, [api]);

  if (marketLoading) return <LoadingScreen />;
  if (!market) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
          <ShopEmpty
            icon="storefront-outline"
            title="Marketplace not available"
            message={marketError ?? "The shop marketplace is not enabled in your country yet."}
            action={marketError ? (
              <Pressable onPress={() => void reload()}>
                <ThemedText style={{ color: theme.primary }}>Retry</ThemedText>
              </Pressable>
            ) : undefined}
          />
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 10 }}>
          <Pressable
            onPress={() => router.push("/(app)/shop/browse" as never)}
            accessibilityRole="search"
            style={{
              flexDirection: "row", alignItems: "center", gap: 8,
              backgroundColor: theme.backgroundElement, borderRadius: 12,
              paddingHorizontal: 12, paddingVertical: 11,
            }}
          >
            <Ionicons name="search" size={18} color={theme.textSecondary} />
            <ThemedText style={{ color: theme.textSecondary }}>Search items, brands, sellers…</ThemedText>
          </Pressable>
        </View>
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 100 }}
          refreshControl={
            <RefreshControl refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.primary} />
          }
          onEndReachedThreshold={0.5}
          onEndReached={() => { if (cursor) void load(cursor); }}
          renderItem={({ item }) => (
            <ShopProductCard product={item} width={cardWidth}
              onPress={() => router.push(`/(app)/shop/product/${item.id}?market=${market.countryId}` as never)}
              onFavourite={() => toggleFavourite(item)} />
          )}
          ListHeaderComponent={
            <View style={{ gap: 10, marginBottom: 4 }}>
              <FlatList
                horizontal
                data={[{ id: null, name: "All" } as unknown as Category, ...categories]}
                keyExtractor={(c) => c.id ?? "all"}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
                renderItem={({ item: c }) => (
                  <Chip label={c.name} selected={(categoryId ?? null) === c.id}
                    onPress={() => setCategoryId(c.id)} />
                )}
              />
              <FlatList
                horizontal
                data={SORTS}
                keyExtractor={(s) => s.key}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
                renderItem={({ item: s }) => (
                  <Chip label={s.label} selected={sort === s.key} onPress={() => setSort(s.key)} />
                )}
              />
            </View>
          }
          ListEmptyComponent={
            loading ? <></> : error ? (
              <ErrorState message={error} onRetry={() => void load()} />
            ) : (
              <ShopEmpty icon="shirt-outline" title="Nothing here yet"
                message="No items match this category yet — check back soon." />
            )
          }
        />
      </SafeAreaView>
    </ThemedView>
  );
}
