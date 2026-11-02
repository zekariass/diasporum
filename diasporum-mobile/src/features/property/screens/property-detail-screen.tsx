import React, { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { ErrorState } from "@/shared/components/error-state";
import { ApiError } from "@/core/api/api-error";
import { useSession } from "@/core/session/session-provider";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createPropertyApi } from "../services/property-api";
import type { PropertyDetail } from "../types/property-types";
import { PropertyImage } from "../components/property-image";
import { ActionButton, PropertyScreen } from "../components/property-controls";
import { formatPrice, locationLabel, propertyFacts } from "../utils/property-format";

const REPORT_REASONS = ["SPAM", "SCAM", "MISINFORMATION", "IMPERSONATION", "PRIVACY", "OTHER"] as const;

export default function PropertyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { apiClient } = useSession();
  const api = React.useMemo(() => createPropertyApi(apiClient), [apiClient]);
  const [detail, setDetail] = useState<PropertyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => api.detail(id).then((result) => {
    setDetail(result);
    setError(null);
  }).catch((cause: unknown) => {
    setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load this property.");
  }).finally(() => {
    setLoading(false);
    setRefreshing(false);
  }), [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSave = useCallback(async () => {
    if (!detail) return;
    const saving = !detail.item.saved;
    setDetail((previous) => previous ? { ...previous, item: { ...previous.item, saved: saving } } : previous);
    try {
      if (saving) await api.save(id);
      else await api.unsave(id);
    } catch {
      setDetail((previous) => previous ? { ...previous, item: { ...previous.item, saved: !saving } } : previous);
      setActionError("Could not update saved properties.");
    }
  }, [api, detail, id]);

  const lifecycle = useCallback(async (action: "publish" | "pause" | "reopen" | "close") => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      setDetail(await api[action](id));
    } catch (cause) {
      setActionError(ApiError.isApiError(cause) ? cause.userMessage : `Could not ${action} the property.`);
    } finally {
      setBusy(false);
    }
  }, [api, busy, id]);

  const confirmClose = useCallback(() => {
    Alert.alert("Close property?", "Closing is terminal. This listing cannot be edited or reopened.", [
      { text: "Cancel", style: "cancel" },
      { text: "Close listing", style: "destructive", onPress: () => void lifecycle("close") },
    ]);
  }, [lifecycle]);

  const enquire = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await api.enquiry(id);
      router.push(`/messages/${result.conversationId}` as never);
    } catch (cause) {
      setActionError(ApiError.isApiError(cause) ? cause.userMessage : "Could not start a property enquiry.");
    } finally {
      setBusy(false);
    }
  }, [api, busy, id, router]);

  const report = useCallback(() => {
    Alert.alert("Report property", "Why are you reporting this listing?", [
      ...REPORT_REASONS.map((reason) => ({
        text: reason.toLowerCase().replaceAll("_", " "),
        onPress: () => {
          api.report(id, reason).then(() => Alert.alert("Report submitted", "Thank you. Our moderation team will review it.")).catch((cause) => setActionError(ApiError.isApiError(cause) ? cause.userMessage : "Could not report this property."));
        },
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  }, [api, id]);

  const openContact = useCallback(async (kind: "phone" | "whatsapp" | "email", value: string) => {
    const url = kind === "email" ? `mailto:${value}` : kind === "whatsapp" ? `https://wa.me/${value.replace(/[^0-9]/g, "")}` : `tel:${value}`;
    try {
      await Linking.openURL(url);
    } catch {
      setActionError("Could not open this contact method. You can use Contact owner instead.");
    }
  }, []);

  if (loading) return <LoadingScreen />;
  if (error || !detail) return <ErrorState message={error ?? "Property not found."} onRetry={load} />;

  const item = detail.item;
  const property = item.property;
  const facts = propertyFacts(item);
  const closed = property.status === "CLOSED";
  const gallery = [...detail.media].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <PropertyScreen
      title="Property"
      actions={<Pressable onPress={() => void toggleSave()} accessibilityRole="button" accessibilityLabel={item.saved ? "Remove from saved properties" : "Save property"} hitSlop={8}><Ionicons name={item.saved ? "bookmark" : "bookmark-outline"} size={23} color={item.saved ? BrandColors.primary : BrandColors.primaryDark} /></Pressable>}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={BrandColors.primary} />}
      >
        {gallery.length ? <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={styles.gallery}>{gallery.map((media, index) => <View key={media.mediaId} style={styles.galleryPage}><PropertyImage propertyId={id} mediaId={media.mediaId} style={styles.galleryImage} label={`Property photo ${index + 1}`} /></View>)}</ScrollView> : <PropertyImage propertyId={id} mediaId={null} style={styles.galleryImage} />}
        <View style={styles.body}>
          <View style={styles.statusRow}>
            <ThemedText style={styles.status}>{property.status.replaceAll("_", " ")}</ThemedText>
            <ThemedText style={styles.purpose}>{property.listingPurpose === "SALE" ? "For sale" : "For rent"}</ThemedText>
          </View>
          <ThemedText style={styles.price}>{formatPrice(item)}</ThemedText>
          <ThemedText style={styles.title}>{property.title}</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.type}>{item.propertyType?.displayName ?? "Property"}</ThemedText>
          {facts ? <ThemedText style={styles.facts}>{facts}</ThemedText> : null}
          <View style={styles.location}><Ionicons name="location-outline" size={18} color={BrandColors.primary} /><ThemedText style={styles.locationText}>{locationLabel(item.location)}</ThemedText></View>
          <ThemedText themeColor="textSecondary" style={styles.privacy}>Only an approximate location is shown. The exact address remains private.</ThemedText>

          <Section title="Description"><ThemedText style={styles.description}>{property.description}</ThemedText></Section>
          {detail.amenities.length ? <Section title="Amenities"><View style={styles.amenities}>{detail.amenities.map((amenity) => <ThemedText key={amenity.id} style={styles.amenity}>{amenity.displayName}</ThemedText>)}</View></Section> : null}
          <Section title="Listed by"><ThemedText style={styles.owner}>{detail.owner?.businessAccountName ?? detail.owner?.displayName ?? "Diasporum member"}</ThemedText></Section>

          {property.furnishedStatus || property.availabilityDate || property.tenure ? <Section title="Additional details">
            {property.furnishedStatus ? <DetailRow label="Furnishing" value={property.furnishedStatus.toLowerCase().replaceAll("_", " ")} /> : null}
            {property.availabilityDate ? <DetailRow label="Available from" value={property.availabilityDate} /> : null}
            {property.tenure ? <DetailRow label="Tenure" value={property.tenure} /> : null}
            {property.listingPurpose === "RENT" && property.rentalDeposit !== null ? <DetailRow label="Deposit" value={`${property.currencyCode} ${property.rentalDeposit}`} /> : null}
            {property.listingPurpose === "RENT" && property.minimumTenancyMonths !== null ? <DetailRow label="Minimum tenancy" value={`${property.minimumTenancyMonths} months`} /> : null}
          </Section> : null}

          {!item.canManage && property.status === "PUBLISHED" ? <Section title="Contact">
            <ActionButton label="Contact owner" onPress={() => void enquire()} loading={busy} />
            <View style={styles.contactButtons}>
              {detail.contact?.phone ? <ActionButton label="Call" onPress={() => void openContact("phone", detail.contact?.phone ?? "")} /> : null}
              {detail.contact?.whatsapp ? <ActionButton label="WhatsApp" onPress={() => void openContact("whatsapp", detail.contact?.whatsapp ?? "")} /> : null}
              {detail.contact?.email ? <ActionButton label="Email" onPress={() => void openContact("email", detail.contact?.email ?? "")} /> : null}
            </View>
          </Section> : null}

          {item.canManage ? <Section title="Manage listing">
            {!closed ? <ActionButton label="Edit property" onPress={() => router.push(`/(app)/properties/edit/${id}` as never)} disabled={busy} /> : null}
            {property.status === "DRAFT" ? <ActionButton label="Publish property" onPress={() => void lifecycle("publish")} loading={busy} /> : null}
            {property.status === "PUBLISHED" ? <ActionButton label="Pause property" onPress={() => void lifecycle("pause")} loading={busy} /> : null}
            {property.status === "PAUSED" ? <ActionButton label="Reopen property" onPress={() => void lifecycle("reopen")} loading={busy} /> : null}
            {!closed ? <ActionButton label="Close property" onPress={confirmClose} disabled={busy} danger /> : null}
          </Section> : null}
          {actionError ? <ThemedText style={styles.error}>{actionError}</ThemedText> : null}
          {!item.canManage ? <Pressable onPress={report} accessibilityRole="button" accessibilityLabel="Report property" style={styles.report}><Ionicons name="flag-outline" size={15} color={BrandColors.error} /><ThemedText style={styles.reportText}>Report this property</ThemedText></Pressable> : null}
        </View>
      </ScrollView>
    </PropertyScreen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}><ThemedText style={styles.sectionTitle}>{title}</ThemedText>{children}</View>;
}
function DetailRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.detailRow}><ThemedText themeColor="textSecondary" style={styles.detailLabel}>{label}</ThemedText><ThemedText style={styles.detailValue}>{value}</ThemedText></View>;
}

