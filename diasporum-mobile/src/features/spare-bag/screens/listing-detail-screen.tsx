import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { ErrorState } from "@/shared/components/error-state";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createSpareBagApi } from "../services/spare-bag-api";
import type { Address, Listing } from "../types/spare-bag-types";
import { DetailRow, formatDateRange, formatPrice, ListingImage, ListingTypeBadge, quantitySummary, RouteView, SafetyNotice, ScreenHeader, StatusBadge, SurfaceCard } from "../components/spare-bag-ui";

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = useMemo(() => createSpareBagApi(apiClient), [apiClient]);
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return Promise.resolve();
    return api.detail(id)
      .then((detail) => { setListing(detail); setError(null); })
      .catch((cause) => setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load the listing."))
      .finally(() => setLoading(false));
  }, [api, id]);

  useEffect(() => { void load(); }, [load]);

  async function action(work: () => Promise<Listing>) {
    setActing(true);
    setError(null);
    try {
      setListing(await work());
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "The listing action failed.");
    } finally {
      setActing(false);
    }
  }

  async function toggleSave() {
    if (!listing) return;
    const saved = listing.saved;
    await action(async () => {
      if (saved) await api.unsave(listing.id);
      else await api.save(listing.id);
      return { ...listing, saved: !saved };
    });
  }

  function report() {
    if (!listing) return;
    Alert.alert("Report listing", "Report this listing for review?", [
      { text: "Cancel", style: "cancel" },
      { text: "Report", style: "destructive", onPress: () => {
        void api.reportListing(listing.id, "OTHER", "Reported from Spare Bag listing details")
          .then(() => Alert.alert("Report submitted"))
          .catch((cause) => setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not report the listing."));
      } },
    ]);
  }

  const saveAction = listing && !listing.canManage ? (
    <Pressable accessibilityRole="button" accessibilityLabel={listing.saved ? "Remove from saved" : "Save listing"} onPress={() => void toggleSave()} style={[styles.headerAction, { backgroundColor: theme.primarySurface }]}>
      <Ionicons name={listing.saved ? "bookmark" : "bookmark-outline"} size={21} color={theme.primary} />
    </Pressable>
  ) : null;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <ScreenHeader back title="Listing details" right={saveAction} />
        {loading ? <LoadingScreen /> : !listing ? <ErrorState message={error ?? "Listing not found."} onRetry={() => { setLoading(true); void load(); }} /> : (
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.summary}>
              <View style={styles.badges}><ListingTypeBadge listing={listing} /><StatusBadge status={listing.status} /></View>
              <ThemedText style={styles.title}>{listing.title}</ThemedText>
              <View style={styles.ownerRow}>
                <View style={[styles.ownerIcon, { backgroundColor: theme.primarySurface }]}><Ionicons name="person-outline" size={19} color={theme.primary} /></View>
                <View>
                  <ThemedText type="smallBold">{listing.owner?.displayName ?? listing.owner?.username ?? "Spare Bag member"}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">Public listing owner</ThemedText>
                </View>
              </View>
              <ThemedText>{listing.description}</ThemedText>
            </View>

            {listing.mediaIds.map((mediaId) => <ListingImage key={mediaId} client={apiClient} listingId={listing.id} mediaId={mediaId} />)}

            <SurfaceCard>
              <ThemedText style={styles.sectionTitle}>Route and travel window</ThemedText>
              <RouteView listing={listing} showDates={false} />
              <View style={styles.countries}>
                <ThemedText type="small" themeColor="textSecondary">{listing.originAirport.city}, {listing.originAirport.countryName}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{listing.destinationAirport.city}, {listing.destinationAirport.countryName}</ThemedText>
              </View>
              <DetailRow icon="calendar-outline" label="Travel dates" value={formatDateRange(listing)} />
              <DetailRow icon="eye-outline" label="Visibility" value={listing.visibilityScope === "COUNTRY" ? `Country · ${listing.originAirport.countryName}` : "Community members only"} />
            </SurfaceCard>

            <SurfaceCard>
              <ThemedText style={styles.sectionTitle}>{listing.listingType === "SENDER_REQUEST" ? "Parcel and budget" : "Capacity and price"}</ThemedText>
              <DetailRow icon="cube-outline" label={listing.listingType === "SENDER_REQUEST" ? "Requested quantity" : "Available capacity"} value={quantitySummary(listing)} />
              {listing.listingType === "PASSENGER_OFFER" && listing.maxSingleParcelKg != null ? <DetailRow icon="briefcase-outline" label="Maximum single parcel" value={`${listing.maxSingleParcelKg} kg`} /> : null}
              <DetailRow icon="pricetag-outline" label="Proposed price" value={formatPrice(listing)} />
              {listing.categories.length ? (
                <View style={styles.categories}>{listing.categories.map((category) => <View key={category.key} style={[styles.category, { backgroundColor: theme.primarySurface }]}><ThemedText type="smallBold" style={{ color: theme.primary }}>{category.displayName}</ThemedText></View>)}</View>
              ) : null}
            </SurfaceCard>

            <SurfaceCard>
              <ThemedText style={styles.sectionTitle}>Handover arrangements</ThemedText>
              {listing.collectionPlace ? <DetailRow icon="location-outline" label="Public collection place" value={listing.collectionPlace} /> : null}
              {listing.handoverPlace ? <DetailRow icon="location-outline" label="Public handover place" value={listing.handoverPlace} /> : null}
              {listing.handoverNotes ? <DetailRow icon="document-text-outline" label="Notes" value={listing.handoverNotes} /> : null}
              <AddressView label="Private collection address" address={listing.collectionAddress} />
              <AddressView label="Private handover address" address={listing.handoverAddress} />
              {!listing.collectionAddress && !listing.handoverAddress ? <ThemedText type="small" themeColor="textSecondary">No private address is visible. Sensitive details are only rendered when returned by the backend for an authorised participant.</ThemedText> : null}
            </SurfaceCard>

            <SafetyNotice />
            {error ? <View style={[styles.error, { backgroundColor: theme.errorSurface }]}><ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{error}</ThemedText></View> : null}

            {listing.canManage ? (
              <SurfaceCard>
                <ThemedText style={styles.sectionTitle}>Manage listing</ThemedText>
                {["DRAFT", "PUBLISHED", "PAUSED"].includes(listing.status) ? <PrimaryButton label="Edit listing" variant="secondary" onPress={() => router.push(`/(app)/spare-bag/edit/${listing.id}` as never)} /> : null}
                {["DRAFT", "PAUSED"].includes(listing.status) ? <PrimaryButton label="Review and publish" loading={acting} onPress={() => void action(() => api.publish(listing.id))} /> : null}
                {listing.status === "PUBLISHED" ? <PrimaryButton label="Pause listing" variant="secondary" loading={acting} onPress={() => void action(() => api.pause(listing.id))} /> : null}
                {["DRAFT", "PUBLISHED", "PAUSED", "MATCHED"].includes(listing.status) ? <PrimaryButton label="Close listing" variant="danger" loading={acting} onPress={() => Alert.alert("Close listing?", "This cannot be undone.", [{ text: "Cancel", style: "cancel" }, { text: "Close", style: "destructive", onPress: () => void action(() => api.close(listing.id)) }])} /> : null}
                {listing.status === "MATCHED" ? <ThemedText type="small" themeColor="textSecondary">Matched means a contact request was accepted. It is not proof of pickup, carriage, or delivery.</ThemedText> : null}
              </SurfaceCard>
            ) : (
              <View style={styles.actions}>
                {listing.status === "PUBLISHED" ? <PrimaryButton label={listing.listingType === "PASSENGER_OFFER" ? "Send Contact Request" : "Respond to Request"} onPress={() => router.push(`/(app)/spare-bag/contact/${listing.id}` as never)} /> : null}
                <PrimaryButton label={listing.saved ? "Remove from saved" : "Save listing"} variant="secondary" loading={acting} onPress={() => void toggleSave()} />
                <PrimaryButton label="Report listing" variant="ghost" onPress={report} />
              </View>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function AddressView({ label, address }: { label: string; address: Address | null }) {
  if (!address) return null;
  return <DetailRow icon="lock-closed-outline" label={label} value={address.formattedAddress ?? [address.addressLine1, address.addressLine2, address.city, address.region, address.postalCode].filter(Boolean).join(", ")} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.seven },
  headerAction: { width: 40, height: 40, borderRadius: BorderRadius.full, alignItems: "center", justifyContent: "center" },
  summary: { gap: Spacing.three },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  title: { fontSize: 28, lineHeight: 35, fontWeight: "800", letterSpacing: -0.3 },
  ownerRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  ownerIcon: { width: 40, height: 40, borderRadius: BorderRadius.full, alignItems: "center", justifyContent: "center" },
  sectionTitle: { fontSize: 18, lineHeight: 24, fontWeight: "700" },
  countries: { flexDirection: "row", justifyContent: "space-between", gap: Spacing.two },
  categories: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  category: { borderRadius: BorderRadius.full, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  error: { padding: Spacing.three, borderRadius: BorderRadius.md },
  actions: { gap: Spacing.two },
});
