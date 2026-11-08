import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { safeBack } from "@/core/navigation/safe-back";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type { ListingPurpose, PropertyItem } from "../types/property-types";

type Icon = React.ComponentProps<typeof Ionicons>["name"];
export function PropertyHeader({
  children,
  branding = false,
}: {
  children?: React.ReactNode;
  branding?: boolean;
}) {
  return (
    <View style={styles.header}>
      <HeaderAction label="Go back" icon="chevron-back" onPress={safeBack} />
      <View style={styles.brand}>
        {branding ? (
          <>
            <Ionicons name="cube" size={25} color={BrandColors.white} />
            <ThemedText style={styles.brandText}>Diasporum</ThemedText>
          </>
        ) : null}
      </View>
      <View style={styles.actions}>{children}</View>
    </View>
  );
}
export function HeaderAction({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  icon: Icon;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.iconButton, disabled && { opacity: 0.5 }]}
    >
      <Ionicons name={icon} size={23} color={BrandColors.white} />
    </Pressable>
  );
}
export function PurposeSelector({
  value,
  onChange,
}: {
  value: ListingPurpose;
  onChange: (purpose: ListingPurpose) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={[styles.segment, { backgroundColor: theme.backgroundElement }]}
    >
      {(["SALE", "RENT"] as const).map((purpose) => (
        <Pressable
          key={purpose}
          accessibilityRole="button"
          accessibilityLabel={purpose === "SALE" ? "Buy" : "Rent"}
          accessibilityState={{ selected: value === purpose }}
          onPress={() => onChange(purpose)}
          style={[
            styles.segmentItem,
            value === purpose && { backgroundColor: BrandColors.primaryDark },
          ]}
        >
          <ThemedText
            style={[
              styles.segmentText,
              value === purpose && { color: BrandColors.white },
            ]}
          >
            {purpose === "SALE" ? "Buy" : "Rent"}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}
export function PurposeBadge({ purpose }: { purpose: ListingPurpose }) {
  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor:
            purpose === "SALE" ? BrandColors.success : BrandColors.primaryDark,
        },
      ]}
    >
      <ThemedText style={styles.badgeText}>
        {purpose === "SALE" ? "For Sale" : "For Rent"}
      </ThemedText>
    </View>
  );
}
export function PropertyHighlights({
  item,
  compact = false,
}: {
  item: PropertyItem;
  compact?: boolean;
}) {
  const theme = useTheme();
  const p = item.property;
  const facts: { icon: Icon; value: string; label: string }[] = [];
  if (p.bedrooms != null)
    facts.push({
      icon: "bed-outline",
      value: String(p.bedrooms),
      label: compact ? "beds" : "Bedrooms",
    });
  if (p.bathrooms != null)
    facts.push({
      icon: "water-outline",
      value: String(p.bathrooms),
      label: compact ? "baths" : "Bathrooms",
    });
  if (p.floorArea != null && p.floorAreaUnit)
    facts.push({
      icon: "expand-outline",
      value: `${p.floorArea} ${p.floorAreaUnit === "SQFT" ? "ft²" : "m²"}`,
      label: compact ? "" : "Floor area",
    });
  if (!facts.length) return null;
  return (
    <View style={styles.facts}>
      {facts.map((fact) => (
        <View
          key={fact.icon}
          style={[
            styles.fact,
            compact
              ? styles.compact
              : { backgroundColor: theme.backgroundElement },
          ]}
        >
          <Ionicons
            name={fact.icon}
            size={compact ? 18 : 25}
            color={compact ? theme.text : theme.primary}
          />
          <ThemedText style={compact ? styles.compactText : styles.factValue}>
            {fact.value}
            {compact && fact.label ? ` ${fact.label}` : ""}
          </ThemedText>
          {!compact ? (
            <ThemedText style={styles.factLabel}>{fact.label}</ThemedText>
          ) : null}
        </View>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  header: {
    backgroundColor: BrandColors.primaryDark,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 60,
    paddingHorizontal: Spacing.two,
  },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.two,
  },
  brandText: { color: BrandColors.white, fontSize: 20, fontWeight: "700" },
  actions: { flexDirection: "row" },
  segment: {
    flexDirection: "row",
    borderRadius: BorderRadius.full,
    overflow: "hidden",
  },
  segmentItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.two,
    minHeight: 44,
    borderRadius: BorderRadius.full,
  },
  segmentText: { fontSize: 15, fontWeight: "700" },
  badge: {
    alignSelf: "flex-start",
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    color: BrandColors.white,
    fontWeight: "700",
    fontSize: 13,
    lineHeight: 20,
  },
  facts: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    marginVertical: Spacing.two,
  },
  fact: {
    flex: 1,
    minWidth: 80,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.three,
    borderRadius: BorderRadius.md,
    gap: Spacing.one,
  },
  compact: {
    flexDirection: "row",
    paddingVertical: Spacing.one,
    justifyContent: "flex-start",
    flexGrow: 1,
  },
  compactText: { fontSize: 13, fontWeight: "600" },
  factValue: { fontSize: 18, fontWeight: "800" },
  factLabel: { fontSize: 12, lineHeight: 18 },
});
