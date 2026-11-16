import React, { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
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
import { SellerTypeBadge, StatusPill } from "../components/shop-ui";
import type { Dashboard, PaymentAccount, SellerShopDetail } from "../types/shop-types";

/** Seller workspace hub — readiness checks, stats, navigation to all seller tools. */
export default function SellerDashboardScreen() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { apiClient } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);
  const [detail, setDetail] = useState<SellerShopDetail | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [paymentAccount, setPaymentAccount] = useState<PaymentAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const load = useCallback(async () => {
    if (!shopId) return;
    try {
      const [d, dash, acct] = await Promise.all([
        api.shopDetail(shopId),
        api.dashboard(shopId).catch(() => null),
        api.paymentAccount(shopId).catch(() => null),
      ]);
      setDetail(d);
      setDashboard(dash);
      setPaymentAccount(acct);
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load your shop.");
    } finally {
      setLoading(false);
    }
  }, [api, shopId]);

  // Re-load on focus so readiness/payout state is fresh after setup screens.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (loading) return <LoadingScreen />;
  if (error || !detail) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }}>
          <ErrorState message={error ?? "Shop not found"} onRetry={() => void load()} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  const shop = detail.shop;
  const base = `/(app)/shop/seller` as const;
  const failedChecks = detail.readiness?.filter((r) => !r.ok) ?? [];

  /** Route the seller at the failing readiness item, not a generic page. */
  const continueSetup = () => {
    const key = failedChecks[0]?.key;
    const route = key === "PAYMENT_ACCOUNT" ? `${base}/manage?shopId=${shop.id}&tab=earnings`
      : key === "SHIPPING_PROFILE" || key === "SHIPPING_METHODS" || key === "RETURNS_POLICY"
        ? `${base}/shipping?shopId=${shop.id}`
        : `${base}/settings?shopId=${shop.id}`;
    router.push(route as never);
  };

  /** submitShop only validates the shipping/returns trio, not payouts. */
  const publishable = ["DRAFT", "REJECTED"].includes(shop.status) && failedChecks
    .every((c) => !["SHIPPING_PROFILE", "SHIPPING_METHODS", "RETURNS_POLICY"].includes(c.key));

  const publish = async () => {
    setPublishing(true);
    try {
      await api.submitShop(shop.id);
      await load();
    } catch (cause) {
      Alert.alert("Could not publish", ApiError.isApiError(cause) ? cause.userMessage : "Try again.");
    } finally {
      setPublishing(false);
    }
  };

  const menu: { icon: keyof typeof Ionicons.glyphMap; label: string; route: string }[] = [
    { icon: "pricetags-outline", label: "Products", route: `${base}/products?shopId=${shop.id}` },
    { icon: "cube-outline", label: "Orders", route: `${base}/orders?shopId=${shop.id}` },
    { icon: "layers-outline", label: "Inventory & shipping", route: `${base}/manage?shopId=${shopId}&tab=inventory` },
    { icon: "cash-outline", label: "Earnings & payouts", route: `${base}/manage?shopId=${shopId}&tab=earnings` },
    { icon: "boat-outline", label: "Shipping & returns", route: `${base}/shipping?shopId=${shop.id}` },
    { icon: "pricetag-outline", label: "Discount codes", route: `${base}/manage?shopId=${shopId}&tab=discounts` },
    { icon: "star-outline", label: "Reviews", route: `${base}/reviews?shopId=${shop.id}` },
    { icon: "settings-outline", label: "Shop settings", route: `${base}/settings?shopId=${shop.id}` },
  ];

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 12 }}>
          <Pressable onPress={() => router.back()} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <View style={{ flex: 1, gap: 4 }}>
            <ThemedText style={{ color: theme.text, fontSize: 20, fontWeight: "700" }} numberOfLines={1}>
              {shop.name}
            </ThemedText>
            <SellerTypeBadge
              sellerType={detail.seller.sellerType}
              verificationStatus={detail.seller.verificationStatus}
            />
          </View>
          <StatusPill status={shop.status} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 24 }}>
          {failedChecks.length > 0 ? (
            <View style={{ backgroundColor: theme.warningSurface, borderRadius: 14,
              padding: 16, gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="alert-circle-outline" size={18} color={theme.warning} />
                <ThemedText type="smallBold" style={{ color: theme.warning }}>
                  Finish setting up to publish items
                </ThemedText>
              </View>
              {failedChecks.map((r) => (
                <View key={r.key} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                  <Ionicons name="ellipse-outline" size={8} color={theme.warning}
                    style={{ marginTop: 5 }} />
                  <ThemedText type="small" style={{ color: theme.text, flex: 1 }}>
                    {r.message}
                  </ThemedText>
                </View>
              ))}
              <PrimaryButton label="Continue setup" onPress={continueSetup} />
            </View>
          ) : null}

          {publishable ? (
            <View style={{ backgroundColor: theme.successSurface, borderRadius: 14,
              padding: 16, gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="checkmark-circle-outline" size={18} color={theme.success} />
                <ThemedText type="smallBold" style={{ color: theme.success }}>
                  Your shop is ready to go live
                </ThemedText>
              </View>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Shipping, returns and shop details are complete. Publish to make your
                items visible to buyers.
              </ThemedText>
              <PrimaryButton label="Publish shop" loading={publishing}
                onPress={() => void publish()} />
            </View>
          ) : null}

          {paymentAccount && paymentAccount.onboardingStatus !== "ACTIVE" && paymentAccount.onboardingStatus !== "COMPLETE" ? (
            <View style={{ backgroundColor: theme.infoSurface, borderRadius: 14,
              padding: 16, gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="card-outline" size={18} color={theme.info} />
                <ThemedText type="smallBold" style={{ color: theme.info }}>
                  Payout account: {paymentAccount.onboardingStatus.replaceAll("_", " ").toLowerCase()}
                </ThemedText>
              </View>
              <PrimaryButton label="Finish payout setup" variant="secondary"
                onPress={() => router.push(`${base}/manage?shopId=${shop.id}&tab=earnings` as never)} />
            </View>
          ) : null}

          <View style={{ flexDirection: "row", gap: 10 }}>
            {([
              ["cube-outline", "New orders", dashboard?.newOrders ?? 0],
              ["send-outline", "To dispatch", dashboard?.awaitingDispatch ?? 0],
              ["alert-circle-outline", "Low stock", dashboard?.lowStock ?? 0],
            ] as const).map(([icon, label, value]) => (
              <View key={label} style={{ flex: 1, backgroundColor: theme.backgroundElement,
                borderRadius: 14, padding: 12, gap: 6 }}>
                <Ionicons name={icon} size={16}
                  color={label === "Low stock" && value > 0 ? theme.warning : theme.primary} />
                <ThemedText type="smallBold" style={{ color: theme.text, fontSize: 18 }}>
                  {value}
                </ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>{label}</ThemedText>
              </View>
            ))}
          </View>

          <View style={{ backgroundColor: theme.backgroundElement, borderRadius: 14, overflow: "hidden" }}>
            {menu.map((item, index) => (
              <Pressable key={item.route} onPress={() => router.push(item.route as never)}
                style={({ pressed }) => ({
                  flexDirection: "row", alignItems: "center", gap: 12, padding: 14,
                  borderTopWidth: index === 0 ? 0 : 1, borderTopColor: theme.border,
                  opacity: pressed ? 0.7 : 1,
                })}>
                <View style={{ width: 32, height: 32, borderRadius: 10,
                  backgroundColor: theme.background, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={item.icon} size={17} color={theme.primary} />
                </View>
                <ThemedText style={{ color: theme.text, flex: 1 }}>{item.label}</ThemedText>
                <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
