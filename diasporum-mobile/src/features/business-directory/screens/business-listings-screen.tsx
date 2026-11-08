import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { safeBack } from "@/core/navigation/safe-back";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import { ErrorState } from "@/shared/components/error-state";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { PrimaryButton } from "@/shared/components/primary-button";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createPropertyApi } from "@/features/property/services/property-api";
import type {
  PropertyItem,
  PropertyStatus,
} from "@/features/property/types/property-types";
import { createVehicleApi } from "@/features/vehicles/services/vehicle-api";
import type {
  VehicleStatus,
  VehicleView,
} from "@/features/vehicles/types/vehicle-types";

type IconName = ComponentProps<typeof Ionicons>["name"];
type Tab = "properties" | "vehicles";

const PROPERTY_STATUSES: (PropertyStatus | "ALL")[] = [
  "ALL",
  "PUBLISHED",
  "DRAFT",
  "PAUSED",
  "SOLD",
  "RENTED",
];
const VEHICLE_STATUSES: (VehicleStatus | "ALL")[] = [
  "ALL",
  "PUBLISHED",
  "DRAFT",
  "PAUSED",
  "SOLD",
  "RENTED",
];

function formatStatus(status: string) {
  return status === "ALL" ? "All" : status.charAt(0) + status.slice(1).toLowerCase();
}

function formatMoney(amount: number | null, currency: string | null) {
  if (amount == null) return "—";
  return `${currency ?? ""} ${amount.toLocaleString()}`.trim();
}

/**
 * Listings associated with one public Business Profile. Ownership stays with
 * the Business Account — this screen only shows the profile-scoped slice.
 */
