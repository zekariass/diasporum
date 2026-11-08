import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { ErrorState } from "@/shared/components/error-state";
import { PrimaryButton } from "@/shared/components/primary-button";
import { PhotoViewerModal } from "@/shared/components/photo-viewer-modal";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { ProfileDetails, ProfileHero } from "../components/candidate-profile";
import { MatchOverlay } from "../components/match-overlay";
import { SafetySheet, ScreenHeader } from "../components/matchmaking-ui";
import { useMatchmakingApi } from "../hooks/use-matchmaking-api";
import { matchmakingError } from "../services/matchmaking-errors";
import type {
  MatchmakingReferenceData,
  PublicMatchmakingProfile,
  SwipeAction,
  SwipeResult,
} from "../types/matchmaking-types";

function DecisionButton({
  icon,
  label,
  accessibilityLabel,
  onPress,
  disabled,
  loading = false,
  variant,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  disabled: boolean;
  loading?: boolean;
  variant: "pass" | "like";
}) {
  const theme = useTheme();
  const isLike = variant === "like";
  const color = isLike ? "#fff" : "#FB7185";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.decisionButton,
        isLike
          ? [styles.likeButton, { backgroundColor: theme.primary }]
          : [
              styles.passButton,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
              },
            ],
        (pressed || disabled) && { opacity: 0.55 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} size="small" />
      ) : (
        <Ionicons name={icon} size={21} color={color} />
      )}
      <ThemedText style={[styles.decisionText, { color }]}>{label}</ThemedText>
    </Pressable>
  );
}

