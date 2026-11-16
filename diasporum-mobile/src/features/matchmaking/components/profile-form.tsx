import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as Location from "expo-location";
import { useSession } from "@/core/session/session-provider";
import {
  createProfileApi,
  type ProfileCompatibility,
} from "@/features/profile/services/profile-api";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { ThemedText } from "@/components/themed-text";
import { FormInput } from "@/shared/components/form-input";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { profileChoices } from "../types/matchmaking-options";
import type {
  MatchmakingPhotoList,
  MatchmakingProfile,
  MatchmakingProfileRequest,
  MatchmakingReferenceData,
  MatchmakingStatus,
  SharedProfileDraft,
} from "../types/matchmaking-types";
import { matchmakingError } from "../services/matchmaking-errors";
import { Ionicons } from "@expo/vector-icons";
import {
  ChoiceChips,
  PillTabBar,
  Section,
  SelectField,
} from "./matchmaking-ui";
import { MatchmakingPhotoManager } from "./photo-manager";
import { PrivacyNote, ToggleCard } from "./wizard-ui";

export function useSharedProfileForm() {
  const { apiClient, session, updateProfile } = useSession();
  const api = useMemo(() => createProfileApi(apiClient), [apiClient]);
  const [catalog, setCatalog] = useState<ProfileCompatibility | null>(null);
  const [form, setForm] = useState<SharedProfileDraft>(() => ({
    bio: session?.profile?.bio ?? "",
    city: session?.profile?.city ?? "",
    currentCountryId: session?.profile?.currentCountryId ?? null,
    interestIds: [],
    languageIds: [],
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const busy = useRef(false);
  const restored = useRef(false);
  const revision = useRef(0);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setError(null);
    try {
      const result = await api.compatibility();
      if (request !== generation.current) return;
      setCatalog(result);
      if (!restored.current)
        setForm((current) => ({
          ...current,
          interestIds: result.interestIds,
          languageIds: result.languageIds,
        }));
    } catch (cause) {
      if (request === generation.current)
        setError(
          matchmakingError(cause, "Your shared profile could not be loaded."),
        );
    }
  }, [api]);
  const invalidateLoad = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return invalidateLoad;
  }, [invalidateLoad, load]);
  const change = (next: Partial<SharedProfileDraft>) => {
    revision.current++;
    if (next.interestIds || next.languageIds) restored.current = true;
    setDirty(true);
    setForm((current) => ({ ...current, ...next }));
  };
  const restore = useCallback((next: SharedProfileDraft) => {
    revision.current++;
    restored.current = true;
    setForm(next);
    setDirty(true);
  }, []);
  const save = async () => {
    if (busy.current || !catalog) return false;
    if (!dirty) return true;
    const savingRevision = revision.current;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      await updateProfile({
        bio: form.bio,
        city: form.city,
        ...(form.currentCountryId
          ? { currentCountryId: form.currentCountryId }
          : {}),
      });
      setCatalog(
        await api.saveCompatibility(form.interestIds, form.languageIds),
      );
      if (revision.current === savingRevision) setDirty(false);
      return revision.current === savingRevision;
    } catch (cause) {
      setError(
        matchmakingError(
          cause,
          "Shared profile changes could not all be saved. Retry to finish saving.",
        ),
      );
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  const locate = async (remove = false) => {
    if (busy.current || !catalog) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      if (remove) await api.removeDiscoveryLocation();
      else {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted)
          throw new Error(
            "Location permission was declined. You can use Dating without a distance filter.",
          );
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        await api.saveDiscoveryLocation(
          location.coords.latitude,
          location.coords.longitude,
        );
      }
      setCatalog((current) =>
        current ? { ...current, hasDiscoveryLocation: !remove } : current,
      );
    } catch (cause) {
      setError(
        matchmakingError(
          cause,
          cause instanceof Error
            ? cause.message
            : "Location could not be updated.",
        ),
      );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  return {
    form,
    catalog,
    error,
    saving,
    dirty,
    change,
    restore,
    save,
    locate,
    retry: load,
  };
}

