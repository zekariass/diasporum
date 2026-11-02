/**
 * EventParticipantsScreen — paginated participant browsing with RSVP status
 * filters. Every request hits the authorized participants endpoint, so the
 * backend only ever returns data for events the viewer can access; the client
 * adds no bypass of its own.
 * Route: /(app)/events/participants/[id]
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { safeBack } from "@/core/navigation/safe-back";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { ErrorState } from "@/shared/components/error-state";
import { useSession } from "@/core/session/session-provider";
import { createEventApi } from "../services/event-api";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import type { EventParticipant, RsvpStatus } from "../types/event-types";

type StatusFilter = "ALL" | RsvpStatus;

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "GOING", label: "Going" },
  { key: "INTERESTED", label: "Interested" },
  { key: "WAITLISTED", label: "Waitlisted" },
];

const PAGE_SIZE = 20;

export default function EventParticipantsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { apiClient } = useSession();
  const eventApi = React.useMemo(() => createEventApi(apiClient), [apiClient]);

  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [items, setItems] = useState<EventParticipant[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventTitle, setEventTitle] = useState<string | null>(null);

  const loadPage = useCallback(
    async (filter: StatusFilter, nextPage: number) => {
      if (nextPage === 0) setLoading(true);
      else setLoadingMore(true);
      try {
        const r = await eventApi.participants(
          id,
          filter === "ALL" ? undefined : filter,
          nextPage,
          PAGE_SIZE,
        );
        setItems((prev) => (nextPage === 0 ? r.items : [...prev, ...r.items]));
        setHasMore(r.items.length === PAGE_SIZE);
        setPage(nextPage);
        setError(null);
      } catch (e) {
        setError(
          ApiError.isApiError(e)
            ? e.userMessage
            : "Failed to load participants.",
        );
      } finally {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    },
    [eventApi, id],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state updates happen asynchronously after the fetch resolves
    void loadPage(status, 0);
  }, [loadPage, status]);

  useEffect(() => {
    let cancelled = false;
    eventApi
      .eventDetail(id)
      .then((d) => {
        if (!cancelled) setEventTitle(d.event.title);
      })
      .catch(() => {
        /* title is decorative only */
      });
    return () => {
      cancelled = true;
    };
  }, [eventApi, id]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void loadPage(status, 0);
  }, [loadPage, status]);

  const changeFilter = (next: StatusFilter) => {
    if (next === status) return;
    setStatus(next);
  };

  return (
    <ThemedView style={s.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={s.safeArea} edges={["top", "left", "right"]}>
        <View style={[s.header, { borderBottomColor: theme.border }]}>
          <Pressable
            onPress={safeBack}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={24} color={theme.text} />
          </Pressable>
          <View style={s.headerTitles}>
            <ThemedText type="title" style={s.headerTitle}>
              Participants
            </ThemedText>
            {eventTitle && (
              <ThemedText
                style={s.headerSub}
                themeColor="textSecondary"
                numberOfLines={1}
              >
                {eventTitle}
              </ThemedText>
            )}
          </View>
          <View style={s.headerSpacer} />
        </View>

        <View style={s.filterRow}>
          {FILTERS.map((f) => (
            <FilterChip
              key={f.key}
              label={f.label}
              active={status === f.key}
              onPress={() => changeFilter(f.key)}
            />
          ))}
        </View>

        {loading ? (
          <LoadingScreen />
        ) : error && items.length === 0 ? (
          <ErrorState
            message={error}
            onRetry={() => void loadPage(status, 0)}
          />
        ) : (
          <ScrollView
            style={s.list}
            contentContainerStyle={s.listContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={refresh}
                tintColor={theme.text}
              />
            }
          >
            {items.length === 0 && (
              <ThemedText style={s.empty} themeColor="textSecondary">
                No participants in this list yet.
              </ThemedText>
            )}
            {items.map((p) => (
              <ParticipantRow key={p.profile.id} participant={p} />
            ))}
            {hasMore && (
              <Pressable
                onPress={() => void loadPage(status, page + 1)}
                disabled={loadingMore}
                accessibilityRole="button"
                accessibilityLabel="Load more participants"
                style={[
                  s.moreBtn,
                  { borderColor: theme.border },
                  loadingMore && { opacity: 0.6 },
                ]}
              >
                <ThemedText style={s.moreText}>
                  {loadingMore ? "Loading…" : "Load more"}
                </ThemedText>
              </Pressable>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function ParticipantRow({ participant }: { participant: EventParticipant }) {
  const theme = useTheme();
  const name =
    participant.profile.displayName ?? `@${participant.profile.username}`;
  return (
    <View style={[s.row, { borderBottomColor: theme.border }]}>
      <View
        style={[
          s.avatarPlaceholder,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
          },
        ]}
      >
        <Ionicons name="person" size={18} color={BrandColors.primary} />
      </View>
      <View style={s.rowText}>
        <ThemedText style={s.rowName} numberOfLines={1}>
          {name}
        </ThemedText>
        {participant.profile.displayName && (
          <ThemedText
            style={s.rowHandle}
            themeColor="textSecondary"
            numberOfLines={1}
          >
            @{participant.profile.username}
          </ThemedText>
        )}
      </View>
      <StatusBadge status={participant.rsvpStatus} />
    </View>
  );
}

function StatusBadge({ status }: { status: RsvpStatus }) {
  const label =
    status === "GOING"
      ? "Going"
      : status === "INTERESTED"
        ? "Interested"
        : status === "WAITLISTED"
          ? "Waitlisted"
          : "Not going";
  return <ThemedText style={s.statusText}>{label}</ThemedText>;
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={[
        s.chip,
        {
          backgroundColor: active
            ? BrandColors.primary
            : theme.backgroundElement,
          borderColor: active ? BrandColors.primary : theme.border,
        },
      ]}
    >
      <ThemedText style={[s.chipText, active && { color: BrandColors.white }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitles: { flex: 1 },
  headerTitle: { fontSize: 18 },
  headerSub: { fontSize: 12, marginTop: 1 },
  headerSpacer: { width: 24 },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  chip: {
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  chipText: { fontSize: 13, fontWeight: "600" },
  list: { flex: 1 },
  listContent: { paddingBottom: Spacing.six },
  empty: { padding: Spacing.four, fontSize: 14 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 1 },
  rowName: { fontSize: 15, fontWeight: "600" },
  rowHandle: { fontSize: 12 },
  statusText: { fontSize: 13, fontWeight: "600", color: BrandColors.primary },
  moreBtn: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    marginHorizontal: Spacing.four,
    marginTop: Spacing.three,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  moreText: { fontSize: 14, fontWeight: "600" },
});
