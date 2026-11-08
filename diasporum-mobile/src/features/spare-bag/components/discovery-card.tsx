import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type { ApiClient } from "@/core/api/api-client";
import { Avatar } from "@/features/feed/components/avatar";
import { createSpareBagApi } from "../services/spare-bag-api";
import type { Category, Listing } from "../types/spare-bag-types";
import {
  formatBudget,
  formatCompactPrice,
  formatRelativeTime,
  formatShortDateRange,
} from "./spare-bag-ui";

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  DOCUMENTS: "document-text-outline",
  CLOTHING: "shirt-outline",
  GIFTS: "gift-outline",
  BOOKS: "book-outline",
  HOUSEHOLD_ITEMS: "home-outline",
  OTHER: "cube-outline",
};

function categoryIcon(category: Category): keyof typeof Ionicons.glyphMap {
  return CATEGORY_ICONS[category.key] ?? "cube-outline";
}

/** Placeholder icon per listing type / first parcel category — keeps card
 * layout identical whether or not the owner uploaded an image. */
function placeholderIcon(listing: Listing): keyof typeof Ionicons.glyphMap {
  if (listing.listingType === "PASSENGER_OFFER") return "briefcase-outline";
  const first = listing.categories[0];
  return first ? categoryIcon(first) : "cube-outline";
}

/** Square listing thumbnail — resolves the first media item through the
 * authorized download-url endpoint, else a themed category placeholder. */
export function ListingThumbnail({
  client,
  listing,
}: {
  client: ApiClient;
  listing: Listing;
}) {
  const theme = useTheme();
  const mediaId = listing.mediaIds[0];
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!mediaId) return;
    let active = true;
    createSpareBagApi(client)
      .mediaDownloadUrl(listing.id, mediaId)
      .then((result) => {
        if (active) setUri(result.downloadUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [client, listing.id, mediaId]);

  return (
    <View style={[styles.thumb, { backgroundColor: theme.primarySurface }]}>
      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={{ width: "100%", height: "100%" }}
          accessibilityLabel={`${listing.title} image`}
          onError={() => setFailed(true)}
        />
      ) : (
        <Ionicons
          name={placeholderIcon(listing)}
          size={34}
          color={theme.primary}
        />
      )}
    </View>
  );
}

