import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ErrorState } from "@/shared/components/error-state";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import { BrandColors } from "@/shared/theme/colors";
import { createShopApi } from "../services/shop-api";
import { useMarket } from "../services/use-market";
import { ShopEmpty, ShopProductCard } from "../components/shop-ui";
import { ShopCategoriesDrawer, ShopFilterSortDrawer } from "../components/shop-filter-drawers";
import type { Category, ProductCard } from "../types/shop-types";

/** Browse tab — full search with category, condition, price and sort filters. */
export default function BrowseScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);
  const { market } = useMarket();
  const { width } = useWindowDimensions();
  const cardWidth = (width - 16 * 2 - 12) / 2;

  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [condition, setCondition] = useState<string | null>(null);
  const [sort, setSort] = useState("RELEVANCE");
  const [drawer, setDrawer] = useState<"categories" | "filters" | null>(null);
  const [items, setItems] = useState<ProductCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async (nextCursor?: string) => {
    if (!market || loadingRef.current) return;
    loadingRef.current = true;
    try {
      const page = await api.search({
        marketCountryId: market.countryId, q: submitted || undefined,
        categoryId: categoryId ?? undefined,
        conditions: condition ? [condition] : undefined,
        sort: submitted ? sort : (sort === "RELEVANCE" ? "NEWEST" : sort),
      }, nextCursor, 20);
      setItems((current) => {
        if (!nextCursor) return page.items;
        const ids = new Set(current.map((i) => i.id));
        return [...current, ...page.items.filter((i) => !ids.has(i.id))];
      });
      setCursor(page.nextCursor);
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Search failed.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, market, submitted, categoryId, condition, sort]);

  useEffect(() => {
    queueMicrotask(() => {
      if (!market) return;
      setItems([]);
      setCursor(null);
      void load();
    });
  }, [market, load]);

  useEffect(() => {
    if (!market) return;
    api.categories().then(setCategories).catch(() => setCategories([]));
  }, [api, market]);

  const toggleFavourite = useCallback((product: ProductCard) => {
    setItems((current) => current.map((i) => i.id === product.id
        ? { ...i, favourited: !i.favourited } : i));
    (product.favourited ? api.unfavourite(product.id) : api.favourite(product.id)).catch(() => {});
  }, [api]);

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View style={{ padding: 16, paddingBottom: 8, gap: 10 }}>
          <View style={{
            flexDirection: "row", alignItems: "center", gap: 8,
            backgroundColor: theme.backgroundElement, borderRadius: 12, paddingHorizontal: 12,
          }}>
            <Ionicons name="search" size={18} color={theme.textSecondary} />
            <TextInput
              value={q}
              onChangeText={setQ}
              onSubmitEditing={() => setSubmitted(q.trim())}
              placeholder="Search items and brands"
              placeholderTextColor={theme.textMuted}
              returnKeyType="search"
              autoCapitalize="none"
              style={{ flex: 1, paddingVertical: 11, color: theme.text, fontSize: 15 }}
            />
            {q.length > 0 && (
              <Ionicons name="close-circle" size={18} color={theme.textMuted}
                onPress={() => { setQ(""); setSubmitted(""); }} />
            )}
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <DrawerButton
              icon="grid-outline"
              label="Categories"
              activeCount={categoryId ? 1 : 0}
              onPress={() => setDrawer("categories")}
            />
            <DrawerButton
              icon="options-outline"
              label="Filter & Sort"
              activeCount={(condition ? 1 : 0) + (sort !== "RELEVANCE" ? 1 : 0)}
              onPress={() => setDrawer("filters")}
            />
          </View>
        </View>
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{ padding: 16, gap: 12, paddingTop: 4, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.primary} />}
          onEndReachedThreshold={0.5}
          onEndReached={() => { if (cursor) void load(cursor); }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          renderItem={({ item }) => (
            <ShopProductCard product={item} width={cardWidth}
              onPress={() => router.push(`/(app)/shop/product/${item.id}?market=${market?.countryId}` as never)}
              onFavourite={() => toggleFavourite(item)} />
          )}
          ListEmptyComponent={
            loading ? <></> : error ? (
              <ErrorState message={error} onRetry={() => void load()} />
            ) : (
              <ShopEmpty icon="search" title="No results"
                message={submitted ? `Nothing found for "${submitted}".` : "Try a search or browse categories."} />
            )
          }
        />
      </SafeAreaView>
      {drawer === "categories" && (
        <ShopCategoriesDrawer
          categories={categories}
          selectedId={categoryId}
          onApply={(id) => { setCategoryId(id); setDrawer(null); }}
          onClose={() => setDrawer(null)}
        />
      )}
      {drawer === "filters" && (
        <ShopFilterSortDrawer
          selection={{ sort, condition }}
          onApply={(sel) => { setSort(sel.sort); setCondition(sel.condition); setDrawer(null); }}
          onClose={() => setDrawer(null)}
        />
      )}
    </ThemedView>
  );
}

/** Pill button that opens a filter drawer; badge shows the active filter count. */
function DrawerButton({
  icon,
  label,
  activeCount,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  activeCount: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [{
        flexDirection: "row", alignItems: "center", gap: 6,
        backgroundColor: theme.backgroundElement, borderRadius: 999,
        paddingHorizontal: 14, paddingVertical: 9,
      }, pressed && { opacity: 0.85 }]}
    >
      <Ionicons name={icon} size={16} color={theme.text} />
      <ThemedText style={{ fontSize: 13, fontWeight: "600", color: theme.text }}>{label}</ThemedText>
      {activeCount > 0 && (
        <View style={{
          minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5,
          backgroundColor: BrandColors.primary, alignItems: "center", justifyContent: "center",
        }}>
          <ThemedText style={{ fontSize: 11, fontWeight: "800", color: BrandColors.white }}>
            {activeCount}
          </ThemedText>
        </View>
      )}
    </Pressable>
  );
}