const styles = StyleSheet.create({
  content: { paddingBottom: Spacing.five },
  gallery: { maxHeight: 280 },
  galleryPage: { width: 390 },
  galleryImage: { height: 260 },
  body: { padding: Spacing.three, gap: Spacing.two },
  statusRow: { flexDirection: "row", justifyContent: "space-between" },
  status: { fontSize: 12, fontWeight: "800", color: BrandColors.primary },
  purpose: { fontSize: 13, fontWeight: "700" },
  price: { fontSize: 25, lineHeight: 32, fontWeight: "800" },
  title: { fontSize: 22, lineHeight: 29, fontWeight: "800" },
  type: { fontSize: 14 },
  facts: { fontSize: 16, fontWeight: "600" },
  location: { flexDirection: "row", alignItems: "center", gap: Spacing.one, marginTop: Spacing.one },
  locationText: { flex: 1, fontSize: 15 },
  privacy: { fontSize: 12, lineHeight: 18 },
  section: { gap: Spacing.two, marginTop: Spacing.two },
  sectionTitle: { fontSize: 17, fontWeight: "800" },
  description: { fontSize: 15, lineHeight: 23 },
  amenities: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  amenity: { backgroundColor: BrandColors.primarySurface, color: BrandColors.primaryDark, borderRadius: BorderRadius.full, paddingHorizontal: 10, paddingVertical: 5, fontSize: 12, fontWeight: "600", overflow: "hidden" },
  owner: { fontSize: 15, fontWeight: "600" },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: Spacing.two },
  detailLabel: { fontSize: 14 },
  detailValue: { fontSize: 14, fontWeight: "600", textAlign: "right" },
  contactButtons: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  error: { color: BrandColors.error, fontSize: 13, lineHeight: 19 },
  report: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.one, padding: Spacing.three },
  reportText: { color: BrandColors.error, fontSize: 13, fontWeight: "600" },
});
