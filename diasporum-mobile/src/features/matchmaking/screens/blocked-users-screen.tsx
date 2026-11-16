import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ErrorState } from "@/shared/components/error-state";
import { EmptyState, ScreenHeader } from "../components/matchmaking-ui";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/shared/theme/spacing";
import type { BlockedUser } from "../types/matchmaking-types";
import { useMatchmakingApi } from "../hooks/use-matchmaking-api";
import { matchmakingError } from "../services/matchmaking-errors";

/**
 * Blocked members management — blocks live in the shared social graph, so
 * this screen manages them rather than duplicating a dating-specific list.
 * Unblocking does not restore any previous match; discovery only resumes
 * when both members still have active profiles.
 */
export default function BlockedUsersScreen() {
  const theme = useTheme();
  const api = useMatchmakingApi();
  const [users, setUsers] = useState<BlockedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api.blockedUsers();
      setUsers(result.items);
    } catch (cause) {
      setError(matchmakingError(cause, "Blocked members could not be loaded."));
    }
  }, [api]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const unblock = async (user: BlockedUser) => {
    if (busyId) return;
    setBusyId(user.id);
    setError(null);
    try {
      await api.unblock(user.id);
      setUsers((current) =>
        (current ?? []).filter((item) => item.id !== user.id),
      );
    } catch (cause) {
      setError(matchmakingError(cause, "The member could not be unblocked."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ThemedView style={styles.root}>
      <ScreenHeader title="Blocked members" />
      {users === null && !error ? (
        <ActivityIndicator style={styles.loader} color={theme.primary} />
      ) : error && users === null ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !users?.length ? (
        <EmptyState
          title="No blocked members"
          body="Members you block disappear from discovery, Likes and matches. Unblocking does not restore a previous match."
          icon="ban-outline"
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {users.map((user) => (
            <View
              key={user.id}
              style={[
                styles.row,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.backgroundElement,
                },
              ]}
            >
              <View
                style={[styles.avatar, { backgroundColor: theme.primarySurface }]}
              >
                <Ionicons name="person" size={20} color={theme.primary} />
              </View>
              <View style={styles.rowBody}>
                <ThemedText type="subtitle">
                  {user.displayName ?? "Diasporum member"}
                </ThemedText>
                {user.username ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    @{user.username}
                  </ThemedText>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Unblock ${user.displayName ?? user.username ?? "member"}`}
                disabled={busyId === user.id}
                onPress={() => void unblock(user)}
                style={({ pressed }) => [
                  styles.unblock,
                  { borderColor: theme.border },
                  pressed && { opacity: 0.7 },
                ]}
              >
                {busyId === user.id ? (
                  <ActivityIndicator size="small" color={theme.primary} />
                ) : (
                  <ThemedText style={{ color: theme.primary, fontWeight: "700" }}>
                    Unblock
                  </ThemedText>
                )}
              </Pressable>
            </View>
          ))}
          {error ? (
            <ThemedText themeColor="error" accessibilityRole="alert">
              {error}
            </ThemedText>
          ) : null}
        </ScrollView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loader: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.two },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.three,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: { flex: 1 },
  unblock: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 84,
    alignItems: "center",
  },
});
