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
import { ErrorState } from "@/shared/components/error-state";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type { ApiClient } from "@/core/api/api-client";
import { createSpareBagApi } from "../services/spare-bag-api";
import { CURRENCIES } from "@/shared/utils/currencies";
import type { Listing, ListingStatus } from "../types/spare-bag-types";

export { DetailRow, SurfaceCard } from "@/shared/components/form-controls";

export function listingTypeLabel(listing: Listing): string {
  return listing.listingType === "SENDER_REQUEST" ? "Sender request" : "Passenger offer";
}

export function formatDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function formatShortDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
}

export function formatDateRange(listing: Pick<Listing, "travelDateStart" | "travelDateEnd">): string {
  return listing.travelDateEnd && listing.travelDateEnd !== listing.travelDateStart
    ? `${formatDate(listing.travelDateStart)} – ${formatDate(listing.travelDateEnd)}`
    : formatDate(listing.travelDateStart);
}

export function formatShortDateRange(listing: Pick<Listing, "travelDateStart" | "travelDateEnd">): string {
  return listing.travelDateEnd && listing.travelDateEnd !== listing.travelDateStart
    ? `${formatShortDate(listing.travelDateStart)} – ${formatShortDate(listing.travelDateEnd)}`
    : formatShortDate(listing.travelDateStart);
}

/** "8", "GBP" → "£8" when a symbol is known, otherwise "8 GBP". */
export function formatCurrencyAmount(amount: number, currency: string): string {
  const symbol = CURRENCIES.find((item) => item.code === currency)?.symbol;
  const value = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return symbol ? `${symbol}${value}` : `${value} ${currency}`;
}

export function formatPrice(listing: Pick<Listing, "priceAmount" | "priceCurrency" | "priceUnit">): string {
  return `${listing.priceAmount} ${listing.priceCurrency} / ${listing.priceUnit === "PER_KG" ? "kg" : "parcel"}`;
}

/** Compact card price — "£8 / kg", "$25 / parcel"; zero means not set. */
export function formatCompactPrice(listing: Pick<Listing, "priceAmount" | "priceCurrency" | "priceUnit">): string {
  if (!listing.priceAmount || listing.priceAmount <= 0) return "Free";
  return `${formatCurrencyAmount(listing.priceAmount, listing.priceCurrency)} / ${listing.priceUnit === "PER_KG" ? "kg" : "parcel"}`;
}

/** Sender maximum budget; null when the sender set no meaningful budget. */
export function formatBudget(listing: Pick<Listing, "priceAmount" | "priceCurrency">): string | null {
  if (!listing.priceAmount || listing.priceAmount <= 0) return null;
  return formatCurrencyAmount(listing.priceAmount, listing.priceCurrency);
}

/** "2 days ago" style relative timestamp for "Posted …" footers. */
export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} wk ago`;
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
}

export function quantitySummary(listing: Listing): string {
  if (listing.listingType === "PASSENGER_OFFER") {
    const capacity = listing.availableCapacityKg == null ? "Capacity not specified" : `${listing.availableCapacityKg} kg available`;
    const parcels = listing.availableParcelCount == null ? "" : ` · ${listing.availableParcelCount} parcel${listing.availableParcelCount === 1 ? "" : "s"}`;
    return `${capacity}${parcels}`;
  }
  const quantities = [
    listing.requestedWeightKg == null ? null : `${listing.requestedWeightKg} kg`,
    listing.requestedParcelCount == null ? null : `${listing.requestedParcelCount} parcel${listing.requestedParcelCount === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return quantities.length ? `${quantities.join(" · ")} requested` : "Quantity not specified";
}

export function ScreenHeader({
  title,
  subtitle,
  back = false,
  centered = false,
  right,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  centered?: boolean;
  right?: React.ReactNode;
}) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <View style={[styles.header, { borderBottomColor: theme.border, backgroundColor: theme.background }]}>
      {back ? (
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={() => router.canGoBack() ? router.back() : router.replace("/(app)/spare-bag" as never)}
          style={[styles.back, centered && styles.headerSlot]}
        >
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </Pressable>
      ) : null}
      <View style={[styles.headerCopy, centered && styles.headerCopyCentered]}>
        <ThemedText style={[styles.headerTitle, centered && styles.headerTitleCentered]} numberOfLines={centered ? 1 : undefined}>{title}</ThemedText>
        {subtitle ? <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={centered && styles.headerTitleCentered}>{subtitle}</ThemedText> : null}
      </View>
      {centered ? <View style={styles.headerSlot}>{right}</View> : right}
    </View>
  );
}

export function ListingTypeBadge({ listing, compact = false }: { listing: Listing; compact?: boolean }) {
  const theme = useTheme();
  const sender = listing.listingType === "SENDER_REQUEST";
  return (
    <View style={[styles.badge, { backgroundColor: sender ? theme.primarySurface : theme.infoSurface }]}>
      <Ionicons name={sender ? "cube-outline" : "airplane-outline"} size={compact ? 12 : 14} color={sender ? theme.primary : theme.info} />
      <ThemedText type="smallBold" style={[styles.badgeText, { color: sender ? theme.primary : theme.info }]}>
        {sender ? "Sender" : "Traveller"}
      </ThemedText>
    </View>
  );
}

