import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { ErrorState } from "@/shared/components/error-state";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type { ApiClient } from "@/core/api/api-client";
import { createServiceMarketplaceApi } from "../services/service-marketplace-api";
import type { ServiceProvider, ServiceRequest } from "../types/service-marketplace-types";

export function ScreenHeader({ title, back = false }: { title: string; back?: boolean }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <View style={[styles.header, { borderBottomColor: theme.border }]}>
      {back ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Go back"
          onPress={() => router.canGoBack() ? router.back() : router.replace("/(app)/services" as never)}
          style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </Pressable>
      ) : null}
      <ThemedText style={styles.headerTitle}>{title}</ThemedText>
    </View>
  );
}

export function LeadMarketplaceNotice() {
  const theme = useTheme();
  return (
    <View style={[styles.notice, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold">Discovery and contact only</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        DIASPORUM does not book work, hold payments, or guarantee providers. Agree on scope,
        price, safety, and payment directly. Lead access charges unlock contact capabilities,
        not completed work.
      </ThemedText>
    </View>
  );
}

export function ProviderCard({ provider }: { provider: ServiceProvider }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${provider.displayName}`}
      onPress={() => router.push(`/(app)/services/providers/${provider.id}` as never)}
      style={[styles.card, { borderColor: theme.border, backgroundColor: theme.background }]}>
      <View style={styles.cardTop}>
        <ThemedText type="smallBold" style={{ color: BrandColors.primary }}>
          {provider.businessAccountId ? "Business provider" : "Independent provider"}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{provider.status}</ThemedText>
      </View>
      <ThemedText type="subtitle">{provider.displayName}</ThemedText>
      <ThemedText numberOfLines={2}>{provider.description ?? "Service provider"}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {provider.categories.map((item) => item.displayName).join(" · ")}
      </ThemedText>
      {provider.distanceMeters != null ? (
        <ThemedText type="smallBold">{(provider.distanceMeters / 1000).toFixed(1)} km away</ThemedText>
      ) : null}
    </Pressable>
  );
}

export function RequestCard({ request, providerId }: { request: ServiceRequest; providerId?: string }) {
  const theme = useTheme();
  const router = useRouter();
  const budget = request.budgetMin != null || request.budgetMax != null
    ? `${request.budgetMin ?? "—"}–${request.budgetMax ?? "—"} ${request.currencyCode}`
    : "Budget not specified";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${request.title}`}
      onPress={() => router.push(`/(app)/services/requests/${request.id}${providerId ? `?providerId=${providerId}` : ""}` as never)}
      style={[styles.card, { borderColor: theme.border, backgroundColor: theme.background }]}>
      <View style={styles.cardTop}>
        <ThemedText type="smallBold" style={{ color: BrandColors.primary }}>
          {request.categoryDisplayName}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{request.status}</ThemedText>
      </View>
      <ThemedText type="subtitle">{request.title}</ThemedText>
      <ThemedText numberOfLines={2}>{request.description}</ThemedText>
      <ThemedText type="smallBold">{budget}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {request.preferredDate ? `Preferred ${request.preferredDate}` : "Flexible date"}
        {request.distanceMeters != null ? ` · ${(request.distanceMeters / 1000).toFixed(1)} km away` : ""}
      </ThemedText>
    </Pressable>
  );
}

export function CollectionState({ loading, error, empty, onRetry, emptyText = "Nothing here yet" }: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  onRetry: () => void;
  emptyText?: string;
}) {
  if (loading) return <ActivityIndicator accessibilityLabel="Loading services" style={styles.loading} />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (empty) {
    return <View style={styles.empty}><ThemedText type="subtitle">{emptyText}</ThemedText>
      <ThemedText themeColor="textSecondary">Try another filter or check back later.</ThemedText></View>;
  }
  return null;
}

export function ServiceRequestImage({ client, requestId, mediaId }: {
  client: ApiClient;
  requestId: string;
  mediaId: string;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    createServiceMarketplaceApi(client).mediaDownloadUrl(requestId, mediaId)
      .then((result) => { if (active) setUri(result.downloadUrl); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [client, mediaId, requestId]);
  if (failed) return null;
  if (!uri) return <ActivityIndicator accessibilityLabel="Loading request image" />;
  return <Image source={{ uri }} style={styles.image} accessibilityLabel="Service request image" />;
}

export const serviceStyles = StyleSheet.create({
  root: { flex: 1 },
  keyboard: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, flexGrow: 1, paddingBottom: Spacing.six },
  input: { borderWidth: 1, borderRadius: BorderRadius.md, padding: Spacing.three, minHeight: 48 },
  multiline: { minHeight: 110, textAlignVertical: "top" },
  actions: { gap: Spacing.three },
});

const styles = StyleSheet.create({
  header: { minHeight: 56, flexDirection: "row", alignItems: "center",
    paddingHorizontal: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { marginRight: Spacing.two, padding: Spacing.one },
  headerTitle: { fontSize: 22, fontWeight: "700", flex: 1 },
  notice: { padding: Spacing.three, gap: Spacing.one, borderRadius: BorderRadius.md },
  card: { borderWidth: 1, borderRadius: BorderRadius.md, padding: Spacing.three, gap: Spacing.one },
  cardTop: { flexDirection: "row", justifyContent: "space-between", gap: Spacing.two },
  loading: { margin: Spacing.five },
  empty: { alignItems: "center", padding: Spacing.five, gap: Spacing.two },
  image: { width: "100%", height: 220, borderRadius: BorderRadius.md },
});
