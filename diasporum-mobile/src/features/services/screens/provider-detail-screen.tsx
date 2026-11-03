import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { PrimaryButton } from "@/shared/components/primary-button";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { ErrorState } from "@/shared/components/error-state";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { createServiceMarketplaceApi, type ServiceMarketplaceApi } from "../services/service-marketplace-api";
import type { ServiceProvider, ServiceReview } from "../types/service-marketplace-types";
import { LeadMarketplaceNotice, ScreenHeader, serviceStyles } from "../components/service-ui";

export default function ProviderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { apiClient } = useSession();
  const api = useMemo(() => createServiceMarketplaceApi(apiClient), [apiClient]);
  const [provider, setProvider] = useState<ServiceProvider | null>(null);
  const [reviews, setReviews] = useState<ServiceReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [detail, reviewPage] = await Promise.all([api.provider(id), api.providerReviews(id)]);
      setProvider(detail);
      setReviews(reviewPage.items);
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load the provider.");
    } finally {
      setLoading(false);
    }
  }, [api, id]);
  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  async function action(work: () => Promise<ServiceProvider>) {
    setActing(true);
    try { setProvider(await work()); }
    catch (cause) { setError(ApiError.isApiError(cause) ? cause.userMessage : "The provider action failed."); }
    finally { setActing(false); }
  }

  function closeProvider() {
    if (!provider) return;
    Alert.alert("Close provider profile", "This profile will no longer be discoverable. Closing is terminal.", [
      { text: "Keep profile", style: "cancel" },
      { text: "Close profile", style: "destructive",
        onPress: () => void action(() => api.closeProvider(provider.id)) },
    ]);
  }

  function report() {
    if (!provider) return;
    Alert.alert("Report provider", "Send this provider to the moderation queue?", [
      { text: "Cancel", style: "cancel" },
      { text: "Report", style: "destructive", onPress: () => {
        void api.report("SERVICE_PROVIDER", provider.id, "OTHER", "Reported from provider details")
          .then(() => Alert.alert("Report submitted"))
          .catch((cause) => setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not report provider."));
      } },
    ]);
  }

  return (
    <ThemedView style={serviceStyles.root}>
      <SafeAreaView style={serviceStyles.root} edges={["top", "left", "right"]}>
        <ScreenHeader back title="Provider profile" />
        {loading ? <LoadingScreen /> : !provider ? (
          <ErrorState message={error ?? "Provider not found."} onRetry={() => { setLoading(true); void load(); }} />
        ) : (
          <ScrollView contentContainerStyle={serviceStyles.content}>
            <ThemedText type="title">{provider.displayName}</ThemedText>
            <ThemedText type="smallBold" style={{ color: BrandColors.primary }}>
              {provider.businessAccountId ? "Business Account provider" : "Personal provider"} · {provider.status}
            </ThemedText>
            <ThemedText>{provider.description ?? "No provider description supplied."}</ThemedText>
            <ThemedText type="smallBold">Services</ThemedText>
            <ThemedText>{provider.categories.map((item) => item.displayName).join(" · ")}</ThemedText>
            {provider.canManage ? <ThemedText>Coverage radius: {provider.radiusKm} km</ThemedText> : null}
            {provider.distanceMeters != null ? <ThemedText>{(provider.distanceMeters / 1000).toFixed(1)} km away</ThemedText> : null}
            <LeadMarketplaceNotice />
            {error ? <ThemedText accessibilityRole="alert" style={{ color: BrandColors.error }}>{error}</ThemedText> : null}
            {provider.canManage ? (
              <View style={serviceStyles.actions}>
                {["ACTIVE", "PAUSED"].includes(provider.status) ? <PrimaryButton label="Edit provider profile"
                  variant="secondary" onPress={() => router.push(`/(app)/services/providers/edit/${provider.id}` as never)} /> : null}
                <PrimaryButton label="Open provider workspace" variant="secondary"
                  onPress={() => router.push(`/(app)/services/providers/${provider.id}/workspace` as never)} />
                <PrimaryButton label="Find open requests for this provider" variant="secondary"
                  onPress={() => router.push(`/(app)/services/requests/discover?providerId=${provider.id}` as never)} />
                {provider.status === "ACTIVE" ? <PrimaryButton label="Pause provider" loading={acting}
                  onPress={() => void action(() => api.pauseProvider(provider.id))} /> : null}
                {provider.status === "PAUSED" ? <PrimaryButton label="Resume provider" loading={acting}
                  onPress={() => void action(() => api.resumeProvider(provider.id))} /> : null}
                {["ACTIVE", "PAUSED"].includes(provider.status) ? <PrimaryButton label="Close provider profile"
                  variant="danger" disabled={acting} onPress={closeProvider} /> : null}
              </View>
            ) : <PrimaryButton label="Report provider" variant="ghost" onPress={report} />}
            <ThemedText type="subtitle">Reviews</ThemedText>
            {!reviews.length ? <ThemedText themeColor="textSecondary">No published reviews yet.</ThemedText> : null}
            {reviews.map((review) => <ReviewItem key={review.id} review={review} api={api}
              canRespond={provider.canManage} onUpdated={(updated) =>
                setReviews((current) => current.map((item) => item.id === updated.id ? updated : item))} />)}
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function ReviewItem({ review, api, canRespond, onUpdated }: {
  review: ServiceReview;
  api: ServiceMarketplaceApi;
  canRespond: boolean;
  onUpdated: (review: ServiceReview) => void;
}) {
  const theme = useTheme();
  const [response, setResponse] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{review.reviewerDisplayName} · {review.rating}/5</ThemedText>
      <ThemedText>{review.reviewText ?? "No written review."}</ThemedText>
      {review.providerResponse ? <ThemedText type="small">Provider response: {review.providerResponse}</ThemedText> : null}
      {canRespond ? <View style={{ gap: 8 }}>
        <TextInput accessibilityLabel={`Respond to ${review.reviewerDisplayName}'s review`} placeholder="Write a provider response"
          value={response} onChangeText={setResponse} style={[serviceStyles.input, { color: theme.text, borderColor: theme.border }]} />
        <PrimaryButton label="Publish response" variant="secondary" loading={saving} disabled={!response.trim()} onPress={() => {
          setSaving(true);
          void api.respondToReview(review.id, response.trim()).then(onUpdated).then(() => setResponse("")).finally(() => setSaving(false));
        }} />
      </View> : null}
    </View>
  );
}
