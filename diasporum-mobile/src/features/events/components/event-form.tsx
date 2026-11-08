/**
 * EventForm — shared form body for the create and edit event screens.
 * Owns field state + validation; the parent screen submits it.
 * Cover images upload through the media module with purpose EVENT.
 */

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { useSession } from "@/core/session/session-provider";
import type { ApiClient } from "@/core/api/api-client";
import { createEventApi } from "../services/event-api";
import type {
  EventCategory,
  EventDetail,
  EventMode,
  VisibilityScope,
} from "../types/event-types";
import {
  deviceTimezone,
  isValidDate,
  isValidTime,
  isValidTimezone,
  toDateInput,
  toTimeInput,
  zonedToUtc,
} from "../utils/event-time";

export interface CoverSelection {
  uri: string;
  mimeType: string;
  size: number;
}

export interface EventFormState {
  title: string;
  description: string;
  categoryId: string | null;
  visibilityScope: VisibilityScope;
  eventMode: EventMode;
  startDate: string;
  startTime: string;
  hasEnd: boolean;
  endDate: string;
  endTime: string;
  timezone: string;
  locationName: string;
  externalUrl: string;
  capacity: string;
  cover: CoverSelection | null;
}

export function initialFormState(): EventFormState {
  return {
    title: "",
    description: "",
    categoryId: null,
    visibilityScope: "COMMUNITY",
    eventMode: "IN_PERSON",
    startDate: "",
    startTime: "",
    hasEnd: false,
    endDate: "",
    endTime: "",
    timezone: deviceTimezone(),
    locationName: "",
    externalUrl: "",
    capacity: "",
    cover: null,
  };
}

export function formStateFromEvent(detail: EventDetail): EventFormState {
  const e = detail.event;
  return {
    title: e.title,
    description: e.description,
    categoryId: e.categoryId,
    visibilityScope: e.visibilityScope,
    eventMode: e.eventMode,
    startDate: toDateInput(e.startsAt, e.timezone),
    startTime: toTimeInput(e.startsAt, e.timezone),
    hasEnd: e.endsAt !== null,
    endDate: e.endsAt ? toDateInput(e.endsAt, e.timezone) : "",
    endTime: e.endsAt ? toTimeInput(e.endsAt, e.timezone) : "",
    timezone: e.timezone,
    locationName: e.locationName ?? "",
    externalUrl: e.externalUrl ?? "",
    capacity: e.capacity !== null ? String(e.capacity) : "",
    cover: null,
  };
}

/** Client-side validation — mirrors the backend's content rules. */
export function validateEventForm(f: EventFormState): string | null {
  if (!f.title.trim()) return "Enter a title.";
  if (!f.description.trim()) return "Enter a description.";
  if (!f.categoryId) return "Pick a category.";
  if (!isValidDate(f.startDate)) return "Start date must be YYYY-MM-DD.";
  if (!isValidTime(f.startTime)) return "Start time must be HH:MM (24-hour).";
  if (f.hasEnd) {
    if (!isValidDate(f.endDate)) return "End date must be YYYY-MM-DD.";
    if (!isValidTime(f.endTime)) return "End time must be HH:MM (24-hour).";
  }
  if (!isValidTimezone(f.timezone))
    return "Enter a valid timezone (e.g. Europe/Berlin).";
  if (f.eventMode === "IN_PERSON" && !f.locationName.trim()) {
    return "Enter a location for an in-person event.";
  }
  if (f.eventMode === "ONLINE_EXTERNAL") {
    const url = f.externalUrl.trim();
    if (!url) return "Enter the online event link.";
    if (!/^https?:\/\//i.test(url))
      return "The event link must start with http:// or https://.";
  }
  if (f.capacity.trim()) {
    const cap = Number(f.capacity);
    if (!Number.isInteger(cap) || cap <= 0)
      return "Capacity must be a positive whole number.";
  }
  return null;
}

/** Uploads the selected cover through the media module (purpose EVENT). */
export async function uploadCover(
  apiClient: ApiClient,
  cover: CoverSelection,
): Promise<string> {
  const fileResponse = await fetch(cover.uri);
  const file = await fileResponse.blob();
  const init = await apiClient.post<{ assetId: string; uploadUrl: string }>(
    "/api/v1/media/uploads",
    {
      purpose: "EVENT",
      mimeType: cover.mimeType,
      declaredSizeBytes: file.size,
    },
    { authenticated: true },
  );
  try {
    const uploadResponse = await fetch(init.uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": cover.mimeType },
    });
    if (!uploadResponse.ok) throw new Error("Cover upload failed.");
    await apiClient.post(
      `/api/v1/media/uploads/${init.assetId}/complete`,
      { declaredSizeBytes: file.size },
      { authenticated: true },
    );
    return init.assetId;
  } catch (err) {
    apiClient
      .delete(`/api/v1/media/${init.assetId}`, { authenticated: true })
      .catch(() => {});
    throw err;
  }
}

