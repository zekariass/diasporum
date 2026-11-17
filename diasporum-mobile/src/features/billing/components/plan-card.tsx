import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { PrimaryButton } from "@/shared/components/primary-button";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type { BillingOption } from "../types/billing-types";
import { arrangementLabel, optionPriceLabel } from "../utils/billing-format";

export function optionKey(o: BillingOption): string {
  return `${o.priceId}:${o.providerKey}`;
}

interface PlanCardProps {
  planName: string;
  options: BillingOption[];
  selectedKey: string | null;
  onSelect: (o: BillingOption) => void;
  onContinue: (o: BillingOption) => void;
}

/** Renders one plan with a selectable row per server-provided option. */
export function PlanCard({
  planName,
  options,
  selectedKey,
  onSelect,
  onContinue,
}: PlanCardProps) {
  const theme = useTheme();
  const selected = options.find((o) => optionKey(o) === selectedKey) ?? null;

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText style={styles.name}>{planName}</ThemedText>
      {options.map((o) => {
        const isSel = optionKey(o) === selectedKey;
        return (
          <Pressable
            key={optionKey(o)}
            onPress={() => onSelect(o)}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSel }}
            style={[
              styles.option,
              {
                borderColor: isSel ? theme.primary : theme.border,
                backgroundColor: isSel ? theme.primarySurface : "transparent",
              },
            ]}
          >
            <ThemedText style={styles.price}>{optionPriceLabel(o)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {arrangementLabel(o.billingArrangement)} · {o.providerDisplayName}
            </ThemedText>
          </Pressable>
        );
      })}
      <PrimaryButton
        label="Continue"
        disabled={!selected}
        onPress={() => selected && onContinue(selected)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  name: { fontSize: 18, fontWeight: "800" },
  option: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.three,
    gap: 2,
  },
  price: { fontSize: 16, fontWeight: "700" },
});
