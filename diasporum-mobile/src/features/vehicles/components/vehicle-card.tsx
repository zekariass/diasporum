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
        (a, b) =>
          Number(b.cover) - Number(a.cover) || a.sortOrder - b.sortOrder,
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
  const specs: {
    key: string;
    icon: React.ComponentProps<typeof Ionicons>["name"];
    value: string | null;
  }[] = [
    {
      key: "year",
      icon: "calendar-outline",
      value: vehicle.modelYear == null ? null : String(vehicle.modelYear),
    },
    {
      key: "mileage",
      icon: "speedometer-outline",
      value: formatVehicleMileageCompact(vehicle),
    },
    {
      key: "fuel",
      icon: "water-outline",
      value: vehicle.fuelType ? vehicleLabel(vehicle.fuelType) : null,
    },
    {
      key: "transmission",
      icon: "options-outline",
      value: vehicle.transmission ? vehicleLabel(vehicle.transmission) : null,
    },
  ];
  const visibleSpecs = specs.filter((spec) => spec.value);
  const sellerName =
    item.listedBy?.name ??
    item.seller?.businessName ??
    item.seller?.displayName ??
    (item.seller?.username ? `@${item.seller.username}` : null);
  const rating = item.listedBy?.averageRating;
  const reviews = item.listedBy?.reviewCount;
  const locality = location === "General area not provided" ? null : location;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.background, borderColor: theme.border },
      ]}
    >
      <Pressable
        onPress={() => onPress(vehicle.id)}
        accessibilityRole="button"
        accessibilityLabel={`View ${vehicle.title}`}
        style={({ pressed }) => [pressed && styles.pressed]}
      >
        <View
          style={styles.gallery}
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
                  Math.round(event.nativeEvent.contentOffset.x / galleryWidth),
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
          <View style={styles.imageTopRow} pointerEvents="box-none">
            <View
              style={[
                styles.purposeBadge,
                {
                  backgroundColor:
                    vehicle.listingPurpose === "RENT"
                      ? BrandColors.primaryDark
                      : BrandColors.primary,
                },
              ]}
            >
              <ThemedText style={styles.purposeText}>
                {vehicle.listingPurpose === "RENT" ? "For Rent" : "For Sale"}
              </ThemedText>
            </View>
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
                  styles.imageSaveButton,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  name={vehicle.saved ? "heart" : "heart-outline"}
                  size={22}
                  color={vehicle.saved ? BrandColors.error : BrandColors.black}
                />
              </Pressable>
            ) : null}
          </View>
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
          {media.length ? (
            <View style={styles.photoCount}>
              <Ionicons
                name="images-outline"
                size={13}
                color={BrandColors.white}
              />
              <ThemedText style={styles.photoCountText}>
                {page + 1} / {media.length}
              </ThemedText>
            </View>
          ) : null}
        </View>
        <View style={styles.content}>
          <ThemedText style={styles.title} numberOfLines={2}>
            {vehicle.title}
          </ThemedText>
          {subtitle ? (
            <ThemedText
              style={styles.subtitle}
              themeColor="textSecondary"
              numberOfLines={1}
            >
              {subtitle}
            </ThemedText>
          ) : null}
          <View style={styles.priceRow}>
            <ThemedText style={[styles.price, { color: theme.primaryDark }]}>
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
                  style={[
                    styles.contactButton,
                    { backgroundColor: theme.primarySurface },
                  ]}
                >
                  <Ionicons
                    name="chatbubble-ellipses-outline"
                    size={20}
                    color={theme.primaryDark}
                  />
                </Pressable>
              ) : null}
            </View>
          </View>
          {highlight ? (
            <ThemedText
              style={[styles.highlight, { color: theme.primaryDark }]}
              numberOfLines={2}
            >
              {highlight}
            </ThemedText>
          ) : null}
          {visibleSpecs.length ? (
            <View style={styles.specs}>
              {visibleSpecs.map((spec) => (
                <View
                  key={spec.key}
                  style={[
                    styles.spec,
                    { backgroundColor: theme.backgroundElement },
                  ]}
                >
                  <Ionicons
                    name={spec.icon}
                    size={15}
                    color={theme.textSecondary}
                  />
                  <ThemedText style={styles.specText}>{spec.value}</ThemedText>
                </View>
              ))}
            </View>
          ) : null}
          {locality || distance ? (
            <View style={styles.locationRow}>
              <Ionicons
                name="location-outline"
                size={16}
                color={theme.textSecondary}
              />
              <ThemedText
                themeColor="textSecondary"
                style={styles.location}
                numberOfLines={1}
              >
                {[locality, distance].filter(Boolean).join(" · ")}
              </ThemedText>
            </View>
          ) : null}
          {sellerName || rating != null ? (
            <View style={styles.sellerRow}>
              {rating != null ? (
                <View style={styles.rating}>
                  <Ionicons name="star" size={14} color={BrandColors.warning} />
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
            </View>
          ) : null}
        </View>
      </Pressable>
      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <ThemedText style={styles.date} themeColor="textSecondary">
          {published ?? "Vehicle listing"}
        </ThemedText>
        <Pressable
          onPress={() => onPress(vehicle.id)}
          accessibilityRole="button"
          accessibilityLabel={`View details for ${vehicle.title}`}
          style={({ pressed }) => [
            styles.detailsButton,
            pressed && styles.pressed,
          ]}
        >
          <ThemedText
            style={[styles.detailsText, { color: theme.primaryDark }]}
          >
            View details
          </ThemedText>
          <Ionicons name="arrow-forward" size={16} color={theme.primaryDark} />
        </Pressable>
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
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.four,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    overflow: "hidden",
  },
  pressed: { opacity: 0.78 },
  gallery: { position: "relative" },
  cover: { width: "100%", aspectRatio: 1.6 },
  placeholder: { alignItems: "center", justifyContent: "center" },
  imageTopRow: {
    position: "absolute",
    top: Spacing.three,
    left: Spacing.three,
    right: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  purposeBadge: {
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  purposeText: {
    color: BrandColors.white,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  imageSaveButton: {
    width: 44,
    height: 44,
    marginTop: -6,
    marginRight: -6,
    borderRadius: BorderRadius.full,
    backgroundColor: BrandColors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  dots: {
    position: "absolute",
    bottom: 19,
    alignSelf: "center",
    flexDirection: "row",
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  dotActive: {
    backgroundColor: BrandColors.white,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  photoCount: {
    position: "absolute",
    right: Spacing.three,
    bottom: Spacing.two,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: BorderRadius.full,
    backgroundColor: "rgba(0,0,0,0.68)",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  photoCountText: {
    color: BrandColors.white,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "600",
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    gap: 6,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  priceAside: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  price: {
    flexShrink: 1,
    fontSize: 23,
    lineHeight: 29,
    fontWeight: "800",
  },
  contactButton: {
    width: 44,
    height: 44,
    marginRight: -6,
    marginVertical: -8,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 18, lineHeight: 24, fontWeight: "700" },
  subtitle: { fontSize: 13, lineHeight: 19 },
  highlight: { fontSize: 13, lineHeight: 19, fontWeight: "600" },
  specs: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 3 },
  spec: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  specText: { fontSize: 12, lineHeight: 17, fontWeight: "600" },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 2,
  },
  location: { flexShrink: 1, fontSize: 13, lineHeight: 18 },
  sellerRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  rating: { flexDirection: "row", alignItems: "center", gap: 4 },
  ratingText: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  seller: { flexShrink: 1, fontSize: 13, lineHeight: 18 },
  status: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusText: { fontSize: 10, fontWeight: "700" },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.four,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
    minHeight: 50,
  },
  detailsButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  detailsText: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  date: { flexShrink: 1, fontSize: 12, lineHeight: 18 },
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
