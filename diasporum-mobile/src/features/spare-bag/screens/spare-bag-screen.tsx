import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
import type { Listing } from "../types/spare-bag-types";
import { DiscoveryCardSkeleton, DiscoveryListingCard } from "../components/discovery-card";
import { CreateListingSheet } from "../components/discovery-sheets";
import { SafetyNotice, ScreenHeader } from "../components/spare-bag-ui";

export default function SpareBagScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient } = useSession();
  const api = useMemo(() => createSpareBagApi(apiClient), [apiClient]);

  const [items, setItems] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const requestSerial = useRef(0);

  const load = useCallback(() => {
    const request = ++requestSerial.current;
    return api
      .discover({ sort: "NEWEST" })
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
  }, [api]);

  useEffect(() => {
    void load();
    return () => {
      requestSerial.current += 1;
    };
  }, [load]);

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

  const header = (
    <View style={styles.headerContent}>
      <View style={[styles.hero, { backgroundColor: theme.primarySurface }]}>
        <View style={[styles.heroBubble, { backgroundColor: theme.primary, opacity: 0.08 }]} />
        <ThemedText style={styles.heroTitle}>Send parcels with travellers.</ThemedText>
        <ThemedText style={[styles.heroSub, { color: theme.textSecondary }]}>Matched by route and travel dates.</ThemedText>
        <View style={styles.heroIllustration} accessibilityLabel="Parcel travelling between two airports">
          <View style={[styles.heroIcon, { backgroundColor: theme.background }]}>
            <Ionicons name="cube" size={28} color={theme.primary} />
          </View>
          <View style={[styles.heroRule, { backgroundColor: theme.primaryLight }]} />
          <Ionicons name="airplane" size={26} color={theme.primary} />
          <View style={[styles.heroRule, { backgroundColor: theme.primaryLight }]} />
          <View style={[styles.heroIcon, { backgroundColor: theme.background }]}>
            <Ionicons name="briefcase" size={27} color={theme.primary} />
          </View>
        </View>
      </View>

      <View style={styles.quickGrid}>
        <QuickAction icon="briefcase-outline" label="My Spare Bag" onPress={() => router.push("/(app)/spare-bag/my" as never)} />
        <QuickAction icon="bookmark-outline" label="Saved" onPress={() => router.push("/(app)/spare-bag/saved" as never)} />
        <QuickAction icon="chatbubbles-outline" label="Requests" onPress={() => router.push("/(app)/spare-bag/contacts" as never)} />
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
                  <Ionicons name="briefcase-outline" size={30} color={theme.primary} />
                </View>
                <ThemedText style={styles.emptyTitle}>No listings yet</ThemedText>
                <ThemedText themeColor="textSecondary" style={styles.emptyMessage}>
                  Be the first — send a parcel or offer spare space on your next trip.
                </ThemedText>
                <PrimaryButton label="Create a listing" onPress={() => setCreateOpen(true)} />
              </View>
            )
          }
          ListFooterComponent={items.length ? <SafetyNotice compact /> : undefined}
          contentContainerStyle={styles.content}
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

function QuickAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.quickAction, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <Ionicons name={icon} size={26} color={theme.primary} />
      <ThemedText type="smallBold" style={styles.quickLabel}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: Spacing.three, paddingTop: Spacing.two, gap: Spacing.three, flexGrow: 1, width: "100%", maxWidth: 720, alignSelf: "center" },
  headerContent: { gap: Spacing.three, paddingBottom: Spacing.one },
  hero: { borderRadius: BorderRadius.xl, overflow: "hidden", padding: Spacing.four, gap: Spacing.two },
  heroBubble: { position: "absolute", width: 220, height: 220, borderRadius: 110, right: -80, top: -100 },
  heroTitle: { fontSize: 32, lineHeight: 38, fontWeight: "800", letterSpacing: -0.4 },
  heroSub: { fontSize: 16, lineHeight: 22 },
  heroIllustration: { flexDirection: "row", alignItems: "center", gap: Spacing.two, marginTop: Spacing.two },
  heroIcon: { width: 54, height: 54, borderRadius: BorderRadius.lg, alignItems: "center", justifyContent: "center" },
  heroRule: { height: 2, flex: 1 },
  quickGrid: { flexDirection: "row", gap: Spacing.two },
  quickAction: { flex: 1, alignItems: "center", gap: Spacing.two, borderWidth: StyleSheet.hairlineWidth, borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.two, paddingVertical: Spacing.three },
  quickLabel: { textAlign: "center" },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.two },
  sectionTitle: { fontSize: 20, lineHeight: 26, fontWeight: "700" },
  seeAll: { flexDirection: "row", alignItems: "center", gap: 2 },
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
