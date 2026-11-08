import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createSpareBagApi } from "../services/spare-bag-api";
import type { Listing, ListingType } from "../types/spare-bag-types";
import { CollectionState, ListingCard, ScreenHeader } from "../components/spare-bag-ui";

type CollectionTab = "ALL" | ListingType;

export default function ListingCollectionScreen({ mode }: { mode: "mine" | "saved" }) {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient } = useSession();
  const api = useMemo(() => createSpareBagApi(apiClient), [apiClient]);
  const [items, setItems] = useState<Listing[]>([]);
  const [tab, setTab] = useState<CollectionTab>(mode === "mine" ? "SENDER_REQUEST" : "ALL");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback((nextCursor?: string) => {
    if (loadingRef.current) return Promise.resolve();
    loadingRef.current = true;
    return Promise.resolve()
      .then(() => { if (nextCursor) setLoadingMore(true); })
      .then(() => mode === "mine" ? api.mine(undefined, nextCursor) : api.saved(nextCursor))
      .then((page) => {
        setItems((current) => nextCursor ? [...current, ...page.items] : page.items);
        setCursor(page.nextCursor);
        setError(null);
      })
      .catch((cause) => setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load listings."))
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      });
  }, [api, mode]);

  useEffect(() => { void load(); }, [load]);
  const visibleItems = items.filter((item) => tab === "ALL" || item.listingType === tab);

  async function update(listing: Listing, work: () => Promise<Listing>) {
    setActingId(listing.id);
    setError(null);
    try {
      const updated = await work();
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "The listing action failed.");
    } finally {
      setActingId(null);
    }
  }

  async function removeSaved(listing: Listing) {
    setActingId(listing.id);
    setError(null);
    try {
      await api.unsave(listing.id);
      setItems((current) => current.filter((item) => item.id !== listing.id));
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not remove the saved listing.");
    } finally {
      setActingId(null);
    }
  }

  function close(listing: Listing) {
    Alert.alert("Close listing?", "Closed listings cannot be reopened.", [
      { text: "Cancel", style: "cancel" },
      { text: "Close", style: "destructive", onPress: () => void update(listing, () => api.close(listing.id)) },
    ]);
  }

  const header = (
    <View style={styles.headerContent}>
      <View style={styles.intro}>
        <ThemedText style={styles.introTitle}>{mode === "mine" ? "Your requests and offers" : "Your shortlist"}</ThemedText>
        <ThemedText themeColor="textSecondary">{mode === "mine" ? "Manage drafts, publication, and availability without confusing a match with a completed journey." : "Revisit saved routes and remove listings you no longer need."}</ThemedText>
      </View>
      {mode === "mine" ? <PrimaryButton label="Contact Requests" variant="secondary" onPress={() => router.push("/(app)/spare-bag/contacts" as never)} /> : null}
      <View style={[styles.tabs, { backgroundColor: theme.backgroundElement }]}>
        {(mode === "mine" ? ["SENDER_REQUEST", "PASSENGER_OFFER"] as CollectionTab[] : ["ALL", "SENDER_REQUEST", "PASSENGER_OFFER"] as CollectionTab[]).map((value) => (
          <Pressable key={value} accessibilityRole="button" accessibilityLabel={value === "ALL" ? "All saved" : value === "SENDER_REQUEST" ? "My Sender Requests" : "My Passenger Offers"} accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} style={[styles.tab, tab === value && { backgroundColor: theme.background }]}>
            <ThemedText type="smallBold" style={{ color: tab === value ? theme.primary : theme.textSecondary }}>{value === "ALL" ? "All" : value === "SENDER_REQUEST" ? "Sender requests" : "Passenger offers"}</ThemedText>
          </Pressable>
        ))}
      </View>
      {error && items.length ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{error}</ThemedText> : null}
    </View>
  );

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <ScreenHeader back title={mode === "mine" ? "My Spare Bag" : "Saved Listings"} subtitle={mode === "mine" ? "Manage your structured listings" : "Saved sender requests and passenger offers"} />
        <FlatList
          data={visibleItems}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ListingCard listing={mode === "saved" ? { ...item, saved: true } : item} onToggleSave={mode === "saved" ? () => void removeSaved(item) : undefined} saveLoading={actingId === item.id}>
              {mode === "mine" ? (
                <View style={[styles.cardActions, { borderTopColor: theme.border }]}>
                  {["DRAFT", "PUBLISHED", "PAUSED"].includes(item.status) ? <PrimaryButton label="Edit listing" variant="secondary" onPress={() => router.push(`/(app)/spare-bag/edit/${item.id}` as never)} /> : null}
                  {["DRAFT", "PAUSED"].includes(item.status) ? <PrimaryButton label="Publish listing" loading={actingId === item.id} onPress={() => void update(item, () => api.publish(item.id))} /> : null}
                  {item.status === "PUBLISHED" ? <PrimaryButton label="Pause listing" variant="secondary" loading={actingId === item.id} onPress={() => void update(item, () => api.pause(item.id))} /> : null}
                  {["DRAFT", "PUBLISHED", "PAUSED", "MATCHED"].includes(item.status) ? <PrimaryButton label="Close listing" variant="ghost" onPress={() => close(item)} /> : null}
                  {item.status === "MATCHED" ? <ThemedText type="small" themeColor="textSecondary">Matched is a contact state, not proof of pickup or delivery.</ThemedText> : null}
                </View>
              ) : null}
            </ListingCard>
          )}
          ListHeaderComponent={header}
          contentContainerStyle={styles.content}
          ListEmptyComponent={<CollectionState
            loading={loading}
            error={error}
            empty={!loading && !error}
            onRetry={() => { setLoading(true); void load(); }}
            emptyTitle={mode === "mine" ? tab === "PASSENGER_OFFER" ? "No passenger offers yet" : "No sender requests yet" : "No saved listings"}
            emptyMessage={mode === "mine" ? "Create a structured listing to connect with members on a compatible route." : "Save a listing from discovery and it will appear here while it remains visible and available."}
            action={mode === "mine" ? <PrimaryButton label={tab === "PASSENGER_OFFER" ? "Offer Spare Space" : "Send a Parcel"} onPress={() => router.push(tab === "PASSENGER_OFFER" ? "/(app)/spare-bag/create-passenger" as never : "/(app)/spare-bag/create-sender" as never)} /> : <PrimaryButton label="Browse Listings" onPress={() => router.push("/(app)/spare-bag/discover" as never)} />}
          />}
          ListFooterComponent={loadingMore ? <ThemedText style={styles.footer}>Loading more…</ThemedText> : undefined}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.primary} />}
          onEndReached={() => { if (cursor && !loadingRef.current) void load(cursor); }}
          onEndReachedThreshold={0.4}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, flexGrow: 1 },
  headerContent: { gap: Spacing.three },
  intro: { gap: Spacing.one },
  introTitle: { fontSize: 24, lineHeight: 31, fontWeight: "800" },
  tabs: { flexDirection: "row", borderRadius: BorderRadius.md, padding: Spacing.one, gap: Spacing.one },
  tab: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.one },
  cardActions: { borderTopWidth: StyleSheet.hairlineWidth, padding: Spacing.three, gap: Spacing.two },
  footer: { textAlign: "center", padding: Spacing.three },
});
