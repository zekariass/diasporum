/**
 * CreateEventScreen — multi-step event creation wizard.
 * Route: /(app)/events/create
 * Steps: Audience (community/organizer/topic) → Details (form) → Review.
 * Publishes directly, or saves as a draft for later publishing.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { safeBack } from "@/core/navigation/safe-back";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useSession } from "@/core/session/session-provider";
import { createEventApi } from "../services/event-api";
import { createCommunityApi } from "@/features/communities/services/community-api";
import { createBusinessApi } from "@/features/business/services/business-api";
import type { CommunityView } from "@/features/communities/types/community-types";
import type { BusinessAccount } from "@/features/business/types/business-types";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import {
  EventForm,
  initialFormState,
  uploadCover,
  validateEventForm,
} from "../components/event-form";
import type { EventFormState } from "../components/event-form";
import type { EventCategory } from "../types/event-types";
import { formatEventDate, zonedToUtc } from "../utils/event-time";

type Step = 0 | 1 | 2;
const STEP_TITLES = ["Audience", "Details", "Review"] as const;
const STEP_CONTENT = [
  {
    eyebrow: "SET THE SCENE",
    title: "Who is this event for?",
    description: "Choose a community and how you want to host.",
    icon: "people-outline",
  },
  {
    eyebrow: "MAKE IT YOURS",
    title: "Bring your event to life",
    description: "Share the details people need to join with confidence.",
    icon: "create-outline",
  },
  {
    eyebrow: "FINAL CHECK",
    title: "Looking good!",
    description: "Review everything, then publish or save it for later.",
    icon: "checkmark-done-outline",
  },
] as const satisfies readonly {
  eyebrow: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
}[];

export default function CreateEventScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient, session } = useSession();
  const eventApi = React.useMemo(() => createEventApi(apiClient), [apiClient]);
  const communityApi = React.useMemo(
    () => createCommunityApi(apiClient),
    [apiClient],
  );
  const businessApi = React.useMemo(
    () => createBusinessApi(apiClient),
    [apiClient],
  );

  const [step, setStep] = useState<Step>(0);
  const [form, setForm] = useState<EventFormState>(initialFormState);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- audience step state ----
  const [communities, setCommunities] = useState<CommunityView[]>([]);
  const [communityId, setCommunityId] = useState<string | null>(
    session?.activeCommunityId ?? null,
  );
  const [accounts, setAccounts] = useState<BusinessAccount[]>([]);
  const [businessAccountId, setBusinessAccountId] = useState<string | null>(
    null,
  );
  const [topics, setTopics] = useState<{ id: string; name: string }[]>([]);
  const [topicCategoryId, setTopicCategoryId] = useState<string | null>(null);
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [audienceLoading, setAudienceLoading] = useState(true);

  // Resolve membership community names + business accounts + event categories.
  useEffect(() => {
    let cancelled = false;
    const membershipIds = (session?.memberships ?? [])
      .filter((m) => m.status === "ACTIVE")
      .map((m) => m.communityId);
    Promise.all([
      Promise.all(
        membershipIds.map((id) => communityApi.community(id).catch(() => null)),
      ),
      businessApi.accounts().catch(() => ({ items: [] })),
      eventApi.categories().catch(() => ({ items: [] })),
    ])
      .then(([communityRows, accountsRes, categoriesRes]) => {
        if (cancelled) return;
        setCommunities(
          communityRows.filter(
            (c): c is CommunityView => c !== null && c.active,
          ),
        );
        setAccounts(accountsRes.items.filter((a) => a.status === "ACTIVE"));
        setCategories(categoriesRes.items);
        setAudienceLoading(false);
      })
      .catch(() => {
        if (!cancelled) setAudienceLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- memberships/actors load once per mount
  }, []);

  // Topic categories depend on the chosen community's destination country.
  const selectedCommunity = communities.find((c) => c.id === communityId);
  useEffect(() => {
    const countryId = selectedCommunity?.destinationCountryId;
    let cancelled = false;
    // State updates stay in promise continuations (set-state-in-effect).
    Promise.resolve()
      .then(() =>
        countryId
          ? eventApi.topicCategories(countryId)
          : { items: [] as { id: string; name: string }[] },
      )
      .then((r) => {
        if (!cancelled) setTopics(r.items);
      })
      .catch(() => {
        if (!cancelled) setTopics([]);
      });
    return () => {
      cancelled = true;
    };
  }, [eventApi, selectedCommunity?.destinationCountryId]);

  // Changing the community also resets the optional topic selection —
  // done in the event handler, not an effect (set-state-in-effect).
  const selectCommunity = useCallback((id: string) => {
    setCommunityId(id);
    setTopicCategoryId(null);
  }, []);

  const onChange = useCallback((patch: Partial<EventFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const next = useCallback(() => {
    if (step === 0) {
      if (!communityId) {
        setError("Choose the community this event belongs to.");
        return;
      }
    }
    if (step === 1) {
      const validation = validateEventForm(form);
      if (validation) {
        setError(validation);
        return;
      }
      const startsAt = zonedToUtc(
        form.startDate,
        form.startTime,
        form.timezone,
      );
      if (!startsAt) {
        setError("Invalid date or time.");
        return;
      }
    }
    setError(null);
    setStep((s) => (s < 2 ? ((s + 1) as Step) : s));
  }, [step, communityId, form]);

  const submit = useCallback(
    async (draft: boolean) => {
      if (submitting || !communityId) return;
      const validation = validateEventForm(form);
      if (validation) {
        setError(validation);
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        const startsAt = zonedToUtc(
          form.startDate,
          form.startTime,
          form.timezone,
        );
        let endsAt: Date | null = null;
        if (form.hasEnd) {
          endsAt = zonedToUtc(form.endDate, form.endTime, form.timezone);
        }
        if (!startsAt || (form.hasEnd && !endsAt)) {
          setError("Invalid date or time.");
          return;
        }
        if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
          setError("The end must be after the start.");
          return;
        }
        if (startsAt.getTime() <= Date.now() && !draft) {
          setError("The start must be in the future.");
          return;
        }
        const coverMediaId = form.cover
          ? await uploadCover(apiClient, form.cover)
          : undefined;
        const created = await eventApi.createEvent({
          communityId,
          visibilityScope: form.visibilityScope,
          categoryId: form.categoryId as string,
          countryTopicCategoryId: topicCategoryId ?? undefined,
          title: form.title.trim(),
          description: form.description.trim(),
          eventMode: form.eventMode,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt ? endsAt.toISOString() : undefined,
          timezone: form.timezone.trim(),
          locationName:
            form.eventMode === "IN_PERSON"
              ? form.locationName.trim()
              : undefined,
          externalUrl:
            form.eventMode === "ONLINE_EXTERNAL"
              ? form.externalUrl.trim()
              : undefined,
          capacity: form.capacity.trim() ? Number(form.capacity) : undefined,
          coverMediaId,
          businessAccountId: businessAccountId ?? undefined,
          draft,
        });
        if (draft) {
          Alert.alert(
            "Draft saved",
            "You can publish it later from My events.",
          );
          safeBack();
        } else {
          router.replace(`/(app)/events/${created.event.id}` as never);
        }
      } catch (e) {
        setError(
          ApiError.isApiError(e)
            ? e.userMessage
            : "Could not create the event.",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [
      submitting,
      communityId,
      form,
      topicCategoryId,
      businessAccountId,
      eventApi,
      apiClient,
      router,
    ],
  );

  const publishLabel = submitting ? "Creating…" : "Create event";

  const reviewRows = useMemo(() => {
    const startsAt = zonedToUtc(form.startDate, form.startTime, form.timezone);
    const endsAt = form.hasEnd
      ? zonedToUtc(form.endDate, form.endTime, form.timezone)
      : null;
    const categoryName =
      categories.find((c) => c.id === form.categoryId)?.displayName ?? "—";
    const organizerName = businessAccountId
      ? (accounts.find((a) => a.id === businessAccountId)?.accountName ??
        "Business account")
      : "You (personal)";
    return [
      ["Community", selectedCommunity?.name ?? "—"],
      ["Organizer", organizerName],
      [
        "Visibility",
        form.visibilityScope === "COUNTRY" ? "Country" : "Community",
      ],
      ["Topic", topics.find((t) => t.id === topicCategoryId)?.name ?? "None"],
      ["Category", categoryName],
      ["Title", form.title.trim() || "—"],
      [
        "When",
        startsAt ? formatEventDate(startsAt.toISOString(), form.timezone) : "—",
      ],
      [
        "Ends",
        endsAt ? formatEventDate(endsAt.toISOString(), form.timezone) : "—",
      ],
      ["Timezone", form.timezone],
      [
        form.eventMode === "IN_PERSON" ? "Location" : "Link",
        form.eventMode === "IN_PERSON"
          ? form.locationName.trim() || "—"
          : form.externalUrl.trim() || "—",
      ],
      ["Capacity", form.capacity.trim() || "Unlimited"],
    ] as [string, string][];
  }, [
    form,
    categories,
    accounts,
    businessAccountId,
    selectedCommunity,
    topics,
    topicCategoryId,
  ]);

  const stepContent = STEP_CONTENT[step];
  const visibleReviewRows = reviewRows.filter(([label]) => label !== "Title");
  const categoryName =
    categories.find((category) => category.id === form.categoryId)
      ?.displayName ?? "Event";

  return (
    <ThemedView style={s.root}>
      <StatusBar style="auto" />
      <SafeAreaView
        style={s.safeArea}
        edges={["top", "bottom", "left", "right"]}
      >
        <View style={s.header}>
          <Pressable
            onPress={() =>
              step === 0 ? safeBack() : setStep((step - 1) as Step)
            }
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={step === 0 ? "Go back" : "Previous step"}
            style={({ pressed }) => [
              s.headerButton,
              { backgroundColor: theme.backgroundElement },
              pressed && s.pressed,
            ]}
          >
            <Ionicons name="chevron-back" size={22} color={theme.text} />
          </Pressable>
          <View style={s.headerCopy}>
            <ThemedText style={s.headerTitle}>Create event</ThemedText>
            <ThemedText style={s.headerSubtitle} themeColor="textSecondary">
              Step {step + 1} of 3
            </ThemedText>
          </View>
          <View
            style={[s.stepCount, { backgroundColor: theme.primarySurface }]}
          >
            <ThemedText style={[s.stepCountText, { color: theme.primary }]}>
              {step + 1}/3
            </ThemedText>
          </View>
        </View>

        <StepProgress current={step} />

        <View style={[s.intro, { backgroundColor: theme.primarySurface }]}>
          <View style={[s.introIcon, { backgroundColor: theme.background }]}>
            <Ionicons name={stepContent.icon} size={24} color={theme.primary} />
          </View>
          <View style={s.introCopy}>
            <ThemedText style={[s.introEyebrow, { color: theme.primary }]}>
              {stepContent.eyebrow}
            </ThemedText>
            <ThemedText style={s.introTitle}>{stepContent.title}</ThemedText>
            <ThemedText style={s.introDescription} themeColor="textSecondary">
              {stepContent.description}
            </ThemedText>
          </View>
        </View>

        <KeyboardAvoidingView
          style={s.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
        {step === 0 && (
          <ScrollView
            contentContainerStyle={s.stepContent}
            showsVerticalScrollIndicator={false}
          >
            <PickerSection
              icon="people-outline"
              title="Community"
              subtitle="Choose where your event will live."
            >
              {audienceLoading ? (
                <View style={s.loadingRow}>
                  <ActivityIndicator size="small" color={theme.primary} />
                  <ThemedText themeColor="textSecondary" style={s.loadingText}>
                    Loading your communities…
                  </ThemedText>
                </View>
              ) : communities.length === 0 ? (
                <ThemedText themeColor="textSecondary" style={s.emptyText}>
                  You are not a member of any community.
                </ThemedText>
              ) : (
                communities.map((community) => (
                  <OptionRow
                    key={community.id}
                    icon="people-outline"
                    label={community.name}
                    selected={communityId === community.id}
                    onPress={() => selectCommunity(community.id)}
                  />
                ))
              )}
            </PickerSection>

            <PickerSection
              icon="sparkles-outline"
              title="Host as"
              subtitle="Publish personally or for a business you manage."
            >
              <OptionRow
                icon="person-outline"
                label="You (personal)"
                sublabel="Your personal profile"
                selected={businessAccountId === null}
                onPress={() => setBusinessAccountId(null)}
              />
              {accounts.map((account) => (
                <OptionRow
                  key={account.id}
                  icon="briefcase-outline"
                  label={account.accountName}
                  sublabel={account.role}
                  selected={businessAccountId === account.id}
                  onPress={() => setBusinessAccountId(account.id)}
                />
              ))}
            </PickerSection>

            {topics.length > 0 && (
              <PickerSection
                icon="pricetag-outline"
                title="Topic (optional)"
                subtitle="Help the right people discover your event."
              >
                <OptionRow
                  icon="remove-circle-outline"
                  label="None"
                  selected={topicCategoryId === null}
                  onPress={() => setTopicCategoryId(null)}
                />
                {topics.map((topic) => (
                  <OptionRow
                    key={topic.id}
                    icon="pricetag-outline"
                    label={topic.name}
                    selected={topicCategoryId === topic.id}
                    onPress={() => setTopicCategoryId(topic.id)}
                  />
                ))}
              </PickerSection>
            )}
          </ScrollView>
        )}

        {step === 1 && (
          <View style={s.formWrap}>
            <EventForm state={form} onChange={onChange} />
          </View>
        )}

        {step === 2 && (
          <ScrollView
            contentContainerStyle={s.stepContent}
            showsVerticalScrollIndicator={false}
          >
            <View
              style={[
                s.reviewHero,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.background,
                },
              ]}
            >
              {form.cover ? (
                <Image
                  source={{ uri: form.cover.uri }}
                  style={s.reviewCover}
                  accessibilityLabel="Selected cover image"
                />
              ) : (
                <View
                  style={[
                    s.reviewCover,
                    s.reviewCoverEmpty,
                    { backgroundColor: theme.primarySurface },
                  ]}
                >
                  <Ionicons
                    name="calendar-outline"
                    size={40}
                    color={theme.primary}
                  />
                </View>
              )}
              <View style={s.reviewHeroBody}>
                <View
                  style={[
                    s.categoryBadge,
                    { backgroundColor: theme.primarySurface },
                  ]}
                >
                  <ThemedText
                    style={[s.categoryBadgeText, { color: theme.primary }]}
                  >
                    {categoryName}
                  </ThemedText>
                </View>
                <ThemedText style={s.reviewTitle}>
                  {form.title.trim() || "Untitled event"}
                </ThemedText>
                <View style={s.reviewDateRow}>
                  <Ionicons
                    name="time-outline"
                    size={17}
                    color={theme.primary}
                  />
                  <ThemedText style={s.reviewDate} themeColor="textSecondary">
                    {reviewRows.find(([label]) => label === "When")?.[1] ?? "—"}
                  </ThemedText>
                </View>
              </View>
            </View>

            <View
              style={[
                s.reviewCard,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.background,
                },
              ]}
            >
              <View style={s.reviewCardHeader}>
                <ThemedText style={s.reviewCardTitle}>Event summary</ThemedText>
                <Pressable
                  onPress={() => setStep(1)}
                  accessibilityRole="button"
                  accessibilityLabel="Edit event details"
                  hitSlop={8}
                  style={({ pressed }) => pressed && s.pressed}
                >
                  <ThemedText style={[s.editLink, { color: theme.primary }]}>
                    Edit details
                  </ThemedText>
                </Pressable>
              </View>
              {visibleReviewRows.map(([label, value], index) => (
                <View
                  key={label}
                  style={[
                    s.reviewRow,
                    { borderBottomColor: theme.border },
                    index === visibleReviewRows.length - 1 && s.reviewRowLast,
                  ]}
                >
                  <ThemedText style={s.reviewLabel} themeColor="textSecondary">
                    {label}
                  </ThemedText>
                  <ThemedText style={s.reviewValue} numberOfLines={3}>
                    {value}
                  </ThemedText>
                </View>
              ))}
            </View>

            {form.description.trim().length > 0 && (
              <View
                style={[
                  s.reviewCard,
                  {
                    borderColor: theme.border,
                    backgroundColor: theme.background,
                  },
                ]}
              >
                <ThemedText style={s.reviewCardTitle}>
                  About this event
                </ThemedText>
                <ThemedText
                  style={s.reviewDescription}
                  themeColor="textSecondary"
                >
                  {form.description.trim()}
                </ThemedText>
              </View>
            )}

            <View
              style={[
                s.reviewNote,
                { backgroundColor: theme.backgroundElement },
              ]}
            >
              <Ionicons
                name="shield-checkmark-outline"
                size={20}
                color={theme.primary}
              />
              <ThemedText style={s.reviewNoteText} themeColor="textSecondary">
                Not ready yet? Save a draft and finish it later from My events.
              </ThemedText>
            </View>
          </ScrollView>
        )}

        {error && (
          <View style={[s.errorRow, { backgroundColor: theme.errorSurface }]}>
            <Ionicons name="alert-circle" size={19} color={theme.error} />
            <ThemedText style={[s.errorText, { color: theme.error }]}>
              {error}
            </ThemedText>
          </View>
        )}

        <View
          style={[
            s.actions,
            { borderTopColor: theme.border, backgroundColor: theme.background },
          ]}
        >
          {step < 2 ? (
            <Pressable
              onPress={next}
              accessibilityRole="button"
              accessibilityLabel="Continue"
              style={({ pressed }) => [s.primaryBtn, pressed && s.pressed]}
            >
              <ThemedText style={s.primaryText}>Continue</ThemedText>
              <Ionicons
                name="arrow-forward"
                size={19}
                color={BrandColors.white}
              />
            </Pressable>
          ) : (
            <>
              <Pressable
                onPress={() => void submit(true)}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel="Save as draft"
                style={({ pressed }) => [
                  s.secondaryBtn,
                  { borderColor: theme.border },
                  pressed && s.pressed,
                  submitting && s.disabled,
                ]}
              >
                <Ionicons
                  name="document-text-outline"
                  size={18}
                  color={theme.text}
                />
                <ThemedText style={s.secondaryText}>Save draft</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => void submit(false)}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel={publishLabel}
                style={({ pressed }) => [
                  s.primaryBtn,
                  pressed && s.pressed,
                  submitting && s.disabled,
                ]}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={BrandColors.white} />
                ) : (
                  <Ionicons
                    name="calendar"
                    size={18}
                    color={BrandColors.white}
                  />
                )}
                <ThemedText style={s.primaryText}>{publishLabel}</ThemedText>
              </Pressable>
            </>
          )}
        </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

function StepProgress({ current }: { current: Step }) {
  const theme = useTheme();
  return (
    <View style={s.stepRow} accessibilityLabel={`Step ${current + 1} of 3`}>
      {STEP_TITLES.map((title, index) => (
        <React.Fragment key={title}>
          <View style={s.stepItem}>
            <View
              style={[
                s.stepDot,
                {
                  backgroundColor:
                    index <= current
                      ? BrandColors.primary
                      : theme.backgroundElement,
                  borderColor:
                    index <= current ? BrandColors.primary : theme.border,
                },
              ]}
            >
              {index < current ? (
                <Ionicons
                  name="checkmark"
                  size={14}
                  color={BrandColors.white}
                />
              ) : (
                <ThemedText
                  style={[
                    s.stepDotText,
                    {
                      color:
                        index === current
                          ? BrandColors.white
                          : theme.textSecondary,
                    },
                  ]}
                >
                  {index + 1}
                </ThemedText>
              )}
            </View>
            <ThemedText
              style={[
                s.stepLabel,
                index === current && { color: theme.primary },
              ]}
              themeColor="textSecondary"
            >
              {title}
            </ThemedText>
          </View>
          {index < STEP_TITLES.length - 1 && (
            <View
              style={[
                s.stepConnector,
                {
                  backgroundColor:
                    index < current ? theme.primary : theme.border,
                },
              ]}
            />
          )}
        </React.Fragment>
      ))}
    </View>
  );
}

function PickerSection({
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
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}
    >
      <View style={s.sectionHeader}>
        <View
          style={[s.sectionIcon, { backgroundColor: theme.primarySurface }]}
        >
          <Ionicons name={icon} size={19} color={theme.primary} />
        </View>
        <View style={s.sectionHeaderCopy}>
          <ThemedText style={s.sectionTitle}>{title}</ThemedText>
          <ThemedText style={s.sectionSub} themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        </View>
      </View>
      <View style={s.optionBox}>{children}</View>
    </View>
  );
}

function OptionRow({
  icon,
  label,
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
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        s.optionRow,
        {
          backgroundColor: selected ? theme.primarySurface : theme.background,
          borderColor: selected ? theme.primary : theme.border,
        },
        pressed && s.pressed,
      ]}
    >
      <View
        style={[
          s.optionIcon,
          {
            backgroundColor: selected
              ? BrandColors.primary
              : theme.backgroundElement,
          },
        ]}
      >
        <Ionicons
          name={icon}
          size={19}
          color={selected ? BrandColors.white : theme.textSecondary}
        />
      </View>
      <View style={s.optionTexts}>
        <ThemedText
          style={[s.optionLabel, selected && { color: theme.primary }]}
          numberOfLines={2}
        >
          {label}
        </ThemedText>
        {sublabel ? (
          <ThemedText style={s.optionSub} themeColor="textSecondary">
            {sublabel}
          </ThemedText>
        ) : null}
      </View>
      <View
        style={[
          s.optionRadio,
          {
            borderColor: selected ? theme.primary : theme.border,
            backgroundColor: selected ? BrandColors.primary : "transparent",
          },
        ]}
      >
        {selected && (
          <Ionicons name="checkmark" size={13} color={BrandColors.white} />
        )}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.55 },
  header: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: { flex: 1 },
  headerTitle: { fontSize: 18, lineHeight: 22, fontWeight: "800" },
  headerSubtitle: { fontSize: 11, lineHeight: 15, marginTop: 1 },
  stepCount: {
    minWidth: 44,
    height: 32,
    paddingHorizontal: Spacing.two,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  stepCountText: { fontSize: 12, fontWeight: "800" },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  stepItem: { alignItems: "center", gap: 6 },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepDotText: { fontSize: 12, lineHeight: 16, fontWeight: "800" },
  stepLabel: { fontSize: 11, lineHeight: 14, fontWeight: "700" },
  stepConnector: {
    flex: 1,
    height: 2,
    marginHorizontal: Spacing.two,
    marginBottom: 20,
    borderRadius: BorderRadius.full,
  },
  intro: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.three,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.one,
    marginBottom: Spacing.one,
    padding: Spacing.three,
    borderRadius: 20,
  },
  introIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  introCopy: { flex: 1 },
  introEyebrow: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  introTitle: { fontSize: 19, lineHeight: 24, fontWeight: "800", marginTop: 2 },
  introDescription: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  stepContent: {
    padding: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  section: {
    gap: Spacing.three,
    padding: 14,
    borderWidth: 1,
    borderRadius: 20,
  },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionHeaderCopy: { flex: 1 },
  sectionTitle: { fontSize: 15, lineHeight: 20, fontWeight: "800" },
  sectionSub: { fontSize: 12, lineHeight: 17, marginTop: 1 },
  optionBox: { gap: Spacing.two },
  optionRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderWidth: 1,
    borderRadius: 14,
  },
  optionIcon: {
    width: 38,
    height: 38,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  optionTexts: { flex: 1 },
  optionLabel: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  optionSub: { fontSize: 11, lineHeight: 16, marginTop: 1 },
  optionRadio: {
    width: 22,
    height: 22,
    borderRadius: BorderRadius.full,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    padding: Spacing.two,
  },
  loadingText: { flex: 1, fontSize: 13, lineHeight: 18 },
  emptyText: { padding: Spacing.two, fontSize: 13, lineHeight: 19 },
  formWrap: { flex: 1 },
  reviewHero: { borderWidth: 1, borderRadius: 20, overflow: "hidden" },
  reviewCover: { width: "100%", height: 170 },
  reviewCoverEmpty: { alignItems: "center", justifyContent: "center" },
  reviewHeroBody: { padding: Spacing.three, gap: Spacing.two },
  categoryBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
  },
  categoryBadgeText: { fontSize: 11, lineHeight: 15, fontWeight: "800" },
  reviewTitle: { fontSize: 24, lineHeight: 30, fontWeight: "800" },
  reviewDateRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  reviewDate: { flex: 1, fontSize: 13, lineHeight: 18 },
  reviewCard: { borderWidth: 1, borderRadius: 20, padding: Spacing.three },
  reviewCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
    marginBottom: Spacing.one,
  },
  reviewCardTitle: { fontSize: 16, lineHeight: 22, fontWeight: "800" },
  editLink: { fontSize: 12, lineHeight: 18, fontWeight: "800" },
  reviewRow: {
    flexDirection: "row",
    gap: Spacing.three,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  reviewRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  reviewLabel: { width: 88, fontSize: 12, lineHeight: 19, fontWeight: "600" },
  reviewValue: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: "600" },
  reviewDescription: { fontSize: 14, lineHeight: 22, marginTop: Spacing.two },
  reviewNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: BorderRadius.lg,
  },
  reviewNoteText: { flex: 1, fontSize: 12, lineHeight: 18 },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: 14,
  },
  errorText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  actions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  secondaryBtn: {
    flex: 1,
    height: 54,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontSize: 14, fontWeight: "800" },
  primaryBtn: {
    flex: 1.45,
    height: 54,
    backgroundColor: BrandColors.primary,
    borderRadius: BorderRadius.lg,
    flexDirection: "row",
    gap: Spacing.two,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: BrandColors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 3,
  },
  primaryText: { fontSize: 15, fontWeight: "800", color: BrandColors.white },
});
