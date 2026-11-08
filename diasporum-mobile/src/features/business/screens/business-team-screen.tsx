import React, { useCallback, useMemo, useState } from "react";
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
  BusinessMember,
  BusinessRole,
  BusinessWorkspace,
} from "../types/business-types";

const INVITABLE: BusinessRole[] = [
  "ADMINISTRATOR",
  "EDITOR",
  "LISTING_MANAGER",
  "BILLING_MANAGER",
];

function rankOf(role: string) {
  switch (role) {
    case "OWNER":
      return 40;
    case "ADMINISTRATOR":
      return 30;
    case "EDITOR":
    case "LISTING_MANAGER":
    case "BILLING_MANAGER":
      return 20;
    default:
      return 0;
  }
}

function roleLabel(role: string) {
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function BusinessTeamScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  const { apiClient, session } = useSession();
  const businessApi = React.useMemo(
    () => createBusinessApi(apiClient),
    [apiClient],
  );
  const myUserId = session?.me?.id ?? null;

  const [workspace, setWorkspace] = useState<BusinessWorkspace | null>(null);
  const [members, setMembers] = useState<BusinessMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteRole, setInviteRole] = useState<BusinessRole>("EDITOR");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const load = useCallback(
    async (initial = false) => {
      if (!accountId) return;
      if (initial) setLoading(true);
      setError(null);
      try {
        const [ws, memberList] = await Promise.all([
          businessApi.workspace(accountId),
          businessApi.members(accountId),
        ]);
        setWorkspace(ws);
        setMembers(memberList.items);
      } catch (cause) {
        setError(
          ApiError.isApiError(cause)
            ? cause.userMessage
            : "Could not load the team.",
        );
      } finally {
        if (initial) setLoading(false);
        setRefreshing(false);
      }
    },
    [accountId, businessApi],
  );

  useFocusEffect(
    useCallback(() => {
      void load(true);
    }, [load]),
  );

  const myRole = workspace?.role ?? null;
  const invitableRoles = useMemo(
    () => INVITABLE.filter((r) => rankOf(r) < rankOf(myRole ?? "")),
    [myRole],
  );

  async function submitInvite() {
    const username = inviteUsername.trim().replace(/^@/, "");
    if (!username || inviting) return;
    setInviting(true);
    setInviteError(null);
    try {
      await businessApi.invite(accountId!, username, inviteRole);
      setInviteUsername("");
      setInviteRole("EDITOR");
      await load();
    } catch (cause) {
      setInviteError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "Could not send the invitation.",
      );
    } finally {
      setInviting(false);
    }
  }

  async function runAction(userId: string, action: () => Promise<unknown>) {
    if (busyUserId) return;
    setBusyUserId(userId);
    try {
      await action();
      await load();
    } catch (cause) {
      Alert.alert(
        "Action failed",
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "The change could not be applied.",
      );
    } finally {
      setBusyUserId(null);
    }
  }

  function confirmRevoke(member: BusinessMember) {
    const self = member.userId === myUserId;
    Alert.alert(
      self ? "Leave workspace?" : "Remove member?",
      self
        ? "You will lose access to this Business Workspace."
        : `${member.displayName ?? member.username ?? "This member"} will lose access immediately.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: self ? "Leave" : "Remove",
          style: "destructive",
          onPress: () =>
            void runAction(member.userId, () =>
              businessApi.revokeMember(accountId!, member.userId),
            ),
        },
      ],
    );
  }

  function confirmWithdraw(member: BusinessMember) {
    Alert.alert(
      "Withdraw invitation?",
      `The invitation sent to ${member.displayName ?? member.username ?? "this person"} will be cancelled.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Withdraw",
          style: "destructive",
          onPress: () =>
            void runAction(member.userId, () =>
              businessApi.revokeInvitation(accountId!, member.userId),
            ),
        },
      ],
    );
  }

  function confirmTransfer(member: BusinessMember) {
    Alert.alert(
      "Transfer ownership?",
      `${member.displayName ?? member.username ?? "This member"} becomes the owner. Your role changes to Administrator.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Transfer",
          style: "destructive",
          onPress: () =>
            void runAction(member.userId, async () => {
              await businessApi.transferOwnership(accountId!, member.userId);
              router.back();
            }),
        },
      ],
    );
  }

  function pickRole(member: BusinessMember) {
    const options = INVITABLE.filter(
      (r) => r !== member.role && rankOf(r) < rankOf(myRole ?? ""),
    );
    if (options.length === 0) return;
    Alert.alert(
      "Change role",
      `New role for ${member.displayName ?? member.username ?? "member"}:`,
      [
        ...options.map((role) => ({
          text: roleLabel(role),
          onPress: () =>
            void runAction(member.userId, () =>
              businessApi.changeRole(accountId!, member.userId, role),
            ),
        })),
        { text: "Cancel", style: "cancel" as const },
      ],
    );
  }

  function canActOn(member: BusinessMember) {
    if (!myRole || member.userId === myUserId) return false;
    return rankOf(member.role) < rankOf(myRole);
  }

  if (loading) return <LoadingScreen />;

  const pending = members.filter((m) => m.membershipStatus === "PENDING");
  const active = members.filter((m) => m.membershipStatus === "ACTIVE");

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={[styles.nav, { borderBottomColor: theme.border }]}>
          <Pressable onPress={safeBack} hitSlop={8} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <ThemedText style={styles.navTitle}>Team</ThemedText>
          <View style={styles.navSpacer} />
        </View>

        {error || !workspace ? (
          <View style={styles.errorState}>
            <ThemedText style={styles.errorTitle}>Team unavailable</ThemedText>
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
            <ThemedText style={styles.title}>{workspace.accountName}</ThemedText>
            <ThemedText style={styles.subtitle} themeColor="textSecondary">
              {active.length} {active.length === 1 ? "member" : "members"}
              {pending.length > 0
                ? ` · ${pending.length} invited`
                : ""}
            </ThemedText>

            <View
              style={[
                styles.inviteCard,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            >
              <ThemedText style={styles.sectionTitle}>Invite member</ThemedText>
              <FormInput
                label="Username"
                value={inviteUsername}
                onChangeText={setInviteUsername}
                placeholder="@username"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!inviting}
                error={inviteError ?? undefined}
              />
              <View style={styles.roleChips}>
                {invitableRoles.map((role) => (
                  <Pressable
                    key={role}
                    onPress={() => setInviteRole(role)}
                    accessibilityRole="button"
                    accessibilityLabel={`Invite as ${roleLabel(role)}`}
                    style={[
                      styles.roleChip,
                      {
                        borderColor:
                          inviteRole === role
                            ? BrandColors.primary
                            : theme.border,
                        backgroundColor:
                          inviteRole === role
                            ? BrandColors.primarySurface
                            : "transparent",
                      },
                    ]}
                  >
                    <ThemedText
                      style={[
                        styles.roleChipText,
                        inviteRole === role && { color: BrandColors.primary },
                      ]}
                    >
                      {roleLabel(role)}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              <PrimaryButton
                label="Send invitation"
                onPress={() => void submitInvite()}
                loading={inviting}
                disabled={!inviteUsername.trim()}
              />
              <ThemedText style={styles.inviteNote} themeColor="textSecondary">
                Invitations expire after 14 days. Seats are limited by the
                workspace plan.
              </ThemedText>
            </View>

            {pending.length > 0 && (
              <>
                <ThemedText style={styles.sectionTitle}>
                  Pending invitations
                </ThemedText>
                <View style={styles.memberList}>
                  {pending.map((member) => (
                    <MemberRow
                      key={member.userId}
                      member={member}
                      actionable={canActOn(member)}
                      busy={busyUserId === member.userId}
                      onWithdraw={() => confirmWithdraw(member)}
                    />
                  ))}
                </View>
              </>
            )}

            <ThemedText style={styles.sectionTitle}>Members</ThemedText>
            <View style={styles.memberList}>
              {active.map((member) => (
                <MemberRow
                  key={member.userId}
                  member={member}
                  self={member.userId === myUserId}
                  actionable={canActOn(member)}
                  busy={busyUserId === member.userId}
                  owner={myRole === "OWNER"}
                  onChangeRole={() => pickRole(member)}
                  onRemove={() => confirmRevoke(member)}
                  onTransfer={() => confirmTransfer(member)}
                />
              ))}
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function MemberRow({
  member,
  self = false,
  actionable,
  busy,
  owner = false,
  onWithdraw,
  onChangeRole,
  onRemove,
  onTransfer,
}: {
  member: BusinessMember;
  self?: boolean;
  actionable: boolean;
  busy: boolean;
  owner?: boolean;
  onWithdraw?: () => void;
  onChangeRole?: () => void;
  onRemove?: () => void;
  onTransfer?: () => void;
}) {
  const theme = useTheme();
  const pending = member.membershipStatus === "PENDING";
  const name = member.displayName ?? member.username ?? "Member";
  const showRemove = (actionable || (self && !pending)) && member.role !== "OWNER";
  return (
    <View
      style={[
        styles.memberRow,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}
    >
      <View style={styles.memberAvatar}>
        <ThemedText style={styles.memberInitial}>
          {name.charAt(0).toUpperCase()}
        </ThemedText>
      </View>
      <View style={styles.memberCopy}>
        <View style={styles.memberNameRow}>
          <ThemedText style={styles.memberName} numberOfLines={1}>
            {name}
            {self ? " (you)" : ""}
          </ThemedText>
          <ThemedText
            style={[
              styles.memberRole,
              member.role === "OWNER" && { color: BrandColors.primary },
            ]}
          >
            {roleLabel(member.role)}
          </ThemedText>
        </View>
        <ThemedText style={styles.memberMeta} themeColor="textSecondary">
          {pending
            ? member.invitationExpired
              ? "Invitation expired"
              : `Invited ${timeAgo(member.invitedAt)}${
                  member.invitedByName ? ` by ${member.invitedByName}` : ""
                }`
            : `Joined ${timeAgo(member.acceptedAt ?? member.invitedAt)}`}
        </ThemedText>
        {(actionable || showRemove) && (
          <View style={styles.actionRow}>
            {pending && actionable && (
              <ActionChip
                label="Withdraw"
                disabled={busy}
                onPress={onWithdraw!}
              />
            )}
            {!pending && actionable && (
              <ActionChip
                label="Change role"
                disabled={busy}
                onPress={onChangeRole!}
              />
            )}
            {!pending && owner && actionable && member.role !== "OWNER" && (
              <ActionChip
                label="Make owner"
                disabled={busy}
                onPress={onTransfer!}
              />
            )}
            {!pending && showRemove && (
              <ActionChip
                label={self ? "Leave" : "Remove"}
                destructive
                disabled={busy}
                onPress={onRemove!}
              />
            )}
          </View>
        )}
      </View>
    </View>
  );
}

function ActionChip({
  label,
  onPress,
  disabled,
  destructive = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.actionChip, { borderColor: theme.border }]}
    >
      <ThemedText
        style={[
          styles.actionChipText,
          { color: destructive ? BrandColors.error : BrandColors.primary },
        ]}
      >
        {label}
      </ThemedText>
    </Pressable>
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
  title: { fontSize: 24, lineHeight: 31, fontWeight: "800" },
  subtitle: { fontSize: 13, lineHeight: 19, marginTop: Spacing.one },
  sectionTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
  },
  inviteCard: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
    marginTop: Spacing.three,
    gap: Spacing.two,
  },
  roleChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  roleChip: {
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  roleChipText: { fontSize: 12, fontWeight: "700" },
  inviteNote: { fontSize: 12, lineHeight: 17 },
  memberList: { gap: Spacing.two },
  memberRow: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
  },
  memberAvatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.primarySurface,
  },
  memberInitial: {
    fontSize: 16,
    fontWeight: "800",
    color: BrandColors.primary,
  },
  memberCopy: { flex: 1, marginLeft: Spacing.three },
  memberNameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  memberName: { flexShrink: 1, fontSize: 15, fontWeight: "700" },
  memberRole: { fontSize: 11, fontWeight: "700" },
  memberMeta: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  actionChip: {
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  actionChipText: { fontSize: 12, fontWeight: "700" },
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
