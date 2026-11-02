import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useSession } from "@/core/session/session-provider";
import { createBusinessApi } from "@/features/business/services/business-api";
import type { BusinessAccount } from "@/features/business/types/business-types";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createJobApi } from "../services/job-api";
import type {
  ApplicationMethod,
  CreateJobRequest,
  EmploymentType,
  JobCategory,
  JobDetail,
  JobSourceType,
  MediaUploadSelection,
  UpdateJobRequest,
  VisibilityScope,
  WorkHoursType,
  WorkSchedule,
  WorkplaceType,
} from "../types/job-types";
import { label } from "../utils/job-format";

const EMPLOYMENT: EmploymentType[] = [
  "PERMANENT", "FIXED_TERM", "CONTRACT", "TEMPORARY", "CASUAL",
  "ZERO_HOURS", "SEASONAL", "APPRENTICESHIP", "INTERNSHIP", "VOLUNTEER",
  "FREELANCE", "COMMISSION", "SELF_EMPLOYED", "OTHER", "UNSPECIFIED",
];
const HOURS: WorkHoursType[] = [
  "FULL_TIME", "PART_TIME", "VARIABLE", "SHIFT_BASED", "FLEXIBLE", "UNSPECIFIED",
];
const SCHEDULES: WorkSchedule[] = [
  "DAY", "NIGHT", "ROTATING", "WEEKENDS", "MIXED", "OTHER",
];
const WORKPLACES: WorkplaceType[] = [
  "ONSITE", "HYBRID", "REMOTE", "MULTIPLE_LOCATIONS", "FIELD_BASED",
];
const SOURCES: JobSourceType[] = [
  "EMPLOYER_DIRECT", "RECRUITER", "COMMUNITY_SHARED", "COMMUNITY_ORGANIZATION",
];
const MANAGER_ROLES = new Set([
  "OWNER", "ADMINISTRATOR", "EDITOR", "LISTING_MANAGER",
]);

export interface JobFormState {
  communityId: string;
  visibilityScope: VisibilityScope;
  categoryIds: string[];
  businessAccountId: string | null;
  employerName: string;
  title: string;
  description: string;
  employmentType: EmploymentType;
  workHoursType: WorkHoursType;
  workSchedule: WorkSchedule | null;
  workplaceType: WorkplaceType;
  city: string;
  region: string;
  formattedAddress: string;
  salaryMin: string;
  salaryMax: string;
  salaryCurrency: string;
  applicationMethod: ApplicationMethod;
  applicationUrl: string;
  deadline: string;
  sourceType: JobSourceType;
  sourceName: string;
  sourceUrl: string;
  mediaIds: string[];
  image: MediaUploadSelection | null;
}

export function initialJobFormState(activeCommunityId = ""): JobFormState {
  return {
    communityId: activeCommunityId,
    visibilityScope: "COMMUNITY",
    categoryIds: [],
    businessAccountId: null,
    employerName: "",
    title: "",
    description: "",
    employmentType: "PERMANENT",
    workHoursType: "FULL_TIME",
    workSchedule: "DAY",
    workplaceType: "ONSITE",
    city: "",
    region: "",
    formattedAddress: "",
    salaryMin: "",
    salaryMax: "",
    salaryCurrency: "EUR",
    applicationMethod: "INTERNAL",
    applicationUrl: "",
    deadline: "",
    sourceType: "EMPLOYER_DIRECT",
    sourceName: "",
    sourceUrl: "",
    mediaIds: [],
    image: null,
  };
}

