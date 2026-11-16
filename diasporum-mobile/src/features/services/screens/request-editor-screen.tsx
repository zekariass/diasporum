import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
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
import {
  uploadServiceRequestImage,
  type ServiceImageSelection,
} from "../services/service-media";
import type {
  ServiceCategory,
  ServiceRequestInput,
} from "../types/service-marketplace-types";
import {
  Card,
  LeadMarketplaceNotice,
  ScreenHeader,
  SectionLabel,
  SelectField,
  serviceStyles,
} from "../components/service-ui";
import { categoryVisual } from "../utils/category-visuals";
import {
  childrenOf,
  isLeafCategory,
  leafDescendants,
  rootCategory,
} from "../utils/category-tree";
import {
  WizardFieldLabel,
  WizardGrid,
  WizardGridItem,
  WizardImageCard,
  WizardOptionRow,
  WizardQuestion,
  WizardScaffold,
  WizardStepTransition,
  WizardSummaryRow,
} from "../components/service-wizard";

export const MAX_REQUEST_IMAGES = 5;

export interface RequestFormState {
  parentCategoryId: string;
  categoryId: string;
  addressId: string;
  latitude: string;
  longitude: string;
  title: string;
  description: string;
  budgetMin: string;
  budgetMax: string;
  currencyCode: string;
  preferredDate: string;
  expiresAt: string;
  mediaIds: string[];
}

export function validateRequestForm(form: RequestFormState): string | null {
  if (!form.parentCategoryId) return "Select a service category.";
  if (!form.categoryId) return "Select a service under the category.";
  if (!form.title.trim() || !form.description.trim())
    return "Add a title and clear description.";
  const locationError = validateRequestLocation(form);
  if (locationError) return locationError;
  const budgetError = validateRequestBudget(form);
  if (budgetError) return budgetError;
  if (form.mediaIds.length > MAX_REQUEST_IMAGES)
    return "A request can contain at most five images.";
  return null;
}

function validateRequestLocation(form: RequestFormState): string | null {
  const latitude = Number(form.latitude);
  const longitude = Number(form.longitude);
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return "Provide a valid approximate request location.";
  }
  return null;
}

function validateRequestBudget(form: RequestFormState): string | null {
  const hasBudget = Boolean(form.budgetMin.trim() || form.budgetMax.trim());
  if (hasBudget && !/^[A-Za-z]{3}$/.test(form.currencyCode))
    return "Add a three-letter budget currency.";
  if (!hasBudget && form.currencyCode.trim())
    return "Remove the currency or add a budget.";
  if (
    form.budgetMin &&
    form.budgetMax &&
    Number(form.budgetMin) > Number(form.budgetMax)
  ) {
    return "Minimum budget cannot exceed maximum budget.";
  }
  if (form.preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.preferredDate))
    return "Use preferred date format YYYY-MM-DD.";
  if (form.expiresAt && Number.isNaN(Date.parse(form.expiresAt)))
    return "Use a valid ISO expiry date/time.";
  return null;
}

export function toRequestInput(
  form: RequestFormState,
  countryId: string,
): ServiceRequestInput {
  const hasBudget = Boolean(form.budgetMin.trim() || form.budgetMax.trim());
  return {
    serviceCategoryId: form.categoryId,
    countryId,
    ...(form.addressId.trim() ? { addressId: form.addressId.trim() } : {}),
    latitude: Number(form.latitude),
    longitude: Number(form.longitude),
    title: form.title.trim(),
    description: form.description.trim(),
    ...(form.budgetMin.trim() ? { budgetMin: Number(form.budgetMin) } : {}),
    ...(form.budgetMax.trim() ? { budgetMax: Number(form.budgetMax) } : {}),
    ...(hasBudget ? { currencyCode: form.currencyCode.toUpperCase() } : {}),
    ...(form.preferredDate ? { preferredDate: form.preferredDate } : {}),
    ...(form.expiresAt
      ? { expiresAt: new Date(form.expiresAt).toISOString() }
      : {}),
    mediaIds: form.mediaIds,
  };
}

