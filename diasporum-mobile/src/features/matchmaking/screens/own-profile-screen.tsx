import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { ErrorState } from "@/shared/components/error-state";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/shared/theme/spacing";
import { ProfileForm, profileRequestFrom } from "../components/profile-form";
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

export default function OwnProfileScreen() {
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
  const [saved, setSaved] = useState(false);
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
        matchmakingError(
          loadError,
          "Your Matchmaking profile could not be loaded.",
        ),
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
    setSaved(false);
    setError(null);
    try {
      setProfile(await api.saveProfile(request));
      setSaved(true);
    } catch (saveError) {
      setError(
        matchmakingError(
          saveError,
          "Your Matchmaking profile could not be saved.",
        ),
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
      setProfile(await api.profile());
      setConfirmDelete(false);
    } catch (cause) {
      setError(matchmakingError(cause, "The profile could not be deleted."));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const editable =
    profile && ["DRAFT", "ACTIVE", "PAUSED"].includes(profile.status);
  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <ScreenHeader title="My dating profile" />
        {loading ? (
          <ActivityIndicator style={styles.loader} color={theme.primary} />
        ) : error && (!profile || !references) ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : profile && references ? (
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <Section
              title="Your dating space"
              hint="Dating is optional. Pause discovery without closing your existing eligible matches."
            >
              <ThemedText>Profile status: {profile.status}</ThemedText>
              <ThemedText themeColor="textSecondary">
                Verification: {profile.verificationStatus}
              </ThemedText>
              <ToggleRow
                label="Allow Matchmaking discovery"
                value={optIn}
                disabled={privacySaving || !editable}
                hint="Required for discovery and activation. Pausing also removes you from discovery."
                onChange={(value) => void changeOptIn(value)}
              />
              <View style={styles.links}>
                <PrimaryButton
                  label="Discovery preferences"
                  variant="secondary"
                  onPress={() =>
                    router.push("/(app)/matchmaking/preferences" as never)
                  }
                />
                <PrimaryButton
                  label="View matches"
                  variant="secondary"
                  onPress={() =>
                    router.push("/(app)/matchmaking/matches" as never)
                  }
                />
              </View>
            </Section>
            {editable ? (
              <>
                {profile.status === "ACTIVE" ? (
                  <PrimaryButton
                    label="Pause Matchmaking"
                    variant="secondary"
                    loading={saving}
                    disabled={saving}
                    onPress={() => changeStatus("PAUSED")}
                  />
                ) : null}
                {profile.status === "PAUSED" || profile.status === "DRAFT" ? (
                  <PrimaryButton
                    label="Review and activate"
                    disabled={saving || !optIn}
                    onPress={() =>
                      router.push(
                        "/(app)/matchmaking/preferences?activate=true" as never,
                      )
                    }
                  />
                ) : null}
                <ThemedText type="small" themeColor="textSecondary">
                  Save your edits before previewing or leaving this screen.
                </ThemedText>
                <ProfileForm
                  profile={profile}
                  references={references}
                  status={
                    profile.status === "ACTIVE"
                      ? "ACTIVE"
                      : profile.status === "PAUSED"
                        ? "PAUSED"
                        : "DRAFT"
                  }
                  saving={saving}
                  submitLabel="Save profile changes"
                  onSubmit={(request) => void save(request)}
                />
                {saved ? (
                  <ThemedText accessibilityLiveRegion="polite">
                    Your dating profile is saved.
                  </ThemedText>
                ) : null}
                {confirmDelete ? (
                  <Section
                    title="Delete your dating profile?"
                    hint="This permanently stops discovery, closes active matches and disables their chats. Message history and independent follows are retained. You cannot edit a deleted profile."
                  >
                    <PrimaryButton
                      label="Confirm delete"
                      variant="danger"
                      loading={saving}
                      onPress={() => void remove()}
                    />
                    <PrimaryButton
                      label="Keep my profile"
                      variant="secondary"
                      disabled={saving}
                      onPress={() => setConfirmDelete(false)}
                    />
                  </Section>
                ) : (
                  <PrimaryButton
                    label="Delete Matchmaking profile"
                    variant="danger"
                    disabled={saving}
                    onPress={() => setConfirmDelete(true)}
                  />
                )}
              </>
            ) : (
              <EmptyState
                title={
                  profile.status === "SUSPENDED"
                    ? "Matchmaking is suspended"
                    : "Matchmaking profile deleted"
                }
                icon="shield-outline"
                body={
                  profile.status === "SUSPENDED"
                    ? "Profile editing and discovery are unavailable while the account is suspended."
                    : "Dating discovery and linked chats are closed. Stored message history and independent follows are retained."
                }
              />
            )}
            {error ? (
              <ThemedText themeColor="error" accessibilityRole="alert">
                {error}
              </ThemedText>
            ) : null}
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loader: { marginTop: Spacing.six },
  content: {
    padding: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.five,
  },
  links: { gap: Spacing.two },
});
