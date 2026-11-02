import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { safeBack } from "@/core/navigation/safe-back";
import { useSession } from "@/core/session/session-provider";
import { createBusinessApi } from "@/features/business/services/business-api";
import type { BusinessAccount } from "@/features/business/types/business-types";
import { useTheme } from "@/hooks/use-theme";
import { ErrorState } from "@/shared/components/error-state";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { PrimaryButton } from "@/shared/components/primary-button";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createVehicleApi } from "../services/vehicle-api";
import type { VehicleView } from "../types/vehicle-types";
import { vehicleErrorMessage } from "../utils/vehicle-error";
import {
  formatVehicleDistance,
  formatVehicleLocation,
  formatVehiclePrice,
  vehicleLabel,
} from "../utils/vehicle-format";

const REPORT_REASONS = ["SCAM", "SPAM", "MISINFORMATION", "IMPERSONATION", "OTHER"];
const MANAGER_ROLES = new Set(["OWNER", "ADMINISTRATOR", "EDITOR", "LISTING_MANAGER"]);

export default function VehicleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const width = useWindowDimensions().width;
  const { apiClient } = useSession();
  const api = React.useMemo(() => createVehicleApi(apiClient), [apiClient]);
  const [detail, setDetail] = useState<VehicleView | null>(null);
  const [accounts, setAccounts] = useState<BusinessAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => api.detail(id)
    .then((result) => { setDetail(result); setError(null); })
    .catch((cause: unknown) => setError(vehicleErrorMessage(cause, "Failed to load vehicle.")))
    .finally(() => { setLoading(false); setRefreshing(false); }), [api, id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    createBusinessApi(apiClient).accounts()
      .then((result) => setAccounts(result.items.filter((account) => account.status === "ACTIVE" && MANAGER_ROLES.has(account.role))))
      .catch(() => setAccounts([]));
  }, [apiClient]);

  const run = useCallback(async (action: () => Promise<unknown>, reload = true) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await action();
      if (reload) await load();
    } catch (cause) {
      setActionError(vehicleErrorMessage(cause, "The action could not be completed."));
    } finally {
      setBusy(false);
    }
  }, [busy, load]);

  async function toggleSave() {
    if (!detail) return;
    const saved = !detail.listing.saved;
    setDetail({ ...detail, listing: { ...detail.listing, saved } });
    try {
      if (saved) await api.save(id);
      else await api.unsave(id);
    } catch (cause) {
      setDetail((previous) => previous ? { ...previous, listing: { ...previous.listing, saved: !saved } } : previous);
      setActionError(vehicleErrorMessage(cause, "Could not update saved vehicles."));
    }
  }

  function report() {
    Alert.alert("Report vehicle", "Why are you reporting this listing?", [
      ...REPORT_REASONS.map((reason) => ({
        text: vehicleLabel(reason),
        onPress: () => void run(() => api.report(id, reason), false),
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  }

  function contact() {
    const choices = [
      { text: "Contact as personal account", onPress: () => void openConversation() },
      ...accounts.map((account) => ({
        text: `Contact as ${account.accountName}`,
        onPress: () => void openConversation(account.id),
      })),
      { text: "Cancel", style: "cancel" as const },
    ];
    Alert.alert("Contact seller", "Choose the account for this conversation.", choices);
  }

  async function openConversation(actingBusinessAccountId?: string) {
    await run(async () => {
      const result = await api.contact(id, actingBusinessAccountId);
      router.push(`/messages/${result.conversationId}` as never);
    }, false);
  }

  function remove() {
    Alert.alert("Remove vehicle?", "The listing will no longer appear in discovery or owner collections.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void run(async () => {
        await api.remove(id);
        router.replace("/(app)/vehicles/my" as never);
      }, false) },
    ]);
  }

  if (loading) return <LoadingScreen message="Loading vehicle…" />;
  if (error || !detail) return <ErrorState message={error ?? "Vehicle not found."} onRetry={load} />;

  const vehicle = detail.listing;
  const editable = ["DRAFT", "PUBLISHED", "PAUSED", "EXPIRED"].includes(vehicle.status);
  const completable = ["PUBLISHED", "PAUSED"].includes(vehicle.status);
  const distance = formatVehicleDistance(vehicle.distanceMeters);
  const specifications: [string, string | number | null][] = [
    ["Category", vehicle.categoryName],
    ["Make", vehicle.makeName],
    ["Model", vehicle.modelName],
    ["Variant", vehicle.variantName],
    ["Model year", vehicle.modelYear],
    ["Registration year", vehicle.registrationYear],
    ["Mileage", vehicle.mileage === null ? null : `${vehicle.mileage.toLocaleString()} ${vehicle.mileageUnit === "KM" ? "km" : "miles"}`],
    ["Fuel", vehicleLabel(vehicle.fuelType)],
    ["Transmission", vehicleLabel(vehicle.transmission)],
    ["Drive", vehicleLabel(vehicle.driveType)],
    ["Body", vehicleLabel(vehicle.bodyType)],
    ["Engine", vehicle.engineSizeCc === null ? null : `${vehicle.engineSizeCc} cc`],
    ["Colour", vehicle.colour],
    ["Doors", vehicle.doors],
    ["Seats", vehicle.seats],
    ["Condition", vehicle.conditionKey ? vehicleLabel(vehicle.conditionKey) : null],
    ["Previous owners", vehicle.previousOwners],
    ["MOT expiry", vehicle.motExpiry],
    ["Service history", vehicle.serviceHistory ? vehicleLabel(vehicle.serviceHistory) : null],
    ["Rental deposit", vehicle.rentalDeposit === null ? null : `${vehicle.currencyCode} ${vehicle.rentalDeposit}`],
    ["Mileage allowance", vehicle.mileageAllowance],
    ...Object.entries(vehicle.additionalAttributes).map(([key, value]) => [key, String(value)] as [string, string]),
  ];

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Pressable onPress={safeBack} accessibilityRole="button" accessibilityLabel="Go back"><Ionicons name="chevron-back" size={25} color={theme.text} /></Pressable>
          <ThemedText type="title" style={styles.headerTitle} numberOfLines={1}>Vehicle details</ThemedText>
          <View style={styles.headerActions}>
            <Pressable onPress={() => void toggleSave()} accessibilityRole="button" accessibilityLabel={vehicle.saved ? "Unsave vehicle" : "Save vehicle"}>
              <Ionicons name={vehicle.saved ? "bookmark" : "bookmark-outline"} size={23} color={vehicle.saved ? BrandColors.primary : theme.text} />
            </Pressable>
            {!detail.canManage ? <Pressable onPress={report} accessibilityRole="button" accessibilityLabel="Report vehicle"><Ionicons name="flag-outline" size={22} color={theme.text} /></Pressable> : null}
          </View>
        </View>
        <ScrollView refreshControl={<RefreshControl refreshing={refreshing} tintColor={BrandColors.primary}
          onRefresh={() => { setRefreshing(true); void load(); }} />}>
          {detail.media.length ? <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
            {detail.media.map((media, index) => media.downloadUrl ? <Image key={media.id} source={{ uri: media.downloadUrl }}
              style={[styles.hero, { width }]} resizeMode="cover" accessibilityLabel={`${vehicle.title} image ${index + 1}`} /> : null)}
          </ScrollView> : <View style={[styles.hero, styles.placeholder, { backgroundColor: theme.backgroundElement }]}><Ionicons name="car-outline" size={64} color={theme.textSecondary} /></View>}
          <View style={styles.content}>
            <View style={styles.titleRow}>
              <View style={styles.titleBlock}><ThemedText type="title" style={styles.title}>{vehicle.title}</ThemedText>
                <ThemedText style={styles.price}>{formatVehiclePrice(vehicle)}</ThemedText></View>
              <View style={[styles.status, { backgroundColor: vehicle.status === "PUBLISHED" ? BrandColors.primarySurface : theme.backgroundElement }]}>
                <ThemedText style={[styles.statusText, vehicle.status === "PUBLISHED" && { color: BrandColors.primary }]}>{vehicleLabel(vehicle.status)}</ThemedText>
              </View>
            </View>
            <InfoRow icon="location-outline" text={`${formatVehicleLocation(detail.location)}${distance ? ` · ${distance}` : ""}`} />
            <InfoRow icon="car-outline" text={`${vehicle.listingPurpose === "SALE" ? "For sale" : "For rent"} · ${vehicleLabel(vehicle.visibilityScope)}`} />
            {detail.seller ? <InfoRow icon={detail.seller.businessName ? "business-outline" : "person-outline"}
              text={detail.seller.businessName ?? detail.seller.displayName ?? (detail.seller.username ? `@${detail.seller.username}` : "Seller")} /> : null}
            <Section title="Description"><ThemedText style={styles.description}>{vehicle.description}</ThemedText></Section>
            <Section title="Specifications">
              {specifications.filter(([, value]) => value !== null && value !== "Not specified").map(([label, value]) => (
                <View key={label} style={[styles.specRow, { borderBottomColor: theme.border }]}>
                  <ThemedText themeColor="textSecondary" style={styles.specLabel}>{vehicleLabel(label)}</ThemedText>
                  <ThemedText style={styles.specValue}>{value}</ThemedText>
                </View>
              ))}
            </Section>
            {vehicle.rentalConditions ? <Section title="Rental conditions"><ThemedText style={styles.description}>{vehicle.rentalConditions}</ThemedText></Section> : null}
            {detail.features.length ? <Section title="Features"><View style={styles.features}>{detail.features.map((feature) => (
              <View key={feature.id} style={[styles.feature, { backgroundColor: theme.backgroundElement }]}><ThemedText style={styles.featureText}>{feature.displayName}</ThemedText></View>
            ))}</View></Section> : null}
            {vehicle.expiresAt ? <InfoRow icon="time-outline" text={`Listing expires ${vehicle.expiresAt.slice(0, 10)}`} /> : null}
            {actionError ? <ThemedText style={styles.error} accessibilityRole="alert">{actionError}</ThemedText> : null}
            <View style={styles.actions}>
              {!detail.canManage && vehicle.status === "PUBLISHED" ? <PrimaryButton label="Contact seller" disabled={busy} onPress={contact} /> : null}
              {detail.canManage && editable ? <PrimaryButton label="Edit vehicle" variant="secondary" onPress={() => router.push(`/(app)/vehicles/edit/${id}` as never)} /> : null}
              {detail.canManage && ["DRAFT", "PAUSED", "EXPIRED"].includes(vehicle.status) ? <PrimaryButton label={vehicle.status === "DRAFT" ? "Publish vehicle" : "Publish again"} disabled={busy} onPress={() => void run(() => api.publish(id))} /> : null}
              {detail.canManage && vehicle.status === "PUBLISHED" ? <PrimaryButton label="Pause listing" variant="secondary" disabled={busy} onPress={() => void run(() => api.pause(id))} /> : null}
              {detail.canManage && completable ? <PrimaryButton label={vehicle.listingPurpose === "SALE" ? "Mark as sold" : "Mark as rented"} variant="secondary" disabled={busy}
                onPress={() => void run(() => vehicle.listingPurpose === "SALE" ? api.sold(id) : api.rented(id))} /> : null}
              {detail.canManage && !["SOLD", "RENTED", "REMOVED"].includes(vehicle.status) ? <PrimaryButton label="Remove vehicle" variant="danger" disabled={busy} onPress={remove} /> : null}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}><ThemedText type="subtitle">{title}</ThemedText>{children}</View>;
}

