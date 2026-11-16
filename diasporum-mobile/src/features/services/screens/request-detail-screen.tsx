import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
} from "react-native";
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
import { createMessagingApi } from "@/features/messaging/services/messaging-api";
import { createServiceMarketplaceApi } from "../services/service-marketplace-api";
import type {
  LeadAccess,
  ProviderResponse,
  ServiceConfiguration,
  ServiceEngagement,
  ResponseType,
  ServiceProvider,
  ServiceRequest,
} from "../types/service-marketplace-types";
import {
  LeadMarketplaceNotice,
  ScreenHeader,
  ServiceRequestImage,
  serviceStyles,
} from "../components/service-ui";

export default function RequestDetailScreen() {
  const { id, providerId } = useLocalSearchParams<{
    id: string;
    providerId?: string;
  }>();
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = useMemo(
    () => createServiceMarketplaceApi(apiClient),
    [apiClient],
  );
  const messaging = useMemo(() => createMessagingApi(apiClient), [apiClient]);
  const [request, setRequest] = useState<ServiceRequest | null>(null);
  const [provider, setProvider] = useState<ServiceProvider | null>(null);
  const [ownResponse, setOwnResponse] = useState<ProviderResponse | null>(null);
  const [lead, setLead] = useState<LeadAccess | null>(null);
  const [configuration, setConfiguration] =
    useState<ServiceConfiguration | null>(null);
  const [engagement, setEngagement] = useState<ServiceEngagement | null>(null);
  const [responseType, setResponseType] = useState<ResponseType>("INTEREST");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [detail, config, currentEngagement] = await Promise.all([
        api.request(id),
        api.configuration(),
        api.requestEngagement(id).catch((cause) => {
          if (ApiError.isApiError(cause) && cause.isNotFound) return null;
          throw cause;
        }),
      ]);
      setRequest(detail);
      setConfiguration(config);
      setEngagement(currentEngagement);
      if (providerId && !detail.canManage) {
        const providerDetail = await api.provider(providerId);
        setProvider(providerDetail);
        const [responsePage, currentLead] = await Promise.all([
          api.requestResponses(id).catch((cause) => {
            if (ApiError.isApiError(cause) && cause.isNotFound)
              return { items: [], nextCursor: null };
            throw cause;
          }),
          api.requestLead(id, providerId).catch((cause) => {
            if (ApiError.isApiError(cause) && cause.isNotFound) return null;
            throw cause;
          }),
        ]);
        setOwnResponse(responsePage.items[0] ?? null);
        setLead(currentLead);
      } else {
        setProvider(null);
        setOwnResponse(null);
        setLead(null);
      }
    } catch (cause) {
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "Could not load the service request.",
      );
    } finally {
      setLoading(false);
    }
  }, [api, id, providerId]);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  async function action(work: () => Promise<ServiceRequest>) {
    setActing(true);
    try {
      setRequest(await work());
      setError(null);
    } catch (cause) {
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "The request action failed.",
      );
    } finally {
      setActing(false);
    }
  }

  function confirmPublish() {
    if (!request) return;
    Alert.alert(
      "Publish service request",
      "Publishing uses one SERVICE_JOB_POST allowance. Your draft is kept if publishing fails.",
      [
        { text: "Keep draft", style: "cancel" },
        {
          text: "Publish",
          onPress: () => void action(() => api.publish(request.id)),
        },
      ],
    );
  }

  function confirmRepost() {
    if (!request) return;
    Alert.alert(
      "Repost service request",
      "This closes the current round and creates a fresh open job with new provider capacity. Existing quotes, lead charges, and conversations stay on the original request. Publishing the repost uses one SERVICE_JOB_POST allowance.",
      [
        { text: "Keep current request", style: "cancel" },
        {
          text: "Repost as a new job",
          onPress: () => {
            setActing(true);
            void api
              .repost(request.id)
              .then((reposted) => {
                setError(null);
                router.replace(
                  `/(app)/services/requests/${reposted.id}` as never,
                );
              })
              .catch((cause) => {
                setError(
                  ApiError.isApiError(cause)
                    ? cause.userMessage
                    : "Could not repost the request.",
                );
              })
              .finally(() => setActing(false));
          },
        },
      ],
    );
  }

  function confirmCancel() {
    if (!request) return;
    Alert.alert(
      "Cancel request",
      "Providers will no longer be able to send new responses.",
      [
        { text: "Keep request", style: "cancel" },
        {
          text: "Cancel request",
          style: "destructive",
          onPress: () => void action(() => api.cancel(request.id)),
        },
      ],
    );
  }

  async function submitResponse() {
    if (!request || !provider || !message.trim()) return;
    setActing(true);
    try {
      const response = await api.respond(
        request.id,
        provider.id,
        responseType,
        message.trim(),
      );
      setOwnResponse(response);
      setMessage("");
      setError(null);
    } catch (cause) {
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "Could not send the provider response.",
      );
    } finally {
      setActing(false);
    }
  }

  function confirmUnlock(enableChat: boolean, unlockContactDetails: boolean) {
    const upgrading = lead?.status === "ACTIVE";
    const price = configuration?.leadPrice ?? 0;
    const currency = configuration?.leadCurrency ?? "USD";
    if (!upgrading && price > 0) {
      Alert.alert(
        "Confirm lead access",
        `This unlock costs ${price.toFixed(2)} ${currency} and consumes one SERVICE_LEAD_ACCESS allowance. Later chat/contact upgrades do not charge again.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Unlock lead",
            onPress: () => void unlock(enableChat, unlockContactDetails),
          },
        ],
      );
      return;
    }
    void unlock(enableChat, unlockContactDetails);
  }

  async function unlock(enableChat: boolean, unlockContactDetails: boolean) {
    if (!request || !provider) return;
    setActing(true);
    try {
      setLead(
        await api.accessLead(
          request.id,
          provider.id,
          enableChat,
          unlockContactDetails,
        ),
      );
      setError(null);
    } catch (cause) {
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "Could not unlock lead access. No access was enabled.",
      );
    } finally {
      setActing(false);
    }
  }

  async function openProviderChat() {
    if (!request || !provider || !lead?.chatEnabled || lead.status !== "ACTIVE")
      return;
    setActing(true);
    try {
      const conversation = await messaging.createConversation({
        contextType: "SERVICE_REQUEST",
        contextId: request.id,
        recipientUserId: request.customerUserId,
        ...(provider.businessAccountId
          ? { actingBusinessAccountId: provider.businessAccountId }
          : {}),
      });
      router.push(`/(app)/messages/${conversation.id}` as never);
    } catch (cause) {
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "Could not open the service conversation.",
      );
    } finally {
      setActing(false);
    }
  }

  function report() {
    if (!request) return;
    Alert.alert(
      "Report request",
      "Send this request to the moderation queue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Report",
          style: "destructive",
          onPress: () => {
            void api
              .report(
                "SERVICE_REQUEST",
                request.id,
                "OTHER",
                "Reported from request details",
              )
              .then(() => Alert.alert("Report submitted"))
              .catch((cause) =>
                setError(
                  ApiError.isApiError(cause)
                    ? cause.userMessage
                    : "Could not report request.",
                ),
              );
          },
        },
      ],
    );
  }

  const canRespond = Boolean(
    request?.status === "OPEN" &&
    provider?.status === "ACTIVE" &&
    provider.onboardingStatus === "APPROVED" &&
    !request?.canManage,
  );
  const activeLead = lead?.status === "ACTIVE" ? lead : null;
  const leadPriceLabel =
    configuration && configuration.leadPrice > 0
      ? `${configuration.leadPrice.toFixed(2)} ${configuration.leadCurrency}`
      : "Free";
  const address = activeLead?.contactDetailsUnlocked
    ? activeLead.contactAddress
    : null;

  return (
    <ThemedView style={serviceStyles.root}>
      <SafeAreaView style={serviceStyles.root} edges={["top", "left", "right"]}>
        <ScreenHeader back menu title="Service request" />
        {loading ? (
          <LoadingScreen />
        ) : !request ? (
          <ErrorState
            message={error ?? "Request not found."}
            onRetry={() => {
              setLoading(true);
              void load();
            }}
          />
        ) : (
          <KeyboardAvoidingView
            style={serviceStyles.keyboard}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <ScrollView
              contentContainerStyle={serviceStyles.content}
              keyboardShouldPersistTaps="handled"
            >
              <ThemedText
                type="smallBold"
                style={{ color: BrandColors.primary }}
              >
                {request.categoryDisplayName} · {request.status}
              </ThemedText>
              <ThemedText type="title">{request.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Requested by {request.customerDisplayName}
              </ThemedText>
              <ThemedText>{request.description}</ThemedText>
              {request.mediaIds.map((mediaId) => (
                <ServiceRequestImage
                  key={mediaId}
                  client={apiClient}
                  requestId={request.id}
                  mediaId={mediaId}
                />
              ))}
              <ThemedText type="smallBold">
                {request.budgetMin != null || request.budgetMax != null
                  ? `Budget: ${request.budgetMin ?? "—"}–${request.budgetMax ?? "—"} ${request.currencyCode}`
                  : "Budget not specified"}
              </ThemedText>
              <ThemedText type="small">
                {request.preferredDate
                  ? `Preferred date: ${request.preferredDate}`
                  : "Flexible date"}
                {request.distanceMeters != null
                  ? ` · ${(request.distanceMeters / 1000).toFixed(1)} km away`
                  : ""}
              </ThemedText>
              {request.expiresAt ? (
                <ThemedText type="small">
                  Expires: {new Date(request.expiresAt).toLocaleString()}
                </ThemedText>
              ) : null}
              {request.repostedFromRequestId ? (
                <ThemedText type="small" themeColor="textSecondary">
                  This is a fresh repost round. Earlier quotes and lead access
                  remain on the original request.
                </ThemedText>
              ) : null}
              {engagement ? (
                <ThemedText type="smallBold">
                  Service engagement: {engagement.status}
                </ThemedText>
              ) : null}
              <LeadMarketplaceNotice />
              {error ? (
                <ThemedText
                  accessibilityRole="alert"
                  style={{ color: BrandColors.error }}
                >
                  {error}
                </ThemedText>
              ) : null}

              {request.canManage ? (
                <View style={serviceStyles.actions}>
                  {["DRAFT", "OPEN", "PAUSED"].includes(request.status) ? (
                    <PrimaryButton
                      label={
                        request.status === "DRAFT"
                          ? "Edit draft"
                          : "Edit request"
                      }
                      variant="secondary"
                      onPress={() =>
                        router.push(
                          `/(app)/services/requests/${request.id}/edit` as never,
                        )
                      }
                    />
                  ) : null}
                  {request.status === "DRAFT" ? (
                    <PrimaryButton
                      label="Publish request"
                      loading={acting}
                      onPress={confirmPublish}
                    />
                  ) : null}
                  <PrimaryButton
                    label="Find matching providers"
                    variant="secondary"
                    onPress={() =>
                      router.push(
                        `/(app)/services/requests/${request.id}/providers` as never,
                      )
                    }
                  />
                  <PrimaryButton
                    label="View provider responses"
                    variant="secondary"
                    onPress={() =>
                      router.push(
                        `/(app)/services/requests/${request.id}/responses` as never,
                      )
                    }
                  />
                  <PrimaryButton
                    label="Compare quotes and track progress"
                    variant="secondary"
                    onPress={() =>
                      router.push(
                        `/(app)/services/requests/${request.id}/quotes` as never,
                      )
                    }
                  />
                  {!engagement &&
                  ["OPEN", "PAUSED", "CLOSED", "EXPIRED"].includes(
                    request.status,
                  ) ? (
                    <PrimaryButton
                      label="Repost for new providers"
                      variant="secondary"
                      loading={acting}
                      onPress={confirmRepost}
                    />
                  ) : null}
                  {request.status === "OPEN" ? (
                    <PrimaryButton
                      label="Pause request"
                      loading={acting}
                      onPress={() => void action(() => api.pause(request.id))}
                    />
                  ) : null}
                  {request.status === "PAUSED" ? (
                    <PrimaryButton
                      label="Resume request"
                      loading={acting}
                      onPress={() => void action(() => api.resume(request.id))}
                    />
                  ) : null}
                  {["OPEN", "PAUSED"].includes(request.status) ? (
                    <PrimaryButton
                      label="Close request"
                      variant="secondary"
                      loading={acting}
                      onPress={() => void action(() => api.close(request.id))}
                    />
                  ) : null}
                  {["DRAFT", "OPEN", "PAUSED"].includes(request.status) ? (
                    <PrimaryButton
                      label="Cancel request"
                      variant="danger"
                      disabled={acting}
                      onPress={confirmCancel}
                    />
                  ) : null}
                </View>
              ) : null}

              {provider ? (
                <View style={serviceStyles.actions}>
                  <ThemedText type="subtitle">
                    Responding as {provider.displayName}
                  </ThemedText>
                  <PrimaryButton
                    label="Quotes and service progress"
                    variant="secondary"
                    onPress={() =>
                      router.push(
                        `/(app)/services/requests/${request.id}/quotes?providerId=${provider.id}` as never,
                      )
                    }
                  />
                  {ownResponse ? (
                    <>
                      <ThemedText>
                        Your response is {ownResponse.status}. Manage it from
                        the response workspace.
                      </ThemedText>
                      <PrimaryButton
                        label="Open response and lead workspace"
                        variant="secondary"
                        onPress={() =>
                          router.push(
                            `/(app)/services/requests/${request.id}/responses?providerId=${provider.id}` as never,
                          )
                        }
                      />
                    </>
                  ) : canRespond ? (
                    <>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <PrimaryButton
                          label="Interest"
                          variant={
                            responseType === "INTEREST"
                              ? "primary"
                              : "secondary"
                          }
                          onPress={() => setResponseType("INTEREST")}
                        />
                        <PrimaryButton
                          label="Contact"
                          variant={
                            responseType === "CONTACT" ? "primary" : "secondary"
                          }
                          onPress={() => setResponseType("CONTACT")}
                        />
                      </View>
                      <TextInput
                        accessibilityLabel="Provider response message"
                        placeholder="Introduce yourself and explain how you can help"
                        value={message}
                        onChangeText={setMessage}
                        multiline
                        maxLength={4000}
                        style={[
                          serviceStyles.input,
                          serviceStyles.multiline,
                          { color: theme.text, borderColor: theme.border },
                        ]}
                      />
                      <PrimaryButton
                        label="Send response"
                        loading={acting}
                        disabled={!message.trim()}
                        onPress={() => void submitResponse()}
                      />
                    </>
                  ) : null}

                  {!activeLead && request.status === "OPEN" ? (
                    <>
                      <ThemedText type="smallBold">
                        Lead access: {leadPriceLabel}
                      </ThemedText>
                      <PrimaryButton
                        label={`Unlock chat · ${leadPriceLabel}`}
                        loading={acting}
                        onPress={() => confirmUnlock(true, false)}
                      />
                      <PrimaryButton
                        label={`Unlock contact details · ${leadPriceLabel}`}
                        variant="secondary"
                        loading={acting}
                        onPress={() => confirmUnlock(false, true)}
                      />
                    </>
                  ) : null}
                  {activeLead && !activeLead.chatEnabled ? (
                    <PrimaryButton
                      label="Add chat access at no extra charge"
                      loading={acting}
                      onPress={() => confirmUnlock(true, false)}
                    />
                  ) : null}
                  {activeLead && !activeLead.contactDetailsUnlocked ? (
                    <PrimaryButton
                      label="Add contact details at no extra charge"
                      variant="secondary"
                      loading={acting}
                      onPress={() => confirmUnlock(false, true)}
                    />
                  ) : null}
                  {activeLead?.chatEnabled ? (
                    <PrimaryButton
                      label="Open service conversation"
                      loading={acting}
                      onPress={() => void openProviderChat()}
                    />
                  ) : null}
                  {activeLead?.contactDetailsUnlocked ? (
                    <ThemedText>
                      {address
                        ? `Private address: ${
                            address.formattedAddress ??
                            [
                              address.addressLine1,
                              address.addressLine2,
                              address.city,
                              address.region,
                              address.postalCode,
                            ]
                              .filter(Boolean)
                              .join(", ")
                          }`
                        : "Contact details are unlocked, but no private address was attached to this request."}
                    </ThemedText>
                  ) : null}
                </View>
              ) : null}
              {!request.canManage ? (
                <PrimaryButton
                  label="Report request"
                  variant="ghost"
                  onPress={report}
                />
              ) : null}
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}
