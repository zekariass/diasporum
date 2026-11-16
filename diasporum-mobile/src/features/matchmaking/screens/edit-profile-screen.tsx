import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { ErrorState } from "@/shared/components/error-state";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/shared/theme/spacing";
import { ProfileForm } from "../components/profile-form";
import { EmptyState } from "../components/matchmaking-ui";
import { useMatchmakingApi } from "../hooks/use-matchmaking-api";
import { matchmakingError } from "../services/matchmaking-errors";
import type {
  MatchmakingProfile,
  MatchmakingProfileRequest,
  MatchmakingReferenceData,
} from "../types/matchmaking-types";

export default function EditProfileScreen() {
  const theme = useTheme();
  const api = useMatchmakingApi();
  const [profile, setProfile] = useState<MatchmakingProfile | null>(null);
  const [references, setReferences] = useState<MatchmakingReferenceData | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ownProfile, referenceData] = await Promise.all([
        api.profile(),
        api.referenceData(),
      ]);
      setProfile(ownProfile);
      setReferences(referenceData);
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
    setError(null);
    try {
      setProfile(await api.saveProfile(request));
      router.back();
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

  const editable =
    profile && ["DRAFT", "ACTIVE", "PAUSED"].includes(profile.status);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => [
              styles.backButton,
              { backgroundColor: theme.backgroundElement },
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <ThemedText type="title" style={styles.headerTitle}>
            Edit Profile
          </ThemedText>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.screenBody}>
          {loading ? (
            <ActivityIndicator style={styles.loader} color={theme.primary} />
          ) : error && (!profile || !references) ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : profile && references && editable ? (
            <>
              {error ? (
                <ThemedText
                  type="small"
                  accessibilityRole="alert"
                  style={[styles.inlineError, { color: theme.error }]}
                >
                  {error}
                </ThemedText>
              ) : null}
              <ProfileForm
                profile={profile}
                references={references}
                status={
                  profile.status === "ACTIVE" || profile.status === "PAUSED"
                    ? profile.status
                    : "DRAFT"
                }
                saving={saving}
                submitLabel="Save Changes"
                onSubmit={save}
              />
            </>
          ) : (
            <EmptyState
              title="Profile unavailable"
              body="This profile cannot be edited in its current state."
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
  header: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "700",
  },
  headerSpacer: { width: 42 },
  screenBody: { flex: 1, width: "100%", maxWidth: 720, alignSelf: "center" },
  loader: { flex: 1 },
  inlineError: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    textAlign: "center",
  },
  pressed: { opacity: 0.7 },
});
