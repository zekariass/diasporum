import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { ErrorState } from "@/shared/components/error-state";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createSpareBagApi } from "../services/spare-bag-api";
import type { Address, Listing } from "../types/spare-bag-types";
import { ListingImage, SafetyNotice, ScreenHeader } from "../components/spare-bag-ui";

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = useMemo(() => createSpareBagApi(apiClient), [apiClient]);
  const [listing, setListing] = useState<Listing | null>(null);
  const [ownListings, setOwnListings] = useState<Listing[]>([]);
  const [ownListingId, setOwnListingId] = useState("");
  const [message, setMessage] = useState("");
  const [parcelWeight, setParcelWeight] = useState("");
  const [proposedPrice, setProposedPrice] = useState("");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return Promise.resolve();
    return api.detail(id)
      .then(async (detail) => {
        setListing(detail);
        setProposedPrice(String(detail.priceAmount));
        if (!detail.canManage) {
          const mine = await api.mine("PUBLISHED", undefined, 50);
          const candidates = mine.items.filter((candidate) =>
            candidate.listingType !== detail.listingType &&
            candidate.originAirport.id === detail.originAirport.id &&
            candidate.destinationAirport.id === detail.destinationAirport.id &&
            candidate.travelDateStart <= (detail.travelDateEnd ?? detail.travelDateStart) &&
            (candidate.travelDateEnd ?? candidate.travelDateStart) >= detail.travelDateStart
          );
          setOwnListings(candidates);
          setOwnListingId((current) => current || candidates[0]?.id || "");
        }
        setError(null);
      })
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

  async function createContact() {
    if (!listing || !ownListingId) {
      setError("Publish a compatible opposite-type listing before sending a contact request.");
      return;
    }
    setActing(true);
    setError(null);
    try {
      await api.createContact({
        ownListingId,
        targetListingId: listing.id,
        ...(parcelWeight ? { parcelWeightKg: Number(parcelWeight) } : {}),
        ...(proposedPrice ? {
          proposedPriceAmount: Number(proposedPrice),
          proposedPriceUnit: listing.priceUnit,
          priceCurrency: listing.priceCurrency,
        } : {}),
        ...(message.trim() ? { message: message.trim() } : {}),
        idempotencyKey: await Crypto.randomUUID(),
      });
      router.push("/(app)/spare-bag/contacts" as never);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not send the contact request.");
    } finally {
      setActing(false);
    }
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

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <ScreenHeader back title="Listing details" />
        {loading ? <LoadingScreen /> : !listing ? <ErrorState message={error ?? "Listing not found."} onRetry={() => { setLoading(true); void load(); }} /> : (
          <ScrollView contentContainerStyle={styles.content}>
            <ThemedText type="subtitle" style={styles.title}>{listing.title}</ThemedText>
            <ThemedText type="smallBold" style={{ color: BrandColors.primary }}>{listing.listingType.replace("_", " ")} · {listing.status}</ThemedText>
            <ThemedText>{listing.originAirport.city} ({listing.originAirport.iataCode}) → {listing.destinationAirport.city} ({listing.destinationAirport.iataCode})</ThemedText>
            <ThemedText>Travel: {listing.travelDateStart}{listing.travelDateEnd ? ` to ${listing.travelDateEnd}` : ""}</ThemedText>
            <ThemedText type="smallBold">{listing.priceAmount} {listing.priceCurrency} / {listing.priceUnit === "PER_KG" ? "kg" : "parcel"}</ThemedText>
            <ThemedText>{listing.description}</ThemedText>
            {listing.mediaIds.map((mediaId) => <ListingImage key={mediaId} client={apiClient} listingId={listing.id} mediaId={mediaId} />)}
            {listing.collectionPlace ? <ThemedText>Collection: {listing.collectionPlace}</ThemedText> : null}
            {listing.handoverPlace ? <ThemedText>Handover: {listing.handoverPlace}</ThemedText> : null}
            {listing.handoverNotes ? <ThemedText>Notes: {listing.handoverNotes}</ThemedText> : null}
            <AddressView label="Private collection address" address={listing.collectionAddress} />
            <AddressView label="Private handover address" address={listing.handoverAddress} />
            <SafetyNotice />
            {error ? <ThemedText accessibilityRole="alert" style={{ color: BrandColors.error }}>{error}</ThemedText> : null}
            {listing.canManage ? (
              <View style={styles.actions}>
                {["DRAFT", "PUBLISHED", "PAUSED"].includes(listing.status) ? <PrimaryButton label="Edit listing" variant="secondary" onPress={() => router.push(`/(app)/spare-bag/edit/${listing.id}` as never)} /> : null}
                {["DRAFT", "PAUSED"].includes(listing.status) ? <PrimaryButton label="Review and publish" loading={acting} onPress={() => void action(() => api.publish(listing.id))} /> : null}
                {listing.status === "PUBLISHED" ? <PrimaryButton label="Pause listing" variant="secondary" loading={acting} onPress={() => void action(() => api.pause(listing.id))} /> : null}
                {["DRAFT", "PUBLISHED", "PAUSED", "MATCHED"].includes(listing.status) ? <PrimaryButton label="Close listing" variant="danger" loading={acting} onPress={() => Alert.alert("Close listing?", "This cannot be undone.", [{ text: "Cancel", style: "cancel" }, { text: "Close", style: "destructive", onPress: () => void action(() => api.close(listing.id)) }])} /> : null}
              </View>
            ) : (
              <View style={styles.actions}>
                <PrimaryButton label={listing.saved ? "Remove from saved" : "Save listing"} variant="secondary" loading={acting} onPress={() => void toggleSave()} />
                {listing.status === "PUBLISHED" ? (
                  <View style={[styles.contact, { borderColor: theme.border }]}>
                    <ThemedText type="subtitle" style={styles.contactTitle}>Request contact</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">Choose your compatible listing. Contact is a request, not a booking or payment.</ThemedText>
                    {ownListings.map((candidate) => <Pressable key={candidate.id} accessibilityRole="button" accessibilityLabel={`Use ${candidate.title}`} accessibilityState={{ selected: ownListingId === candidate.id }} onPress={() => setOwnListingId(candidate.id)} style={[styles.candidate, { borderColor: ownListingId === candidate.id ? BrandColors.primary : theme.border }]}><ThemedText>{candidate.title}</ThemedText></Pressable>)}
                    {!ownListings.length ? <ThemedText>No compatible published listing. Create one first.</ThemedText> : null}
                    <TextInput accessibilityLabel="Parcel weight for contact" placeholder="Parcel weight kg (optional)" keyboardType="decimal-pad" value={parcelWeight} onChangeText={setParcelWeight} style={[styles.input, { color: theme.text, borderColor: theme.border }]} />
                    <TextInput accessibilityLabel="Proposed price" placeholder="Proposed price (optional)" keyboardType="decimal-pad" value={proposedPrice} onChangeText={setProposedPrice} style={[styles.input, { color: theme.text, borderColor: theme.border }]} />
                    <TextInput accessibilityLabel="Contact message" placeholder="Introduce yourself and describe the contents truthfully" value={message} onChangeText={setMessage} multiline style={[styles.input, styles.message, { color: theme.text, borderColor: theme.border }]} />
                    <PrimaryButton label="Send contact request" loading={acting} disabled={!ownListingId} onPress={() => void createContact()} />
                  </View>
                ) : null}
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
  return <View><ThemedText type="smallBold">{label}</ThemedText><ThemedText>{address.formattedAddress ?? [address.addressLine1, address.addressLine2, address.city, address.region, address.postalCode].filter(Boolean).join(", ")}</ThemedText></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  title: { fontSize: 26, lineHeight: 32 },
  actions: { gap: Spacing.three },
  contact: { borderWidth: 1, borderRadius: BorderRadius.md, padding: Spacing.three, gap: Spacing.three },
  contactTitle: { fontSize: 20, lineHeight: 26 },
  candidate: { borderWidth: 1, borderRadius: BorderRadius.md, padding: Spacing.three },
  input: { borderWidth: 1, borderRadius: BorderRadius.md, padding: Spacing.three },
  message: { minHeight: 100, textAlignVertical: "top" },
});
