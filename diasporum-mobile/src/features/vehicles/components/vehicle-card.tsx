import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
} from "react-native";
import { useSession } from "@/core/session/session-provider";
import { createVehicleApi } from "../services/vehicle-api";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type {
  VehicleListing,
  VehicleMedia,
  VehicleView,
} from "../types/vehicle-types";
import {
  firstDescriptionLine,
  formatVehicleDistance,
  formatVehicleLocation,
  formatVehicleMileage,
  formatVehicleMileageCompact,
  formatVehiclePrice,
  formatVehiclePublished,
  vehicleLabel,
  vehicleSubtitle,
} from "../utils/vehicle-format";

export function VehicleCard({
  item,
  onPress,
  onToggleSave,
  onContact,
}: {
  item: VehicleView;
  onPress: (vehicleId: string) => void;
  onToggleSave?: (item: VehicleView) => void;
  onContact?: (item: VehicleView) => void;
}) {
  const theme = useTheme();
  const vehicle = item.listing;
  const media = useMemo(
    () =>
      [...item.media].sort(
        (a, b) => Number(b.cover) - Number(a.cover) || a.sortOrder - b.sortOrder,
      ),
    [item.media],
  );
  const [page, setPage] = useState(0);
  const [galleryWidth, setGalleryWidth] = useState(0);
  const distance = formatVehicleDistance(vehicle.distanceMeters);
  const location = formatVehicleLocation(item.location);
  const published = formatVehiclePublished(vehicle.publishedAt);
  const subtitle = vehicleSubtitle(vehicle);
  const highlight = firstDescriptionLine(vehicle.description);
  const specs = [
    vehicle.modelYear != null ? String(vehicle.modelYear) : null,
    vehicle.transmission ? vehicleLabel(vehicle.transmission) : null,
    vehicle.fuelType ? vehicleLabel(vehicle.fuelType) : null,
    formatVehicleMileageCompact(vehicle),
  ].filter((value): value is string => Boolean(value));
  const sellerName =
    item.listedBy?.name ??
    item.seller?.businessName ??
    item.seller?.displayName ??
    (item.seller?.username ? `@${item.seller.username}` : null);
  const rating = item.listedBy?.averageRating;
  const reviews = item.listedBy?.reviewCount;
  return (
    <View style={[styles.card, { borderBottomColor: theme.border }]}>
      <Pressable
        onPress={() => onPress(vehicle.id)}
        accessibilityRole="button"
        accessibilityLabel={`View ${vehicle.title}`}
        style={({ pressed }) => [pressed && styles.pressed]}
      >
        <View
          onLayout={(event) => setGalleryWidth(event.nativeEvent.layout.width)}
        >
          {media.length > 1 && galleryWidth > 0 ? (
            <FlatList
              data={media}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled
              keyExtractor={(entry) => entry.id}
              getItemLayout={(_, index) => ({
                length: galleryWidth,
                offset: galleryWidth * index,
                index,
              })}
              onMomentumScrollEnd={(event) =>
                setPage(
                  Math.round(
                    event.nativeEvent.contentOffset.x / galleryWidth,
                  ),
                )
              }
              renderItem={({ item: entry, index }) => (
                <VehicleImage
                  key={`${vehicle.id}:${entry.id}:${entry.downloadUrl}`}
                  vehicleId={vehicle.id}
                  media={entry}
                  style={[styles.cover, { width: galleryWidth }]}
                  label={`${vehicle.title} image ${index + 1}`}
                />
              )}
            />
          ) : (
            <VehicleImage
              key={`${vehicle.id}:${media[0]?.id}:${media[0]?.downloadUrl}`}
              vehicleId={vehicle.id}
              media={media[0]}
              style={styles.cover}
              label={`${vehicle.title} cover image`}
            />
          )}
          {media.length > 1 ? (
            <View
              style={styles.dots}
              accessibilityLabel={`${media.length} photos`}
            >
              {media.map((entry, index) => (
                <View
                  key={entry.id}
                  style={[styles.dot, index === page && styles.dotActive]}
                />
              ))}
            </View>
          ) : null}
        </View>
        <View style={styles.content}>
          <View style={styles.priceRow}>
            <ThemedText style={styles.price}>
              {formatVehiclePrice(vehicle)}
            </ThemedText>
            <View style={styles.priceAside}>
              {vehicle.status !== "PUBLISHED" ? (
                <View
                  style={[
                    styles.status,
                    { backgroundColor: theme.backgroundElement },
                  ]}
                >
                  <ThemedText style={styles.statusText}>
                    {vehicleLabel(vehicle.status)}
                  </ThemedText>
                </View>
              ) : null}
              {onContact ? (
                <Pressable
                  onPress={() => onContact(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Message seller of ${vehicle.title}`}
                  style={styles.contactButton}
                >
                  <Ionicons
                    name="call-outline"
                    size={21}
                    color={theme.text}
                  />
                </Pressable>
              ) : null}
            </View>
          </View>
          <ThemedText style={styles.title} numberOfLines={2}>
            {vehicle.title}
          </ThemedText>
          {subtitle ? (
            <ThemedText style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </ThemedText>
          ) : null}
          {highlight ? (
            <ThemedText
              style={[styles.highlight, { color: theme.primaryDark }]}
              numberOfLines={2}
            >
              {highlight}
            </ThemedText>
          ) : null}
          {specs.length ? (
            <View style={styles.specs}>
              {specs.map((spec) => (
                <View
                  key={spec}
                  style={[
                    styles.spec,
                    { backgroundColor: theme.backgroundElement },
                  ]}
                >
                  <ThemedText style={styles.specText}>{spec}</ThemedText>
                </View>
              ))}
            </View>
          ) : null}
          {sellerName || rating != null || distance ? (
            <View style={styles.sellerRow}>
              {rating != null ? (
                <View style={styles.rating}>
                  <Ionicons
                    name="star"
                    size={14}
                    color={BrandColors.warning}
                  />
                  <ThemedText style={styles.ratingText}>
                    {rating.toFixed(1)}
                    {reviews != null ? ` (${reviews})` : ""}
                  </ThemedText>
                </View>
              ) : null}
              {sellerName ? (
                <ThemedText
                  themeColor="textSecondary"
                  style={styles.seller}
                  numberOfLines={1}
                >
                  {sellerName}
                </ThemedText>
              ) : null}
              <ThemedText
                themeColor="textSecondary"
                style={styles.distance}
                numberOfLines={1}
              >
                {[distance, location === "General area not provided" ? null : location]
                  .filter(Boolean)
                  .join(" · ")}
              </ThemedText>
            </View>
          ) : null}
        </View>
      </Pressable>
      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        {onToggleSave ? (
          <Pressable
            onPress={() => onToggleSave(item)}
            accessibilityRole="button"
            accessibilityLabel={
              vehicle.saved
                ? `Unsave ${vehicle.title}`
                : `Save ${vehicle.title}`
            }
            style={({ pressed }) => [
              styles.saveButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name={vehicle.saved ? "heart" : "heart-outline"}
              size={22}
              color={vehicle.saved ? BrandColors.error : theme.text}
            />
            <ThemedText style={styles.saveText}>Save</ThemedText>
          </Pressable>
        ) : (
          <View />
        )}
        {published ? (
          <ThemedText style={styles.date} themeColor="textSecondary">
            {published}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

export function VehicleHighlights({
  vehicle,
  compact = false,
}: {
  vehicle: VehicleListing;
  compact?: boolean;
}) {
  const theme = useTheme();
  const facts: {
    icon: React.ComponentProps<typeof Ionicons>["name"];
    label: string;
    value: string | null;
  }[] = [
    {
      icon: "calendar-outline",
      label: "Year",
      value: vehicle.modelYear == null ? null : String(vehicle.modelYear),
    },
    {
      icon: "speedometer-outline",
      label: "Mileage",
      value: formatVehicleMileage(vehicle),
    },
    {
      icon: "water-outline",
      label: "Fuel",
      value: vehicle.fuelType ? vehicleLabel(vehicle.fuelType) : null,
    },
    ...(!compact
      ? [
          {
            icon: "options-outline" as const,
            label: "Transmission",
            value: vehicle.transmission
              ? vehicleLabel(vehicle.transmission)
              : null,
          },
        ]
      : []),
  ];
  return (
    <View style={styles.facts}>
      {facts
        .filter((fact) => fact.value)
        .map((fact) => (
          <View
            key={fact.label}
            style={[
              styles.fact,
              compact
                ? styles.compactFact
                : { backgroundColor: theme.backgroundElement },
            ]}
          >
            <Ionicons
              name={fact.icon}
              size={compact ? 17 : 25}
              color={compact ? theme.text : theme.primary}
            />
            <ThemedText
              style={compact ? styles.compactValue : styles.factValue}
            >
              {fact.value}
            </ThemedText>
            {!compact ? (
              <ThemedText style={styles.factLabel}>{fact.label}</ThemedText>
            ) : null}
          </View>
        ))}
    </View>
  );
}

export function VehicleImage({
  vehicleId,
  media,
  label,
  style,
}: {
  vehicleId: string;
  media?: VehicleMedia;
  label: string;
  style: StyleProp<ImageStyle>;
}) {
  const theme = useTheme();
  const { apiClient } = useSession();
  const [uri, setUri] = useState(media?.downloadUrl ?? null);
  const [failed, setFailed] = useState(false);
  const retried = useRef(false);
  const active = useRef(true);
  const mediaId = media?.id;
  const initialUrl = media?.downloadUrl;
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    if (mediaId && !initialUrl) {
      createVehicleApi(apiClient)
        .mediaDownloadUrl(vehicleId, mediaId)
        .then((result) => {
          if (!cancelled) setUri(result.downloadUrl);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    }
    return () => {
      cancelled = true;
      active.current = false;
    };
  }, [apiClient, vehicleId, mediaId, initialUrl]);
  const retry = () => {
    if (!media || retried.current) {
      setFailed(true);
      return;
    }
    retried.current = true;
    createVehicleApi(apiClient)
      .mediaDownloadUrl(vehicleId, media.id)
      .then((result) => {
        if (active.current) setUri(result.downloadUrl);
      })
      .catch(() => {
        if (active.current) setFailed(true);
      });
  };
  return uri && !failed ? (
    <Image
      source={{ uri }}
      style={style}
      resizeMode="cover"
      accessibilityLabel={label}
      onError={retry}
    />
  ) : (
    <View
      style={[
        style,
        styles.placeholder,
        { backgroundColor: theme.backgroundElement },
      ]}
    >
      {media && !failed ? (
        <ActivityIndicator
          color={theme.primary}
          accessibilityLabel="Loading vehicle image"
        />
      ) : (
        <>
          <Ionicons name="car-outline" size={42} color={theme.textSecondary} />
          <ThemedText style={styles.date} themeColor="textSecondary">
            {failed ? "Image unavailable" : "No photo available"}
          </ThemedText>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pressed: { opacity: 0.78 },
  cover: { width: "100%", aspectRatio: 1.6 },
  placeholder: { alignItems: "center", justifyContent: "center" },
  dots: {
    position: "absolute",
    bottom: 10,
    alignSelf: "center",
    flexDirection: "row",
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  dotActive: { backgroundColor: BrandColors.white, width: 8, height: 8, borderRadius: 4 },
  content: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: 5 },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  priceAside: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  price: { fontSize: 22, lineHeight: 28, fontWeight: "800" },
  contactButton: {
    width: 44,
    height: 44,
    marginRight: -10,
    marginTop: -8,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 17, lineHeight: 23, fontWeight: "700" },
  subtitle: { fontSize: 14, lineHeight: 20 },
  highlight: { fontSize: 14, lineHeight: 19, fontWeight: "600" },
  specs: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 4 },
  spec: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  specText: { fontSize: 13, lineHeight: 18, fontWeight: "500" },
  sellerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 4,
  },
  rating: { flexDirection: "row", alignItems: "center", gap: 4 },
  ratingText: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  seller: { flexShrink: 1, fontSize: 13, lineHeight: 18 },
  distance: { marginLeft: "auto", fontSize: 13, lineHeight: 18 },
  status: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusText: { fontSize: 10, fontWeight: "700" },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
  },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 4,
  },
  saveText: { fontSize: 15, fontWeight: "600" },
  date: { fontSize: 12, lineHeight: 18 },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  fact: {
    flex: 1,
    minWidth: 68,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 3,
    gap: 4,
  },
  compactFact: {
    flexDirection: "row",
    justifyContent: "flex-start",
    minWidth: 80,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  compactValue: { fontSize: 12, lineHeight: 18, flexShrink: 1 },
  factValue: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  factLabel: { fontSize: 10, lineHeight: 16 },
});
