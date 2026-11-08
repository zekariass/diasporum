import React, { useCallback, useRef } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { ErrorState } from "@/shared/components/error-state";
import { PrimaryButton } from "@/shared/components/primary-button";
import { MatchedBadge } from "@/shared/components/matched-badge";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/shared/theme/spacing";
import {
  EmptyState,
  ProfilePhoto,
  ScreenHeader,
} from "../components/matchmaking-ui";
import { useMatchmakingApi } from "../hooks/use-matchmaking-api";
import { usePagedMatchmaking } from "../hooks/use-paged-matchmaking";
import type { MatchView } from "../types/matchmaking-types";

const matchId = (match: MatchView) => match.id;

export default function MatchesScreen() {
  const theme = useTheme();
  const api = useMatchmakingApi();
  const fetcher = useCallback((cursor?: string) => api.matches(cursor), [api]);
  const page = usePagedMatchmaking(
    fetcher,
    matchId,
    "Your matches could not be loaded.",
  );
  const hasFocused = useRef(false);
  const { refresh } = page;
  useFocusEffect(
    useCallback(() => {
      if (hasFocused.current) refresh();
      hasFocused.current = true;
    }, [refresh]),
  );

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <ScreenHeader
          title="Matches"
          subtitle="People who liked you back"
        />
        {page.loading ? (
          <ActivityIndicator style={styles.loader} color={theme.primary} />
        ) : page.error && page.items.length === 0 ? (
          <ErrorState message={page.error} onRetry={page.refresh} />
        ) : (
          <FlatList
            data={page.items}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[
              styles.list,
              page.items.length === 0 && styles.emptyList,
            ]}
            renderItem={({ item }) => (
              <Pressable
                onPress={() =>
                  router.push(
                    `/(app)/matchmaking/matches/${item.id}` as never,
                  )
                }
                accessibilityRole="button"
                accessibilityLabel={`View match with ${item.other.displayName}`}
                style={({ pressed }) => [
                  styles.match,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                  },
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.photoRing}>
                  <ProfilePhoto
                    uri={item.other.photoUrl}
                    name={item.other.displayName}
                    size={62}
                  />
                </View>
                <View style={styles.matchBody}>
                  <View style={styles.nameRow}>
                    <ThemedText
                      type="subtitle"
                      numberOfLines={1}
                      style={styles.name}
                    >
                      {item.other.displayName}
                      {item.other.age ? `, ${item.other.age}` : ""}
                    </ThemedText>
                    {item.other.verificationStatus === "VERIFIED" ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={17}
                        color={theme.primary}
                        accessibilityLabel="Verified"
                      />
                    ) : null}
                  </View>
                  <View style={styles.metaRow}>
                    <MatchedBadge compact />
                    <ThemedText type="small" themeColor="textSecondary">
                      Matched{" "}
                      {new Date(item.matchedAt).toLocaleDateString()}
                    </ThemedText>
                  </View>
                </View>
                {item.conversationId ? (
                  <Pressable
                    onPress={(event) => {
                      event.stopPropagation();
                      router.push(
                        `/(app)/messages/${item.conversationId}` as never,
                      );
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Open chat with ${item.other.displayName}`}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.chatBtn,
                      { backgroundColor: theme.primary },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons
                      name="chatbubble-ellipses"
                      size={19}
                      color="#fff"
                    />
                  </Pressable>
                ) : (
                  <Ionicons
                    name="chevron-forward"
                    size={20}
                    color={theme.textSecondary}
                  />
                )}
              </Pressable>
            )}
            refreshControl={
              <RefreshControl
                refreshing={page.refreshing}
                onRefresh={page.refresh}
                tintColor={theme.primary}
              />
            }
            onEndReached={page.loadMore}
            onEndReachedThreshold={0.35}
            ListEmptyComponent={
              <EmptyState
                title="No active matches yet"
                body="When a like becomes mutual, the match and its ordinary conversation will appear here."
                action={
                  <PrimaryButton
                    label="Discover people"
                    onPress={() => router.push("/(app)/matchmaking" as never)}
                  />
                }
              />
            }
            ListFooterComponent={
              <View style={styles.footer}>
                {page.loadingMore ? (
                  <ActivityIndicator color={theme.primary} />
                ) : null}
                {page.error ? (
                  <>
                    <ThemedText themeColor="error">{page.error}</ThemedText>
                    <PrimaryButton
                      label="Retry loading matches"
                      variant="secondary"
                      onPress={page.retry}
                    />
                  </>
                ) : null}
              </View>
            }
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loader: { marginTop: Spacing.six },
  list: {
    padding: Spacing.three,
    gap: Spacing.two,
    paddingBottom: Spacing.six,
  },
  emptyList: { flexGrow: 1 },
  match: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
    paddingRight: Spacing.three,
  },
  pressed: { opacity: 0.75 },
  photoRing: { padding: 2 },
  matchBody: { flex: 1, gap: 4 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: Spacing.one },
  name: { flexShrink: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  chatBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: { alignItems: "center", gap: Spacing.two, padding: Spacing.two },
});
