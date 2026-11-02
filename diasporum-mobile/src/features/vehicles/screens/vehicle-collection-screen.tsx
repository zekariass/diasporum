import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { safeBack } from "@/core/navigation/safe-back";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { PrimaryButton } from "@/shared/components/primary-button";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { VehicleCard } from "../components/vehicle-card";
import { createVehicleApi } from "../services/vehicle-api";
import type { VehicleStatus, VehicleView } from "../types/vehicle-types";
import { vehicleErrorMessage } from "../utils/vehicle-error";
import { vehicleLabel } from "../utils/vehicle-format";

const STATUSES: VehicleStatus[] = ["DRAFT", "PUBLISHED", "PAUSED", "EXPIRED", "SOLD", "RENTED"];

export default function VehicleCollectionScreen({ mode }: { mode: "my" | "saved" }) {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient } = useSession();
  const api = React.useMemo(() => createVehicleApi(apiClient), [apiClient]);
  const [items, setItems] = useState<VehicleView[]>([]);
  const [status, setStatus] = useState<VehicleStatus | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const title = mode === "my" ? "My vehicle listings" : "Saved vehicles";

  const load = useCallback((nextCursor?: string) => {
    if (loadingRef.current) return Promise.resolve();
    loadingRef.current = true;
    if (nextCursor) setLoadingMore(true);
    const request = mode === "my"
      ? api.myVehicles({ status: status ?? undefined }, nextCursor)
      : api.savedVehicles(nextCursor);
    return request.then((page) => {
      setItems((previous) => {
        if (!nextCursor) return page.items;
        const ids = new Set(previous.map((item) => item.listing.id));
        return [...previous, ...page.items.filter((item) => !ids.has(item.listing.id))];
      });
      setCursor(page.nextCursor);
      setError(null);
    }).catch((cause: unknown) => setError(vehicleErrorMessage(cause, `Failed to load ${title.toLowerCase()}.`)))
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      });
  }, [api, mode, status, title]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function unsave(item: VehicleView) {
    try {
      await api.unsave(item.listing.id);
      setItems((previous) => previous.filter((current) => current.listing.id !== item.listing.id));
    } catch (cause) {
      setError(vehicleErrorMessage(cause, "Could not remove the saved vehicle."));
    }
  }

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Pressable onPress={safeBack} accessibilityRole="button" accessibilityLabel="Go back"><Ionicons name="chevron-back" size={25} color={theme.text} /></Pressable>
          <ThemedText type="title" style={styles.title}>{title}</ThemedText>
          {mode === "my" ? <Pressable onPress={() => router.push("/(app)/vehicles/create" as never)} accessibilityRole="button" accessibilityLabel="Create vehicle"><Ionicons name="add" size={26} color={theme.text} /></Pressable> : <View style={styles.spacer} />}
        </View>
        {mode === "my" ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          <StatusChip text="All statuses" active={status === null} onPress={() => { setLoading(true); setStatus(null); }} />
          {STATUSES.map((value) => <StatusChip key={value} text={vehicleLabel(value)} active={status === value}
            onPress={() => { setLoading(true); setStatus(status === value ? null : value); }} />)}
        </ScrollView> : null}
        <FlatList
          testID={`vehicles-${mode}-list`}
          data={items}
          keyExtractor={(item) => item.listing.id}
          renderItem={({ item }) => <VehicleCard item={item} onToggleSave={mode === "saved" ? (value) => void unsave(value) : undefined}
            onPress={(id) => router.push(`/(app)/vehicles/${id}` as never)} />}
          onEndReached={() => { if (cursor && !loadingRef.current) void load(cursor); }}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={BrandColors.primary}
            onRefresh={() => { setRefreshing(true); void load(); }} />}
          ListEmptyComponent={loading ? <ActivityIndicator style={styles.state} color={BrandColors.primary} accessibilityLabel={`Loading ${title}`} />
            : error ? <View style={styles.state} accessibilityRole="alert"><ThemedText style={styles.message}>{error}</ThemedText><PrimaryButton label="Retry" variant="secondary" onPress={() => void load()} /></View>
              : <View style={styles.state}><Ionicons name={mode === "my" ? "car-outline" : "bookmark-outline"} size={42} color={theme.textSecondary} />
                <ThemedText type="subtitle">{mode === "my" ? "No vehicle listings yet" : "No saved vehicles"}</ThemedText>
                <ThemedText style={styles.message} themeColor="textSecondary">{mode === "my" ? "Create a draft or publish a vehicle for your community." : "Save a vehicle to find it here while it remains available."}</ThemedText>
                {mode === "my" ? <PrimaryButton label="Create vehicle" onPress={() => router.push("/(app)/vehicles/create" as never)} /> : null}</View>}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} color={BrandColors.primary} /> : undefined}
          contentContainerStyle={items.length === 0 ? styles.empty : styles.list}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function StatusChip({ text, active, onPress }: { text: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}
    style={[styles.chip, { backgroundColor: active ? BrandColors.primary : theme.backgroundElement, borderColor: active ? BrandColors.primary : theme.border }]}>
    <ThemedText style={[styles.chipText, active && styles.activeChip]}>{text}</ThemedText>
  </Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.four, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, textAlign: "center", fontSize: 20 },
  spacer: { width: 26 },
  filters: { flexDirection: "row", gap: Spacing.two, padding: Spacing.three },
  chip: { borderWidth: 1, borderRadius: BorderRadius.full, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 12, fontWeight: "600" },
  activeChip: { color: BrandColors.white },
  list: { paddingVertical: Spacing.two },
  state: { alignItems: "center", justifyContent: "center", padding: Spacing.five, gap: Spacing.three },
  message: { textAlign: "center", fontSize: 14 },
  footer: { padding: Spacing.four },
  empty: { flexGrow: 1 },
});
