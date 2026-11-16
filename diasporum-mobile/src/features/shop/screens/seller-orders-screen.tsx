import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { Ionicons } from "@expo/vector-icons";

import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { KeyboardAwareScrollView } from "@/shared/components/keyboard-aware-scroll-view";
import { ErrorState } from "@/shared/components/error-state";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import { createShopApi } from "../services/shop-api";
import { formatMoney, ShopEmpty, StatusPill } from "../components/shop-ui";
import type { RateView, SellerOrderDetail, SellerOrderSummary } from "../types/shop-types";

export default function SellerOrdersScreen() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);
  const [orders, setOrders] = useState<SellerOrderSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async (nextCursor?: string) => {
    if (!shopId || loadingRef.current) return;
    loadingRef.current = true;
    try {
      const page = await api.sellerOrders(shopId, undefined, nextCursor);
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
    }
  }, [api, shopId]);

  useEffect(() => { queueMicrotask(() => { setLoading(true); void load(); }); }, [load]);

  if (loading) return <LoadingScreen />;

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 12 }}>
          <Pressable onPress={() => router.back()} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={{ color: theme.text, fontSize: 20, fontWeight: "700" }}>Orders</ThemedText>
        </View>
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : (
          <FlatList
            data={orders}
            keyExtractor={(o) => o.id}
            refreshControl={<RefreshControl refreshing={false}
              onRefresh={() => void load()} tintColor={theme.primary} />}
            contentContainerStyle={{ padding: 16, gap: 10 }}
            onEndReachedThreshold={0.5}
            onEndReached={() => { if (cursor) void load(cursor); }}
            renderItem={({ item: o }) => (
              <Pressable
                onPress={() => router.push(`/(app)/shop/seller/order-detail?shopId=${shopId}&orderId=${o.id}` as never)}
                style={{ backgroundColor: theme.backgroundElement, borderRadius: 12, padding: 14, gap: 6 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <ThemedText type="smallBold" style={{ color: theme.text }}>
                    {o.sellerOrderNumber}
                  </ThemedText>
                  <StatusPill status={o.status} />
                </View>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  {o.itemCount} item{o.itemCount === 1 ? "" : "s"} · {o.customerDisplayName}
                </ThemedText>
                <ThemedText style={{ color: theme.text }}>{formatMoney(o.total)}</ThemedText>
              </Pressable>
            )}
            ListEmptyComponent={<ShopEmpty icon="cube-outline" title="No orders yet"
              message="Orders from buyers will appear here." />}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

/** Seller order detail — accept/decline, fulfil with manual or provider label. */
export function SellerOrderDetailScreen() {
  const { shopId, orderId } =
    useLocalSearchParams<{ shopId: string; orderId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);
  const [order, setOrder] = useState<SellerOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState("");
  const [carrier, setCarrier] = useState("");
  const [busy, setBusy] = useState(false);
  const [weight, setWeight] = useState("500");
  const [length, setLength] = useState("200");
  const [width, setWidth] = useState("200");
  const [height, setHeight] = useState("100");
  const [rates, setRates] = useState<{ shipmentId: string; rates: RateView[] } | null>(null);
  const [trackingFor, setTrackingFor] = useState<string | null>(null);
  const [trackCode, setTrackCode] = useState("IN_TRANSIT");
  const [trackDesc, setTrackDesc] = useState("");

  const load = useCallback(async () => {
    if (!shopId || !orderId) return;
    try {
      setOrder(await api.sellerOrder(shopId, orderId));
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load the order.");
    } finally {
      setLoading(false);
    }
  }, [api, shopId, orderId]);

  useEffect(() => { queueMicrotask(() => { setLoading(true); void load(); }); }, [load]);

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (cause) {
      Alert.alert("Action failed", ApiError.isApiError(cause) ? cause.userMessage : "Try again.");
    } finally {
      setBusy(false);
    }
  }, [load]);

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

  const canAccept = order.status === "PLACED" || order.status === "PAID";
  const inputStyle = {
    borderWidth: 1, borderColor: theme.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, color: theme.text,
  } as const;

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 12 }}>
          <Pressable onPress={() => router.back()} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={{ color: theme.text, fontSize: 20, fontWeight: "700", flex: 1 }}>
            {order.sellerOrderNumber}
          </ThemedText>
          <Pressable accessibilityLabel="Message buyer"
            onPress={() => router.push(`/(app)/shop/message?sellerOrderId=${order.id}` as never)}
            style={{ padding: 6 }}>
            <Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.primary} />
          </Pressable>
          <StatusPill status={order.status} />
        </View>
        <KeyboardAwareScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
          <View style={{ backgroundColor: theme.backgroundElement, borderRadius: 14, padding: 14, gap: 8 }}>
            {order.items.map((item) => (
              <View key={item.id} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <ThemedText style={{ color: theme.text, flex: 1 }}>
                  {item.quantity} × {item.productName}
                </ThemedText>
                <ThemedText style={{ color: theme.text }}>{formatMoney(item.lineTotal)}</ThemedText>
              </View>
            ))}
            <View style={{ borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 8,
              flexDirection: "row", justifyContent: "space-between" }}>
              <ThemedText type="smallBold" style={{ color: theme.text }}>Total</ThemedText>
              <ThemedText type="smallBold" style={{ color: theme.text }}>
                {formatMoney(order.sellerNet)}
              </ThemedText>
            </View>
          </View>

          {canAccept ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <PrimaryButton label="Accept" loading={busy}
                  onPress={() => void act(() => api.acceptOrder(shopId!, orderId!))} />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton label="Decline" variant="secondary" loading={busy}
                  onPress={() => void act(() => api.cancelSellerOrder(shopId!, orderId!, "Declined by seller"))} />
              </View>
            </View>
          ) : null}

          {order.status === "ACCEPTED" ? (
            <PrimaryButton label="Start processing" loading={busy}
              onPress={() => void act(() => api.markProcessing(shopId!, orderId!))} />
          ) : null}

          {order.status === "ACCEPTED" || order.status === "PROCESSING" ? (
            <View style={{ gap: 8 }}>
              <ThemedText type="subtitle" style={{ color: theme.text }}>Ship this order</ThemedText>
              <TextInput value={carrier} onChangeText={setCarrier} placeholder="Carrier (manual shipping)"
                placeholderTextColor={theme.textMuted} style={inputStyle} />
              <TextInput value={tracking} onChangeText={setTracking} placeholder="Tracking number"
                placeholderTextColor={theme.textMuted} style={inputStyle} autoCapitalize="characters" />
              <PrimaryButton label="Mark shipped (manual)" variant="secondary" loading={busy}
                disabled={!tracking.trim()}
                onPress={() => void act(async () => {
                  const shipment = await api.createShipment(shopId!, orderId!, {
                    mode: "EXTERNAL",
                    items: order.items.map((i) => ({ orderItemId: i.id, quantity: i.quantity })),
                    packages: [],
                    carrierName: carrier || null,
                    trackingNumber: tracking.trim(),
                  });
                  await api.dispatch(shopId!, orderId!, shipment.id);
                })} />

              <ThemedText type="subtitle" style={{ color: theme.text, marginTop: 8 }}>
                Buy a shipping label
              </ThemedText>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {([
                  ["Weight g", weight, setWeight],
                  ["L mm", length, setLength],
                  ["W mm", width, setWidth],
                  ["H mm", height, setHeight],
                ] as const).map(([ph, value, setter]) => (
                  <TextInput key={ph} value={value} onChangeText={setter} placeholder={ph}
                    keyboardType="number-pad" placeholderTextColor={theme.textMuted}
                    style={[inputStyle, { flex: 1 }]} />
                ))}
              </View>
              <PrimaryButton label="Get label rates" variant="secondary" loading={busy}
                onPress={() => void act(async () => {
                  const shipment = await api.createShipment(shopId!, orderId!, {
                    mode: "SHIPPO",
                    items: order.items.map((i) => ({ orderItemId: i.id, quantity: i.quantity })),
                    packages: [{
                      weightGrams: parseInt(weight, 10) || 500,
                      lengthMm: parseInt(length, 10) || 200,
                      widthMm: parseInt(width, 10) || 200,
                      heightMm: parseInt(height, 10) || 100,
                    }],
                  });
                  setRates({ shipmentId: shipment.id, rates: await api.labelRates(shopId!, orderId!, shipment.id) });
                })} />
            </View>
          ) : null}

          {rates ? (
            <View style={{ backgroundColor: theme.backgroundElement, borderRadius: 12, padding: 12, gap: 8 }}>
              <ThemedText type="smallBold" style={{ color: theme.text }}>Choose a rate</ThemedText>
              {rates.rates.length === 0 ? (
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  No provider rates for this parcel.
                </ThemedText>
              ) : rates.rates.map((r) => (
                <View key={r.rateId} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={{ color: theme.text }}>
                      {r.carrierName} · {r.serviceName}
                    </ThemedText>
                    <ThemedText type="small" style={{ color: theme.textSecondary }}>
                      {r.estimatedDays != null ? `~${r.estimatedDays} days` : r.providerKey}
                    </ThemedText>
                  </View>
                  <PrimaryButton label={`Buy ${formatMoney(r.amount)}`} loading={busy}
                    onPress={() => void act(async () => {
                      await api.buyLabel(shopId!, orderId!, rates.shipmentId, r.rateId);
                      setRates(null);
                    })} />
                </View>
              ))}
            </View>
          ) : null}

          {order.shipments.map((s) => (
            <View key={s.id} style={{ backgroundColor: theme.backgroundElement, borderRadius: 12,
              padding: 12, gap: 8 }}>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <Ionicons name="cube" size={16} color={theme.primary} />
                <ThemedText style={{ color: theme.text, flex: 1 }}>
                  {[s.carrierName, s.serviceName, s.trackingNumber].filter(Boolean).join(" · ") || "Shipment"}
                </ThemedText>
                <StatusPill status={s.status} />
              </View>
              {s.status === "LABEL_CREATED" ? (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton label="Dispatch" loading={busy}
                      onPress={() => void act(() => api.dispatch(shopId!, orderId!, s.id))} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton label="Print label" variant="secondary"
                      onPress={() => void act(async () => {
                        const { url } = await api.labelUrl(shopId!, orderId!, s.id);
                        if (url) await Linking.openURL(url);
                      })} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton label="Void" variant="secondary" loading={busy}
                      onPress={() => Alert.alert("Void label", "Refund and void this label?", [
                        { text: "Cancel", style: "cancel" },
                        { text: "Void", style: "destructive",
                          onPress: () => void act(() => api.voidLabel(shopId!, orderId!, s.id)) },
                      ])} />
                  </View>
                </View>
              ) : null}
              {s.status === "LABEL_PENDING" ? (
                <PrimaryButton label="Get label rates" variant="secondary" loading={busy}
                  onPress={() => void act(async () => {
                    setRates({ shipmentId: s.id, rates: await api.labelRates(shopId!, orderId!, s.id) });
                  })} />
              ) : null}
              {s.trackingUrl ? (
                <Pressable onPress={() => void Linking.openURL(s.trackingUrl!)}>
                  <ThemedText type="link" style={{ color: theme.primary }}>Track shipment</ThemedText>
                </Pressable>
              ) : null}
              {(s.events ?? []).slice(0, 4).map((e) => (
                <ThemedText key={`${e.eventCode}-${e.occurredAt}`} type="small"
                  style={{ color: theme.textSecondary }}>
                  {e.occurredAt.slice(0, 10)} · {e.description}
                </ThemedText>
              ))}
              {s.providerKey !== "SHIPPO"
                  && !["DELIVERED", "CANCELLED", "LOST", "RETURNED_TO_SENDER"].includes(s.status) ? (
                trackingFor === s.id ? (
                  <View style={{ borderTopWidth: 1, borderTopColor: theme.border,
                    paddingTop: 8, gap: 8 }}>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {(["IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "RETURNED", "LOST", "UPDATE"] as const)
                        .map((c) => (
                          <Pressable key={c} onPress={() => setTrackCode(c)}
                            style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
                              backgroundColor: trackCode === c ? theme.text : theme.background }}>
                            <ThemedText type="small"
                              style={{ color: trackCode === c ? theme.background : theme.text }}>
                              {c.replaceAll("_", " ").toLowerCase()}
                            </ThemedText>
                          </Pressable>
                        ))}
                    </View>
                    <TextInput value={trackDesc} onChangeText={setTrackDesc}
                      placeholder="Update note (optional)" placeholderTextColor={theme.textMuted}
                      style={inputStyle} />
                    <PrimaryButton label="Post update" loading={busy}
                      onPress={() => void act(async () => {
                        await api.addTrackingEvent(shopId!, orderId!, s.id, trackCode,
                          trackDesc.trim() || undefined);
                        setTrackingFor(null);
                        setTrackDesc("");
                      })} />
                  </View>
                ) : (
                  <Pressable onPress={() => { setTrackingFor(s.id); setTrackCode("IN_TRANSIT"); }}
                    style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Ionicons name="add-circle-outline" size={15} color={theme.primary} />
                    <ThemedText type="small" style={{ color: theme.primary }}>
                      Add tracking update
                    </ThemedText>
                  </Pressable>
                )
              ) : null}
            </View>
          ))}

          {order.returns.map((ret) => (
            <View key={ret.id} style={{ borderWidth: 1, borderColor: theme.warning,
              borderRadius: 12, padding: 12, gap: 8 }}>
              <ThemedText type="smallBold" style={{ color: theme.text }}>
                Return requested · {ret.status.replaceAll("_", " ").toLowerCase()}
              </ThemedText>
              {(ret.description ?? ret.decisionReason) ? (
                <ThemedText type="small" style={{ color: theme.textSecondary }}>{ret.description ?? ret.decisionReason}</ThemedText>
              ) : null}
              {ret.status === "REQUESTED" || ret.status === "UNDER_REVIEW" ? (
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton label="Approve" loading={busy}
                      onPress={() => void act(() => api.decideReturn(shopId!, ret.id, true))} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton label="Decline" variant="secondary" loading={busy}
                      onPress={() => void act(() => api.decideReturn(shopId!, ret.id, false, "Declined by seller"))} />
                  </View>
                </View>
              ) : null}
              {["AWAITING_RETURN", "RETURN_IN_TRANSIT", "RECEIVED", "INSPECTED"].includes(ret.status) ? (
                <PrimaryButton label="Received — issue refund" loading={busy}
                  onPress={() => Alert.alert("Confirm receipt",
                    "This marks the returned items as received and issues the refund.",
                    [
                      { text: "Cancel", style: "cancel" },
                      { text: "Confirm & refund",
                        onPress: () => void act(() => api.receiveReturn(shopId!, ret.id)) },
                    ])} />
              ) : null}
            </View>
          ))}
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
