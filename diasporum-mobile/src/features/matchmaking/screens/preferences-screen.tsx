import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import Slider from "@react-native-community/slider";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ErrorState } from "@/shared/components/error-state";
import { PrimaryButton } from "@/shared/components/primary-button";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { useTheme } from "@/hooks/use-theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useSession } from "@/core/session/session-provider";
import { createProfileApi } from "@/features/profile/services/profile-api";
import { Section } from "../components/matchmaking-ui";
import {
  CompletionHero,
  StepQuestion,
  WizardHeader,
} from "../components/wizard-ui";
import { ProfileDetails } from "../components/candidate-profile";
import { profileRequestFrom } from "../components/profile-form";
import { useMatchmakingApi } from "../hooks/use-matchmaking-api";
import {
  isMissingResource,
  matchmakingError,
} from "../services/matchmaking-errors";
import type {
  MatchmakingPreferences,
  MatchmakingPreferencesRequest,
  MatchmakingProfile,
  MatchmakingReferenceData,
  PublicMatchmakingProfile,
} from "../types/matchmaking-types";
import {
  CHILDREN_PREFERENCES,
  WANTS_CHILDREN_PREFERENCES,
} from "../types/matchmaking-options";

type IconName = keyof typeof Ionicons.glyphMap;

const DEFAULTS: MatchmakingPreferencesRequest = {
  minAge: 18,
  maxAge: 110,
  maxDistanceKm: null,
  showVerifiedOnly: false,
  hasChildrenPreference: "ANY",
  wantsChildrenPreference: "ANY",
  genderKeys: [],
  religionIds: [],
  languageIds: [],
};

const MIN_AGE = 18;
const MAX_AGE = 110;
const MAX_DISTANCE_SLIDER = 500;
const ACCENTS = {
  pink: "#FF4FA3",
  blue: "#2F80ED",
  green: "#22C55E",
  violet: "#A020F0",
} as const;
const CHILDREN_ICONS: Record<string, IconName> = {
  ANY: "remove",
  YES: "heart",
  NO: "close-circle",
};

const toRequest = (
  preferences: MatchmakingPreferences,
): MatchmakingPreferencesRequest => ({
  minAge: preferences.minAge,
  maxAge: preferences.maxAge,
  maxDistanceKm: preferences.maxDistanceKm,
  showVerifiedOnly: preferences.showVerifiedOnly,
  hasChildrenPreference: preferences.hasChildrenPreference,
  wantsChildrenPreference: preferences.wantsChildrenPreference,
  genderKeys: preferences.genderKeys,
  religionIds: preferences.religionIds,
  languageIds: preferences.languageIds,
});

/** Floating accent label (icon badge + uppercase text) over a rounded card. */
function PrefSection({
  accent,
  icon,
  title,
  hint,
  card,
  children,
}: {
  accent: string;
  icon: IconName;
  title: string;
  hint?: string;
  /** Card background — supplied by the screen so dark mode stays grouped. */
  card: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionBadge, { backgroundColor: `${accent}18` }]}>
          <Ionicons name={icon} size={14} color={accent} />
        </View>
        <ThemedText style={[styles.sectionLabel, { color: accent }]}>
          {title}
        </ThemedText>
      </View>
      <View
        style={[
          styles.sectionCard,
          { backgroundColor: card, borderColor: theme.border },
        ]}
      >
        {hint ? (
          <ThemedText style={styles.cardHint} themeColor="textSecondary">
            {hint}
          </ThemedText>
        ) : null}
        {children}
      </View>
    </View>
  );
}

