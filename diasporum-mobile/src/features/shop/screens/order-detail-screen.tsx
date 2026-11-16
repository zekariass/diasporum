import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Image, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";

import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { ErrorState } from "@/shared/components/error-state";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import { createShopApi } from "../services/shop-api";
import { formatMoney, SectionTitle, StatusPill } from "../components/shop-ui";
import type { OrderDetail } from "../types/shop-types";

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setOrder(await api.order(id));
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load the order.");
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => { queueMicrotask(() => { setLoading(true); void load(); }); }, [load]);

  const cancel = useCallback(() => {
    Alert.alert("Cancel order", "Are you sure?", [
      { text: "Keep order", style: "cancel" },
      { text: "Cancel order", style: "destructive", onPress: async () => {
        setActing(true);
        try {
          await api.cancelOrder(id!);
          void load();
        } catch (cause) {
          Alert.alert("Could not cancel", ApiError.isApiError(cause) ? cause.userMessage : "Try again.");
        } finally {
          setActing(false);
        }
      } },
    ]);
  }, [api, id]);

  const requestReturn = useCallback((sellerOrderId: string) => {
    Alert.alert("Return this order?", "The seller will review your request.", [
      { text: "Back", style: "cancel" },
      { text: "Request return", onPress: async () => {
        setActing(true);
        try {
          await api.requestReturn(sellerOrderId, { reasonCode: "BUYER_REQUEST", items: order?.sellerOrders
            .find((x) => x.id === sellerOrderId)?.items
            .filter((i) => i.returnableQuantity > 0)
            .map((i) => ({ orderItemId: i.id, quantity: i.returnableQuantity, resolution: "REFUND" })) ?? [] });
          void load();
        } catch (cause) {
          Alert.alert("Return failed", ApiError.isApiError(cause) ? cause.userMessage : "Try again.");
        } finally {
          setActing(false);
        }
      } },
    ]);
  }, [api, load]);

  if (loading) return <LoadingScreen />;
  if (error || !order) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }}>
          <ErrorState message={error ?? "Order not found"} onRetry={() => void load()} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  const cancellable = order.status === "PENDING_PAYMENT" || order.status === "PLACED";

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 12 }}>
          <Pressable onPress={() => router.back()} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <ThemedText style={{ color: theme.text, fontSize: 20, fontWeight: "700" }}>{order.orderNumber}</ThemedText>
          </View>
          <StatusPill status={order.status} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
          {order.paymentUrl ? (
            <PrimaryButton label="Complete payment"
              onPress={() => void Linking.openURL(order.paymentUrl!)} />
          ) : null}
          {order.paymentFailure ? (
            <ThemedText type="small" style={{ color: theme.error }}>
              Payment failed: {order.paymentFailure}
            </ThemedText>
          ) : null}

          {order.sellerOrders.map((so) => (
            <View key={so.id} style={{ backgroundColor: theme.backgroundElement,
              borderRadius: 14, padding: 14, gap: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <ThemedText type="smallBold" style={{ color: theme.text }}>{so.shopName}</ThemedText>
                <StatusPill status={so.status} />
              </View>
              {so.items.map((item) => (
                <View key={item.id} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                  <Image source={{ uri: item.imageUrl ?? undefined }}
                    style={{ width: 44, height: 55, borderRadius: 8,
                      backgroundColor: theme.backgroundSelected }} />
                  <View style={{ flex: 1 }}>
                    <ThemedText numberOfLines={2} style={{ color: theme.text }}>
                      {item.productName}
                    </ThemedText>
                    <ThemedText type="small" style={{ color: theme.textSecondary }}>
                      ×{item.quantity}
                    </ThemedText>
                    {!item.reviewed && ["DELIVERED", "PARTIALLY_RETURNED", "RETURNED",
                      "PARTIALLY_REFUNDED", "REFUNDED"].includes(so.status) ? (
                      <Pressable onPress={() => router.push(
                        `/(app)/shop/review?orderItemId=${item.id}&productName=${encodeURIComponent(item.productName)}` as never)}>
                        <ThemedText type="small" style={{ color: theme.primary }}>
                          Review this item
                        </ThemedText>
                      </Pressable>
                    ) : null}
                  </View>
                  <ThemedText style={{ color: theme.text }}>{formatMoney(item.lineTotal)}</ThemedText>
                </View>
              ))}
              {so.shipments.map((shipment) => (
                <View key={shipment.id} style={{ gap: 6, borderTopWidth: 1,
                  borderTopColor: theme.border, paddingTop: 10 }}>
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    <Ionicons name="cube-outline" size={16} color={theme.primary} />
                    <ThemedText type="small" style={{ color: theme.text, flex: 1 }}>
                      {[shipment.carrierName, shipment.trackingNumber].filter(Boolean).join(" · ") || "Shipment"}
                    </ThemedText>
                    <StatusPill status={shipment.status} />
                  </View>
                  {shipment.trackingUrl ?? undefined ? (
                    <Pressable onPress={() => void Linking.openURL(shipment.trackingUrl ?? undefined!)}>
                      <ThemedText type="small" style={{ color: theme.primary }}>Track shipment</ThemedText>
                    </Pressable>
                  ) : null}
                  {(shipment.events ?? []).length > 0 ? (
                    <View style={{ gap: 0, marginTop: 2 }}>
                      {(shipment.events ?? []).map((event, index, list) => (
                        <View key={`${event.eventCode}-${event.occurredAt}`}
                          style={{ flexDirection: "row", gap: 10 }}>
                          <View style={{ alignItems: "center", width: 14 }}>
                            <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 5,
                              backgroundColor: index === 0 ? theme.primary : theme.textMuted }} />
                            {index < list.length - 1 ? (
                              <View style={{ flex: 1, width: 1.5, backgroundColor: theme.border }} />
                            ) : null}
                          </View>
                          <View style={{ flex: 1, paddingBottom: index < list.length - 1 ? 10 : 0 }}>
                            <ThemedText type="small" style={{ color: theme.text }}>
                              {event.description}{event.location ? ` — ${event.location}` : ""}
                            </ThemedText>
                            <ThemedText type="small" style={{ color: theme.textMuted }}>
                              {event.occurredAt.slice(0, 16).replace("T", " ")}
                            </ThemedText>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ))}
              <View style={{ flexDirection: "row", gap: 14, borderTopWidth: 1,
                borderTopColor: theme.border, paddingTop: 10 }}>
                {so.canRequestReturn ? (
                  <Pressable onPress={() => requestReturn(so.id)} disabled={acting}>
                    <ThemedText type="small" style={{ color: theme.primary }}>Request return</ThemedText>
                  </Pressable>
                ) : null}
                {so.canReviewShop && !so.shopReviewed ? (
                  <Pressable onPress={() => router.push(
                    `/(app)/shop/review?sellerOrderId=${so.id}&shopName=${encodeURIComponent(so.shopName)}` as never)}>
                    <ThemedText type="small" style={{ color: theme.primary }}>Review this shop</ThemedText>
                  </Pressable>
                ) : null}
                {so.sellerUserId ? (
                  <Pressable onPress={() => router.push(`/(app)/shop/message?sellerOrderId=${so.id}` as never)}>
                    <ThemedText type="small" style={{ color: theme.primary }}>Message seller</ThemedText>
                  </Pressable>
                ) : null}
              </View>
              {so.returns.map((ret) => (
                <View key={ret.id} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <Ionicons name="return-down-back-outline" size={14} color={theme.warning} />
                  <ThemedText type="small" style={{ color: theme.textSecondary, flex: 1 }}>
                    Return {ret.status.replaceAll("_", " ").toLowerCase()}
                  </ThemedText>
                </View>
              ))}
            </View>
          ))}

          <View style={{ gap: 6 }}>
            <SectionTitle title="Delivery address" />
            <ThemedText style={{ color: theme.textSecondary }}>
              {[
                order.shippingAddress.recipientName, order.shippingAddress.line1,
                order.shippingAddress.line2,
                `${order.shippingAddress.city}${order.shippingAddress.region ? `, ${order.shippingAddress.region}` : ""} ${order.shippingAddress.postalCode}`,
                order.shippingAddress.countryCode,
              ].filter(Boolean).join("\n")}
            </ThemedText>
          </View>

          <View style={{ gap: 6 }}>
            <SectionTitle title="Payment" />
            {([["Subtotal", order.totals.subtotal], ["Discount", order.totals.discount],
               ["Shipping", order.totals.shipping], ["Tax", order.totals.tax],
               ["Total", order.totals.total]] as const).map(([label, money]) => (
              <View key={label} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <ThemedText style={{ color: label === "Total" ? theme.text : theme.textSecondary }}
                  type={label === "Total" ? "smallBold" : "default"}>{label}</ThemedText>
                <ThemedText style={{ color: theme.text }}
                  type={label === "Total" ? "smallBold" : "default"}>
                  {formatMoney(money)}
                </ThemedText>
              </View>
            ))}
          </View>

          {cancellable ? (
            <PrimaryButton label="Cancel order" variant="secondary"
              onPress={cancel} loading={acting} />
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
