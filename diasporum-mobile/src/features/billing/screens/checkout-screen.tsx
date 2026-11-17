import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import * as Crypto from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { PrimaryButton } from "@/shared/components/primary-button";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { BillingShell } from "../components/billing-shell";
import { DetailRow } from "../components/detail-row";
import { useBillingApi } from "../hooks/use-billing-api";
import type {
  BillingOption,
  BillingOptionsView,
  CheckoutResult,
} from "../types/billing-types";
import { friendlyBillingMessage } from "../utils/billing-errors";
import {
  arrangementLabel,
  formatAmount,
  formatInterval,
} from "../utils/billing-format";

/**
 * Confirms a selection and starts checkout (or a prepaid renewal).
 * Params: `priceId` + `providerKey` pick an option from /options.
 * `mode=renew` with no priceId renews the previous term.
 */
export default function CheckoutScreen() {
  const params = useLocalSearchParams<{
    priceId?: string;
    providerKey?: string;
    mode?: string;
  }>();
  const isRenew = params.mode === "renew";
  const api = useBillingApi();
  const router = useRouter();
  const theme = useTheme();

  const [view, setView] = useState<BillingOptionsView | null>(null);
  const [option, setOption] = useState<BillingOption | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable per attempt (retries reuse it); regenerated only when the selection changes.
  const idempotencyKey = useRef<string>(Crypto.randomUUID());
  const newAttempt = () => {
    idempotencyKey.current = Crypto.randomUUID();
  };

  const needsOption = Boolean(params.priceId);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const v = await api.options();
      setView(v);
      if (params.priceId) {
        const found =
          v.options.find(
            (o) =>
              o.priceId === params.priceId &&
              (!params.providerKey || o.providerKey === params.providerKey),
          ) ?? null;
        setOption(found);
        setMethod(found?.methods[0] ?? null);
        idempotencyKey.current = Crypto.randomUUID();
        if (!found) {
          setError("That plan is no longer available. Please pick one again.");
        }
      }
    } catch (e) {
      setError(friendlyBillingMessage(e, "We couldn't load this plan."));
    } finally {
      setLoading(false);
    }
  }, [api, params.priceId, params.providerKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const goToResult = (result: CheckoutResult) => {
    if (result.status === "SUCCEEDED") {
      router.replace("/(app)/billing" as never);
      return;
    }
    router.replace({
      pathname: "/(app)/billing/payment/[paymentId]",
      params: {
        paymentId: result.paymentId,
        result: JSON.stringify(result),
      },
    } as never);
  };

  const onConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      let result: CheckoutResult;
      if (isRenew && !option) {
        result = await api.renew({ idempotencyKey: idempotencyKey.current });
      } else if (option && view) {
        const body = {
          countryId: view.countryId,
          planKey: option.planKey,
          priceId: option.priceId,
          billingArrangement: option.billingArrangement,
          billingInterval: option.billingInterval,
          intervalCount: option.intervalCount,
          currencyCode: option.currencyCode,
          providerKey: option.providerKey,
          method: method ?? option.methods[0] ?? "",
          idempotencyKey: idempotencyKey.current,
        };
        result = isRenew ? await api.renew(body) : await api.checkout(body);
      } else {
        return;
      }
      goToResult(result);
    } catch (e) {
      setError(friendlyBillingMessage(e, "We couldn't start your payment."));
    } finally {
      setSubmitting(false);
    }
  };

  const canConfirm = !loading && (needsOption ? option !== null : isRenew);

  return (
    <BillingShell
      title={isRenew ? "Renew subscription" : "Confirm"}
      backFallback="/(app)/billing"
    >
      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading" />
      ) : (
        <>
          {option ? (
            <View
              style={[styles.card, { backgroundColor: theme.backgroundElement }]}
            >
              <ThemedText style={styles.plan}>{option.planDisplayName}</ThemedText>
              <DetailRow
                label="Price"
                value={formatAmount(option.amount, option.currencyCode)}
              />
              <DetailRow
                label="Term"
                value={formatInterval(option.billingInterval, option.intervalCount)}
              />
              <DetailRow
                label="Billing"
                value={arrangementLabel(option.billingArrangement)}
              />
              <DetailRow label="Pay with" value={option.providerDisplayName} />
              {option.methods.length > 1 ? (
                <View style={styles.methods}>
                  {option.methods.map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => {
                        if (m !== method) newAttempt();
                        setMethod(m);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: method === m }}
                      style={[
                        styles.method,
                        {
                          borderColor: method === m ? theme.primary : theme.border,
                          backgroundColor:
                            method === m ? theme.primarySurface : "transparent",
                        },
                      ]}
                    >
                      <ThemedText type="small">{m.replace(/_/g, " ")}</ThemedText>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ) : isRenew && !needsOption ? (
            <ThemedText themeColor="textSecondary">
              Renew your current plan for another term at the same price.
            </ThemedText>
          ) : null}

          {error ? (
            <ThemedText
              accessibilityRole="alert"
              style={{ color: theme.error }}
            >
              {error}
            </ThemedText>
          ) : null}

          <PrimaryButton
            label={isRenew ? "Renew" : "Confirm and continue"}
            onPress={onConfirm}
            loading={submitting}
            disabled={!canConfirm}
          />
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
  plan: { fontSize: 18, fontWeight: "800", marginBottom: Spacing.one },
  methods: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  method: {
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
});
