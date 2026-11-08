/**
 * Communities tab — shows joined communities and lets the user switch
 * the active community context.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { PrimaryButton } from "@/shared/components/primary-button";
import { ErrorState } from "@/shared/components/error-state";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { BrandColors } from "@/shared/theme/colors";
import { Spacing, BorderRadius } from "@/shared/theme/spacing";
import { useSession } from "@/core/session/session-provider";
import { createCommunityApi } from "@/features/communities/services/community-api";
import { createTaxonomyApi } from "@/features/onboarding/services/taxonomy-api";
import type { CommunityView } from "@/features/communities/types/community-types";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { enabledModuleSummary } from "@/core/session/community-capabilities";

export default function CommunitiesTabScreen() {
  const theme = useTheme();
  const { apiClient, session, setActiveCommunity, joinCommunity } =
    useSession();
  const [available, setAvailable] = useState<CommunityView[]>([]);
  const [communityDetails, setCommunityDetails] = useState<
    Map<string, CommunityView>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const communityApi = createCommunityApi(apiClient);
      const taxonomyApi = createTaxonomyApi(apiClient);
      const [availRes, allRes] = await Promise.all([
        communityApi.availableCommunities(),
        taxonomyApi.communities({ active: true }),
      ]);
      setAvailable(availRes.items);
      setCommunityDetails(new Map(allRes.items.map((c) => [c.id, c])));
    } catch (err) {
      setError(
        ApiError.isApiError(err)
          ? err.userMessage
          : "Failed to load communities.",
      );
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  const retry = () => {
    setLoading(true);
    setError(null);
    void load();
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const memberships = session?.memberships ?? [];
  const activeId = session?.activeCommunityId;
  const joinedIds = new Set(memberships.map((m) => m.communityId));
  const unjoined = available.filter((c) => !joinedIds.has(c.id));

  async function handleSetActive(communityId: string) {
    if (switchingId) return;
    setSwitchingId(communityId);
    setSwitchError(null);
    try {
      if (!joinedIds.has(communityId)) await joinCommunity(communityId);
      await setActiveCommunity(communityId);
    } catch (err) {
      setSwitchError(
        ApiError.isApiError(err)
          ? err.userMessage
          : "Failed to switch community.",
      );
    } finally {
      setSwitchingId(null);
    }
  }

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorState message={error} onRetry={retry} />;

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <ThemedText type="title">Communities</ThemedText>
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Joined communities */}
          {memberships.length > 0 ? (
            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>
                Your communities
              </ThemedText>
              {memberships.map((m) => {
                const detail = communityDetails.get(m.communityId);
                const access = session?.access?.communities.find(
                  (context) => context.communityId === m.communityId,
                );
                const isActive = m.communityId === activeId;
                return (
                  <View
                    key={m.communityId}
                    style={[
                      styles.card,
                      {
                        backgroundColor: isActive
                          ? BrandColors.primarySurface
                          : theme.backgroundElement,
                        borderColor: isActive
                          ? BrandColors.primary
                          : "transparent",
                      },
                    ]}
                  >
                    <View style={styles.cardAvatar}>
                      <ThemedText style={styles.cardAvatarText}>
                        {(detail?.name ?? "?")[0].toUpperCase()}
                      </ThemedText>
                    </View>
                    <View style={styles.cardText}>
                      <ThemedText style={styles.cardName}>
                        {detail?.name ?? m.communityId}
                      </ThemedText>
                      {detail?.description ? (
                        <ThemedText
                          style={styles.cardDesc}
                          numberOfLines={1}
                          themeColor="textSecondary"
                        >
                          {detail.description}
                        </ThemedText>
                      ) : null}
                      <ThemedText
                        style={styles.cardRole}
                        themeColor="textSecondary"
                      >
                        {access
                          ? `${access.accessType === "DEFAULT" ? "Default" : "Extended"} · ${enabledModuleSummary(access)}`
                          : m.role.toLowerCase()}
                      </ThemedText>
                    </View>
                    {isActive ? (
                      <ThemedText
                        style={[
                          styles.activeBadge,
                          { color: BrandColors.primary },
                        ]}
                      >
                        Active ✓
                      </ThemedText>
                    ) : (
                      <Pressable
                        onPress={() => void handleSetActive(m.communityId)}
                        disabled={switchingId !== null}
                        accessibilityRole="button"
                        accessibilityLabel={`Set ${detail?.name ?? "community"} as active`}
                        style={({ pressed }) => [
                          styles.setActiveBtn,
                          pressed && styles.pressed,
                        ]}
                      >
                        <ThemedText
                          style={[
                            styles.setActiveBtnText,
                            { color: BrandColors.primary },
                          ]}
                        >
                          {switchingId === m.communityId
                            ? "Switching…"
                            : "Set active"}
                        </ThemedText>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* Discover */}
          {unjoined.length > 0 ? (
            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>Discover</ThemedText>
              {unjoined.map((c) => (
                <View
                  key={c.id}
                  style={[
                    styles.card,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: "transparent",
                    },
                  ]}
                >
                  <View style={styles.cardAvatar}>
                    <ThemedText style={styles.cardAvatarText}>
                      {c.name[0].toUpperCase()}
                    </ThemedText>
                  </View>
                  <View style={styles.cardText}>
                    <ThemedText style={styles.cardName}>{c.name}</ThemedText>
                    <ThemedText
                      style={styles.cardRole}
                      themeColor="textSecondary"
                    >
                      Extended community
                    </ThemedText>
                    {c.description ? (
                      <ThemedText
                        style={styles.cardDesc}
                        numberOfLines={1}
                        themeColor="textSecondary"
                      >
                        {c.description}
                      </ThemedText>
                    ) : null}
                  </View>
                  <PrimaryButton
                    label={switchingId === c.id ? "Joining…" : "Join"}
                    onPress={() => void handleSetActive(c.id)}
                    disabled={switchingId !== null}
                    variant="secondary"
                    style={styles.joinBtn}
                  />
                </View>
              ))}
            </View>
          ) : null}

          {memberships.length === 0 && unjoined.length === 0 ? (
            <View style={styles.empty}>
              <ThemedText style={styles.emptyText} themeColor="textSecondary">
                No communities found for your origin country yet.
              </ThemedText>
            </View>
          ) : null}

          {switchError ? (
            <ThemedText style={styles.switchError} accessibilityRole="alert">
              {switchError}
            </ThemedText>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  scroll: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.four,
  },
  section: { gap: Spacing.two },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    opacity: 0.6,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.two,
    minHeight: 64,
  },
  cardAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: BrandColors.primarySurface,
    alignItems: "center",
    justifyContent: "center",
  },
  cardAvatarText: {
    fontSize: 20,
    fontWeight: "700",
    color: BrandColors.primary,
  },
  cardText: { flex: 1, gap: 2 },
  cardName: { fontSize: 15, fontWeight: "600" },
  cardDesc: { fontSize: 12 },
  cardRole: { fontSize: 11, textTransform: "capitalize" },
  activeBadge: { fontSize: 12, fontWeight: "700" },
  setActiveBtn: { paddingVertical: 6, paddingHorizontal: 10 },
  setActiveBtnText: { fontSize: 13, fontWeight: "600" },
  pressed: { opacity: 0.7 },
  joinBtn: { minWidth: 72, minHeight: 36, paddingVertical: 6 },
  empty: { alignItems: "center", paddingTop: Spacing.six },
  emptyText: { textAlign: "center", fontSize: 14 },
  switchError: { fontSize: 13, color: BrandColors.error, textAlign: "center" },
});
