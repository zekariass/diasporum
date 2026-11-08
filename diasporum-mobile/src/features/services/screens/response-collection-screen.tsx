import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, RefreshControl, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { createMessagingApi } from "@/features/messaging/services/messaging-api";
import { createServiceMarketplaceApi, type ServiceMarketplaceApi } from "../services/service-marketplace-api";
import type {
  LeadAccess,
  ProviderResponse,
  ResponseType,
  ServiceRequest,
} from "../types/service-marketplace-types";
import { CollectionState, ScreenHeader, serviceStyles } from "../components/service-ui";

export default function ResponseCollectionScreen() {
  const { id, providerId } = useLocalSearchParams<{ id?: string; providerId?: string }>();
  const router = useRouter();
  const { apiClient } = useSession();
  const api = useMemo(() => createServiceMarketplaceApi(apiClient), [apiClient]);
  const [request, setRequest] = useState<ServiceRequest | null>(null);
  const [items, setItems] = useState<ProviderResponse[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async (nextCursor?: string) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      if (id) {
        const [detail, page] = await Promise.all([
          nextCursor ? Promise.resolve(null) : api.request(id),
          api.requestResponses(id, nextCursor),
        ]);
        if (detail) setRequest(detail);
        setItems((current) => nextCursor ? mergeResponses(current, page.items) : page.items);
        setCursor(page.nextCursor);
      } else {
        const page = await api.myResponses(providerId, nextCursor);
        setItems((current) => nextCursor ? mergeResponses(current, page.items) : page.items);
        setCursor(page.nextCursor);
      }
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load provider responses.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, id, providerId]);

  useEffect(() => {
    const task = setTimeout(() => { setLoading(true); void load(); }, 0);
    return () => clearTimeout(task);
  }, [load]);

  return (
    <ThemedView style={serviceStyles.root}>
      <SafeAreaView style={serviceStyles.root} edges={["top", "left", "right"]}>
        <ScreenHeader back title={id ? "Provider responses" : providerId ? "Provider workspace" : "My responses"} />
        <KeyboardAvoidingView style={serviceStyles.keyboard} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ResponseItem response={item} api={api} request={request}
            providerId={providerId} onUpdated={(updated) =>
              setItems((current) => current.map((entry) => entry.id === updated.id ? updated : entry))} />}
          contentContainerStyle={serviceStyles.content}
          ListHeaderComponent={!id && providerId ? <View style={serviceStyles.actions}>
            <PrimaryButton label="Find open requests" onPress={() =>
              router.push(`/(app)/services/requests/discover?providerId=${providerId}` as never)} />
            <PrimaryButton label="Open provider profile" variant="secondary" onPress={() =>
              router.push(`/(app)/services/providers/${providerId}` as never)} />
          </View> : undefined}
          ListEmptyComponent={<CollectionState loading={loading} error={error}
            empty={!loading && !error} emptyText={id ? "No provider responses yet" : "No responses from your provider profiles"}
            onRetry={() => { setLoading(true); void load(); }} />}
          refreshControl={<RefreshControl refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); void load(); }} />}
          onEndReached={() => { if (cursor && !loadingRef.current) void load(cursor); }}
        />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

export function mergeResponses(current: ProviderResponse[], incoming: ProviderResponse[]) {
  const ids = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !ids.has(item.id))];
}

