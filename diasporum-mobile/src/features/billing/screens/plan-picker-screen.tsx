import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ErrorState } from "@/shared/components/error-state";
import { BillingShell } from "../components/billing-shell";
import { PlanCard, optionKey } from "../components/plan-card";
import { useBillingApi } from "../hooks/use-billing-api";
import type { BillingOption, BillingOptionsView } from "../types/billing-types";
import { friendlyBillingMessage } from "../utils/billing-errors";

export default function PlanPickerScreen() {
  const api = useBillingApi();
  const router = useRouter();
  const [view, setView] = useState<BillingOptionsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const v = await api.options();
      setView(v);
      // Preselect when a plan offers exactly one option.
      const pre: Record<string, string> = {};
      const byPlan = new Map<string, BillingOption[]>();
      for (const o of v.options) {
        byPlan.set(o.planKey, [...(byPlan.get(o.planKey) ?? []), o]);
      }
      byPlan.forEach((opts, planKey) => {
        if (opts.length === 1) pre[planKey] = optionKey(opts[0]);
      });
      setSelected(pre);
    } catch (e) {
      setError(friendlyBillingMessage(e, "We couldn't load subscription plans."));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const plans = useMemo(() => {
    const map = new Map<string, { name: string; options: BillingOption[] }>();
    for (const o of view?.options ?? []) {
      const entry = map.get(o.planKey) ?? { name: o.planDisplayName, options: [] };
      entry.options.push(o);
      map.set(o.planKey, entry);
    }
    return Array.from(map.entries());
  }, [view]);

  const onContinue = (o: BillingOption) => {
    router.push({
      pathname: "/(app)/billing/checkout",
      params: { priceId: o.priceId, providerKey: o.providerKey },
    } as never);
  };

  return (
    <BillingShell title="Choose a plan" backFallback="/(app)/billing">
      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading plans" />
      ) : error ? (
        <View style={{ minHeight: 280 }}>
          <ErrorState message={error} onRetry={load} />
        </View>
      ) : plans.length === 0 ? (
        <ThemedText themeColor="textSecondary">
          No subscription plans are available for your country right now.
        </ThemedText>
      ) : (
        plans.map(([planKey, plan]) => (
          <PlanCard
            key={planKey}
            planName={plan.name}
            options={plan.options}
            selectedKey={selected[planKey] ?? null}
            onSelect={(o) =>
              setSelected((s) => ({ ...s, [planKey]: optionKey(o) }))
            }
            onContinue={onContinue}
          />
        ))
      )}
    </BillingShell>
  );
}
