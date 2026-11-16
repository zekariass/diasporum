/**
 * Shop marketplace Profile tab — the buyer/seller account hub inside the
 * marketplace: identity header plus links to favourites, orders, cart and
 * seller tools. The main Diasporum profile stays reachable at the bottom.
 */

import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { createShopApi } from "../services/shop-api";
import { useMarket } from "../services/use-market";

type MenuItem = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  route: string;
  badge?: number;
};

function MenuSection({ title, items }: { title: string; items: MenuItem[] }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <View style={styles.section}>
      <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
        {title}
      </ThemedText>
      <View style={[styles.menuCard, { backgroundColor: theme.backgroundElement }]}>
        {items.map((item, index) => (
          <Pressable
            key={item.route + item.label}
            onPress={() => router.push(item.route as never)}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.menuRow,
              index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons name={item.icon} size={20} color={theme.primary} />
            <ThemedText style={[styles.menuLabel, { color: theme.text }]}>
              {item.label}
            </ThemedText>
            {item.badge != null && item.badge > 0 ? (
              <View style={[styles.badge, { backgroundColor: theme.primary }]}>
                <ThemedText style={styles.badgeText}>
                  {item.badge > 99 ? "99+" : item.badge}
                </ThemedText>
              </View>
            ) : null}
            <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function ShopProfileScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { apiClient, session } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);
  const { market } = useMarket();
  const [cartCount, setCartCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api.cartCount()
        .then((r) => { if (!cancelled) setCartCount(r.count); })
        .catch(() => {});
      return () => { cancelled = true; };
    }, [api]),
  );

  const displayName = session?.profile?.displayName ?? "Marketplace account";
  const username = session?.profile?.username;
  const initial = displayName.trim().charAt(0).toUpperCase() || "?";

  const shopping: MenuItem[] = [
    { icon: "heart-outline", label: "Favourites", route: "/(app)/shop/wishlist" },
    { icon: "cube-outline", label: "Orders", route: "/(app)/shop/orders" },
    { icon: "cart-outline", label: "Cart", route: "/(app)/shop/cart", badge: cartCount },
    { icon: "location-outline", label: "Saved addresses", route: "/(app)/shop/addresses" },
  ];
  const selling: MenuItem[] = [
    { icon: "storefront-outline", label: "Your shops", route: "/(app)/shop/sell" },
  ];
  const account: MenuItem[] = [
    { icon: "person-outline", label: "Diasporum profile", route: "/(app)/(tabs)/profile" },
  ];

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable
            onPress={() => router.push("/(app)/(tabs)/profile" as never)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.identity, pressed && { opacity: 0.8 }]}
          >
            <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={[styles.avatarText, { color: theme.textSecondary }]}>
                {initial}
              </ThemedText>
            </View>
            <View style={styles.identityText}>
              <ThemedText style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                {displayName}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {username ? `@${username} · ` : ""}
                {market ? `Shopping in ${market.countryName}` : "Shopping"}
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
          </Pressable>

          <MenuSection title="Shopping" items={shopping} />
          <MenuSection title="Selling" items={selling} />
          <MenuSection title="Account" items={account} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  content: { padding: 16, gap: 20 },
  identity: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { fontSize: 22, fontWeight: "700" },
  identityText: { flex: 1, gap: 2 },
  name: { fontSize: 20, fontWeight: "700" },
  section: { gap: 8 },
  sectionTitle: {
    fontSize: 13, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 0.4,
  },
  menuCard: { borderRadius: 14, overflow: "hidden" },
  menuRow: {
    flexDirection: "row", alignItems: "center", gap: 12, padding: 14,
  },
  menuLabel: { flex: 1, fontSize: 15 },
  badge: {
    minWidth: 20, height: 20, borderRadius: 10,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 5,
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
});
