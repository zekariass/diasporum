import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";

import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { KeyboardAvoiding } from "@/shared/components/keyboard-aware-scroll-view";
import { ErrorState } from "@/shared/components/error-state";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import { createShopApi } from "../services/shop-api";
import { formatMoney, ShopEmpty } from "../components/shop-ui";
import type { AddressView, CheckoutQuote } from "../types/shop-types";

export default function CheckoutScreen() {
  const { market } = useLocalSearchParams<{ market?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);

  const [addresses, setAddresses] = useState<AddressView[]>([]);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [addingAddress, setAddingAddress] = useState(false);
  const [form, setForm] = useState({ line1: "", line2: "", city: "", region: "", postalCode: "", recipientName: "" });
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [discountCode, setDiscountCode] = useState("");
  const [appliedCodes, setAppliedCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [quoting, setQuoting] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.addresses();
      setAddresses(list);
      setAddressId((current) => current ?? list[0]?.id ?? null);
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load checkout.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const requote = useCallback(async (nextAddressId: string | null, nextSelections?: Record<string, string>, codes?: string[]) => {
    if (!market || !nextAddressId) return;
    setQuoting(true);
    try {
      setQuote(await api.quote({
        marketCountryId: market, shippingAddressId: nextAddressId,
        recipientName: form.recipientName || undefined,
        shippingSelections: nextSelections ?? selections,
        discountCodes: codes ?? appliedCodes,
      }));
      setError(null);
    } catch (cause) {
      setQuote(null);
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not price your order.");
    } finally {
      setQuoting(false);
    }
  }, [api, market, form.recipientName, selections, appliedCodes]);

  useEffect(() => { queueMicrotask(() => { if (addressId) void requote(addressId); }); }, [addressId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveAddress = useCallback(async () => {
    if (!market || !form.line1 || !form.city || !form.postalCode) return;
    try {
      const created = await api.createAddress({
        countryId: market, line1: form.line1, line2: form.line2 || null,
        city: form.city, region: form.region || null, postalCode: form.postalCode,
      });
      setAddresses((list) => [...list, created]);
      setAddressId(created.id);
      setAddingAddress(false);
    } catch (cause) {
      Alert.alert("Address error", ApiError.isApiError(cause) ? cause.userMessage : "Try again.");
    }
  }, [api, market, form]);

  const applyDiscount = useCallback(() => {
    const code = discountCode.trim();
    if (!code || appliedCodes.includes(code)) return;
    const next = [...appliedCodes, code];
    setAppliedCodes(next);
    setDiscountCode("");
    void requote(addressId, selections, next);
  }, [discountCode, appliedCodes, addressId, selections, requote]);

  const placeOrder = useCallback(async () => {
    if (!market || !addressId || !quote) return;
    setPlacing(true);
    try {
      const placed = await api.place(quote!.checkoutSessionId);
      if (placed.paymentUrl) {
        await Linking.openURL(placed.paymentUrl);
      }
      router.replace(`/(app)/shop/orders/${placed.orderId}` as never);
    } catch (cause) {
      Alert.alert("Order failed", ApiError.isApiError(cause) ? cause.userMessage : "Try again.");
    } finally {
      setPlacing(false);
    }
  }, [api, market, addressId, form.recipientName, selections, appliedCodes, router]);

  if (loading) return <LoadingScreen />;

  const inputStyle = {
    borderWidth: 1, borderColor: theme.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, color: theme.text, fontSize: 15,
  } as const;

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 12 }}>
          <Pressable onPress={() => router.back()} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={{ color: theme.text, fontSize: 20, fontWeight: "700" }}>Checkout</ThemedText>
        </View>
        <KeyboardAvoiding>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled" keyboardDismissMode="none">
          <View style={{ gap: 8 }}>
            <ThemedText type="subtitle" style={{ color: theme.text }}>Delivery address</ThemedText>
            {addresses.map((address) => (
              <Pressable key={address.id} onPress={() => setAddressId(address.id)}
                style={{ flexDirection: "row", gap: 10, alignItems: "center",
                  borderWidth: 1.5, borderRadius: 12, padding: 12,
                  borderColor: addressId === address.id ? theme.primary : theme.border }}>
                <Ionicons name={addressId === address.id ? "radio-button-on" : "radio-button-off"}
                  size={18} color={addressId === address.id ? theme.primary : theme.textMuted} />
                <ThemedText style={{ color: theme.text, flex: 1 }}>{address.formatted}</ThemedText>
              </Pressable>
            ))}
            {addingAddress ? (
              <View style={{ gap: 8 }}>
                {(["line1", "line2", "city", "region", "postalCode", "recipientName"] as const).map((key) => (
                  <TextInput key={key} value={form[key]}
                    onChangeText={(v) => setForm((f) => ({ ...f, [key]: v }))}
                    placeholder={key === "recipientName" ? "Recipient name (optional)"
                      : key === "line2" ? "Address line 2 (optional)"
                      : { line1: "Address line 1", city: "City", region: "Region/state", postalCode: "Postal code" }[key]}
                    placeholderTextColor={theme.textMuted} style={inputStyle} />
                ))}
                <PrimaryButton label="Save address" onPress={() => void saveAddress()} />
              </View>
            ) : (
              <Pressable onPress={() => setAddingAddress(true)} style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                <Ionicons name="add" size={16} color={theme.primary} />
                <ThemedText style={{ color: theme.primary }}>Add a new address</ThemedText>
              </Pressable>
            )}
          </View>

          {error ? <ErrorState message={error} onRetry={() => addressId && void requote(addressId)} /> : null}
          {quoting ? <LoadingScreen /> : quote ? (
            <>
              {quote.groups.map((group) => (
                <View key={group.shopId} style={{ gap: 8 }}>
                  <ThemedText type="subtitle" style={{ color: theme.text }}>{group.shopName}</ThemedText>
                  {group.items.map((line) => (
                    <View key={`${line.variantId}-${line.productName}`}
                      style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <ThemedText style={{ color: theme.textSecondary, flex: 1 }} numberOfLines={1}>
                        {line.quantity} × {line.productName}
                      </ThemedText>
                      <ThemedText style={{ color: theme.text }}>{formatMoney(line.lineTotal)}</ThemedText>
                    </View>
                  ))}
                  <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 4 }}>
                    Shipping
                  </ThemedText>
                  {group.shippingOptions.map((option) => (
                    <Pressable key={option.optionKey}
                      onPress={() => {
                        const next = { ...selections, [group.shopId]: option.optionKey };
                        setSelections(next);
                        void requote(addressId, next);
                      }}
                      style={{ flexDirection: "row", gap: 10, alignItems: "center",
                        borderWidth: 1.5, borderRadius: 12, padding: 12,
                        borderColor: selections[group.shopId] === option.optionKey
                          || (!selections[group.shopId] && group.selectedShipping?.optionKey === option.optionKey)
                          ? theme.primary : theme.border }}>
                      <ThemedText style={{ color: theme.text, flex: 1 }}>
                        {option.name}
                        {option.transitMinDays != null
                          ? ` · ${option.transitMinDays}–${option.transitMaxDays ?? option.transitMinDays} days` : ""}
                      </ThemedText>
                      <ThemedText type="smallBold" style={{ color: theme.text }}>
                        {formatMoney(option.amount)}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              ))}

              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput value={discountCode} onChangeText={setDiscountCode}
                  placeholder="Discount code" placeholderTextColor={theme.textMuted}
                  autoCapitalize="characters" style={[inputStyle, { flex: 1 }]} />
                <Pressable onPress={() => void applyDiscount()}
                  style={{ backgroundColor: theme.backgroundElement, borderRadius: 10,
                    paddingHorizontal: 16, justifyContent: "center" }}>
                  <ThemedText style={{ color: theme.text }}>Apply</ThemedText>
                </Pressable>
              </View>
              {appliedCodes.length > 0 && (
                <ThemedText type="small" style={{ color: theme.success }}>
                  Codes applied: {appliedCodes.join(", ")}
                </ThemedText>
              )}

              <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 12 }}>
                {([["Subtotal", quote.totals.subtotal], ["Discount", quote.totals.discount],
                   ["Shipping", quote.totals.shipping], ["Tax", quote.totals.tax]] as const)
                  .map(([label, money]) => money.amountMinor !== 0 || label === "Subtotal" ? (
                    <View key={label} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <ThemedText style={{ color: theme.textSecondary }}>{label}</ThemedText>
                      <ThemedText style={{ color: theme.text }}>
                        {label === "Discount" ? `−${formatMoney(money)}` : formatMoney(money)}
                      </ThemedText>
                    </View>
                  ) : null)}
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                  <ThemedText type="subtitle" style={{ color: theme.text }}>Total</ThemedText>
                  <ThemedText type="subtitle" style={{ color: theme.text }}>
                    {formatMoney(quote.totals.total)}
                  </ThemedText>
                </View>
              </View>
              {quote.blockingIssues.map((issue) => (
                <ThemedText key={issue} type="small" style={{ color: theme.error }}>• {issue}</ThemedText>
              ))}
            </>
          ) : !error && addressId == null && !addingAddress ? (
            <ShopEmpty icon="location-outline" title="Add a delivery address"
              message="You need a shipping address to check out." />
          ) : null}
        </ScrollView>
        {quote?.canPlaceOrder ? (
          <View style={{ padding: 16, paddingTop: 12, paddingBottom: 28,
            backgroundColor: theme.background,
            borderTopWidth: 1, borderTopColor: theme.border }}>
            <PrimaryButton label={`Pay ${formatMoney(quote.totals.total)}`}
              onPress={() => void placeOrder()} loading={placing} />
          </View>
        ) : null}
        </KeyboardAvoiding>
      </SafeAreaView>
    </ThemedView>
  );
}
