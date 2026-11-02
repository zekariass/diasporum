import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ApiError } from "@/core/api/api-error";
import { useSession } from "@/core/session/session-provider";
import { createBusinessApi } from "@/features/business/services/business-api";
import { createCommunityApi } from "@/features/communities/services/community-api";
import type { CommunityView } from "@/features/communities/types/community-types";
import type { BusinessAccount } from "@/features/business/types/business-types";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { PrimaryButton } from "@/shared/components/primary-button";
import { Spacing } from "@/shared/theme/spacing";
import {
  DirectoryChip,
  DirectoryField,
  DirectoryHeader,
  DirectoryInput,
  DirectoryMessage,
} from "../components/directory-ui";
import { createDirectoryApi } from "../services/directory-api";
import type {
  BusinessCategory,
  BusinessRequest,
  VisibilityScope,
} from "../types/directory-types";

export interface BusinessFormState {
  name: string;
  description: string;
  categoryId: string | null;
  phone: string;
  email: string;
  websiteUrl: string;
  visibilityScope: VisibilityScope;
  communityId: string | null;
  selectedCommunityIds: string[];
  businessAccountId: string | null;
}

export function emptyBusinessForm(accountId?: string): BusinessFormState {
  return {
    name: "",
    description: "",
    categoryId: null,
    phone: "",
    email: "",
    websiteUrl: "",
    visibilityScope: "COUNTRY",
    communityId: null,
    selectedCommunityIds: [],
    businessAccountId: accountId ?? null,
  };
}

export function validateBusinessForm(
  state: BusinessFormState,
  editing: boolean,
  selectedCommunitiesChanged: boolean,
): string | null {
  if (!state.name.trim()) return "Enter a business name.";
  if (!state.description.trim()) return "Enter a public description.";
  if (!state.categoryId) return "Choose a business category.";
  if (
    state.phone.trim() &&
    !/^\+?[0-9][0-9 ()-]{6,24}$/.test(state.phone.trim())
  ) {
    return "Enter a valid phone number, including the country code when possible.";
  }
  if (
    state.email.trim() &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email.trim())
  ) {
    return "Enter a valid email address.";
  }
  if (
    state.websiteUrl.trim() &&
    !/^https?:\/\/[^\s/]+\.[^\s/]+(?:\/\S*)?$/i.test(state.websiteUrl.trim())
  ) {
    return "The website must be a complete http:// or https:// URL.";
  }
  if (state.visibilityScope === "COMMUNITY" && !state.communityId) {
    return "Choose the community that can see this profile.";
  }
  if (
    state.visibilityScope === "SELECTED_COMMUNITIES" &&
    (!editing || selectedCommunitiesChanged) &&
    state.selectedCommunityIds.length === 0
  ) {
    return "Choose at least one community.";
  }
  return null;
}