interface Props {
  state: EventFormState;
  onChange: (patch: Partial<EventFormState>) => void;
}

/** Which native picker is currently open, if any. */
type PickerFieldName = "startDate" | "startTime" | "endDate" | "endTime";

/** The native pickers render wall-clock values in the *device* timezone, while
 * the form stores wall-clock strings interpreted in the *event's* timezone.
 * Mapping through the device zone keeps the stored string equal to what the
 * user actually saw and chose in the picker; zonedToUtc in the submit path
 * then interprets it in the event's IANA timezone. */
const DEVICE_TZ = deviceTimezone();

/** Initial picker Date whose device-local wall-clock matches the stored string
 * (or "now" when the field is still empty). Date fields use a midday carrier
 * time to stay clear of DST edge cases at midnight. */
function pickerInitialValue(dateStr: string, timeStr: string): Date {
  const now = new Date();
  const date = isValidDate(dateStr)
    ? dateStr
    : toDateInput(now.toISOString(), DEVICE_TZ);
  const time = isValidTime(timeStr)
    ? timeStr
    : toTimeInput(now.toISOString(), DEVICE_TZ);
  return zonedToUtc(date, time, DEVICE_TZ) ?? now;
}

export function EventForm({ state, onChange }: Props) {
  const theme = useTheme();
  const { apiClient } = useSession();
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [picking, setPicking] = useState(false);
  const [picker, setPicker] = useState<{
    field: PickerFieldName;
    value: Date;
  } | null>(null);

  useEffect(() => {
    createEventApi(apiClient)
      .categories()
      .then((r) => setCategories(r.items))
      .catch(() => setCategories([]));
  }, [apiClient]);

  async function pickCover() {
    if (picking) return;
    setPicking(true);
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        onChange({ cover: null });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.9,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      onChange({
        cover: {
          uri: asset.uri,
          mimeType: (asset.mimeType ?? "image/jpeg").toLowerCase(),
          size: asset.fileSize ?? 0,
        },
      });
    } finally {
      setPicking(false);
    }
  }

  // The initial picker value is computed in the press handler (not render) so
  // no impure clock access happens during rendering.
  const openPicker = (field: PickerFieldName) => {
    const isTime = field === "startTime" || field === "endTime";
    setPicker({
      field,
      value: pickerInitialValue(
        isTime
          ? field === "startTime"
            ? state.startDate
            : state.endDate
          : state[field],
        isTime ? state[field] : "12:00",
      ),
    });
  };

  const applyPickerValue = (field: PickerFieldName, picked: Date) => {
    const iso = picked.toISOString();
    if (field === "startTime" || field === "endTime") {
      onChange({
        [field]: toTimeInput(iso, DEVICE_TZ),
      } as Partial<EventFormState>);
    } else {
      onChange({
        [field]: toDateInput(iso, DEVICE_TZ),
      } as Partial<EventFormState>);
    }
  };

  return (
    <ScrollView
      style={s.wrap}
      contentContainerStyle={s.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <FormSection
        icon="images-outline"
        title="Event basics"
        subtitle="Make it easy to understand at a glance."
      >
        <ThemedText style={s.label}>Cover image (optional)</ThemedText>
        <Pressable
          onPress={() => void pickCover()}
          accessibilityRole="button"
          accessibilityLabel={
            state.cover ? "Change cover image" : "Choose cover image"
          }
          style={({ pressed }) => [
            s.coverPick,
            {
              borderColor: state.cover ? "transparent" : theme.border,
              backgroundColor: theme.backgroundElement,
            },
            state.cover && s.coverPickSelected,
            pressed && s.pressed,
          ]}
        >
          {state.cover ? (
            <>
              <Image source={{ uri: state.cover.uri }} style={s.coverPreview} />
              <View
                style={[
                  s.coverChangeBadge,
                  { backgroundColor: theme.background },
                ]}
              >
                {picking ? (
                  <ActivityIndicator size="small" color={theme.primary} />
                ) : (
                  <Ionicons
                    name="camera-outline"
                    size={17}
                    color={theme.primary}
                  />
                )}
                <ThemedText
                  style={[s.coverChangeText, { color: theme.primary }]}
                >
                  {picking ? "Opening…" : "Change cover"}
                </ThemedText>
              </View>
            </>
          ) : picking ? (
            <View style={s.coverInner}>
              <ActivityIndicator size="small" color={theme.primary} />
              <ThemedText style={s.coverPlaceholder} themeColor="textSecondary">
                Opening your photo library…
              </ThemedText>
            </View>
          ) : (
            <View style={s.coverEmptyContent}>
              <View
                style={[s.coverIcon, { backgroundColor: theme.primarySurface }]}
              >
                <Ionicons
                  name="image-outline"
                  size={26}
                  color={theme.primary}
                />
              </View>
              <ThemedText style={s.coverTitle}>Add a cover image</ThemedText>
              <ThemedText style={s.coverSubtitle} themeColor="textSecondary">
                A 16:9 photo helps your event stand out
              </ThemedText>
              <View
                style={[
                  s.coverAction,
                  { backgroundColor: theme.primarySurface },
                ]}
              >
                <Ionicons name="add" size={16} color={theme.primary} />
                <ThemedText
                  style={[s.coverActionText, { color: theme.primary }]}
                >
                  Choose image
                </ThemedText>
              </View>
            </View>
          )}
        </Pressable>

        <Field label="Event title">
          <Input
            value={state.title}
            onChangeText={(v) => onChange({ title: v })}
            placeholder="Ethiopian coffee night"
            maxLength={200}
          />
        </Field>

        <Field label="Description">
          <Input
            value={state.description}
            onChangeText={(v) => onChange({ description: v })}
            placeholder="What is happening, and who is it for?"
            multiline
            minHeight={120}
            maxLength={12000}
          />
        </Field>

        <View style={s.field}>
          <ThemedText style={s.label}>Category</ThemedText>
          <View style={s.chipRow}>
            {categories.map((category) => (
              <FormChip
                key={category.id}
                label={category.displayName}
                active={state.categoryId === category.id}
                onPress={() => onChange({ categoryId: category.id })}
              />
            ))}
            {categories.length === 0 && (
              <View style={s.loadingRow}>
                <ActivityIndicator size="small" color={theme.primary} />
                <ThemedText style={s.hint} themeColor="textSecondary">
                  Loading categories…
                </ThemedText>
              </View>
            )}
          </View>
        </View>
      </FormSection>

      <FormSection
        icon="earth-outline"
        title="Audience & format"
        subtitle="Choose who can join and how you will meet."
      >
        <View style={s.field}>
          <ThemedText style={s.label}>Who can see this event?</ThemedText>
          <View style={s.chipRow}>
            <FormChip
              icon="people-outline"
              label="My community"
              active={state.visibilityScope === "COMMUNITY"}
              onPress={() => onChange({ visibilityScope: "COMMUNITY" })}
            />
            <FormChip
              icon="earth-outline"
              label="Whole country"
              active={state.visibilityScope === "COUNTRY"}
              onPress={() => onChange({ visibilityScope: "COUNTRY" })}
            />
          </View>
          <ThemedText style={s.hint} themeColor="textSecondary">
            Country-wide events stay connected to your community and are visible
            to members in the event{`'`}s country.
          </ThemedText>
        </View>

        <View style={[s.divider, { backgroundColor: theme.border }]} />

        <View style={s.field}>
          <ThemedText style={s.label}>Event format</ThemedText>
          <View style={s.chipRow}>
            <FormChip
              icon="location-outline"
              label="In person"
              active={state.eventMode === "IN_PERSON"}
              onPress={() => onChange({ eventMode: "IN_PERSON" })}
            />
            <FormChip
              icon="videocam-outline"
              label="Online (external)"
              active={state.eventMode === "ONLINE_EXTERNAL"}
              onPress={() => onChange({ eventMode: "ONLINE_EXTERNAL" })}
            />
          </View>
        </View>
      </FormSection>

      <FormSection
        icon="calendar-outline"
        title="Date & time"
        subtitle="When should people show up?"
      >
        <ThemedText style={s.label}>Starts</ThemedText>
        <View style={s.dateTimeRow}>
          <PickerField
            label="Start date"
            value={state.startDate}
            placeholder="Choose date"
            icon="calendar-outline"
            onPress={() => openPicker("startDate")}
          />
          <PickerField
            label="Start time"
            value={state.startTime}
            placeholder="Choose time"
            icon="time-outline"
            onPress={() => openPicker("startTime")}
          />
        </View>

        <Pressable
          onPress={() => onChange({ hasEnd: !state.hasEnd })}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: state.hasEnd }}
          accessibilityLabel="Event has an end time"
          style={({ pressed }) => [
            s.endToggleRow,
            { backgroundColor: theme.backgroundElement },
            pressed && s.pressed,
          ]}
        >
          <View style={s.checkboxRow}>
            <Ionicons
              name={state.hasEnd ? "checkbox" : "square-outline"}
              size={21}
              color={state.hasEnd ? theme.primary : theme.textSecondary}
            />
            <View style={s.endToggleCopy}>
              <ThemedText style={s.checkboxText}>Add an end time</ThemedText>
              <ThemedText style={s.hint} themeColor="textSecondary">
                Let guests know when the event finishes
              </ThemedText>
            </View>
          </View>
          <Ionicons
            name={state.hasEnd ? "chevron-up" : "chevron-down"}
            size={17}
            color={theme.textSecondary}
          />
        </Pressable>

        {state.hasEnd && (
          <View style={s.dateTimeRow}>
            <PickerField
              label="End date"
              value={state.endDate}
              placeholder="Choose date"
              icon="calendar-outline"
              onPress={() => openPicker("endDate")}
            />
            <PickerField
              label="End time"
              value={state.endTime}
              placeholder="Choose time"
              icon="time-outline"
              onPress={() => openPicker("endTime")}
            />
          </View>
        )}

        {picker !== null && (
          <DateTimePicker
            mode={
              picker.field === "startTime" || picker.field === "endTime"
                ? "time"
                : "date"
            }
            value={picker.value}
            onChange={(event, picked) => {
              const field = picker.field;
              setPicker(null);
              if (!picked || event.type === "dismissed") return;
              applyPickerValue(field, picked);
            }}
          />
        )}

        <Field label="Timezone (IANA)">
          <Input
            value={state.timezone}
            onChangeText={(v) => onChange({ timezone: v })}
            placeholder="Europe/Berlin"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <ThemedText style={s.hint} themeColor="textSecondary">
            Dates and times are interpreted in this timezone.
          </ThemedText>
        </Field>
      </FormSection>

      <FormSection
        icon={
          state.eventMode === "IN_PERSON" ? "location-outline" : "link-outline"
        }
        title="Location & capacity"
        subtitle="Finish with the practical details."
      >
        {state.eventMode === "IN_PERSON" ? (
          <Field label="Venue or meeting point">
            <Input
              value={state.locationName}
              onChangeText={(v) => onChange({ locationName: v })}
              placeholder="Community hall, Berlin"
              maxLength={200}
            />
          </Field>
        ) : (
          <Field label="Online event link">
            <Input
              value={state.externalUrl}
              onChangeText={(v) => onChange({ externalUrl: v })}
              placeholder="https://meet.example.com/room"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              maxLength={2000}
            />
          </Field>
        )}

        <Field label="Capacity (optional)">
          <Input
            value={state.capacity}
            onChangeText={(v) =>
              onChange({ capacity: v.replace(/[^0-9]/g, "") })
            }
            placeholder="Unlimited"
            keyboardType="number-pad"
          />
          <View style={s.hintRow}>
            <Ionicons
              name="people-outline"
              size={15}
              color={theme.textSecondary}
            />
            <ThemedText style={[s.hint, s.hintFlex]} themeColor="textSecondary">
              When full, new RSVPs automatically join the waitlist.
            </ThemedText>
          </View>
        </Field>
      </FormSection>
    </ScrollView>
  );
}

