import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Image, Pressable, useWindowDimensions, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
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
import { RatingStars, SectionTitle, SellerTypeBadge, ShopProductCard } from "../components/shop-ui";
import type { ProductCard, ShopDetail } from "../types/shop-types";

const COVER_HEIGHT = 148;
const LOGO_SIZE = 64;

export default function ShopPageScreen() {
  const { id, market } = useLocalSearchParams<{ id: string; market?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { apiClient } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);
  const { width } = useWindowDimensions();
  const cardWidth = (width - 44) / 2;

  const [shop, setShop] = useState<ShopDetail | null>(null);
  const [items, setItems] = useState<ProductCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async (nextCursor?: string) => {
    if (!id || !market || loadingRef.current) return;
    loadingRef.current = true;
    try {
      if (!nextCursor) setShop(await api.shop(id));
      const page = await api.shopProducts(id, market, { cursor: nextCursor ?? undefined });
      setItems((current) => {
        if (!nextCursor) return page.items;
        const ids = new Set(current.map((i) => i.id));
        return [...current, ...page.items.filter((i) => !ids.has(i.id))];
      });
      setCursor(page.nextCursor);
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load this shop.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [api, id, market]);

  useEffect(() => { queueMicrotask(() => { setLoading(true); void load(); }); }, [load]);

  if (loading) return <LoadingScreen />;
  if (error || !shop) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }}>
          <ErrorState message={error ?? "Shop not found"} onRetry={() => void load()} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{ paddingHorizontal: 16, rowGap: 14, paddingBottom: insets.bottom + 24 }}
          onEndReachedThreshold={0.5}
          onEndReached={() => { if (cursor) void load(cursor); }}
          renderItem={({ item }) => (
            <ShopProductCard product={item} width={cardWidth}
              onPress={() => router.push(`/(app)/shop/product/${item.id}?market=${market}` as never)} />
          )}
          ListHeaderComponent={
            <View style={{ marginHorizontal: -16, marginBottom: 8 }}>
              {/* Cover banner */}
              <View style={{ height: COVER_HEIGHT, backgroundColor: theme.backgroundElement }}>
                {shop.coverUrl ? (
                  <Image source={{ uri: shop.coverUrl }}
                    style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                ) : (
                  <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="storefront-outline" size={36} color={theme.textMuted} />
                  </View>
                )}
                <Pressable onPress={() => router.back()} accessibilityLabel="Back"
                  style={{ position: "absolute", top: 12, left: 16, width: 36, height: 36,
                    borderRadius: 18, backgroundColor: theme.background,
                    alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="arrow-back" size={20} color={theme.text} />
                </Pressable>
              </View>

              <View style={{ paddingHorizontal: 16 }}>
                {/* Logo overlapping the cover */}
                <View style={{ flexDirection: "row", alignItems: "flex-end", marginTop: -LOGO_SIZE / 2, gap: 12 }}>
                  <View style={{ borderRadius: LOGO_SIZE / 2, borderWidth: 3,
                    borderColor: theme.background, overflow: "hidden",
                    backgroundColor: theme.backgroundElement }}>
                    {shop.badge.logoUrl ? (
                      <Image source={{ uri: shop.badge.logoUrl }}
                        style={{ width: LOGO_SIZE, height: LOGO_SIZE }} />
                    ) : (
                      <View style={{ width: LOGO_SIZE, height: LOGO_SIZE,
                        alignItems: "center", justifyContent: "center" }}>
                        <Ionicons name="storefront" size={28} color={theme.primary} />
                      </View>
                    )}
                  </View>
                </View>

                {/* Identity block */}
                <View style={{ gap: 6, marginTop: 10 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <ThemedText style={{ color: theme.text, fontSize: 20, fontWeight: "700" }}>
                      {shop.badge.shopName}
                    </ThemedText>
                    <SellerTypeBadge
                      sellerType={shop.badge.sellerType}
                      verificationStatus={shop.badge.sellerVerificationStatus}
                    />
                  </View>
                  <RatingStars rating={shop.badge.ratingAverage} count={shop.badge.ratingCount} />
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <ThemedText type="small" style={{ color: theme.textSecondary }}>
                      {shop.productCount} items
                    </ThemedText>
                    {shop.badge.sellerCountryName ? (
                      <>
                        <ThemedText type="small" style={{ color: theme.textMuted }}>·</ThemedText>
                        <Ionicons name="location-outline" size={13} color={theme.textSecondary} />
                        <ThemedText type="small" style={{ color: theme.textSecondary }}>
                          {shop.badge.sellerCountryName}
                        </ThemedText>
                      </>
                    ) : null}
                  </View>
                  {shop.description ? (
                    <ThemedText style={{ color: theme.textSecondary, lineHeight: 20, marginTop: 2 }}>
                      {shop.description}
                    </ThemedText>
                  ) : null}
                </View>

                {/* Message CTA */}
                <Pressable
                  onPress={() => router.push(`/(app)/shop/message?shopId=${id}` as never)}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                    borderWidth: 1, borderColor: theme.primary, borderRadius: 12,
                    paddingVertical: 11, marginTop: 14, opacity: pressed ? 0.8 : 1,
                  })}>
                  <Ionicons name="chatbubble-ellipses-outline" size={17} color={theme.primary} />
                  <ThemedText type="smallBold" style={{ color: theme.primary }}>Message shop</ThemedText>
                </Pressable>

                <View style={{ marginTop: 16 }}>
                  <SectionTitle title="Items" />
                </View>
              </View>
            </View>
          }
        />
      </SafeAreaView>
    </ThemedView>
  );
}
