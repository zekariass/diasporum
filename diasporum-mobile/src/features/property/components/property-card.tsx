import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type { PropertyItem } from "../types/property-types";
import { formatPrice, locationLabel, propertyFacts } from "../utils/property-format";
import { PropertyImage } from "./property-image";

export function PropertyCard({
  item,
  onPress,
}: {
  item: PropertyItem;
  onPress: (propertyId: string) => void;
}) {
  const theme = useTheme();
  const property = item.property;
  const facts = propertyFacts(item);
  return (
    <Pressable
      onPress={() => onPress(property.id)}
      accessibilityRole="button"
      accessibilityLabel={`${property.title}, ${formatPrice(item)}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.background, borderColor: theme.border },
        pressed && styles.pressed,
      ]}
    >
      <PropertyImage
        propertyId={property.id}
        mediaId={item.coverMediaId}
        style={styles.image}
      />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <ThemedText style={styles.price}>{formatPrice(item)}</ThemedText>
          {item.saved && (
            <Ionicons name="bookmark" size={18} color={BrandColors.primary} />
          )}
        </View>
        <ThemedText style={styles.title} numberOfLines={2}>
          {property.title}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.meta} numberOfLines={1}>
          {item.propertyType?.displayName ?? "Property"} · {property.listingPurpose === "SALE" ? "For sale" : "For rent"}
        </ThemedText>
        {facts ? <ThemedText style={styles.facts}>{facts}</ThemedText> : null}
        <View style={styles.locationRow}>
          <Ionicons name="location-outline" size={14} color={theme.textSecondary} />
          <ThemedText themeColor="textSecondary" style={styles.location} numberOfLines={1}>
            {locationLabel(item.location)}
          </ThemedText>
        </View>
        {property.status !== "PUBLISHED" && (
          <View style={[styles.status, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText themeColor="textSecondary" style={styles.statusText}>
              {property.status.replaceAll("_", " ")}
            </ThemedText>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.lg,
    marginHorizontal: Spacing.three,
    marginVertical: Spacing.two,
  },
  pressed: { opacity: 0.82 },
  image: { height: 190 },
  body: { padding: Spacing.three, gap: Spacing.one },
  titleRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  price: { flex: 1, fontSize: 19, lineHeight: 25, fontWeight: "800" },
  title: { fontSize: 17, lineHeight: 23, fontWeight: "700" },
  meta: { fontSize: 13, lineHeight: 18 },
  facts: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  locationRow: { flexDirection: "row", alignItems: "center", gap: Spacing.one },
  location: { flex: 1, fontSize: 13, lineHeight: 18 },
  status: { alignSelf: "flex-start", borderRadius: BorderRadius.full, paddingHorizontal: 9, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: "700" },
});