export function SharedProfileFields({
  state,
  references,
  group,
  compact = false,
  framed = false,
}: {
  state: ReturnType<typeof useSharedProfileForm>;
  references: MatchmakingReferenceData;
  group?: "about" | "compatibility" | "location";
  compact?: boolean;
  framed?: boolean;
}) {
  const { form, catalog, change } = state;
  return (
    <>
      {state.error ? (
        <>
          <ThemedText themeColor="error" accessibilityRole="alert">
            {state.error}
          </ThemedText>
          {!catalog ? (
            <PrimaryButton
              label="Retry shared profile"
              onPress={() => void state.retry()}
            />
          ) : null}
        </>
      ) : null}
      {!group || group === "about" ? (
        <Section
          title="About you"
          hint="This is your existing Diasporum biography. Changes also appear on your general profile."
          compact={compact}
          framed={framed}
        >
          <FormInput
            label="About me"
            value={form.bio}
            multiline
            maxLength={800}
            onChangeText={(bio) => change({ bio })}
          />
        </Section>
      ) : null}
      {(!group || group === "compatibility") && catalog ? (
        <Section
          title="What connects you"
          hint="Choose up to 30 interests and languages. These are shared with your general profile."
          compact={compact}
          framed={framed}
        >
          <ChoiceChips
            label="Your interests"
            choices={catalog.interests}
            value={form.interestIds}
            multi
            onChange={(value) =>
              change({
                interestIds: (Array.isArray(value) ? value : []).slice(0, 30),
              })
            }
          />
          <ChoiceChips
            label="Your languages"
            choices={catalog.languages}
            value={form.languageIds}
            multi
            onChange={(value) =>
              change({
                languageIds: (Array.isArray(value) ? value : []).slice(0, 30),
              })
            }
          />
        </Section>
      ) : null}
      {!group || group === "location" ? (
        <Section
          title="Where you are"
          hint="Country and city reuse your general profile. Never enter a street address here."
          compact={compact}
          framed={framed}
        >
          <SelectField
            label="Current country"
            value={form.currentCountryId}
            options={references.countries}
            required
            searchable
            onChange={(currentCountryId) => change({ currentCountryId })}
          />
          <FormInput
            label="City"
            value={form.city}
            maxLength={120}
            onChangeText={(city) => change({ city })}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Optional: allow an approximate device location for distance filters.
            It is rounded before storage and never shown to candidates. This
            setting saves immediately. Removing it may prevent discovery with
            finite-distance preferences until you add a location again.
          </ThemedText>
          <PrimaryButton
            label={
              catalog?.hasDiscoveryLocation
                ? "Update approximate location"
                : "Allow approximate location"
            }
            variant="secondary"
            loading={state.saving}
            disabled={!catalog || state.saving}
            onPress={() => void state.locate()}
          />
          {catalog?.hasDiscoveryLocation ? (
            <PrimaryButton
              label="Remove discovery location"
              variant="ghost"
              disabled={state.saving}
              onPress={() => void state.locate(true)}
            />
          ) : null}
        </Section>
      ) : null}
    </>
  );
}

export function profileRequestFrom(
  profile: MatchmakingProfile | null,
  references: MatchmakingReferenceData,
): MatchmakingProfileRequest {
  return {
    genderKey: profile?.genderKey ?? references.genders[0]?.id ?? "",
    addressId: profile?.addressId ?? null,
    nationalityCountryId: profile?.nationalityCountryId ?? null,
    religionId: profile?.religionId ?? null,
    educationLevel: profile?.educationLevel ?? null,
    occupation: profile?.occupation ?? null,
    relationshipIntention: profile?.relationshipIntention ?? null,
    maritalStatus: profile?.maritalStatus ?? null,
    hasChildren: profile?.hasChildren ?? null,
    wantsChildren: profile?.wantsChildren ?? null,
    smoking: profile?.smoking ?? null,
    drinking: profile?.drinking ?? null,
    activityLevel: profile?.activityLevel ?? null,
    heightCm: profile?.heightCm ?? null,
    marriageTimeline: profile?.marriageTimeline ?? null,
    longDistanceRelationship: profile?.longDistanceRelationship ?? null,
    religionImportance: profile?.religionImportance ?? null,
    willingToRelocate: profile?.willingToRelocate ?? null,
    blurPhotosUntilMatch: profile?.blurPhotosUntilMatch ?? true,
    hideNameUntilMatch: profile?.hideNameUntilMatch ?? true,
    anonymousAlias: profile?.anonymousAlias ?? "Diasporum member",
    status:
      profile?.status === "ACTIVE" || profile?.status === "PAUSED"
        ? profile.status
        : "DRAFT",
  };
}

