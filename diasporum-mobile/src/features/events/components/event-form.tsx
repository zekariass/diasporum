/**
 * EventForm — shared form body for the create and edit event screens.
 * Owns field state + validation; the parent screen submits it.
 * Cover images upload through the media module with purpose EVENT.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { BrandColors } from '@/shared/theme/colors';
import { BorderRadius, Spacing } from '@/shared/theme/spacing';
import { useSession } from '@/core/session/session-provider';
import type { ApiClient } from '@/core/api/api-client';
import { createEventApi } from '../services/event-api';
import type { EventCategory, EventDetail, EventMode, VisibilityScope } from '../types/event-types';
import {
  deviceTimezone, isValidDate, isValidTime, isValidTimezone, toDateInput, toTimeInput,
  zonedToUtc,
} from '../utils/event-time';

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
    title: '',
    description: '',
    categoryId: null,
    visibilityScope: 'COMMUNITY',
    eventMode: 'IN_PERSON',
    startDate: '',
    startTime: '',
    hasEnd: false,
    endDate: '',
    endTime: '',
    timezone: deviceTimezone(),
    locationName: '',
    externalUrl: '',
    capacity: '',
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
    endDate: e.endsAt ? toDateInput(e.endsAt, e.timezone) : '',
    endTime: e.endsAt ? toTimeInput(e.endsAt, e.timezone) : '',
    timezone: e.timezone,
    locationName: e.locationName ?? '',
    externalUrl: e.externalUrl ?? '',
    capacity: e.capacity !== null ? String(e.capacity) : '',
    cover: null,
  };
}

/** Client-side validation — mirrors the backend's content rules. */
export function validateEventForm(f: EventFormState): string | null {
  if (!f.title.trim()) return 'Enter a title.';
  if (!f.description.trim()) return 'Enter a description.';
  if (!f.categoryId) return 'Pick a category.';
  if (!isValidDate(f.startDate)) return 'Start date must be YYYY-MM-DD.';
  if (!isValidTime(f.startTime)) return 'Start time must be HH:MM (24-hour).';
  if (f.hasEnd) {
    if (!isValidDate(f.endDate)) return 'End date must be YYYY-MM-DD.';
    if (!isValidTime(f.endTime)) return 'End time must be HH:MM (24-hour).';
  }
  if (!isValidTimezone(f.timezone)) return 'Enter a valid timezone (e.g. Europe/Berlin).';
  if (f.eventMode === 'IN_PERSON' && !f.locationName.trim()) {
    return 'Enter a location for an in-person event.';
  }
  if (f.eventMode === 'ONLINE_EXTERNAL') {
    const url = f.externalUrl.trim();
    if (!url) return 'Enter the online event link.';
    if (!/^https?:\/\//i.test(url)) return 'The event link must start with http:// or https://.';
  }
  if (f.capacity.trim()) {
    const cap = Number(f.capacity);
    if (!Number.isInteger(cap) || cap <= 0) return 'Capacity must be a positive whole number.';
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
    '/api/v1/media/uploads',
    { purpose: 'EVENT', mimeType: cover.mimeType, declaredSizeBytes: file.size },
    { authenticated: true },
  );
  try {
    const uploadResponse = await fetch(init.uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': cover.mimeType },
    });
    if (!uploadResponse.ok) throw new Error('Cover upload failed.');
    await apiClient.post(
      `/api/v1/media/uploads/${init.assetId}/complete`,
      { declaredSizeBytes: file.size },
      { authenticated: true },
    );
    return init.assetId;
  } catch (err) {
    apiClient.delete(`/api/v1/media/${init.assetId}`, { authenticated: true }).catch(() => {});
    throw err;
  }
}

interface Props {
  state: EventFormState;
  onChange: (patch: Partial<EventFormState>) => void;
}

/** Which native picker is currently open, if any. */
type PickerFieldName = 'startDate' | 'startTime' | 'endDate' | 'endTime';

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
  const date = isValidDate(dateStr) ? dateStr : toDateInput(now.toISOString(), DEVICE_TZ);
  const time = isValidTime(timeStr) ? timeStr : toTimeInput(now.toISOString(), DEVICE_TZ);
  return zonedToUtc(date, time, DEVICE_TZ) ?? now;
}

