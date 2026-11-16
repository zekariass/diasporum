import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { ErrorState } from "@/shared/components/error-state";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { profileRequestFrom } from "../components/profile-form";
import {
  EmptyState,
  ScreenHeader,
  Section,
  ToggleRow,
} from "../components/matchmaking-ui";
import { useMatchmakingApi } from "../hooks/use-matchmaking-api";
import { matchmakingError } from "../services/matchmaking-errors";
import type {
  MatchmakingProfile,
  MatchmakingProfileRequest,
  MatchmakingReferenceData,
} from "../types/matchmaking-types";

function SettingsCard({
  children,
  danger = false,
}: {
  children: React.ReactNode;
  danger?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          borderColor: danger ? theme.error : theme.border,
          backgroundColor: danger
            ? theme.errorSurface
            : theme.backgroundElement,
        },
      ]}
    >
      {children}
    </View>
  );
}

function SettingsRow({
  icon,
  title,
  subtitle,
  onPress,
  last = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  last?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingsRow,
        !last && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.border,
        },
        pressed && { backgroundColor: theme.primarySurface },
      ]}
    >
      <View
        style={[styles.iconCircle, { backgroundColor: theme.primarySurface }]}
      >
        <Ionicons name={icon} size={20} color={theme.primary} />
      </View>
      <View style={styles.settingsRowCopy}>
        <ThemedText style={styles.settingsRowTitle}>{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {subtitle}
        </ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
    </Pressable>
  );
}