/** Dashboard listing card matching the Spare Bag Listings reference. */
export function DiscoveryListingCard({
  client,
  listing,
  onToggleSave,
  saveLoading = false,
}: {
  client: ApiClient;
  listing: Listing;
  onToggleSave?: () => void;
  saveLoading?: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  const sender = listing.listingType === "SENDER_REQUEST";
  const owner = listing.owner;
  const budget = sender ? formatBudget(listing) : null;
  const posted = formatRelativeTime(listing.publishedAt ?? listing.createdAt);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${listing.title}`}
      onPress={() => router.push(`/(app)/spare-bag/${listing.id}` as never)}
      style={({ pressed }) => [
        styles.card,
        {
          borderColor: theme.border,
          backgroundColor: theme.background,
          shadowColor: theme.text,
        },
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.cardTop}>
        <ListingThumbnail client={client} listing={listing} />
        <View style={styles.cardMain}>
          <View style={styles.titleRow}>
            <ThemedText style={styles.title} numberOfLines={2}>
              {listing.title}
            </ThemedText>
            {onToggleSave ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  listing.saved ? "Remove from saved" : "Save listing"
                }
                accessibilityState={{ busy: saveLoading }}
                disabled={saveLoading}
                onPress={onToggleSave}
                hitSlop={6}
                style={styles.save}
              >
                {saveLoading ? (
                  <ActivityIndicator size="small" color={theme.primary} />
                ) : (
                  <Ionicons
                    name={listing.saved ? "heart" : "heart-outline"}
                    size={22}
                    color={listing.saved ? theme.primary : theme.text}
                  />
                )}
              </Pressable>
            ) : null}
          </View>
          <View
            style={[
              styles.badge,
              {
                backgroundColor: sender
                  ? theme.primarySurface
                  : theme.successSurface,
              },
            ]}
          >
            <Ionicons
              name={sender ? "cube-outline" : "airplane-outline"}
              size={12}
              color={sender ? theme.primary : theme.success}
            />
            <ThemedText
              style={[
                styles.badgeText,
                { color: sender ? theme.primary : theme.success },
              ]}
            >
              {sender ? "Sender Request" : "Passenger Offer"}
            </ThemedText>
          </View>
        </View>
      </View>

      <View
        style={[
          styles.routePanel,
          { backgroundColor: theme.backgroundElement },
        ]}
      >
        <View style={styles.routeLine}>
          <View style={styles.airport}>
            <ThemedText style={styles.airportCode}>
              {listing.originAirport.iataCode}
            </ThemedText>
            <ThemedText
              themeColor="textSecondary"
              style={styles.airportCity}
              numberOfLines={1}
            >
              {listing.originAirport.city}
            </ThemedText>
          </View>
          <View style={styles.routeJourney}>
            <View
              style={[
                styles.routeRule,
                { backgroundColor: theme.primaryLight },
              ]}
            />
            <Ionicons name="airplane" size={17} color={theme.primary} />
            <View
              style={[
                styles.routeRule,
                { backgroundColor: theme.primaryLight },
              ]}
            />
          </View>
          <View style={[styles.airport, styles.destination]}>
            <ThemedText style={styles.airportCode}>
              {listing.destinationAirport.iataCode}
            </ThemedText>
            <ThemedText
              themeColor="textSecondary"
              style={styles.airportCity}
              numberOfLines={1}
            >
              {listing.destinationAirport.city}
            </ThemedText>
          </View>
        </View>
        <View style={[styles.travelRow, { borderTopColor: theme.border }]}>
          <Ionicons name="calendar-outline" size={15} color={theme.primary} />
          <ThemedText type="small" themeColor="textSecondary">
            {formatShortDateRange(listing)}
          </ThemedText>
        </View>
      </View>

      <View style={styles.detailsRow}>
        <View style={styles.quantity}>
          <Ionicons
            name={sender ? "cube-outline" : "briefcase-outline"}
            size={18}
            color={theme.primary}
          />
          <ThemedText
            type="small"
            style={styles.quantityText}
            numberOfLines={2}
          >
            {sender ? senderQuantity(listing) : passengerQuantity(listing)}
          </ThemedText>
        </View>
        <View style={styles.priceBlock}>
          <ThemedText themeColor="textSecondary" style={styles.priceCaption}>
            {sender ? "Budget" : "Price"}
          </ThemedText>
          <ThemedText
            style={[styles.priceText, { color: theme.primary }]}
            numberOfLines={2}
          >
            {sender
              ? budget
                ? `Up to ${budget}`
                : "Flexible"
              : formatCompactPrice(listing)}
          </ThemedText>
        </View>
      </View>

      {sender && listing.categories.length ? (
        <View style={styles.categoryChips}>
          {listing.categories.slice(0, 2).map((category) => (
            <View
              key={category.key}
              style={[
                styles.categoryChip,
                { backgroundColor: theme.backgroundElement },
              ]}
            >
              <Ionicons
                name={categoryIcon(category)}
                size={14}
                color={theme.primary}
              />
              <ThemedText style={styles.categoryText}>
                {category.displayName}
              </ThemedText>
            </View>
          ))}
          {listing.categories.length > 2 ? (
            <ThemedText
              themeColor="textSecondary"
              style={styles.moreCategories}
            >
              +{listing.categories.length - 2} more
            </ThemedText>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <Avatar
          name={owner?.displayName ?? owner?.username}
          mediaId={owner?.avatarMediaId}
          userId={owner?.id}
          size={32}
        />
        <View style={styles.ownerCopy}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {owner?.displayName ?? owner?.username ?? "Spare Bag member"}
          </ThemedText>
          {posted ? (
            <ThemedText themeColor="textSecondary" style={styles.posted}>
              Posted {posted}
            </ThemedText>
          ) : null}
        </View>
        <View style={styles.detailsAffordance}>
          <ThemedText style={[styles.detailsText, { color: theme.primary }]}>
            Details
          </ThemedText>
          <Ionicons name="chevron-forward" size={16} color={theme.primary} />
        </View>
      </View>
    </Pressable>
  );
}

function passengerQuantity(listing: Listing): string {
  const parts: string[] = [];
  parts.push(
    listing.availableCapacityKg == null
      ? "Capacity on request"
      : `Up to ${listing.availableCapacityKg} kg`,
  );
  if (listing.maxSingleParcelKg != null)
    parts.push(`Max ${listing.maxSingleParcelKg} kg per parcel`);
  else if (listing.availableParcelCount != null) {
    parts.push(
      `${listing.availableParcelCount} parcel${listing.availableParcelCount === 1 ? "" : "s"}`,
    );
  }
  return parts.join("  |  ");
}

function senderQuantity(listing: Listing): string {
  const parts: string[] = [];
  if (listing.requestedWeightKg != null)
    parts.push(`About ${listing.requestedWeightKg} kg`);
  if (listing.requestedParcelCount != null) {
    parts.push(
      `${listing.requestedParcelCount} parcel${listing.requestedParcelCount === 1 ? "" : "s"}`,
    );
  }
  return parts.length ? parts.join("  |  ") : "Quantity on request";
}

/** Loading placeholder matching the dashboard card silhouette. */
export function DiscoveryCardSkeleton() {
  const theme = useTheme();
  const block = {
    backgroundColor: theme.backgroundElement,
    borderRadius: BorderRadius.sm,
  } as const;
  return (
    <View
      style={[
        styles.card,
        { borderColor: theme.border, backgroundColor: theme.background },
      ]}
    >
      <View style={styles.cardTop}>
        <View style={[styles.thumb, block]} />
        <View style={[styles.cardMain, styles.skeletonLines]}>
          <View style={[block, { height: 18, width: "88%" }]} />
          <View style={[block, { height: 18, width: "62%" }]} />
          <View
            style={[
              block,
              { height: 22, width: 116, borderRadius: BorderRadius.full },
            ]}
          />
        </View>
      </View>
      <View style={[styles.skeletonRoute, block]} />
      <View style={styles.detailsRow}>
        <View style={[block, { height: 16, width: "55%" }]} />
        <View style={[block, { height: 28, width: 76 }]} />
      </View>
      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <View
          style={[
            block,
            { width: 32, height: 32, borderRadius: BorderRadius.full },
          ]}
        />
        <View style={[block, { height: 14, width: 120 }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: BorderRadius.xl,
    overflow: "hidden",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardPressed: { opacity: 0.94 },
  cardTop: {
    flexDirection: "row",
    gap: Spacing.three,
    padding: Spacing.three,
    paddingBottom: Spacing.two,
  },
  thumb: {
    width: 76,
    height: 76,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  cardMain: { flex: 1, minWidth: 0, gap: Spacing.two },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.one,
  },
  title: { flex: 1, fontSize: 17, lineHeight: 22, fontWeight: "700" },
  save: {
    width: 36,
    height: 36,
    marginTop: -Spacing.two,
    marginRight: -Spacing.two,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 11, lineHeight: 15, fontWeight: "700" },
  routePanel: {
    marginHorizontal: Spacing.three,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  routeLine: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  airport: { flex: 1, minWidth: 0 },
  destination: { alignItems: "flex-end" },
  airportCode: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  airportCity: { fontSize: 11, lineHeight: 15 },
  routeJourney: {
    width: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  routeRule: { flex: 1, height: 1 },
  travelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
  },
  detailsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  quantity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  quantityText: { flex: 1, fontSize: 13, lineHeight: 18 },
  priceBlock: { maxWidth: 126, alignItems: "flex-end" },
  priceCaption: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  priceText: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "800",
    textAlign: "right",
  },
  categoryChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  categoryText: { fontSize: 11, lineHeight: 16, fontWeight: "600" },
  moreCategories: { fontSize: 11, lineHeight: 16 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  ownerCopy: { flex: 1, minWidth: 0, gap: 1 },
  posted: { fontSize: 12, lineHeight: 16 },
  detailsAffordance: { flexDirection: "row", alignItems: "center", gap: 1 },
  detailsText: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  skeletonLines: { gap: Spacing.two, paddingTop: 2 },
  skeletonRoute: {
    height: 82,
    marginHorizontal: Spacing.three,
    borderRadius: BorderRadius.lg,
  },
});
