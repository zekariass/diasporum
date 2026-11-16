/**
 * Shop Marketplace UI kit — Vinted-style primitives shared by buyer and seller
 * screens: money formatting, product grid cards, status pills, chips, headers.
 */
import React from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ColorValue,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import type { Money, ProductCard } from "../types/shop-types";

// ------------------------------------------------------------------ money

export function formatMoney(money: Money | null | undefined): string {
  if (!money) return "—";
  const exponent = Number.isFinite(money.exponent) ? money.exponent : 2;
  const amount = money.amountMinor / 10 ** exponent;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: money.currencyCode.trim(),
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(amount);
  } catch {
    return `${amount.toFixed(exponent)} ${money.currencyCode.trim()}`;
  }
}

export function PriceText({
  money,
  compareAt,
  style,
}: {
  money: Money | null | undefined;
  compareAt?: Money | null;
  style?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();
  return (
    <View style={styles.priceRow}>
      <ThemedText style={[styles.price, { color: theme.text }, style]}>
        {formatMoney(money)}
      </ThemedText>
      {compareAt && compareAt.amountMinor > (money?.amountMinor ?? 0) ? (
        <ThemedText style={[styles.compareAt, { color: theme.textMuted }]}>
          {formatMoney(compareAt)}
        </ThemedText>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ labels

// Matches products.condition CHECK in V28.
const CONDITION_LABELS: Record<string, string> = {
  NEW: "New",
  LIKE_NEW: "Like new",
  USED_GOOD: "Good",
  USED_FAIR: "Fair",
  REFURBISHED: "Refurbished",
  OTHER: "Other",
};

export function conditionLabel(condition: string | null | undefined): string {
  if (!condition) return "";
  return CONDITION_LABELS[condition] ?? condition.replaceAll("_", " ").toLowerCase();
}

export function StatusPill({ status }: { status: string }) {
  const theme = useTheme();
  const tone = ((): { bg: ColorValue; fg: ColorValue } => {
    switch (status) {
      case "ACTIVE": case "PUBLISHED": case "PAID": case "DELIVERED": case "SUCCEEDED":
      case "APPROVED": case "COMPLETED":
        return { bg: theme.successSurface, fg: theme.success };
      case "PENDING_REVIEW": case "PROCESSING": case "ACCEPTED": case "IN_TRANSIT":
      case "OUT_FOR_DELIVERY": case "PAYMENT_PENDING": case "PENDING": case "REQUESTED":
      case "DISPATCHED":
        return { bg: theme.warningSurface, fg: theme.warning };
      case "REJECTED": case "SUSPENDED": case "CANCELLED": case "FAILED":
      case "PAYMENT_FAILED": case "RETURNED_TO_SENDER":
        return { bg: theme.errorSurface, fg: theme.error };
      default:
        return { bg: theme.backgroundElement, fg: theme.textSecondary };
    }
  })();
  return (
    <View style={[styles.pill, { backgroundColor: tone.bg }]}>
      <Text style={[styles.pillText, { color: tone.fg }]}>
        {status.replaceAll("_", " ")}
      </Text>
    </View>
  );
}

/**
 * Buyer-facing seller identity badge — "Business" chip for shops backed by a
 * Business Account, plus a verified checkmark once Stripe identity
 * verification has cleared. Individual sellers show nothing extra; the
 * shop name alone is enough.
 */
export function SellerTypeBadge({
  sellerType,
  verificationStatus,
}: {
  sellerType: string;
  verificationStatus?: string;
}) {
  const theme = useTheme();
  if (sellerType !== "BUSINESS" && verificationStatus !== "VERIFIED") return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {sellerType === "BUSINESS" ? (
        <View style={[styles.pill, { backgroundColor: theme.backgroundElement, flexDirection: "row", gap: 4 }]}>
          <Ionicons name="briefcase" size={11} color={theme.textSecondary} />
          <Text style={[styles.pillText, { color: theme.textSecondary }]}>Business</Text>
        </View>
      ) : null}
      {verificationStatus === "VERIFIED" ? (
        <Ionicons name="checkmark-circle" size={16} color={theme.success} accessibilityLabel="Verified seller" />
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ product card (grid)

export function ShopProductCard({
  product,
  onPress,
  onFavourite,
  width,
}: {
  product: ProductCard;
  onPress: () => void;
  onFavourite?: () => void;
  width: number;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${formatMoney(product.price)}`}
      style={({ pressed }) => [styles.card, { width }, pressed && styles.cardPressed]}
    >
      <View style={[styles.cardImageWrap, { backgroundColor: theme.backgroundElement }]}>
        {product.imageUrl ? (
          <Image source={{ uri: product.imageUrl }} style={styles.cardImage} resizeMode="cover" />
        ) : (
          <Ionicons name="image-outline" size={28} color={theme.textMuted} style={styles.cardIcon} />
        )}
        {onFavourite ? (
          <Pressable
            onPress={onFavourite}
            accessibilityRole="button"
            accessibilityLabel={product.favourited ? "Remove from favourites" : "Add to favourites"}
            style={[styles.heart, { backgroundColor: theme.background }]}
            hitSlop={8}
          >
            <Ionicons
              name={product.favourited ? "heart" : "heart-outline"}
              size={16}
              color={product.favourited ? theme.error : theme.text}
            />
          </Pressable>
        ) : null}
        {!product.available ? (
          <View style={[styles.soldOut, { backgroundColor: theme.textSecondary }]}>
            <Text style={styles.soldOutText}>Sold</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.cardBody}>
        <PriceText money={product.price} compareAt={product.compareAtPrice} />
        <ThemedText numberOfLines={1} style={[styles.cardTitle, { color: theme.textSecondary }]}>
          {product.brand ? `${product.brand} · ` : ""}{conditionLabel(product.condition)}
        </ThemedText>
        <ThemedText numberOfLines={1} style={[styles.cardName, { color: theme.text }]}>
          {product.name}
        </ThemedText>
      </View>
    </Pressable>
  );
}

// ------------------------------------------------------------------ chips / headers

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? theme.text : theme.backgroundElement },
        pressed && styles.cardPressed,
      ]}
    >
      <Text style={[styles.chipText, { color: selected ? theme.background : theme.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Segmented-control tabs — equal-width segments in a rounded track, the active
 * one raised as a pill. Use for in-screen tab switching (seller Manage, order
 * filters); cleaner and more compact than a row of floating chips.
 */
export function SegmentedTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly { key: T; label: string }[];
  active: T;
  onChange: (key: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.segmentedTrack, { backgroundColor: theme.backgroundElement }]}>
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.segment,
              selected && {
                backgroundColor: theme.background,
                shadowColor: "#000",
                shadowOpacity: 0.12,
                shadowRadius: 4,
                shadowOffset: { width: 0, height: 1 },
                elevation: 2,
              },
              pressed && !selected && { opacity: 0.7 },
            ]}
          >
            <Text style={[
              styles.segmentLabel,
              { color: selected ? theme.text : theme.textSecondary,
                fontWeight: selected ? "700" : "500" },
            ]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ShopHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.header, { borderBottomColor: theme.border }]}>
      <View style={styles.headerText}>
        <ThemedText type="title" style={{ color: theme.text }}>{title}</ThemedText>
        {subtitle ? (
          <ThemedText type="small" style={{ color: theme.textSecondary }}>{subtitle}</ThemedText>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function ShopEmpty({
  icon,
  title,
  message,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  action?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <ThemedView style={styles.empty}>
      <Ionicons name={icon} size={40} color={theme.textMuted} />
      <ThemedText type="subtitle" style={{ color: theme.text }}>{title}</ThemedText>
      {message ? (
        <ThemedText type="small" style={[styles.emptyMsg, { color: theme.textSecondary }]}>
          {message}
        </ThemedText>
      ) : null}
      {action}
    </ThemedView>
  );
}

export function RatingStars({ rating, count }: { rating: number | null; count?: number }) {
  const theme = useTheme();
  if (rating == null) {
    return <ThemedText type="small" style={{ color: theme.textMuted }}>No reviews yet</ThemedText>;
  }
  return (
    <View style={styles.ratingRow}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Ionicons
          key={star}
          name={rating >= star - 0.25 ? "star" : "star-outline"}
          size={13}
          color={theme.warning}
        />
      ))}
      <ThemedText type="small" style={{ color: theme.textSecondary }}>
        {rating.toFixed(1)}{count != null ? ` (${count})` : ""}
      </ThemedText>
    </View>
  );
}

export function SectionTitle({ title, style }: { title: string; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <ThemedText type="subtitle" style={[styles.section, { color: theme.text }, style]}>
      {title}
    </ThemedText>
  );
}

export const shopStyles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 16 },
  grid: { gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
});

const styles = StyleSheet.create({
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  price: { fontSize: 15, fontWeight: "700" },
  compareAt: { fontSize: 12, textDecorationLine: "line-through" },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" },
  pillText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3, textTransform: "capitalize" },
  card: { borderRadius: 14, overflow: "hidden" },
  cardPressed: { opacity: 0.85 },
  cardImageWrap: { aspectRatio: 0.8, borderRadius: 14, overflow: "hidden", justifyContent: "center" },
  cardImage: { width: "100%", height: "100%" },
  cardIcon: { alignSelf: "center" },
  heart: {
    position: "absolute", top: 8, right: 8, width: 30, height: 30, borderRadius: 15,
    alignItems: "center", justifyContent: "center", shadowOpacity: 0.15, shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  soldOut: {
    position: "absolute", left: 8, bottom: 8, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  soldOutText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  cardBody: { paddingTop: 6, gap: 1 },
  cardTitle: { fontSize: 11 },
  cardName: { fontSize: 13 },
  chip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontSize: 13, fontWeight: "600" },
  segmentedTrack: {
    flexDirection: "row", borderRadius: 12, padding: 3, marginHorizontal: 16,
  },
  segment: { flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: 9 },
  segmentLabel: { fontSize: 13 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: { gap: 2, flex: 1 },
  empty: { alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
  emptyMsg: { textAlign: "center" },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  section: { marginTop: 4, marginBottom: 2 },
});