export default function CandidateProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const api = useMatchmakingApi();
  const params = useLocalSearchParams<{ userId: string }>();
  const userId = String(params.userId);
  const [profile, setProfile] = useState<PublicMatchmakingProfile | null>(null);
  const [references, setReferences] = useState<MatchmakingReferenceData | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const actingRef = useRef(false);
  const [liked, setLiked] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [match, setMatch] = useState<SwipeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [candidate, referenceData] = await Promise.all([
        api.candidate(userId),
        api.referenceData().catch(() => null),
      ]);
      setProfile(candidate);
      setReferences(referenceData);
    } catch (loadError) {
      if (ApiError.isApiError(loadError) && loadError.isForbidden) {
        router.replace("/(app)/matchmaking" as never);
        return;
      }
      setError(
        matchmakingError(loadError, "This Matchmaking profile is unavailable."),
      );
    } finally {
      setLoading(false);
    }
  }, [api, userId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    void load();
  }, [load]);

  const swipe = async (action: SwipeAction) => {
    if (!profile || actingRef.current) return;
    actingRef.current = true;
    setActing(true);
    setError(null);
    try {
      const result = await api.swipe(profile.userId, action);
      if (result.matched) setMatch(result);
      else if (action === "LIKE") setLiked(true);
      else router.back();
    } catch (swipeError) {
      setError(
        matchmakingError(swipeError, "Your decision could not be recorded."),
      );
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  };

  const cancel = async () => {
    if (!profile || actingRef.current) return;
    actingRef.current = true;
    setActing(true);
    setError(null);
    try {
      await api.cancelLike(profile.userId);
      setLiked(false);
    } catch (cancelError) {
      setError(
        matchmakingError(cancelError, "The like could not be cancelled."),
      );
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  };

  const resolvePhoto = useCallback(async (uri: string) => uri, []);
  const showDecisionBar = Boolean(profile) && !blocked && !match;

  if (loading || (error && !profile) || !profile) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
          <ScreenHeader title="Dating profile" />
          {loading ? (
            <View style={styles.loadingState}>
              <View
                style={[
                  styles.loadingIcon,
                  { backgroundColor: theme.primarySurface },
                ]}
              >
                <Ionicons
                  name="heart-outline"
                  size={32}
                  color={theme.primary}
                />
              </View>
              <ActivityIndicator color={theme.primary} />
              <ThemedText themeColor="textSecondary">
                Opening this profile…
              </ThemedText>
            </View>
          ) : error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : null}
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["bottom"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {!blocked ? (
            <>
              <ProfileHero
                profile={profile}
                immersive
                onPress={
                  profile.photoUrl ? () => setPhotoOpen(true) : undefined
                }
              />
              <View style={styles.profileContent}>
                <ProfileDetails
                  profile={profile}
                  references={references}
                  showHero={false}
                />
                <Pressable
                  onPress={() => setSafetyOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Report or block this member"
                  style={({ pressed }) => [
                    styles.safetyLink,
                    { borderColor: theme.border },
                    pressed && { opacity: 0.65 },
                  ]}
                >
                  <Ionicons
                    name="shield-checkmark-outline"
                    size={19}
                    color={theme.textSecondary}
                  />
                  <View style={styles.safetyLinkCopy}>
                    <ThemedText style={styles.safetyLinkTitle}>
                      Safety & privacy
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      Report or block this member privately
                    </ThemedText>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={theme.textSecondary}
                  />
                </Pressable>
                {error ? (
                  <ThemedText
                    themeColor="error"
                    accessibilityRole="alert"
                    style={styles.errorText}
                  >
                    {error}
                  </ThemedText>
                ) : null}
              </View>
            </>
          ) : (
            <View
              style={[styles.blockedState, { paddingTop: insets.top + 80 }]}
            >
              <View
                style={[
                  styles.blockedIcon,
                  { backgroundColor: theme.primarySurface },
                ]}
              >
                <Ionicons
                  name="shield-checkmark"
                  size={40}
                  color={theme.primary}
                />
              </View>
              <ThemedText type="subtitle" style={styles.centerText}>
                Member blocked
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.centerText}>
                This profile and any linked conversation are no longer
                available.
              </ThemedText>
              <PrimaryButton
                label="Back to discovery"
                onPress={() => router.back()}
              />
            </View>
          )}
        </ScrollView>

        {!blocked ? (
          <View
            pointerEvents="box-none"
            style={[styles.floatingHeader, { top: insets.top + 10 }]}
          >
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={8}
              style={({ pressed }) => [
                styles.floatingButton,
                pressed && { opacity: 0.65 },
              ]}
            >
              <Ionicons name="chevron-back" size={25} color="#fff" />
            </Pressable>
            <Pressable
              onPress={() => setSafetyOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Profile safety options"
              hitSlop={8}
              style={({ pressed }) => [
                styles.floatingButton,
                pressed && { opacity: 0.65 },
              ]}
            >
              <Ionicons name="ellipsis-horizontal" size={24} color="#fff" />
            </Pressable>
          </View>
        ) : null}

        {showDecisionBar ? (
          <View
            style={[
              styles.decisionBar,
              {
                backgroundColor: theme.background,
                borderTopColor: theme.border,
                paddingBottom: Math.max(insets.bottom, Spacing.three),
              },
            ]}
          >
            {liked ? (
              <View style={styles.likedBar}>
                <View
                  style={[
                    styles.likedIcon,
                    { backgroundColor: theme.primarySurface },
                  ]}
                >
                  <Ionicons name="heart" size={22} color={theme.primary} />
                </View>
                <View style={styles.likedCopy}>
                  <ThemedText style={styles.likedTitle}>Like sent</ThemedText>
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    numberOfLines={1}
                  >
                    We&apos;ll let you know if it&apos;s mutual
                  </ThemedText>
                </View>
                <Pressable
                  onPress={() => void cancel()}
                  disabled={acting}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel like"
                  style={({ pressed }) => [
                    styles.cancelButton,
                    { borderColor: theme.border },
                    (pressed || acting) && { opacity: 0.55 },
                  ]}
                >
                  {acting ? (
                    <ActivityIndicator size="small" color={theme.primary} />
                  ) : (
                    <ThemedText
                      style={[styles.cancelText, { color: theme.primary }]}
                    >
                      Undo
                    </ThemedText>
                  )}
                </Pressable>
              </View>
            ) : (
              <View style={styles.decisionRow}>
                <DecisionButton
                  icon="close"
                  label="Pass"
                  accessibilityLabel="Pass"
                  variant="pass"
                  disabled={acting}
                  loading={acting}
                  onPress={() => void swipe("PASS")}
                />
                <DecisionButton
                  icon="heart"
                  label="Like"
                  accessibilityLabel="Like"
                  variant="like"
                  disabled={acting}
                  loading={acting}
                  onPress={() => void swipe("LIKE")}
                />
              </View>
            )}
          </View>
        ) : null}

        <SafetySheet
          visible={safetyOpen}
          onClose={() => setSafetyOpen(false)}
          blocked={blocked}
          disabled={acting}
          onReport={(reason, details) =>
            api.reportProfile(userId, reason, details)
          }
          onBlock={async () => {
            await api.block(userId);
            setBlocked(true);
            setMatch(null);
            setSafetyOpen(false);
          }}
        />

        <PhotoViewerModal
          visible={photoOpen && Boolean(profile.photoUrl)}
          mediaIds={profile.photoUrl ? [profile.photoUrl] : []}
          resolve={resolvePhoto}
          onClose={() => setPhotoOpen(false)}
        />
        <MatchOverlay
          match={match}
          profile={profile}
          onOpenChat={(conversationId) =>
            router.replace(`/(app)/messages/${conversationId}` as never)
          }
          onViewMatch={(matchId) =>
            router.replace(`/(app)/matchmaking/matches/${matchId}` as never)
          }
          onDismiss={() => router.back()}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loadingState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.three,
    padding: Spacing.four,
  },
  loadingIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { paddingBottom: 132, flexGrow: 1 },
  profileContent: { padding: Spacing.three, gap: Spacing.three },
  floatingHeader: {
    position: "absolute",
    left: Spacing.three,
    right: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  floatingButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.48)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.24)",
  },
  safetyLink: {
    minHeight: 68,
    borderRadius: BorderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    padding: Spacing.three,
  },
  safetyLinkCopy: { flex: 1, gap: 2 },
  safetyLinkTitle: { fontSize: 14, fontWeight: "700" },
  errorText: { textAlign: "center", lineHeight: 20 },
  decisionBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
  },
  decisionRow: {
    flexDirection: "row",
    gap: Spacing.two,
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
  },
  decisionButton: {
    minHeight: 56,
    borderRadius: BorderRadius.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  passButton: { flex: 0.9, borderWidth: 1 },
  likeButton: { flex: 1.1 },
  decisionText: { fontSize: 16, fontWeight: "800" },
  likedBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    minHeight: 56,
  },
  likedIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  likedCopy: { flex: 1, gap: 2 },
  likedTitle: { fontSize: 15, fontWeight: "800" },
  cancelButton: {
    minWidth: 66,
    minHeight: 42,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  cancelText: { fontSize: 14, fontWeight: "800" },
  blockedState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.three,
    padding: Spacing.four,
  },
  blockedIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  centerText: { textAlign: "center" },
});
