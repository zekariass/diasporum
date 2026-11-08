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
import { useFocusEffect, useLocalSearchParams } from "expo-router";

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
import type { BusinessBilling } from "../types/business-types";

function label(key: string) {
  return key
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function BusinessBillingScreen() {
  const theme = useTheme();
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  const { apiClient } = useSession();
  const businessApi = React.useMemo(
    () => createBusinessApi(apiClient),
    [apiClient],
  );

  const [billing, setBilling] = useState<BusinessBilling | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (initial = false) => {
      if (!accountId) return;
      if (initial) setLoading(true);
      setError(null);
      try {
        setBilling(await businessApi.billing(accountId));
      } catch (cause) {
        setError(
          ApiError.isApiError(cause)
            ? cause.userMessage
            : "Could not load billing information.",
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

  const subscription = billing?.subscription ?? null;

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={[styles.nav, { borderBottomColor: theme.border }]}>
          <Pressable onPress={safeBack} hitSlop={8} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <ThemedText style={styles.navTitle}>Billing</ThemedText>
          <View style={styles.navSpacer} />
        </View>

        {error || !billing ? (
          <View style={styles.errorState}>
            <ThemedText style={styles.errorTitle}>Billing unavailable</ThemedText>
            <ThemedText style={styles.errorText} themeColor="textSecondary">
              {error ?? "Billing information could not be loaded."}
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
            <ThemedText style={styles.sectionTitle}>Subscription</ThemedText>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            >
              {subscription ? (
                <>
                  <View style={styles.rowBetween}>
                    <ThemedText style={styles.planName}>
                      {subscription.displayName}
                    </ThemedText>
                    <View
                      style={[
                        styles.statusBadge,
                        {
                          backgroundColor:
                            subscription.status === "ACTIVE" ||
                            subscription.status === "TRIALING"
                              ? BrandColors.primarySurface
                              : theme.backgroundElement,
                        },
                      ]}
                    >
                      <ThemedText
                        style={[
                          styles.statusText,
                          (subscription.status === "ACTIVE" ||
                            subscription.status === "TRIALING") && {
                            color: BrandColors.primary,
                          },
                        ]}
                      >
                        {label(subscription.status)}
                      </ThemedText>
                    </View>
                  </View>
                  {subscription.currentPeriodEnd && (
                    <ThemedText
                      style={styles.meta}
                      themeColor="textSecondary"
                    >
                      {subscription.cancelAtPeriodEnd
                        ? `Cancels ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
                        : `Renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`}
                    </ThemedText>
                  )}
                </>
              ) : (
                <ThemedText style={styles.meta} themeColor="textSecondary">
                  No subscription on this workspace. Paid plan upgrades will be
                  available when business billing launches.
                </ThemedText>
              )}
            </View>

            <ThemedText style={styles.sectionTitle}>Team seats</ThemedText>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            >
              <ThemedText style={styles.seatsText}>
                {billing.seats.used}{" "}
                {billing.seats.limit == null
                  ? "seats used"
                  : `of ${billing.seats.limit} seats used`}
              </ThemedText>
              <ThemedText style={styles.meta} themeColor="textSecondary">
                {billing.seats.limit == null
                  ? "This plan does not cap team size."
                  : "Members and accepted invitations count toward the plan limit."}
              </ThemedText>
            </View>

            {billing.entitlements.length > 0 && (
              <>
                <ThemedText style={styles.sectionTitle}>
                  Plan entitlements
                </ThemedText>
                <View
                  style={[
                    styles.card,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  {billing.entitlements.map((entitlement, index) => (
                    <View
                      key={entitlement.featureKey}
                      style={[
                        styles.entitlementRow,
                        index > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: theme.border,
                        },
                      ]}
                    >
                      <View style={styles.eventCopy}>
                        <ThemedText style={styles.entitlementName}>
                          {entitlement.displayName}
                        </ThemedText>
                        <ThemedText
                          style={styles.meta}
                          themeColor="textSecondary"
                        >
                          {entitlement.enabled
                            ? entitlement.quantityLimit == null
                              ? "Included"
                              : `Up to ${entitlement.quantityLimit}${
                                  entitlement.resetPeriod
                                    ? ` per ${entitlement.resetPeriod.toLowerCase()}`
                                    : ""
                                }`
                            : "Not included"}
                        </ThemedText>
                      </View>
                      <Ionicons
                        name={
                          entitlement.enabled
                            ? "checkmark-circle"
                            : "close-circle-outline"
                        }
                        size={18}
                        color={
                          entitlement.enabled
                            ? BrandColors.primary
                            : theme.textSecondary
                        }
                      />
                    </View>
                  ))}
                </View>
              </>
            )}

            {billing.orders.length > 0 && (
              <>
                <ThemedText style={styles.sectionTitle}>
                  Recent orders
                </ThemedText>
                <View
                  style={[
                    styles.card,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  {billing.orders.map((order, index) => (
                    <View
                      key={order.id}
                      style={[
                        styles.entitlementRow,
                        index > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: theme.border,
                        },
                      ]}
                    >
                      <View style={styles.eventCopy}>
                        <ThemedText style={styles.entitlementName}>
                          {order.currencyCode} {order.totalAmount}
                        </ThemedText>
                        <ThemedText
                          style={styles.meta}
                          themeColor="textSecondary"
                        >
                          {label(order.status)} · {timeAgo(order.createdAt)}
                        </ThemedText>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            )}
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
  sectionTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  card: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  planName: { fontSize: 17, fontWeight: "800" },
  statusBadge: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  statusText: { fontSize: 11, fontWeight: "800" },
  meta: { fontSize: 12, lineHeight: 17 },
  seatsText: { fontSize: 17, fontWeight: "800" },
  entitlementRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  eventCopy: { flex: 1 },
  entitlementName: { fontSize: 14, fontWeight: "700" },
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
