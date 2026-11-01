import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ApiError } from "@/core/api/api-error";
import { safeBack } from "@/core/navigation/safe-back";
import { useSession } from "@/core/session/session-provider";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { PrimaryButton } from "@/shared/components/primary-button";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { useTheme } from "@/hooks/use-theme";
import { createBusinessApi } from "../services/business-api";
import type { BusinessWorkspace } from "../types/business-types";

type IconName = ComponentProps<typeof Ionicons>["name"];

function roleLabel(role: string) {
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function BusinessWorkspaceScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  const { apiClient } = useSession();
  const businessApi = React.useMemo(
    () => createBusinessApi(apiClient),
    [apiClient],
  );
  const [workspace, setWorkspace] = useState<BusinessWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    setError(null);
    try {
      setWorkspace(await businessApi.workspace(accountId));
    } catch (cause) {
      setWorkspace(null);
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "Could not open this Business Workspace.",
      );
    } finally {
      setLoading(false);
    }
  }, [accountId, businessApi]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loading) return <LoadingScreen />;

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={[styles.nav, { borderBottomColor: theme.border }]}>
          <Pressable onPress={safeBack} hitSlop={8} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <ThemedText style={styles.navTitle}>Business Workspace</ThemedText>
          <Pressable
            onPress={() => router.replace("/(app)/business" as never)}
            hitSlop={8}
            accessibilityLabel="Switch Business Account"
          >
            <Ionicons name="swap-horizontal" size={24} color={theme.text} />
          </Pressable>
        </View>

        {error || !workspace ? (
          <View style={styles.errorState}>
            <Ionicons
              name="briefcase-outline"
              size={42}
              color={theme.textSecondary}
            />
            <ThemedText style={styles.errorTitle}>
              Workspace unavailable
            </ThemedText>
            <ThemedText style={styles.errorText} themeColor="textSecondary">
              {error ?? "This Business Account could not be found."}
            </ThemedText>
            <PrimaryButton
              label="Choose another business"
              onPress={() => router.replace("/(app)/business" as never)}
              variant="secondary"
            />
            <PrimaryButton
              label="Try again"
              onPress={() => void load()}
              variant="ghost"
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            <View
              style={[
                styles.hero,
                { backgroundColor: BrandColors.primarySurface },
              ]}
            >
              <View style={styles.heroTop}>
                <View style={styles.accountIcon}>
                  <Ionicons
                    name="briefcase"
                    size={30}
                    color={BrandColors.primary}
                  />
                </View>
                <View style={styles.roleBadge}>
                  <ThemedText style={styles.roleText}>
                    {workspace.role}
                  </ThemedText>
                </View>
              </View>
              <ThemedText style={styles.accountName}>
                {workspace.accountName}
              </ThemedText>
              <ThemedText style={styles.accountMeta}>
                {roleLabel(workspace.role)} · {workspace.profileCount}{" "}
                {workspace.profileCount === 1
                  ? "public profile"
                  : "public profiles"}
              </ThemedText>
              {workspace.status !== "ACTIVE" && (
                <View style={styles.suspendedNotice}>
                  <Ionicons
                    name="alert-circle-outline"
                    size={18}
                    color={BrandColors.warning}
                  />
                  <ThemedText style={styles.suspendedText}>
                    This account is {workspace.status.toLowerCase()}. Management
                    is restricted.
                  </ThemedText>
                </View>
              )}
            </View>

            <View style={styles.switchRow}>
              <PrimaryButton
                label="Switch Business Account"
                onPress={() => router.replace("/(app)/business" as never)}
                variant="secondary"
                style={styles.switchButton}
              />
            </View>

            <ThemedText style={styles.sectionTitle}>Manage business</ThemedText>
            <ThemedText
              style={styles.sectionSubtitle}
              themeColor="textSecondary"
            >
              Sections reflect the capabilities returned by the backend for your
              membership.
            </ThemedText>

            <View style={styles.managementList}>
              <ManagementCard
                visible={workspace.capabilities.manageProfiles}
                icon="storefront-outline"
                title="Business Profiles"
                detail="Public profiles, branches, locations, hours, and media"
              />
              <ManagementCard
                visible={workspace.capabilities.manageListings}
                icon="albums-outline"
                title="Listings"
                detail="Jobs, events, property, vehicles, and business-owned content"
              />
              <ManagementCard
                visible={workspace.capabilities.manageTeam}
                icon="people-outline"
                title="Team"
                detail="Members, invitations, roles, and access"
              />
              <ManagementCard
                visible={workspace.capabilities.manageBilling}
                icon="card-outline"
                title="Billing"
                detail="Business subscription, entitlements, and billing history"
              />
              <ManagementCard
                visible={workspace.capabilities.manageSettings}
                icon="settings-outline"
                title="Settings"
                detail="Business Account information and lifecycle"
              />
            </View>

            <View
              style={[
                styles.integrationNote,
                { backgroundColor: theme.backgroundElement },
              ]}
            >
              <Ionicons
                name="information-circle-outline"
                size={20}
                color={theme.textSecondary}
              />
              <ThemedText
                style={styles.integrationText}
                themeColor="textSecondary"
              >
                These management modules require their dedicated backend APIs.
                No unavailable operation is presented as ready.
              </ThemedText>
            </View>

            <PrimaryButton
              label="Return to Personal Diasporum"
              onPress={() => router.replace("/(app)/(tabs)/profile")}
              variant="ghost"
            />
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function ManagementCard({
  visible,
  icon,
  title,
  detail,
}: {
  visible: boolean;
  icon: IconName;
  title: string;
  detail: string;
}) {
  const theme = useTheme();
  if (!visible) return null;
  return (
    <View
      style={[
        styles.managementCard,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}
    >
      <View style={styles.managementIcon}>
        <Ionicons name={icon} size={23} color={BrandColors.primary} />
      </View>
      <View style={styles.managementCopy}>
        <ThemedText style={styles.managementTitle}>{title}</ThemedText>
        <ThemedText style={styles.managementDetail} themeColor="textSecondary">
          {detail}
        </ThemedText>
      </View>
      <ThemedText style={styles.pendingText} themeColor="textSecondary">
        Pending API
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  nav: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
  },
  navTitle: { fontSize: 16, fontWeight: "700" },
  content: { padding: Spacing.four, paddingBottom: Spacing.six },
  hero: { borderRadius: BorderRadius.xl, padding: Spacing.four },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  accountIcon: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.white,
  },
  roleBadge: {
    borderRadius: BorderRadius.full,
    backgroundColor: BrandColors.primary,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  roleText: {
    color: BrandColors.white,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "800",
  },
  accountName: {
    fontSize: 26,
    lineHeight: 33,
    fontWeight: "800",
    marginTop: Spacing.four,
  },
  accountMeta: {
    color: BrandColors.primaryDark,
    fontSize: 13,
    lineHeight: 19,
    marginTop: Spacing.one,
  },
  suspendedNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  suspendedText: {
    flex: 1,
    color: BrandColors.warning,
    fontSize: 12,
    lineHeight: 17,
  },
  switchRow: { alignItems: "flex-start", marginVertical: Spacing.three },
  switchButton: { minHeight: 44, paddingVertical: Spacing.two },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 27,
    fontWeight: "800",
    marginTop: Spacing.two,
  },
  sectionSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: Spacing.one,
    marginBottom: Spacing.three,
  },
  managementList: { gap: Spacing.three },
  managementCard: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
  },
  managementIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.primarySurface,
  },
  managementCopy: { flex: 1, marginHorizontal: Spacing.three },
  managementTitle: { fontSize: 15, lineHeight: 20, fontWeight: "700" },
  managementDetail: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  pendingText: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  integrationNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
    marginVertical: Spacing.four,
  },
  integrationText: { flex: 1, fontSize: 12, lineHeight: 18 },
  errorState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.four,
    gap: Spacing.three,
  },
  errorTitle: { fontSize: 20, fontWeight: "800" },
  errorText: { fontSize: 14, lineHeight: 20, textAlign: "center" },
});
