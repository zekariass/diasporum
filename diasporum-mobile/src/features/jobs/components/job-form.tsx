import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useSession } from "@/core/session/session-provider";
import { createBusinessApi } from "@/features/business/services/business-api";
import type { BusinessAccount } from "@/features/business/types/business-types";
import { useTheme } from "@/hooks/use-theme";
import { ChoiceChip, DateField, DetailRow, Field, FormInput, SegmentedControl, SurfaceCard } from "@/shared/components/form-controls";
import { SelectField } from "@/shared/components/select-field";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { CURRENCIES } from "@/shared/utils/currencies";
import { createJobApi } from "../services/job-api";
import type { JobCategory, VisibilityScope } from "../types/job-types";
import { label } from "../utils/job-format";
import {
  EMPLOYMENT_TYPES,
  JOB_STEP_HINTS,
  JOB_STEP_TITLES,
  MANAGER_ROLES,
  SOURCE_TYPES,
  WORK_HOURS_TYPES,
  WORK_SCHEDULES,
  WORKPLACE_TYPES,
  type JobFormState,
} from "../utils/job-form-state";

/** Code-first options so the closed field shows "EUR" while rows stay searchable. */
const CURRENCY_FIELD_OPTIONS = CURRENCIES.map((currency) => ({
  id: currency.code,
  label: currency.code,
  sublabel: `${currency.name}${currency.symbol ? ` ${currency.symbol}` : ""}`,
}));

const SCHEDULE_OPTIONS = [
  { id: "", label: "Not specified" },
  ...WORK_SCHEDULES.map((schedule) => ({ id: schedule, label: label(schedule) })),
];

const MAX_IMAGES = 5;

