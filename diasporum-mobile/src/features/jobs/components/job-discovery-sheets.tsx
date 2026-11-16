/**
 * Bottom sheets for the Jobs dashboard — location picker, sort selection,
 * and the report-a-job form. The full filter panel lives in the left
 * JobsFilterDrawer (job-drawers.tsx).
 * Every option maps to a real /api/v1/jobs query param.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { PrimaryButton } from "@/shared/components/primary-button";
import { Sheet } from "@/shared/components/sheet";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type {
  EmploymentType,
  VisibilityScope,
  WorkplaceType,
} from "../types/job-types";
import { label } from "../utils/job-format";

export type JobSort = "NEWEST" | "CLOSING";
export type DatePosted = "ANY" | "24H" | "7D" | "30D";

export interface CommunityOption {
  id: string;
  name: string;
}

/** Client-side filter state; mapped to API params by the screen. */
export interface JobsFilterState {
  communityId: string | null;
  scope: VisibilityScope | null;
  categoryId: string | null;
  employmentType: EmploymentType | null;
  workplaceType: WorkplaceType | null;
  city: string;
  salaryMin: string;
  salaryMax: string;
  datePosted: DatePosted;
}

export const EMPTY_JOB_FILTERS: JobsFilterState = {
  communityId: null,
  scope: null,
  categoryId: null,
  employmentType: null,
  workplaceType: null,
  city: "",
  salaryMin: "",
  salaryMax: "",
  datePosted: "ANY",
};

export const EMPLOYMENT_TYPES: EmploymentType[] = [
  "PERMANENT",
  "FIXED_TERM",
  "CONTRACT",
  "TEMPORARY",
  "INTERNSHIP",
  "FREELANCE",
];
export const WORKPLACE_TYPES: WorkplaceType[] = ["ONSITE", "HYBRID", "REMOTE"];
const SORT_OPTIONS: { value: JobSort; label: string; description: string }[] = [
  { value: "NEWEST", label: "Latest", description: "Most recently published first" },
  { value: "CLOSING", label: "Closing soon", description: "Jobs closing soonest first" },
];

export function sortLabel(sort: JobSort): string {
  return SORT_OPTIONS.find((option) => option.value === sort)?.label ?? "Latest";
}

/** publishedFrom ISO bound for the chosen date-posted window. */
export function jobPublishedFrom(datePosted: DatePosted): string | undefined {
  const days: Record<Exclude<DatePosted, "ANY">, number> = { "24H": 1, "7D": 7, "30D": 30 };
  return datePosted === "ANY"
    ? undefined
    : new Date(Date.now() - days[datePosted] * 86_400_000).toISOString();
}

/** Number of active filters for the Filters badge (location fields included). */
export function countActiveFilters(filters: JobsFilterState): number {
  return [
    filters.communityId,
    filters.scope,
    filters.categoryId,
    filters.employmentType,
    filters.workplaceType,
    filters.city.trim(),
    filters.salaryMin.trim(),
    filters.salaryMax.trim(),
    filters.datePosted === "ANY" ? null : filters.datePosted,
  ].filter(Boolean).length;
}

/** Location picker — community membership + free-text city (backend `city` ILIKE). */
export function LocationSheet({
  visible,
  communities,
  activeCommunityId,
  communityId,
  city,
  onApply,
  onClose,
}: {
  visible: boolean;
  communities: CommunityOption[];
  activeCommunityId: string | null;
  communityId: string | null;
  city: string;
  onApply: (value: { communityId: string | null; city: string }) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} title="Location" onClose={onClose}>
      {visible ? (
        <LocationForm
          communities={communities}
          activeCommunityId={activeCommunityId}
          communityId={communityId}
          city={city}
          onApply={onApply}
          onClose={onClose}
        />
      ) : null}
    </Sheet>
  );
}

