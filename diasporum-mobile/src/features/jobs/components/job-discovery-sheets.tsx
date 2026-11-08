/**
 * Bottom sheets for the Jobs dashboard — location picker, advanced filters,
 * and sort selection. Every option maps to a real /api/v1/jobs query param.
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
  JobCategory,
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
const DATE_POSTED: { value: DatePosted; label: string }[] = [
  { value: "ANY", label: "Any time" },
  { value: "24H", label: "Past 24 hours" },
  { value: "7D", label: "Past week" },
  { value: "30D", label: "Past month" },
];
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

/** Full filter sheet — every control maps to a supported discovery parameter. */
export function FiltersSheet({
  visible,
  filters,
  categories,
  communities,
  activeCommunityId,
  onApply,
  onClose,
}: {
  visible: boolean;
  filters: JobsFilterState;
  categories: JobCategory[];
  communities: CommunityOption[];
  activeCommunityId: string | null;
  onApply: (filters: JobsFilterState) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} title="Filters" onClose={onClose}>
      {visible ? (
        <FiltersForm
          filters={filters}
          categories={categories}
          communities={communities}
          activeCommunityId={activeCommunityId}
          onApply={onApply}
          onClose={onClose}
        />
      ) : null}
    </Sheet>
  );
}

function FiltersForm({
  filters,
  categories,
  communities,
  activeCommunityId,
  onApply,
  onClose,
}: {
  filters: JobsFilterState;
  categories: JobCategory[];
  communities: CommunityOption[];
  activeCommunityId: string | null;
  onApply: (filters: JobsFilterState) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<JobsFilterState>(filters);
  function patch(value: Partial<JobsFilterState>) {
    setDraft((current) => ({ ...current, ...value }));
  }
  return (
    <>
      {communities.length ? (
        <View style={styles.categoryGroup}>
          <ThemedText type="smallBold">Community</ThemedText>
          <View style={styles.categoryWrap}>
            <FilterChip label="Any" selected={!draft.communityId}
              onPress={() => patch({ communityId: null })} />
            {communities.map((community) => (
              <FilterChip key={community.id}
                label={community.id === activeCommunityId ? `${community.name} (active)` : community.name}
                selected={draft.communityId === community.id}
                onPress={() => patch({ communityId: draft.communityId === community.id ? null : community.id })} />
            ))}
          </View>
        </View>
      ) : null}
      <View style={styles.numberField}>
        <ThemedText type="smallBold">City or region</ThemedText>
        <SheetInput value={draft.city} onChange={(city) => patch({ city })}
          placeholder="Any city" accessibilityLabel="Filter city" />
      </View>
      <View style={styles.categoryGroup}>
        <ThemedText type="smallBold">Scope</ThemedText>
        <View style={styles.categoryWrap}>
          <FilterChip label="All scopes" selected={!draft.scope} onPress={() => patch({ scope: null })} />
          <FilterChip label="Community" selected={draft.scope === "COMMUNITY"}
            onPress={() => patch({ scope: "COMMUNITY" })} />
          <FilterChip label="Country" selected={draft.scope === "COUNTRY"}
            onPress={() => patch({ scope: "COUNTRY" })} />
        </View>
      </View>
      {categories.length ? (
        <View style={styles.categoryGroup}>
          <ThemedText type="smallBold">Job category</ThemedText>
          <View style={styles.categoryWrap}>
            {categories.map((category) => (
              <FilterChip key={category.id} label={category.displayName}
                selected={draft.categoryId === category.id}
                onPress={() => patch({ categoryId: draft.categoryId === category.id ? null : category.id })} />
            ))}
          </View>
        </View>
      ) : null}
      <View style={styles.categoryGroup}>
        <ThemedText type="smallBold">Employment type</ThemedText>
        <View style={styles.categoryWrap}>
          {EMPLOYMENT_TYPES.map((type) => (
            <FilterChip key={type} label={label(type)}
              selected={draft.employmentType === type}
              onPress={() => patch({ employmentType: draft.employmentType === type ? null : type })} />
          ))}
        </View>
      </View>
      <View style={styles.categoryGroup}>
        <ThemedText type="smallBold">Work arrangement</ThemedText>
        <View style={styles.categoryWrap}>
          {WORKPLACE_TYPES.map((type) => (
            <FilterChip key={type} label={type === "ONSITE" ? "On-site" : label(type)}
              selected={draft.workplaceType === type}
              onPress={() => patch({ workplaceType: draft.workplaceType === type ? null : type })} />
          ))}
        </View>
      </View>
      <View style={styles.categoryGroup}>
        <ThemedText type="smallBold">Salary</ThemedText>
        <View style={styles.datePair}>
          <View style={styles.flex}>
            <SheetInput value={draft.salaryMin} onChange={(salaryMin) => patch({ salaryMin })}
              placeholder="Minimum" accessibilityLabel="Minimum salary" numeric />
          </View>
          <View style={styles.flex}>
            <SheetInput value={draft.salaryMax} onChange={(salaryMax) => patch({ salaryMax })}
              placeholder="Maximum" accessibilityLabel="Maximum salary" numeric />
          </View>
        </View>
      </View>
      <View style={styles.categoryGroup}>
        <ThemedText type="smallBold">Date posted</ThemedText>
        <View style={styles.categoryWrap}>
          {DATE_POSTED.map((option) => (
            <FilterChip key={option.value} label={option.label}
              selected={draft.datePosted === option.value}
              onPress={() => patch({ datePosted: option.value })} />
          ))}
        </View>
      </View>
      <View style={styles.sheetActions}>
        <PrimaryButton label="Clear all" variant="ghost" onPress={() => setDraft(EMPTY_JOB_FILTERS)} />
        <PrimaryButton label="Show results" onPress={() => { onApply(draft); onClose(); }} />
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

function FilterChip({ label: text, selected, onPress }: {
  label: string;
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
      style={[styles.filterChip, { borderColor: selected ? theme.primary : theme.border,
        backgroundColor: selected ? theme.primarySurface : theme.background }]}
    >
      <ThemedText type="small" style={{ color: selected ? theme.primary : theme.text }}>{text}</ThemedText>
    </Pressable>
  );
}

function SheetInput({ value, onChange, placeholder, accessibilityLabel, numeric = false }: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  numeric?: boolean;
}) {
  const theme = useTheme();
  return (
    <TextInput
      accessibilityLabel={accessibilityLabel}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={theme.textSecondary}
      keyboardType={numeric ? "decimal-pad" : "default"}
      style={[styles.textInput, { borderColor: theme.border, backgroundColor: theme.background, color: theme.text }]}
    />
  );
}

const styles = StyleSheet.create({
  optionList: { gap: Spacing.two },
  option: { flexDirection: "row", alignItems: "center", gap: Spacing.three,
    borderWidth: 1, borderRadius: BorderRadius.lg, padding: Spacing.three },
  optionCopy: { flex: 1, gap: 2 },
  categoryGroup: { gap: Spacing.two },
  categoryWrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  filterChip: { borderWidth: 1, borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  numberField: { gap: Spacing.two },
  textInput: { minHeight: 48, borderWidth: 1, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.three, fontSize: 16 },
  datePair: { flexDirection: "row", gap: Spacing.two },
  flex: { flex: 1 },
  sheetActions: { flexDirection: "row", justifyContent: "flex-end", gap: Spacing.two, marginTop: Spacing.two },
});
