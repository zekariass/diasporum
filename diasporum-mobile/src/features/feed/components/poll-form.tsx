import React, { useRef, useState } from "react";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import {
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { PollCard } from "./poll-card";
import { OptionPicker } from "@/shared/components/option-picker";
import type {
  CategoryView,
  CreatePollRequest,
  Poll,
  PollResultsVisibility,
  UpdatePollRequest,
} from "../types/feed-types";

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 20;
export const POLL_DEFAULT_MAX_OPTIONS = 20;
export const POLL_MAX_QUESTION_LENGTH = 20_000;
export const POLL_MAX_OPTION_LENGTH = 250;

export interface PollFormValue {
  question: string;
  categoryId: string;
  options: string[];
  maxOptions: number;
  closesAt: string | null;
  allowMultiple: boolean;
  allowVoteChange: boolean;
  allowVoteWithdraw: boolean;
  anonymousVoting: boolean;
  resultsVisibility: PollResultsVisibility;
}

interface PollFormProps {
  value: PollFormValue;
  onChange: (value: PollFormValue) => void;
  categories?: CategoryView[];
  showCategory?: boolean;
  loadingCategories?: boolean;
  configurationLocked?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  allowDeadlineClear?: boolean;
}

const RESULT_VISIBILITY: {
  value: PollResultsVisibility;
  label: string;
  description: string;
}[] = [
  {
    value: "IMMEDIATE",
    label: "Immediately",
    description: "Everyone can see results while voting is open.",
  },
  {
    value: "AFTER_VOTING",
    label: "After voting",
    description: "People see results once they have voted.",
  },
  {
    value: "AFTER_CLOSE",
    label: "After poll closes",
    description: "Results become visible when voting ends.",
  },
];

/** "Closes in 3 days" / "Closes tomorrow" / "This time has already passed". */
function closingHintText(deadline: Date): string {
  const ms = deadline.getTime() - Date.now();
  if (ms <= 0) return "This time has already passed";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `Closes in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Closes in ${hours} hr${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Closes tomorrow" : `Closes in ${days} days`;
}

export function emptyPollFormValue(): PollFormValue {
  return {
    question: "",
    categoryId: "",
    options: ["", ""],
    maxOptions: POLL_DEFAULT_MAX_OPTIONS,
    closesAt: null,
    allowMultiple: false,
    allowVoteChange: false,
    allowVoteWithdraw: false,
    anonymousVoting: false,
    resultsVisibility: "AFTER_VOTING",
  };
}

export function pollFormValueFromPoll(poll: Poll): PollFormValue {
  return {
    question: poll.question,
    categoryId: "",
    options: poll.options.map((option) => option.text),
    maxOptions: poll.maxOptions,
    closesAt: poll.closesAt,
    allowMultiple: poll.allowMultiple,
    allowVoteChange: poll.allowVoteChange,
    allowVoteWithdraw: poll.allowVoteWithdraw,
    anonymousVoting: poll.anonymousVoting,
    resultsVisibility: poll.resultsVisibility,
  };
}

export function validatePollForm(
  value: PollFormValue,
  requireCategory = true,
): string | null {
  if (requireCategory && !value.categoryId) {
    return "Choose a FEED category.";
  }
  const question = value.question.trim();
  if (!question) return "Enter a poll question.";
  if (question.length > POLL_MAX_QUESTION_LENGTH) {
    return `Poll questions cannot exceed ${POLL_MAX_QUESTION_LENGTH.toLocaleString()} characters.`;
  }
  if (
    !Number.isInteger(value.maxOptions) ||
    value.maxOptions < POLL_MIN_OPTIONS ||
    value.maxOptions > POLL_MAX_OPTIONS
  ) {
    return `Maximum options must be between ${POLL_MIN_OPTIONS} and ${POLL_MAX_OPTIONS}.`;
  }
  if (
    value.options.length < POLL_MIN_OPTIONS ||
    value.options.length > value.maxOptions
  ) {
    return `Provide between ${POLL_MIN_OPTIONS} and ${value.maxOptions} options.`;
  }
  const normalized = value.options.map((option) => option.trim());
  if (normalized.some((option) => !option)) {
    return "All poll options must be filled.";
  }
  if (normalized.some((option) => option.length > POLL_MAX_OPTION_LENGTH)) {
    return `Poll options cannot exceed ${POLL_MAX_OPTION_LENGTH} characters.`;
  }
  if (new Set(normalized.map((option) => option.toLowerCase())).size !== normalized.length) {
    return "Poll options must be unique.";
  }
  if (value.closesAt) {
    const deadline = Date.parse(value.closesAt);
    if (!Number.isFinite(deadline) || deadline <= Date.now()) {
      return "Choose a closing date and time in the future.";
    }
  }
  return null;
}

export function createPollRequest(
  value: PollFormValue,
  communityId: string,
): CreatePollRequest {
  return {
    communityId,
    categoryId: value.categoryId,
    question: value.question.trim(),
    options: value.options.map((option) => option.trim()),
    maxOptions: value.maxOptions,
    closesAt: value.closesAt ?? undefined,
    allowMultiple: value.allowMultiple,
    allowVoteChange: value.allowVoteChange,
    allowVoteWithdraw: value.allowVoteWithdraw,
    anonymousVoting: value.anonymousVoting,
    resultsVisibility: value.resultsVisibility,
  };
}

export function updatePollRequest(
  value: PollFormValue,
  includeConfiguration = true,
): UpdatePollRequest {
  return {
    question: value.question.trim(),
    closesAt: value.closesAt ?? undefined,
    ...(includeConfiguration
      ? {
          options: value.options.map((option) => option.trim()),
          maxOptions: value.maxOptions,
          allowMultiple: value.allowMultiple,
          allowVoteChange: value.allowVoteChange,
          allowVoteWithdraw: value.allowVoteWithdraw,
          anonymousVoting: value.anonymousVoting,
          resultsVisibility: value.resultsVisibility,
        }
      : {}),
  };
}

export function PollForm({
  value,
  onChange,
  categories = [],
  showCategory = false,
  loadingCategories = false,
  configurationLocked = false,
  readOnly = false,
  disabled = false,
  allowDeadlineClear = true,
}: PollFormProps) {
  const theme = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  const [questionTouched, setQuestionTouched] = useState(false);
  const optionRefs = useRef<(React.ComponentRef<typeof TextInput> | null)[]>(
    [],
  );
  const controlsDisabled = disabled || readOnly;
  const configurationDisabled = controlsDisabled || configurationLocked;

  const update = (patch: Partial<PollFormValue>) => {
    onChange({ ...value, ...patch });
  };

  const updateDeadline = (picked: Date, mode: "date" | "time") => {
    const parsed = value.closesAt ? Date.parse(value.closesAt) : Date.now();
    const current = new Date(Number.isFinite(parsed) ? parsed : Date.now());
    if (mode === "date") {
      current.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
    } else {
      current.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
    }
    update({ closesAt: current.toISOString() });
  };

  const deadline = value.closesAt ? new Date(value.closesAt) : null;
  const validDeadline = deadline && Number.isFinite(deadline.getTime()) ? deadline : null;

  /** One-line summary shown on the collapsed settings header. */
  const settingsSummary = [
    validDeadline
      ? `Ends ${validDeadline.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
      : "No end date",
    value.allowMultiple ? "Multi-select" : "Single choice",
    value.anonymousVoting ? "Anonymous" : null,
    RESULT_VISIBILITY.find((item) => item.value === value.resultsVisibility)
      ?.label ?? null,
  ]
    .filter(Boolean)
    .join(" · ");

  /** Friendly relative hint for the chosen closing time. */
  const closingHint = validDeadline ? closingHintText(validDeadline) : null;

  const questionInvalid = questionTouched && !value.question.trim();
  const normalizedOptions = value.options.map((option) =>
    option.trim().toLowerCase(),
  );
  const duplicateIndexes = new Set<number>();
  normalizedOptions.forEach((key, index) => {
    if (key && normalizedOptions.indexOf(key) !== index) {
      duplicateIndexes.add(index);
    }
  });

  const addOption = () => {
    const nextIndex = value.options.length;
    update({ options: [...value.options, ""] });
    setTimeout(() => optionRefs.current[nextIndex]?.focus(), 60);
  };

  const previewPoll: Poll = {
    postId: "poll-preview",
    question: value.question.trim() || "Your poll question",
    status: "ACTIVE",
    closesAt: value.closesAt,
    closedAt: null,
    allowMultiple: value.allowMultiple,
    allowVoteChange: value.allowVoteChange,
    allowVoteWithdraw: value.allowVoteWithdraw,
    anonymousVoting: value.anonymousVoting,
    maxOptions: value.maxOptions,
    resultsVisibility: value.resultsVisibility,
    resultsVisible: value.resultsVisibility === "IMMEDIATE",
    totalVoters: 0,
    totalVotes: 0,
    myVotes: [],
    options: value.options.map((text, index) => ({
      id: `preview-${index}`,
      text: text.trim() || `Option ${index + 1}`,
      sortOrder: index,
      voteCount: 0,
      percentage: 0,
    })),
  };

  return (
    <View style={styles.container} testID="poll-form">
      {readOnly ? (
        <ThemedText style={styles.notice} themeColor="textSecondary">
          Closed or expired polls are read-only.
        </ThemedText>
      ) : configurationLocked ? (
        <ThemedText style={styles.notice} themeColor="textSecondary">
          Options and voting settings are locked after the first vote.
        </ThemedText>
      ) : null}

      {showCategory ? (
        <View style={styles.section}>
          <ThemedText style={styles.label}>FEED category *</ThemedText>
          <OptionPicker
            options={categories.map((c) => ({ id: c.id, label: c.name }))}
            selectedId={value.categoryId || null}
            onSelect={(id) => update({ categoryId: id })}
            placeholder="Choose a category"
            searchable={categories.length > 8}
            disabled={controlsDisabled}
            icon="grid-outline"
            variant="soft"
          />
          {loadingCategories ? (
            <ThemedText style={styles.hint} themeColor="textSecondary">
              Loading categories…
            </ThemedText>
          ) : categories.length === 0 ? (
            <ThemedText style={styles.hint} themeColor="textSecondary">
              No active FEED categories are available.
            </ThemedText>
          ) : null}
        </View>
      ) : null}

      {/* Question — the primary focus */}
      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>Your question</ThemedText>
        <View
          style={[
            styles.questionBox,
            { backgroundColor: theme.backgroundElement },
            questionInvalid && {
              borderWidth: 1,
              borderColor: BrandColors.error,
            },
          ]}
        >
          <TextInput
            style={[styles.questionInput, { color: theme.text }]}
            value={value.question}
            onChangeText={(question) => update({ question })}
            onBlur={() => setQuestionTouched(true)}
            placeholder="What would you like to ask?"
            placeholderTextColor={theme.textMuted}
            multiline
            maxLength={POLL_MAX_QUESTION_LENGTH}
            editable={!controlsDisabled}
            accessibilityLabel="Question (required)"
          />
          <ThemedText style={styles.counter} themeColor="textSecondary">
            {value.question.length.toLocaleString()}/{POLL_MAX_QUESTION_LENGTH.toLocaleString()}
          </ThemedText>
        </View>
        {questionInvalid ? (
          <ThemedText style={styles.inlineError} accessibilityRole="alert">
            A question is required.
          </ThemedText>
        ) : null}
      </View>

      {/* Answer options */}
      <View style={styles.section}>
        <View style={styles.labelRow}>
          <ThemedText style={styles.sectionTitle}>Answer options</ThemedText>
          <ThemedText style={styles.hint} themeColor="textSecondary">
            {value.options.length} of {value.maxOptions}
          </ThemedText>
        </View>
        <ThemedText style={styles.hint} themeColor="textSecondary">
          Add the choices people can vote for.
        </ThemedText>
        {value.options.map((option, index) => {
          const duplicate = duplicateIndexes.has(index);
          const removable =
            value.options.length > POLL_MIN_OPTIONS && !configurationDisabled;
          return (
            <View
              key={index}
              style={[
                styles.optionRow,
                { backgroundColor: theme.backgroundElement },
                duplicate && { borderWidth: 1, borderColor: BrandColors.error },
              ]}
            >
              <ThemedText
                style={styles.optionNumber}
                themeColor="textSecondary"
              >
                {String(index + 1).padStart(2, "0")}
              </ThemedText>
              <TextInput
                ref={(input) => {
                  optionRefs.current[index] = input;
                }}
                style={[styles.optionInput, { color: theme.text }]}
                value={option}
                onChangeText={(text) =>
                  update({
                    options: value.options.map((current, optionIndex) =>
                      optionIndex === index ? text : current,
                    ),
                  })
                }
                placeholder={`Option ${index + 1}`}
                placeholderTextColor={theme.textMuted}
                maxLength={POLL_MAX_OPTION_LENGTH}
                editable={!configurationDisabled}
                accessibilityLabel={`Option ${index + 1} (required)`}
              />
              {removable ? (
                <Pressable
                  onPress={() =>
                    update({
                      options: value.options.filter(
                        (_, optionIndex) => optionIndex !== index,
                      ),
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Remove option ${index + 1}`}
                  hitSlop={8}
                >
                  <Ionicons
                    name="close-circle"
                    size={20}
                    color={theme.textSecondary}
                  />
                </Pressable>
              ) : null}
            </View>
          );
        })}
        {duplicateIndexes.size > 0 ? (
          <ThemedText style={styles.inlineError} accessibilityRole="alert">
            Options must be unique.
          </ThemedText>
        ) : null}
        {value.options.length < value.maxOptions && !configurationDisabled ? (
          <Pressable
            onPress={addOption}
            accessibilityRole="button"
            accessibilityLabel="Add poll option"
            style={[styles.addOption, { backgroundColor: theme.primarySurface }]}
          >
            <Ionicons name="add" size={18} color={theme.primary} />
            <ThemedText style={[styles.addOptionText, { color: theme.primary }]}>
              Add option
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      {/* Poll settings — collapsible grouped card */}
      <View
        style={[styles.settingsBox, { backgroundColor: theme.backgroundElement }]}
      >
        <Pressable
          onPress={() => setSettingsOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel="Poll settings"
          accessibilityState={{ expanded: settingsOpen }}
          style={({ pressed }) => [styles.settingsHeader, pressed && { opacity: 0.7 }]}
        >
          <View
            style={[styles.headerIcon, { backgroundColor: theme.primarySurface }]}
          >
            <Ionicons name="options-outline" size={15} color={theme.primary} />
          </View>
          <View style={styles.flex}>
            <ThemedText style={styles.sectionTitle}>Poll settings</ThemedText>
            {!settingsOpen ? (
              <ThemedText
                style={styles.headerSummary}
                themeColor="textSecondary"
                numberOfLines={1}
              >
                {settingsSummary}
              </ThemedText>
            ) : null}
          </View>
          <Ionicons
            name={settingsOpen ? "chevron-up" : "chevron-down"}
            size={18}
            color={theme.textSecondary}
          />
        </Pressable>

        {settingsOpen ? (
          <View style={styles.settingsBody}>
            {/* Closing time */}
            <View style={styles.subSection}>
              <ThemedText style={styles.groupLabel} themeColor="textSecondary">
                CLOSES
              </ThemedText>
              <View style={styles.toggleRow}>
                <View style={styles.flex}>
                  <ThemedText style={styles.toggleLabel}>
                    Set a closing time
                  </ThemedText>
                  <ThemedText
                    style={styles.toggleHint}
                    themeColor="textSecondary"
                  >
                    Otherwise the poll stays open until you close it.
                  </ThemedText>
                </View>
                <Switch
                  value={value.closesAt !== null}
                  onValueChange={(enabled) =>
                    update({
                      closesAt: enabled
                        ? new Date(
                            Date.now() + 24 * 60 * 60 * 1000,
                          ).toISOString()
                        : null,
                    })
                  }
                  disabled={
                    controlsDisabled ||
                    (!allowDeadlineClear && value.closesAt !== null)
                  }
                  accessibilityLabel="Set a closing time"
                />
              </View>
              {value.closesAt ? (
                <>
                  <View style={styles.deadlineRow}>
                    <Pressable
                      onPress={() => setPicker("date")}
                      disabled={controlsDisabled}
                      accessibilityRole="button"
                      accessibilityLabel="Choose closing date"
                      style={({ pressed }) => [
                        styles.deadlineChip,
                        { backgroundColor: theme.background },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Ionicons
                        name="calendar-outline"
                        size={15}
                        color={theme.primary}
                      />
                      <ThemedText style={styles.deadlineText}>
                        {validDeadline
                          ? validDeadline.toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "Date"}
                      </ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={() => setPicker("time")}
                      disabled={controlsDisabled}
                      accessibilityRole="button"
                      accessibilityLabel="Choose closing time"
                      style={({ pressed }) => [
                        styles.deadlineChip,
                        { backgroundColor: theme.background },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Ionicons
                        name="time-outline"
                        size={15}
                        color={theme.primary}
                      />
                      <ThemedText style={styles.deadlineText}>
                        {validDeadline
                          ? validDeadline.toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "Time"}
                      </ThemedText>
                    </Pressable>
                  </View>
                  {closingHint ? (
                    <ThemedText
                      style={[
                        styles.hint,
                        closingHint.includes("passed")
                          ? { color: BrandColors.warning }
                          : null,
                      ]}
                      themeColor="textSecondary"
                    >
                      {closingHint}
                    </ThemedText>
                  ) : null}
                </>
              ) : null}
              {!allowDeadlineClear && value.closesAt ? (
                <ThemedText style={styles.hint} themeColor="textSecondary">
                  An existing deadline can be changed but not removed.
                </ThemedText>
              ) : null}
            </View>

            {/* Voting rules */}
            <View style={styles.subSection}>
              <ThemedText style={styles.groupLabel} themeColor="textSecondary">
                VOTING
              </ThemedText>
              <PolicyToggle
                icon="checkmark-done-outline"
                label="Multiple selections"
                hint="Voters can choose more than one option."
                value={value.allowMultiple}
                disabled={configurationDisabled}
                onValueChange={(allowMultiple) => update({ allowMultiple })}
              />
              <PolicyToggle
                icon="swap-horizontal-outline"
                label="Vote changes"
                hint="Voters can switch their answer while the poll is open."
                value={value.allowVoteChange}
                disabled={configurationDisabled}
                onValueChange={(allowVoteChange) =>
                  update({ allowVoteChange })
                }
              />
              <PolicyToggle
                icon="arrow-undo-outline"
                label="Vote withdrawal"
                hint="Voters can remove their vote entirely."
                value={value.allowVoteWithdraw}
                disabled={configurationDisabled}
                onValueChange={(allowVoteWithdraw) =>
                  update({ allowVoteWithdraw })
                }
              />
              <PolicyToggle
                icon="eye-off-outline"
                label="Anonymous voting"
                hint="Voters can't see who voted for what."
                value={value.anonymousVoting}
                disabled={configurationDisabled}
                onValueChange={(anonymousVoting) =>
                  update({ anonymousVoting })
                }
              />
            </View>

            {/* Results visibility */}
            <View style={styles.subSection}>
              <ThemedText style={styles.groupLabel} themeColor="textSecondary">
                RESULTS VISIBILITY
              </ThemedText>
              <View
                style={[
                  styles.visGroup,
                  { backgroundColor: theme.background },
                ]}
              >
                {RESULT_VISIBILITY.map((item, index) => {
                  const selected = value.resultsVisibility === item.value;
                  return (
                    <Pressable
                      key={item.value}
                      onPress={() =>
                        update({ resultsVisibility: item.value })
                      }
                      disabled={configurationDisabled}
                      accessibilityRole="radio"
                      accessibilityLabel={`Results ${item.label.toLowerCase()}`}
                      accessibilityState={{
                        checked: selected,
                        disabled: configurationDisabled,
                      }}
                      style={({ pressed }) => [
                        styles.visRow,
                        index > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: theme.border,
                        },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <View style={styles.flex}>
                        <ThemedText
                          style={[
                            styles.visLabel,
                            selected && { color: theme.primary },
                          ]}
                        >
                          {item.label}
                        </ThemedText>
                        <ThemedText
                          style={styles.toggleHint}
                          themeColor="textSecondary"
                        >
                          {item.description}
                        </ThemedText>
                      </View>
                      <Ionicons
                        name={selected ? "checkmark-circle" : "ellipse-outline"}
                        size={20}
                        color={selected ? theme.primary : theme.textMuted}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        ) : null}
      </View>

      {picker && !controlsDisabled ? (
        <DateTimePicker
          mode={picker}
          value={validDeadline ?? new Date()}
          onChange={(event, picked) => {
            const mode = picker;
            setPicker(null);
            if (picked && event.type !== "dismissed") updateDeadline(picked, mode);
          }}
        />
      ) : null}

      {/* Preview — real PollCard with a non-interactive poll */}
      <Pressable
        onPress={() => setPreviewVisible((visible) => !visible)}
        accessibilityRole="button"
        accessibilityLabel={
          previewVisible ? "Hide poll preview" : "Show poll preview"
        }
        style={styles.previewToggle}
      >
        <Ionicons
          name={previewVisible ? "eye-off-outline" : "eye-outline"}
          size={17}
          color={BrandColors.primary}
        />
        <ThemedText style={{ color: BrandColors.primary, fontWeight: "600" }}>
          {previewVisible ? "Hide preview" : "Preview poll"}
        </ThemedText>
      </Pressable>
      {previewVisible ? (
        <View
          style={[
            styles.preview,
            { backgroundColor: theme.backgroundElement },
          ]}
          testID="poll-preview"
        >
          <PollCard poll={previewPoll} />
        </View>
      ) : null}
    </View>
  );
}

function PolicyToggle({
  icon,
  label,
  hint,
  value,
  disabled,
  onValueChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  value: boolean;
  disabled: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.toggleRow}>
      <View
        style={[styles.toggleIcon, { backgroundColor: theme.background }]}
      >
        <Ionicons name={icon} size={15} color={theme.primary} />
      </View>
      <View style={styles.flex}>
        <ThemedText style={styles.toggleLabel}>{label}</ThemedText>
        <ThemedText style={styles.toggleHint} themeColor="textSecondary">
          {hint}
        </ThemedText>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.four },
  flex: { flex: 1 },
  section: { gap: Spacing.two },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { fontSize: 15, fontWeight: "700" },
  label: { fontSize: 14, fontWeight: "600" },
  hint: { fontSize: 12, lineHeight: 17 },
  notice: { fontSize: 13, lineHeight: 19 },
  inlineError: { fontSize: 12, color: BrandColors.error },
  counter: { fontSize: 11, textAlign: "right" },
  questionBox: {
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: 6,
  },
  questionInput: {
    fontSize: 16,
    lineHeight: 24,
    minHeight: 96,
    textAlignVertical: "top",
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: 2,
  },
  optionNumber: {
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    width: 20,
  },
  optionInput: { flex: 1, fontSize: 15, paddingVertical: 9 },
  addOption: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: Spacing.one,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  addOptionText: {
    fontSize: 13,
    fontWeight: "600",
  },
  settingsBox: {
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  settingsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: 32,
  },
  headerIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  headerSummary: { fontSize: 12, marginTop: 1 },
  settingsBody: { gap: Spacing.four, paddingTop: Spacing.three },
  subSection: { gap: Spacing.two },
  groupLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: 40,
  },
  toggleIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleLabel: { fontSize: 14, fontWeight: "600" },
  toggleHint: { fontSize: 12, lineHeight: 16, marginTop: 1 },
  deadlineRow: { flexDirection: "row", gap: Spacing.two },
  deadlineChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
  },
  deadlineText: { fontSize: 13, fontWeight: "600" },
  visGroup: { borderRadius: 12, overflow: "hidden" },
  visRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
  },
  visLabel: { fontSize: 14, fontWeight: "600" },
  previewToggle: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: Spacing.one,
  },
  preview: {
    borderRadius: BorderRadius.md,
    padding: Spacing.three,
  },
});
