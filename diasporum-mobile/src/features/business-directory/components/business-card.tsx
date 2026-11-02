import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type { Business } from "../types/directory-types";
import { BusinessImage } from "./business-image";

export function BusinessCard({
  business,
  onPress,
}: {
  business: Business;
  onPress: () => void;
}) {
  const theme = useTheme();
  const distance = business.distanceMeters;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${business.name}`}
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}
    >
      <View style={styles.imageWrap}>
        <BusinessImage
          businessId={business.id}
          mediaId={business.logoMediaId ?? business.coverMediaId}
          label={`${business.name} logo`}
        />
      </View>
      <View style={styles.copy}>
        <View style={styles.nameRow}>
          <ThemedText style={styles.name} numberOfLines={1}>
            {business.name}
          </ThemedText>
          {business.verificationStatus === "VERIFIED" ? (
            <Ionicons
              name="checkmark-circle"
              size={17}
              color={BrandColors.primary}
              accessibilityLabel="Verified business"
            />
          ) : null}
        </View>
        <ThemedText
          style={styles.meta}
          themeColor="textSecondary"
          numberOfLines={1}
        >
          {business.category?.name ?? "Business"}
          {business.status === "DRAFT" ? " · Draft" : ""}
        </ThemedText>
        <ThemedText style={styles.description} numberOfLines={2}>
          {business.description}
        </ThemedText>
        <View style={styles.bottomRow}>
          <Ionicons name="star" size={14} color={BrandColors.warning} />
          <ThemedText style={styles.rating}>
            {business.reviewCount > 0
              ? `${Number(business.averageRating ?? 0).toFixed(1)} (${business.reviewCount})`
              : "No reviews"}
          </ThemedText>
          {distance != null ? (
            <ThemedText style={styles.distance} themeColor="textSecondary">
              {distance < 1000
                ? `${Math.round(distance)} m`
                : `${(distance / 1000).toFixed(1)} km`}
            </ThemedText>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  imageWrap: {
    width: 82,
    height: 82,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
  },
  copy: { flex: 1, gap: 3 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  name: { flexShrink: 1, fontSize: 16, lineHeight: 21, fontWeight: "800" },
  meta: { fontSize: 12, lineHeight: 17 },
  description: { fontSize: 12, lineHeight: 17 },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  rating: { fontSize: 11, fontWeight: "600" },
  distance: { marginLeft: "auto", fontSize: 11 },
});
