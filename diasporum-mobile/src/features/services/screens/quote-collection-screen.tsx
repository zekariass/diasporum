import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
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
import { createServiceMarketplaceApi } from "../services/service-marketplace-api";
import type {
  EngagementAction,
  QuoteInput,
  QuoteItemInput,
  ServiceConfiguration,
  ServiceEngagement,
  ServiceProvider,
  ServiceQuote,
  ServiceRequest,
} from "../types/service-marketplace-types";
import {
  Card,
  CollectionState,
  ScreenHeader,
  StatusBadge,
  serviceStyles,
} from "../components/service-ui";
import { FormInput } from "@/shared/components/form-input";

export interface QuoteFormState {
  supersedesQuoteId?: string;
  title: string;
  scopeOfWork: string;
  amount: string;
  currencyCode: string;
  durationValue: string;
  durationUnit: "" | "HOUR" | "DAY" | "WEEK" | "MONTH";
  validUntil: string;
  inclusions: string;
  exclusions: string;
  termsAndConditions: string;
  items: QuoteItemInput[];
}

const EMPTY_FORM: QuoteFormState = {
  title: "",
  scopeOfWork: "",
  amount: "",
  currencyCode: "USD",
  durationValue: "",
  durationUnit: "",
  validUntil: "",
  inclusions: "",
  exclusions: "",
  termsAndConditions: "",
  items: [],
};

export function validateQuoteForm(form: QuoteFormState): string | null {
  if (!form.title.trim() || !form.scopeOfWork.trim())
    return "Add a quote title and scope of work.";
  const amount = Number(form.amount);
  if (!Number.isFinite(amount) || amount < 0)
    return "Enter a valid quote amount.";
  if (!/^[A-Za-z]{3}$/.test(form.currencyCode))
    return "Use a three-letter quote currency.";
  if (
    form.durationValue &&
    (!Number.isInteger(Number(form.durationValue)) ||
      Number(form.durationValue) < 1 ||
      !form.durationUnit)
  ) {
    return "Add a whole-number duration and select its unit.";
  }
  if (!form.durationValue && form.durationUnit)
    return "Add an estimated duration value.";
  if (
    form.validUntil &&
    (!Number.isFinite(Date.parse(form.validUntil)) ||
      Date.parse(form.validUntil) <= Date.now())
  ) {
    return "Quote validity must be a future ISO date/time.";
  }
  if (form.items.length > 50)
    return "A quote can contain at most 50 line items.";
  for (const item of form.items) {
    if (
      !item.description.trim() ||
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0 ||
      !Number.isFinite(item.unitAmount) ||
      item.unitAmount < 0
    )
      return "Complete every quote line item.";
  }
  if (form.items.length) {
    const itemTotal = form.items.reduce(
      (sum, item) => sum + item.quantity * item.unitAmount,
      0,
    );
    if (Math.round(itemTotal * 100) !== Math.round(amount * 100))
      return "Line items must add up to the quote amount.";
  }
  return null;
}

export function toQuoteInput(
  serviceProviderId: string,
  form: QuoteFormState,
): QuoteInput {
  return {
    serviceProviderId,
    ...(form.supersedesQuoteId
      ? { supersedesQuoteId: form.supersedesQuoteId }
      : {}),
    title: form.title.trim(),
    scopeOfWork: form.scopeOfWork.trim(),
    amount: Number(form.amount),
    currencyCode: form.currencyCode.toUpperCase(),
    ...(form.durationValue
      ? {
          estimatedDurationValue: Number(form.durationValue),
          estimatedDurationUnit: form.durationUnit || undefined,
        }
      : {}),
    ...(form.validUntil
      ? { validUntil: new Date(form.validUntil).toISOString() }
      : {}),
    ...(form.inclusions.trim() ? { inclusions: form.inclusions.trim() } : {}),
    ...(form.exclusions.trim() ? { exclusions: form.exclusions.trim() } : {}),
    ...(form.termsAndConditions.trim()
      ? { termsAndConditions: form.termsAndConditions.trim() }
      : {}),
    items: form.items,
  };
}

