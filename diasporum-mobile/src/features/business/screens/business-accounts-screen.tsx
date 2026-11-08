import React, { useCallback, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import { useFocusEffect, useRouter } from "expo-router";

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
  BusinessAccount,
  BusinessInvitation,
} from "../types/business-types";

const LAST_WORKSPACE_KEY = "diasporum.lastBusinessWorkspaceId";

function roleLabel(role: string) {
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function BusinessAccountsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient } = useSession();
  const businessApi = React.useMemo(
    () => createBusinessApi(apiClient),
    [apiClient],
  );
  const [accounts, setAccounts] = useState<BusinessAccount[]>([]);
  const [invitations, setInvitations] = useState<BusinessInvitation[]>([]);
  const [lastWorkspaceId, setLastWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);

  const load = useCallback(
    async (initial = false) => {
      if (initial) setLoading(true);
      setError(null);
      try {
        const [accountList, inviteList, lastId] = await Promise.all([
          businessApi.accounts(),
          businessApi.invitations(),
          SecureStore.getItemAsync(LAST_WORKSPACE_KEY).catch(() => null),
        ]);
        setAccounts(accountList.items);
        setInvitations(inviteList.items);
        setLastWorkspaceId(lastId);
      } catch (cause) {
        setError(
          ApiError.isApiError(cause)
            ? cause.userMessage
            : "Could not load your business accounts.",
        );
      } finally {
        if (initial) setLoading(false);
        setRefreshing(false);
      }
    },
    [businessApi],
  );

  useFocusEffect(
    useCallback(() => {
      void load(true);
    }, [load]),
  );

  function openWorkspace(accountId: string) {
    void SecureStore.setItemAsync(LAST_WORKSPACE_KEY, accountId).catch(
      () => undefined,
    );
    router.push(`/(app)/business/workspace/${accountId}` as never);
  }

  async function answerInvitation(
    invitation: BusinessInvitation,
    accept: boolean,
  ) {
    if (busyInviteId) return;
    setBusyInviteId(invitation.accountId);
    try {
      if (accept) {
        await businessApi.acceptInvitation(invitation.accountId);
        await load();
        openWorkspace(invitation.accountId);
      } else {
        await businessApi.declineInvitation(invitation.accountId);
        await load();
      }
    } catch (cause) {
      Alert.alert(
        "Invitation",
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "The invitation could not be answered. Please try again.",
      );
      await load();
    } finally {
      setBusyInviteId(null);
    }
  }

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
          <View style={styles.navSpacer} />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
            />
          }
        >
          <View style={styles.heading}>
            <ThemedText style={styles.title}>Your Business Accounts</ThemedText>
            <ThemedText style={styles.subtitle} themeColor="textSecondary">
              Choose a business workspace to manage.
            </ThemedText>
          </View>

          {error && (
            <View
              style={[
                styles.errorCard,
                { backgroundColor: BrandColors.errorSurface },
              ]}
            >
              <ThemedText style={{ color: BrandColors.error }}>
                {error}
              </ThemedText>
              <Pressable onPress={() => void load(true)}>
                <ThemedText style={styles.retry}>Try again</ThemedText>
              </Pressable>
            </View>
          )}

          {invitations.length > 0 && (
            <View style={styles.inviteSection}>
              <ThemedText style={styles.inviteSectionTitle}>
                Pending invitations
              </ThemedText>
              {invitations.map((invitation) => (
                <View
                  key={invitation.accountId}
                  style={[
                    styles.inviteCard,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <View style={styles.inviteIcon}>
                    <Ionicons
                      name="mail-outline"
                      size={22}
                      color={BrandColors.primary}
                    />
                  </View>
                  <View style={styles.inviteCopy}>
                    <ThemedText style={styles.inviteTitle} numberOfLines={1}>
                      {invitation.accountName}
                    </ThemedText>
                    <ThemedText
                      style={styles.inviteMeta}
                      themeColor="textSecondary"
                    >
                      {roleLabel(invitation.role)}
                      {invitation.invitedByName
                        ? ` · from ${invitation.invitedByName}`
                        : ""}
                      {invitation.expired
                        ? " · expired"
                        : invitation.expiresAt
                          ? ` · expires ${new Date(invitation.expiresAt).toLocaleDateString("en", { month: "short", day: "numeric" })}`
                          : ""}
                    </ThemedText>
                    <View style={styles.inviteActions}>
                      <Pressable
                        onPress={() => void answerInvitation(invitation, true)}
                        disabled={
                          busyInviteId === invitation.accountId ||
                          invitation.expired
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Accept invitation to ${invitation.accountName}`}
                        style={[
                          styles.inviteAccept,
                          (busyInviteId === invitation.accountId ||
                            invitation.expired) &&
                            styles.inviteDisabled,
                        ]}
                      >
                        <ThemedText style={styles.inviteAcceptText}>
                          Accept
                        </ThemedText>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          void answerInvitation(invitation, false)
                        }
                        disabled={busyInviteId === invitation.accountId}
                        accessibilityRole="button"
                        accessibilityLabel={`Decline invitation to ${invitation.accountName}`}
                        style={[
                          styles.inviteDecline,
                          { borderColor: theme.border },
                          busyInviteId === invitation.accountId &&
                            styles.inviteDisabled,
                        ]}
                      >
                        <ThemedText
                          style={styles.inviteDeclineText}
                          themeColor="textSecondary"
                        >
                          Decline
                        </ThemedText>
                      </Pressable>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}

          {!error && accounts.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons
                  name="briefcase-outline"
                  size={42}
                  color={BrandColors.primary}
                />
              </View>
              <ThemedText style={styles.emptyTitle}>
                Start your Business Workspace
              </ThemedText>
              <ThemedText style={styles.emptyText} themeColor="textSecondary">
                Create a workspace to manage business profiles, listings, and
                your team without changing your personal Diasporum account.
              </ThemedText>
              <PrimaryButton
                label="Create Business Account"
                onPress={() => router.push("/(app)/business/create")}
              />
            </View>
          ) : (
            <View style={styles.accountList}>
              {accounts.map((account) => (
                <Pressable
                  key={account.id}
                  onPress={() => openWorkspace(account.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${account.accountName} workspace`}
                  style={({ pressed }) => [
                    styles.accountCard,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                    },
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.accountIcon}>
                    <Ionicons
                      name="briefcase"
                      size={25}
                      color={BrandColors.primary}
                    />
                  </View>
                  <View style={styles.accountCopy}>
                    <View style={styles.accountNameRow}>
                      <ThemedText style={styles.accountName} numberOfLines={1}>
                        {account.accountName}
                      </ThemedText>
                      {account.id === lastWorkspaceId && (
                        <ThemedText style={styles.lastUsed}>Last</ThemedText>
                      )}
                      {account.status !== "ACTIVE" && (
                        <ThemedText style={styles.status}>
                          {account.status}
                        </ThemedText>
                      )}
                    </View>
                    <ThemedText
                      style={styles.accountMeta}
                      themeColor="textSecondary"
                    >
                      {roleLabel(account.role)} · {account.profileCount}{" "}
                      {account.profileCount === 1
                        ? "business profile"
                        : "business profiles"}
                    </ThemedText>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={20}
                    color={theme.textSecondary}
                  />
                </Pressable>
              ))}
              <PrimaryButton
                label="Create Business Account"
                onPress={() => router.push("/(app)/business/create")}
                variant="secondary"
              />
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
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
  navSpacer: { width: 24 },
  content: { flexGrow: 1, padding: Spacing.four, paddingBottom: Spacing.six },
  heading: { marginBottom: Spacing.four },
  title: { fontSize: 27, lineHeight: 34, fontWeight: "800" },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: Spacing.one },
  errorCard: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  retry: { color: BrandColors.error, fontWeight: "700" },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.six,
  },
  emptyIcon: {
    width: 84,
    height: 84,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.primarySurface,
    marginBottom: Spacing.four,
  },
  emptyTitle: {
    fontSize: 21,
    lineHeight: 28,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginTop: Spacing.two,
    marginBottom: Spacing.four,
  },
  inviteSection: { marginBottom: Spacing.four, gap: Spacing.two },
  inviteSectionTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    marginBottom: Spacing.one,
  },
  inviteCard: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
  },
  inviteIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.primarySurface,
  },
  inviteCopy: { flex: 1, marginLeft: Spacing.three },
  inviteTitle: { fontSize: 15, fontWeight: "700" },
  inviteMeta: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  inviteActions: {
    flexDirection: "row",
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  inviteAccept: {
    borderRadius: BorderRadius.full,
    backgroundColor: BrandColors.primary,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  inviteAcceptText: {
    color: BrandColors.white,
    fontSize: 12,
    fontWeight: "800",
  },
  inviteDecline: {
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  inviteDeclineText: { fontSize: 12, fontWeight: "700" },
  inviteDisabled: { opacity: 0.5 },
  lastUsed: {
    color: BrandColors.primary,
    fontSize: 9,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  accountList: { gap: Spacing.three },
  accountCard: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
  },
  accountIcon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.primarySurface,
  },
  accountCopy: { flex: 1, marginHorizontal: Spacing.three },
  accountNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  accountName: {
    flexShrink: 1,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
  },
  status: { color: BrandColors.warning, fontSize: 9, fontWeight: "800" },
  accountMeta: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
});
