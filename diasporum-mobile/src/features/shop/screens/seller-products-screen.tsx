import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Image, Pressable, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { ErrorState } from "@/shared/components/error-state";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import { createShopApi } from "../services/shop-api";
import { ShopEmpty, StatusPill } from "../components/shop-ui";
import type { SellerProductRow } from "../types/shop-types";

export default function SellerProductsScreen() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);
  const [rows, setRows] = useState<SellerProductRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async (nextCursor?: string) => {
    if (!shopId || loadingRef.current) return;
    loadingRef.current = true;
    try {
      const page = await api.sellerProducts(shopId, { cursor: nextCursor ?? undefined });
      setRows((current) => {
        if (!nextCursor) return page.items;
        const ids = new Set(current.map((r) => r.id));
        return [...current, ...page.items.filter((r) => !ids.has(r.id))];
      });
      setCursor(page.nextCursor);
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load products.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, shopId]);

  useEffect(() => { queueMicrotask(() => { setLoading(true); void load(); }); }, [load]);

  const changeStatus = useCallback(async (row: SellerProductRow, action: "publish" | "pause" | "archive") => {
    try {
      if (action === "publish") await api.publishProduct(shopId!, row.id);
      else if (action === "pause") await api.pauseProduct(shopId!, row.id);
      else await api.archiveProduct(shopId!, row.id);
      void load();
    } catch (cause) {
      Alert.alert("Could not update", ApiError.isApiError(cause) ? cause.userMessage : "Try again.");
    }
  }, [api, shopId, load]);

  if (loading) return <LoadingScreen />;

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 12 }}>
          <Pressable onPress={() => router.back()} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={{ color: theme.text, fontSize: 20, fontWeight: "700", flex: 1 }}>Products</ThemedText>
          <Pressable
            onPress={() => router.push(`/(app)/shop/seller/product-editor?shopId=${shopId}` as never)}
            accessibilityLabel="New product"
            style={{ backgroundColor: theme.primary, borderRadius: 10, padding: 8 }}>
            <Ionicons name="add" size={20} color="#fff" />
          </Pressable>
        </View>
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : (
          <FlatList
            data={rows}
            keyExtractor={(r) => r.id}
            refreshControl={<RefreshControl refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.primary} />}
            contentContainerStyle={{ padding: 16, gap: 10 }}
            onEndReachedThreshold={0.5}
            onEndReached={() => { if (cursor) void load(cursor); }}
            renderItem={({ item: row }) => (
              <View style={{ flexDirection: "row", gap: 12, alignItems: "center",
                backgroundColor: theme.backgroundElement, borderRadius: 12, padding: 10 }}>
                <Pressable
                  onPress={() => router.push(`/(app)/shop/seller/product-editor?shopId=${shopId}&productId=${row.id}` as never)}
                  style={{ flexDirection: "row", gap: 12, alignItems: "center", flex: 1 }}>
                  <Image source={{ uri: row.imageUrl ?? undefined }}
                    style={{ width: 48, height: 60, borderRadius: 8,
                      backgroundColor: theme.backgroundSelected }} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <ThemedText numberOfLines={1} type="smallBold" style={{ color: theme.text }}>
                      {row.name}
                    </ThemedText>
                    <ThemedText type="small" style={{ color: theme.textSecondary }}>
                      {row.variantCount} variant{row.variantCount === 1 ? "" : "s"} · {row.marketCount} market{row.marketCount === 1 ? "" : "s"}{row.lowStockVariants > 0 ? ` · ${row.lowStockVariants} low` : ""}
                    </ThemedText>
                    <StatusPill status={row.status} />
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => {
                    const actions = row.status === "PUBLISHED"
                      ? [{ label: "Pause", action: "pause" as const }, { label: "Archive", action: "archive" as const }]
                      : [{ label: "Publish", action: "publish" as const }, { label: "Archive", action: "archive" as const }];
                    Alert.alert(row.name, undefined, [
                      ...actions.map((a) => ({ text: a.label, onPress: () => void changeStatus(row, a.action) })),
                      { text: "Cancel", style: "cancel" as const },
                    ]);
                  }}
                  accessibilityLabel="More actions" hitSlop={8}>
                  <Ionicons name="ellipsis-vertical" size={18} color={theme.textSecondary} />
                </Pressable>
              </View>
            )}
            ListEmptyComponent={<ShopEmpty icon="pricetags-outline" title="No products yet"
              message="Add your first item to start selling." />}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}
