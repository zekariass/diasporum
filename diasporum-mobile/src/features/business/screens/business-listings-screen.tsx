import React, { useCallback, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ApiError } from "@/core/api/api-error";
import { safeBack } from "@/core/navigation/safe-back";
import { useSession } from "@/core/session/session-provider";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { PrimaryButton } from "@/shared/components/primary-button";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { useTheme } from "@/hooks/use-theme";
import { timeAgo } from "@/features/feed/utils/time-ago";
import { createBusinessApi } from "../services/business-api";
import type {
  BusinessListingSection,
  BusinessListings,
} from "../types/business-types";

function statusLabel(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function BusinessListingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  const { apiClient } = useSession();
  const businessApi = React.useMemo(
    () => createBusinessApi(apiClient),
    [apiClient],
  );

  const [listings, setListings] = useState<BusinessListings | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (initial = false) => {
      if (!accountId) return;
      if (initial) setLoading(true);
      setError(null);
      try {
        setListings(await businessApi.listings(accountId));
      } catch (cause) {
        setError(
          ApiError.isApiError(cause)
            ? cause.userMessage
            : "Could not load workspace listings.",
        );
      } finally {
        if (initial) setLoading(false);
        setRefreshing(false);
      }
    },
    [accountId, businessApi],
  );

  useFocusEffect(
    useCallback(() => {
      void load(true);
    }, [load]),
  );

  if (loading) return <LoadingScreen />;

  const sections: {
    key: keyof BusinessListings;
    title: string;
    icon: string;
    section?: BusinessListingSection;
    manageRoute?: string;
  }[] = listings
    ? [
        {
          key: "profiles",
          title: "Business profiles",
          icon: "storefront-outline",
          section: listings.profiles,
          manageRoute: `/(app)/businesses/manage?accountId=${accountId}`,
        },
        {
          key: "events",
          title: "Events",
          icon: "calendar-outline",
          section: listings.events,
        },
        {
          key: "jobs",
          title: "Jobs",
          icon: "briefcase-outline",
          section: listings.jobs,
        },
        {
          key: "properties",
          title: "Properties",
          icon: "home-outline",
          section: listings.properties,
        },
        {
          key: "vehicles",
          title: "Vehicles",
          icon: "car-outline",
          section: listings.vehicles,
        },
        {
          key: "providers",
          title: "Service providers",
          icon: "construct-outline",
          section: listings.providers,
        },
      ]
    : [];

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={[styles.nav, { borderBottomColor: theme.border }]}>
          <Pressable onPress={safeBack} hitSlop={8} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <ThemedText style={styles.navTitle}>Listings</ThemedText>
          <View style={styles.navSpacer} />
        </View>

        {error || !listings ? (
          <View style={styles.errorState}>
            <ThemedText style={styles.errorTitle}>
              Listings unavailable
            </ThemedText>
            <ThemedText style={styles.errorText} themeColor="textSecondary">
              {error ?? "Workspace listings could not be loaded."}
            </ThemedText>
            <PrimaryButton
              label="Try again"
              onPress={() => void load(true)}
              variant="secondary"
            />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  void load();
                }}
              />
            }
          >
            <ThemedText style={styles.subtitle} themeColor="textSecondary">
              Everything this workspace owns, grouped by type. Manage each
              listing inside its own marketplace.
            </ThemedText>
            {sections.map(({ key, title, icon, section, manageRoute }) => (
              <View key={key} style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionHeaderLeft}>
                    <Ionicons
                      name={icon as never}
                      size={18}
                      color={BrandColors.primary}
                    />
                    <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
                  </View>
                  <ThemedText
                    style={styles.sectionCount}
                    themeColor="textSecondary"
                  >
                    {section!.total}
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.card,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  {section!.items.length === 0 ? (
                    <ThemedText
                      style={styles.emptyText}
                      themeColor="textSecondary"
                    >
                      Nothing yet.
                    </ThemedText>
                  ) : (
                    section!.items.map((item, index) => (
                      <View
                        key={item.id}
                        style={[
                          styles.itemRow,
                          index > 0 && {
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: theme.border,
                          },
                        ]}
                      >
                        <View style={styles.itemCopy}>
                          <ThemedText style={styles.itemTitle} numberOfLines={1}>
                            {item.title}
                          </ThemedText>
                          <ThemedText
                            style={styles.itemMeta}
                            themeColor="textSecondary"
                          >
                            {statusLabel(item.status)} ·{" "}
                            {timeAgo(item.createdAt)}
                          </ThemedText>
                        </View>
                      </View>
                    ))
                  )}
                  {manageRoute && section!.total > 0 && (
                    <Pressable
                      onPress={() => router.push(manageRoute as never)}
                      accessibilityRole="button"
                      accessibilityLabel={`Manage ${title}`}
                      style={styles.manageLink}
                    >
                      <ThemedText style={styles.manageLinkText}>
                        Manage {title.toLowerCase()}
                      </ThemedText>
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={BrandColors.primary}
                      />
                    </Pressable>
                  )}
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  nav: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
  },
  navTitle: { fontSize: 16, fontWeight: "700" },
  navSpacer: { width: 24 },
  content: { padding: Spacing.four, paddingBottom: Spacing.six },
  subtitle: { fontSize: 13, lineHeight: 19, marginBottom: Spacing.two },
  section: { marginTop: Spacing.three },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.two,
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  sectionTitle: { fontSize: 16, fontWeight: "800" },
  sectionCount: { fontSize: 14, fontWeight: "700" },
  card: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  emptyText: { fontSize: 13, lineHeight: 19 },
  itemRow: { paddingVertical: Spacing.two },
  itemCopy: { gap: 1 },
  itemTitle: { fontSize: 14, fontWeight: "700" },
  itemMeta: { fontSize: 12, lineHeight: 17 },
  manageLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    paddingTop: Spacing.two,
  },
  manageLinkText: {
    fontSize: 13,
    fontWeight: "700",
    color: BrandColors.primary,
  },
  errorState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.four,
    gap: Spacing.three,
  },
  errorTitle: { fontSize: 20, fontWeight: "800" },
  errorText: { fontSize: 14, lineHeight: 20, textAlign: "center" },
});