function FormSection({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        s.section,
        { backgroundColor: theme.background, borderColor: theme.border },
      ]}
    >
      <View style={s.sectionHeader}>
        <View
          style={[s.sectionIcon, { backgroundColor: theme.primarySurface }]}
        >
          <Ionicons name={icon} size={20} color={theme.primary} />
        </View>
        <View style={s.sectionHeaderCopy}>
          <ThemedText style={s.sectionTitle}>{title}</ThemedText>
          <ThemedText style={s.sectionSubtitle} themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        </View>
      </View>
      {children}
    </View>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={s.field}>
      <ThemedText style={s.label}>{label}</ThemedText>
      {children}
    </View>
  );
}

function Input(props: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  multiline?: boolean;
  minHeight?: number;
  maxLength?: number;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  keyboardType?: "default" | "url" | "number-pad";
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      value={props.value}
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
      placeholderTextColor={theme.textSecondary}
      selectionColor={theme.primary}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        s.input,
        {
          color: theme.text,
          borderColor: focused ? theme.primary : theme.border,
          backgroundColor: focused ? theme.background : theme.backgroundElement,
        },
        props.multiline && {
          minHeight: props.minHeight ?? 120,
          textAlignVertical: "top",
        },
      ]}
      multiline={props.multiline}
      maxLength={props.maxLength}
      autoCapitalize={props.autoCapitalize ?? "sentences"}
      autoCorrect={props.autoCorrect ?? true}
      keyboardType={props.keyboardType ?? "default"}
    />
  );
}