export function jobFormStateFromDetail(detail: JobDetail): JobFormState {
  const job = detail.job;
  return {
    ...initialJobFormState(job.communityId ?? ""),
    visibilityScope: job.visibilityScope,
    categoryIds: detail.categories.map((category) => category.id),
    businessAccountId: job.businessAccountId,
    employerName: job.employerName,
    title: job.title,
    description: job.description,
    employmentType: job.employmentType,
    workHoursType: job.workHoursType,
    workSchedule: job.workSchedule,
    workplaceType: job.workplaceType,
    city: detail.location?.city ?? "",
    region: detail.location?.region ?? "",
    formattedAddress: detail.location?.formattedAddress ?? "",
    salaryMin: job.salaryMin ?? "",
    salaryMax: job.salaryMax ?? "",
    salaryCurrency: job.salaryCurrency ?? "EUR",
    applicationMethod: job.applicationMethod,
    applicationUrl: job.applicationUrl ?? "",
    deadline: job.closesAt ? job.closesAt.slice(0, 10) : "",
    sourceType: job.sourceType,
    sourceName: job.sourceName ?? "",
    sourceUrl: job.sourceUrl ?? "",
    mediaIds: detail.mediaIds,
  };
}

function validWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function validateJobForm(
  form: JobFormState,
  publishing = true,
  now = new Date(),
): string | null {
  if (!form.communityId) return "Select an active community before posting a job.";
  if (form.categoryIds.length === 0) return "Select at least one job category.";
  if (form.categoryIds.length > 5) return "Select no more than five categories.";
  if (!form.employerName.trim()) return "Enter the employer name.";
  if (!form.title.trim()) return "Enter a job title.";
  if (!form.description.trim()) return "Enter a job description.";
  if (form.workplaceType !== "REMOTE" && !form.formattedAddress.trim() && !form.city.trim()) {
    return "Enter a public city or address, or choose Remote.";
  }
  const min = form.salaryMin.trim() ? Number(form.salaryMin) : null;
  const max = form.salaryMax.trim() ? Number(form.salaryMax) : null;
  if ((min !== null && (!Number.isFinite(min) || min < 0)) ||
      (max !== null && (!Number.isFinite(max) || max < 0))) {
    return "Salary values must be non-negative numbers.";
  }
  if (min !== null && max !== null && max < min) {
    return "Maximum salary cannot be lower than minimum salary.";
  }
  if ((min !== null || max !== null) && !/^[A-Za-z]{3}$/.test(form.salaryCurrency)) {
    return "Enter a three-letter salary currency.";
  }
  if (form.applicationMethod === "EXTERNAL" && !validWebUrl(form.applicationUrl.trim())) {
    return "Enter a valid HTTP(S) application URL without credentials or fragments.";
  }
  if (form.sourceUrl.trim() && !validWebUrl(form.sourceUrl.trim())) {
    return "Enter a valid HTTP(S) source URL without credentials or fragments.";
  }
  if (form.deadline) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.deadline)) {
      return "Deadline must use YYYY-MM-DD.";
    }
    const deadline = new Date(`${form.deadline}T23:59:59.999Z`);
    if (Number.isNaN(deadline.getTime()) || deadline.toISOString().slice(0, 10) !== form.deadline) {
      return "Enter a valid deadline.";
    }
    if (publishing && deadline.getTime() <= now.getTime()) {
      return "The application deadline must be in the future.";
    }
  }
  return null;
}

function optional(value: string): string | undefined {
  return value.trim() || undefined;
}

function deadline(value: string): string | undefined {
  return value ? new Date(`${value}T23:59:59.999Z`).toISOString() : undefined;
}

function salary(value: string): number | undefined {
  return value.trim() ? Number(value) : undefined;
}

export function toCreateJobRequest(
  form: JobFormState,
  draft: boolean,
  mediaIds = form.mediaIds,
): CreateJobRequest {
  return {
    communityId: form.communityId,
    visibilityScope: form.visibilityScope,
    categoryIds: form.categoryIds,
    employerName: form.employerName.trim(),
    title: form.title.trim(),
    description: form.description.trim(),
    employmentType: form.employmentType,
    workHoursType: form.workHoursType,
    ...(form.workSchedule ? { workSchedule: form.workSchedule } : {}),
    workplaceType: form.workplaceType,
    ...(form.workplaceType === "REMOTE" ? {} : {
      city: optional(form.city),
      region: optional(form.region),
      formattedAddress: optional(form.formattedAddress),
    }),
    salaryMin: salary(form.salaryMin),
    salaryMax: salary(form.salaryMax),
    salaryCurrency: salary(form.salaryMin) !== undefined || salary(form.salaryMax) !== undefined
      ? form.salaryCurrency.toUpperCase()
      : undefined,
    applicationMethod: form.applicationMethod,
    applicationUrl: form.applicationMethod === "EXTERNAL"
      ? form.applicationUrl.trim()
      : undefined,
    closesAt: deadline(form.deadline),
    businessAccountId: form.businessAccountId ?? undefined,
    sourceType: form.sourceType,
    sourceName: optional(form.sourceName),
    sourceUrl: optional(form.sourceUrl),
    mediaIds,
    draft,
  };
}