const statusTone: Record<ListingStatus, "success" | "warning" | "error" | "primary" | "neutral"> = {
  DRAFT: "neutral",
  PENDING_REVIEW: "warning",
  PUBLISHED: "success",
  PAUSED: "warning",
  MATCHED: "primary",
  CLOSED: "neutral",
  EXPIRED: "error",
  REMOVED: "error",
};

export function StatusBadge({ status }: { status: ListingStatus | string }) {
  const theme = useTheme();
  const tone = status in statusTone ? statusTone[status as ListingStatus] : status === "ACCEPTED" ? "success" : status === "PENDING" ? "warning" : "neutral";
  const color = tone === "neutral" ? theme.textSecondary : theme[tone];
  const backgroundColor = tone === "neutral" ? theme.backgroundElement : theme[`${tone}Surface` as const];
  return (
    <View style={[styles.badge, { backgroundColor }]}>
      <ThemedText type="smallBold" style={[styles.badgeText, { color }]}>{status.replaceAll("_", " ")}</ThemedText>
    </View>
  );
}

export function RouteView({ listing, showDates = true }: { listing: Listing; showDates?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.routeBlock}>
      <View style={styles.routeRow}>
        <View style={styles.airport}>
          <ThemedText style={[styles.airportCode, { color: theme.text }]}>{listing.originAirport.iataCode}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{listing.originAirport.city}</ThemedText>
        </View>
        <View style={styles.routeLine}>
          <View style={[styles.routeRule, { backgroundColor: theme.primaryLight }]} />
          <Ionicons name="airplane" size={18} color={theme.primary} />
          <View style={[styles.routeRule, { backgroundColor: theme.primaryLight }]} />
        </View>
        <View style={[styles.airport, styles.airportEnd]}>
          <ThemedText style={[styles.airportCode, { color: theme.text }]}>{listing.destinationAirport.iataCode}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{listing.destinationAirport.city}</ThemedText>
        </View>
      </View>
      {showDates ? (
        <View style={styles.dateRow}>
          <Ionicons name="calendar-outline" size={15} color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary">{formatDateRange(listing)}</ThemedText>
        </View>
      ) : null}
    </View>
  );
}

