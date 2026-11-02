/**
 * CreateEventScreen — event creation form.
 * Route: /(app)/events/create
 * Publishes directly, or saves as a draft for later publishing.
 */

import React, { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { safeBack } from "@/core/navigation/safe-back";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useSession } from "@/core/session/session-provider";
import { createEventApi } from "../services/event-api";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import {
  EventForm,
  initialFormState,
  uploadCover,
  validateEventForm,
} from "../components/event-form";
import type { EventFormState } from "../components/event-form";
import { zonedToUtc } from "../utils/event-time";

export default function CreateEventScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient, session } = useSession();
  const eventApi = React.useMemo(() => createEventApi(apiClient), [apiClient]);

  const [form, setForm] = useState<EventFormState>(initialFormState);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const communityId = session?.activeCommunityId ?? null;

  const onChange = useCallback((patch: Partial<EventFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const submit = useCallback(
    async (draft: boolean) => {
      if (submitting) return;
      const validation = validateEventForm(form);
      if (validation) {
        setError(validation);
        return;
      }
      if (!communityId) {
        setError(
          "No active community — events are created inside a community.",
        );
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
        if (form.hasEnd) {
          endsAt = zonedToUtc(form.endDate, form.endTime, form.timezone);
        }
        if (!startsAt || (form.hasEnd && !endsAt)) {
          setError("Invalid date or time.");
          return;
        }
        if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
          setError("The end must be after the start.");
          return;
        }
        if (startsAt.getTime() <= Date.now() && !draft) {
          setError("The start must be in the future.");
          return;
        }
        const coverMediaId = form.cover
          ? await uploadCover(apiClient, form.cover)
          : undefined;
        const created = await eventApi.createEvent({
          communityId,
          visibilityScope: form.visibilityScope,
          categoryId: form.categoryId as string,
          title: form.title.trim(),
          description: form.description.trim(),
          eventMode: form.eventMode,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt ? endsAt.toISOString() : undefined,
          timezone: form.timezone.trim(),
          locationName:
            form.eventMode === "IN_PERSON"
              ? form.locationName.trim()
              : undefined,
          externalUrl:
            form.eventMode === "ONLINE_EXTERNAL"
              ? form.externalUrl.trim()
              : undefined,
          capacity: form.capacity.trim() ? Number(form.capacity) : undefined,
          coverMediaId,
          draft,
        });
        if (draft) {
          Alert.alert(
            "Draft saved",
            "You can publish it later from My events.",
          );
          safeBack();
        } else {
          router.replace(`/(app)/events/${created.event.id}` as never);
        }
      } catch (e) {
        setError(
          ApiError.isApiError(e)
            ? e.userMessage
            : "Could not create the event.",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, form, communityId, eventApi, apiClient, router],
  );

  const publishLabel = useMemo(
    () => (submitting ? "Creating…" : "Create event"),
    [submitting],
  );

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
            Create event
          </ThemedText>
          <View style={s.headerSpacer} />
        </View>

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
            onPress={() => void submit(true)}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Save as draft"
            style={[
              s.secondaryBtn,
              { borderColor: theme.border },
              submitting && { opacity: 0.6 },
            ]}
          >
            <ThemedText style={s.secondaryText}>Save as draft</ThemedText>
          </Pressable>
          <Pressable
            onPress={() => void submit(false)}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel={publishLabel}
            style={[s.primaryBtn, submitting && { opacity: 0.6 }]}
          >
            <Ionicons name="calendar" size={17} color={BrandColors.white} />
            <ThemedText style={s.primaryText}>{publishLabel}</ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    </ThemedView>
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
  headerTitle: { fontSize: 18 },
  headerSpacer: { width: 24 },
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
    flexDirection: "row",
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontSize: 15, fontWeight: "700" },
  primaryBtn: {
    flex: 1.6,
    backgroundColor: BrandColors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: 12,
    flexDirection: "row",
    gap: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { fontSize: 15, fontWeight: "700", color: BrandColors.white },
});
