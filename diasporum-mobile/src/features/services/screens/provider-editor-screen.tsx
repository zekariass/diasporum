import React, { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { PrimaryButton } from "@/shared/components/primary-button";
import { FormInput } from "@/shared/components/form-input";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createServiceMarketplaceApi } from "../services/service-marketplace-api";
import type {
  ProviderInput,
  ServiceCategory,
} from "../types/service-marketplace-types";
import {
  Card,
  LeadMarketplaceNotice,
  ScreenHeader,
  serviceStyles,
} from "../components/service-ui";
import {
  WizardChip,
  WizardFieldLabel,
  WizardQuestion,
  WizardScaffold,
  WizardStepTransition,
  WizardSummaryRow,
} from "../components/service-wizard";
import { isLeafCategory, leafDescendants } from "../utils/category-tree";

export interface ProviderFormState {
  businessAccountId: string;
  displayName: string;
  description: string;
  latitude: string;
  longitude: string;
  radiusKm: string;
  categoryIds: string[];
}

export function validateProviderForm(form: ProviderFormState): string | null {
  if (!form.displayName.trim()) return "Add a provider display name.";
  if (!form.categoryIds.length) return "Select at least one service category.";
  const coverageError = validateProviderCoverage(form);
  if (coverageError) return coverageError;
  return null;
}

function validateProviderCoverage(form: ProviderFormState): string | null {
  const latitude = Number(form.latitude);
  const longitude = Number(form.longitude);
  const radius = Number(form.radiusKm);
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return "Use your current location or enter valid base coordinates.";
  }
  if (!Number.isFinite(radius) || radius < 1 || radius > 300)
    return "Radius must be between 1 and 300 km.";
  return null;
}

export function toProviderInput(form: ProviderFormState): ProviderInput {
  return {
    ...(form.businessAccountId.trim()
      ? { businessAccountId: form.businessAccountId.trim() }
      : {}),
    displayName: form.displayName.trim(),
    ...(form.description.trim()
      ? { description: form.description.trim() }
      : {}),
    baseLatitude: Number(form.latitude),
    baseLongitude: Number(form.longitude),
    radiusKm: Number(form.radiusKm),
    categoryIds: form.categoryIds,
  };
}

const WIZARD_STEPS = ["Profile", "Services", "Coverage", "Review"] as const;

