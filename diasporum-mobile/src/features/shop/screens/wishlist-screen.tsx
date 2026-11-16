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
import { ShopEmpty, ShopProductCard } from "../components/shop-ui";
import type { ProductCard } from "../types/shop-types";

export default function WishlistScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);
  const { market } = useMarket();
  const { width } = useWindowDimensions();
  const cardWidth = (width - 44) / 2;
  const [items, setItems] = useState<ProductCard[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async (nextCursor?: string) => {
    if (!market || loadingRef.current) return;
    loadingRef.current = true;
    try {
      const list = await api.wishlist(market.countryId);
      setItems(list);
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load favourites.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, market]);

  useEffect(() => { queueMicrotask(() => { setLoading(true); void load(); }); }, [load]);

  const unfavourite = useCallback(async (product: ProductCard) => {
    setItems((current) => current.filter((i) => i.id !== product.id));
    try {
      await api.unfavourite(product.id);
    } catch {
      setItems((current) => [product, ...current]);
    }
  }, [api]);

  if (loading) return <LoadingScreen />;

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 12 }}>
          <Pressable onPress={() => router.back()} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={{ color: theme.text, fontSize: 20, fontWeight: "700" }}>Favourites</ThemedText>
        </View>
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : (
          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            numColumns={2}
            columnWrapperStyle={{ gap: 12 }}
            contentContainerStyle={{ padding: 16, gap: 12 }}
            refreshControl={<RefreshControl refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.primary} />}
            renderItem={({ item }) => (
              <ShopProductCard product={item} width={cardWidth}
                onPress={() => router.push(`/(app)/shop/product/${item.id}?market=${market?.countryId}` as never)}
                onFavourite={() => void unfavourite(item)} />
            )}
            ListEmptyComponent={<ShopEmpty icon="heart-outline" title="No favourites yet"
              message="Tap the heart on any item to save it here." />}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}
