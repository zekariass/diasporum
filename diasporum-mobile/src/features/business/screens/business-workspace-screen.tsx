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
import type {
  BusinessListings,
  BusinessOverview,
  BusinessWorkspace,
} from "../types/business-types";

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
  const [overview, setOverview] = useState<BusinessOverview | null>(null);
  const [listings, setListings] = useState<BusinessListings | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [billingStatus, setBillingStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    setError(null);
    // Account switch safety: every slice is reset before loading so no
    // records from the previously selected account can remain visible.
    setOverview(null);
    setListings(null);
    setMemberCount(null);
    setBillingStatus(null);
    try {
      const ws = await businessApi.workspace(accountId);
      setWorkspace(ws);
      businessApi
        .overview(accountId, 30)
        .then(setOverview)
        .catch(() => setOverview(null));
      businessApi
        .listings(accountId)
        .then(setListings)
        .catch(() => setListings(null));
      businessApi
        .members(accountId)
        .then((result) =>
          setMemberCount(
            result.items.filter((m) => m.membershipStatus === "ACTIVE").length,
          ),
        )
        .catch(() => setMemberCount(null));
      if (ws.capabilities.manageBilling) {
        businessApi
          .billing(accountId)
          .then((result) =>
            setBillingStatus(result.subscription?.status ?? null),
          )
          .catch(() => setBillingStatus(null));
      }
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
        <View style={styles.nav}>
          <View style={styles.navSide}>
            <Pressable
              onPress={safeBack}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={({ pressed }) => [
                styles.navButton,
                { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="arrow-back" size={21} color={theme.text} />
            </Pressable>
          </View>
          <ThemedText style={styles.navTitle}>Business</ThemedText>
          <View style={styles.navActions}>
            {workspace?.capabilities.manageSettings ? (
              <Pressable
                onPress={() =>
                  router.push(
                    `/(app)/business/workspace/${accountId}/settings` as never,
                  )
                }
                accessibilityRole="button"
                accessibilityLabel="Workspace settings"
                style={({ pressed }) => [
                  styles.navButton,
                  { backgroundColor: theme.backgroundElement },
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  name="settings-outline"
                  size={20}
                  color={theme.text}
                />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => router.replace("/(app)/business" as never)}
              accessibilityRole="button"
              accessibilityLabel="Choose Business Account"
              style={({ pressed }) => [
                styles.navButton,
                { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="swap-horizontal" size={21} color={theme.text} />
            </Pressable>
          </View>
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
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.intro}>
              <ThemedText style={styles.screenTitle}>
                Business Workspace
              </ThemedText>
              <ThemedText
                style={styles.screenSubtitle}
                themeColor="textSecondary"
              >
                Manage your business, profiles, listings and team.
              </ThemedText>
            </View>

            <View style={styles.hero}>
              <View pointerEvents="none" style={styles.heroOrbLarge} />
              <View pointerEvents="none" style={styles.heroOrbSmall} />
              <View style={styles.heroTop}>
                <View style={styles.accountIcon}>
                  <Ionicons
                    name="briefcase"
                    size={29}
                    color={BrandColors.primary}
                  />
                </View>
                <View style={styles.roleBadge}>
                  <Ionicons
                    name="shield-checkmark"
                    size={14}
                    color={BrandColors.primary}
                  />
                  <ThemedText style={styles.roleText}>
                    {roleLabel(workspace.role)}
                  </ThemedText>
                </View>
              </View>
              <ThemedText style={styles.accountEyebrow}>
                BUSINESS ACCOUNT
              </ThemedText>
              <ThemedText style={styles.accountName} numberOfLines={2}>
                {workspace.accountName}
              </ThemedText>
              <View style={styles.accountMetaRow}>
                <Ionicons
                  name="storefront-outline"
                  size={16}
                  color={BrandColors.primarySurface}
                />
                <ThemedText style={styles.accountMeta}>
                  {workspace.profileCount}{" "}
                  {workspace.profileCount === 1
                    ? "public profile"
                    : "public profiles"}
                </ThemedText>
              </View>
              <Pressable
                onPress={() => router.replace("/(app)/business" as never)}
                accessibilityRole="button"
                accessibilityLabel="Switch Business Account"
                style={({ pressed }) => [
                  styles.switchButton,
                  pressed && styles.switchButtonPressed,
                ]}
              >
                <View style={styles.switchCopy}>
                  <Ionicons
                    name="swap-horizontal-outline"
                    size={18}
                    color={BrandColors.primary}
                  />
                  <ThemedText style={styles.switchText}>
                    Switch business account
                  </ThemedText>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={17}
                  color={BrandColors.primary}
                />
              </Pressable>
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

            <View style={styles.quickActionsSection}>
              <ThemedText style={styles.sectionEyebrow}>
                QUICK ACTIONS
              </ThemedText>
              <View
                style={[
                  styles.quickActions,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                  },
                ]}
              >
                <QuickAction
                  icon="add"
                  label="Create Listing"
                  featured
                  onPress={() =>
                    router.push(
                      `/(app)/business/workspace/${accountId}/new-listing` as never,
                    )
                  }
                />
                <QuickAction
                  icon="calendar-outline"
                  label="Create Event"
                  onPress={() =>
                    router.push(
                      `/(app)/events/create?businessAccountId=${accountId}` as never,
                    )
                  }
                />
                <QuickAction
                  icon="person-add-outline"
                  label="Invite Member"
                  onPress={() =>
                    router.push(
                      `/(app)/business/workspace/${accountId}/team` as never,
                    )
                  }
                />
                <QuickAction
                  icon="grid-outline"
                  label="More"
                  onPress={() =>
                    router.push(
                      `/(app)/business/workspace/${accountId}/settings` as never,
                    )
                  }
                />
              </View>
            </View>

            <View style={styles.overviewHeader}>
              <View style={styles.overviewHeading}>
                <ThemedText style={styles.sectionEyebrow}>
                  PERFORMANCE
                </ThemedText>
                <ThemedText style={styles.sectionTitle}>
                  Business Overview
                </ThemedText>
              </View>
              <View
                style={[
                  styles.periodChip,
                  { backgroundColor: theme.primarySurface },
                ]}
              >
                <Ionicons name="time-outline" size={14} color={theme.primary} />
                <ThemedText style={[styles.period, { color: theme.primary }]}>
                  30 days
                </ThemedText>
              </View>
            </View>
            <View style={styles.metricGrid}>
              <MetricCard
                icon="eye-outline"
                value={overview ? String(overview.listingViews) : "—"}
                label="Listing Views"
              />
              <MetricCard
                icon="chatbubble-ellipses-outline"
                value={overview ? String(overview.enquiries) : "—"}
                label="Enquiries"
              />
              <MetricCard
                icon="albums-outline"
                value={overview ? String(overview.activeListings) : "—"}
                label="Active Listings"
              />
              <MetricCard
                icon="calendar-number-outline"
                value={overview ? String(overview.upcomingEvents) : "—"}
                label="Upcoming Events"
              />
            </View>

            <View style={styles.managementHeading}>
              <ThemedText style={styles.sectionEyebrow}>WORKSPACE</ThemedText>
              <ThemedText style={styles.sectionTitle}>
                Manage business
              </ThemedText>
              <ThemedText
                style={styles.sectionSubtitle}
                themeColor="textSecondary"
              >
                Everything you need to run and grow your business.
              </ThemedText>
            </View>

            <View style={styles.managementList}>
              <ManagementCard
                visible={workspace.capabilities.manageProfiles}
                icon="storefront-outline"
                title="Business Profiles"
                detail="Your public business identities"
                trailing={`${workspace.profileCount}`}
                onPress={() =>
                  router.push(
                    `/(app)/businesses/manage?accountId=${accountId}` as never,
                  )
                }
              />
              <ManagementCard
                visible={workspace.capabilities.manageListings}
                icon="albums-outline"
                title="Listings"
                detail="Jobs, events, property, vehicles, and business-owned content"
                trailing={
                  listings?.properties
                    ? String(
                        (listings.properties?.total ?? 0) +
                          (listings.vehicles?.total ?? 0) +
                          (listings.jobs?.total ?? 0) +
                          (listings.events?.total ?? 0) +
                          (listings.providers?.total ?? 0),
                      )
                    : undefined
                }
                onPress={() =>
                  router.push(
                    `/(app)/business/workspace/${accountId}/listings` as never,
                  )
                }
              />
              <ManagementCard
                visible={workspace.capabilities.manageTeam}
                icon="people-outline"
                title="Team"
                detail="Members, invitations, roles, and access"
                trailing={memberCount != null ? String(memberCount) : undefined}
                onPress={() =>
                  router.push(
                    `/(app)/business/workspace/${accountId}/team` as never,
                  )
                }
              />
              <ManagementCard
                visible={workspace.capabilities.manageBilling}
                icon="card-outline"
                title="Billing"
                detail="Business subscription, entitlements, and billing history"
                trailing={billingStatus ?? undefined}
                onPress={() =>
                  router.push(
                    `/(app)/business/workspace/${accountId}/billing` as never,
                  )
                }
              />
              <ManagementCard
                visible={workspace.capabilities.manageSettings}
                icon="settings-outline"
                title="Settings"
                detail="Business Account information and lifecycle"
                onPress={() =>
                  router.push(
                    `/(app)/business/workspace/${accountId}/settings` as never,
                  )
                }
              />
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

function QuickAction({
  icon,
  label,
  featured = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  featured?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}
    >
      <View
        style={[
          styles.quickActionIcon,
          {
            backgroundColor: featured
              ? BrandColors.primary
              : theme.primarySurface,
          },
        ]}
      >
        <Ionicons
          name={icon}
          size={23}
          color={featured ? BrandColors.white : theme.primary}
        />
      </View>
      <ThemedText style={styles.quickActionLabel} numberOfLines={2}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function MetricCard({
  icon,
  value,
  label,
}: {
  icon: IconName;
  value: string;
  label: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.metricCard,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}
    >
      <View
        style={[styles.metricIcon, { backgroundColor: theme.primarySurface }]}
      >
        <Ionicons name={icon} size={19} color={theme.primary} />
      </View>
      <ThemedText style={styles.metricValue}>{value}</ThemedText>
      <ThemedText style={styles.metricLabel} themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

function ManagementCard({
  visible,
  icon,
  title,
  detail,
  trailing,
  onPress,
}: {
  visible: boolean;
  icon: IconName;
  title: string;
  detail: string;
  trailing?: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  if (!visible) return null;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.managementCard,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        pressed && styles.managementCardPressed,
      ]}
    >
      <View
        style={[
          styles.managementIcon,
          { backgroundColor: theme.primarySurface },
        ]}
      >
        <Ionicons name={icon} size={22} color={theme.primary} />
      </View>
      <View style={styles.managementCopy}>
        <ThemedText style={styles.managementTitle}>{title}</ThemedText>
        <ThemedText
          style={styles.managementDetail}
          themeColor="textSecondary"
          numberOfLines={2}
        >
          {detail}
        </ThemedText>
      </View>
      {trailing ? (
        <View
          style={[
            styles.trailingBadge,
            { backgroundColor: theme.primarySurface },
          ]}
        >
          <ThemedText style={[styles.trailing, { color: theme.primary }]}>
            {trailing}
          </ThemedText>
        </View>
      ) : null}
      {onPress ? (
        <Ionicons
          name="chevron-forward"
          size={18}
          color={theme.textSecondary}
        />
      ) : (
        <ThemedText style={styles.pendingText} themeColor="textSecondary">
          Pending API
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  nav: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.one,
  },
  navSide: { width: 96, alignItems: "flex-start" },
  navActions: {
    width: 96,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: Spacing.two,
  },
  navButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  navTitle: { fontSize: 15, fontWeight: "700" },
  pressed: { opacity: 0.65 },
  content: {
    paddingHorizontal: 6,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.six,
  },
  intro: { marginBottom: Spacing.four },
  screenTitle: {
    fontSize: 30,
    lineHeight: 37,
    fontWeight: "800",
    letterSpacing: -0.6,
  },
  screenSubtitle: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: Spacing.one,
  },
  hero: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.four,
    backgroundColor: BrandColors.primary,
    overflow: "hidden",
  },
  heroOrbLarge: {
    position: "absolute",
    width: 190,
    height: 190,
    borderRadius: 95,
    right: -64,
    top: -84,
    backgroundColor: BrandColors.primaryLight,
    opacity: 0.18,
  },
  heroOrbSmall: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    left: -54,
    bottom: 24,
    backgroundColor: BrandColors.primaryDark,
    opacity: 0.2,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
  accountIcon: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.white,
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    borderRadius: BorderRadius.full,
    backgroundColor: BrandColors.white,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  roleText: {
    color: BrandColors.primary,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
  },
  accountEyebrow: {
    color: BrandColors.primarySurface,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginTop: 20,
  },
  accountName: {
    color: BrandColors.white,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
    letterSpacing: -0.4,
    marginTop: Spacing.one,
  },
  accountMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: Spacing.two,
  },
  accountMeta: {
    color: BrandColors.primarySurface,
    fontSize: 13,
    lineHeight: 18,
  },
  switchButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    backgroundColor: BrandColors.white,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 20,
  },
  switchButtonPressed: { opacity: 0.85 },
  switchCopy: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  switchText: {
    fontSize: 13,
    fontWeight: "700",
    color: BrandColors.primary,
  },
  suspendedNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderRadius: BorderRadius.md,
    backgroundColor: BrandColors.white,
    padding: Spacing.three,
    marginTop: Spacing.three,
  },
  suspendedText: {
    flex: 1,
    color: BrandColors.black,
    fontSize: 12,
    lineHeight: 17,
  },
  quickActionsSection: { marginTop: Spacing.four },
  sectionEyebrow: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 1.3,
  },
  quickActions: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.one,
    marginTop: 10,
  },
  quickAction: {
    flex: 1,
    minHeight: 84,
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.half,
  },
  quickActionIcon: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  quickActionLabel: {
    minHeight: 30,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "600",
    textAlign: "center",
  },
  overviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
    marginTop: 28,
  },
  overviewHeading: { flex: 1 },
  periodChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  period: { fontSize: 11, fontWeight: "700" },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.three,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  metricCard: {
    flexBasis: "47%",
    flexGrow: 1,
    minWidth: 130,
    minHeight: 134,
    borderWidth: 1,
    borderRadius: 18,
    padding: Spacing.three,
  },
  metricIcon: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  metricValue: { fontSize: 26, lineHeight: 32, fontWeight: "800" },
  metricLabel: { fontSize: 12, lineHeight: 16, marginTop: Spacing.half },
  managementHeading: { marginTop: 20, marginBottom: Spacing.three },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 27,
    fontWeight: "800",
    marginTop: Spacing.half,
  },
  sectionSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: Spacing.one,
  },
  managementList: { gap: 10, marginBottom: Spacing.three },
  managementCard: {
    minHeight: 84,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 18,
    padding: Spacing.three,
  },
  managementCardPressed: { opacity: 0.7 },
  managementIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  managementCopy: { flex: 1, marginHorizontal: Spacing.three },
  managementTitle: { fontSize: 15, lineHeight: 20, fontWeight: "700" },
  managementDetail: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  trailingBadge: {
    maxWidth: 84,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.two,
    paddingVertical: 5,
    marginRight: 6,
  },
  trailing: { fontSize: 11, lineHeight: 14, fontWeight: "700" },
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
