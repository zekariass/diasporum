import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Image, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import { conditionLabel, formatMoney, RatingStars, SectionTitle, SellerTypeBadge } from "../components/shop-ui";
import type { ProductDetail } from "../types/shop-types";

export default function ProductDetailScreen() {
  const { id, market } = useLocalSearchParams<{ id: string; market?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);
  const { width } = useWindowDimensions();

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [favourited, setFavourited] = useState(false);

  const load = useCallback(async () => {
    if (!id || !market) return;
    try {
      const detail = await api.product(id, market);
      setProduct(detail);
      setFavourited(detail.favourited);
      setSelectedVariant(detail.variants[0]?.id ?? null);
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load this item.");
    } finally {
      setLoading(false);
    }
  }, [api, id, market]);

  useEffect(() => { queueMicrotask(() => { setLoading(true); void load(); }); }, [load]);

  const variant = product?.variants.find((v) => v.id === selectedVariant) ?? product?.variants[0];

  const addToCart = useCallback(async () => {
    if (!variant) return;
    setAdding(true);
    try {
      await api.addToCart(variant.id, 1, market!);
      Alert.alert("Added to cart", undefined, [
        { text: "Keep browsing", style: "cancel" },
        { text: "View cart", onPress: () => router.push("/(app)/shop/cart" as never) },
      ]);
    } catch (cause) {
      Alert.alert("Could not add to cart",
        ApiError.isApiError(cause) ? cause.userMessage : "Please try again.");
    } finally {
      setAdding(false);
    }
  }, [api, variant, router]);

  const toggleFavourite = useCallback(async () => {
    if (!product) return;
    const next = !favourited;
    setFavourited(next);
    try {
      if (next) await api.favourite(product.id); else await api.unfavourite(product.id);
    } catch {
      setFavourited(!next);
    }
  }, [api, product, favourited]);

  if (loading) return <LoadingScreen />;
  if (error || !product) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }}>
          <ErrorState message={error ?? "Item not found"} onRetry={() => void load()} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  const soldOut = !product.variants.some((v) => v.available);

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
          <View>
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
              {product.media.length > 0 ? product.media.map((image) => (
                <Image key={image.mediaId} source={{ uri: image.url ?? undefined }}
                  style={{ width, aspectRatio: 1, backgroundColor: theme.backgroundElement }} />
              )) : (
                <View style={{ width, aspectRatio: 1, backgroundColor: theme.backgroundElement,
                  alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="image-outline" size={48} color={theme.textMuted} />
                </View>
              )}
            </ScrollView>
            <View style={{ position: "absolute", top: 12, left: 12, right: 12,
              flexDirection: "row", justifyContent: "space-between" }}>
              <Pressable onPress={() => router.back()} accessibilityLabel="Back"
                style={{ backgroundColor: theme.background, borderRadius: 18, padding: 8 }}>
                <Ionicons name="arrow-back" size={20} color={theme.text} />
              </Pressable>
              <Pressable onPress={() => void toggleFavourite()} accessibilityLabel="Favourite"
                style={{ backgroundColor: theme.background, borderRadius: 18, padding: 8 }}>
                <Ionicons name={favourited ? "heart" : "heart-outline"} size={20}
                  color={favourited ? theme.error : theme.text} />
              </Pressable>
            </View>
          </View>

          <View style={{ padding: 16, gap: 14 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
              <View style={{ flex: 1, gap: 4 }}>
                <ThemedText style={{ color: theme.text, fontSize: 20, fontWeight: "700" }}>
                  {formatMoney(variant?.price)}
                </ThemedText>
                <ThemedText type="subtitle" style={{ color: theme.text }}>{product.name}</ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  {[product.brand, conditionLabel(product.condition)]
                    .filter(Boolean).join(" · ")}
                </ThemedText>
              </View>
            </View>

            {product.variants.length > 1 ? (
              <View style={{ gap: 8 }}>
                <SectionTitle title="Options" />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {product.variants.map((v) => (
                    <Pressable key={v.id} onPress={() => setSelectedVariant(v.id)}
                      style={{
                        borderRadius: 10, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 8,
                        borderColor: v.id === variant?.id ? theme.primary : theme.border,
                        backgroundColor: v.id === variant?.id ? theme.primarySurface : "transparent",
                        opacity: v.available ? 1 : 0.4,
                      }}>
                      <ThemedText type="small" style={{ color: theme.text }}>
                        {v.label}{v.available ? "" : " (sold out)"}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {product.description ? (
              <View style={{ gap: 6 }}>
                <SectionTitle title="Description" />
                <ThemedText style={{ color: theme.textSecondary, lineHeight: 20 }}>
                  {product.description}
                </ThemedText>
              </View>
            ) : null}

            <Pressable
              onPress={() => router.push(`/(app)/shop/shop/${product.shop.shopId}?market=${market}` as never)}
              accessibilityRole="button"
              style={{ flexDirection: "row", alignItems: "center", gap: 12,
                backgroundColor: theme.backgroundElement, borderRadius: 14, padding: 14 }}>
              <Ionicons name="storefront" size={28} color={theme.primary} />
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <ThemedText type="smallBold" style={{ color: theme.text }}>
                    {product.shop.shopName}
                  </ThemedText>
                  <SellerTypeBadge
                    sellerType={product.shop.sellerType}
                    verificationStatus={product.shop.sellerVerificationStatus}
                  />
                </View>
                <RatingStars rating={product.shop.ratingAverage} count={product.shop.ratingCount} />
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
            </Pressable>

            <Pressable
              onPress={() => router.push(`/(app)/shop/message?productId=${product.id}` as never)}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Ionicons name="chatbubble-ellipses-outline" size={16} color={theme.primary} />
              <ThemedText style={{ color: theme.primary }}>Message seller</ThemedText>
            </Pressable>
          </View>
        </ScrollView>

        <View style={{ position: "absolute", bottom: 0, left: 0, right: 0,
          padding: 16, paddingBottom: 28, backgroundColor: theme.background,
          borderTopWidth: 1, borderTopColor: theme.border }}>
          <PrimaryButton
            label={soldOut ? "Sold out" : `Add to cart · ${formatMoney(variant?.price)}`}
            onPress={() => void addToCart()}
            disabled={soldOut}
            loading={adding}
          />
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}