function InfoRow({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }) {
  const theme = useTheme();
  return <View style={styles.infoRow}><Ionicons name={icon} size={18} color={theme.textSecondary} /><ThemedText style={styles.infoText}>{text}</ThemedText></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.four, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 21 },
  headerActions: { flexDirection: "row", gap: Spacing.three },
  hero: { height: 260 },
  placeholder: { alignItems: "center", justifyContent: "center" },
  content: { padding: Spacing.four, gap: Spacing.three },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.two },
  titleBlock: { flex: 1 },
  title: { fontSize: 26, lineHeight: 32 },
  price: { fontSize: 20, color: BrandColors.primary, fontWeight: "800", marginTop: 5 },
  status: { borderRadius: BorderRadius.full, paddingHorizontal: 9, paddingVertical: 5 },
  statusText: { fontSize: 11, fontWeight: "700" },
  infoRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  infoText: { flex: 1, fontSize: 14, lineHeight: 20 },
  section: { gap: Spacing.two, paddingTop: Spacing.two },
  description: { fontSize: 15, lineHeight: 23 },
  specRow: { flexDirection: "row", justifyContent: "space-between", gap: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.two },
  specLabel: { flex: 1, fontSize: 13 },
  specValue: { flex: 1, fontSize: 13, fontWeight: "600", textAlign: "right" },
  features: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  feature: { borderRadius: BorderRadius.full, paddingHorizontal: 10, paddingVertical: 6 },
  featureText: { fontSize: 12 },
  actions: { gap: Spacing.three, paddingBottom: Spacing.five },
  error: { color: BrandColors.error, textAlign: "center" },
});