export function toUpdateJobRequest(
  form: JobFormState,
  published: boolean,
  mediaIds = form.mediaIds,
): UpdateJobRequest {
  const create = toCreateJobRequest(form, false, mediaIds);
  return {
    visibilityScope: create.visibilityScope,
    ...(published ? {} : { categoryIds: create.categoryIds }),
    employerName: create.employerName,
    title: create.title,
    description: create.description,
    employmentType: create.employmentType,
    workHoursType: create.workHoursType,
    workSchedule: create.workSchedule,
    clearWorkSchedule: !form.workSchedule,
    workplaceType: create.workplaceType,
    city: create.city,
    region: create.region,
    formattedAddress: create.formattedAddress,
    clearLocation: form.workplaceType === "REMOTE",
    salaryMin: create.salaryMin,
    salaryMax: create.salaryMax,
    salaryCurrency: create.salaryCurrency,
    clearSalary: create.salaryMin === undefined && create.salaryMax === undefined,
    applicationMethod: create.applicationMethod,
    applicationUrl: create.applicationUrl,
    closesAt: create.closesAt,
    clearDeadline: !form.deadline,
    sourceType: create.sourceType,
    sourceName: create.sourceName,
    sourceUrl: create.sourceUrl,
    mediaIds,
  };
}

export function JobForm({
  state,
  onChange,
  editingPublished = false,
}: {
  state: JobFormState;
  onChange: (patch: Partial<JobFormState>) => void;
  editingPublished?: boolean;
}) {
  const theme = useTheme();
  const { apiClient } = useSession();
  const [categories, setCategories] = useState<JobCategory[]>([]);
  const [accounts, setAccounts] = useState<BusinessAccount[]>([]);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    const jobs = createJobApi(apiClient);
    const business = createBusinessApi(apiClient);
    jobs.categories().then((result) => setCategories(result.items)).catch(() => setCategories([]));
    business.accounts()
      .then((result) => setAccounts(result.items.filter((account) =>
        account.status === "ACTIVE" && MANAGER_ROLES.has(account.role))))
      .catch(() => setAccounts([]));
  }, [apiClient]);

  async function pickImage() {
    if (picking || state.mediaIds.length >= 5) return;
    setPicking(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      onChange({
        image: {
          uri: asset.uri,
          mimeType: (asset.mimeType ?? "image/jpeg").toLowerCase(),
          fileName: asset.fileName ?? undefined,
        },
      });
    } finally {
      setPicking(false);
    }
  }

  return (
    <View style={styles.form}>
      <Section title="Ownership & visibility">
        <ChoiceRow
          values={[null, ...accounts.map((account) => account.id)] as (string | null)[]}
          current={state.businessAccountId}
          onSelect={(businessAccountId) => onChange({
            businessAccountId,
            employerName: businessAccountId
              ? accounts.find((account) => account.id === businessAccountId)?.accountName ?? state.employerName
              : state.employerName,
          })}
          renderLabel={(id) => id === null
            ? "Personal"
            : accounts.find((account) => account.id === id)?.accountName ?? "Business"}
        />
        <ChoiceRow
          values={["COMMUNITY", "COUNTRY"] as VisibilityScope[]}
          current={state.visibilityScope}
          onSelect={(visibilityScope) => onChange({ visibilityScope })}
          renderLabel={label}
        />
      </Section>
      <Section title="Opportunity">
        <Field label="Employer name" value={state.employerName}
          onChangeText={(employerName) => onChange({ employerName })} />
        <Field label="Job title" value={state.title}
          onChangeText={(title) => onChange({ title })} />
        <Field label="Description" value={state.description} multiline
          onChangeText={(description) => onChange({ description })} />
      </Section>
      <Section title="Categories">
        <ThemedText style={styles.hint} themeColor="textSecondary">
          Select one to five categories{editingPublished ? " (locked while published)" : ""}.
        </ThemedText>
        <View style={styles.wrap}>
          {categories.map((category) => {
            const selected = state.categoryIds.includes(category.id);
            return (
              <SelectChip key={category.id} text={category.displayName} active={selected}
                disabled={editingPublished}
                onPress={() => onChange({
                  categoryIds: selected
                    ? state.categoryIds.filter((id) => id !== category.id)
                    : state.categoryIds.length < 5
                      ? [...state.categoryIds, category.id]
                      : state.categoryIds,
                })} />
            );
          })}
        </View>
      </Section>
      <Section title="Classification">
        <ChoiceRow values={EMPLOYMENT} current={state.employmentType}
          onSelect={(employmentType) => onChange({ employmentType })} renderLabel={label} />
        <ChoiceRow values={HOURS} current={state.workHoursType}
          onSelect={(workHoursType) => onChange({ workHoursType })} renderLabel={label} />
        <ChoiceRow values={SCHEDULES} current={state.workSchedule}
          onSelect={(workSchedule) => onChange({
            workSchedule: state.workSchedule === workSchedule ? null : workSchedule,
          })} renderLabel={label} />
        <ChoiceRow values={WORKPLACES} current={state.workplaceType}
          onSelect={(workplaceType) => onChange({ workplaceType })} renderLabel={label} />
      </Section>
      {state.workplaceType !== "REMOTE" ? (
        <Section title="Public location">
          <Field label="City" value={state.city} onChangeText={(city) => onChange({ city })} />
          <Field label="Region" value={state.region} onChangeText={(region) => onChange({ region })} />
          <Field label="Formatted public address (no exact coordinates)" value={state.formattedAddress}
            onChangeText={(formattedAddress) => onChange({ formattedAddress })} />
        </Section>
      ) : null}
      <Section title="Compensation & deadline">
        <View style={styles.salaryRow}>
          <View style={styles.flex}><Field label="Minimum" value={state.salaryMin} numeric
            onChangeText={(salaryMin) => onChange({ salaryMin })} /></View>
          <View style={styles.flex}><Field label="Maximum" value={state.salaryMax} numeric
            onChangeText={(salaryMax) => onChange({ salaryMax })} /></View>
          <View style={styles.currency}><Field label="Currency" value={state.salaryCurrency} autoCapitalize="characters"
            onChangeText={(salaryCurrency) => onChange({ salaryCurrency })} /></View>
        </View>
        <Field label="Application deadline (YYYY-MM-DD, optional)" value={state.deadline}
          onChangeText={(deadline) => onChange({ deadline })} />
      </Section>
      <Section title="How to apply">
        <ChoiceRow values={["INTERNAL", "EXTERNAL"] as ApplicationMethod[]} current={state.applicationMethod}
          onSelect={(applicationMethod) => onChange({ applicationMethod })}
          renderLabel={(value) => value === "INTERNAL" ? "Apply in Diasporum" : "External website"} />
        {state.applicationMethod === "EXTERNAL" ? (
          <Field label="Application URL" value={state.applicationUrl} autoCapitalize="none"
            onChangeText={(applicationUrl) => onChange({ applicationUrl })} />
        ) : null}
      </Section>
      <Section title="Source">
        <ChoiceRow values={SOURCES} current={state.sourceType}
          onSelect={(sourceType) => onChange({ sourceType })} renderLabel={label} />
        <Field label="Source name (optional)" value={state.sourceName}
          onChangeText={(sourceName) => onChange({ sourceName })} />
        <Field label="Source URL (optional)" value={state.sourceUrl} autoCapitalize="none"
          onChangeText={(sourceUrl) => onChange({ sourceUrl })} />
      </Section>
      <Section title="Job image (optional)">
        <Pressable onPress={() => void pickImage()} disabled={picking || state.mediaIds.length >= 5}
          accessibilityRole="button" accessibilityLabel="Select job image"
          style={[styles.upload, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
          {picking ? <ActivityIndicator color={BrandColors.primary} /> : (
            <Ionicons name="image-outline" size={24} color={theme.text} />
          )}
          <ThemedText style={styles.uploadText}>
            {state.image ? state.image.fileName ?? "New image selected" : "Select an image"}
          </ThemedText>
        </Pressable>
        {state.mediaIds.length ? (
          <ThemedText style={styles.hint} themeColor="textSecondary">
            {state.mediaIds.length} existing image{state.mediaIds.length === 1 ? "" : "s"} attached.
          </ThemedText>
        ) : null}
        {state.image ? (
          <Pressable onPress={() => onChange({ image: null })} accessibilityRole="button">
            <ThemedText style={styles.remove}>Remove selected image</ThemedText>
          </Pressable>
        ) : null}
      </Section>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.section, { borderColor: theme.border }]}>
      <ThemedText type="subtitle" style={styles.sectionTitle}>{title}</ThemedText>
      {children}
    </View>
  );
}

