import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
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
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createSpareBagApi } from "../services/spare-bag-api";
import type { ContactRequest, Listing } from "../types/spare-bag-types";
import { FormInput } from "../components/form-controls";
import { formatPrice, ListingTypeBadge, quantitySummary, RouteView, SafetyNotice, ScreenHeader, SurfaceCard } from "../components/spare-bag-ui";

export default function ContactCompositionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = useMemo(() => createSpareBagApi(apiClient), [apiClient]);
  const [target, setTarget] = useState<Listing | null>(null);
  const [candidates, setCandidates] = useState<Listing[]>([]);
  const [ownListingId, setOwnListingId] = useState("");
  const [message, setMessage] = useState("");
  const [parcelWeight, setParcelWeight] = useState("");
  const [proposedPrice, setProposedPrice] = useState("");
  const [created, setCreated] = useState<ContactRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotency = useRef<{ pair: string; key: string } | null>(null);

  const load = useCallback(() => {
    if (!id) return Promise.resolve();
    return api.detail(id)
      .then(async (detail) => {
        setTarget(detail);
        setProposedPrice(String(detail.priceAmount));
        const mine = await api.mine("PUBLISHED", undefined, 50);
        const compatible = mine.items.filter((candidate) =>
          candidate.listingType !== detail.listingType
          && candidate.originAirport.id === detail.originAirport.id
          && candidate.destinationAirport.id === detail.destinationAirport.id
          && candidate.travelDateStart <= (detail.travelDateEnd ?? detail.travelDateStart)
          && (candidate.travelDateEnd ?? candidate.travelDateStart) >= detail.travelDateStart,
        );
        setCandidates(compatible);
        setOwnListingId((current) => compatible.some((item) => item.id === current) ? current : compatible[0]?.id ?? "");
        setError(null);
      })
      .catch((cause) => setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not prepare the contact request."))
      .finally(() => setLoading(false));
  }, [api, id]);

  useEffect(() => { void load(); }, [load]);

  const own = candidates.find((listing) => listing.id === ownListingId) ?? null;

  async function submit() {
    if (!target || !own) {
      setError("Publish a compatible opposite-type listing before sending a contact request.");
      return;
    }
    if (parcelWeight && (!Number.isFinite(Number(parcelWeight)) || Number(parcelWeight) <= 0)) {
      setError("Proposed parcel weight must be greater than zero.");
      return;
    }
    if (proposedPrice && (!Number.isFinite(Number(proposedPrice)) || Number(proposedPrice) < 0)) {
      setError("Proposed price must be zero or greater.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const pair = `${own.id}:${target.id}`;
      if (!idempotency.current || idempotency.current.pair !== pair) {
        idempotency.current = { pair, key: await Crypto.randomUUID() };
      }
      const request = await api.createContact({
        ownListingId: own.id,
        targetListingId: target.id,
        ...(parcelWeight ? { parcelWeightKg: Number(parcelWeight) } : {}),
        ...(proposedPrice ? { proposedPriceAmount: Number(proposedPrice), proposedPriceUnit: target.priceUnit, priceCurrency: target.priceCurrency } : {}),
        ...(message.trim() ? { message: message.trim() } : {}),
        idempotencyKey: idempotency.current.key,
      });
      setCreated(request);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not send the contact request. No booking or payment was created.");
    } finally {
      setSending(false);
    }
  }

  if (created && target) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
          <ScreenHeader back title="Contact request" />
          <View style={styles.confirmation}>
            <View style={[styles.successIcon, { backgroundColor: theme.successSurface }]}><Ionicons name="checkmark" size={42} color={theme.success} /></View>
            <ThemedText style={styles.confirmationTitle}>Contact request sent</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.confirmationCopy}>Your request for {target.title} is now pending. The other listing owner can accept or decline it. This is not a booking or a guarantee of carriage.</ThemedText>
            <PrimaryButton label="View contact requests" onPress={() => router.replace("/(app)/spare-bag/contacts" as never)} />
            <PrimaryButton label="Back to listing" variant="secondary" onPress={() => router.replace(`/(app)/spare-bag/${target.id}` as never)} />
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <ScreenHeader back title={target?.listingType === "SENDER_REQUEST" ? "Respond to Request" : "Send Contact Request"} subtitle="An introduction, not a booking" />
        {loading ? <LoadingScreen /> : !target ? <ErrorState message={error ?? "Listing not found."} onRetry={() => void load()} /> : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.intro}>
              <ThemedText style={styles.title}>Connect both listings</ThemedText>
              <ThemedText themeColor="textSecondary">Choose your compatible {target.listingType === "PASSENGER_OFFER" ? "sender request" : "passenger offer"}. The exact route and overlapping dates are checked again by the backend.</ThemedText>
            </View>
            <View>
              <ThemedText type="smallBold" style={styles.groupLabel}>YOUR LISTING</ThemedText>
              {candidates.length > 1 ? <View style={styles.candidates}>{candidates.map((candidate) => (
                <Pressable key={candidate.id} accessibilityRole="button" accessibilityLabel={`Use ${candidate.title}`} accessibilityState={{ selected: ownListingId === candidate.id }} onPress={() => setOwnListingId(candidate.id)} style={[styles.candidate, { borderColor: ownListingId === candidate.id ? theme.primary : theme.border, backgroundColor: ownListingId === candidate.id ? theme.primarySurface : theme.background }]}>
                  <ThemedText type="smallBold">{candidate.title}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{candidate.originAirport.iataCode} → {candidate.destinationAirport.iataCode}</ThemedText>
                </Pressable>
              ))}</View> : null}
              {own ? <ListingSummary listing={own} /> : (
                <SurfaceCard>
                  <ThemedText type="smallBold">No compatible published listing</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">Create and publish an opposite-type listing with the same airports and an overlapping travel window.</ThemedText>
                  <PrimaryButton label={target.listingType === "PASSENGER_OFFER" ? "Create sender request" : "Create passenger offer"} variant="secondary" onPress={() => router.push(target.listingType === "PASSENGER_OFFER" ? "/(app)/spare-bag/create-sender" as never : "/(app)/spare-bag/create-passenger" as never)} />
                </SurfaceCard>
              )}
            </View>
            <View style={styles.connector}><View style={[styles.connectorLine, { backgroundColor: theme.primaryLight }]} /><Ionicons name="swap-vertical" size={22} color={theme.primary} /><View style={[styles.connectorLine, { backgroundColor: theme.primaryLight }]} /></View>
            <View>
              <ThemedText type="smallBold" style={styles.groupLabel}>THEIR LISTING</ThemedText>
              <ListingSummary listing={target} />
            </View>
            <SurfaceCard>
              <ThemedText style={styles.sectionTitle}>Your proposal</ThemedText>
              <FormInput label="Parcel weight for contact" value={parcelWeight} onChangeText={setParcelWeight} keyboardType="decimal-pad" placeholder="Optional weight in kg" />
              <FormInput label="Proposed price" value={proposedPrice} onChangeText={setProposedPrice} keyboardType="decimal-pad" placeholder="Optional proposed amount" hint={`${target.priceCurrency} · ${target.priceUnit === "PER_KG" ? "per kg" : "per parcel"}`} />
              <FormInput label="Contact message" value={message} onChangeText={setMessage} placeholder="Introduce yourself and describe the contents truthfully" multiline maxLength={4000} />
              <ThemedText type="small" themeColor="textSecondary">Do not include a private address, phone number, payment details, or undeclared items. Duplicate pending requests are rejected by the backend.</ThemedText>
            </SurfaceCard>
            <SafetyNotice compact />
            {error ? <View style={[styles.error, { backgroundColor: theme.errorSurface }]}><ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{error}</ThemedText></View> : null}
            <PrimaryButton label="Send Contact Request" loading={sending} disabled={!own} onPress={() => void submit()} />
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function ListingSummary({ listing }: { listing: Listing }) {
  return (
    <SurfaceCard>
      <ListingTypeBadge listing={listing} />
      <ThemedText style={styles.listingTitle}>{listing.title}</ThemedText>
      <RouteView listing={listing} />
      <ThemedText type="small">{quantitySummary(listing)}</ThemedText>
      <ThemedText type="smallBold">{formatPrice(listing)}</ThemedText>
    </SurfaceCard>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.seven },
  intro: { gap: Spacing.one },
  title: { fontSize: 25, lineHeight: 32, fontWeight: "800" },
  groupLabel: { fontSize: 11, letterSpacing: 1, marginBottom: Spacing.two },
  candidates: { gap: Spacing.two, marginBottom: Spacing.two },
  candidate: { borderWidth: 1, borderRadius: BorderRadius.md, padding: Spacing.three, gap: Spacing.one },
  connector: { flexDirection: "row", alignItems: "center", gap: Spacing.two, paddingHorizontal: Spacing.four },
  connectorLine: { height: 1, flex: 1 },
  sectionTitle: { fontSize: 18, lineHeight: 24, fontWeight: "700" },
  listingTitle: { fontSize: 19, lineHeight: 25, fontWeight: "700" },
  error: { padding: Spacing.three, borderRadius: BorderRadius.md },
  confirmation: { flex: 1, alignItems: "center", justifyContent: "center", padding: Spacing.four, gap: Spacing.three },
  successIcon: { width: 88, height: 88, borderRadius: BorderRadius.full, alignItems: "center", justifyContent: "center", marginBottom: Spacing.two },
  confirmationTitle: { fontSize: 27, lineHeight: 34, fontWeight: "800", textAlign: "center" },
  confirmationCopy: { textAlign: "center", maxWidth: 360, marginBottom: Spacing.two },
});
