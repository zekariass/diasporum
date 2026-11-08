import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, usePreventRemove } from "expo-router";
import { ThemedText } from "@/components/themed-text";
import { FormInput } from "@/shared/components/form-input";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { profileChoices } from "../types/matchmaking-options";
import type {
  FieldVisibility,
  MatchmakingProfile,
  MatchmakingProfileRequest,
  MatchmakingReferenceData,
} from "../types/matchmaking-types";
import { matchmakingError } from "../services/matchmaking-errors";
import { useMatchmakingPhotoUpload } from "../hooks/use-matchmaking-photos";
import { loadWizardDraft, saveWizardDraft } from "../utils/wizard-progress";
import { SelectField } from "./matchmaking-ui";
import {
  FieldLabel,
  GridItem,
  OptionCard,
  OptionChips,
  OptionGrid,
  OptionRows,
  PrivacyNote,
  StepQuestion,
  StepTransition,
  ToggleCard,
  WizardHeader,
} from "./wizard-ui";
import {
  profileRequestFrom,
  SharedProfileFields,
  useSharedProfileForm,
} from "./profile-form";

type IconName = keyof typeof Ionicons.glyphMap;

const GENDER_ICONS: Record<string, IconName> = {
  WOMAN: "woman",
  MAN: "man",
  NON_BINARY: "male-female",
  OTHER: "person",
  PREFER_NOT_TO_SAY: "eye-off",
};

const INTENTION_ICONS: Record<string, IconName> = {
  MARRIAGE: "diamond",
  SERIOUS_RELATIONSHIP: "heart",
  LONG_TERM_DATING: "infinite",
  NOT_SURE_YET: "sparkles",
};

const VISIBILITY_ICONS: Record<FieldVisibility, IconName> = {
  VISIBLE: "eye",
  BLURRED: "contrast",
  HIDDEN: "eye-off",
};

const STEPS = [
  {
    key: "gender",
    icon: "male-female",
    title: "Which gender do you identify with?",
    description: "This appears on your Dating profile.",
  },
  {
    key: "alias",
    icon: "chatbubble-ellipses",
    title: "What should we call you?",
    description:
      "A nickname keeps your name private until you choose otherwise.",
  },
  {
    key: "intention",
    icon: "diamond",
    title: "What are you looking for?",
    description: "Optional — let people know what you hope to find.",
  },
  {
    key: "marital",
    icon: "people",
    title: "What is your marital status?",
    description: "Pick the option that describes you best.",
  },
  {
    key: "children",
    icon: "happy",
    title: "A few questions about family",
    description: "Optional — share only what feels right.",
  },
  {
    key: "timeline",
    icon: "calendar",
    title: "When do you hope to marry?",
    description: "Helps set expectations with candidates who share your goal.",
  },
  {
    key: "distance",
    icon: "airplane",
    title: "Open to love across distance?",
    description: "Tell us how flexible you are about where you end up.",
  },
  {
    key: "origin",
    icon: "earth",
    title: "Where are you from?",
    description:
      "Optional — share your nationality and an existing private address reference.",
  },
  {
    key: "faith",
    icon: "sparkles",
    title: "Your faith",
    description: "Optional — religion matters differently to everyone.",
  },
  {
    key: "work",
    icon: "briefcase",
    title: "Education and work",
    description: "A little about what you do and how far you studied.",
  },
  {
    key: "body",
    icon: "fitness",
    title: "A little more about you",
    description: "Optional physical details candidates often ask about.",
  },
  {
    key: "habits",
    icon: "leaf",
    title: "Your lifestyle",
    description: "Everyday habits — everything here is optional.",
  },
  {
    key: "about",
    icon: "chatbubble",
    title: "Tell your story",
    description: "Optional — start with the biography already on your profile.",
  },
  {
    key: "compatibility",
    icon: "heart-half",
    title: "What brings you together?",
    description:
      "Optional — interests and languages help people get to know you.",
  },
  {
    key: "location",
    icon: "location",
    title: "Where is home right now?",
    description:
      "Use your existing country and city. Your exact location stays private.",
  },
  {
    key: "photos",
    icon: "camera",
    title: "Add your photo",
    description:
      "Optional — choose a photo that feels like you. You control who sees it.",
  },
  {
    key: "privacy",
    icon: "shield-checkmark",
    title: "You stay in control",
    description: "Decide what candidates can see before you go live.",
  },
  {
    key: "participation",
    icon: "compass",
    title: "Ready for your next chapter?",
    description:
      "Dating is optional. Next, choose your preferences and preview your profile before activation.",
  },
] as const;