function CardDivider() {
  const theme = useTheme();
  return (
    <View
      style={[styles.cardDivider, { backgroundColor: theme.border }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

function SheetToggleRow({
  icon,
  iconBg,
  label,
  desc,
  value,
  onChange,
}: {
  icon: IconName;
  iconBg: string;
  label: string;
  desc?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.toggleRow}>
      <View style={[styles.toggleIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={17} color="#FFFFFF" />
      </View>
      <View style={styles.toggleCopy}>
        <ThemedText style={styles.toggleLabel}>{label}</ThemedText>
        {desc ? (
          <ThemedText style={styles.toggleDesc} themeColor="textSecondary">
            {desc}
          </ThemedText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ false: theme.border, true: theme.primaryLight }}
        thumbColor={value ? theme.primary : theme.textMuted}
      />
    </View>
  );
}

function SheetChip({
  label,
  icon,
  selected,
  accent,
  multi,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  icon?: IconName;
  selected: boolean;
  accent: string;
  /** Multi-select chips report as checkboxes; single-select groups as radio. */
  multi?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const color = selected ? accent : theme.textSecondary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={multi ? "checkbox" : "radio"}
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: selected ? accent : theme.border,
          backgroundColor: selected ? `${accent}18` : "transparent",
        },
        pressed && styles.pressed,
      ]}
    >
      {icon ? <Ionicons name={icon} size={13} color={color} /> : null}
      <ThemedText style={[styles.chipLabel, { color: color }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

export default function PreferencesScreen({
  onboarding = false,
  onBack,
}: {
  onboarding?: boolean;
  onBack?: () => void;
}) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const canvas = scheme === "dark" ? theme.background : theme.backgroundElement;
  const card = scheme === "dark" ? theme.backgroundElement : theme.background;
  const api = useMatchmakingApi();
  const { apiClient } = useSession();
  const profileApi = useMemo(() => createProfileApi(apiClient), [apiClient]);
  const params = useLocalSearchParams<{ activate?: string }>();
  const activating = onboarding || params.activate === "true";
  const [form, setForm] = useState<MatchmakingPreferencesRequest>(DEFAULTS);
  const [profile, setProfile] = useState<MatchmakingProfile | null>(null);
  const [hasDiscoveryLocation, setHasDiscoveryLocation] = useState<
    boolean | null
  >(null);
  const [references, setReferences] = useState<MatchmakingReferenceData | null>(
    null,
  );
  const [preview, setPreview] = useState<PublicMatchmakingProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [activatingProfile, setActivatingProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const distanceEnabled = form.maxDistanceKm !== null;

  const load = useCallback(async () => {
    setError(null);
    try {
      const [profileResult, preferencesResult, referencesResult] =
        await Promise.all([
          api
            .profile()
            .catch((cause) =>
              isMissingResource(cause) ? null : Promise.reject(cause),
            ),
          api
            .preferences()
            .catch((cause) =>
              isMissingResource(cause) ? null : Promise.reject(cause),
            ),
          api.referenceData(),
        ]);
      setProfile(profileResult);
      setForm(
        preferencesResult ? toRequest(preferencesResult) : { ...DEFAULTS },
      );
      setReferences(referencesResult);
      // Approximate-location state is best-effort — never blocks the form.
      profileApi
        .compatibility()
        .then((result) => setHasDiscoveryLocation(result.hasDiscoveryLocation))
        .catch(() => {});
    } catch (cause) {
      setError(matchmakingError(cause, "Could not load preferences."));
    } finally {
      setLoading(false);
    }
  }, [api, profileApi]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const set = <K extends keyof MatchmakingPreferencesRequest>(
    key: K,
    value: MatchmakingPreferencesRequest[K],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const toggleMulti = (
    key: "genderKeys" | "religionIds" | "languageIds",
    id: string,
  ) =>
    set(
      key,
      form[key].includes(id)
        ? form[key].filter((value) => value !== id)
        : [...form[key], id],
    );

  const setDistanceEnabled = (enabled: boolean) =>
    set("maxDistanceKm", enabled ? 50 : null);

  const goBack = () => (onBack ? onBack() : router.back());

  const validate = (request: MatchmakingPreferencesRequest) => {
    const { minAge, maxAge, maxDistanceKm } = request;
    if (
      !Number.isInteger(minAge) ||
      !Number.isInteger(maxAge) ||
      minAge < MIN_AGE ||
      maxAge > MAX_AGE ||
      minAge > maxAge
    ) {
      setError(`Enter an age range between ${MIN_AGE} and ${MAX_AGE}.`);
      return false;
    }
    if (
      maxDistanceKm !== null &&
      (!Number.isInteger(maxDistanceKm) ||
        maxDistanceKm < 1 ||
        maxDistanceKm > 20000)
    ) {
      setError("Enter a distance between 1 and 20,000 km.");
      return false;
    }
    return true;
  };

  const save = async (request?: MatchmakingPreferencesRequest) => {
    const next = request ?? form;
    if (!validate(next)) return;
    setSaving(true);
    setError(null);
    try {
      await api.savePreferences(next);
      if (activating) {
        setPreview(await api.preview());
      } else {
        router.back();
      }
    } catch (cause) {
      setError(matchmakingError(cause, "Could not save preferences."));
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    Alert.alert(
      "Reset preferences?",
      "This restores the default discovery preferences and saves them immediately.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: () => void save({ ...DEFAULTS }),
        },
      ],
    );
  };

  const activate = async () => {
    if (!references) return;
    setActivatingProfile(true);
    setError(null);
    try {
      await api.saveProfile({
        ...profileRequestFrom(profile, references),
        status: "ACTIVE",
      });
      await api.setDiscoveryOptIn(true);
      router.replace("/(app)/matchmaking" as never);
    } catch (cause) {
      setError(matchmakingError(cause, "Could not activate your profile."));
    } finally {
      setActivatingProfile(false);
    }
  };

  const allowLocation = async () => {
    setLocating(true);
    setError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted)
        throw new Error(
          "Location permission was declined. You can use Dating without a distance filter.",
        );
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      await profileApi.saveDiscoveryLocation(
        position.coords.latitude,
        position.coords.longitude,
      );
      setHasDiscoveryLocation(true);
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
      setLocating(false);
    }
  };

  const header = activating ? (
    preview ? null : (
      <WizardHeader
        step={4}
        total={5}
        title="Dating preferences"
        icon="options"
        onBack={goBack}
      />
    )
  ) : (
    <View
      style={[
        styles.header,
        { backgroundColor: card, borderBottomColor: theme.border },
      ]}
    >
      <Pressable
        onPress={goBack}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={({ pressed }) => [
          styles.headerBack,
          { backgroundColor: canvas },
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="arrow-back" size={19} color={theme.primary} />
      </Pressable>
      <ThemedText style={styles.headerTitle} numberOfLines={1}>
        Preferences
      </ThemedText>
      <Pressable
        onPress={() => void save()}
        disabled={saving || loading}
        accessibilityRole="button"
        accessibilityLabel="Save"
        style={({ pressed }) => [
          styles.savePill,
          { backgroundColor: theme.primary },
          pressed && styles.pressed,
        ]}
      >
        {saving ? (
          <ActivityIndicator size="small" color={theme.background} />
        ) : (
          <ThemedText
            style={[styles.savePillLabel, { color: theme.background }]}
          >
            Save
          </ThemedText>
        )}
      </Pressable>
    </View>
  );

  const formContent = references ? (
    <>
      <PrefSection
        accent={theme.primary}
        icon="male-female-outline"
        title="Show me"
        hint="Choose who appears in discovery. Select none to include all genders."
        card={card}
      >
        <View style={styles.chipRow}>
          {references.genders.map((option) => (
            <SheetChip
              key={option.id}
              multi
              accent={theme.primary}
              label={option.label}
              selected={form.genderKeys.includes(option.id)}
              onPress={() => toggleMulti("genderKeys", option.id)}
              accessibilityLabel={`Genders: ${option.label}`}
            />
          ))}
        </View>
      </PrefSection>

      <PrefSection
        accent={theme.primary}
        icon="calendar-outline"
        title="Age range"
        hint="Drag either handle — the two bounds can never cross."
        card={card}
      >
        <View style={styles.ageReadout}>
          <View style={styles.ageValue}>
            <ThemedText style={[styles.ageNumber, { color: theme.primary }]}>
              {form.minAge}
            </ThemedText>
            <ThemedText style={styles.ageUnit} themeColor="textSecondary">
              Min
            </ThemedText>
          </View>
          <View
            style={[styles.ageDivider, { backgroundColor: theme.border }]}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <View style={styles.ageValue}>
            <ThemedText style={[styles.ageNumber, { color: theme.primary }]}>
              {form.maxAge}
            </ThemedText>
            <ThemedText style={styles.ageUnit} themeColor="textSecondary">
              Max
            </ThemedText>
          </View>
        </View>
        <View style={styles.sliderColumns}>
          <View style={styles.sliderColumn}>
            <ThemedText
              style={styles.sliderCaption}
              themeColor="textSecondary"
            >
              Minimum age
            </ThemedText>
            <Slider
              style={styles.slider}
              value={Math.min(form.minAge, Math.max(MIN_AGE, form.maxAge - 1))}
              minimumValue={MIN_AGE}
              maximumValue={Math.max(MIN_AGE, form.maxAge - 1)}
              step={1}
              onValueChange={(value) => set("minAge", value)}
              minimumTrackTintColor={theme.primary}
              maximumTrackTintColor={theme.border}
              thumbTintColor={theme.primary}
              accessibilityLabel="Minimum age"
            />
          </View>
          <View style={styles.sliderColumn}>
            <ThemedText
              style={styles.sliderCaption}
              themeColor="textSecondary"
            >
              Maximum age
            </ThemedText>
            <Slider
              style={styles.slider}
              value={Math.max(form.maxAge, Math.min(MAX_AGE, form.minAge + 1))}
              minimumValue={Math.min(MAX_AGE, form.minAge + 1)}
              maximumValue={MAX_AGE}
              step={1}
              onValueChange={(value) => set("maxAge", value)}
              minimumTrackTintColor={theme.primary}
              maximumTrackTintColor={theme.border}
              thumbTintColor={theme.primary}
              accessibilityLabel="Maximum age"
            />
          </View>
        </View>
      </PrefSection>

      <PrefSection
        accent={ACCENTS.pink}
        icon="navigate-outline"
        title="Location & distance"
        hint="Distance matching uses a rounded city-level position — never your live GPS location."
        card={card}
      >
        <SheetToggleRow
          icon="navigate"
          iconBg={ACCENTS.pink}
          label="Limit maximum distance"
          desc="Turn off to include compatible adults at any distance."
          value={distanceEnabled}
          onChange={setDistanceEnabled}
        />
        {distanceEnabled ? (
          <>
            <CardDivider />
            <View
              style={[
                styles.distanceBadge,
                { backgroundColor: `${ACCENTS.pink}14` },
              ]}
            >
              <Ionicons name="navigate" size={18} color={ACCENTS.pink} />
              <ThemedText
                style={[styles.distanceValue, { color: ACCENTS.pink }]}
              >
                {form.maxDistanceKm} km
              </ThemedText>
              <ThemedText
                style={styles.distanceHint}
                themeColor="textSecondary"
              >
                radius from you
              </ThemedText>
            </View>
            <Slider
              style={styles.slider}
              value={Math.min(
                form.maxDistanceKm ?? 50,
                MAX_DISTANCE_SLIDER,
              )}
              minimumValue={1}
              maximumValue={MAX_DISTANCE_SLIDER}
              step={5}
              onValueChange={(value) => set("maxDistanceKm", value)}
              minimumTrackTintColor={ACCENTS.pink}
              maximumTrackTintColor={theme.border}
              thumbTintColor={ACCENTS.pink}
              accessibilityLabel="Maximum distance"
            />
            <View style={styles.sliderEnds}>
              <ThemedText style={styles.sliderEnd} themeColor="textSecondary">
                1 km
              </ThemedText>
              <ThemedText style={styles.sliderEnd} themeColor="textSecondary">
                500 km
              </ThemedText>
            </View>
            <CardDivider />
            <Pressable
              onPress={() => void allowLocation()}
              disabled={locating}
              accessibilityRole="button"
              accessibilityLabel={
                hasDiscoveryLocation === true
                  ? "Update approximate location"
                  : "Allow approximate location"
              }
              style={({ pressed }) => [styles.locationRow, pressed && styles.pressed]}
            >
              <View
                style={[
                  styles.toggleIcon,
                  {
                    backgroundColor:
                      hasDiscoveryLocation === true
                        ? theme.success
                        : theme.warning,
                  },
                ]}
              >
                <Ionicons
                  name={
                    hasDiscoveryLocation === true
                      ? "location-sharp"
                      : "location-outline"
                  }
                  size={17}
                  color="#FFFFFF"
                />
              </View>
              <View style={styles.toggleCopy}>
                <ThemedText style={styles.toggleLabel}>
                  {hasDiscoveryLocation === true
                    ? "Approximate location saved"
                    : "Approximate location"}
                </ThemedText>
                <ThemedText
                  style={styles.toggleDesc}
                  themeColor="textSecondary"
                >
                  Required for distance matching
                </ThemedText>
              </View>
              {locating ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <ThemedText
                  style={[styles.locationAction, { color: theme.primary }]}
                >
                  {hasDiscoveryLocation === true ? "Update" : "Allow"}
                </ThemedText>
              )}
            </Pressable>
          </>
        ) : null}
      </PrefSection>

      <PrefSection
        accent={ACCENTS.blue}
        icon="shield-checkmark-outline"
        title="Quality filters"
        card={card}
      >
        <SheetToggleRow
          icon="shield-checkmark"
          iconBg={ACCENTS.blue}
          label="Show verified profiles only"
          desc="Limit discovery to members verified by our team."
          value={form.showVerifiedOnly}
          onChange={(value) => set("showVerifiedOnly", value)}
        />
      </PrefSection>

      <PrefSection
        accent={ACCENTS.green}
        icon="people-outline"
        title="Family & children"
        card={card}
      >
        <ThemedText style={styles.subLabel} themeColor="textSecondary">
          Already has children
        </ThemedText>
        <View style={styles.chipRow}>
          {CHILDREN_PREFERENCES.map((option) => (
            <SheetChip
              key={option.value}
              accent={ACCENTS.green}
              icon={CHILDREN_ICONS[option.value]}
              label={option.label}
              selected={form.hasChildrenPreference === option.value}
              onPress={() =>
                set(
                  "hasChildrenPreference",
                  option.value as "ANY" | "YES" | "NO",
                )
              }
              accessibilityLabel={`Already has children: ${option.label}`}
            />
          ))}
        </View>
        <CardDivider />
        <ThemedText style={styles.subLabel} themeColor="textSecondary">
          Wants children
        </ThemedText>
        <View style={styles.chipRow}>
          {WANTS_CHILDREN_PREFERENCES.map((option) => (
            <SheetChip
              key={option.value}
              accent={ACCENTS.green}
              label={option.label}
              selected={form.wantsChildrenPreference === option.value}
              onPress={() =>
                set(
                  "wantsChildrenPreference",
                  option.value as "ANY" | "YES" | "NO" | "UNSURE",
                )
              }
              accessibilityLabel={`Wants children: ${option.label}`}
            />
          ))}
        </View>
      </PrefSection>

      <PrefSection
        accent={ACCENTS.violet}
        icon="book-outline"
        title="Religion"
        hint="Select none to include all religions."
        card={card}
      >
        <View style={styles.chipRow}>
          {references.religions.map((option) => (
            <SheetChip
              key={option.id}
              multi
              accent={ACCENTS.violet}
              label={option.label}
              selected={form.religionIds.includes(option.id)}
              onPress={() => toggleMulti("religionIds", option.id)}
              accessibilityLabel={`Religions: ${option.label}`}
            />
          ))}
        </View>
      </PrefSection>

      <PrefSection
        accent={ACCENTS.pink}
        icon="language-outline"
        title="Languages"
        hint="Select none to include all languages."
        card={card}
      >
        <View style={styles.chipRow}>
          {references.languages.map((option) => (
            <SheetChip
              key={option.id}
              multi
              accent={ACCENTS.pink}
              label={option.label}
              selected={form.languageIds.includes(option.id)}
              onPress={() => toggleMulti("languageIds", option.id)}
              accessibilityLabel={`Languages: ${option.label}`}
            />
          ))}
        </View>
      </PrefSection>
    </>
  ) : null;

  return (
    <ThemedView style={[styles.root, { backgroundColor: canvas }]}>
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        {header}
        <KeyboardAvoidingView
          style={styles.root}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={
              activating ? styles.activatingContent : styles.content
            }
            keyboardShouldPersistTaps="handled"
          >
            {activating && !preview ? (
              <StepQuestion
                icon="options"
                title="Who would you like to meet?"
                description="Tune the defaults used to assemble your discovery feed. You can revisit them at any time."
              />
            ) : null}
            {loading ? (
              <ActivityIndicator style={styles.loader} color={theme.primary} />
            ) : error && !references ? (
              <ErrorState message={error} onRetry={() => void load()} />
            ) : preview ? (
              <>
                <CompletionHero />
                <View style={styles.previewHeading}>
                  <ThemedText style={styles.previewTitle}>
                    This is how you will appear
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Other members will see your profile like this while they
                    browse. Activate when you are happy — you can refine or
                    pause discovery at any time.
                  </ThemedText>
                </View>
                <ThemedView style={styles.card} type="backgroundElement">
                  <ProfileDetails profile={preview} references={references} />
                </ThemedView>
                <Section title="You're in control">
                  <ThemedText type="small" themeColor="textSecondary">
                    Discovery can be paused at any time from your dating status.
                    Visibility and privacy settings live on your profile.
                  </ThemedText>
                </Section>
              </>
            ) : (
              formContent
            )}
            {!loading && error ? (
              <ThemedText type="small" style={styles.error}>
                {error}
              </ThemedText>
            ) : null}
            {activating && !preview ? (
              <ThemedText type="small" themeColor="textSecondary">
                Your profile is private by default and only becomes discoverable
                when you activate it.
              </ThemedText>
            ) : null}
            {preview ? (
              <View style={styles.footer}>
                <PrimaryButton
                  label="Activate my profile"
                  onPress={() => void activate()}
                  loading={activatingProfile}
                  disabled={activatingProfile}
                />
                <PrimaryButton
                  label="Keep editing"
                  variant="ghost"
                  onPress={() => setPreview(null)}
                  disabled={activatingProfile}
                />
              </View>
            ) : !loading && references ? (
              <View style={styles.footer}>
                <Pressable
                  onPress={() => void save()}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel={
                    activating ? "Save and preview profile" : "Save preferences"
                  }
                  style={({ pressed }) => [
                    styles.footerSave,
                    { backgroundColor: theme.primary, shadowColor: theme.primary },
                    pressed && styles.pressed,
                  ]}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color={theme.background} />
                  ) : (
                    <>
                      <Ionicons
                        name="checkmark"
                        size={18}
                        color={theme.background}
                      />
                      <ThemedText
                        style={[
                          styles.footerSaveLabel,
                          { color: theme.background },
                        ]}
                      >
                        {activating
                          ? "Save and preview profile"
                          : "Save preferences"}
                      </ThemedText>
                    </>
                  )}
                </Pressable>
                {!activating ? (
                  <Pressable
                    onPress={reset}
                    disabled={saving}
                    accessibilityRole="button"
                    accessibilityLabel="Reset to defaults"
                    style={({ pressed }) => [
                      styles.footerReset,
                      {
                        borderColor: theme.error,
                        backgroundColor: `${theme.error}12`,
                      },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons name="refresh" size={16} color={theme.error} />
                    <ThemedText
                      style={[styles.footerResetLabel, { color: theme.error }]}
                    >
                      Reset to defaults
                    </ThemedText>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBack: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    position: "absolute",
    left: 56,
    right: 56,
    textAlign: "center",
    fontSize: 22,
    fontWeight: "800",
  },
  savePill: {
    minWidth: 56,
    height: 34,
    marginLeft: "auto",
    paddingHorizontal: Spacing.three - 2,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  savePillLabel: { fontSize: 14, fontWeight: "800" },
  scroll: { flex: 1 },
  content: {
    padding: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
  },
  activatingContent: {
    padding: Spacing.four,
    paddingBottom: Spacing.seven,
    gap: Spacing.four,
    flexGrow: 1,
  },
  loader: { marginTop: Spacing.six },
  section: { gap: Spacing.two },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.half,
  },
  sectionBadge: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  sectionCard: {
    borderWidth: 1,
    borderRadius: BorderRadius.xl,
    padding: Spacing.three,
    gap: Spacing.three - 2,
    shadowColor: "#7C3AED",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  cardHint: { fontSize: 13, lineHeight: 18 },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.half,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two + 2,
  },
  toggleIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleCopy: { flex: 1, gap: 2 },
  toggleLabel: { fontSize: 15, fontWeight: "600" },
  toggleDesc: { fontSize: 13, lineHeight: 17 },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one + 2,
    paddingVertical: Spacing.two,
    paddingHorizontal: 14,
    borderRadius: BorderRadius.full,
    borderWidth: 1.5,
  },
  chipLabel: { fontSize: 13, fontWeight: "600" },
  subLabel: { fontSize: 13, fontWeight: "600" },
  ageReadout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.four,
  },
  ageValue: { alignItems: "center", minWidth: 64 },
  ageNumber: { fontSize: 34, fontWeight: "800", lineHeight: 38 },
  ageUnit: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  ageDivider: { width: 1, height: 40 },
  sliderColumns: {
    flexDirection: "row",
    gap: Spacing.three,
  },
  sliderColumn: { flex: 1, gap: Spacing.half },
  sliderCaption: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  slider: { height: 36 },
  sliderEnds: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -Spacing.two,
  },
  sliderEnd: { fontSize: 11, fontWeight: "600" },
  distanceBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.three - 2,
  },
  distanceValue: { fontSize: 22, fontWeight: "800" },
  distanceHint: { fontSize: 12 },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two + 2,
  },
  locationAction: { fontSize: 14, fontWeight: "700" },
  previewHeading: { gap: Spacing.two, alignItems: "center" },
  previewTitle: { fontSize: 22, fontWeight: "800", textAlign: "center" },
  card: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.four,
    gap: Spacing.four,
  },
  error: { textAlign: "center" },
  footer: { gap: Spacing.three - 2, paddingTop: Spacing.two },
  footerSave: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    borderRadius: BorderRadius.full,
    paddingVertical: Spacing.three,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  footerSaveLabel: { fontSize: 17, fontWeight: "800" },
  footerReset: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    borderRadius: BorderRadius.full,
    paddingVertical: Spacing.three - 1,
    borderWidth: 1.5,
  },
  footerResetLabel: { fontSize: 15, fontWeight: "700" },
  pressed: { opacity: 0.75 },
});
