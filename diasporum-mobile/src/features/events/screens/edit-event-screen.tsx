/**
 * EditEventScreen — loads the event into the shared form and PATCHes changes.
 * Route: /(app)/events/edit/[id]
 * Schedule/mode/location changes are blocked once the event has started
 * (server-side); the form shows that state up front.
 */

import React, { useCallback, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from "react-native";
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
import {
  EventForm,
  formStateFromEvent,
  uploadCover,
  validateEventForm,
} from "../components/event-form";
import type { EventFormState } from "../components/event-form";
import type { EventDetail } from "../types/event-types";
import { zonedToUtc } from "../utils/event-time";

export default function EditEventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { apiClient } = useSession();
  const eventApi = React.useMemo(() => createEventApi(apiClient), [apiClient]);

  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [form, setForm] = useState<EventFormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Snapshot at mount: "started" only needs an approximate current time.
  const [now] = useState(() => Date.now());

  React.useEffect(() => {
    let cancelled = false;
    eventApi
      .eventDetail(id)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setForm(formStateFromEvent(d));
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            ApiError.isApiError(e) ? e.userMessage : "Failed to load event.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventApi, id]);

  const onChange = useCallback((patch: Partial<EventFormState>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const submit = useCallback(async () => {
    if (!form || !detail || submitting) return;
    const validation = validateEventForm(form);
    if (validation) {
      setError(validation);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const startsAt = zonedToUtc(
        form.startDate,
        form.startTime,
        form.timezone,
      );
      let endsAt: Date | null = null;
      if (form.hasEnd)
        endsAt = zonedToUtc(form.endDate, form.endTime, form.timezone);
      if (!startsAt || (form.hasEnd && !endsAt)) {
        setError("Invalid date or time.");
        return;
      }
      if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
        setError("The end must be after the start.");
        return;
      }

      // Diff against the loaded event — PATCH only changed fields.
      // Null fields mean "keep current" server-side, so only send set values.
      const e = detail.event;
      const eventStarted = new Date(e.startsAt).getTime() <= now;
      const patch: Record<string, unknown> = {};
      if (form.title.trim() !== e.title) patch.title = form.title.trim();
      if (form.description.trim() !== e.description)
        patch.description = form.description.trim();
      if (form.categoryId !== e.categoryId) patch.categoryId = form.categoryId;
      if (form.eventMode !== e.eventMode) patch.eventMode = form.eventMode;
      if (form.visibilityScope !== e.visibilityScope)
        patch.visibilityScope = form.visibilityScope;
      if (startsAt.toISOString() !== e.startsAt)
        patch.startsAt = startsAt.toISOString();
      const endIso = form.hasEnd && endsAt ? endsAt.toISOString() : null;
      if (endIso !== null && endIso !== e.endsAt) patch.endsAt = endIso;
      // Unchecking "Add an end time" clears a previously-set endsAt.
      if (!form.hasEnd && e.endsAt !== null) patch.clearEndsAt = true;
      if (form.timezone.trim() !== e.timezone)
        patch.timezone = form.timezone.trim();
      if (
        form.eventMode === "IN_PERSON" &&
        form.locationName.trim() !== (e.locationName ?? "")
      ) {
        patch.locationName = form.locationName.trim() || undefined;
      }
      if (
        form.eventMode === "ONLINE_EXTERNAL" &&
        form.externalUrl.trim() !== (e.externalUrl ?? "")
      ) {
        patch.externalUrl = form.externalUrl.trim() || undefined;
      }
      const capacity = form.capacity.trim() ? Number(form.capacity) : null;
      if (capacity !== null && capacity !== e.capacity)
        patch.capacity = capacity;
      if (form.cover) {
        patch.coverMediaId = await uploadCover(apiClient, form.cover);
      }

      // Lifecycle guard (mirrors the backend): once the event has started only
      // the title, description, cover and capacity increases may change.
      if (eventStarted) {
        const blocked = Object.keys(patch).filter((k) => {
          if (k === "title" || k === "description" || k === "coverMediaId")
            return false;
          if (k === "capacity") {
            return (
              e.capacity !== null && (patch.capacity as number) <= e.capacity
            );
          }
          return true;
        });
        if (blocked.length > 0) {
          setError(
            "This event already started — only the title, description, cover and capacity increases can change.",
          );
          return;
        }
      }

      if (Object.keys(patch).length === 0) {
        Alert.alert("Nothing to update", "No fields have changed.");
        return;
      }
      await eventApi.updateEvent(id, patch);
      router.replace(`/(app)/events/${id}` as never);
    } catch (err) {
      setError(
        ApiError.isApiError(err)
          ? err.userMessage
          : "Could not update the event.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [form, detail, now, submitting, eventApi, apiClient, id, router]);

  if (loading) return <LoadingScreen />;
  if (error && !detail)
    return <ErrorState message={error} onRetry={() => setLoading(true)} />;
  if (!form || !detail) return <ErrorState message="Event not found." />;

  const e = detail.event;
  const started = new Date(e.startsAt).getTime() <= now;
  const cancelled = e.cancelledAt !== null;

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
          <ThemedText type="title" style={s.headerTitle}>
            Edit event
          </ThemedText>
          <View style={s.headerSpacer} />
        </View>

        {cancelled && (
          <View
            style={[s.banner, { backgroundColor: BrandColors.errorSurface }]}
          >
            <Ionicons name="alert-circle" size={16} color={BrandColors.error} />
            <ThemedText style={[s.bannerText, { color: BrandColors.error }]}>
              This event is cancelled and can no longer be edited.
            </ThemedText>
          </View>
        )}
        {started && !cancelled && (
          <View
            style={[s.banner, { backgroundColor: BrandColors.warningSurface }]}
          >
            <Ionicons
              name="time-outline"
              size={16}
              color={BrandColors.warning}
            />
            <ThemedText style={[s.bannerText, { color: BrandColors.warning }]}>
              This event already started — only the title, description, cover
              and capacity increases can change.
            </ThemedText>
          </View>
        )}
        {e.coverMediaId && !form.cover && (
          <View style={s.existingCoverRow}>
            <Ionicons name="image" size={14} color={BrandColors.primary} />
            <ThemedText style={s.existingCoverText} themeColor="textSecondary">
              A cover image is set — selecting a new one replaces it.
            </ThemedText>
          </View>
        )}

        <KeyboardAvoidingView
          style={s.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
        <View style={s.formWrap}>
          <EventForm state={form} onChange={onChange} />
        </View>

        {error && (
          <View style={s.errorRow}>
            <Ionicons
              name="alert-circle-outline"
              size={15}
              color={BrandColors.error}
            />
            <ThemedText style={[s.errorText, { color: BrandColors.error }]}>
              {error}
            </ThemedText>
          </View>
        )}

        <View style={[s.actions, { borderTopColor: theme.border }]}>
          <Pressable
            onPress={() => void submit()}
            disabled={submitting || cancelled}
            accessibilityRole="button"
            accessibilityLabel={submitting ? "Saving changes" : "Save changes"}
            style={[
              s.primaryBtn,
              (submitting || cancelled) && { opacity: 0.6 },
            ]}
          >
            <ThemedText style={s.primaryText}>
              {submitting ? "Saving…" : "Save changes"}
            </ThemedText>
          </Pressable>
        </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 18 },
  headerSpacer: { width: 24 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    margin: Spacing.three,
    marginHorizontal: Spacing.four,
    borderRadius: BorderRadius.md,
    padding: Spacing.three,
  },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  existingCoverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  existingCoverText: { fontSize: 12 },
  formWrap: { flex: 1 },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.one + Spacing.half,
  },
  errorText: { flex: 1, fontSize: 13, lineHeight: 18 },
  actions: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primaryBtn: {
    backgroundColor: BrandColors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { fontSize: 15, fontWeight: "700", color: BrandColors.white },
});