const STAGES = [
  { title: "Basic profile", icon: "person", start: 0, end: 13 },
  { title: "Location", icon: "location", start: 14, end: 14 },
  { title: "Photo", icon: "camera", start: 15, end: 15 },
  { title: "Privacy", icon: "shield-checkmark", start: 16, end: 17 },
] as const;

const stageAt = (step: number) =>
  STAGES.findIndex((stage) => step >= stage.start && step <= stage.end);

/**
 * Guided step-by-step Dating profile creation — one or two questions per
 * screen so the form never feels like a wall of fields. The same request
 * shape as before is assembled locally and only submitted on the final step;
 * leaving mid-flow best-effort saves a server-side DRAFT so onboarding can
 * be resumed, and the furthest step is stored locally for the same reason.
 */
export function SetupWizard({
  profile,
  references,
  optIn,
  optInSaving,
  onOptInChange,
  saving,
  submitError,
  onSubmit,
  onSaveDraft,
  userId,
}: {
  profile: MatchmakingProfile | null;
  references: MatchmakingReferenceData;
  optIn: boolean;
  optInSaving: boolean;
  onOptInChange: (value: boolean) => void;
  saving: boolean;
  submitError: string | null;
  onSubmit: (request: MatchmakingProfileRequest) => Promise<boolean>;
  /** Best-effort silent draft save used when the user exits mid-flow. */
  onSaveDraft: (request: MatchmakingProfileRequest) => Promise<void>;
  userId: string | null;
}) {
  const theme = useTheme();
  const visibilityOptions = profileChoices(references, "visibility").map(
    (option) => ({
      ...option,
      icon: VISIBILITY_ICONS[option.value as FieldVisibility] ?? "eye",
    }),
  );
  const [step, setStep] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [form, setForm] = useState<MatchmakingProfileRequest>(() => ({
    ...profileRequestFrom(profile, references),
    // No silent defaults — required answers are explicit user choices.
    genderKey: profile?.genderKey ?? "",
    anonymousAlias: profile?.anonymousAlias ?? "",
    status: "DRAFT",
  }));
  const [height, setHeight] = useState(form.heightCm?.toString() ?? "");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<1 | -1>(1);
  const submitted = useRef(false);
  const actionBusy = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const shared = useSharedProfileForm();
  const { restore: restoreShared } = shared;
  const { uploading, photoUri, upload, hydratePreview, clearPreview } =
    useMatchmakingPhotoUpload();

  const set = (
    field: keyof MatchmakingProfileRequest,
    value: string | number | boolean | null,
  ) => {
    setDirty(true);
    setForm((current) => ({ ...current, [field]: value }));
  };
  const single =
    (field: keyof MatchmakingProfileRequest) =>
    (value: string | null | string[]) => {
      set(field, Array.isArray(value) ? (value[0] ?? null) : value);
    };
  const updateHeight = (value: string) => {
    setDirty(true);
    setHeight(value);
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
        matchmakingError(uploadError, "The photo could not be uploaded."),
      );
    }
  };

  const removePhoto = () => {
    set("photoMediaId", null);
    clearPreview();
  };

  const parsedHeight = height.trim() ? Number(height) : null;
  const heightInvalid =
    parsedHeight !== null &&
    (!Number.isInteger(parsedHeight) ||
      parsedHeight < 80 ||
      parsedHeight > 250);
  const last = step === STEPS.length - 1;

  const buildRequest = (): MatchmakingProfileRequest => ({
    ...form,
    anonymousAlias: form.anonymousAlias.trim(),
    occupation: form.occupation?.trim() || null,
    heightCm: parsedHeight,
    status: "DRAFT",
  });

  /** Minimum data a DRAFT save needs — mirrors backend required fields. */
  const canSaveDraft =
    Boolean(form.genderKey) &&
    Boolean(form.anonymousAlias.trim()) &&
    !heightInvalid;

  // Leaving mid-flow with usable answers → silently persist the draft, then
  // let the blocked navigation continue. On re-entry the draft restores all
  // answers and the stored step marker resumes where the user stopped.
  usePreventRemove(
    (dirty || shared.dirty) && canSaveDraft && !saving && !submitting,
    ({ repeat }) => {
      if (submitted.current) {
        repeat();
        return;
      }
      void Promise.resolve(onSaveDraft(buildRequest()))
        .catch(() => {})
        .finally(() => {
          setDirty(false);
          repeat();
        });
    },
  );

  // Resume — restore the step and the locally saved answers so even an app
  // kill mid-flow continues where it stopped. The server draft is only
  // written on leave/submit, so the local copy can be fresher.
  useEffect(() => {
    let active = true;
    void loadWizardDraft(userId).then((saved) => {
      if (!active) return;
      if (saved && (!profile || profile.status === "DRAFT")) {
        setForm((current) => ({ ...current, ...saved.request }));
        setHeight(saved.request.heightCm?.toString() ?? "");
        const keyedStep = STEPS.findIndex((item) => item.key === saved.stepKey);
        setStep(
          keyedStep >= 0 ? keyedStep : Math.min(saved.step, STEPS.length - 1),
        );
        if (saved.shared) restoreShared(saved.shared);
        // Restored answers are unsaved relative to the server — keep persisting.
        setDirty(true);
      }
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, [userId, profile, restoreShared]);

  // Persist every change locally — this is what survives an app close.
  useEffect(() => {
    if (hydrated && (dirty || shared.dirty) && !submitted.current) {
      void saveWizardDraft(userId, {
        step,
        stepKey: STEPS[step].key,
        request: { ...form, heightCm: heightInvalid ? null : parsedHeight },
        shared: shared.catalog ? shared.form : undefined,
      });
    }
  }, [
    hydrated,
    dirty,
    userId,
    step,
    form,
    parsedHeight,
    heightInvalid,
    shared.dirty,
    shared.form,
    shared.catalog,
  ]);

  // Resumed draft — show the already-uploaded original via the owner URL.
  useEffect(() => {
    if (form.photoMediaId && !photoUri) {
      void hydratePreview(form.photoMediaId).catch(() => {});
    }
  }, [form.photoMediaId, photoUri, hydratePreview]);

  /** Inline validation message for the current step, or null when it passes. */
  const stepProblem = (): string | null => {
    const key = STEPS[step].key;
    if (key === "gender" && !form.genderKey) {
      return "Choose your gender to continue.";
    }
    if (key === "alias" && !form.anonymousAlias.trim()) {
      return "Enter a nickname to continue.";
    }
    if (key === "body" && heightInvalid) {
      return "Height must be a whole number between 80 and 250 cm.";
    }
    if (key === "location" && !shared.form.currentCountryId) {
      return "Choose your current country to continue.";
    }
    if (
      key === "privacy" &&
      form.photoVisibility !== "HIDDEN" &&
      !form.photoMediaId
    ) {
      return "Add a photo or choose Hidden photo visibility to continue.";
    }
    return null;
  };

  /** Continue stays disabled while required answers are missing or invalid. */
  const blocked =
    Boolean(stepProblem()) ||
    uploading ||
    saving ||
    optInSaving ||
    shared.saving ||
    submitting ||
    (last && !shared.catalog);

  const goTo = (nextStep: number) => {
    setDirection(nextStep > step ? 1 : -1);
    setError(null);
    setStep(nextStep);
  };

  const finish = async (exit: boolean) => {
    if (actionBusy.current) return;
    actionBusy.current = true;
    submitted.current = true;
    setSubmitting(true);
    try {
      await saveWizardDraft(userId, {
        step,
        stepKey: STEPS[step].key,
        request: buildRequest(),
        shared: shared.catalog ? shared.form : undefined,
      });
      if (!(await shared.save())) {
        submitted.current = false;
        return;
      }
      if (exit) {
        await onSaveDraft(buildRequest());
        setDirty(false);
        router.back();
      } else {
        const success = await onSubmit(buildRequest());
        submitted.current = success;
        if (success) {
          setDirty(false);
          await saveWizardDraft(userId, {
            step,
            stepKey: STEPS[step].key,
            request: buildRequest(),
            shared: shared.catalog ? shared.form : undefined,
            profileSaved: true,
          });
        }
      }
    } catch (cause) {
      submitted.current = false;
      setError(
        matchmakingError(
          cause,
          "Your answers could not be saved. Please retry.",
        ),
      );
    } finally {
      actionBusy.current = false;
      setSubmitting(false);
    }
  };

  const next = () => {
    if (blocked || actionBusy.current) return;
    const problem = stepProblem();
    if (problem) {
      setError(problem);
      return;
    }
    if (!last) {
      goTo(step + 1);
      return;
    }
    void finish(false);
  };

  const back = () => {
    if (step > 0) {
      goTo(step - 1);
      return;
    }
    router.back();
  };

  const content: Record<string, React.ReactNode> = {
    gender: (
      <OptionGrid>
        {references.genders.map((gender, index) => (
          <GridItem
            key={gender.id}
            wide={
              references.genders.length % 2 === 1 &&
              index === references.genders.length - 1
            }
          >
            <OptionCard
              icon={GENDER_ICONS[gender.id] ?? "person"}
              label={gender.label}
              selected={form.genderKey === gender.id}
              accessibilityLabel={gender.label}
              onPress={() => set("genderKey", gender.id)}
            />
          </GridItem>
        ))}
      </OptionGrid>
    ),
    alias: (
      <>
        <FormInput
          label="Nickname"
          value={form.anonymousAlias}
          maxLength={80}
          placeholder="e.g. Moon traveller"
          required
          onChangeText={(value) => set("anonymousAlias", value)}
        />
        <PrivacyNote>
          Candidates see this nickname, not your real name, while name
          visibility is hidden or blurred.
        </PrivacyNote>
      </>
    ),
    intention: (
      <OptionGrid>
        {profileChoices(references, "intentions").map((option) => (
          <GridItem key={option.value}>
            <OptionCard
              icon={INTENTION_ICONS[option.value] ?? "heart"}
              label={option.label}
              selected={form.relationshipIntention === option.value}
              accessibilityLabel={option.label}
              onPress={() =>
                set(
                  "relationshipIntention",
                  form.relationshipIntention === option.value
                    ? null
                    : option.value,
                )
              }
            />
          </GridItem>
        ))}
      </OptionGrid>
    ),
    marital: (
      <OptionRows
        label="Marital status"
        options={profileChoices(references, "marital")}
        value={form.maritalStatus}
        onChange={single("maritalStatus")}
      />
    ),
    children: (
      <>
        <View style={styles.fieldGroup}>
          <FieldLabel label="Do you have children?" />
          <OptionGrid>
            <GridItem>
              <OptionCard
                icon="happy"
                label="Yes"
                selected={form.hasChildren === true}
                accessibilityLabel="Have children: Yes"
                onPress={() =>
                  set("hasChildren", form.hasChildren === true ? null : true)
                }
              />
            </GridItem>
            <GridItem>
              <OptionCard
                icon="close-circle"
                label="No"
                selected={form.hasChildren === false}
                accessibilityLabel="Have children: No"
                onPress={() =>
                  set("hasChildren", form.hasChildren === false ? null : false)
                }
              />
            </GridItem>
          </OptionGrid>
        </View>
        <OptionChips
          label="Would you like children?"
          options={profileChoices(references, "wantsChildren")}
          value={form.wantsChildren}
          onChange={single("wantsChildren")}
        />
      </>
    ),
    timeline: (
      <OptionRows
        label="Marriage timeline"
        options={profileChoices(references, "timeline")}
        value={form.marriageTimeline}
        onChange={single("marriageTimeline")}
      />
    ),
    distance: (
      <>
        {(["longDistanceRelationship", "willingToRelocate"] as const).map(
          (field) => (
            <OptionChips
              key={field}
              label={
                field === "longDistanceRelationship"
                  ? "Open to a long-distance relationship"
                  : "Willing to relocate"
              }
              options={[
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
      </>
    ),
    origin: (
      <>
        <SelectField
          label="Nationality"
          options={references.countries}
          value={form.nationalityCountryId}
          onChange={single("nationalityCountryId")}
          searchable
        />
        <SelectField
          label="Private address reference"
          options={references.addresses}
          value={form.addressId}
          onChange={single("addressId")}
        />
        <PrivacyNote>
          Only your saved private addresses are listed. Exact coordinates are
          never shared.
        </PrivacyNote>
      </>
    ),
    faith: (
      <>
        <SelectField
          label="Religion"
          options={references.religions}
          value={form.religionId}
          onChange={single("religionId")}
          searchable
        />
        <OptionChips
          label="How important is religion to you?"
          options={profileChoices(references, "religionImportance")}
          value={form.religionImportance}
          onChange={single("religionImportance")}
        />
      </>
    ),
    work: (
      <>
        <OptionChips
          label="Education"
          options={profileChoices(references, "education")}
          value={form.educationLevel}
          onChange={single("educationLevel")}
        />
        <FormInput
          label="Occupation"
          value={form.occupation ?? ""}
          maxLength={160}
          placeholder="e.g. Software engineer"
          onChangeText={(value) => set("occupation", value)}
        />
      </>
    ),
    body: (
      <>
        <FormInput
          label="Height"
          value={height}
          keyboardType="number-pad"
          maxLength={3}
          placeholder="170"
          hint="Optional, 80–250 cm"
          error={
            heightInvalid
              ? "Height must be a whole number between 80 and 250 cm."
              : null
          }
          onChangeText={updateHeight}
          endAdornment={<ThemedText themeColor="textSecondary">cm</ThemedText>}
        />
        <OptionChips
          label="Activity level"
          options={profileChoices(references, "activity")}
          value={form.activityLevel}
          onChange={single("activityLevel")}
        />
      </>
    ),
    habits: (
      <>
        <OptionChips
          label="Smoking"
          options={profileChoices(references, "habits")}
          value={form.smoking}
          onChange={single("smoking")}
        />
        <OptionChips
          label="Drinking"
          options={profileChoices(references, "habits")}
          value={form.drinking}
          onChange={single("drinking")}
        />
      </>
    ),
    photos: (
      <>
        {form.photoMediaId ? (
          <View
            style={[
              styles.photoCard,
              {
                borderColor: theme.border,
                backgroundColor: theme.backgroundElement,
              },
            ]}
          >
            {photoUri ? (
              <Image
                source={{ uri: photoUri }}
                style={styles.photoPreview}
                contentFit="cover"
                accessibilityLabel="Your profile photo"
              />
            ) : (
              <View
                style={[
                  styles.photoPreview,
                  {
                    backgroundColor: theme.background,
                    alignItems: "center",
                    justifyContent: "center",
                  },
                ]}
              >
                <Ionicons name="image" size={32} color={theme.textSecondary} />
              </View>
            )}
            <View style={styles.photoActions}>
              <PrimaryButton
                label="Replace"
                variant="secondary"
                loading={uploading}
                onPress={() => void pick()}
                style={styles.photoButton}
              />
              <PrimaryButton
                label="Remove"
                variant="ghost"
                disabled={uploading}
                onPress={removePhoto}
                style={styles.photoButton}
              />
            </View>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add photo"
            disabled={uploading}
            onPress={() => void pick()}
            style={[
              styles.photoCard,
              styles.photoAdd,
              {
                borderColor: theme.border,
                backgroundColor: theme.backgroundElement,
              },
            ]}
          >
            <Ionicons
              name={uploading ? "hourglass" : "camera"}
              size={32}
              color={theme.primary}
            />
            <ThemedText style={styles.photoAddLabel}>
              {uploading ? "Uploading…" : "Add photo"}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              JPEG, PNG or WebP
            </ThemedText>
          </Pressable>
        )}
        {form.photoMediaId && photoUri ? (
          <View style={styles.previewRow}>
            <View style={styles.previewItem}>
              <Image
                source={{ uri: photoUri }}
                style={styles.previewThumb}
                contentFit="cover"
                accessibilityLabel="How the photo looks when visible"
              />
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={styles.previewCaption}
              >
                Visible — original
              </ThemedText>
            </View>
            <View style={styles.previewItem}>
              <Image
                source={{ uri: photoUri }}
                style={styles.previewThumb}
                contentFit="cover"
                blurRadius={18}
                accessibilityLabel="How the photo looks when blurred"
              />
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={styles.previewCaption}
              >
                Blurred — protected
              </ThemedText>
            </View>
          </View>
        ) : null}
        <PrivacyNote>
          Upload your original photo once. If you choose Blurred visibility,
          Diasporum automatically creates the blurred version candidates see —
          your original is never shared with other members. Hidden shows no
          photo at all.
        </PrivacyNote>
      </>
    ),
    about: (
      <SharedProfileFields
        state={shared}
        references={references}
        group="about"
      />
    ),
    compatibility: (
      <SharedProfileFields
        state={shared}
        references={references}
        group="compatibility"
      />
    ),
    location: (
      <SharedProfileFields
        state={shared}
        references={references}
        group="location"
      />
    ),
    privacy: (
      <>
        <OptionChips
          label="Who can see your name?"
          options={visibilityOptions}
          value={form.nameVisibility}
          required
          onChange={(value) => set("nameVisibility", value as FieldVisibility)}
        />
        <OptionChips
          label="Who can see your photo?"
          options={visibilityOptions}
          value={form.photoVisibility}
          required
          onChange={(value) => set("photoVisibility", value as FieldVisibility)}
        />
      </>
    ),
    participation: (
      <>
        <PrivacyNote>
          You can pause discovery at any time. Mutual likes open a conversation,
          and reporting and blocking are always available.
        </PrivacyNote>
        <ToggleCard
          icon="compass"
          label="Allow Matchmaking discovery"
          hint="Required for activation. You can pause or delete your profile later."
          value={optIn}
          disabled={optInSaving}
          onChange={onOptInChange}
        />
      </>
    ),
  };

  if (!hydrated) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  const current = STEPS[step];
  const message = error ?? submitError ?? shared.error;
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <WizardHeader
        step={stageAt(step)}
        total={5}
        title={STAGES[stageAt(step)].title}
        icon={STAGES[stageAt(step)].icon}
        subStep={stageAt(step) === 0 ? step : undefined}
        subTotal={stageAt(step) === 0 ? STAGES[0].end + 1 : undefined}
        showBrand={step === 0}
        onBack={() => {
          if (!saving && !submitting && !shared.saving) back();
        }}
      />
      <StepTransition step={step} direction={direction}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <StepQuestion
            icon={current.icon}
            title={current.title}
            description={current.description}
          />
          <View pointerEvents={submitting || saving ? "none" : "auto"}>
            {content[current.key]}
          </View>
          {message ? (
            <ThemedText
              themeColor="error"
              style={styles.error}
              accessibilityRole="alert"
            >
              {message}
            </ThemedText>
          ) : null}
        </ScrollView>
      </StepTransition>
      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        {canSaveDraft && !last ? (
          <PrimaryButton
            label="Save & exit"
            variant="ghost"
            disabled={blocked || !shared.catalog}
            onPress={() => void finish(true)}
          />
        ) : null}
        <PrimaryButton
          label={last ? "Save and set preferences" : "Continue"}
          onPress={next}
          loading={saving || submitting}
          disabled={blocked}
          style={styles.footerContinue}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: {
    padding: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.four,
    flexGrow: 1,
  },
  fieldGroup: { gap: Spacing.two },
  photoCard: {
    alignItems: "center",
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    borderStyle: "dashed",
    padding: Spacing.four,
  },
  photoAdd: { minHeight: 180, justifyContent: "center" },
  photoAddLabel: { fontSize: 16, fontWeight: "700" },
  photoPreview: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: BorderRadius.md,
  },
  photoActions: { flexDirection: "row", gap: Spacing.two },
  photoButton: { flex: 1 },
  previewRow: { flexDirection: "row", gap: Spacing.three },
  previewItem: { flex: 1, alignItems: "center", gap: Spacing.two },
  previewThumb: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
  },
  previewCaption: { textAlign: "center" },
  error: { fontSize: 13 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerContinue: { flex: 1 },
});
