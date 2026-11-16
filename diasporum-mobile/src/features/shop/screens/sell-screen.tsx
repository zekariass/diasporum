import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
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
import { ShopEmpty, StatusPill } from "../components/shop-ui";
import type { SellerShop } from "../types/shop-types";

/** Sell tab — onboarding entry for new sellers, dashboard for existing ones. */
export default function SellScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { apiClient, session } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);

  const [sellers, setSellers] = useState<SellerShop[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [onboardError, setOnboardError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSellers(await api.sellerShops());
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load your shops.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const startOnboarding = useCallback(async () => {
    setOnboarding(true);
    setOnboardError(null);
    try {
      const countryId = session?.profile?.currentCountryId ?? session?.profile?.originCountryId;
      if (!countryId) throw new Error("Set your country in your profile first.");
      const displayName = session?.profile?.displayName ?? "My shop";
      const seller = await api.createSeller({
        sellerType: "INDIVIDUAL", legalCountryId: countryId,
        legalName: displayName, displayName,
      });
      const created = await api.createShop({
        sellerId: seller.id, name: `${displayName}'s shop`, marketCountryId: countryId,
      });
      router.push(`/(app)/shop/seller?shopId=${created.shop.id}` as never);
    } catch (cause) {
      setOnboardError(ApiError.isApiError(cause) ? cause.userMessage : "Could not start selling.");
    } finally {
      setOnboarding(false);
    }
  }, [api, router]);

  if (loading) return <LoadingScreen />;

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : !sellers || sellers.length === 0 ? (
          <View style={{ flex: 1, padding: 24, justifyContent: "center", gap: 18 }}>
            <Ionicons name="storefront-outline" size={56} color={theme.primary} />
            <ThemedText style={{ color: theme.text, fontSize: 20, fontWeight: "700" }}>Sell on Diasporum</ThemedText>
            <ThemedText style={{ color: theme.textSecondary, lineHeight: 21 }}>
              List items from your diaspora community — clothing, food, crafts and more.
              Set up your shop in a few steps, upload products, and start selling.
            </ThemedText>
            {onboardError ? (
              <ThemedText style={{ color: theme.error }}>{onboardError}</ThemedText>
            ) : null}
            <PrimaryButton label="Start selling" onPress={() => void startOnboarding()} loading={onboarding} />
            <Pressable onPress={() => router.push("/(app)/shop/seller/onboarding?type=business" as never)}>
              <ThemedText style={{ color: theme.primary, textAlign: "center" }}>
                Sell as a business instead
              </ThemedText>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={sellers}
            keyExtractor={(s) => s.id}
            refreshControl={<RefreshControl refreshing={false}
              onRefresh={() => void load()} tintColor={theme.primary} />}
            contentContainerStyle={{ padding: 16, gap: 12 }}
            ListHeaderComponent={
              <View style={{ gap: 4, marginBottom: 8 }}>
                <ThemedText style={{ color: theme.text, fontSize: 20, fontWeight: "700" }}>Sell</ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  Your shops and listings
                </ThemedText>
              </View>
            }
            renderItem={({ item: seller }) => (
              <Pressable
                onPress={() => router.push(`/(app)/shop/seller?shopId=${seller.id}` as never)}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  flexDirection: "row", alignItems: "center", gap: 12,
                  backgroundColor: theme.backgroundElement, borderRadius: 14,
                  padding: 14, opacity: pressed ? 0.8 : 1,
                })}
              >
                <Ionicons
                  name={seller.sellerType === "BUSINESS" ? "briefcase" : "storefront"}
                  size={30} color={theme.primary}
                />
                <View style={{ flex: 1, gap: 4 }}>
                  <ThemedText type="smallBold" style={{ color: theme.text }}>
                    {seller.name}
                  </ThemedText>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <StatusPill status={seller.status} />
                    <ThemedText type="small" style={{ color: theme.textMuted }}>
                      {seller.sellerType === "BUSINESS" ? "Business" : "Individual"}
                    </ThemedText>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
              </Pressable>
            )}
            ListFooterComponent={
              <View style={{ alignItems: "center", gap: 10, padding: 10 }}>
                <Pressable onPress={() => router.push("/(app)/shop/seller/onboarding?type=individual" as never)}>
                  <ThemedText style={{ color: theme.primary }}>Add another listing shop</ThemedText>
                </Pressable>
                <Pressable onPress={() => router.push("/(app)/shop/seller/onboarding?type=business" as never)}>
                  <ThemedText style={{ color: theme.primary }}>Open a business shop</ThemedText>
                </Pressable>
              </View>
            }
            ListEmptyComponent={
              <ShopEmpty icon="storefront-outline" title="No shops yet"
                message="Create your first shop to start selling." />
            }
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}