export default function MatchmakingSettingsScreen() {
  const theme = useTheme();
  const api = useMatchmakingApi();
  const [profile, setProfile] = useState<MatchmakingProfile | null>(null);
  const [references, setReferences] = useState<MatchmakingReferenceData | null>(
    null,
  );
  const [optIn, setOptIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const busy = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ownProfile, referenceData, privacy] = await Promise.all([
        api.profile(),
        api.referenceData(),
        api.privacy(),
      ]);
      setProfile(ownProfile);
      setReferences(referenceData);
      setOptIn(privacy.allowMatchmakingDiscovery);
    } catch (loadError) {
      setError(
        matchmakingError(loadError, "Dating settings could not be loaded."),
      );
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const save = async (request: MatchmakingProfileRequest) => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      setProfile(await api.saveProfile(request));
    } catch (saveError) {
      setError(
        matchmakingError(saveError, "The profile could not be updated."),
      );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const changeStatus = (status: "ACTIVE" | "PAUSED") => {
    if (!profile || !references || saving) return;
    void save({ ...profileRequestFrom(profile, references), status });
  };

  const changeOptIn = async (value: boolean) => {
    if (privacySaving) return;
    setPrivacySaving(true);
    setError(null);
    try {
      setOptIn((await api.setDiscoveryOptIn(value)).allowMatchmakingDiscovery);
    } catch (privacyError) {
      setError(
        matchmakingError(
          privacyError,
          "Discovery privacy could not be updated.",
        ),
      );
    } finally {
      setPrivacySaving(false);
    }
  };

  const remove = async () => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      await api.deleteProfile();
      router.replace("/(app)/matchmaking" as never);
    } catch (cause) {
      setError(matchmakingError(cause, "The profile could not be deleted."));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const editable =
    profile && ["DRAFT", "ACTIVE", "PAUSED"].includes(profile.status);
  const active = profile?.status === "ACTIVE";
  const paused = profile?.status === "PAUSED";

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <ScreenHeader
          title="Dating Settings"
          subtitle="Visibility, discovery and account"
        />
        <View style={styles.screenBody}>
          {loading ? (
            <ActivityIndicator style={styles.loader} color={theme.primary} />
          ) : error && (!profile || !references) ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : profile && references ? (
            <ScrollView
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
            >
              {error ? (
                <View
                  style={[
                    styles.errorBanner,
                    { backgroundColor: theme.errorSurface },
                  ]}
                >
                  <Ionicons name="alert-circle" size={20} color={theme.error} />
                  <ThemedText
                    type="small"
                    accessibilityRole="alert"
                    style={[styles.errorText, { color: theme.error }]}
                  >
                    {error}
                  </ThemedText>
                </View>
              ) : null}

              <Section title="Profile status" compact>
                <SettingsCard>
                  <View style={styles.statusBody}>
                    <View style={styles.statusHeader}>
                      <View
                        style={[
                          styles.statusIcon,
                          { backgroundColor: theme.primarySurface },
                        ]}
                      >
                        <Ionicons
                          name={active ? "heart" : paused ? "pause" : "create"}
                          size={24}
                          color={theme.primary}
                        />
                      </View>
                      <View style={styles.statusCopy}>
                        <View style={styles.statusTitleRow}>
                          <ThemedText style={styles.statusTitle}>
                            Your dating profile
                          </ThemedText>
                          <View
                            style={[
                              styles.statusBadge,
                              {
                                backgroundColor: active
                                  ? theme.successSurface
                                  : paused
                                    ? theme.warningSurface
                                    : theme.primarySurface,
                              },
                            ]}
                          >
                            <ThemedText
                              style={[
                                styles.statusBadgeText,
                                {
                                  color: active
                                    ? theme.success
                                    : paused
                                      ? theme.warning
                                      : theme.primary,
                                },
                              ]}
                            >
                              {profile.status}
                            </ThemedText>
                          </View>
                        </View>
                        <ThemedText type="small" themeColor="textSecondary">
                          {active
                            ? "Your profile is live and ready to be discovered."
                            : paused
                              ? "Your profile is hidden until you resume it."
                              : "Finish setup to make your profile visible."}
                        </ThemedText>
                      </View>
                    </View>
                    {active ? (
                      <PrimaryButton
                        label="Pause profile"
                        variant="secondary"
                        loading={saving}
                        onPress={() => changeStatus("PAUSED")}
                      />
                    ) : paused ? (
                      <PrimaryButton
                        label="Resume profile"
                        loading={saving}
                        onPress={() => changeStatus("ACTIVE")}
                      />
                    ) : null}
                  </View>
                </SettingsCard>
              </Section>

              <Section
                title="Discovery & privacy"
                hint="Control who can find you and what candidates see."
                compact
              >
                <SettingsCard>
                  <View
                    style={[
                      styles.toggleBody,
                      { borderBottomColor: theme.border },
                    ]}
                  >
                    <ToggleRow
                      label="Allow discovery"
                      hint="Show your profile to other members in matchmaking discovery."
                      value={optIn}
                      disabled={privacySaving}
                      onChange={changeOptIn}
                    />
                  </View>
                  <SettingsRow
                    icon="options-outline"
                    title="Dating preferences"
                    subtitle="Age range, distance and compatibility filters"
                    onPress={() =>
                      router.push("/(app)/matchmaking/preferences" as never)
                    }
                  />
                  <SettingsRow
                    icon="eye-off-outline"
                    title="Profile privacy"
                    subtitle="Manage your hidden name and blurred photos"
                    onPress={() =>
                      router.push("/(app)/matchmaking/edit-profile" as never)
                    }
                  />
                  <SettingsRow
                    icon="ban-outline"
                    title="Blocked members"
                    subtitle="Review people you have blocked in dating"
                    last
                    onPress={() =>
                      router.push("/(app)/matchmaking/blocked" as never)
                    }
                  />
                </SettingsCard>
              </Section>

              {editable ? (
                <Section
                  title="Account"
                  hint="Deleting your dating profile cannot be undone."
                  compact
                >
                  <SettingsCard danger>
                    <View style={styles.dangerBody}>
                      <View style={styles.dangerHeading}>
                        <Ionicons
                          name="trash-outline"
                          size={22}
                          color={theme.error}
                        />
                        <View style={styles.dangerCopy}>
                          <ThemedText
                            style={[styles.dangerTitle, { color: theme.error }]}
                          >
                            Delete dating profile
                          </ThemedText>
                          <ThemedText type="small" themeColor="textSecondary">
                            Remove your dating profile and photos. Existing
                            matches and conversations follow your account rules.
                          </ThemedText>
                        </View>
                      </View>
                      {confirmDelete ? (
                        <View style={styles.confirmActions}>
                          <PrimaryButton
                            label="Delete profile"
                            variant="danger"
                            loading={saving}
                            onPress={() => void remove()}
                            style={styles.confirmButton}
                          />
                          <PrimaryButton
                            label="Cancel"
                            variant="secondary"
                            onPress={() => setConfirmDelete(false)}
                            style={styles.confirmButton}
                          />
                        </View>
                      ) : (
                        <PrimaryButton
                          label="Delete dating profile"
                          variant="danger"
                          onPress={() => setConfirmDelete(true)}
                        />
                      )}
                    </View>
                  </SettingsCard>
                </Section>
              ) : null}
            </ScrollView>
          ) : (
            <EmptyState
              title="No dating profile"
              body="Create your dating profile first."
              icon="heart-outline"
            />
          )}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  screenBody: { flex: 1, width: "100%", maxWidth: 680, alignSelf: "center" },
  loader: { flex: 1 },
  content: {
    padding: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.five,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.xl,
    overflow: "hidden",
  },
  statusBody: { padding: Spacing.four, gap: Spacing.four },
  statusHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.three,
  },
  statusIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  statusCopy: { flex: 1, gap: Spacing.one },
  statusTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  statusTitle: { fontSize: 18, fontWeight: "700" },
  statusBadge: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  statusBadgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  toggleBody: {
    padding: Spacing.four,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    padding: Spacing.four,
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsRowCopy: { flex: 1, gap: 2 },
  settingsRowTitle: { fontSize: 16, fontWeight: "700" },
  dangerBody: { padding: Spacing.four, gap: Spacing.four },
  dangerHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.three,
  },
  dangerCopy: { flex: 1, gap: Spacing.one },
  dangerTitle: { fontSize: 17, fontWeight: "700" },
  confirmActions: { flexDirection: "row", gap: Spacing.two },
  confirmButton: { flex: 1, minWidth: 0, paddingHorizontal: Spacing.two },
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
  },
  errorText: { flex: 1 },
});