export function EventForm({ state, onChange }: Props) {
  const theme = useTheme();
  const { apiClient } = useSession();
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [picking, setPicking] = useState(false);
  const [picker, setPicker] = useState<
    { field: PickerFieldName; value: Date } | null
  >(null);

  useEffect(() => {
    createEventApi(apiClient).categories()
      .then(r => setCategories(r.items))
      .catch(() => setCategories([]));
  }, [apiClient]);

  async function pickCover() {
    if (picking) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        onChange({ cover: null });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.9,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      onChange({
        cover: {
          uri: asset.uri,
          mimeType: (asset.mimeType ?? 'image/jpeg').toLowerCase(),
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
    const isTime = field === 'startTime' || field === 'endTime';
    setPicker({
      field,
      value: pickerInitialValue(
        isTime ? (field === 'startTime' ? state.startDate : state.endDate) : state[field],
        isTime ? state[field] : '12:00',
      ),
    });
  };

  const applyPickerValue = (field: PickerFieldName, picked: Date) => {
    const iso = picked.toISOString();
    if (field === 'startTime' || field === 'endTime') {
      onChange({ [field]: toTimeInput(iso, DEVICE_TZ) } as Partial<EventFormState>);
    } else {
      onChange({ [field]: toDateInput(iso, DEVICE_TZ) } as Partial<EventFormState>);
    }
  };

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      {/* Cover */}
      <ThemedText style={s.label}>Cover image (optional)</ThemedText>
      <Pressable
        onPress={() => void pickCover()}
        accessibilityRole="button"
        accessibilityLabel={state.cover ? 'Change cover image' : 'Choose cover image'}
        style={[s.coverPick, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
      >
        {picking ? (
          <ActivityIndicator size="small" color={BrandColors.primary} />
        ) : state.cover ? (
          <View style={s.coverInner}>
            <Ionicons name="image" size={22} color={BrandColors.primary} />
            <ThemedText style={s.coverText} numberOfLines={1}>
              Cover selected
            </ThemedText>
            <Ionicons name="swap-horizontal" size={16} color={theme.textSecondary} />
          </View>
        ) : (
          <View style={s.coverInner}>
            <Ionicons name="image-outline" size={22} color={theme.textSecondary} />
            <ThemedText style={s.coverPlaceholder} themeColor="textSecondary">
              Choose a cover image
            </ThemedText>
          </View>
        )}
      </Pressable>

      {/* Title */}
      <Field label="Title">
        <Input
          value={state.title}
          onChangeText={v => onChange({ title: v })}
          placeholder="Ethiopian coffee night"
          maxLength={200}
        />
      </Field>

      {/* Description */}
      <Field label="Description">
        <Input
          value={state.description}
          onChangeText={v => onChange({ description: v })}
          placeholder="What is happening, and who is it for?"
          multiline
          minHeight={100}
          maxLength={12000}
        />
      </Field>

      {/* Category */}
      <ThemedText style={s.label}>Category</ThemedText>
      <View style={s.chipRow}>
        {categories.map(c => (
          <FormChip
            key={c.id}
            label={c.displayName}
            active={state.categoryId === c.id}
            onPress={() => onChange({ categoryId: c.id })}
          />
        ))}
        {categories.length === 0 && (
          <ThemedText style={s.hint} themeColor="textSecondary">Loading categories…</ThemedText>
        )}
      </View>

      {/* Visibility */}
      <ThemedText style={s.label}>Who can see this event?</ThemedText>
      <View style={s.chipRow}>
        <FormChip label="My community" active={state.visibilityScope === 'COMMUNITY'}
          onPress={() => onChange({ visibilityScope: 'COMMUNITY' })} />
        <FormChip label="Whole country" active={state.visibilityScope === 'COUNTRY'}
          onPress={() => onChange({ visibilityScope: 'COUNTRY' })} />
      </View>
      <ThemedText style={s.hint} themeColor="textSecondary">
        The event must belong to your community; country-wide events are visible
        to members in the event{`'`}s country.
      </ThemedText>

      {/* Mode */}
      <ThemedText style={s.label}>Format</ThemedText>
      <View style={s.chipRow}>
        <FormChip label="In person" active={state.eventMode === 'IN_PERSON'}
          onPress={() => onChange({ eventMode: 'IN_PERSON' })} />
        <FormChip label="Online (external)" active={state.eventMode === 'ONLINE_EXTERNAL'}
          onPress={() => onChange({ eventMode: 'ONLINE_EXTERNAL' })} />
      </View>

      {/* Start */}
      <ThemedText style={s.label}>Starts (date and time, 24-hour)</ThemedText>
      <View style={s.dateTimeRow}>
        <PickerField label="Start date" value={state.startDate} placeholder="Choose date"
          icon="calendar-outline" onPress={() => openPicker('startDate')} />
        <PickerField label="Start time" value={state.startTime} placeholder="Choose time"
          icon="time-outline" onPress={() => openPicker('startTime')} />
      </View>

      {/* End */}
      <View style={s.endToggleRow}>
        <Pressable
          onPress={() => onChange({ hasEnd: !state.hasEnd })}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: state.hasEnd }}
          accessibilityLabel="Event has an end time"
          style={s.checkboxRow}
        >
          <Ionicons
            name={state.hasEnd ? 'checkbox' : 'square-outline'}
            size={20}
            color={state.hasEnd ? BrandColors.primary : theme.textSecondary}
          />
          <ThemedText style={s.checkboxText}>Add an end time</ThemedText>
        </Pressable>
      </View>
      {state.hasEnd && (
        <View style={s.dateTimeRow}>
          <PickerField label="End date" value={state.endDate} placeholder="Choose date"
            icon="calendar-outline" onPress={() => openPicker('endDate')} />
          <PickerField label="End time" value={state.endTime} placeholder="Choose time"
            icon="time-outline" onPress={() => openPicker('endTime')} />
        </View>
      )}

      {picker !== null && (
        <DateTimePicker
          mode={picker.field === 'startTime' || picker.field === 'endTime' ? 'time' : 'date'}
          value={picker.value}
          onChange={(event, picked) => {
            const field = picker.field;
            setPicker(null);
            if (!picked || event.type === 'dismissed') return;
            applyPickerValue(field, picked);
          }}
        />
      )}

      {/* Timezone */}
      <Field label="Timezone (IANA)">
        <Input
          value={state.timezone}
          onChangeText={v => onChange({ timezone: v })}
          placeholder="Europe/Berlin"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Field>
      <ThemedText style={s.hint} themeColor="textSecondary">
        Dates and times are interpreted in this timezone.
      </ThemedText>

      {/* Location / URL */}
      {state.eventMode === 'IN_PERSON' ? (
        <Field label="Location">
          <Input
            value={state.locationName}
            onChangeText={v => onChange({ locationName: v })}
            placeholder="Community hall, Berlin"
            maxLength={200}
          />
        </Field>
      ) : (
        <Field label="Online event link">
          <Input
            value={state.externalUrl}
            onChangeText={v => onChange({ externalUrl: v })}
            placeholder="https://meet.example.com/room"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            maxLength={2000}
          />
        </Field>
      )}

      {/* Capacity */}
      <Field label="Capacity (optional)">
        <Input
          value={state.capacity}
          onChangeText={v => onChange({ capacity: v.replace(/[^0-9]/g, '') })}
          placeholder="Unlimited"
          keyboardType="number-pad"
        />
      </Field>
      <ThemedText style={s.hint} themeColor="textSecondary">
        When the event is full, further RSVPs join the waitlist automatically.
      </ThemedText>
    </ScrollView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
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
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  keyboardType?: 'default' | 'url' | 'number-pad';
}) {
  const theme = useTheme();
  return (
    <TextInput
      value={props.value}
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
      placeholderTextColor={theme.textSecondary}
      style={[
        s.input,
        {
          color: theme.text,
          borderColor: theme.border,
          backgroundColor: theme.backgroundElement,
        },
        props.multiline && { minHeight: props.minHeight ?? 100, textAlignVertical: 'top' },
      ]}
      multiline={props.multiline}
      maxLength={props.maxLength}
      autoCapitalize={props.autoCapitalize ?? 'sentences'}
      autoCorrect={props.autoCorrect ?? true}
      keyboardType={props.keyboardType ?? 'default'}
    />
  );
}

function PickerField({ label, value, placeholder, icon, onPress }: {
  label: string; value: string; placeholder: string;
  icon: keyof typeof Ionicons.glyphMap; onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[s.pickerField, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
    >
      <ThemedText
        style={value ? s.pickerValue : [s.pickerValue, { color: theme.textSecondary }]}
        numberOfLines={1}
      >
        {value || placeholder}
      </ThemedText>
      <Ionicons name={icon} size={17} color={theme.textSecondary} />
    </Pressable>
  );
}

function FormChip({ label, active, onPress }: {
  label: string; active: boolean; onPress: () => void;
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
          backgroundColor: active ? BrandColors.primary : theme.backgroundElement,
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
  wrap: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.two, paddingBottom: Spacing.six },
  label: { fontSize: 13, fontWeight: '700', marginTop: Spacing.two },
  field: { gap: 6 },
  input: {
    borderWidth: 1, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.three, paddingVertical: 10, fontSize: 15,
  },
  dateTimeRow: { flexDirection: 'row', gap: Spacing.two },
  pickerField: {
    flex: 1, borderWidth: 1, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.three, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: Spacing.two,
  },
  pickerValue: { flex: 1, fontSize: 15 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: 4 },
  chip: {
    borderWidth: 1, borderRadius: BorderRadius.full,
    paddingHorizontal: 13, paddingVertical: 7,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  coverPick: {
    borderWidth: 1, borderStyle: 'dashed', borderRadius: BorderRadius.lg,
    minHeight: 64, alignItems: 'center', justifyContent: 'center',
  },
  coverInner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three },
  coverText: { flex: 1, fontSize: 14, fontWeight: '600' },
  coverPlaceholder: { fontSize: 14 },
  endToggleRow: { marginTop: Spacing.one },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkboxText: { fontSize: 14 },
  hint: { fontSize: 12, lineHeight: 16, marginTop: -2 },
});
