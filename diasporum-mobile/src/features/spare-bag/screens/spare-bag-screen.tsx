import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ErrorState } from "@/shared/components/error-state";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createSpareBagApi } from "../services/spare-bag-api";
import type { Listing, ListingCounts, ListingType } from "../types/spare-bag-types";
import { DiscoveryCardSkeleton, DiscoveryListingCard } from "../components/discovery-card";
import { CreateListingSheet } from "../components/discovery-sheets";
import { SafetyNotice, ScreenHeader } from "../components/spare-bag-ui";
import { SpareBagMenuDrawer } from "../components/spare-bag-menu-drawer";

const TABS: { value: ListingType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "SENDER_REQUEST", label: "Sender Requests", icon: "cube-outline" },
  { value: "PASSENGER_OFFER", label: "Traveller Offers", icon: "airplane-outline" },
];

export default function SpareBagScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { apiClient } = useSession();
  const api = useMemo(() => createSpareBagApi(apiClient), [apiClient]);

  const [items, setItems] = useState<Listing[]>([]);
  const [tab, setTab] = useState<ListingType>("SENDER_REQUEST");
  const [counts, setCounts] = useState<ListingCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const requestSerial = useRef(0);

  const load = useCallback(() => {
    const request = ++requestSerial.current;
    return api
      .discover({ sort: "NEWEST", listingType: tab })
      .then((page) => {
        if (request !== requestSerial.current) return;
        setItems(page.items);
        setError(null);
      })
      .catch((cause) => {
        if (request !== requestSerial.current) return;
        setError(
          ApiError.isApiError(cause)
            ? cause.userMessage
            : "Could not load Spare Bag listings.",
        );
      })
      .finally(() => {
        if (request !== requestSerial.current) return;
        setLoading(false);
        setRefreshing(false);
      });
  }, [api, tab]);

  // Show skeletons again while the newly selected tab loads.
  const [previousTab, setPreviousTab] = useState(tab);
  if (tab !== previousTab) {
    setPreviousTab(tab);
    setLoading(true);
  }

  useEffect(() => {
    void load();
    return () => {
      requestSerial.current += 1;
    };
  }, [load]);

  useEffect(() => {
    let active = true;
    api
      .counts({})
      .then((result) => {
        if (active) setCounts(result);
      })
      .catch(() => {
        if (active) setCounts(null);
      });
    return () => {
      active = false;
    };
  }, [api]);

  async function toggleSave(listing: Listing) {
    setSavingId(listing.id);
    setError(null);
    try {
      if (listing.saved) await api.unsave(listing.id);
      else await api.save(listing.id);
      setItems((current) =>
        current.map((item) =>
          item.id === listing.id ? { ...item, saved: !item.saved } : item,
        ),
      );
    } catch (cause) {
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "Could not update the saved listing.",
      );
    } finally {
      setSavingId(null);
    }
  }

  const sender = tab === "SENDER_REQUEST";

  const header = (
    <View style={styles.headerContent}>
      <View style={[styles.hero, { backgroundColor: theme.primarySurface }]}>
        <View style={[styles.heroIcon, { backgroundColor: theme.background }]}>
          <Ionicons name="airplane" size={20} color={theme.primary} />
        </View>
        <View style={styles.heroCopy}>
          <ThemedText style={styles.heroTitle}>Send parcels with travellers.</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            Matched by route and travel dates.
          </ThemedText>
        </View>
      </View>

      <View style={[styles.tabs, { backgroundColor: theme.backgroundElement }]}>
        {TABS.map((item) => {
          const selected = tab === item.value;
          const count = item.value === "SENDER_REQUEST" ? counts?.senderRequests : counts?.passengerOffers;
          return (
            <Pressable
              key={item.value}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ selected }}
              onPress={() => setTab(item.value)}
              style={[
                styles.tab,
                {
                  borderColor: selected ? theme.primary : theme.backgroundElement,
                  backgroundColor: selected ? theme.primary : theme.background,
                },
              ]}
            >
              <Ionicons name={item.icon} size={16} color={selected ? "#fff" : theme.primary} />
              <ThemedText
                type="smallBold"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={{ color: selected ? "#fff" : theme.text }}
              >
                {item.label}
                {count != null ? ` (${count})` : ""}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.sectionHeader}>
        <ThemedText style={styles.sectionTitle}>Latest listings</ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="See all listings"
          onPress={() => router.push("/(app)/spare-bag/discover" as never)}
          hitSlop={8}
          style={({ pressed }) => [styles.seeAll, pressed && styles.pressed]}
        >
          <ThemedText type="smallBold" style={{ color: theme.primary }}>See all</ThemedText>
          <Ionicons name="chevron-forward" size={15} color={theme.primary} />
        </Pressable>
      </View>

      {error && items.length ? (
        <View style={[styles.errorBanner, { backgroundColor: theme.errorSurface }]}>
          <Ionicons name="alert-circle-outline" size={18} color={theme.error} />
          <ThemedText accessibilityRole="alert" style={[styles.errorText, { color: theme.error }]}>
            {error}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <ScreenHeader
          title="Spare Bag"
          left={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Spare Bag menu"
              onPress={() => setMenuOpen(true)}
              hitSlop={8}
              style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}
            >
              <Ionicons name="menu" size={24} color={theme.text} />
            </Pressable>
          }
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create a listing"
              onPress={() => setCreateOpen(true)}
              style={({ pressed }) => [
                styles.createButton,
                { backgroundColor: theme.primary },
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="add" size={19} color="#fff" />
              <ThemedText style={styles.createLabel}>Create</ThemedText>
            </Pressable>
          }
        />
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <DiscoveryListingCard
              client={apiClient}
              listing={item}
              onToggleSave={() => void toggleSave(item)}
              saveLoading={savingId === item.id}
            />
          )}
          ListHeaderComponent={header}
          ListEmptyComponent={
            loading ? (
              <View style={styles.skeletons}>
                <DiscoveryCardSkeleton />
                <DiscoveryCardSkeleton />
              </View>
            ) : error ? (
              <ErrorState
                message={error}
                onRetry={() => {
                  setLoading(true);
                  void load();
                }}
              />
            ) : (
              <View style={styles.empty}>
                <View style={[styles.emptyIcon, { backgroundColor: theme.primarySurface }]}>
                  <Ionicons name={sender ? "cube-outline" : "airplane-outline"} size={30} color={theme.primary} />
                </View>
                <ThemedText style={styles.emptyTitle}>
                  {sender ? "No sender requests yet" : "No traveller offers yet"}
                </ThemedText>
                <ThemedText themeColor="textSecondary" style={styles.emptyMessage}>
                  Be the first — send a parcel or offer spare space on your next trip.
                </ThemedText>
                <PrimaryButton label="Create a listing" onPress={() => setCreateOpen(true)} />
              </View>
            )
          }
          ListFooterComponent={items.length ? <SafetyNotice compact /> : undefined}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.four }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={theme.primary}
            />
          }
        />
      </SafeAreaView>
      {menuOpen ? <SpareBagMenuDrawer onClose={() => setMenuOpen(false)} /> : null}
      <CreateListingSheet
        visible={createOpen}
        onSelect={(type) =>
          router.push(
            type === "PASSENGER_OFFER"
              ? ("/(app)/spare-bag/create-passenger" as never)
              : ("/(app)/spare-bag/create-sender" as never),
          )
        }
        onClose={() => setCreateOpen(false)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: Spacing.three, paddingTop: Spacing.two, gap: Spacing.three, flexGrow: 1, width: "100%", maxWidth: 720, alignSelf: "center" },
  headerContent: { gap: Spacing.three, paddingBottom: Spacing.one },
  hero: { flexDirection: "row", alignItems: "center", gap: Spacing.three, borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  heroIcon: { width: 40, height: 40, borderRadius: BorderRadius.md, alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, minWidth: 0, gap: 1 },
  heroTitle: { fontSize: 17, lineHeight: 23, fontWeight: "800", letterSpacing: -0.2 },
  tabs: { flexDirection: "row", gap: Spacing.one, padding: Spacing.one, borderRadius: BorderRadius.lg },
  tab: { flex: 1, minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.one, borderWidth: 1, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.one },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.two },
  sectionTitle: { fontSize: 20, lineHeight: 26, fontWeight: "700" },
  seeAll: { flexDirection: "row", alignItems: "center", gap: 2 },
  menuButton: { width: 36, height: 40, alignItems: "center", justifyContent: "center", marginLeft: -Spacing.two },
  createButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.one, minHeight: 40, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.three },
  createLabel: { color: "#fff", fontSize: 14, lineHeight: 20, fontWeight: "700" },
  errorBanner: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.two, borderRadius: BorderRadius.md, padding: Spacing.three },
  errorText: { flex: 1, fontSize: 14, lineHeight: 20 },
  skeletons: { gap: Spacing.three },
  empty: { alignItems: "center", paddingHorizontal: Spacing.four, paddingVertical: Spacing.five, gap: Spacing.two },
  emptyIcon: { width: 72, height: 72, borderRadius: BorderRadius.full, alignItems: "center", justifyContent: "center", marginBottom: Spacing.one },
  emptyTitle: { fontSize: 20, lineHeight: 26, fontWeight: "700", textAlign: "center" },
  emptyMessage: { textAlign: "center", maxWidth: 340 },
  pressed: { opacity: 0.82 },
});
