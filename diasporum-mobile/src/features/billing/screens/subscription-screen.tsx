import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { ErrorState } from "@/shared/components/error-state";
import { PrimaryButton } from "@/shared/components/primary-button";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { BillingShell } from "../components/billing-shell";
import { DetailRow } from "../components/detail-row";
import { StatusChip } from "../components/status-chip";
import { useBillingApi } from "../hooks/use-billing-api";
import type { SubscriptionView } from "../types/billing-types";
import { friendlyBillingMessage } from "../utils/billing-errors";
import {
  arrangementLabel,
  canRenew,
  formatDate,
} from "../utils/billing-format";

export default function SubscriptionScreen() {
  const api = useBillingApi();
  const router = useRouter();
  const theme = useTheme();
  const [sub, setSub] = useState<SubscriptionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSub(await api.subscription());
    } catch (e) {
      setError(friendlyBillingMessage(e, "We couldn't load your subscription."));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const goPlans = () => router.push("/(app)/billing/plans" as never);
  const goRenew = () =>
    router.push({
      pathname: "/(app)/billing/checkout",
      params: { mode: "renew" },
    } as never);

  return (
    <BillingShell title="Subscription" backFallback="/(app)/(tabs)/profile">
      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading subscription" />
      ) : error ? (
        <View style={{ minHeight: 280 }}>
          <ErrorState message={error} onRetry={load} />
        </View>
      ) : !sub ? (
        <>
          <ThemedText themeColor="textSecondary">
            You don&apos;t have an active subscription.
          </ThemedText>
          <PrimaryButton label="Choose a plan" onPress={goPlans} />
        </>
      ) : (
        <>
          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <StatusChip status={sub.status} />
            <DetailRow label="Plan" value={sub.planKey} emphasized />
            <DetailRow
              label="Billing"
              value={arrangementLabel(sub.billingArrangement)}
            />
            <DetailRow
              label={
                sub.billingArrangement === "PREPAID" ? "Paid through" : "Next renewal"
              }
              value={formatDate(sub.currentPeriodEnd)}
            />
            {sub.cancelAtPeriodEnd ? (
              <ThemedText type="small" themeColor="textSecondary">
                This subscription won&apos;t renew after the current period.
              </ThemedText>
            ) : null}
          </View>

          {canRenew(sub) ? (
            <PrimaryButton label="Renew for another term" onPress={goRenew} />
          ) : null}
          <PrimaryButton label="View plans" variant="secondary" onPress={goPlans} />
        </>
      )}
    </BillingShell>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
    gap: Spacing.one,
  },
});
