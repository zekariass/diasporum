import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Image, Pressable, RefreshControl, View } from "react-native";
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
import { formatMoney, ShopEmpty, StatusPill } from "../components/shop-ui";
import type { OrderSummary } from "../types/shop-types";

export default function OrdersScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async (nextCursor?: string) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const page = await api.orders(undefined, nextCursor);
      setOrders((current) => {
        if (!nextCursor) return page.items;
        const ids = new Set(current.map((o) => o.id));
        return [...current, ...page.items.filter((o) => !ids.has(o.id))];
      });
      setCursor(page.nextCursor);
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load orders.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  if (loading) return <LoadingScreen />;

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 12 }}>
          <Pressable onPress={() => router.back()} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={{ color: theme.text, fontSize: 20, fontWeight: "700" }}>My orders</ThemedText>
        </View>
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : (
          <FlatList
            data={orders}
            keyExtractor={(o) => o.id}
            refreshControl={<RefreshControl refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.primary} />}
            contentContainerStyle={{ padding: 16, gap: 10 }}
            onEndReachedThreshold={0.5}
            onEndReached={() => { if (cursor) void load(cursor); }}
            renderItem={({ item: order }) => (
              <Pressable onPress={() => router.push(`/(app)/shop/orders/${order.id}` as never)}
                style={({ pressed }) => ({
                  backgroundColor: theme.backgroundElement, borderRadius: 14, padding: 14,
                  gap: 8, opacity: pressed ? 0.8 : 1,
                })}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <ThemedText type="smallBold" style={{ color: theme.text }}>
                    {order.orderNumber}
                  </ThemedText>
                  <StatusPill status={order.status} />
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ flexDirection: "row" }}>
                    {order.previewImageUrls.slice(0, 3).map((url) => (
                      <Image key={url} source={{ uri: url }}
                        style={{ width: 34, height: 42, borderRadius: 6, marginRight: -8,
                          borderWidth: 1.5, borderColor: theme.backgroundElement,
                          backgroundColor: theme.backgroundSelected }} />
                    ))}
                  </View>
                  <ThemedText type="small" style={{ color: theme.textSecondary }}>
                    {order.itemCount} item{order.itemCount === 1 ? "" : "s"}
                    {order.sellerOrderCount > 1 ? ` · ${order.sellerOrderCount} sellers` : ""}
                  </ThemedText>
                  <ThemedText type="smallBold" style={{ color: theme.text, marginLeft: "auto" }}>
                    {formatMoney(order.total)}
                  </ThemedText>
                </View>
              </Pressable>
            )}
            ListEmptyComponent={<ShopEmpty icon="receipt-outline" title="No orders yet"
              message="Orders you place will show up here." />}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}