function Field({ label: placeholder, value, onChangeText, multiline = false,
  numeric = false, autoCapitalize = "sentences" }: {
  label: string; value: string; onChangeText: (value: string) => void;
  multiline?: boolean; numeric?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  const theme = useTheme();
  return (
    <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder}
      placeholderTextColor={theme.textSecondary} multiline={multiline}
      keyboardType={numeric ? "decimal-pad" : "default"} autoCapitalize={autoCapitalize}
      style={[styles.input, { color: theme.text, borderColor: theme.border,
        backgroundColor: theme.backgroundElement }, multiline && styles.multiline]} />
  );
}

function ChoiceRow<T>({ values, current, onSelect, renderLabel }: {
  values: T[]; current: T | null; onSelect: (value: T) => void; renderLabel: (value: T) => string;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.choiceRow}>
        {values.map((value, index) => (
          <SelectChip key={`${String(value)}-${index}`} text={renderLabel(value)}
            active={current === value} onPress={() => onSelect(value)} />
        ))}
      </View>
    </ScrollView>
  );
}

function SelectChip({ text, active, onPress, disabled = false }: {
  text: string; active: boolean; onPress: () => void; disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      style={[styles.chip, { borderColor: active ? BrandColors.primary : theme.border,
        backgroundColor: active ? BrandColors.primary : theme.backgroundElement },
        disabled && styles.disabled]}>
      <ThemedText style={[styles.chipText, active && styles.selectedChip]}>{text}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  form: { padding: Spacing.four, gap: Spacing.three },
  section: { borderWidth: StyleSheet.hairlineWidth, borderRadius: BorderRadius.lg,
    padding: Spacing.three, gap: Spacing.three },
  sectionTitle: { fontSize: 16 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two, fontSize: 14 },
  multiline: { minHeight: 140, textAlignVertical: "top" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  choiceRow: { flexDirection: "row", gap: Spacing.two, paddingRight: Spacing.three },
  chip: { borderWidth: 1, borderRadius: BorderRadius.full, paddingHorizontal: 11,
    paddingVertical: 7 },
  chipText: { fontSize: 12, fontWeight: "600" },
  selectedChip: { color: BrandColors.white },
  disabled: { opacity: 0.55 },
  hint: { fontSize: 12, lineHeight: 17 },
  salaryRow: { flexDirection: "row", gap: Spacing.two },
  flex: { flex: 1 },
  currency: { width: 82 },
  upload: { minHeight: 80, borderWidth: 1, borderStyle: "dashed", borderRadius: 12,
    alignItems: "center", justifyContent: "center", gap: Spacing.two },
  uploadText: { fontSize: 13, fontWeight: "600" },
  remove: { color: BrandColors.error, fontSize: 13, textAlign: "center" },
});
