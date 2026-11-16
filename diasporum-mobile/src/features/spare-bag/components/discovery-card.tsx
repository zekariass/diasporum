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

      <View style={styles.metaRow}>
        <Ionicons name="airplane-outline" size={14} color={theme.primary} />
        <ThemedText style={styles.metaRoute}>
          {listing.originAirport.iataCode} → {listing.destinationAirport.iataCode}
        </ThemedText>
        <Ionicons
          name="calendar-outline"
          size={13}
          color={theme.textSecondary}
        />
        <ThemedText
          type="small"
          themeColor="textSecondary"
          numberOfLines={1}
          style={styles.metaDates}
        >
          {formatShortDateRange(listing)}
        </ThemedText>
        <ThemedText
          style={[styles.priceText, { color: theme.primary }]}
          numberOfLines={1}
        >
          {sender
            ? budget
              ? `Up to ${budget}`
              : "Flexible"
            : formatCompactPrice(listing)}
        </ThemedText>
      </View>

      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <Avatar
          name={owner?.displayName ?? owner?.username}
          mediaId={owner?.avatarMediaId}
          userId={owner?.id}
          size={26}
        />
        <ThemedText
          type="smallBold"
          numberOfLines={1}
          style={styles.ownerName}
        >
          {owner?.displayName ?? owner?.username ?? "Spare Bag member"}
        </ThemedText>
        {posted ? (
          <ThemedText
            themeColor="textSecondary"
            numberOfLines={1}
            style={styles.posted}
          >
            {posted}
          </ThemedText>
        ) : null}
        <Ionicons
          name="chevron-forward"
          size={16}
          color={theme.textSecondary}
        />
      </View>
    </Pressable>
  );
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
      <View style={styles.metaRow}>
        <View style={[block, { height: 16, flex: 1 }]} />
        <View style={[block, { height: 18, width: 64 }]} />
      </View>
      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <View
          style={[
            block,
            { width: 26, height: 26, borderRadius: BorderRadius.full },
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
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  metaRoute: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  metaDates: { flex: 1, minWidth: 0 },
  priceText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    textAlign: "right",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  ownerName: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18 },
  posted: { fontSize: 12, lineHeight: 16, flexShrink: 0 },
  skeletonLines: { gap: Spacing.two, paddingTop: 2 },
});