type EditTab = "bio" | "details" | "photos" | "lifestyle" | "privacy";

const EDIT_TABS: {
  key: EditTab;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: "bio", label: "Bio", icon: "reader" },
  { key: "details", label: "Details", icon: "person-outline" },
  { key: "photos", label: "Photos", icon: "images-outline" },
  { key: "lifestyle", label: "Lifestyle", icon: "git-branch-outline" },
  { key: "privacy", label: "Privacy", icon: "eye-outline" },
];

function BioField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.bioField}>
      <ThemedText
        type="small"
        themeColor="textSecondary"
        style={styles.bioLabel}
      >
        Bio
      </ThemedText>
      <View
        style={[
          styles.bioInputWrap,
          { backgroundColor: theme.background, borderColor: theme.border },
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          multiline
          maxLength={800}
          textAlignVertical="top"
          placeholder="Tell others about yourself..."
          placeholderTextColor={theme.textSecondary}
          accessibilityLabel="Bio"
          style={[styles.bioInput, { color: theme.text }]}
        />
        <ThemedText
          type="small"
          themeColor="textSecondary"
          style={styles.bioCounter}
        >
          {`${value.length}/800`}
        </ThemedText>
      </View>
    </View>
  );
}

export function ProfileForm({
  profile,
  references,
  status,
  saving,
  submitLabel,
  onSubmit,
}: {
  profile: MatchmakingProfile | null;
  references: MatchmakingReferenceData;
  status: Extract<MatchmakingStatus, "DRAFT" | "ACTIVE" | "PAUSED">;
  saving: boolean;
  submitLabel: string;
  onSubmit: (request: MatchmakingProfileRequest) => void;
}) {
  const theme = useTheme();
  const [form, setForm] = useState<MatchmakingProfileRequest>(() => ({
    ...profileRequestFrom(profile, references),
    status,
  }));
  const [height, setHeight] = useState(form.heightCm?.toString() ?? "");
  const shared = useSharedProfileForm();
  const [error, setError] = useState<string | null>(null);
  const [gallery, setGallery] = useState<MatchmakingPhotoList>({
    photos: profile?.photos ?? [],
    maxPhotos: profile?.maxProfilePhotos ?? 6,
  });
  const [tab, setTab] = useState<EditTab>("bio");

  const completion = useMemo(() => {
    const checks = [
      Boolean(shared.form.bio.trim()),
      Boolean(form.genderKey),
      Boolean(form.anonymousAlias.trim()),
      Boolean(form.nationalityCountryId),
      Boolean(form.religionId),
      Boolean(form.educationLevel),
      Boolean(form.occupation?.trim()),
      Boolean(height.trim()),
      Boolean(form.relationshipIntention),
      Boolean(form.maritalStatus),
      form.hasChildren != null,
      Boolean(form.wantsChildren),
      Boolean(form.smoking),
      Boolean(form.drinking),
      Boolean(form.activityLevel),
      gallery.photos.length > 0,
      Boolean(shared.form.currentCountryId),
      Boolean(shared.form.city.trim()),
      shared.form.interestIds.length > 0,
      shared.form.languageIds.length > 0,
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [form, gallery.photos.length, height, shared.form]);
  const filledSegments = Math.round(completion / 20);

  const set = (
    field: keyof MatchmakingProfileRequest,
    value: string | number | boolean | null,
  ) => {
    setForm((current) => ({ ...current, [field]: value }));
  };
  const single =
    (field: keyof MatchmakingProfileRequest) =>
    (value: string | null | string[]) => {
      set(field, Array.isArray(value) ? (value[0] ?? null) : value);
    };
  const submit = async () => {
    const parsedHeight = height.trim() ? Number(height) : null;
    if (!form.genderKey || !form.anonymousAlias.trim()) {
      setError("Gender and a nickname are required.");
      setTab("details");
      return;
    }
    if (
      parsedHeight !== null &&
      (!Number.isInteger(parsedHeight) ||
        parsedHeight < 80 ||
        parsedHeight > 250)
    ) {
      setError("Height must be a whole number between 80 and 250 cm.");
      setTab("details");
      return;
    }
    setError(null);
    if (!(await shared.save())) return;
    onSubmit({
      ...form,
      anonymousAlias: form.anonymousAlias.trim(),
      occupation: form.occupation?.trim() || null,
      heightCm: parsedHeight,
      status,
    });
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.progressBlock}>
        <View
          style={styles.progressSegments}
          accessibilityRole="progressbar"
          accessibilityLabel="Profile completion"
          accessibilityValue={{ min: 0, max: 100, now: completion }}
        >
          {Array.from({ length: 5 }, (_, index) => (
            <View
              key={index}
              style={[
                styles.progressSegment,
                {
                  backgroundColor:
                    index < filledSegments
                      ? theme.primary
                      : theme.backgroundElement,
                },
              ]}
            />
          ))}
        </View>
        <ThemedText
          type="small"
          themeColor="textSecondary"
          style={styles.progressLabel}
        >
          Profile completion:{" "}
          <ThemedText style={{ color: theme.primary, fontWeight: "800" }}>
            {completion}%
          </ThemedText>
        </ThemedText>
      </View>

      <PillTabBar
        tabs={EDIT_TABS}
        active={tab}
        onChange={(key) => setTab(key as EditTab)}
      />

      <ScrollView
        style={styles.formScroll}
        contentContainerStyle={styles.formContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {tab === "bio" ? (
          <Section
            title="About You"
            hint="This is your existing Diasporum biography. Changes also appear on your general profile."
            compact
            framed
          >
            <BioField
              value={shared.form.bio}
              onChange={(bio) => shared.change({ bio })}
            />
          </Section>
        ) : null}

        {tab === "details" ? (
          <>
            <Section
              title="Identity"
              hint="Only the privacy-approved name and photos are shown to candidates."
              compact
              framed
            >
              <ChoiceChips
                label="Gender"
                choices={references.genders}
                value={form.genderKey}
                onChange={single("genderKey")}
                required
              />
              <FormInput
                label="Nickname"
                value={form.anonymousAlias}
                maxLength={80}
                onChangeText={(value) => set("anonymousAlias", value)}
                required
              />
            </Section>

            <Section title="Background" compact framed>
              <SelectField
                label="Nationality"
                options={references.countries}
                searchable
                value={form.nationalityCountryId}
                onChange={single("nationalityCountryId")}
              />
              <SelectField
                label="Religion"
                options={references.religions}
                searchable
                value={form.religionId}
                onChange={single("religionId")}
              />
              <ChoiceChips
                label="Religion importance"
                choices={profileChoices(references, "religionImportance")}
                value={form.religionImportance}
                onChange={single("religionImportance")}
              />
              <SelectField
                label="Private address reference"
                options={references.addresses}
                value={form.addressId}
                onChange={single("addressId")}
              />
              <ThemedText type="small" themeColor="textSecondary">
                Only your saved private addresses are listed. Exact coordinates
                and address details are never shared.
              </ThemedText>
              <ChoiceChips
                label="Education"
                choices={profileChoices(references, "education")}
                value={form.educationLevel}
                onChange={single("educationLevel")}
              />
              <FormInput
                label="Occupation"
                value={form.occupation ?? ""}
                maxLength={160}
                onChangeText={(value) => set("occupation", value)}
              />
              <FormInput
                label="Height (cm)"
                value={height}
                keyboardType="number-pad"
                maxLength={3}
                onChangeText={setHeight}
                hint="Optional, 80–250 cm"
              />
            </Section>

            <Section title="Relationship" compact framed>
              <ChoiceChips
                label="Intention"
                choices={profileChoices(references, "intentions")}
                value={form.relationshipIntention}
                onChange={single("relationshipIntention")}
              />
              <ChoiceChips
                label="Marital status"
                choices={profileChoices(references, "marital")}
                value={form.maritalStatus}
                onChange={single("maritalStatus")}
              />
              <ChoiceChips
                label="I have children"
                choices={[
                  { value: "YES", label: "Yes" },
                  { value: "NO", label: "No" },
                ]}
                value={
                  form.hasChildren == null
                    ? null
                    : form.hasChildren
                      ? "YES"
                      : "NO"
                }
                onChange={(value) =>
                  set("hasChildren", value == null ? null : value === "YES")
                }
              />
              <ChoiceChips
                label="Wants children"
                choices={profileChoices(references, "wantsChildren")}
                value={form.wantsChildren}
                onChange={single("wantsChildren")}
              />
              <ChoiceChips
                label="Marriage timeline"
                choices={profileChoices(references, "timeline")}
                value={form.marriageTimeline}
                onChange={single("marriageTimeline")}
              />
              {(["longDistanceRelationship", "willingToRelocate"] as const).map(
                (field) => (
                  <ChoiceChips
                    key={field}
                    label={
                      field === "longDistanceRelationship"
                        ? "Open to a long-distance relationship"
                        : "Willing to relocate"
                    }
                    choices={[
                      { value: "YES", label: "Yes" },
                      { value: "NO", label: "No" },
                    ]}
                    value={
                      form[field] == null ? null : form[field] ? "YES" : "NO"
                    }
                    onChange={(value) =>
                      set(field, value == null ? null : value === "YES")
                    }
                  />
                ),
              )}
            </Section>

            <SharedProfileFields
              state={shared}
              references={references}
              group="location"
              compact
              framed
            />
          </>
        ) : null}

        {tab === "photos" ? (
          <Section
            title="Your Photos"
            hint="The primary photo leads your profile. Blurred versions are generated on Diasporum's servers — originals stay private until a match."
            compact
            framed
          >
            <MatchmakingPhotoManager
              photos={gallery.photos}
              maxPhotos={gallery.maxPhotos}
              onChange={setGallery}
              disabled={saving}
            />
          </Section>
        ) : null}

        {tab === "lifestyle" ? (
          <>
            <Section
              title="Lifestyle"
              hint="A few everyday details help members understand what life with you looks like."
              compact
              framed
            >
              <ChoiceChips
                label="Smoking"
                choices={profileChoices(references, "habits")}
                value={form.smoking}
                onChange={single("smoking")}
              />
              <ChoiceChips
                label="Drinking"
                choices={profileChoices(references, "habits")}
                value={form.drinking}
                onChange={single("drinking")}
              />
              <ChoiceChips
                label="Activity level"
                choices={profileChoices(references, "activity")}
                value={form.activityLevel}
                onChange={single("activityLevel")}
              />
            </Section>
            <SharedProfileFields
              state={shared}
              references={references}
              group="compatibility"
              compact
              framed
            />
          </>
        ) : null}

        {tab === "privacy" ? (
          <Section
            title="Privacy"
            hint="You control what candidates see before a mutual match."
            compact
            framed
          >
            <ToggleCard
              icon="contrast"
              label="Blur my photos until matching"
              hint="Candidates see a blurred version of your photos until you both like each other."
              value={form.blurPhotosUntilMatch}
              onChange={(value) => set("blurPhotosUntilMatch", value)}
            />
            <ToggleCard
              icon="eye-off"
              label="Hide my name until matching"
              hint="Candidates see your nickname instead of your name until you match."
              value={form.hideNameUntilMatch}
              onChange={(value) => set("hideNameUntilMatch", value)}
            />
            <PrivacyNote>
              When you like someone, they can see your primary photo. Your other
              photos and hidden name stay private until you match.
            </PrivacyNote>
          </Section>
        ) : null}

        {error ? (
          <ThemedText themeColor="error" accessibilityRole="alert">
            {error}
          </ThemedText>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.footer,
          { backgroundColor: theme.background, borderTopColor: theme.border },
        ]}
      >
        <PrimaryButton
          label={submitLabel}
          onPress={() => void submit()}
          loading={saving || shared.saving}
          disabled={shared.saving || !shared.catalog}
          style={styles.saveButton}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  progressBlock: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.two,
  },
  progressSegments: { flexDirection: "row", gap: Spacing.two, height: 7 },
  progressSegment: { flex: 1, borderRadius: BorderRadius.full },
  progressLabel: { textAlign: "center" },
  formScroll: { flex: 1 },
  formContent: {
    padding: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
  bioField: { gap: Spacing.two },
  bioLabel: { fontWeight: "600" },
  bioInputWrap: {
    minHeight: 230,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
  },
  bioInput: {
    minHeight: 228,
    padding: Spacing.three,
    paddingBottom: 44,
    fontSize: 16,
    lineHeight: 24,
  },
  bioCounter: {
    position: "absolute",
    right: Spacing.three,
    bottom: Spacing.two,
  },
  footer: {
    padding: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveButton: { width: "100%", minHeight: 56 },
});