export function JobForm({
  state,
  onChange,
  step = 0,
  editingPublished = false,
  lockOwnership = false,
}: {
  state: JobFormState;
  onChange: (patch: Partial<JobFormState>) => void;
  step?: number;
  editingPublished?: boolean;
  lockOwnership?: boolean;
}) {
  const theme = useTheme();
  const { apiClient } = useSession();
  const [categories, setCategories] = useState<JobCategory[]>([]);
  const [accounts, setAccounts] = useState<BusinessAccount[]>([]);
  const [picking, setPicking] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  useEffect(() => {
    const jobs = createJobApi(apiClient);
    const business = createBusinessApi(apiClient);
    jobs.categories().then((result) => setCategories(result.items)).catch(() => setCategories([]));
    business.accounts()
      .then((result) => setAccounts(result.items.filter((account) =>
        account.status === "ACTIVE" && MANAGER_ROLES.has(account.role))))
      .catch(() => setAccounts([]));
  }, [apiClient]);

  const selectedAccount = accounts.find((account) => account.id === state.businessAccountId);

  async function pickImage() {
    if (picking || state.mediaIds.length + (state.image ? 1 : 0) >= MAX_IMAGES) return;
    setPicking(true);
    setImageError(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setImageError("Allow photo library access to add a job image.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const mime = (asset.mimeType ?? "image/jpeg").toLowerCase();
      if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
        setImageError("Choose a JPEG, PNG, or WebP image.");
        return;
      }
      onChange({
        image: {
          uri: asset.uri,
          mimeType: mime,
          fileName: asset.fileName ?? undefined,
        },
      });
    } finally {
      setPicking(false);
    }
  }

  function toggleCategory(id: string) {
    const selected = state.categoryIds.includes(id);
    onChange({
      categoryIds: selected
        ? state.categoryIds.filter((value) => value !== id)
        : state.categoryIds.length < 5
          ? [...state.categoryIds, id]
          : state.categoryIds,
    });
  }

  const location = [state.city, state.region, state.formattedAddress]
    .map((value) => value.trim()).filter(Boolean).join(", ");
  const salary = (() => {
    const min = state.salaryMin.trim();
    const max = state.salaryMax.trim();
    if (!min && !max) return "Not shown";
    const currency = state.salaryCurrency.toUpperCase();
    if (min && max) return `${currency} ${min} – ${max}`;
    if (min) return `From ${currency} ${min}`;
    return `Up to ${currency} ${max}`;
  })();

  return (
    <ScrollView
      key={step}
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <ThemedText style={styles.stepTitle}>{JOB_STEP_TITLES[step]}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.stepHint}>
        {JOB_STEP_HINTS[step]}
      </ThemedText>

      {step === 0 ? (
        <SurfaceCard>
          <Field label="Post as" hint={lockOwnership ? "Ownership can't be changed after the job is created." : undefined}>
            <View style={styles.ownerList}>
              <OwnerOption
                icon="person-outline"
                title="Personal"
                subtitle="Post as yourself"
                selected={!state.businessAccountId}
                disabled={lockOwnership}
                onPress={() => onChange({ businessAccountId: null })}
              />
              {accounts.map((account) => (
                <OwnerOption
                  key={account.id}
                  icon="business-outline"
                  title={account.accountName}
                  subtitle="Business account"
                  selected={state.businessAccountId === account.id}
                  disabled={lockOwnership}
                  onPress={() => onChange({
                    businessAccountId: account.id,
                    employerName: account.accountName || state.employerName,
                  })}
                />
              ))}
            </View>
          </Field>
          {selectedAccount ? (
            <View style={[styles.notice, { backgroundColor: theme.primarySurface }]}>
              <Ionicons name="information-circle-outline" size={19} color={theme.primary} />
              <ThemedText type="small" style={styles.noticeText}>
                This job will be owned by {selectedAccount.accountName}. Your listing access is verified again when you save.
              </ThemedText>
            </View>
          ) : null}
          <SegmentedControl
            label="Audience"
            value={state.visibilityScope}
            values={[
              { value: "COMMUNITY" as VisibilityScope, label: "Community", icon: "people-outline" },
              { value: "COUNTRY" as VisibilityScope, label: "Country", icon: "earth-outline" },
            ]}
            onChange={(visibilityScope) => onChange({ visibilityScope })}
          />
        </SurfaceCard>
      ) : null}

      {step === 1 ? (
        <SurfaceCard>
          <FormInput label="Employer name (required)" value={state.employerName}
            onChangeText={(employerName) => onChange({ employerName })}
            placeholder="e.g. Diasporum GmbH" maxLength={160} />
          <FormInput label="Job title (required)" value={state.title}
            onChangeText={(title) => onChange({ title })}
            placeholder="e.g. Backend engineer" maxLength={220} />
          <FormInput label="Description (required)" value={state.description} multiline
            onChangeText={(description) => onChange({ description })}
            placeholder="Responsibilities, requirements, and what you offer" maxLength={20000} />
          <Field
            label={`Categories (required) — ${state.categoryIds.length}/5`}
            hint={editingPublished ? "Categories are locked while the job is published." : "Select one to five categories."}
          >
            <View style={[styles.choices, editingPublished && styles.locked]} pointerEvents={editingPublished ? "none" : "auto"}>
              {categories.map((category) => (
                <ChoiceChip
                  key={category.id}
                  label={category.displayName}
                  selected={state.categoryIds.includes(category.id)}
                  onPress={() => toggleCategory(category.id)}
                />
              ))}
            </View>
          </Field>
        </SurfaceCard>
      ) : null}

      {step === 2 ? (
        <SurfaceCard>
          <SelectField
            label="Employment type"
            value={state.employmentType}
            options={EMPLOYMENT_TYPES.map((type) => ({ id: type, label: label(type) }))}
            onChange={(employmentType) => onChange({ employmentType: employmentType as JobFormState["employmentType"] })}
            modalTitle="Employment type"
            searchPlaceholder="Search types"
          />
          <SelectField
            label="Work hours"
            value={state.workHoursType}
            options={WORK_HOURS_TYPES.map((type) => ({ id: type, label: label(type) }))}
            onChange={(workHoursType) => onChange({ workHoursType: workHoursType as JobFormState["workHoursType"] })}
            modalTitle="Work hours"
            searchPlaceholder="Search hours"
          />
          <SelectField
            label="Work schedule"
            value={state.workSchedule ?? ""}
            options={SCHEDULE_OPTIONS}
            onChange={(workSchedule) => onChange({ workSchedule: (workSchedule || null) as JobFormState["workSchedule"] })}
            modalTitle="Work schedule"
            searchPlaceholder="Search schedules"
          />
          <SelectField
            label="Workplace type"
            value={state.workplaceType}
            options={WORKPLACE_TYPES.map((type) => ({ id: type, label: label(type) }))}
            onChange={(workplaceType) => onChange({ workplaceType: workplaceType as JobFormState["workplaceType"] })}
            modalTitle="Workplace type"
            searchPlaceholder="Search workplaces"
          />
          {state.workplaceType === "REMOTE" ? (
            <View style={[styles.notice, { backgroundColor: theme.primarySurface }]}>
              <Ionicons name="globe-outline" size={19} color={theme.primary} />
              <ThemedText type="small" style={styles.noticeText}>Remote roles don&apos;t show a public location.</ThemedText>
            </View>
          ) : (
            <Field label="Public location" hint="Applicants see only city, region, and a public address — never exact coordinates.">
              <FormInput label="City" value={state.city}
                onChangeText={(city) => onChange({ city })} placeholder="e.g. Frankfurt" />
              <FormInput label="Region" value={state.region}
                onChangeText={(region) => onChange({ region })} placeholder="e.g. Hesse" />
              <FormInput label="Public address" value={state.formattedAddress}
                onChangeText={(formattedAddress) => onChange({ formattedAddress })}
                placeholder="e.g. Frankfurt city centre" />
            </Field>
          )}
        </SurfaceCard>
      ) : null}

      {step === 3 ? (
        <SurfaceCard>
          <Field label="Salary range" hint="Leave both empty to hide pay on the listing.">
            <View style={styles.salaryRow}>
              <View style={styles.salaryGrow}>
                <FormInput label="Minimum" value={state.salaryMin} keyboardType="decimal-pad"
                  onChangeText={(salaryMin) => onChange({ salaryMin })} placeholder="0.00" />
              </View>
              <View style={styles.salaryGrow}>
                <FormInput label="Maximum" value={state.salaryMax} keyboardType="decimal-pad"
                  onChangeText={(salaryMax) => onChange({ salaryMax })} placeholder="0.00" />
              </View>
              <View style={styles.currency}>
                <SelectField
                  label="Currency"
                  value={state.salaryCurrency}
                  options={CURRENCY_FIELD_OPTIONS}
                  onChange={(salaryCurrency) => onChange({ salaryCurrency })}
                  modalTitle="Currency"
                  searchPlaceholder="Search currencies"
                />
              </View>
            </View>
          </Field>
          <DateField
            label="Application deadline"
            value={state.deadline}
            onChange={(deadline) => onChange({ deadline })}
            optional
          />
          <ThemedText type="small" themeColor="textSecondary">
            Leave the deadline empty to keep the job open until you close it.
          </ThemedText>
        </SurfaceCard>
      ) : null}

      {step === 4 ? (
        <>
          <SurfaceCard>
            <SegmentedControl
              label="How to apply"
              value={state.applicationMethod}
              values={[
                { value: "INTERNAL" as const, label: "In Diasporum", icon: "document-text-outline" },
                { value: "EXTERNAL" as const, label: "External site", icon: "open-outline" },
              ]}
              onChange={(applicationMethod) => onChange({ applicationMethod })}
            />
            {state.applicationMethod === "EXTERNAL" ? (
              <FormInput label="Application URL (required)" value={state.applicationUrl}
                autoCapitalize="none" keyboardType="url"
                onChangeText={(applicationUrl) => onChange({ applicationUrl })}
                placeholder="https://example.com/careers" />
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                Applicants apply inside Diasporum with a cover letter and optional résumé.
              </ThemedText>
            )}
            <SelectField
              label="Listing source"
              value={state.sourceType}
              options={SOURCE_TYPES.map((type) => ({ id: type, label: label(type) }))}
              onChange={(sourceType) => onChange({ sourceType: sourceType as JobFormState["sourceType"] })}
              modalTitle="Listing source"
              searchPlaceholder="Search sources"
            />
            <FormInput label="Source name (optional)" value={state.sourceName}
              onChangeText={(sourceName) => onChange({ sourceName })}
              placeholder="e.g. Company careers page" />
            <FormInput label="Source URL (optional)" value={state.sourceUrl}
              autoCapitalize="none" keyboardType="url"
              onChangeText={(sourceUrl) => onChange({ sourceUrl })}
              placeholder="https://…" />
          </SurfaceCard>
          <SurfaceCard>
            <Field label="Job image" hint={`Optional · up to ${MAX_IMAGES} images on the listing`}>
              {state.image ? (
                <View style={styles.previewWrap}>
                  <Image source={{ uri: state.image.uri }} style={styles.preview} accessibilityLabel="Selected job image" />
                  <Pressable onPress={() => onChange({ image: null })} accessibilityRole="button" accessibilityLabel="Remove selected image" style={[styles.removeImage, { backgroundColor: theme.background }]}>
                    <Ionicons name="close" size={17} color={theme.text} />
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => void pickImage()}
                  disabled={picking || state.mediaIds.length >= MAX_IMAGES}
                  accessibilityRole="button"
                  accessibilityLabel="Select job image"
                  style={[styles.upload, { borderColor: theme.border, backgroundColor: theme.background }, state.mediaIds.length >= MAX_IMAGES && styles.locked]}
                >
                  {picking ? <ActivityIndicator color={theme.primary} /> : <Ionicons name="image-outline" size={26} color={theme.primary} />}
                  <ThemedText type="smallBold" style={{ color: theme.primary }}>
                    {state.mediaIds.length >= MAX_IMAGES ? "Image limit reached" : "Add a job image"}
                  </ThemedText>
                </Pressable>
              )}
            </Field>
            {state.mediaIds.length ? (
              <ThemedText type="small" themeColor="textSecondary">
                {state.mediaIds.length} image{state.mediaIds.length === 1 ? "" : "s"} already attached — manage them from the job after saving.
              </ThemedText>
            ) : null}
            {imageError ? (
              <ThemedText type="small" style={{ color: theme.error }} accessibilityRole="alert">{imageError}</ThemedText>
            ) : null}
          </SurfaceCard>
        </>
      ) : null}

      {step === 5 ? (
        <SurfaceCard>
          <ThemedText style={styles.reviewTitle}>{state.title.trim() || "Untitled job"}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {state.employerName.trim() || "No employer"}
            {location ? ` · ${location}` : state.workplaceType === "REMOTE" ? " · Remote" : ""}
          </ThemedText>
          <DetailRow icon="person-outline" label="Post as"
            value={selectedAccount ? selectedAccount.accountName : "Personal"} />
          <DetailRow icon="people-outline" label="Audience" value={label(state.visibilityScope)} />
          <DetailRow icon="grid-outline" label="Categories"
            value={categories.filter((category) => state.categoryIds.includes(category.id))
              .map((category) => category.displayName).join(", ") || "—"} />
          <DetailRow icon="time-outline" label="Role"
            value={[state.employmentType, state.workHoursType, state.workSchedule, state.workplaceType]
              .filter(Boolean).map((value) => label(value as string)).join(" · ")} />
          {state.workplaceType !== "REMOTE" ? (
            <DetailRow icon="location-outline" label="Public location" value={location || "—"} />
          ) : null}
          <DetailRow icon="cash-outline" label="Salary" value={salary} />
          <DetailRow icon="calendar-outline" label="Deadline" value={state.deadline || "Open until closed"} />
          <DetailRow icon="paper-plane-outline" label="Apply via"
            value={state.applicationMethod === "INTERNAL" ? "In Diasporum" : state.applicationUrl || "External site"} />
          <DetailRow icon="link-outline" label="Source"
            value={state.sourceName.trim() || label(state.sourceType)} />
          <DetailRow icon="image-outline" label="Images"
            value={`${state.mediaIds.length + (state.image ? 1 : 0)} of ${MAX_IMAGES}`} />
        </SurfaceCard>
      ) : null}
    </ScrollView>
  );
}