export default function QuoteCollectionScreen() {
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
  const [request, setRequest] = useState<ServiceRequest | null>(null);
  const [provider, setProvider] = useState<ServiceProvider | null>(null);
  const [configuration, setConfiguration] =
    useState<ServiceConfiguration | null>(null);
  const [quotes, setQuotes] = useState<ServiceQuote[]>([]);
  const [engagement, setEngagement] = useState<ServiceEngagement | null>(null);
  const [form, setForm] = useState<QuoteFormState>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [itemDraft, setItemDraft] = useState({
    description: "",
    quantity: "1",
    unitLabel: "",
    unitAmount: "",
  });
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [detail, quoteItems, currentEngagement, config, currentProvider] =
        await Promise.all([
          api.request(id),
          api.requestQuotes(id),
          api.requestEngagement(id).catch((cause) => {
            if (ApiError.isApiError(cause) && cause.isNotFound) return null;
            throw cause;
          }),
          api.configuration(),
          providerId ? api.provider(providerId) : Promise.resolve(null),
        ]);
      setRequest(detail);
      setQuotes(quoteItems);
      setEngagement(currentEngagement);
      setConfiguration(config);
      setProvider(currentProvider);
      setForm((current) =>
        current === EMPTY_FORM
          ? { ...EMPTY_FORM, currencyCode: detail.currencyCode ?? "USD" }
          : current,
      );
      setError(null);
    } catch (cause) {
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "Could not load quotes and service progress.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, id, providerId]);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  function patch(value: Partial<QuoteFormState>) {
    setForm((current) => ({ ...current, ...value }));
  }

  async function submitQuote() {
    if (!request || !provider) return;
    const validation = validateQuoteForm(form);
    if (validation) {
      setError(validation);
      return;
    }
    setActing(true);
    try {
      await api.submitQuote(request.id, toQuoteInput(provider.id, form));
      setForm({ ...EMPTY_FORM, currencyCode: form.currencyCode });
      setShowForm(false);
      setError(null);
      await load();
    } catch (cause) {
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "Could not send the quote.",
      );
    } finally {
      setActing(false);
    }
  }

  function revise(quote: ServiceQuote) {
    setForm({
      supersedesQuoteId: quote.id,
      title: quote.title,
      scopeOfWork: quote.scopeOfWork,
      amount: String(quote.amount),
      currencyCode: quote.currencyCode,
      durationValue: String(quote.estimatedDurationValue ?? ""),
      durationUnit: quote.estimatedDurationUnit ?? "",
      validUntil: quote.validUntil ?? "",
      inclusions: quote.inclusions ?? "",
      exclusions: quote.exclusions ?? "",
      termsAndConditions: quote.termsAndConditions ?? "",
      items: quote.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        ...(item.unitLabel ? { unitLabel: item.unitLabel } : {}),
        unitAmount: item.unitAmount,
      })),
    });
    setShowForm(true);
  }

  function addItem() {
    const item = {
      description: itemDraft.description.trim(),
      quantity: Number(itemDraft.quantity),
      ...(itemDraft.unitLabel.trim()
        ? { unitLabel: itemDraft.unitLabel.trim() }
        : {}),
      unitAmount: Number(itemDraft.unitAmount),
    };
    if (
      !item.description ||
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0 ||
      !Number.isFinite(item.unitAmount) ||
      item.unitAmount < 0
    ) {
      setError(
        "Add a line description, positive quantity, and valid unit amount.",
      );
      return;
    }
    patch({ items: [...form.items, item] });
    setItemDraft({
      description: "",
      quantity: "1",
      unitLabel: "",
      unitAmount: "",
    });
    setError(null);
  }

  async function quoteAction(
    work: () => Promise<ServiceQuote | ServiceEngagement>,
    successMessage?: string,
  ) {
    setActing(true);
    try {
      const result = await work();
      if ("acceptedQuoteId" in result) setEngagement(result);
      setError(null);
      if (successMessage) Alert.alert(successMessage);
      await load();
    } catch (cause) {
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "The quote action failed.",
      );
    } finally {
      setActing(false);
    }
  }

  function accept(quote: ServiceQuote) {
    Alert.alert(
      "Accept this quote",
      "This closes the request and starts service coordination. The service itself is delivered and paid outside DIASPORUM.",
      [
        { text: "Keep comparing", style: "cancel" },
        {
          text: "Accept quote",
          onPress: () => void quoteAction(() => api.acceptQuote(quote.id)),
        },
      ],
    );
  }

  async function transition(action: EngagementAction) {
    if (!engagement) return;
    if (action === "RAISE_ISSUE" && !reason.trim()) {
      setError("Add an issue reason before raising an issue.");
      return;
    }
    await quoteAction(() =>
      api.transitionEngagement(
        engagement.id,
        action,
        note.trim() || undefined,
        reason.trim() || undefined,
      ),
    );
    setNote("");
    setReason("");
  }

  const customer = Boolean(request?.canManage);
  const canQuote = Boolean(
    provider &&
    provider.onboardingStatus === "APPROVED" &&
    provider.status === "ACTIVE" &&
    request?.status === "OPEN" &&
    !engagement,
  );
  const itemTotal = form.items.reduce(
    (sum, item) => sum + item.quantity * item.unitAmount,
    0,
  );

  return (
    <ThemedView style={serviceStyles.root}>
      <SafeAreaView style={serviceStyles.root} edges={["top", "left", "right"]}>
        <ScreenHeader back menu title="Quotes and progress" />
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
            <FlatList
              data={quotes}
              keyExtractor={(item) => item.id}
              contentContainerStyle={serviceStyles.content}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => {
                    setRefreshing(true);
                    void load();
                  }}
                />
              }
              ListHeaderComponent={
                <View style={serviceStyles.actions}>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <ThemedText
                      type="smallBold"
                      style={{ color: BrandColors.primary, flex: 1 }}
                    >
                      {request.categoryDisplayName}
                    </ThemedText>
                    <StatusBadge status={request.status} />
                  </View>
                  <ThemedText type="title">{request.title}</ThemedText>
                  {configuration ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      Up to {configuration.maxProvidersPerRequest} providers can
                      respond, quote, or unlock this job. Reposting starts a
                      fresh round.
                    </ThemedText>
                  ) : null}
                  {error ? (
                    <ThemedText
                      accessibilityRole="alert"
                      style={{ color: BrandColors.error }}
                    >
                      {error}
                    </ThemedText>
                  ) : null}

                  {engagement ? (
                    <Card>
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <ThemedText type="subtitle" style={{ flex: 1 }}>
                          Service engagement
                        </ThemedText>
                        <StatusBadge status={engagement.status} />
                      </View>
                      <ThemedText>{engagement.providerDisplayName}</ThemedText>
                      {engagement.issueReason ? (
                        <ThemedText>Issue: {engagement.issueReason}</ThemedText>
                      ) : null}
                      {engagement.providerCompletionNote ? (
                        <ThemedText>
                          Provider completion note:{" "}
                          {engagement.providerCompletionNote}
                        </ThemedText>
                      ) : null}
                      {engagement.customerCompletionNote ? (
                        <ThemedText>
                          Customer completion note:{" "}
                          {engagement.customerCompletionNote}
                        </ThemedText>
                      ) : null}
                      {!["COMPLETED", "CANCELLED"].includes(
                        engagement.status,
                      ) ? (
                        <>
                          <TextInput
                            accessibilityLabel="Engagement note"
                            placeholder="Completion or transition note (optional)"
                            value={note}
                            onChangeText={setNote}
                            multiline
                            style={[
                              serviceStyles.input,
                              { color: theme.text, borderColor: theme.border },
                            ]}
                          />
                          <TextInput
                            accessibilityLabel="Engagement issue reason"
                            placeholder="Issue or cancellation reason"
                            value={reason}
                            onChangeText={setReason}
                            multiline
                            style={[
                              serviceStyles.input,
                              { color: theme.text, borderColor: theme.border },
                            ]}
                          />
                          {!customer && engagement.status === "ACCEPTED" ? (
                            <PrimaryButton
                              label="Start work"
                              loading={acting}
                              onPress={() => void transition("START")}
                            />
                          ) : null}
                          {!customer &&
                          ["IN_PROGRESS", "ISSUE_RAISED"].includes(
                            engagement.status,
                          ) ? (
                            <PrimaryButton
                              label="Submit completion"
                              loading={acting}
                              onPress={() =>
                                void transition("SUBMIT_COMPLETION")
                              }
                            />
                          ) : null}
                          {customer &&
                          ["COMPLETION_SUBMITTED", "ISSUE_RAISED"].includes(
                            engagement.status,
                          ) ? (
                            <PrimaryButton
                              label="Confirm completion"
                              loading={acting}
                              onPress={() => void transition("COMPLETE")}
                            />
                          ) : null}
                          {["IN_PROGRESS", "COMPLETION_SUBMITTED"].includes(
                            engagement.status,
                          ) ? (
                            <PrimaryButton
                              label="Raise an issue"
                              variant="secondary"
                              loading={acting}
                              onPress={() => void transition("RAISE_ISSUE")}
                            />
                          ) : null}
                          {["ACCEPTED", "IN_PROGRESS", "ISSUE_RAISED"].includes(
                            engagement.status,
                          ) ? (
                            <PrimaryButton
                              label="Cancel engagement"
                              variant="danger"
                              loading={acting}
                              onPress={() => void transition("CANCEL")}
                            />
                          ) : null}
                        </>
                      ) : null}
                      {customer && engagement.status === "COMPLETED" ? (
                        <PrimaryButton
                          label="Review completed service"
                          variant="secondary"
                          onPress={() =>
                            router.push(
                              `/(app)/services/requests/${request.id}/review?providerId=${engagement.serviceProviderId}` as never,
                            )
                          }
                        />
                      ) : null}
                    </Card>
                  ) : null}

                  {canQuote ? (
                    <>
                      <PrimaryButton
                        label={
                          showForm
                            ? "Close quote editor"
                            : "Send a structured quote"
                        }
                        variant={showForm ? "ghost" : "primary"}
                        onPress={() => setShowForm((current) => !current)}
                      />
                      {showForm ? (
                        <Card>
                          {form.supersedesQuoteId ? (
                            <ThemedText type="smallBold">
                              Creating an immutable revised quote
                            </ThemedText>
                          ) : null}
                          <FormInput
                            label="Quote title"
                            value={form.title}
                            onChangeText={(title) => patch({ title })}
                            placeholder="e.g. Complete bathroom repair"
                          />
                          <FormInput
                            label="Scope of work"
                            value={form.scopeOfWork}
                            onChangeText={(scopeOfWork) =>
                              patch({ scopeOfWork })
                            }
                            placeholder="Describe exactly what is included"
                            multiline
                          />
                          <FormInput
                            label="Quote amount"
                            value={form.amount}
                            onChangeText={(amount) => patch({ amount })}
                            placeholder="Total amount"
                            keyboardType="decimal-pad"
                          />
                          <FormInput
                            label="Quote currency"
                            value={form.currencyCode}
                            onChangeText={(currencyCode) =>
                              patch({ currencyCode })
                            }
                            placeholder="USD"
                            autoCapitalize="characters"
                          />
                          <FormInput
                            label="Estimated duration"
                            value={form.durationValue}
                            onChangeText={(durationValue) =>
                              patch({ durationValue })
                            }
                            placeholder="Optional whole-number duration"
                            keyboardType="number-pad"
                          />
                          <ThemedText type="smallBold">
                            Duration unit
                          </ThemedText>
                          <View
                            style={{
                              flexDirection: "row",
                              flexWrap: "wrap",
                              gap: 8,
                            }}
                          >
                            {(["HOUR", "DAY", "WEEK", "MONTH"] as const).map(
                              (unit) => (
                                <Pressable
                                  key={unit}
                                  accessibilityRole="button"
                                  accessibilityState={{
                                    selected: form.durationUnit === unit,
                                  }}
                                  onPress={() =>
                                    patch({
                                      durationUnit:
                                        form.durationUnit === unit ? "" : unit,
                                    })
                                  }
                                  style={{
                                    padding: 10,
                                    borderWidth: 1,
                                    borderRadius: 20,
                                    borderColor:
                                      form.durationUnit === unit
                                        ? BrandColors.primary
                                        : theme.border,
                                  }}
                                >
                                  <ThemedText type="small">{unit}</ThemedText>
                                </Pressable>
                              ),
                            )}
                          </View>
                          <FormInput
                            label="Quote valid until"
                            value={form.validUntil}
                            onChangeText={(validUntil) => patch({ validUntil })}
                            placeholder="Optional future ISO date/time"
                          />
                          <FormInput
                            label="Quote inclusions"
                            value={form.inclusions}
                            onChangeText={(inclusions) => patch({ inclusions })}
                            placeholder="Optional inclusions"
                            multiline
                          />
                          <FormInput
                            label="Quote exclusions"
                            value={form.exclusions}
                            onChangeText={(exclusions) => patch({ exclusions })}
                            placeholder="Optional exclusions"
                            multiline
                          />
                          <FormInput
                            label="Quote terms"
                            value={form.termsAndConditions}
                            onChangeText={(termsAndConditions) =>
                              patch({ termsAndConditions })
                            }
                            placeholder="Optional terms and conditions"
                            multiline
                          />

                          <ThemedText type="subtitle">
                            Optional line items
                          </ThemedText>
                          {form.items.map((item, index) => (
                            <View
                              key={`${item.description}-${index}`}
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              <ThemedText style={{ flex: 1 }}>
                                {item.description} · {item.quantity} ×{" "}
                                {item.unitAmount}
                              </ThemedText>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Remove line item ${index + 1}`}
                                onPress={() =>
                                  patch({
                                    items: form.items.filter(
                                      (_, itemIndex) => itemIndex !== index,
                                    ),
                                  })
                                }
                              >
                                <ThemedText
                                  style={{ color: BrandColors.error }}
                                >
                                  Remove
                                </ThemedText>
                              </Pressable>
                            </View>
                          ))}
                          <FormInput
                            label="Line item description"
                            value={itemDraft.description}
                            onChangeText={(description) =>
                              setItemDraft((current) => ({
                                ...current,
                                description,
                              }))
                            }
                            placeholder="Work or material description"
                          />
                          <FormInput
                            label="Line item quantity"
                            value={itemDraft.quantity}
                            onChangeText={(quantity) =>
                              setItemDraft((current) => ({
                                ...current,
                                quantity,
                              }))
                            }
                            placeholder="Quantity"
                            keyboardType="decimal-pad"
                          />
                          <FormInput
                            label="Line item unit label"
                            value={itemDraft.unitLabel}
                            onChangeText={(unitLabel) =>
                              setItemDraft((current) => ({
                                ...current,
                                unitLabel,
                              }))
                            }
                            placeholder="e.g. hour, item (optional)"
                          />
                          <FormInput
                            label="Line item unit amount"
                            value={itemDraft.unitAmount}
                            onChangeText={(unitAmount) =>
                              setItemDraft((current) => ({
                                ...current,
                                unitAmount,
                              }))
                            }
                            placeholder="Unit amount"
                            keyboardType="decimal-pad"
                          />
                          <PrimaryButton
                            label="Add line item"
                            variant="secondary"
                            onPress={addItem}
                          />
                          {form.items.length ? (
                            <PrimaryButton
                              label={`Use line-item total: ${itemTotal.toFixed(2)}`}
                              variant="ghost"
                              onPress={() =>
                                patch({ amount: itemTotal.toFixed(2) })
                              }
                            />
                          ) : null}
                          <PrimaryButton
                            label={
                              form.supersedesQuoteId
                                ? "Send revised quote"
                                : "Send quote"
                            }
                            loading={acting}
                            onPress={() => void submitQuote()}
                          />
                        </Card>
                      ) : null}
                    </>
                  ) : null}
                  <ThemedText type="subtitle">Quotes</ThemedText>
                </View>
              }
              ListEmptyComponent={
                <CollectionState
                  loading={false}
                  error={null}
                  empty
                  emptyText="No structured quotes yet"
                  onRetry={() => void load()}
                />
              }
              renderItem={({ item }) => (
                <QuoteCard
                  quote={item}
                  customer={customer}
                  provider={provider}
                  requestOpen={request.status === "OPEN" && !engagement}
                  acting={acting}
                  onAccept={() => accept(item)}
                  onDecline={() =>
                    void quoteAction(() => api.declineQuote(item.id))
                  }
                  onWithdraw={() =>
                    void quoteAction(() => api.withdrawQuote(item.id))
                  }
                  onRevise={() => revise(item)}
                />
              )}
            />
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function QuoteCard({
  quote,
  customer,
  provider,
  requestOpen,
  acting,
  onAccept,
  onDecline,
  onWithdraw,
  onRevise,
}: {
  quote: ServiceQuote;
  customer: boolean;
  provider: ServiceProvider | null;
  requestOpen: boolean;
  acting: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onWithdraw: () => void;
  onRevise: () => void;
}) {
  const ownsQuote = provider?.id === quote.serviceProviderId;
  return (
    <Card>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <ThemedText
          type="smallBold"
          style={{ color: BrandColors.primary, flex: 1 }}
        >
          {quote.providerDisplayName} · Revision {quote.revisionNo}
        </ThemedText>
        <StatusBadge status={quote.status} />
      </View>
      <ThemedText type="subtitle">{quote.title}</ThemedText>
      <ThemedText type="title">
        {quote.amount.toFixed(2)} {quote.currencyCode}
      </ThemedText>
      <ThemedText>{quote.scopeOfWork}</ThemedText>
      {quote.estimatedDurationValue ? (
        <ThemedText>
          Estimated duration: {quote.estimatedDurationValue}{" "}
          {quote.estimatedDurationUnit}
        </ThemedText>
      ) : null}
      {quote.validUntil ? (
        <ThemedText>
          Valid until: {new Date(quote.validUntil).toLocaleString()}
        </ThemedText>
      ) : null}
      {quote.items.map((item) => (
        <ThemedText key={item.id} type="small">
          {item.lineNo}. {item.description} · {item.quantity}{" "}
          {item.unitLabel ?? ""} × {item.unitAmount} = {item.lineAmount}{" "}
          {quote.currencyCode}
        </ThemedText>
      ))}
      {quote.inclusions ? (
        <ThemedText type="small">Includes: {quote.inclusions}</ThemedText>
      ) : null}
      {quote.exclusions ? (
        <ThemedText type="small">Excludes: {quote.exclusions}</ThemedText>
      ) : null}
      {quote.termsAndConditions ? (
        <ThemedText type="small">Terms: {quote.termsAndConditions}</ThemedText>
      ) : null}
      {customer && requestOpen && quote.status === "SENT" ? (
        <>
          <PrimaryButton
            label="Accept quote"
            loading={acting}
            onPress={onAccept}
          />
          <PrimaryButton
            label="Decline quote"
            variant="secondary"
            loading={acting}
            onPress={onDecline}
          />
        </>
      ) : null}
      {ownsQuote && requestOpen && quote.status === "SENT" ? (
        <>
          <PrimaryButton
            label="Revise quote"
            variant="secondary"
            onPress={onRevise}
          />
          <PrimaryButton
            label="Withdraw quote"
            variant="danger"
            loading={acting}
            onPress={onWithdraw}
          />
        </>
      ) : null}
    </Card>
  );
}