function PickerField({
  label,
  value,
  placeholder,
  icon,
  onPress,
}: {
  label: string;
  value: string;
  placeholder: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        s.pickerField,
        { borderColor: theme.border, backgroundColor: theme.backgroundElement },
        pressed && s.pressed,
      ]}
    >
      <View style={[s.pickerIcon, { backgroundColor: theme.primarySurface }]}>
        <Ionicons name={icon} size={17} color={theme.primary} />
      </View>
      <View style={s.pickerCopy}>
        <ThemedText style={s.pickerCaption} themeColor="textSecondary">
          {label}
        </ThemedText>
        <ThemedText
          style={[s.pickerValue, !value && { color: theme.textSecondary }]}
          numberOfLines={1}
        >
          {value || placeholder}
        </ThemedText>
      </View>
    </Pressable>
  );
}

function FormChip({
  icon,
  label,
  active,
  onPress,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
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
      style={({ pressed }) => [
        s.chip,
        {
          backgroundColor: active
            ? theme.primarySurface
            : theme.backgroundElement,
          borderColor: active ? theme.primary : theme.border,
        },
        pressed && s.pressed,
      ]}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={15}
          color={active ? theme.primary : theme.textSecondary}
        />
      )}
      <ThemedText style={[s.chipText, active && { color: theme.primary }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  content: {
    padding: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
  },
  pressed: { opacity: 0.72 },
  section: {
    borderWidth: 1,
    borderRadius: 20,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  sectionIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionHeaderCopy: { flex: 1 },
  sectionTitle: { fontSize: 16, lineHeight: 21, fontWeight: "800" },
  sectionSubtitle: { fontSize: 12, lineHeight: 17, marginTop: 1 },
  label: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  field: { gap: Spacing.two },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    lineHeight: 20,
  },
  dateTimeRow: { flexDirection: "row", gap: 10 },
  pickerField: {
    flex: 1,
    minHeight: 70,
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  pickerIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerCopy: { flex: 1 },
  pickerCaption: { fontSize: 10, lineHeight: 14, fontWeight: "600" },
  pickerValue: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    marginTop: 2,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  chip: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  chipText: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  divider: { height: StyleSheet.hairlineWidth, width: "100%" },
  coverPick: {
    height: 190,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  coverPickSelected: { borderWidth: 0, borderStyle: "solid" },
  coverPreview: { width: "100%", height: "100%" },
  coverChangeBadge: {
    position: "absolute",
    right: 12,
    bottom: 12,
    minWidth: 126,
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.full,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 6,
    elevation: 3,
  },
  coverChangeText: { fontSize: 12, lineHeight: 16, fontWeight: "800" },
  coverInner: {
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.three,
    padding: Spacing.four,
  },
  coverEmptyContent: { alignItems: "center", padding: Spacing.four },
  coverIcon: {
    width: 52,
    height: 52,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.two,
  },
  coverTitle: { fontSize: 16, lineHeight: 21, fontWeight: "800" },
  coverSubtitle: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  coverPlaceholder: { fontSize: 13, lineHeight: 18, textAlign: "center" },
  coverAction: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: Spacing.three,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.full,
  },
  coverActionText: { fontSize: 12, lineHeight: 16, fontWeight: "800" },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  endToggleRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
    padding: 12,
    borderRadius: 14,
  },
  checkboxRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  endToggleCopy: { flex: 1 },
  checkboxText: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  hint: { fontSize: 11, lineHeight: 16 },
  hintFlex: { flex: 1 },
  hintRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
});