function LocationForm({
  communities,
  activeCommunityId,
  communityId,
  city,
  onApply,
  onClose,
}: {
  communities: CommunityOption[];
  activeCommunityId: string | null;
  communityId: string | null;
  city: string;
  onApply: (value: { communityId: string | null; city: string }) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [draftCommunity, setDraftCommunity] = useState(communityId);
  const [draftCity, setDraftCity] = useState(city);
  const ordered = [...communities].sort((a, b) =>
    a.id === activeCommunityId ? -1 : b.id === activeCommunityId ? 1 : a.name.localeCompare(b.name));
  return (
    <>
      <ThemedText type="small" themeColor="textSecondary">
        Jobs are shown for your country plus the community you pick here.
      </ThemedText>
      <View style={styles.optionList}>
        <OptionRow
          icon="earth-outline"
          label="Anywhere"
          sublabel="Your country and active community"
          selected={draftCommunity === null}
          onPress={() => setDraftCommunity(null)}
        />
        {ordered.map((community) => (
          <OptionRow
            key={community.id}
            icon="people-outline"
            label={community.name}
            sublabel={community.id === activeCommunityId ? "Active community" : undefined}
            selected={draftCommunity === community.id}
            onPress={() => setDraftCommunity(community.id)}
          />
        ))}
      </View>
      <View style={styles.numberField}>
        <ThemedText type="smallBold">City or region</ThemedText>
        <TextInput
          accessibilityLabel="City or region"
          value={draftCity}
          onChangeText={setDraftCity}
          placeholder="Any city"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="words"
          style={[styles.textInput, { borderColor: theme.border, backgroundColor: theme.background, color: theme.text }]}
        />
      </View>
      <View style={styles.sheetActions}>
        <PrimaryButton label="Clear" variant="ghost"
          onPress={() => { onApply({ communityId: null, city: "" }); onClose(); }} />
        <PrimaryButton label="Apply" onPress={() => {
          onApply({ communityId: draftCommunity, city: draftCity.trim() });
          onClose();
        }} />
      </View>
    </>
  );
}

/** Server-side sort — only the options the API supports. */
export function SortSheet({
  visible,
  value,
  onApply,
  onClose,
}: {
  visible: boolean;
  value: JobSort;
  onApply: (sort: JobSort) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} title="Sort jobs" onClose={onClose}>
      <View style={styles.optionList}>
        {SORT_OPTIONS.map((option) => (
          <OptionRow
            key={option.value}
            icon={option.value === "NEWEST" ? "time-outline" : "alarm-outline"}
            label={option.label}
            sublabel={option.description}
            selected={value === option.value}
            onPress={() => { onApply(option.value); onClose(); }}
          />
        ))}
      </View>
    </Sheet>
  );
}

const REPORT_REASONS: {
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { value: "SCAM", icon: "alert-circle-outline" },
  { value: "SPAM", icon: "megaphone-outline" },
  { value: "MISINFORMATION", icon: "information-circle-outline" },
  { value: "IMPERSONATION", icon: "person-outline" },
  { value: "OTHER", icon: "ellipsis-horizontal-circle-outline" },
];

/** Report-a-job form — a real modal sheet so every reason renders (native alerts cap at ~3 buttons on Android). */
export function ReportSheet({
  visible,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (reason: string, details: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} title="Report job" onClose={onClose}>
      {visible ? (
        <ReportForm busy={busy} error={error} onSubmit={onSubmit} />
      ) : null}
    </Sheet>
  );
}

function ReportForm({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (reason: string, details: string) => void;
}) {
  const theme = useTheme();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  return (
    <>
      <ThemedText type="small" themeColor="textSecondary">
        Why are you reporting this opportunity? Our moderators review every
        report.
      </ThemedText>
      <View style={styles.optionList}>
        {REPORT_REASONS.map((item) => (
          <OptionRow
            key={item.value}
            icon={item.icon}
            label={label(item.value)}
            selected={reason === item.value}
            onPress={() => setReason(item.value)}
          />
        ))}
      </View>
      <TextInput
        multiline
        value={details}
        onChangeText={setDetails}
        placeholder="Add details for the moderators (optional)"
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel="Report details"
        maxLength={2000}
        style={[
          styles.detailsInput,
          {
            borderColor: theme.border,
            backgroundColor: theme.background,
            color: theme.text,
          },
        ]}
      />
      {error ? (
        <ThemedText
          style={[styles.errorText, { color: theme.error }]}
          accessibilityRole="alert"
        >
          {error}
        </ThemedText>
      ) : null}
      <PrimaryButton
        label="Submit report"
        loading={busy}
        disabled={!reason || busy}
        onPress={() => reason && onSubmit(reason, details.trim())}
      />
    </>
  );
}

function OptionRow({
  icon,
  label: text,
  sublabel,
  selected,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sublabel?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.option, { borderColor: selected ? theme.primary : theme.border,
        backgroundColor: selected ? theme.primarySurface : theme.background }]}
    >
      <Ionicons name={icon} size={20} color={selected ? theme.primary : theme.textSecondary} />
      <View style={styles.optionCopy}>
        <ThemedText type="smallBold" style={selected ? { color: theme.primary } : undefined}>{text}</ThemedText>
        {sublabel ? <ThemedText type="small" themeColor="textSecondary">{sublabel}</ThemedText> : null}
      </View>
      {selected ? <Ionicons name="checkmark-circle" size={21} color={theme.primary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  optionList: { gap: Spacing.two },
  detailsInput: {
    minHeight: 88,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.three,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: "top",
  },
  errorText: { fontSize: 13, textAlign: "center" },
  option: { flexDirection: "row", alignItems: "center", gap: Spacing.three,
    borderWidth: 1, borderRadius: BorderRadius.lg, padding: Spacing.three },
  optionCopy: { flex: 1, gap: 2 },
  numberField: { gap: Spacing.two },
  textInput: { minHeight: 48, borderWidth: 1, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.three, fontSize: 16 },
  sheetActions: { flexDirection: "row", justifyContent: "flex-end", gap: Spacing.two, marginTop: Spacing.two },
});