function ResponseItem({ response, api, request, providerId, onUpdated }: {
  response: ProviderResponse;
  api: ServiceMarketplaceApi;
  request: ServiceRequest | null;
  providerId?: string;
  onUpdated: (response: ProviderResponse) => void;
}) {
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const messaging = useMemo(() => createMessagingApi(apiClient), [apiClient]);
  const [editing, setEditing] = useState(false);
  const [responseType, setResponseType] = useState<ResponseType>(response.responseType);
  const [message, setMessage] = useState(response.message);
  const [lead, setLead] = useState<LeadAccess | null>(null);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customer = Boolean(request?.canManage);
  const provider = Boolean(request && providerId && !request.canManage);

  useEffect(() => {
    let active = true;
    if (customer && request) {
      api.requestLead(request.id, response.serviceProviderId)
        .then((value) => { if (active) setLead(value); })
        .catch(() => { if (active) setLead(null); });
    }
    return () => { active = false; };
  }, [api, customer, request, response.serviceProviderId]);

  async function action(work: () => Promise<ProviderResponse>) {
    setActing(true);
    try {
      onUpdated(await work());
      setEditing(false);
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "The response action failed.");
    } finally {
      setActing(false);
    }
  }

  async function openCustomerChat() {
    if (!request || !lead?.chatEnabled || lead.status !== "ACTIVE") return;
    setActing(true);
    try {
      const providerDetail = await api.provider(response.serviceProviderId);
      const conversation = await messaging.createConversation({
        contextType: "SERVICE_REQUEST",
        contextId: request.id,
        ...(providerDetail.businessAccountId
          ? { recipientBusinessAccountId: providerDetail.businessAccountId }
          : { recipientUserId: response.respondedByUserId }),
      });
      router.push(`/(app)/messages/${conversation.id}` as never);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not open the service conversation.");
    } finally {
      setActing(false);
    }
  }

  return (
    <View style={{ gap: 12, borderBottomWidth: 1, borderBottomColor: theme.border, paddingBottom: 16 }}>
      <ThemedText type="smallBold" style={{ color: BrandColors.primary }}>
        {response.providerDisplayName} · {response.status}
      </ThemedText>
      <ThemedText type="small">{response.responseType}</ThemedText>
      {editing ? <View style={serviceStyles.actions}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <PrimaryButton label="Interest" variant={responseType === "INTEREST" ? "primary" : "secondary"}
            onPress={() => setResponseType("INTEREST")} />
          <PrimaryButton label="Contact" variant={responseType === "CONTACT" ? "primary" : "secondary"}
            onPress={() => setResponseType("CONTACT")} />
        </View>
        <TextInput accessibilityLabel={`Edit response to ${response.providerDisplayName}`}
          value={message} onChangeText={setMessage} multiline maxLength={4000}
          style={[serviceStyles.input, serviceStyles.multiline, { color: theme.text, borderColor: theme.border }]} />
        <PrimaryButton label="Save response" loading={acting} disabled={!message.trim()} onPress={() =>
          void action(() => api.updateResponse(response.id, response.serviceProviderId, responseType, message.trim()))} />
      </View> : <ThemedText>{response.message}</ThemedText>}
      {error ? <ThemedText accessibilityRole="alert" style={{ color: BrandColors.error }}>{error}</ThemedText> : null}
      <PrimaryButton label="Open provider profile" variant="ghost" onPress={() =>
        router.push(`/(app)/services/providers/${response.serviceProviderId}` as never)} />
      {customer && response.status === "SENT" ? <View style={serviceStyles.actions}>
        <PrimaryButton label="Accept response" loading={acting}
          onPress={() => void action(() => api.acceptResponse(response.id))} />
        <PrimaryButton label="Decline response" variant="secondary" loading={acting}
          onPress={() => void action(() => api.declineResponse(response.id))} />
      </View> : null}
      {customer ? <PrimaryButton label="Review this interaction" variant="secondary" onPress={() =>
        router.push(`/(app)/services/requests/${response.serviceRequestId}/review?providerId=${response.serviceProviderId}` as never)} /> : null}
      {customer && lead?.status === "ACTIVE" && lead.chatEnabled ? <PrimaryButton label="Open service conversation"
        loading={acting} onPress={() => void openCustomerChat()} /> : null}
      {provider && request?.status === "OPEN" ? <View style={serviceStyles.actions}>
        <PrimaryButton label={editing ? "Stop editing" : "Revise response"} variant="secondary"
          onPress={() => setEditing((current) => !current)} />
        {response.status === "SENT" ? <PrimaryButton label="Withdraw response" variant="danger" loading={acting}
          onPress={() => void action(() => api.withdrawResponse(response.id))} /> : null}
        <PrimaryButton label="Manage lead access and contact" onPress={() =>
          router.push(`/(app)/services/requests/${response.serviceRequestId}?providerId=${response.serviceProviderId}` as never)} />
      </View> : null}
      {!request ? <PrimaryButton label="Open service request" onPress={() =>
        router.push(`/(app)/services/requests/${response.serviceRequestId}${providerId ? `?providerId=${providerId}` : ""}` as never)} /> : null}
    </View>
  );
}