function OwnerOption({
  icon,
  title,
  subtitle,
  selected,
  disabled = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Post as ${title}`}
      accessibilityState={{ selected, disabled }}
      style={[styles.ownerCard, {
        borderColor: selected ? theme.primary : theme.border,
        backgroundColor: selected ? theme.primarySurface : theme.background,
      }, disabled && styles.locked]}
    >
      <View style={[styles.ownerIcon, { backgroundColor: selected ? theme.background : theme.primarySurface }]}>
        <Ionicons name={icon} size={19} color={theme.primary} />
      </View>
      <View style={styles.ownerCopy}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{subtitle}</ThemedText>
      </View>
      <Ionicons
        name={selected ? "checkmark-circle" : "ellipse-outline"}
        size={22}
        color={selected ? theme.primary : theme.textSecondary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: Spacing.two, paddingBottom: Spacing.five, gap: Spacing.two },
  stepTitle: { fontSize: 26, lineHeight: 32, fontWeight: "800" },
  stepHint: { marginBottom: Spacing.one },
  ownerList: { gap: Spacing.two },
  ownerCard: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: Spacing.two, borderWidth: 1, borderRadius: BorderRadius.md, padding: Spacing.two },
  ownerIcon: { width: 40, height: 40, borderRadius: BorderRadius.md, alignItems: "center", justifyContent: "center" },
  ownerCopy: { flex: 1, minWidth: 0, gap: 2 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.two, borderRadius: BorderRadius.md, padding: Spacing.two },
  noticeText: { flex: 1 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  locked: { opacity: 0.55 },
  salaryRow: { flexDirection: "row", gap: Spacing.two, alignItems: "flex-start" },
  salaryGrow: { flex: 1 },
  currency: { width: 96 },
  previewWrap: { position: "relative" },
  preview: { width: "100%", height: 190, borderRadius: BorderRadius.lg },
  removeImage: { position: "absolute", top: Spacing.two, right: Spacing.two, width: 30, height: 30, borderRadius: BorderRadius.full, alignItems: "center", justifyContent: "center" },
  upload: { minHeight: 96, borderWidth: 1, borderStyle: "dashed", borderRadius: BorderRadius.md, alignItems: "center", justifyContent: "center", gap: Spacing.one },
  reviewTitle: { fontSize: 20, lineHeight: 26, fontWeight: "700" },
});
