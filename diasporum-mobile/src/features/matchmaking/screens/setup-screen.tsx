import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ThemedView } from "@/components/themed-view";
import { ErrorState } from "@/shared/components/error-state";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/shared/theme/spacing";
import { SetupWizard } from "../components/setup-wizard";
import { EmptyState, ScreenHeader } from "../components/matchmaking-ui";
import { useMatchmakingApi } from "../hooks/use-matchmaking-api";
import {
  isMissingResource,
  matchmakingError,
} from "../services/matchmaking-errors";
import { isAdultDateOfBirth } from "../utils/adult-eligibility";
import { loadWizardDraft } from "../utils/wizard-progress";
import DatingDobScreen from "./dob-screen";
import PreferencesScreen from "./preferences-screen";
import type {
  MatchmakingProfile,
  MatchmakingProfileRequest,
  MatchmakingReferenceData,
} from "../types/matchmaking-types";

export default function SetupScreen() {
  const theme = useTheme();
  const api = useMatchmakingApi();
  const { session } = useSession();
  const userId = session?.me?.id ?? null;
  const [profile, setProfile] = useState<MatchmakingProfile | null>(null);
  const [references, setReferences] = useState<MatchmakingReferenceData | null>(
    null,
  );
  const [optIn, setOptIn] = useState(false);
  const [phase, setPhase] = useState<"profile" | "preferences">("profile");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const eligibility = await api.eligibility();
      if (!eligibility.hasDateOfBirth) return;
      if (!eligibility.adult) {
        router.replace("/(app)/matchmaking" as never);
        return;
      }
      const [ownProfile, referenceData, privacy] = await Promise.all([
        api
          .profile()
          .catch((reason) =>
            isMissingResource(reason) ? null : Promise.reject(reason),
          ),
        api.referenceData(),
        api.privacy(),
      ]);
      const saved = ownProfile?.status === "DRAFT"
        ? await loadWizardDraft(userId)
        : null;
      setProfile(ownProfile);
      setReferences(referenceData);
      setOptIn(privacy.allowMatchmakingDiscovery);
      setPhase(saved?.profileSaved ? "preferences" : "profile");
    } catch (loadError) {
      setError(
        matchmakingError(loadError, "Matchmaking setup could not be loaded."),
      );
    } finally {
      setLoading(false);
    }
  }, [api, userId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const changeOptIn = async (value: boolean) => {
    if (savingPrivacy) return;
    setSavingPrivacy(true);
    setError(null);
    try {
      const privacy = await api.setDiscoveryOptIn(value);
      setOptIn(privacy.allowMatchmakingDiscovery);
    } catch (privacyError) {
      setError(
        matchmakingError(
          privacyError,
          "Discovery privacy could not be updated.",
        ),
      );
    } finally {
      setSavingPrivacy(false);
    }
  };
  const save = async (request: MatchmakingProfileRequest) => {
    if (saving) return false;
    setSaving(true);
    setError(null);
    try {
      await api.saveProfile(request);
      setPhase("preferences");
      return true;
    } catch (saveError) {
      setError(
        matchmakingError(
          saveError,
          "Your Matchmaking profile could not be saved.",
        ),
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** Silent draft write used when the wizard exits mid-flow. */
  const saveDraft = async (request: MatchmakingProfileRequest) => {
    const current = await api
      .profile()
      .catch((reason) =>
        isMissingResource(reason) ? null : Promise.reject(reason),
      );
    if (current && current.status !== "DRAFT") return;
    await api.saveProfile(request);
  };

  const adult = isAdultDateOfBirth(session?.profile?.dateOfBirth ?? null);

  // Setup is only for creating/completing a draft — any other lifecycle state is
  // resolved by the entry screen (discovery, paused/suspended/deleted messaging).
  useEffect(() => {
    if (profile && profile.status !== "DRAFT") {
      router.replace("/(app)/matchmaking" as never);
    }
  }, [profile]);

  // Missing DOB is collected first, inside the Dating flow — the same
  // one-time write as the entry-screen gate; the session profile refresh
  // re-evaluates the 18+ requirement below.
  if (!loading && !session?.profile?.dateOfBirth && !error) {
    return <DatingDobScreen onSaved={() => void load()} />;
  }

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        {loading ? (
          <>
            <ScreenHeader
              title="Dating setup"
              subtitle="Private by default, visible only on your terms"
            />
            <ActivityIndicator style={styles.loader} color={theme.primary} />
          </>
        ) : error && !references ? (
          <>
            <ScreenHeader
              title="Dating setup"
              subtitle="Private by default, visible only on your terms"
            />
            <ErrorState message={error} onRetry={() => void load()} />
          </>
        ) : !adult ? (
          <>
            <ScreenHeader
              title="Dating setup"
              subtitle="Private by default, visible only on your terms"
            />
            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
            >
              <EmptyState
                title="Matchmaking is for adults (18+)"
                icon="shield-checkmark-outline"
                body="Matchmaking is available only to members aged 18 or older."
              />
            </ScrollView>
          </>
        ) : references && phase === "preferences" ? (
          <PreferencesScreen
            onboarding
            onBack={() => setPhase("profile")}
          />
        ) : references ? (
          <SetupWizard
            profile={profile}
            references={references}
            optIn={optIn}
            optInSaving={savingPrivacy}
            onOptInChange={(value) => void changeOptIn(value)}
            saving={saving}
            submitError={error}
            onSubmit={save}
            onSaveDraft={saveDraft}
            userId={userId}
          />
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
    gap: Spacing.four,
    flexGrow: 1,
  },
});
