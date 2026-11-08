import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { ApiError } from "@/core/api/api-error";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type { PropertyItem, PropertyStatus } from "../types/property-types";
import { createPropertyApi } from "../services/property-api";
import {
  distanceKm,
  formatDistanceValue,
  formatMoney,
  formatPrice,
  furnishedLabel,
  pricePeriodLabel,
  publishedLabel,
  statusLabel,
} from "../utils/property-format";
import { usePropertySave } from "../hooks/use-property-save";
import { PurposeBadge } from "./property-marketplace-ui";
import { PropertyImage } from "./property-image";

export function PropertyCard({
  item,
  onPress,
  onUnsave,
  origin,
  managed = false,
}: {
  item: PropertyItem;
  onPress: (propertyId: string) => void;
  onUnsave?: () => void;
  /** Search origin used to show an approximate distance, like OpenRent's km badge. */
  origin?: { latitude: number; longitude: number } | null;
  /** Owner view — swaps save/enquire affordances for status badge and listing stats. */
  managed?: boolean;
}) {
  const theme = useTheme();
  const accent = theme.info;
  const router = useRouter();
  const { apiClient } = useSession();
  const property = item.property;
  const save = usePropertySave(property.id, item.saved);
  const published = publishedLabel(property.publishedAt);
  const [enquiring, setEnquiring] = useState(false);
  const [enquiryError, setEnquiryError] = useState<string | null>(null);
  const [mediaIds, setMediaIds] = useState<string[] | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [singlePhoto, setSinglePhoto] = useState(false);

  const distance = origin ? distanceKm(origin, item.location) : null;
  const place =
    item.location?.city ??
    item.location?.region ??
    item.location?.countryName ??
    null;
  const facts = [
    property.bedrooms != null
      ? `${property.bedrooms} ${property.bedrooms === 1 ? "Bed" : "Beds"}`
      : null,
    property.bathrooms != null
      ? `${property.bathrooms} ${property.bathrooms === 1 ? "Bath" : "Baths"}`
      : null,
    furnishedLabel(property.furnishedStatus),
    property.floorArea != null
      ? `${property.floorArea} ${property.floorAreaUnit === "SQFT" ? "ft²" : "m²"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const canEnquire = property.status === "PUBLISHED" && !item.canManage;
  const period = pricePeriodLabel(item);
  const mediaId = mediaIds?.[photoIndex] ?? item.coverMediaId;
  const tone = statusTone(theme, property.status);
  const dateLabel =
    published ??
    (managed
      ? `Added ${new Date(property.createdAt).toLocaleDateString()}`
      : null);

  const nextPhoto = useCallback(async () => {
    if (galleryBusy) return;
    if (mediaIds) {
      setPhotoIndex((index) => (index + 1) % mediaIds.length);
      return;
    }
    setGalleryBusy(true);
    try {
      const detail = await createPropertyApi(apiClient).detail(property.id);
      const ids = detail.media
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((entry) => entry.mediaId);
      if (ids.length > 1) {
        const cover = Math.max(0, ids.indexOf(item.coverMediaId ?? ""));
        setMediaIds(ids);
        setPhotoIndex((cover + 1) % ids.length);
      } else {
        setSinglePhoto(true);
      }
    } catch {
      // Keep the chevron available so the gallery can be retried.
    } finally {
      setGalleryBusy(false);
    }
  }, [apiClient, galleryBusy, item.coverMediaId, mediaIds, property.id]);

  const enquire = useCallback(async () => {
    if (enquiring) return;
    setEnquiring(true);
    setEnquiryError(null);
    try {
      const result = await createPropertyApi(apiClient).enquiry(property.id);
      router.push(`/messages/${result.conversationId}` as never);
    } catch (cause) {
      setEnquiryError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "Could not start a property enquiry.",
      );
    } finally {
      setEnquiring(false);
    }
  }, [apiClient, enquiring, property.id, router]);

  return (
    <View style={styles.card}>
      <View style={[styles.media, { backgroundColor: theme.backgroundElement }]}>
        <Pressable
          onPress={() => onPress(property.id)}
          accessibilityRole="button"
          accessibilityLabel={`${property.title}, ${formatPrice(item)}`}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <PropertyImage
            propertyId={property.id}
            mediaId={mediaId}
            style={styles.image}
          />
        </Pressable>
        <View style={styles.badge}>
          <PurposeBadge purpose={property.listingPurpose} />
        </View>
        {item.coverMediaId && !singlePhoto ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next property photo"
            accessibilityState={{ disabled: galleryBusy }}
            onPress={() => void nextPhoto()}
            style={[styles.next, styles.overlay]}
          >
            {galleryBusy ? (
              <ActivityIndicator color={BrandColors.white} size="small" />
            ) : (
              <Ionicons
                name="chevron-forward"
                size={20}
                color={BrandColors.white}
              />
            )}
          </Pressable>
        ) : null}
        {mediaIds && mediaIds.length > 1 ? (
          <View style={styles.dots} accessibilityElementsHidden>
            {mediaIds.map((id, index) => (
              <View
                key={id}
                style={[styles.dot, index === photoIndex && styles.dotActive]}
              />
            ))}
          </View>
        ) : null}
      </View>
      <Pressable
        onPress={() => onPress(property.id)}
        accessibilityRole="button"
        accessibilityLabel={`View ${property.title}`}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
      >
        <View style={styles.priceRow}>
          <ThemedText style={styles.priceText} numberOfLines={1}>
            <ThemedText style={[styles.price, { color: accent }]}>
              {formatMoney(property.priceAmount, property.currencyCode)}
            </ThemedText>
            {period ? (
              <ThemedText themeColor="textSecondary" style={styles.period}>
                {" "}
                {period}
              </ThemedText>
            ) : null}
          </ThemedText>
          {distance != null || place ? (
            <View style={styles.place}>
              <Ionicons name="location" size={15} color={accent} />
              {distance != null ? (
                <ThemedText style={styles.placeText} numberOfLines={1}>
                  <ThemedText style={[styles.placeText, { color: accent }]}>
                    {formatDistanceValue(distance)}
                  </ThemedText>
                  <ThemedText
                    themeColor="textSecondary"
                    style={styles.placeUnit}
                  >
                    {" "}
                    km
                  </ThemedText>
                </ThemedText>
              ) : (
                <ThemedText
                  style={[styles.placeText, { color: accent }]}
                  numberOfLines={1}
                >
                  {place}
                </ThemedText>
              )}
            </View>
          ) : null}
        </View>
        <ThemedText
          style={[styles.title, { color: accent }]}
          numberOfLines={2}
        >
          {property.title}
        </ThemedText>
        {facts ? (
          <ThemedText themeColor="textSecondary" style={styles.facts}>
            {facts}
          </ThemedText>
        ) : null}
        {managed || property.status !== "PUBLISHED" ? (
          <View style={styles.metaRow}>
            <View style={[styles.status, { backgroundColor: tone.bg }]}>
              <View style={[styles.statusDot, { backgroundColor: tone.fg }]} />
              <ThemedText style={[styles.statusText, { color: tone.fg }]}>
                {statusLabel(property.status)}
              </ThemedText>
            </View>
            {managed && property.businessAccountId ? (
              <View style={[styles.business, { borderColor: theme.border }]}>
                <Ionicons
                  name="briefcase-outline"
                  size={11}
                  color={theme.textSecondary}
                />
                <ThemedText
                  themeColor="textSecondary"
                  style={styles.businessText}
                >
                  Business
                </ThemedText>
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={styles.actionRow}>
          <ThemedText themeColor="textSecondary" style={styles.date}>
            {dateLabel}
          </ThemedText>
          {managed ? (
            <View
              style={styles.stats}
              accessible
              accessibilityLabel={`${item.viewCount} views, ${item.enquiryCount} enquiries, ${item.saveCount} saves`}
            >
              <View style={styles.stat}>
                <Ionicons
                  name="eye-outline"
                  size={14}
                  color={theme.textSecondary}
                />
                <ThemedText themeColor="textSecondary" style={styles.statText}>
                  {item.viewCount}
                </ThemedText>
              </View>
              <View style={styles.stat}>
                <Ionicons
                  name="chatbubble-outline"
                  size={13}
                  color={theme.textSecondary}
                />
                <ThemedText themeColor="textSecondary" style={styles.statText}>
                  {item.enquiryCount}
                </ThemedText>
              </View>
              <View style={styles.stat}>
                <Ionicons
                  name="bookmark-outline"
                  size={13}
                  color={theme.textSecondary}
                />
                <ThemedText themeColor="textSecondary" style={styles.statText}>
                  {item.saveCount}
                </ThemedText>
              </View>
            </View>
          ) : canEnquire ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Enquire about ${property.title}`}
              accessibilityState={{ disabled: enquiring }}
              disabled={enquiring}
              onPress={() => void enquire()}
              style={[styles.enquire, { borderColor: accent }]}
            >
              {enquiring ? (
                <ActivityIndicator color={accent} size="small" />
              ) : (
                <>
                  <ThemedText style={[styles.enquireText, { color: accent }]}>
                    Enquire
                  </ThemedText>
                  <Ionicons name="mail-outline" size={16} color={accent} />
                </>
              )}
            </Pressable>
          ) : null}
        </View>
      </Pressable>
      {!managed && (property.status === "PUBLISHED" || save.saved) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            save.saved ? "Remove from saved properties" : "Save property"
          }
          accessibilityState={{ disabled: save.pending, selected: save.saved }}
          disabled={save.pending}
          onPress={() => {
            const wasSaved = save.saved;
            void save.toggle().then((success) => {
              if (success && wasSaved) onUnsave?.();
            });
          }}
          style={[styles.save, styles.overlay]}
        >
          {save.pending ? (
            <ActivityIndicator color={BrandColors.white} />
          ) : (
            <Ionicons
              name={save.saved ? "bookmark" : "bookmark-outline"}
              size={20}
              color={BrandColors.white}
            />
          )}
        </Pressable>
      ) : null}
      {save.error || enquiryError ? (
        <ThemedText accessibilityRole="alert" style={styles.error}>
          {save.error ?? enquiryError}
        </ThemedText>
      ) : null}
    </View>
  );
}

