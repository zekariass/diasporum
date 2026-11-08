import React, { useCallback, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ApiError } from "@/core/api/api-error";
import { safeBack } from "@/core/navigation/safe-back";
import { useSession } from "@/core/session/session-provider";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { PrimaryButton } from "@/shared/components/primary-button";
import { FormInput } from "@/shared/components/form-input";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { useTheme } from "@/hooks/use-theme";
import { timeAgo } from "@/features/feed/utils/time-ago";
import { createBusinessApi } from "../services/business-api";
import type {
  BusinessAuditEvent,
  BusinessWorkspace,
} from "../types/business-types";

function actionLabel(actionKey: string) {
  return actionKey
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function BusinessSettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  const { apiClient } = useSession();
  const businessApi = React.useMemo(
    () => createBusinessApi(apiClient),
    [apiClient],
  );

  const [workspace, setWorkspace] = useState<BusinessWorkspace | null>(null);
  const [events, setEvents] = useState<BusinessAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [accountName, setAccountName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [closing, setClosing] = useState(false);

  const load = useCallback(
    async (initial = false) => {
      if (!accountId) return;
      if (initial) setLoading(true);
      setError(null);
      try {
        const [ws, audit] = await Promise.all([
          businessApi.workspace(accountId),
          businessApi.auditEvents(accountId),
        ]);
        setWorkspace(ws);
        setEvents(audit.items);
        setAccountName((current) => current || ws.accountName);
      } catch (cause) {
        setError(
          ApiError.isApiError(cause)
            ? cause.userMessage
            : "Could not load workspace settings.",
        );
      } finally {
        if (initial) setLoading(false);
      }
    },
    [accountId, businessApi],
  );

  useFocusEffect(
    useCallback(() => {
      void load(true);
    }, [load]),
  );

  async function saveName() {
    const normalized = accountName.trim();
    if (!normalized || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await businessApi.renameAccount(accountId!, normalized);
      setWorkspace(updated);
      setSaved(true);
      await load();
    } catch (cause) {
      setSaveError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "Could not rename the workspace.",
      );
    } finally {
      setSaving(false);
    }
  }

  function confirmClose() {
    Alert.alert(
      "Close this Business Account?",
      "This permanently closes the workspace. All memberships are revoked and it cannot be reopened. Public business profiles are not deleted.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Close workspace",
          style: "destructive",
          onPress: () => void closeAccount(),
        },
      ],
    );
  }

  async function closeAccount() {
    if (closing) return;
    setClosing(true);
    try {
      await businessApi.closeAccount(accountId!);
      router.replace("/(app)/business" as never);
    } catch (cause) {
      setClosing(false);
      Alert.alert(
        "Could not close",
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "The workspace could not be closed. Please try again.",
      );
    }
  }

  if (loading) return <LoadingScreen />;

  const isOwner = workspace?.role === "OWNER";

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={[styles.nav, { borderBottomColor: theme.border }]}>
          <Pressable onPress={safeBack} hitSlop={8} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <ThemedText style={styles.navTitle}>Settings</ThemedText>
          <View style={styles.navSpacer} />
        </View>

        {error || !workspace ? (
          <View style={styles.errorState}>
            <ThemedText style={styles.errorTitle}>
              Settings unavailable
            </ThemedText>
            <ThemedText style={styles.errorText} themeColor="textSecondary">
              {error ?? "This workspace could not be loaded."}
            </ThemedText>
            <PrimaryButton
              label="Try again"
              onPress={() => void load(true)}
              variant="secondary"
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            <ThemedText style={styles.sectionTitle}>Workspace name</ThemedText>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            >
              <FormInput
                label="Business Account name"
                value={accountName}
                onChangeText={(text) => {
                  setAccountName(text);
                  setSaved(false);
                }}
                maxLength={180}
                autoCapitalize="words"
                editable={!saving && workspace.status === "ACTIVE"}
                error={saveError ?? undefined}
              />
              <PrimaryButton
                label={saved ? "Saved" : "Save name"}
                onPress={() => void saveName()}
                loading={saving}
                disabled={
                  !accountName.trim() ||
                  accountName.trim() === workspace.accountName ||
                  workspace.status !== "ACTIVE"
                }
              />
            </View>

            <ThemedText style={styles.sectionTitle}>Activity</ThemedText>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            >
              {events.length === 0 ? (
                <ThemedText
                  style={styles.emptyText}
                  themeColor="textSecondary"
                >
                  No recorded activity yet.
                </ThemedText>
              ) : (
                events.map((event, index) => (
                  <View
                    key={event.id}
                    style={[
                      styles.eventRow,
                      index > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: theme.border,
                      },
                    ]}
                  >
                    <View style={styles.eventCopy}>
                      <ThemedText style={styles.eventAction}>
                        {actionLabel(event.actionKey)}
                      </ThemedText>
                      <ThemedText
                        style={styles.eventMeta}
                        themeColor="textSecondary"
                      >
                        {[
                          event.actorName ?? "System",
                          event.targetName && event.targetName !== event.actorName
                            ? `→ ${event.targetName}`
                            : null,
                          timeAgo(event.createdAt),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </ThemedText>
                      {event.reason ? (
                        <ThemedText
                          style={styles.eventReason}
                          themeColor="textSecondary"
                        >
                          {event.reason}
                        </ThemedText>
                      ) : null}
                    </View>
                  </View>
                ))
              )}
            </View>

            {isOwner && (
              <>
                <ThemedText style={styles.sectionTitle}>
                  Danger zone
                </ThemedText>
                <View
                  style={[
                    styles.card,
                    styles.dangerCard,
                    { borderColor: BrandColors.error },
                  ]}
                >
                  <View style={styles.dangerCopy}>
                    <ThemedText style={styles.dangerTitle}>
                      Close Business Account
                    </ThemedText>
                    <ThemedText
                      style={styles.dangerText}
                      themeColor="textSecondary"
                    >
                      Permanently closes the workspace and revokes every
                      member. This cannot be undone.
                    </ThemedText>
                  </View>
                  <Pressable
                    onPress={confirmClose}
                    disabled={closing || workspace.status !== "ACTIVE"}
                    accessibilityRole="button"
                    accessibilityLabel="Close Business Account"
                    style={[
                      styles.dangerButton,
                      { borderColor: BrandColors.error },
                      (closing || workspace.status !== "ACTIVE") &&
                        styles.disabled,
                    ]}
                  >
                    <ThemedText style={styles.dangerButtonText}>
                      {closing ? "Closing…" : "Close"}
                    </ThemedText>
                  </Pressable>
                </View>
              </>
            )}
          </ScrollView>
        )}
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
  content: { padding: Spacing.four, paddingBottom: Spacing.six },
  sectionTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  card: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  emptyText: { fontSize: 13, lineHeight: 19 },
  eventRow: { paddingVertical: Spacing.two },
  eventCopy: { gap: 1 },
  eventAction: { fontSize: 14, fontWeight: "700" },
  eventMeta: { fontSize: 12, lineHeight: 17 },
  eventReason: { fontSize: 12, lineHeight: 17, fontStyle: "italic" },
  dangerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  dangerCopy: { flex: 1 },
  dangerTitle: { fontSize: 14, fontWeight: "800" },
  dangerText: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  dangerButton: {
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  dangerButtonText: {
    color: BrandColors.error,
    fontSize: 13,
    fontWeight: "800",
  },
  disabled: { opacity: 0.5 },
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
