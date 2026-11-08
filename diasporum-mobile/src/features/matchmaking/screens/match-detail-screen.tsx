import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { ErrorState } from "@/shared/components/error-state";
import { PrimaryButton } from "@/shared/components/primary-button";
import { MatchedBadge } from "@/shared/components/matched-badge";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/shared/theme/spacing";
import { ProfileDetails } from "../components/candidate-profile";
import {
  SafetyActions,
  ScreenHeader,
  Section,
} from "../components/matchmaking-ui";
import { useMatchmakingApi } from "../hooks/use-matchmaking-api";
import { matchmakingError } from "../services/matchmaking-errors";
import type {
  MatchView,
  MatchmakingReferenceData,
} from "../types/matchmaking-types";

export default function MatchDetailScreen() {
  const theme = useTheme();
  const api = useMatchmakingApi();
  const params = useLocalSearchParams<{ matchId: string }>();
  const matchId = String(params.matchId);
  const [match, setMatch] = useState<MatchView | null>(null);
  const [references, setReferences] = useState<MatchmakingReferenceData | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const actingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [confirmUnmatch, setConfirmUnmatch] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detail, referenceData] = await Promise.all([
        api.match(matchId),
        api.referenceData().catch(() => null),
      ]);
      setMatch(detail);
      setReferences(referenceData);
    } catch (loadError) {
      setError(matchmakingError(loadError, "This match is unavailable."));
    } finally {
      setLoading(false);
    }
  }, [api, matchId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const run = async (operation: () => Promise<void>) => {
    if (actingRef.current) return;
    actingRef.current = true;
    setActing(true);
    setError(null);
    try {
      await operation();
    } catch (actionError) {
      setError(
        matchmakingError(
          actionError,
          "The requested action could not be completed.",
        ),
      );
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <ScreenHeader title="Match details" />
        {loading ? (
          <ActivityIndicator style={styles.loader} color={theme.primary} />
        ) : error && !match ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : match ? (
          <ScrollView contentContainerStyle={styles.content}>
            {!blocked && match.status === "MATCHED" ? <MatchedBadge /> : null}
            <ThemedText themeColor="textSecondary">
              {match.status === "MATCHED"
                ? `Matched ${new Date(match.matchedAt).toLocaleDateString()}`
                : `Match status: ${match.status}`}
            </ThemedText>
            {!blocked ? (
              <ProfileDetails profile={match.other} references={references} />
            ) : null}
            {match.status !== "MATCHED" ? (
              <ThemedText themeColor="textSecondary">
                This match has ended and its chat is closed. Previous messages
                are preserved, and you cannot match again.
              </ThemedText>
            ) : null}
            {!blocked ? (
              <Section title="Your connection">
                {match.status === "MATCHED" && match.conversationId ? (
                  <PrimaryButton
                    label="Open chat"
                    onPress={() =>
                      router.push(
                        `/(app)/messages/${match.conversationId}` as never,
                      )
                    }
                  />
                ) : null}
                {match.status === "MATCHED" ? (
                  <PrimaryButton
                    label="Unmatch"
                    variant="secondary"
                    disabled={acting}
                    onPress={() => setConfirmUnmatch(true)}
                  />
                ) : null}
                {confirmUnmatch ? (
                  <>
                    <ThemedText>
                      End this match? Chat will close, history will be
                      preserved, and you cannot match again. Independent follows
                      are unchanged.
                    </ThemedText>
                    <PrimaryButton
                      label="Confirm unmatch"
                      variant="danger"
                      loading={acting}
                      onPress={() =>
                        void run(async () => {
                          setMatch(await api.unmatch(match.id));
                          setConfirmUnmatch(false);
                        })
                      }
                    />
                    <PrimaryButton
                      label="Keep match"
                      variant="ghost"
                      disabled={acting}
                      onPress={() => setConfirmUnmatch(false)}
                    />
                  </>
                ) : null}
              </Section>
            ) : null}
            <SafetyActions
              disabled={acting}
              blocked={blocked}
              onReport={(reason, details) =>
                api.reportMatch(match.id, reason, details)
              }
              onBlock={async () => {
                await api.block(match.other.userId);
                setBlocked(true);
              }}
            />
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
    gap: Spacing.four,
  },
});