export default function ProviderEditorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = useMemo(
    () => createServiceMarketplaceApi(apiClient),
    [apiClient],
  );
  const [form, setForm] = useState<ProviderFormState>({
    businessAccountId: "",
    displayName: "",
    description: "",
    latitude: "",
    longitude: "",
    radiusKm: "25",
    categoryIds: [],
  });
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const leafCategories = categories.filter((candidate) =>
    isLeafCategory(candidate, categories),
  );
  const parentCategories = categories.filter(
    (candidate) => candidate.parentId == null,
  );

  useEffect(() => {
    api
      .categories()
      .then(setCategories)
      .catch(() => setError("Could not load service categories."));
    if (id) {
      api
        .provider(id)
        .then((provider) => {
          setForm({
            businessAccountId: provider.businessAccountId ?? "",
            displayName: provider.displayName,
            description: provider.description ?? "",
            latitude: String(provider.baseLatitude ?? ""),
            longitude: String(provider.baseLongitude ?? ""),
            radiusKm: String(provider.radiusKm ?? 25),
            categoryIds: provider.categories.map((item) => item.id),
          });
        })
        .catch((cause) =>
          setError(
            ApiError.isApiError(cause)
              ? cause.userMessage
              : "Could not load provider.",
          ),
        )
        .finally(() => setLoading(false));
    }
  }, [api, id]);

  function patch(value: Partial<ProviderFormState>) {
    setForm((current) => ({ ...current, ...value }));
  }

  async function pickCurrentLocation() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setError(
        "Location permission was denied. Enter approximate base coordinates instead.",
      );
      return;
    }
    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      patch({
        latitude: String(position.coords.latitude),
        longitude: String(position.coords.longitude),
      });
      setError(null);
    } catch {
      setError("Location is unavailable. Enter approximate base coordinates.");
    }
  }

  async function save() {
    const validation = validateProviderForm(form);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input = toProviderInput(form);
      const provider = id
        ? await api.updateProvider(id, input)
        : await api.createProvider(input);
      router.replace(`/(app)/services/providers/${provider.id}` as never);
    } catch (cause) {
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "Could not save the provider profile.",
      );
    } finally {
      setSaving(false);
    }
  }

  // ------------------------------------------------------------ create wizard

  const canContinue = useMemo(() => {
    if (id) return false;
    switch (step) {
      case 0:
        return Boolean(form.displayName.trim());
      case 1:
        return form.categoryIds.length > 0;
      case 2:
        return validateProviderCoverage(form) == null;
      case 3:
        return validateProviderForm(form) == null;
      default:
        return false;
    }
  }, [form, id, step]);

  function goBack() {
    if (step === 0) {
      if (router.canGoBack()) router.back();
      else router.replace("/(app)/services" as never);
      return;
    }
    setDirection(-1);
    setStep((current) => Math.max(0, current - 1));
    setError(null);
  }

  function goNext() {
    setDirection(1);
    if (step === WIZARD_STEPS.length - 1) {
      void save();
      return;
    }
    setStep((current) => current + 1);
    setError(null);
  }

  const selectedNames = categories
    .filter((category) => form.categoryIds.includes(category.id))
    .map((category) => category.displayName)
    .join(", ");

  function wizardStep() {
    switch (step) {
      case 0:
        return (
          <>
            <WizardQuestion
              icon="person-outline"
              title="Set up your profile"
              description="This is how customers will see you in search results."
            />
            <FormInput
              label="Display name"
              placeholder="Your name or business name"
              value={form.displayName}
              onChangeText={(value) => patch({ displayName: value })}
              maxLength={120}
              required
            />
            <FormInput
              label="About your services"
              placeholder="Services, experience, and working hours"
              value={form.description}
              onChangeText={(value) => patch({ description: value })}
              multiline
              numberOfLines={4}
              maxLength={4000}
            />
            <FormInput
              label="Business account ID"
              placeholder="Optional — leave blank for personal"
              autoCapitalize="none"
              value={form.businessAccountId}
              onChangeText={(value) => patch({ businessAccountId: value })}
              hint="Link a business account to represent it as the provider."
            />
          </>
        );
      case 1:
        return (
          <>
            <WizardQuestion
              icon="briefcase-outline"
              title="What services do you offer?"
              description="Pick every service you cover — matching jobs will appear in your provider workspace."
            />
            {parentCategories.map((parent) => {
              const children = leafDescendants(parent, categories);
              if (!children.length) return null;
              return (
                <View key={parent.id} style={styles.serviceGroup}>
                  <WizardFieldLabel label={parent.displayName} />
                  <View style={styles.categories}>
                    {children.map((category) => {
                      const selected = form.categoryIds.includes(category.id);
                      return (
                        <WizardChip
                          key={category.id}
                          label={category.displayName}
                          selected={selected}
                          onPress={() =>
                            patch({
                              categoryIds: selected
                                ? form.categoryIds.filter(
                                    (item) => item !== category.id,
                                  )
                                : [...form.categoryIds, category.id],
                            })
                          }
                        />
                      );
                    })}
                  </View>
                </View>
              );
            })}
            {!leafCategories.length ? (
              <ThemedText type="small" themeColor="textSecondary">
                No service categories available yet.
              </ThemedText>
            ) : null}
          </>
        );
      case 2:
        return (
          <>
            <WizardQuestion
              icon="navigate-outline"
              title="Where do you work?"
              description="Your base point and radius decide which nearby jobs you see. Customers only ever see an approximate area."
            />
            <PrimaryButton
              label="Use current location"
              variant="secondary"
              onPress={() => void pickCurrentLocation()}
            />
            <View style={styles.coordinatePair}>
              <View style={styles.flex}>
                <FormInput
                  label="Base latitude"
                  placeholder="Approximate latitude"
                  keyboardType="decimal-pad"
                  value={form.latitude}
                  onChangeText={(value) => patch({ latitude: value })}
                  required
                />
              </View>
              <View style={styles.flex}>
                <FormInput
                  label="Base longitude"
                  placeholder="Approximate longitude"
                  keyboardType="decimal-pad"
                  value={form.longitude}
                  onChangeText={(value) => patch({ longitude: value })}
                  required
                />
              </View>
            </View>
            <FormInput
              label="Service radius (km)"
              placeholder="1 – 300"
              keyboardType="decimal-pad"
              value={form.radiusKm}
              onChangeText={(value) => patch({ radiusKm: value })}
              required
            />
          </>
        );
      case 3:
        return (
          <>
            <WizardQuestion
              icon="checkmark-circle-outline"
              title="Review your profile"
              description="Registration is free — your profile is submitted for administrator approval after creation."
            />
            <Card>
              <WizardSummaryRow
                icon="person-outline"
                label="Name"
                value={form.displayName || "—"}
              />
              <WizardSummaryRow
                icon="briefcase-outline"
                label="Services"
                value={selectedNames || "—"}
              />
              <WizardSummaryRow
                icon="navigate-outline"
                label="Base"
                value={`${form.latitude || "—"}, ${form.longitude || "—"}`}
              />
              <WizardSummaryRow
                icon="radio-outline"
                label="Radius"
                value={`${form.radiusKm || "—"} km`}
              />
              <WizardSummaryRow
                icon="business-outline"
                label="Business"
                value={form.businessAccountId.trim() || "Personal"}
              />
            </Card>
            <ThemedText type="small" themeColor="textSecondary">
              After saving, review your profile and submit it for administrator
              approval. Registration is free.
            </ThemedText>
          </>
        );
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------- render

  if (!id) {
    return (
      <ThemedView style={serviceStyles.root}>
        <SafeAreaView
          style={serviceStyles.root}
          edges={["top", "left", "right"]}
        >
          <WizardScaffold
            step={step}
            total={WIZARD_STEPS.length}
            title="Offer services"
            onBack={goBack}
            canContinue={canContinue}
            continueLabel={
              step === WIZARD_STEPS.length - 1
                ? "Create provider profile"
                : "Continue"
            }
            submitting={saving}
            onContinue={goNext}
          >
            <WizardStepTransition step={step} direction={direction}>
              {wizardStep()}
            </WizardStepTransition>
            {error ? (
              <ThemedText
                accessibilityRole="alert"
                style={[styles.error, { color: BrandColors.error }]}
              >
                {error}
              </ThemedText>
            ) : null}
          </WizardScaffold>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={serviceStyles.root}>
      <SafeAreaView style={serviceStyles.root} edges={["top", "left", "right"]}>
        <ScreenHeader back title="Edit provider profile" />
        {loading ? (
          <LoadingScreen />
        ) : (
          <KeyboardAvoidingView
            style={serviceStyles.keyboard}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <ScrollView
              contentContainerStyle={serviceStyles.content}
              keyboardShouldPersistTaps="handled"
            >
              <LeadMarketplaceNotice />
              <TextInput
                accessibilityLabel="Provider display name"
                placeholder="Provider display name"
                value={form.displayName}
                onChangeText={(value) => patch({ displayName: value })}
                maxLength={120}
                style={[
                  serviceStyles.input,
                  { color: theme.text, borderColor: theme.border },
                ]}
              />
              <TextInput
                accessibilityLabel="Provider description"
                placeholder="Services, experience, and working hours"
                value={form.description}
                onChangeText={(value) => patch({ description: value })}
                multiline
                maxLength={4000}
                style={[
                  serviceStyles.input,
                  serviceStyles.multiline,
                  { color: theme.text, borderColor: theme.border },
                ]}
              />
              <ThemedText type="smallBold">Services you offer</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Subscribe to child services. Only jobs for these services will
                appear in your provider workspace after approval.
              </ThemedText>
              <View style={styles.categories}>
                {leafCategories.map((category) => {
                  const selected = form.categoryIds.includes(category.id);
                  const parent = categories.find(
                    (item) => item.id === category.parentId,
                  );
                  return (
                    <Pressable
                      key={category.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`Provider service ${category.displayName}`}
                      onPress={() =>
                        patch({
                          categoryIds: selected
                            ? form.categoryIds.filter(
                                (item) => item !== category.id,
                              )
                            : [...form.categoryIds, category.id],
                        })
                      }
                      style={[
                        styles.category,
                        {
                          borderColor: selected
                            ? BrandColors.primary
                            : theme.border,
                        },
                      ]}
                    >
                      <ThemedText type="small">
                        {parent ? `${parent.displayName} · ` : ""}
                        {category.displayName}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
              <PrimaryButton
                label="Use current location"
                variant="secondary"
                onPress={() => void pickCurrentLocation()}
              />
              <TextInput
                accessibilityLabel="Base latitude"
                placeholder="Approximate base latitude"
                keyboardType="decimal-pad"
                value={form.latitude}
                onChangeText={(value) => patch({ latitude: value })}
                style={[
                  serviceStyles.input,
                  { color: theme.text, borderColor: theme.border },
                ]}
              />
              <TextInput
                accessibilityLabel="Base longitude"
                placeholder="Approximate base longitude"
                keyboardType="decimal-pad"
                value={form.longitude}
                onChangeText={(value) => patch({ longitude: value })}
                style={[
                  serviceStyles.input,
                  { color: theme.text, borderColor: theme.border },
                ]}
              />
              <TextInput
                accessibilityLabel="Service radius"
                placeholder="Service radius in km (1–300)"
                keyboardType="decimal-pad"
                value={form.radiusKm}
                onChangeText={(value) => patch({ radiusKm: value })}
                style={[
                  serviceStyles.input,
                  { color: theme.text, borderColor: theme.border },
                ]}
              />
              {error ? (
                <ThemedText
                  accessibilityRole="alert"
                  style={{ color: BrandColors.error }}
                >
                  {error}
                </ThemedText>
              ) : null}
              <PrimaryButton
                label="Save provider profile"
                loading={saving}
                onPress={() => void save()}
              />
              <ThemedText type="small" themeColor="textSecondary">
                After saving, review your profile and submit it for
                administrator approval. Registration is free.
              </ThemedText>
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = {
  categories: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: Spacing.two,
  },
  category: {
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    padding: Spacing.two,
  },
  serviceGroup: { gap: Spacing.two },
  coordinatePair: { flexDirection: "row" as const, gap: Spacing.two },
  flex: { flex: 1 },
  error: { marginTop: Spacing.three },
};