function statusTone(
  theme: ReturnType<typeof useTheme>,
  status: PropertyStatus,
): { fg: string; bg: string } {
  switch (status) {
    case "PUBLISHED":
      return { fg: theme.success, bg: theme.successSurface };
    case "PENDING_REVIEW":
    case "PAUSED":
    case "EXPIRED":
      return { fg: theme.warning, bg: theme.warningSurface };
    case "REJECTED":
    case "REMOVED":
      return { fg: theme.error, bg: theme.errorSurface };
    case "SOLD":
    case "RENTED":
      return { fg: theme.info, bg: theme.infoSurface };
    default:
      return { fg: theme.textSecondary, bg: theme.backgroundElement };
  }
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.three,
    marginTop: Spacing.four,
  },
  pressed: { opacity: 0.82 },
  media: {
    borderRadius: 8,
    overflow: "hidden",
  },
  image: { height: undefined, aspectRatio: 1.7 },
  overlay: {
    position: "absolute",
    width: 38,
    height: 38,
    borderRadius: BorderRadius.full,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  badge: { position: "absolute", top: Spacing.two, left: Spacing.two },
  save: { position: "absolute", top: Spacing.two, right: Spacing.two },
  next: { position: "absolute", right: Spacing.two, top: "45%" },
  dots: {
    position: "absolute",
    bottom: Spacing.two,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: BrandColors.white,
    opacity: 0.45,
  },
  dotActive: { opacity: 1 },
  body: { paddingTop: Spacing.two, gap: 3 },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  priceText: { flexShrink: 1 },
  price: { fontSize: 20, lineHeight: 26, fontWeight: "800" },
  period: { fontSize: 16, lineHeight: 26, fontWeight: "600" },
  place: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    flexShrink: 1,
  },
  placeText: { fontSize: 15, fontWeight: "700" },
  placeUnit: { fontSize: 13, fontWeight: "600" },
  title: { fontSize: 17, lineHeight: 23, fontWeight: "600" },
  facts: { fontSize: 14, lineHeight: 20, marginTop: 2 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    marginTop: 2,
  },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: "700" },
  business: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  businessText: { fontSize: 11, fontWeight: "600" },
  stats: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two + 2,
  },
  stat: { flexDirection: "row", alignItems: "center", gap: 3 },
  statText: { fontSize: 12, fontWeight: "600" },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  date: { flex: 1, fontSize: 12, lineHeight: 17 },
  enquire: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.one,
  },
  enquireText: { fontSize: 14, fontWeight: "700" },
  error: { color: BrandColors.error, paddingTop: Spacing.two, fontSize: 13 },
});
