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
import { StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { FormInput } from "@/shared/components/form-input";
import { PrimaryButton } from "@/shared/components/primary-button";
import { Spacing } from "@/shared/theme/spacing";
import { profileChoices } from "../types/matchmaking-options";
import type {
  FieldVisibility,
  MatchmakingProfile,
  MatchmakingProfileRequest,
  MatchmakingReferenceData,
  MatchmakingStatus,
  SharedProfileDraft,
} from "../types/matchmaking-types";
import { matchmakingError } from "../services/matchmaking-errors";
import { useMatchmakingPhotoUpload } from "../hooks/use-matchmaking-photos";
import {
  ChoiceChips,
  ProfilePhoto,
  Section,
  SelectField,
} from "./matchmaking-ui";

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
}: {
  state: ReturnType<typeof useSharedProfileForm>;
  references: MatchmakingReferenceData;
  group?: "about" | "compatibility" | "location";
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
          hint="Country and city reuse your general profile. City visibility follows your privacy settings. Never enter a street address here."
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
    photoMediaId: profile?.photoMediaId ?? null,
    nameVisibility: profile?.nameVisibility ?? "BLURRED",
    photoVisibility: profile?.photoVisibility ?? "HIDDEN",
    anonymousAlias: profile?.anonymousAlias ?? "Diasporum member",
    status:
      profile?.status === "ACTIVE" || profile?.status === "PAUSED"
        ? profile.status
        : "DRAFT",
  };
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
  const [form, setForm] = useState<MatchmakingProfileRequest>(() => ({
    ...profileRequestFrom(profile, references),
    status,
  }));
  const [height, setHeight] = useState(form.heightCm?.toString() ?? "");
  const shared = useSharedProfileForm();
  const [error, setError] = useState<string | null>(null);
  const { uploading, photoUri, upload, hydratePreview, clearPreview } =
    useMatchmakingPhotoUpload();

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
  const pick = async () => {
    setError(null);
    try {
      const uploaded = await upload();
      if (uploaded) {
        set("photoMediaId", uploaded.assetId);
      }
    } catch (uploadError) {
      setError(
        matchmakingError(
          uploadError,
          uploadError instanceof Error
            ? uploadError.message
            : "The photo could not be uploaded.",
        ),
      );
    }
  };
  // Existing profile — show the saved original via the owner-scoped URL.
  useEffect(() => {
    if (form.photoMediaId && !photoUri) {
      void hydratePreview(form.photoMediaId).catch(() => {});
    }
  }, [form.photoMediaId, photoUri, hydratePreview]);

  const submit = async () => {
    const parsedHeight = height.trim() ? Number(height) : null;
    if (!form.genderKey || !form.anonymousAlias.trim()) {
      setError("Gender and a nickname are required.");
      return;
    }
    if (
      parsedHeight !== null &&
      (!Number.isInteger(parsedHeight) ||
        parsedHeight < 80 ||
        parsedHeight > 250)
    ) {
      setError("Height must be a whole number between 80 and 250 cm.");
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
    <View style={styles.form}>
      <Section
        title="Identity"
        hint="Only the visibility-approved name and photo are shown to candidates."
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
        <ChoiceChips
          label="Name visibility"
          choices={profileChoices(references, "visibility")}
          value={form.nameVisibility}
          onChange={(value) => set("nameVisibility", value as FieldVisibility)}
          required
        />
        <ChoiceChips
          label="Photo visibility"
          choices={profileChoices(references, "visibility")}
          value={form.photoVisibility}
          onChange={(value) => set("photoVisibility", value as FieldVisibility)}
          required
        />
        <View style={styles.photoRow}>
          <View style={styles.photoItem}>
            <ProfilePhoto uri={photoUri} name="Photo" size={76} />
            <PrimaryButton
              label={form.photoMediaId ? "Replace photo" : "Upload photo"}
              variant="secondary"
              loading={uploading}
              disabled={uploading}
              onPress={() => void pick()}
            />
          </View>
          {form.photoMediaId ? (
            <View style={styles.photoItem}>
              <PrimaryButton
                label="Remove photo"
                variant="ghost"
                disabled={uploading}
                onPress={() => {
                  set("photoMediaId", null);
                  clearPreview();
                }}
              />
            </View>
          ) : null}
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          Upload your original photo once — Diasporum automatically creates the
          blurred version for Blurred visibility. Hidden visibility shows no
          photo.
        </ThemedText>
      </Section>

      <Section title="Background">
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
          Only your saved private addresses are listed. Exact coordinates and
          address details are never shared.
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

      <Section title="Relationship">
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
            form.hasChildren == null ? null : form.hasChildren ? "YES" : "NO"
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
              value={form[field] == null ? null : form[field] ? "YES" : "NO"}
              onChange={(value) =>
                set(field, value == null ? null : value === "YES")
              }
            />
          ),
        )}
      </Section>

      <Section title="Lifestyle">
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

      {error ? (
        <ThemedText themeColor="error" accessibilityRole="alert">
          {error}
        </ThemedText>
      ) : null}
      <SharedProfileFields state={shared} references={references} />
      <PrimaryButton
        label={submitLabel}
        onPress={() => void submit()}
        loading={saving || shared.saving}
        disabled={uploading || shared.saving || !shared.catalog}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: Spacing.five },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.four },
  photoItem: { alignItems: "center", gap: Spacing.two, flex: 1, minWidth: 145 },
});
