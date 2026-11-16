import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Image, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { ErrorState } from "@/shared/components/error-state";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import { createShopApi } from "../services/shop-api";
import { useMarket } from "../services/use-market";
import { formatMoney, ShopEmpty } from "../components/shop-ui";
import type { Cart } from "../types/shop-types";

export default function CartScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);
  const { market } = useMarket();
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!market) return;
    try {
      setCart(await api.cart(market.countryId));
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load your cart.");
    } finally {
      setLoading(false);
    }
  }, [api, market]);

  useEffect(() => { queueMicrotask(() => { setLoading(true); void load(); }); }, [load]);

  const updateQuantity = useCallback(async (itemId: string, quantity: number) => {
    try {
      setCart(quantity <= 0 ? await api.removeCartItem(itemId, market?.countryId ?? "")
        : await api.updateCartItem(itemId, quantity, market?.countryId ?? ""));
    } catch (cause) {
      Alert.alert("Cart error", ApiError.isApiError(cause) ? cause.userMessage : "Try again.");
    }
  }, [api]);

  if (loading) return <LoadingScreen />;

  const totalItems = cart?.groups.reduce((sum, g) => sum + g.items.length, 0) ?? 0;

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 12 }}>
          <Pressable onPress={() => router.back()} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={{ color: theme.text, fontSize: 20, fontWeight: "700" }}>
            Cart{totalItems ? ` (${totalItems})` : ""}
          </ThemedText>
        </View>

        {error ? <ErrorState message={error} onRetry={() => void load()} /> :
         !cart || cart.groups.length === 0 ? (
          <ShopEmpty icon="cart-outline" title="Your cart is empty"
            message="Browse the marketplace to find items you love."
            action={<Pressable onPress={() => router.push("/(app)/(tabs)/" as never)}>
              <ThemedText style={{ color: theme.primary }}>Start browsing</ThemedText>
            </Pressable>} />
        ) : (
          <>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 120 }}>
              {cart.groups.map((group) => (
                <View key={group.shopId} style={{ gap: 10 }}>
                  <Pressable
                    onPress={() => router.push(`/(app)/shop/shop/${group.shopId}?market=${market?.countryId}` as never)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="storefront-outline" size={16} color={theme.primary} />
                    <ThemedText type="smallBold" style={{ color: theme.text }}>
                      {group.shopName}
                    </ThemedText>
                  </Pressable>
                  {group.items.map((item) => (
                    <View key={item.id} style={{ flexDirection: "row", gap: 12,
                      backgroundColor: theme.backgroundElement, borderRadius: 12, padding: 10 }}>
                      <Image source={{ uri: item.imageUrl ?? undefined }}
                        style={{ width: 72, height: 90, borderRadius: 8,
                          backgroundColor: theme.backgroundSelected }} />
                      <View style={{ flex: 1, gap: 4 }}>
                        <ThemedText numberOfLines={2} type="smallBold"
                          style={{ color: theme.text }}>{item.productName}</ThemedText>
                        {item.variantLabel ? (
                          <ThemedText type="small" style={{ color: theme.textSecondary }}>
                            {item.variantLabel}
                          </ThemedText>
                        ) : null}
                        <ThemedText type="small" style={{ color: theme.textSecondary }}>
                          {formatMoney(item.unitPrice)}
                        </ThemedText>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginTop: 4 }}>
                          <Pressable onPress={() => void updateQuantity(item.id, item.quantity - 1)}
                            accessibilityLabel="Decrease quantity" hitSlop={8}>
                            <Ionicons name="remove-circle-outline" size={22} color={theme.text} />
                          </Pressable>
                          <ThemedText type="smallBold" style={{ color: theme.text }}>
                            {item.quantity}
                          </ThemedText>
                          <Pressable onPress={() => void updateQuantity(item.id, item.quantity + 1)}
                            accessibilityLabel="Increase quantity" hitSlop={8}>
                            <Ionicons name="add-circle-outline" size={22} color={theme.text} />
                          </Pressable>
                          <Pressable onPress={() => void updateQuantity(item.id, 0)}
                            accessibilityLabel="Remove" hitSlop={8} style={{ marginLeft: "auto" }}>
                            <Ionicons name="trash-outline" size={20} color={theme.error} />
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
            <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: 16,
              paddingBottom: 28, backgroundColor: theme.background,
              borderTopWidth: 1, borderTopColor: theme.border, gap: 8 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <ThemedText type="smallBold" style={{ color: theme.text }}>Subtotal</ThemedText>
                <ThemedText type="smallBold" style={{ color: theme.text }}>
                  {formatMoney(cart.subtotal)}
                </ThemedText>
              </View>
              <PrimaryButton label="Continue to checkout"
                onPress={() => router.push(`/(app)/shop/checkout?market=${market?.countryId}` as never)} />
            </View>
          </>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}