const WIZARD_STEPS = [
  "Category",
  "Service",
  "Details",
  "Location",
  "Budget",
  "Photos",
  "Review",
] as const;

export default function RequestEditorScreen() {
  const { id, categoryId, serviceId, latitude, longitude } =
    useLocalSearchParams<{
      id?: string;
      categoryId?: string;
      serviceId?: string;
      latitude?: string;
      longitude?: string;
    }>();
  const router = useRouter();
  const theme = useTheme();
  const { apiClient, session } = useSession();
  const api = useMemo(
    () => createServiceMarketplaceApi(apiClient),
    [apiClient],
  );
  const [form, setForm] = useState<RequestFormState>({
    parentCategoryId: categoryId ?? "",
    categoryId: serviceId ?? "",
    addressId: "",
    latitude: latitude ?? "",
    longitude: longitude ?? "",
    title: "",
    description: "",
    budgetMin: "",
    budgetMax: "",
    currencyCode: "",
    preferredDate: "",
    expiresAt: "",
    mediaIds: [],
  });
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [pendingImages, setPendingImages] = useState<ServiceImageSelection[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishedEdit, setPublishedEdit] = useState(false);
  const [requestCountryId, setRequestCountryId] = useState("");
  // Deep links can preselect the service — skip past those wizard steps.
  const [step, setStep] = useState(() =>
    !id && serviceId ? 2 : !id && categoryId ? 1 : 0,
  );
  const [direction, setDirection] = useState<1 | -1>(1);
  // Wizard step 1 browses the hierarchy — tracks which node is expanded.
  const [browseParentId, setBrowseParentId] = useState("");
  const countryId = session?.profile?.currentCountryId ?? "";

  useEffect(() => {
    let active = true;
    Promise.all([
      api.categories(),
      id ? api.request(id) : Promise.resolve(null),
    ])
      .then(([loaded, request]) => {
        if (!active) return;
        setCategories(loaded);
        if (request) {
          const selected = loaded.find(
            (item) => item.id === request.serviceCategoryId,
          );
          setForm({
            parentCategoryId: selected
              ? rootCategory(selected, loaded).id
              : request.serviceCategoryId,
            categoryId: request.serviceCategoryId,
            addressId: request.addressId ?? "",
            latitude: String(request.latitude),
            longitude: String(request.longitude),
            title: request.title,
            description: request.description,
            budgetMin: String(request.budgetMin ?? ""),
            budgetMax: String(request.budgetMax ?? ""),
            currencyCode: request.currencyCode ?? "",
            preferredDate: request.preferredDate ?? "",
            expiresAt: request.expiresAt ?? "",
            mediaIds: request.mediaIds,
          });
          setRequestCountryId(request.countryId);
          setPublishedEdit(
            request.status === "OPEN" || request.status === "PAUSED",
          );
        }
        setError(null);
      })
      .catch((cause) => {
        if (active)
          setError(
            ApiError.isApiError(cause)
              ? cause.userMessage
              : "Could not load service categories or request.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, id]);

  function patch(value: Partial<RequestFormState>) {
    setForm((current) => ({ ...current, ...value }));
  }

  const parentCategories = categories.filter(
    (category) => category.parentId == null,
  );
  const selectedParent =
    categories.find((item) => item.id === form.parentCategoryId) ?? null;
  const serviceOptions = selectedParent
    ? leafDescendants(selectedParent, categories).length
      ? leafDescendants(selectedParent, categories)
      : [selectedParent]
    : [];
  // Cascade state for the wizard: which hierarchy node is being browsed.
  const browseParent =
    categories.find((item) => item.id === browseParentId) ?? selectedParent;
  const browseItems = browseParent
    ? childrenOf(browseParent.id, categories)
    : [];
  const browseOptions = browseItems.length
    ? browseItems
    : browseParent
      ? [browseParent]
      : [];
  const browsedDeep =
    browseParent != null && browseParent.id !== form.parentCategoryId;
  const browseCrumb = browsedDeep
    ? categories.find((item) => item.id === browseParent?.parentId)
    : null;
  const selectedService =
    categories.find((item) => item.id === form.categoryId) ?? null;
  const imageCount = form.mediaIds.length + pendingImages.length;

  async function pickCurrentLocation() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setError(
        "Location permission was denied. Enter approximate coordinates instead.",
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
      setError("Location is unavailable. Enter approximate coordinates.");
    }
  }

  async function pickImage() {
    if (form.mediaIds.length + pendingImages.length >= MAX_REQUEST_IMAGES) {
      setError("A request can contain at most five images.");
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo library permission is needed to attach an image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    setPendingImages((current) => [
      ...current,
      {
        uri: asset.uri,
        mimeType: asset.mimeType ?? "image/jpeg",
        size: asset.fileSize ?? 0,
      },
    ]);
  }

  async function save() {
    const validation = validateRequestForm(form);
    const effectiveCountryId = requestCountryId || countryId;
    if (validation || !effectiveCountryId) {
      setError(
        validation ??
          "Your profile needs a current country before creating a request.",
      );
      return;
    }
    setSaving(true);
    setError(null);
    const uploaded: string[] = [];
    try {
      for (const selection of pendingImages)
        uploaded.push(await uploadServiceRequestImage(apiClient, selection));
      const input = toRequestInput(
        { ...form, mediaIds: [...form.mediaIds, ...uploaded] },
        effectiveCountryId,
      );
      const request = id
        ? await api.updateRequest(id, input)
        : await api.createRequest(input);
      router.replace(`/(app)/services/requests/${request.id}` as never);
    } catch (cause) {
      await Promise.all(
        uploaded.map((mediaId) =>
          apiClient
            .delete(`/api/v1/media/${mediaId}`, { authenticated: true })
            .catch(() => undefined),
        ),
      );
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "Could not save the request. Uploads were rolled back.",
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
        return Boolean(form.parentCategoryId);
      case 1:
        return Boolean(form.categoryId);
      case 2:
        return Boolean(form.title.trim() && form.description.trim());
      case 3:
        return validateRequestLocation(form) == null;
      case 4:
        return validateRequestBudget(form) == null;
      case 5:
        return form.mediaIds.length + pendingImages.length <= MAX_REQUEST_IMAGES;
      case 6:
        return validateRequestForm(form) == null;
      default:
        return false;
    }
  }, [form, id, pendingImages.length, step]);

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

  function wizardStep() {
    switch (step) {
      case 0:
        return (
          <>
            <WizardQuestion
              icon="grid-outline"
              title="What kind of service do you need?"
              description="Choose the category that best fits your job."
            />
            <WizardGrid>
              {parentCategories.map((category, index) => {
                const visual = categoryVisual(category, categories);
                return (
                  <WizardGridItem
                    key={category.id}
                    wide={index === parentCategories.length - 1 && index % 2 === 0}
                  >
                    <WizardImageCard
                      label={category.displayName}
                      hint={category.description ?? undefined}
                      image={visual.image}
                      icon={visual.icon}
                      tint={visual.tint}
                      selected={form.parentCategoryId === category.id}
                      onPress={() => {
                        patch({
                          parentCategoryId: category.id,
                          categoryId: "",
                        });
                        setBrowseParentId(category.id);
                      }}
                    />
                  </WizardGridItem>
                );
              })}
            </WizardGrid>
            {!parentCategories.length ? (
              <ThemedText type="small" themeColor="textSecondary">
                No service categories available yet.
              </ThemedText>
            ) : null}
          </>
        );
      case 1:
        return (
          <>
            <WizardQuestion
              icon="list-outline"
              title={`What ${browseParent?.displayName ?? "service"} do you need?`}
              description={
                browsedDeep
                  ? "Narrow it down or pick the service that matches your job."
                  : "Pick the service that best matches your job."
              }
            />
            {browsedDeep && browseParent ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Back to ${browseCrumb?.displayName ?? "categories"}`}
                onPress={() =>
                  setBrowseParentId(browseParent.parentId ?? "")
                }
                style={styles.browseBack}
              >
                <Ionicons
                  name="chevron-back"
                  size={16}
                  color={BrandColors.primary}
                />
                <ThemedText type="smallBold" style={styles.browseBackText}>
                  {browseCrumb?.displayName ?? "All categories"}
                </ThemedText>
              </Pressable>
            ) : null}
            <View style={styles.optionRows}>
              {browseOptions.map((service) => {
                const visual = categoryVisual(service, categories);
                const nested = !isLeafCategory(service, categories);
                return (
                  <WizardOptionRow
                    key={service.id}
                    label={service.displayName}
                    hint={service.description ?? undefined}
                    icon={visual.icon}
                    selected={!nested && form.categoryId === service.id}
                    drill={nested}
                    onPress={() =>
                      nested
                        ? setBrowseParentId(service.id)
                        : patch({ categoryId: service.id })
                    }
                  />
                );
              })}
            </View>
            {!browseOptions.length ? (
              <ThemedText type="small" themeColor="textSecondary">
                No services under this category.
              </ThemedText>
            ) : null}
          </>
        );
      case 2:
        return (
          <>
            <WizardQuestion
              icon="create-outline"
              title="Describe the job"
              description="Pros respond faster to requests with a clear title and scope."
            />
            <FormInput
              label="Request title"
              placeholder="What service do you need?"
              value={form.title}
              onChangeText={(value) => patch({ title: value })}
              maxLength={160}
              required
            />
            <FormInput
              label="Request description"
              placeholder="Describe scope, timing, and important details"
              value={form.description}
              onChangeText={(value) => patch({ description: value })}
              multiline
              numberOfLines={5}
              maxLength={6000}
              required
            />
          </>
        );
      case 3:
        return (
          <>
            <WizardQuestion
              icon="location-outline"
              title="Where is the job?"
              description="Only an approximate area is shared with providers until you share contact details."
            />
            <PrimaryButton
              label="Use approximate current location"
              variant="secondary"
              onPress={() => void pickCurrentLocation()}
            />
            <View style={styles.coordinatePair}>
              <View style={styles.flex}>
                <FormInput
                  label="Latitude"
                  placeholder="Approximate latitude"
                  keyboardType="decimal-pad"
                  value={form.latitude}
                  onChangeText={(value) => patch({ latitude: value })}
                  required
                />
              </View>
              <View style={styles.flex}>
                <FormInput
                  label="Longitude"
                  placeholder="Approximate longitude"
                  keyboardType="decimal-pad"
                  value={form.longitude}
                  onChangeText={(value) => patch({ longitude: value })}
                  required
                />
              </View>
            </View>
            <FormInput
              label="Private address ID"
              placeholder="Optional"
              autoCapitalize="none"
              value={form.addressId}
              onChangeText={(value) => patch({ addressId: value })}
              hint="Only used for city and contact-details unlock; never shown publicly."
            />
          </>
        );
      case 4:
        return (
          <>
            <WizardQuestion
              icon="wallet-outline"
              title="Budget & timing"
              description="Optional — a rough range helps pros price your job. All fields can stay empty."
            />
            <View style={styles.coordinatePair}>
              <View style={styles.flex}>
                <FormInput
                  label="Minimum budget"
                  placeholder="Optional"
                  keyboardType="decimal-pad"
                  value={form.budgetMin}
                  onChangeText={(value) => patch({ budgetMin: value })}
                />
              </View>
              <View style={styles.flex}>
                <FormInput
                  label="Maximum budget"
                  placeholder="Optional"
                  keyboardType="decimal-pad"
                  value={form.budgetMax}
                  onChangeText={(value) => patch({ budgetMax: value })}
                />
              </View>
            </View>
            <FormInput
              label="Budget currency"
              placeholder="e.g. USD"
              autoCapitalize="characters"
              maxLength={3}
              value={form.currencyCode}
              onChangeText={(value) => patch({ currencyCode: value })}
            />
            <FormInput
              label="Preferred date"
              placeholder="YYYY-MM-DD (optional)"
              value={form.preferredDate}
              onChangeText={(value) => patch({ preferredDate: value })}
            />
            <FormInput
              label="Expiry date"
              placeholder="ISO date/time (optional)"
              value={form.expiresAt}
              onChangeText={(value) => patch({ expiresAt: value })}
            />
          </>
        );
      case 5:
        return (
          <>
            <WizardQuestion
              icon="images-outline"
              title="Add photos"
              description={`Optional — up to ${MAX_REQUEST_IMAGES} images help pros understand the job.`}
            />
            <WizardFieldLabel
              label={`Photos · ${imageCount} of ${MAX_REQUEST_IMAGES}`}
            />
            <View style={styles.images}>
              {pendingImages.map((image, index) => (
                <View key={image.uri} style={styles.previewWrap}>
                  <Image
                    source={{ uri: image.uri }}
                    style={styles.preview}
                    accessibilityLabel={`Pending image ${index + 1}`}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove pending image ${index + 1}`}
                    onPress={() =>
                      setPendingImages((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                    style={styles.previewRemove}
                  >
                    <Ionicons
                      name="close"
                      size={14}
                      color={BrandColors.white}
                    />
                  </Pressable>
                </View>
              ))}
              {imageCount < MAX_REQUEST_IMAGES ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add request image"
                  onPress={() => void pickImage()}
                  style={[styles.addTile, { borderColor: theme.border }]}
                >
                  <Ionicons
                    name="camera-outline"
                    size={22}
                    color={BrandColors.primary}
                  />
                  <ThemedText
                    type="small"
                    style={{ color: BrandColors.primary }}
                  >
                    Add
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
            {form.mediaIds.map((mediaId) => (
              <Pressable
                key={mediaId}
                accessibilityRole="button"
                accessibilityLabel="Remove attached image"
                onPress={() =>
                  patch({
                    mediaIds: form.mediaIds.filter((item) => item !== mediaId),
                  })
                }
                style={styles.attachedRow}
              >
                <Ionicons
                  name="image-outline"
                  size={16}
                  color={theme.textSecondary}
                />
                <ThemedText type="small" style={styles.attachedLabel}>
                  Attached image {mediaId.slice(0, 8)}
                </ThemedText>
                <ThemedText type="smallBold" style={{ color: BrandColors.error }}>
                  Remove
                </ThemedText>
              </Pressable>
            ))}
          </>
        );
      case 6:
        return (
          <>
            <WizardQuestion
              icon="checkmark-circle-outline"
              title="Review your request"
              description="Posting creates a draft first — publish when you're ready."
            />
            <Card>
              <WizardSummaryRow
                icon="grid-outline"
                label="Category"
                value={selectedParent?.displayName ?? "—"}
              />
              <WizardSummaryRow
                icon="list-outline"
                label="Service"
                value={selectedService?.displayName ?? "—"}
              />
              <WizardSummaryRow
                icon="create-outline"
                label="Title"
                value={form.title || "—"}
              />
              <WizardSummaryRow
                icon="location-outline"
                label="Location"
                value={`${form.latitude || "—"}, ${form.longitude || "—"}`}
              />
              <WizardSummaryRow
                icon="wallet-outline"
                label="Budget"
                value={
                  form.budgetMin || form.budgetMax
                    ? `${form.budgetMin || "—"} – ${form.budgetMax || "—"} ${form.currencyCode.toUpperCase()}`
                    : "Not specified"
                }
              />
              <WizardSummaryRow
                icon="images-outline"
                label="Photos"
                value={`${imageCount}`}
              />
            </Card>
            <ThemedText type="small" themeColor="textSecondary">
              Draft creation is free. Publishing uses one SERVICE_JOB_POST quota
              unit.
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
          {loading ? (
            <LoadingScreen />
          ) : (
            <WizardScaffold
              step={step}
              total={WIZARD_STEPS.length}
              title="Request a service"
              onBack={goBack}
              canContinue={canContinue}
              continueLabel={
                step === WIZARD_STEPS.length - 1 ? "Create request" : "Continue"
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
          )}
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={serviceStyles.root}>
      <SafeAreaView style={serviceStyles.root} edges={["top", "left", "right"]}>
        <ScreenHeader back title="Edit request" />
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
              {publishedEdit ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Category, country, approximate location, and private address
                  are fixed after publication.
                </ThemedText>
              ) : null}

              <SectionLabel label="Service needed" />
              <Card>
                <SelectField
                  label="Service category"
                  required
                  placeholder="Choose a category"
                  value={
                    selectedParent
                      ? {
                          id: selectedParent.id,
                          label: selectedParent.displayName,
                          description: selectedParent.description,
                        }
                      : null
                  }
                  options={parentCategories.map((category) => ({
                    id: category.id,
                    label: category.displayName,
                    description: category.description,
                  }))}
                  onSelect={(option) =>
                    patch({ parentCategoryId: option.id, categoryId: "" })
                  }
                  disabled={publishedEdit}
                  emptyText="No service categories available yet"
                />
                <SelectField
                  label="Service"
                  required
                  placeholder={
                    form.parentCategoryId
                      ? "Choose a service"
                      : "Select a category first"
                  }
                  value={
                    selectedService
                      ? {
                          id: selectedService.id,
                          label: selectedService.displayName,
                          description: selectedService.description,
                        }
                      : null
                  }
                  options={serviceOptions.map((service) => ({
                    id: service.id,
                    label: service.displayName,
                    description: service.description,
                  }))}
                  onSelect={(option) => patch({ categoryId: option.id })}
                  disabled={publishedEdit || !form.parentCategoryId}
                  emptyText="No services under this category"
                />
                <FormInput
                  label="Request title"
                  placeholder="What service do you need?"
                  value={form.title}
                  onChangeText={(value) => patch({ title: value })}
                  maxLength={160}
                />
                <FormInput
                  label="Request description"
                  placeholder="Describe scope, timing, and important details"
                  value={form.description}
                  onChangeText={(value) => patch({ description: value })}
                  multiline
                  numberOfLines={4}
                  maxLength={6000}
                />
              </Card>

              <SectionLabel label="Location" />
              <Card>
                {publishedEdit ? null : (
                  <PrimaryButton
                    label="Use approximate current location"
                    variant="secondary"
                    onPress={() => void pickCurrentLocation()}
                  />
                )}
                <FormInput
                  label="Request latitude"
                  placeholder="Approximate latitude"
                  keyboardType="decimal-pad"
                  editable={!publishedEdit}
                  value={form.latitude}
                  onChangeText={(value) => patch({ latitude: value })}
                />
                <FormInput
                  label="Request longitude"
                  placeholder="Approximate longitude"
                  keyboardType="decimal-pad"
                  editable={!publishedEdit}
                  value={form.longitude}
                  onChangeText={(value) => patch({ longitude: value })}
                />
                <FormInput
                  label="Private address ID"
                  placeholder="Optional"
                  autoCapitalize="none"
                  editable={!publishedEdit}
                  value={form.addressId}
                  onChangeText={(value) => patch({ addressId: value })}
                  hint="Only used for city and contact-details unlock; never shown publicly."
                />
              </Card>

              <SectionLabel label="Budget & timing" />
              <Card>
                <FormInput
                  label="Minimum budget"
                  placeholder="Optional"
                  keyboardType="decimal-pad"
                  value={form.budgetMin}
                  onChangeText={(value) => patch({ budgetMin: value })}
                />
                <FormInput
                  label="Maximum budget"
                  placeholder="Optional"
                  keyboardType="decimal-pad"
                  value={form.budgetMax}
                  onChangeText={(value) => patch({ budgetMax: value })}
                />
                <FormInput
                  label="Budget currency"
                  placeholder="e.g. USD"
                  autoCapitalize="characters"
                  maxLength={3}
                  value={form.currencyCode}
                  onChangeText={(value) => patch({ currencyCode: value })}
                />
                <FormInput
                  label="Preferred date"
                  placeholder="YYYY-MM-DD (optional)"
                  value={form.preferredDate}
                  onChangeText={(value) => patch({ preferredDate: value })}
                />
                <FormInput
                  label="Expiry date"
                  placeholder="ISO date/time (optional)"
                  value={form.expiresAt}
                  onChangeText={(value) => patch({ expiresAt: value })}
                />
              </Card>

              <SectionLabel label={`Photos · ${imageCount} of ${MAX_REQUEST_IMAGES}`} />
              <Card>
                <View style={styles.images}>
                  {pendingImages.map((image, index) => (
                    <View key={image.uri} style={styles.previewWrap}>
                      <Image
                        source={{ uri: image.uri }}
                        style={styles.preview}
                        accessibilityLabel={`Pending image ${index + 1}`}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove pending image ${index + 1}`}
                        onPress={() =>
                          setPendingImages((current) =>
                            current.filter((_, i) => i !== index),
                          )
                        }
                        style={styles.previewRemove}
                      >
                        <Ionicons
                      name="close"
                      size={14}
                      color={BrandColors.white}
                    />
                      </Pressable>
                    </View>
                  ))}
                  {imageCount < MAX_REQUEST_IMAGES ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Add request image"
                      onPress={() => void pickImage()}
                      style={[
                        styles.addTile,
                        { borderColor: theme.border },
                      ]}
                    >
                      <Ionicons
                        name="camera-outline"
                        size={22}
                        color={BrandColors.primary}
                      />
                      <ThemedText
                        type="small"
                        style={{ color: BrandColors.primary }}
                      >
                        Add
                      </ThemedText>
                    </Pressable>
                  ) : null}
                </View>
                {form.mediaIds.map((mediaId) => (
                  <Pressable
                    key={mediaId}
                    accessibilityRole="button"
                    accessibilityLabel="Remove attached image"
                    onPress={() =>
                      patch({
                        mediaIds: form.mediaIds.filter(
                          (item) => item !== mediaId,
                        ),
                      })
                    }
                    style={styles.attachedRow}
                  >
                    <Ionicons
                      name="image-outline"
                      size={16}
                      color={theme.textSecondary}
                    />
                    <ThemedText type="small" style={styles.attachedLabel}>
                      Attached image {mediaId.slice(0, 8)}
                    </ThemedText>
                    <ThemedText
                      type="smallBold"
                      style={{ color: BrandColors.error }}
                    >
                      Remove
                    </ThemedText>
                  </Pressable>
                ))}
              </Card>
              {error ? (
                <ThemedText
                  accessibilityRole="alert"
                  style={{ color: BrandColors.error }}
                >
                  {error}
                </ThemedText>
              ) : null}
              <PrimaryButton
                label="Save changes"
                loading={saving}
                onPress={() => void save()}
              />
              <ThemedText type="small" themeColor="textSecondary">
                {publishedEdit
                  ? "Safe edits do not use another SERVICE_JOB_POST quota unit."
                  : "Draft creation is free. Publishing uses one SERVICE_JOB_POST quota unit."}
              </ThemedText>
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  images: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  optionRows: { gap: Spacing.two },
  browseBack: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: -Spacing.two,
    marginBottom: Spacing.two,
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  browseBackText: { color: BrandColors.primary },
  coordinatePair: { flexDirection: "row", gap: Spacing.two },
  flex: { flex: 1 },
  error: { marginTop: Spacing.three },
  previewWrap: { position: "relative" },
  preview: { width: 96, height: 96, borderRadius: BorderRadius.md },
  previewRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  addTile: {
    width: 96,
    height: 96,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  attachedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  attachedLabel: { flex: 1 },
});