export default function BusinessFormScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    businessId?: string;
    accountId?: string;
  }>();
  const editing = Boolean(params.businessId);
  const { apiClient, session } = useSession();
  const api = React.useMemo(() => createDirectoryApi(apiClient), [apiClient]);
  const [state, setState] = useState<BusinessFormState>(() =>
    emptyBusinessForm(params.accountId),
  );
  const [categories, setCategories] = useState<BusinessCategory[]>([]);
  const [accounts, setAccounts] = useState<BusinessAccount[]>([]);
  const [communities, setCommunities] = useState<CommunityView[]>([]);
  const [selectedChanged, setSelectedChanged] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const countryId = session?.profile?.currentCountryId ?? undefined;
  const memberships = session?.memberships ?? [];

  useEffect(() => {
    api
      .categories(countryId)
      .then((result) => setCategories(result.items))
      .catch((cause) =>
        setError(
          ApiError.isApiError(cause)
            ? cause.userMessage
            : "Could not load business categories.",
        ),
      );
    createCommunityApi(apiClient)
      .availableCommunities()
      .then((result) => setCommunities(result.items))
      .catch(() => setCommunities([]));
    if (!editing) {
      createBusinessApi(apiClient)
        .accounts()
        .then((result) =>
          setAccounts(
            result.items.filter(
              (account) =>
                account.status === "ACTIVE" &&
                ["OWNER", "ADMINISTRATOR", "EDITOR"].includes(account.role),
            ),
          ),
        )
        .catch(() => setAccounts([]));
    }
  }, [api, apiClient, countryId, editing]);

  useEffect(() => {
    if (!params.businessId) return;
    api
      .detail(params.businessId)
      .then((detail) => {
        const business = detail.business;
        if (!business.canManage) throw new Error("You cannot edit this profile.");
        setState({
          name: business.name,
          description: business.description,
          categoryId: business.category?.id ?? null,
          phone: business.phone ?? "",
          email: business.email ?? "",
          websiteUrl: business.websiteUrl ?? "",
          visibilityScope: business.visibilityScope,
          communityId: business.communityId,
          selectedCommunityIds: [],
          businessAccountId: null,
        });
        setError(null);
      })
      .catch((cause) =>
        setError(
          ApiError.isApiError(cause)
            ? cause.userMessage
            : cause instanceof Error
              ? cause.message
              : "Could not load this business profile.",
        ),
      )
      .finally(() => setLoading(false));
  }, [api, params.businessId]);

  const patch = (value: Partial<BusinessFormState>) =>
    setState((previous) => ({ ...previous, ...value }));

  const submit = async () => {
    if (submittingRef.current) return;
    const validation = validateBusinessForm(state, editing, selectedChanged);
    if (validation) {
      setError(validation);
      return;
    }
    if (!editing && !countryId) {
      setError("Complete your current-country profile before creating a business.");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    const request: BusinessRequest = {
      ...(!editing ? { countryId } : {}),
      ...(!editing && state.businessAccountId
        ? { businessAccountId: state.businessAccountId }
        : {}),
      categoryId: state.categoryId as string,
      name: state.name.trim(),
      description: state.description.trim(),
      phone: state.phone.trim(),
      email: state.email.trim(),
      websiteUrl: state.websiteUrl.trim(),
      visibilityScope: state.visibilityScope,
      ...(state.visibilityScope === "COMMUNITY" && state.communityId
        ? { communityId: state.communityId }
        : {}),
      ...(state.visibilityScope === "SELECTED_COMMUNITIES" &&
      (!editing || selectedChanged)
        ? { selectedCommunityIds: state.selectedCommunityIds }
        : {}),
    };
    try {
      const business = editing
        ? await api.update(params.businessId as string, request)
        : await api.create(request);
      if (editing) {
        router.back();
      } else {
        router.replace(`/(app)/businesses/${business.id}/manage` as never);
      }
    } catch (cause) {
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "Could not save this business profile.",
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingScreen />;

  const memberIds = new Set(
    memberships.filter((member) => member.status === "ACTIVE").map((m) => m.communityId),
  );
  const selectableCommunities = communities.filter((community) =>
    memberIds.has(community.id),
  );

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <DirectoryHeader title={editing ? "Edit business" : "Create business"} />
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText style={styles.intro} themeColor="textSecondary">
            {editing
              ? "Update the public directory information. Publication and verification are managed separately."
              : "Create a draft public profile. It will not appear in discovery until you publish it."}
          </ThemedText>

          {!editing ? (
            <DirectoryField
              label="Profile owner"
              hint="A Business Account can manage multiple public profiles. Your personal login remains unchanged."
            >
              <View style={styles.chips}>
                <DirectoryChip
                  label="Personal profile"
                  active={state.businessAccountId === null}
                  onPress={() => patch({ businessAccountId: null })}
                />
                {accounts.map((account) => (
                  <DirectoryChip
                    key={account.id}
                    label={account.accountName}
                    active={state.businessAccountId === account.id}
                    onPress={() => patch({ businessAccountId: account.id })}
                  />
                ))}
              </View>
            </DirectoryField>
          ) : null}

          <DirectoryField label="Business name">
            <DirectoryInput
              label="Business name"
              value={state.name}
              onChangeText={(name) => patch({ name })}
              placeholder="Public business name"
              maxLength={180}
            />
          </DirectoryField>
          <DirectoryField label="Description">
            <DirectoryInput
              label="Description"
              value={state.description}
              onChangeText={(description) => patch({ description })}
              placeholder="What does this business offer?"
              multiline
              maxLength={8000}
            />
          </DirectoryField>
          <DirectoryField label="Category">
            <View style={styles.chips}>
              {categories.map((category) => (
                <DirectoryChip
                  key={category.id}
                  label={category.name}
                  active={state.categoryId === category.id}
                  onPress={() => patch({ categoryId: category.id })}
                />
              ))}
            </View>
            {categories.length === 0 ? (
              <DirectoryMessage>
                No active categories are available for your country yet.
              </DirectoryMessage>
            ) : null}
          </DirectoryField>
          <DirectoryField label="Phone (optional)">
            <DirectoryInput
              label="Phone (optional)"
              value={state.phone}
              onChangeText={(phone) => patch({ phone })}
              placeholder="+49 30 1234567"
              keyboardType="phone-pad"
              autoCapitalize="none"
              maxLength={30}
            />
          </DirectoryField>
          <DirectoryField label="Email (optional)">
            <DirectoryInput
              label="Email (optional)"
              value={state.email}
              onChangeText={(email) => patch({ email })}
              placeholder="hello@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              maxLength={320}
            />
          </DirectoryField>
          <DirectoryField label="Website (optional)">
            <DirectoryInput
              label="Website (optional)"
              value={state.websiteUrl}
              onChangeText={(websiteUrl) => patch({ websiteUrl })}
              placeholder="https://example.com"
              keyboardType="url"
              autoCapitalize="none"
              maxLength={2000}
            />
          </DirectoryField>

          <DirectoryField label="Who can see this profile?">
            <View style={styles.chips}>
              <DirectoryChip
                label="Whole country"
                active={state.visibilityScope === "COUNTRY"}
                onPress={() => patch({ visibilityScope: "COUNTRY" })}
              />
              <DirectoryChip
                label="One community"
                active={state.visibilityScope === "COMMUNITY"}
                onPress={() => patch({ visibilityScope: "COMMUNITY" })}
              />
              <DirectoryChip
                label="Selected communities"
                active={state.visibilityScope === "SELECTED_COMMUNITIES"}
                onPress={() => {
                  if (state.visibilityScope !== "SELECTED_COMMUNITIES") {
                    setSelectedChanged(true);
                  }
                  patch({ visibilityScope: "SELECTED_COMMUNITIES" });
                }}
              />
            </View>
          </DirectoryField>

          {state.visibilityScope === "COMMUNITY" ? (
            <DirectoryField label="Community">
              <View style={styles.chips}>
                {selectableCommunities.map((community) => (
                  <DirectoryChip
                    key={community.id}
                    label={community.name}
                    active={state.communityId === community.id}
                    onPress={() => patch({ communityId: community.id })}
                  />
                ))}
              </View>
            </DirectoryField>
          ) : null}
          {state.visibilityScope === "SELECTED_COMMUNITIES" ? (
            <DirectoryField
              label="Communities"
              hint={
                editing && !selectedChanged
                  ? "Your existing community selection is preserved until you change it."
                  : "Only members of the selected communities can discover this profile."
              }
            >
              <View style={styles.chips}>
                {selectableCommunities.map((community) => {
                  const active = state.selectedCommunityIds.includes(community.id);
                  return (
                    <DirectoryChip
                      key={community.id}
                      label={community.name}
                      active={active}
                      onPress={() => {
                        setSelectedChanged(true);
                        patch({
                          selectedCommunityIds: active
                            ? state.selectedCommunityIds.filter(
                                (id) => id !== community.id,
                              )
                            : [...state.selectedCommunityIds, community.id],
                        });
                      }}
                    />
                  );
                })}
              </View>
            </DirectoryField>
          ) : null}
          {state.visibilityScope !== "COUNTRY" &&
          selectableCommunities.length === 0 ? (
            <DirectoryMessage>
              No community names could be loaded. You can retry after reconnecting;
              the backend will still validate every selected membership.
            </DirectoryMessage>
          ) : null}

          {error ? <DirectoryMessage error>{error}</DirectoryMessage> : null}
          <PrimaryButton
            label={editing ? "Save business profile" : "Create draft profile"}
            onPress={() => void submit()}
            loading={submitting}
            disabled={submitting}
          />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  content: { padding: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  intro: { fontSize: 13, lineHeight: 19 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
});