export function SafetyNotice({ compact = false }: { compact?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.notice, { backgroundColor: theme.primarySurface }]}>
      <View style={[styles.noticeIcon, { backgroundColor: theme.background }]}>
        <Ionicons name="shield-checkmark-outline" size={20} color={theme.primary} />
      </View>
      <View style={styles.noticeCopy}>
        <ThemedText type="smallBold">Connect carefully. Declare contents truthfully.</ThemedText>
        {!compact ? (
          <ThemedText type="small" themeColor="textSecondary">
            Never carry restricted, illegal, undeclared, or unknown items. Both parties are responsible for customs, immigration, and airline rules. Spare Bag facilitates discovery and contact only; carriage, delivery, insurance, payment protection, and customs clearance are not guaranteed.
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

export function ListingCard({
  listing,
  onToggleSave,
  saveLoading = false,
  children,
}: {
  listing: Listing;
  onToggleSave?: () => void;
  saveLoading?: boolean;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  const router = useRouter();
  const owner = listing.owner?.displayName ?? listing.owner?.username;
  return (
    <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.background }]}>
      <View style={styles.cardTop}>
        <ListingTypeBadge listing={listing} />
        <StatusBadge status={listing.status} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${listing.title}`}
        onPress={() => router.push(`/(app)/spare-bag/${listing.id}` as never)}
        style={styles.cardBody}
      >
        <ThemedText style={styles.cardTitle}>{listing.title}</ThemedText>
        <RouteView listing={listing} />
        <View style={styles.quantityRow}>
          <Ionicons name={listing.listingType === "SENDER_REQUEST" ? "cube-outline" : "briefcase-outline"} size={17} color={theme.primary} />
          <ThemedText type="small">{quantitySummary(listing)}</ThemedText>
        </View>
        {listing.listingType === "PASSENGER_OFFER" && listing.maxSingleParcelKg != null ? (
          <ThemedText type="small" themeColor="textSecondary">Up to {listing.maxSingleParcelKg} kg per parcel</ThemedText>
        ) : null}
        {listing.categories.length ? (
          <View style={styles.categoryRow}>
            {listing.categories.slice(0, 3).map((category) => (
              <View key={category.key} style={[styles.category, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="small" themeColor="textSecondary">{category.displayName}</ThemedText>
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>
      <View style={[styles.cardFooter, { borderTopColor: theme.border }]}>
        <View style={styles.footerCopy}>
          <ThemedText style={[styles.price, { color: theme.primary }]}>{formatPrice(listing)}</ThemedText>
          {owner ? <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>by {owner}</ThemedText> : null}
        </View>
        {onToggleSave ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={listing.saved ? "Remove from saved" : "Save listing"}
            accessibilityState={{ busy: saveLoading }}
            disabled={saveLoading}
            onPress={onToggleSave}
            style={[styles.saveButton, { backgroundColor: theme.primarySurface }]}
          >
            {saveLoading ? <ActivityIndicator size="small" color={theme.primary} /> : <Ionicons name={listing.saved ? "bookmark" : "bookmark-outline"} size={19} color={theme.primary} />}
          </Pressable>
        ) : (
          <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
        )}
      </View>
      {children}
    </View>
  );
}

export function CollectionState({
  loading,
  error,
  empty,
  onRetry,
  emptyTitle = "Nothing here yet",
  emptyMessage = "Try another filter or check back later.",
  action,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  onRetry: () => void;
  emptyTitle?: string;
  emptyMessage?: string;
  action?: React.ReactNode;
}) {
  const theme = useTheme();
  if (loading) return <ActivityIndicator accessibilityLabel="Loading Spare Bag" color={theme.primary} style={styles.loading} />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (empty) {
    return (
      <View style={styles.empty}>
        <View style={[styles.emptyIcon, { backgroundColor: theme.primarySurface }]}>
          <Ionicons name="briefcase-outline" size={30} color={theme.primary} />
        </View>
        <ThemedText style={styles.emptyTitle}>{emptyTitle}</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.emptyMessage}>{emptyMessage}</ThemedText>
        {action}
      </View>
    );
  }
  return null;
}

export function ListingImage({ client, listingId, mediaId }: { client: ApiClient; listingId: string; mediaId: string }) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    createSpareBagApi(client).mediaDownloadUrl(listingId, mediaId)
      .then((result) => { if (active) setUri(result.downloadUrl); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [client, listingId, mediaId]);
  if (failed) return null;
  if (!uri) return <ActivityIndicator accessibilityLabel="Loading listing image" />;
  return <Image source={{ uri }} style={styles.image} accessibilityLabel="Listing image" />;
}

export function RetryButton({ onPress }: { onPress: () => void }) {
  return <PrimaryButton label="Try again" onPress={onPress} variant="secondary" />;
}

const styles = StyleSheet.create({
  header: { minHeight: 64, flexDirection: "row", alignItems: "center", paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, gap: Spacing.two },
  back: { padding: Spacing.one, marginLeft: -Spacing.one },
  headerCopy: { flex: 1, gap: 2 },
  headerCopyCentered: { alignItems: "center" },
  headerTitle: { fontSize: 22, lineHeight: 28, fontWeight: "700" },
  headerTitleCentered: { textAlign: "center" },
  headerSlot: { width: 36, alignItems: "center", justifyContent: "center" },

  badge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: Spacing.one, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  badgeText: { fontSize: 11, lineHeight: 16, textTransform: "capitalize" },
  routeBlock: { gap: Spacing.two },
  routeRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  airport: { flex: 1, minWidth: 0, gap: 2 },
  airportEnd: { alignItems: "flex-end" },
  airportCode: { fontSize: 24, lineHeight: 29, fontWeight: "800", letterSpacing: 0.4 },
  routeLine: { flex: 0.8, flexDirection: "row", alignItems: "center", gap: Spacing.one },
  routeRule: { height: 1, flex: 1 },
  dateRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.one },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.two, padding: Spacing.three, borderRadius: BorderRadius.lg },
  noticeIcon: { width: 36, height: 36, borderRadius: BorderRadius.full, alignItems: "center", justifyContent: "center" },
  noticeCopy: { flex: 1, gap: Spacing.one },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: BorderRadius.xl, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: Spacing.two, paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  cardBody: { padding: Spacing.three, gap: Spacing.three },
  cardTitle: { fontSize: 19, lineHeight: 25, fontWeight: "700" },
  quantityRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.one },
  category: { borderRadius: BorderRadius.full, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  cardFooter: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
  footerCopy: { flex: 1, gap: 2 },
  price: { fontSize: 16, lineHeight: 22, fontWeight: "800" },
  saveButton: { width: 40, height: 40, borderRadius: BorderRadius.full, alignItems: "center", justifyContent: "center" },
  loading: { margin: Spacing.five },
  empty: { alignItems: "center", paddingHorizontal: Spacing.four, paddingVertical: Spacing.six, gap: Spacing.two },
  emptyIcon: { width: 64, height: 64, borderRadius: BorderRadius.full, alignItems: "center", justifyContent: "center", marginBottom: Spacing.two },
  emptyTitle: { fontSize: 20, lineHeight: 26, fontWeight: "700", textAlign: "center" },
  emptyMessage: { textAlign: "center", maxWidth: 340, marginBottom: Spacing.two },
  image: { width: "100%", height: 240, borderRadius: BorderRadius.lg },
});
