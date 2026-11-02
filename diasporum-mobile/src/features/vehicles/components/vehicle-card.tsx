import React from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type { VehicleView } from "../types/vehicle-types";
import {
  formatVehicleDistance,
  formatVehicleLocation,
  formatVehiclePrice,
  formatVehicleSummary,
  vehicleLabel,
} from "../utils/vehicle-format";

export function VehicleCard({
  item,
  onPress,
  onToggleSave,
}: {
  item: VehicleView;
  onPress: (vehicleId: string) => void;
  onToggleSave?: (item: VehicleView) => void;
}) {
  const theme = useTheme();
  const vehicle = item.listing;
  const cover = item.media.find((media) => media.cover) ?? item.media[0];
  const distance = formatVehicleDistance(vehicle.distanceMeters);
  return (
    <View style={[styles.card, { backgroundColor: theme.background, borderColor: theme.border }]}>
      <Pressable
        onPress={() => onPress(vehicle.id)}
        accessibilityRole="button"
        accessibilityLabel={`View ${vehicle.title}`}
        style={({ pressed }) => [pressed && styles.pressed]}
      >
        {cover?.downloadUrl ? (
          <Image source={{ uri: cover.downloadUrl }} style={styles.cover} resizeMode="cover"
            accessibilityLabel={`${vehicle.title} cover image`} />
        ) : (
          <View style={[styles.cover, styles.placeholder, { backgroundColor: theme.backgroundElement }]}>
            <Ionicons name="car-outline" size={46} color={theme.textSecondary} />
          </View>
        )}
        <View style={styles.content}>
          <View style={styles.titleRow}>
            <View style={styles.titleBlock}>
              <ThemedText style={styles.title} numberOfLines={2}>{vehicle.title}</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.summary} numberOfLines={2}>
                {formatVehicleSummary(vehicle) || vehicleLabel(vehicle.listingPurpose)}
              </ThemedText>
            </View>
            {vehicle.status !== "PUBLISHED" ? (
              <View style={[styles.status, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={styles.statusText}>{vehicleLabel(vehicle.status)}</ThemedText>
              </View>
            ) : null}
          </View>
          <ThemedText style={styles.price}>{formatVehiclePrice(vehicle)}</ThemedText>
          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={15} color={theme.textSecondary} />
            <ThemedText themeColor="textSecondary" style={styles.location} numberOfLines={1}>
              {formatVehicleLocation(item.location)}{distance ? ` · ${distance}` : ""}
            </ThemedText>
          </View>
        </View>
      </Pressable>
      {onToggleSave ? (
        <Pressable
          onPress={() => onToggleSave(item)}
          accessibilityRole="button"
          accessibilityLabel={vehicle.saved ? `Unsave ${vehicle.title}` : `Save ${vehicle.title}`}
          style={[styles.save, { backgroundColor: theme.background }]}
        >
          <Ionicons name={vehicle.saved ? "bookmark" : "bookmark-outline"} size={22}
            color={vehicle.saved ? BrandColors.primary : theme.text} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.four,
    marginVertical: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
  },
  pressed: { opacity: 0.78 },
  cover: { width: "100%", height: 190 },
  placeholder: { alignItems: "center", justifyContent: "center" },
  content: { padding: Spacing.three, gap: Spacing.two },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.two, paddingRight: 28 },
  titleBlock: { flex: 1 },
  title: { fontSize: 18, lineHeight: 23, fontWeight: "700" },
  summary: { fontSize: 13, lineHeight: 18, marginTop: 3 },
  price: { color: BrandColors.primary, fontSize: 17, fontWeight: "800" },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  location: { flex: 1, fontSize: 13 },
  status: { borderRadius: BorderRadius.full, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { fontSize: 10, fontWeight: "700" },
  save: {
    position: "absolute",
    right: Spacing.three,
    top: 200,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
