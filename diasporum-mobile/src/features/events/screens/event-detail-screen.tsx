/**
 * EventDetailScreen — full event view with RSVP controls, save/unsave,
 * participant preview, organizer info and manager lifecycle actions.
 * Route: /(app)/events/[id]
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import type { EventDetail, RsvpStatus } from "../types/event-types";
import { formatEventDate } from "../utils/event-time";
import { EventCover } from "../components/event-cover";

const REPORT_REASONS = [
  "SPAM",
  "HARASSMENT",
  "MISINFORMATION",
  "ILLEGAL",
  "OTHER",
] as const;

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { apiClient } = useSession();
  const eventApi = React.useMemo(() => createEventApi(apiClient), [apiClient]);

  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rsvpBusy, setRsvpBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [participantNames, setParticipantNames] = useState<string[]>([]);
  // Snapshot at mount: "started" only needs an approximate current time.
  const [now] = useState(() => Date.now());

  // State updates live in promise continuations so the mount effect never
  // sets state synchronously (react-hooks/set-state-in-effect).
  const load = useCallback(() => {
    return Promise.all([
      eventApi.eventDetail(id),
      eventApi.participants(id, undefined, 0, 6).catch(() => null),
    ])
      .then(([d, participants]) => {
        setDetail(d);
        setParticipantNames(
          (participants?.items ?? []).map(
            (p) => p.profile.displayName ?? p.profile.username,
          ),
        );
        setError(null);
      })
      .catch((e: unknown) => {
        setError(
          ApiError.isApiError(e) ? e.userMessage : "Failed to load event.",
        );
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [eventApi, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  const setRsvp = useCallback(
    async (status: RsvpStatus) => {
      if (rsvpBusy) return;
      setRsvpBusy(true);
      setActionError(null);
      try {
        const r = await eventApi.setRsvp(id, status);
        setDetail(
          (prev) =>
            prev && {
              ...prev,
              myRsvp: r.status,
              counts: r.counts,
            },
        );
        if (r.status === "WAITLISTED") {
          Alert.alert(
            "Waitlisted",
            "This event is full — you were added to the waitlist.",
          );
        }
      } catch (e) {
        setActionError(
          ApiError.isApiError(e)
            ? e.userMessage
            : "Could not update your RSVP.",
        );
      } finally {
        setRsvpBusy(false);
        void load();
      }
    },
    [eventApi, id, rsvpBusy, load],
  );

  const removeRsvp = useCallback(async () => {
    if (rsvpBusy) return;
    setRsvpBusy(true);
    setActionError(null);
    try {
      const r = await eventApi.removeRsvp(id);
      setDetail((prev) => prev && { ...prev, myRsvp: null, counts: r.counts });
    } catch (e) {
      setActionError(
        ApiError.isApiError(e) ? e.userMessage : "Could not remove your RSVP.",
      );
    } finally {
      setRsvpBusy(false);
    }
  }, [eventApi, id, rsvpBusy]);

  const toggleSave = useCallback(async () => {
    if (!detail) return;
    const saving = !detail.saved;
    setDetail((prev) => prev && { ...prev, saved: saving });
    try {
      if (saving) await eventApi.saveEvent(id);
      else await eventApi.unsaveEvent(id);
    } catch {
      setDetail((prev) => prev && { ...prev, saved: !saving });
      setActionError("Could not update saved events.");
    }
  }, [detail, eventApi, id]);

  const publish = useCallback(async () => {
    try {
      await eventApi.publishEvent(id);
      void load();
    } catch (e) {
      setActionError(
        ApiError.isApiError(e) ? e.userMessage : "Could not publish the event.",
      );
    }
  }, [eventApi, id, load]);

  const cancelEvent = useCallback(() => {
    const confirmCancel = (reason?: string) => {
      eventApi
        .cancelEvent(id, reason || undefined)
        .then(() => load())
        .catch((e) =>
          setActionError(
            ApiError.isApiError(e)
              ? e.userMessage
              : "Could not cancel the event.",
          ),
        );
    };
    if (Platform.OS === "ios" && typeof Alert.prompt === "function") {
      Alert.prompt(
        "Cancel event",
        "Attendees will no longer be able to join. Optionally state the reason.",
        [
          { text: "Abort", style: "cancel" },
          {
            text: "Cancel event",
            style: "destructive",
            onPress: (reason?: string) => confirmCancel(reason),
          },
        ],
      );
    } else {
      Alert.alert(
        "Cancel event?",
        "Attendees will no longer be able to join this event.",
        [
          { text: "Abort", style: "cancel" },
          {
            text: "Cancel event",
            style: "destructive",
            onPress: () => confirmCancel(),
          },
        ],
      );
    }
  }, [eventApi, id, load]);

  const deleteEvent = useCallback(() => {
    Alert.alert("Delete event?", "This cannot be undone.", [
      { text: "Abort", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          eventApi
            .deleteEvent(id)
            .then(() => {
              if (router.canGoBack()) router.back();
              else router.replace("/(app)/events" as never);
            })
            .catch((e) =>
              setActionError(
                ApiError.isApiError(e)
                  ? e.userMessage
                  : "Could not delete the event.",
              ),
            );
        },
      },
    ]);
  }, [eventApi, id, router]);

  const report = useCallback(() => {
    Alert.alert("Report event", "Why are you reporting this event?", [
      ...REPORT_REASONS.map((r) => ({
        text:
          r === "MISINFORMATION"
            ? "Misinformation"
            : r.charAt(0) + r.slice(1).toLowerCase(),
        onPress: () => {
          eventApi
            .reportEvent(id, r)
            .then(() =>
              Alert.alert("Reported", "Thanks — our team will review it."),
            )
            .catch((e) =>
              setActionError(
                ApiError.isApiError(e)
                  ? e.userMessage
                  : "Could not report the event.",
              ),
            );
        },
      })),
      { text: "Abort", style: "cancel" },
    ]);
  }, [eventApi, id]);

  const openLink = useCallback(async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      setActionError("Unable to open the link.");
    }
  }, []);

  if (loading) return <LoadingScreen />;
  if (error || !detail)
    return <ErrorState message={error ?? "Event not found."} onRetry={load} />;

  const e = detail.event;
  const cancelled = e.cancelledAt !== null;
  const isDraft = e.status === "DRAFT";
  const started = new Date(e.startsAt).getTime() < now;
  const rsvpBlocked = cancelled || isDraft || started;

  return (
    <ThemedView style={s.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={s.safeArea} edges={["top", "left", "right"]}>
        {/* Header */}
        <View style={[s.header, { borderBottomColor: theme.border }]}>
          <Pressable
            onPress={safeBack}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={24} color={theme.text} />
          </Pressable>
          <ThemedText type="title" style={s.headerTitle} numberOfLines={1}>
            Event
          </ThemedText>
          <Pressable
            onPress={() => void toggleSave()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={
              detail.saved ? "Remove from saved events" : "Save event"
            }
          >
            <Ionicons
              name={detail.saved ? "bookmark" : "bookmark-outline"}
              size={22}
              color={detail.saved ? BrandColors.primary : theme.text}
            />
          </Pressable>
        </View>

        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={BrandColors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.content}
        >
          <EventCover
            eventId={e.id}
            coverMediaId={e.coverMediaId}
            style={s.cover}
          />

          {/* Status banners */}
          {cancelled && (
            <View
              style={[s.banner, { backgroundColor: BrandColors.errorSurface }]}
            >
              <Ionicons
                name="alert-circle"
                size={18}
                color={BrandColors.error}
              />
              <View style={s.bannerText}>
                <ThemedText
                  style={[s.bannerTitle, { color: BrandColors.error }]}
                >
                  Cancelled
                </ThemedText>
                {e.cancelReason ? (
                  <ThemedText
                    style={[s.bannerBody, { color: BrandColors.error }]}
                  >
                    {e.cancelReason}
                  </ThemedText>
                ) : null}
              </View>
            </View>
          )}
          {isDraft && !cancelled && (
            <View
              style={[
                s.banner,
                { backgroundColor: BrandColors.warningSurface },
              ]}
            >
              <Ionicons
                name="eye-off-outline"
                size={18}
                color={BrandColors.warning}
              />
              <ThemedText
                style={[s.bannerTitle, { color: BrandColors.warning }]}
              >
                Draft — only you can see this event
              </ThemedText>
            </View>
          )}

          {/* Title + category */}
          <ThemedText style={s.title}>{e.title}</ThemedText>
          <View style={s.tagRow}>
            {detail.category && (
              <Tag
                label={detail.category.displayName}
                icon="pricetag-outline"
              />
            )}
            <Tag
              label={
                e.visibilityScope === "COUNTRY" ? "Country-wide" : "Community"
              }
              icon={
                e.visibilityScope === "COUNTRY"
                  ? "globe-outline"
                  : "people-outline"
              }
            />
            <Tag
              label={e.eventMode === "ONLINE_EXTERNAL" ? "Online" : "In person"}
              icon={
                e.eventMode === "ONLINE_EXTERNAL"
                  ? "videocam-outline"
                  : "location-outline"
              }
            />
          </View>

          {/* Date & time */}
          <InfoRow icon="calendar-outline" label="When">
            <ThemedText style={s.infoValue}>
              {formatEventDate(e.startsAt, e.timezone)}
              {e.endsAt ? ` → ${formatEventDate(e.endsAt, e.timezone)}` : ""}
            </ThemedText>
            <ThemedText style={s.infoSub} themeColor="textSecondary">
              {e.timezone}
            </ThemedText>
          </InfoRow>

          {/* Location / link */}
          {e.eventMode === "ONLINE_EXTERNAL" && e.externalUrl ? (
            <InfoRow icon="link-outline" label="Join online">
              <Pressable onPress={() => void openLink(e.externalUrl as string)}>
                <ThemedText style={s.link} numberOfLines={1}>
                  {e.externalUrl}
                </ThemedText>
              </Pressable>
            </InfoRow>
          ) : e.locationName ? (
            <InfoRow icon="location-outline" label="Where">
              <ThemedText style={s.infoValue}>{e.locationName}</ThemedText>
            </InfoRow>
          ) : null}

          {/* Capacity */}
          <InfoRow icon="people-outline" label="Participants">
            <ThemedText style={s.infoValue}>
              {detail.counts.going} going
              {e.capacity !== null ? ` of ${e.capacity}` : ""}
              {" · "}
              {detail.counts.interested} interested
              {detail.counts.waitlisted > 0
                ? ` · ${detail.counts.waitlisted} waitlisted`
                : ""}
            </ThemedText>
            {participantNames.length > 0 && (
              <ThemedText
                style={s.infoSub}
                themeColor="textSecondary"
                numberOfLines={1}
              >
                {participantNames.join(", ")}
              </ThemedText>
            )}
            {detail.counts.going +
              detail.counts.interested +
              detail.counts.waitlisted >
              0 && (
              <Pressable
                onPress={() =>
                  router.push(`/(app)/events/participants/${e.id}` as never)
                }
                accessibilityRole="button"
                accessibilityLabel="View all participants"
              >
                <ThemedText style={s.viewAllLink}>
                  View all participants
                </ThemedText>
              </Pressable>
            )}
          </InfoRow>

          {/* Organizer */}
          <InfoRow icon="person-circle-outline" label="Organizer">
            <ThemedText style={s.infoValue}>
              {detail.businessAccountName
                ? detail.businessAccountName
                : detail.organizer
                  ? (detail.organizer.displayName ??
                    `@${detail.organizer.username}`)
                  : "Diasporum member"}
            </ThemedText>
          </InfoRow>

          {/* Description */}
          <ThemedText style={s.sectionTitle}>About this event</ThemedText>
          <ThemedText style={s.description}>{e.description}</ThemedText>

          {/* RSVP */}
          {!rsvpBlocked && (
            <View style={s.rsvpBox}>
              <ThemedText style={s.rsvpTitle}>Your RSVP</ThemedText>
              {actionError && (
                <ThemedText
                  style={[s.actionError, { color: BrandColors.error }]}
                >
                  {actionError}
                </ThemedText>
              )}
              <View style={s.rsvpRow}>
                <RsvpBtn
                  active={detail.myRsvp === "GOING"}
                  busy={rsvpBusy}
                  label={detail.myRsvp === "GOING" ? "Going ✓" : "Going"}
                  onPress={() => void setRsvp("GOING")}
                />
                <RsvpBtn
                  active={detail.myRsvp === "INTERESTED"}
                  busy={rsvpBusy}
                  label={
                    detail.myRsvp === "INTERESTED"
                      ? "Interested ✓"
                      : "Interested"
                  }
                  onPress={() => void setRsvp("INTERESTED")}
                />
                <RsvpBtn
                  active={detail.myRsvp === "NOT_GOING"}
                  busy={rsvpBusy}
                  label="Not going"
                  onPress={() => void setRsvp("NOT_GOING")}
                />
              </View>
              {detail.myRsvp === "WAITLISTED" && (
                <ThemedText style={s.waitlistNote} themeColor="textSecondary">
                  You are on the waitlist — you&rsquo;ll get a spot if one opens
                  up.
                </ThemedText>
              )}
              {detail.myRsvp && detail.myRsvp !== "NOT_GOING" && (
                <Pressable
                  onPress={() => void removeRsvp()}
                  disabled={rsvpBusy}
                  accessibilityRole="button"
                  accessibilityLabel="Remove RSVP"
                >
                  <ThemedText style={s.removeRsvp}>Remove my RSVP</ThemedText>
                </Pressable>
              )}
            </View>
          )}

          {/* Manager actions */}
          {detail.canManage && (
            <View style={s.manageBox}>
              <ThemedText style={s.rsvpTitle}>Manage</ThemedText>
              <View style={s.manageRow}>
                <ManageBtn
                  label="Edit"
                  icon="create-outline"
                  onPress={() =>
                    router.push(`/(app)/events/edit/${e.id}` as never)
                  }
                />
                {isDraft && (
                  <ManageBtn
                    label="Publish"
                    icon="cloud-upload-outline"
                    onPress={() => void publish()}
                  />
                )}
                {!cancelled && !isDraft && (
                  <ManageBtn
                    label="Cancel"
                    icon="close-circle-outline"
                    onPress={cancelEvent}
                    danger
                  />
                )}
                <ManageBtn
                  label="Delete"
                  icon="trash-outline"
                  onPress={deleteEvent}
                  danger
                />
              </View>
              {actionError && rsvpBlocked && (
                <ThemedText
                  style={[s.actionError, { color: BrandColors.error }]}
                >
                  {actionError}
                </ThemedText>
              )}
            </View>
          )}

          {/* Report */}
          {!detail.canManage && (
            <Pressable
              onPress={report}
              style={s.reportBtn}
              accessibilityRole="button"
              accessibilityLabel="Report event"
            >
              <Ionicons
                name="flag-outline"
                size={14}
                color={theme.textSecondary}
              />
              <ThemedText style={s.reportText} themeColor="textSecondary">
                Report this event
              </ThemedText>
            </Pressable>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Tag({
  label,
  icon,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
}) {
  const theme = useTheme();
  return (
    <View style={[s.tag, { backgroundColor: theme.backgroundElement }]}>
      <Ionicons name={icon} size={11} color={theme.textSecondary} />
      <ThemedText style={s.tagText} themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

function InfoRow({
  icon,
  label,
  children,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={s.infoRow}>
      <View style={s.infoIcon}>
        <Ionicons name={icon} size={18} color={theme.textSecondary} />
      </View>
      <View style={s.infoBody}>
        <ThemedText style={s.infoLabel} themeColor="textSecondary">
          {label}
        </ThemedText>
        {children}
      </View>
    </View>
  );
}

function RsvpBtn({
  label,
  active,
  busy,
  onPress,
}: {
  label: string;
  active: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled: busy }}
      style={[
        s.rsvpBtn,
        { borderColor: active ? BrandColors.primary : theme.border },
        active && { backgroundColor: BrandColors.primary },
        busy && { opacity: 0.6 },
      ]}
    >
      <ThemedText
        style={[s.rsvpBtnText, active && { color: BrandColors.white }]}
      >
        {busy ? "…" : label}
      </ThemedText>
    </Pressable>
  );
}

function ManageBtn({
  label,
  icon,
  onPress,
  danger,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  danger?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[s.manageBtn, { borderColor: theme.border }]}
    >
      <Ionicons
        name={icon}
        size={15}
        color={danger ? BrandColors.error : theme.text}
      />
      <ThemedText
        style={[s.manageBtnText, danger && { color: BrandColors.error }]}
      >
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
    justifyContent: "space-between",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 18 },
  content: { padding: Spacing.four, gap: Spacing.three },
  cover: { borderRadius: BorderRadius.lg },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderRadius: BorderRadius.md,
    padding: Spacing.three,
  },
  bannerText: { flex: 1 },
  bannerTitle: { fontSize: 14, fontWeight: "700" },
  bannerBody: { fontSize: 13, marginTop: 2 },
  title: {
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 30,
    letterSpacing: -0.3,
  },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  tagText: { fontSize: 12, fontWeight: "600" },
  infoRow: {
    flexDirection: "row",
    gap: Spacing.three,
    alignItems: "flex-start",
  },
  infoIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  infoBody: { flex: 1 },
  infoLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  infoValue: { fontSize: 15, lineHeight: 21, marginTop: 2 },
  infoSub: { fontSize: 13, marginTop: 2 },
  viewAllLink: {
    fontSize: 13,
    fontWeight: "600",
    color: BrandColors.primary,
    textDecorationLine: "underline",
    marginTop: 4,
  },
  link: {
    fontSize: 15,
    color: BrandColors.primary,
    textDecorationLine: "underline",
    marginTop: 2,
  },
  sectionTitle: { fontSize: 16, fontWeight: "700", marginTop: Spacing.two },
  description: { fontSize: 15, lineHeight: 22 },
  rsvpBox: { gap: Spacing.two },
  rsvpTitle: { fontSize: 16, fontWeight: "700" },
  rsvpRow: { flexDirection: "row", gap: Spacing.two },
  rsvpBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: BorderRadius.md,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rsvpBtnText: { fontSize: 14, fontWeight: "700" },
  waitlistNote: { fontSize: 13 },
  removeRsvp: {
    fontSize: 13,
    color: BrandColors.primary,
    fontWeight: "600",
    textAlign: "center",
    paddingVertical: Spacing.one,
  },
  actionError: { fontSize: 13 },
  manageBox: { gap: Spacing.two },
  manageRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  manageBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  manageBtnText: { fontSize: 13, fontWeight: "700" },
  reportBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: Spacing.two,
    justifyContent: "center",
  },
  reportText: { fontSize: 13 },
});
