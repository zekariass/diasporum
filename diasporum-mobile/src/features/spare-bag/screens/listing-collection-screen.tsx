import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, RefreshControl, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { Spacing } from "@/shared/theme/spacing";
import { createSpareBagApi } from "../services/spare-bag-api";
import type { Listing } from "../types/spare-bag-types";
import { CollectionState, ListingCard, ScreenHeader } from "../components/spare-bag-ui";

export default function ListingCollectionScreen({ mode }: { mode: "mine" | "saved" }) {
  const { apiClient } = useSession();
  const api = useMemo(() => createSpareBagApi(apiClient), [apiClient]);
  const [items, setItems] = useState<Listing[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback((nextCursor?: string) => {
    if (loadingRef.current) return Promise.resolve();
    loadingRef.current = true;
    const request = mode === "mine" ? api.mine(undefined, nextCursor) : api.saved(nextCursor);
    return Promise.resolve()
      .then(() => { if (nextCursor) setLoadingMore(true); })
      .then(() => request)
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
  const title = mode === "mine" ? "My Spare Bag listings" : "Saved Spare Bag listings";

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <ScreenHeader back title={title} />
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ListingCard listing={item} />}
          contentContainerStyle={styles.content}
          ListEmptyComponent={<CollectionState loading={loading} error={error} empty={!loading && !error} onRetry={() => { setLoading(true); void load(); }} />}
          ListFooterComponent={loadingMore ? <ThemedText style={styles.footer}>Loading more…</ThemedText> : undefined}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
          onEndReached={() => { if (cursor && !loadingRef.current) void load(cursor); }}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, flexGrow: 1 },
  footer: { textAlign: "center", padding: Spacing.three },
});
