import React, { useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useTheme } from "@/hooks/use-theme";
import { useSession } from "@/core/session/session-provider";
import { createProfileApi } from "@/features/profile/services/profile-api";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { ScreenHeader } from "../components/matchmaking-ui";
import { useMatchmakingApi } from "../hooks/use-matchmaking-api";
import { matchmakingError } from "../services/matchmaking-errors";
import type { MatchmakingEligibility } from "../types/matchmaking-types";

type IconName = keyof typeof Ionicons.glyphMap;

interface StatusContent {
  icon: IconName;
  title: string;
  body: string;
  action?: string;
  secondary?: string;
}

/** Restricted/transition Dating states — paused, suspended, deleted, age-gated, opt-in off. */
export default function DatingStatusScreen({
  eligibility,
  onChanged,
}: {
  eligibility: MatchmakingEligibility;
  /** Re-resolve eligibility after an in-place fix (e.g. discovery opt-in). */
  onChanged: () => void;
}) {
  const theme = useTheme();
  const api = useMatchmakingApi();
  const { apiClient, session } = useSession();
  const profileApi = useMemo(() => createProfileApi(apiClient), [apiClient]);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enableDiscovery = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.setDiscoveryOptIn(true);
      onChanged();
    } catch (cause) {
      setError(
        matchmakingError(cause, "Discovery privacy could not be updated."),
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmAge = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await profileApi.confirmAge();
      onChanged();
    } catch (cause) {
      setError(
        matchmakingError(cause, "Your confirmation could not be saved."),
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const content = (): StatusContent => {
    switch (eligibility.reason) {
      case "AGE_CONFIRMATION_REQUIRED":
        return {
          icon: "shield-checkmark-outline",
          title: "Confirm your age eligibility",
          body: `Your saved date of birth is ${session?.profile?.dateOfBirth ?? "available in your profile"}. Confirm that it is accurate and you are at least 18. This does not change your birth date. If it is incorrect, contact support.`,
          action: "I confirm I am 18 or older",
        };
      case "PROFILE_PAUSED":
        return {
          icon: "pause-circle-outline",
          title: "Dating is paused",
          body: "Your Dating profile is hidden from discovery. Existing matches and conversations stay available — resume when you are ready.",
          action: "Resume Dating",
          secondary: "View matches",
        };
      case "PROFILE_SUSPENDED":
        return {
          icon: "shield-outline",
          title: "Dating is unavailable",
          body: "Your Dating profile is suspended, so discovery and interactions are disabled. If you believe this is a mistake, contact support from Settings.",
          secondary: "View my profile",
        };
      case "PROFILE_DELETED":
        return {
          icon: "trash-outline",
          title: "Dating profile deleted",
          body: "Your Dating profile and matches are closed, and their chats are disabled. Message history and independent follows are retained. A deleted profile cannot be restored.",
        };
      case "NOT_ADULT":
        // Only reached with a stored DOB that fails the server-side 18+
        // check — missing DOB goes through the DOB form (DOB_REQUIRED).
        return {
          icon: "calendar-outline",
          title: "Matchmaking is for adults (18+)",
          body: "Dating is available only to members aged 18 or older. Based on the date of birth on your account, you cannot use Matchmaking yet.",
        };
      case "DISCOVERY_OPT_IN_REQUIRED":
        return {
          icon: "eye-off-outline",
          title: "Discovery is turned off",
          body: "Your Dating profile is active, but Matchmaking discovery is switched off in your privacy settings. Turn it on to discover and be discovered.",
          action: "Turn on discovery",
        };
      default:
        return {
          icon: "alert-circle-outline",
          title: "Dating is not available yet",
          body: "Complete your Dating profile before discovering other members.",
          action: "Continue setup",
        };
    }
  };

  const { icon, title, body, action, secondary } = content();
  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <ScreenHeader title="Dating" />
        <ScrollView contentContainerStyle={styles.content}>
          <View
            style={[styles.iconWrap, { backgroundColor: theme.primarySurface }]}
          >
            <Ionicons name={icon} size={34} color={theme.primary} />
          </View>
          <ThemedText type="title" style={styles.center}>
            {title}
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.body}>
            {body}
          </ThemedText>
          {error ? (
            <ThemedText themeColor="error" accessibilityRole="alert">
              {error}
            </ThemedText>
          ) : null}
          {action ? (
            <PrimaryButton
              label={action}
              loading={busy}
              onPress={() => {
                if (eligibility.reason === "AGE_CONFIRMATION_REQUIRED")
                  void confirmAge();
                else if (eligibility.reason === "DISCOVERY_OPT_IN_REQUIRED")
                  void enableDiscovery();
                else
                  router.push(
                    eligibility.reason === "PROFILE_PAUSED"
                      ? ("/(app)/matchmaking/profile" as never)
                      : ("/(app)/matchmaking/setup" as never),
                  );
              }}
            />
          ) : null}
          {secondary ? (
            <PrimaryButton
              label={secondary}
              variant="secondary"
              onPress={() => {
                router.push(
                  eligibility.reason === "PROFILE_PAUSED"
                    ? ("/(app)/matchmaking/matches" as never)
                    : ("/(app)/matchmaking/profile" as never),
                );
              }}
            />
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.four,
    gap: Spacing.four,
  },
  iconWrap: {
    width: 76,
    height: 76,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  center: { textAlign: "center" },
  body: { textAlign: "center", fontSize: 15, lineHeight: 22, maxWidth: 330 },
});