export default function BusinessListingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient } = useSession();
  const { businessId, accountId, profileName, accountName } =
    useLocalSearchParams<{
      businessId: string;
      accountId?: string;
      profileName?: string;
      accountName?: string;
    }>();
  const propertyApi = useMemo(() => createPropertyApi(apiClient), [apiClient]);
  const vehicleApi = useMemo(() => createVehicleApi(apiClient), [apiClient]);

  const [tab, setTab] = useState<Tab>("properties");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("ALL");
  const [properties, setProperties] = useState<PropertyItem[]>([]);
  const [vehicles, setVehicles] = useState<VehicleView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const decodedProfile = profileName ? decodeURIComponent(profileName) : "Listings";

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const [propertyPage, vehiclePage] = await Promise.all([
        propertyApi
          .mine(undefined, accountId || undefined, undefined, 50, businessId)
          .catch(() => ({ items: [], nextCursor: null })),
        vehicleApi
          .myVehicles(
            {
              businessAccountId: accountId || undefined,
              businessListingId: businessId,
            },
            undefined,
            50,
          )
          .catch(() => ({ items: [], nextCursor: null })),
      ]);
      setProperties(propertyPage.items);
      setVehicles(vehiclePage.items);
    } catch (cause) {
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "Could not load this profile's listings.",
      );
    } finally {
      setLoading(false);
    }
  }, [accountId, businessId, propertyApi, vehicleApi]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const needle = search.trim().toLowerCase();
  const visibleProperties = properties.filter(
    (item) =>
      (status === "ALL" || item.property.status === status) &&
      (!needle || item.property.title.toLowerCase().includes(needle)),
  );
  const visibleVehicles = vehicles.filter(
    (item) =>
      (status === "ALL" || item.listing.status === status) &&
      (!needle || item.listing.title.toLowerCase().includes(needle)),
  );

  const totalViews = properties.reduce((sum, item) => sum + item.viewCount, 0);
  const totalEnquiries = properties.reduce(
    (sum, item) => sum + item.enquiryCount,
    0,
  );
  const totalSaves = properties.reduce((sum, item) => sum + item.saveCount, 0);

  const statuses = tab === "properties" ? PROPERTY_STATUSES : VEHICLE_STATUSES;

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <View style={[styles.nav, { borderBottomColor: theme.border }]}>
          <Pressable onPress={safeBack} hitSlop={8} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <View style={styles.navTitleWrap}>
            <ThemedText style={styles.navTitle} numberOfLines={1}>
              {decodedProfile}
            </ThemedText>
            <ThemedText style={styles.navSubtitle} themeColor="textSecondary">
              Listings published under this profile
            </ThemedText>
          </View>
          <View style={styles.navSpacer} />
        </View>
        {loading ? (
          <LoadingScreen message="Loading listings…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <>
            <View style={[styles.tabs, { borderBottomColor: theme.border }]}>
              {(["properties", "vehicles"] as Tab[]).map((value) => {
                const active = tab === value;
                const count =
                  value === "properties" ? properties.length : vehicles.length;
                return (
                  <Pressable
                    key={value}
                    onPress={() => {
                      setTab(value);
                      setStatus("ALL");
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={value}
                    style={[
                      styles.tab,
                      active && { borderBottomColor: BrandColors.primary },
                    ]}
                  >
                    <ThemedText
                      style={[
                        styles.tabText,
                        active && { color: BrandColors.primary },
                      ]}
                      themeColor={active ? undefined : "textSecondary"}
                    >
                      {value === "properties" ? "Property" : "Vehicles"} ({count})
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.searchWrap}>
              <View
                style={[
                  styles.search,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                  },
                ]}
              >
                <Ionicons
                  name="search-outline"
                  size={18}
                  color={theme.textSecondary}
                />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search listings"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.searchInput, { color: theme.text }]}
                />
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.statusRow}
              >
                {statuses.map((value) => {
                  const active = status === value;
                  return (
                    <Pressable
                      key={value}
                      onPress={() => setStatus(value)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[
                        styles.statusChip,
                        {
                          backgroundColor: active
                            ? BrandColors.primary
                            : theme.backgroundElement,
                          borderColor: active
                            ? BrandColors.primary
                            : theme.border,
                        },
                      ]}
                    >
                      <ThemedText
                        style={[
                          styles.statusText,
                          active && { color: BrandColors.white },
                        ]}
                        themeColor={active ? undefined : "textSecondary"}
                      >
                        {formatStatus(value)}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
            <ScrollView contentContainerStyle={styles.list}>
              {tab === "properties" ? (
                <>
                  <View style={styles.metricRow}>
                    <MiniMetric icon="eye-outline" label="Views" value={totalViews} />
                    <MiniMetric
                      icon="chatbubble-ellipses-outline"
                      label="Enquiries"
                      value={totalEnquiries}
                    />
                    <MiniMetric
                      icon="bookmark-outline"
                      label="Saves"
                      value={totalSaves}
                    />
                  </View>
                  {visibleProperties.map((item) => (
                    <ListingRow
                      key={item.property.id}
                      title={item.property.title}
                      detail={`${formatMoney(item.property.priceAmount, item.property.currencyCode)}${item.property.pricePeriod && item.property.pricePeriod !== "TOTAL" ? ` / ${item.property.pricePeriod.toLowerCase()}` : ""} · ${formatStatus(item.property.status)}`}
                      subtitle={
                        item.location?.city ?? item.location?.region ?? undefined
                      }
                      onPress={() =>
                        router.push(
                          `/(app)/properties/${item.property.id}` as never,
                        )
                      }
                    />
                  ))}
                  {!visibleProperties.length ? (
                    <EmptyListings />
                  ) : null}
                </>
              ) : (
                <>
                  {visibleVehicles.map((item) => (
                    <ListingRow
                      key={item.listing.id}
                      title={item.listing.title}
                      detail={`${formatMoney(item.listing.priceAmount, item.listing.currencyCode)} · ${formatStatus(item.listing.status)}`}
                      subtitle={
                        item.location?.city ?? item.location?.region ?? undefined
                      }
                      onPress={() =>
                        router.push(
                          `/(app)/vehicles/${item.listing.id}` as never,
                        )
                      }
                    />
                  ))}
                  {!visibleVehicles.length ? <EmptyListings /> : null}
                </>
              )}
            </ScrollView>
            {accountId ? (
              <View style={styles.footer}>
                <PrimaryButton
                  label="Add listing to this profile"
                  onPress={() =>
                    router.push(
                      `/(app)/business/workspace/${accountId}/new-listing?businessId=${businessId}&profileName=${encodeURIComponent(decodedProfile)}&accountName=${encodeURIComponent(accountName ? decodeURIComponent(accountName) : "")}` as never,
                    )
                  }
                />
              </View>
            ) : null}
          </>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function MiniMetric({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: number;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.miniMetric,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}
    >
      <Ionicons name={icon} size={16} color={BrandColors.primary} />
      <ThemedText style={styles.miniValue}>{value}</ThemedText>
      <ThemedText style={styles.miniLabel} themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

function ListingRow({
  title,
  detail,
  subtitle,
  onPress,
}: {
  title: string;
  detail: string;
  subtitle?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[
        styles.row,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}
    >
      <View style={styles.rowCopy}>
        <ThemedText style={styles.rowTitle} numberOfLines={1}>
          {title}
        </ThemedText>
        <ThemedText style={styles.rowDetail}>{detail}</ThemedText>
        {subtitle ? (
          <ThemedText style={styles.rowSub} themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
    </Pressable>
  );
}

function EmptyListings() {
  return (
    <View style={styles.empty}>
      <Ionicons name="albums-outline" size={36} color={BrandColors.primary} />
      <ThemedText style={styles.emptyTitle}>No listings yet</ThemedText>
      <ThemedText style={styles.emptyText} themeColor="textSecondary">
        Listings published under this Business Profile will appear here.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  nav: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
  },
  navTitleWrap: { flex: 1, alignItems: "center" },
  navTitle: { fontSize: 16, fontWeight: "700" },
  navSubtitle: { fontSize: 11 },
  navSpacer: { width: 24 },
  tabs: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: Spacing.two,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabText: { fontSize: 13, fontWeight: "700" },
  searchWrap: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.three,
    minHeight: 42,
  },
  searchInput: { flex: 1, fontSize: 14 },
  statusRow: { gap: Spacing.two, paddingVertical: Spacing.two },
  statusChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
  },
  statusText: { fontSize: 12, fontWeight: "700" },
  list: { padding: Spacing.four, gap: Spacing.two },
  metricRow: {
    flexDirection: "row",
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  miniMetric: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.two,
  },
  miniValue: { fontSize: 15, fontWeight: "800" },
  miniLabel: { fontSize: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
  },
  rowCopy: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: "700" },
  rowDetail: { fontSize: 12, marginTop: 2 },
  rowSub: { fontSize: 11, marginTop: 1 },
  empty: { alignItems: "center", gap: Spacing.two, paddingVertical: Spacing.five },
  emptyTitle: { fontSize: 15, fontWeight: "700" },
  emptyText: { fontSize: 12, textAlign: "center" },
  footer: { padding: Spacing.four },
});
