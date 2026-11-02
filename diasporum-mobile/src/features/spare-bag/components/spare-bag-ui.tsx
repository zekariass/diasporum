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
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type { ApiClient } from "@/core/api/api-client";
import { createSpareBagApi } from "../services/spare-bag-api";
import type { Listing } from "../types/spare-bag-types";

export function ScreenHeader({
  title,
  back = false,
}: {
  title: string;
  back?: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <View style={[styles.header, { borderBottomColor: theme.border }]}>
      {back ? (
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace("/(app)/spare-bag" as never)
          }
          style={styles.back}
        >
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </Pressable>
      ) : null}
      <ThemedText style={styles.headerTitle}>{title}</ThemedText>
    </View>
  );
}

export function SafetyNotice() {
  const theme = useTheme();
  return (
    <View style={[styles.notice, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold">
        Travel safely and list truthfully
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Never carry restricted, illegal, undeclared, or unknown items. Both
        parties are responsible for customs, immigration, and airline rules.
        Spare Bag only facilitates discovery and contact; it does not provide
        courier, payment, or delivery services.
      </ThemedText>
    </View>
  );
}

export function ListingCard({ listing }: { listing: Listing }) {
  const theme = useTheme();
  const router = useRouter();
  const capacity =
    listing.listingType === "SENDER_REQUEST"
      ? `${listing.requestedWeightKg ?? listing.requestedParcelCount ?? "—"} ${listing.requestedWeightKg ? "kg" : "parcel(s)"} requested`
      : `${listing.availableCapacityKg ?? "—"} kg available`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${listing.title}`}
      onPress={() => router.push(`/(app)/spare-bag/${listing.id}` as never)}
      style={[
        styles.card,
        { borderColor: theme.border, backgroundColor: theme.background },
      ]}
    >
      <View style={styles.cardTop}>
        <ThemedText type="smallBold" style={{ color: BrandColors.primary }}>
          {listing.listingType === "SENDER_REQUEST"
            ? "Sender request"
            : "Passenger offer"}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {listing.status}
        </ThemedText>
      </View>
      <ThemedText type="subtitle" style={styles.cardTitle}>
        {listing.title}
      </ThemedText>
      <ThemedText>
        {listing.originAirport.iataCode} → {listing.destinationAirport.iataCode}{" "}
        · {listing.travelDateStart}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {capacity}
      </ThemedText>
      <ThemedText type="smallBold">
        {listing.priceAmount} {listing.priceCurrency} /{" "}
        {listing.priceUnit === "PER_KG" ? "kg" : "parcel"}
      </ThemedText>
    </Pressable>
  );
}

export function CollectionState({
  loading,
  error,
  empty,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  onRetry: () => void;
}) {
  if (loading)
    return (
      <ActivityIndicator
        accessibilityLabel="Loading Spare Bag"
        style={styles.loading}
      />
    );
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (empty) {
    return (
      <View style={styles.empty}>
        <ThemedText type="subtitle">Nothing here yet</ThemedText>
        <ThemedText themeColor="textSecondary">
          Try another filter or check back later.
        </ThemedText>
      </View>
    );
  }
  return null;
}

export function ListingImage({
  client,
  listingId,
  mediaId,
}: {
  client: ApiClient;
  listingId: string;
  mediaId: string;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    createSpareBagApi(client)
      .mediaDownloadUrl(listingId, mediaId)
      .then((result) => {
        if (active) setUri(result.downloadUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [client, listingId, mediaId]);
  if (failed) return null;
  if (!uri)
    return <ActivityIndicator accessibilityLabel="Loading listing image" />;
  return (
    <Image
      source={{ uri }}
      style={styles.image}
      accessibilityLabel="Listing image"
    />
  );
}

export function RetryButton({ onPress }: { onPress: () => void }) {
  return (
    <PrimaryButton label="Try again" onPress={onPress} variant="secondary" />
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { marginRight: Spacing.two, padding: Spacing.one },
  headerTitle: { fontSize: 22, fontWeight: "700", flex: 1 },
  notice: {
    padding: Spacing.three,
    gap: Spacing.one,
    borderRadius: BorderRadius.md,
  },
  card: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  cardTitle: { fontSize: 20, lineHeight: 26 },
  loading: { margin: Spacing.five },
  empty: { alignItems: "center", padding: Spacing.five, gap: Spacing.two },
  image: { width: "100%", height: 220, borderRadius: BorderRadius.md },
});
