import React, { useState } from "react";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  Pressable,
  StyleSheet,
  Switch,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { FormInput } from "@/shared/components/form-input";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type {
  CategoryView,
  CreatePollRequest,
  Poll,
  PollResultsVisibility,
  UpdatePollRequest,
} from "../types/feed-types";

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 20;
export const POLL_DEFAULT_MAX_OPTIONS = 10;
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

const RESULT_VISIBILITY: { value: PollResultsVisibility; label: string }[] = [
  { value: "IMMEDIATE", label: "Immediate" },
  { value: "AFTER_VOTING", label: "After voting" },
  { value: "AFTER_CLOSE", label: "After close" },
];

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
  const [previewVisible, setPreviewVisible] = useState(false);
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
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
          <View style={styles.choiceWrap}>
            {categories.map((category) => {
              const selected = value.categoryId === category.id;
              return (
                <Pressable
                  key={category.id}
                  onPress={() => update({ categoryId: category.id })}
                  disabled={controlsDisabled}
                  accessibilityRole="radio"
                  accessibilityLabel={`Category ${category.name}`}
                  accessibilityState={{ checked: selected, disabled: controlsDisabled }}
                  style={[
                    styles.choice,
                    {
                      borderColor: selected ? BrandColors.primary : theme.border,
                      backgroundColor: selected
                        ? BrandColors.primarySurface
                        : theme.backgroundElement,
                    },
                  ]}
                >
                  <ThemedText style={selected ? styles.selectedChoiceText : undefined}>
                    {category.name}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
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

      <FormInput
        label="Question"
        required
        value={value.question}
        onChangeText={(question) => update({ question })}
        placeholder="What's the question?"
        multiline
        maxLength={POLL_MAX_QUESTION_LENGTH}
        editable={!controlsDisabled}
        style={styles.questionInput}
      />

      <View style={styles.section}>
        <View style={styles.labelRow}>
          <ThemedText style={styles.label}>Options *</ThemedText>
          <ThemedText style={styles.hint} themeColor="textSecondary">
            {value.options.length} of {value.maxOptions}
          </ThemedText>
        </View>
        {value.options.map((option, index) => (
          <View key={index} style={styles.optionRow}>
            <View style={styles.optionInput}>
              <FormInput
                label={`Option ${index + 1}`}
                required
                value={option}
                onChangeText={(text) =>
                  update({
                    options: value.options.map((current, optionIndex) =>
                      optionIndex === index ? text : current,
                    ),
                  })
                }
                placeholder={`Option ${index + 1}`}
                maxLength={POLL_MAX_OPTION_LENGTH}
                editable={!configurationDisabled}
              />
            </View>
            {value.options.length > POLL_MIN_OPTIONS && !configurationDisabled ? (
              <Pressable
                onPress={() =>
                  update({ options: value.options.filter((_, optionIndex) => optionIndex !== index) })
                }
                accessibilityRole="button"
                accessibilityLabel={`Remove option ${index + 1}`}
                hitSlop={8}
              >
                <ThemedText style={{ color: BrandColors.error }}>Remove</ThemedText>
              </Pressable>
            ) : null}
          </View>
        ))}
        {value.options.length < value.maxOptions && !configurationDisabled ? (
          <Pressable
            onPress={() => update({ options: [...value.options, ""] })}
            accessibilityRole="button"
            accessibilityLabel="Add poll option"
            style={styles.addOption}
          >
            <ThemedText style={{ color: BrandColors.primary, fontWeight: "600" }}>
              + Add option
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      <FormInput
        label="Maximum options"
        value={String(value.maxOptions)}
        onChangeText={(text) => {
          if (/^\d*$/.test(text)) {
            update({ maxOptions: text ? Number(text) : 0 });
          }
        }}
        keyboardType="number-pad"
        maxLength={2}
        editable={!configurationDisabled}
        hint={`${POLL_MIN_OPTIONS}–${POLL_MAX_OPTIONS}; the current option count cannot exceed this limit.`}
      />

      <View style={styles.section}>
        <View style={styles.toggleRow}>
          <ThemedText style={styles.toggleLabel}>Add closing date and time</ThemedText>
          <Switch
            value={value.closesAt !== null}
            onValueChange={(enabled) =>
              update({
                closesAt: enabled
                  ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                  : null,
              })
            }
            disabled={
              controlsDisabled ||
              (!allowDeadlineClear && value.closesAt !== null)
            }
            accessibilityLabel="Add closing date and time"
          />
        </View>
        {value.closesAt ? (
          <View style={styles.deadlineRow}>
            <Pressable
              onPress={() => setPicker("date")}
              disabled={controlsDisabled}
              accessibilityRole="button"
              accessibilityLabel="Choose closing date"
              style={[styles.deadlineButton, { borderColor: theme.border }]}
            >
              <ThemedText>
                {validDeadline ? validDeadline.toLocaleDateString() : "Choose date"}
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => setPicker("time")}
              disabled={controlsDisabled}
              accessibilityRole="button"
              accessibilityLabel="Choose closing time"
              style={[styles.deadlineButton, { borderColor: theme.border }]}
            >
              <ThemedText>
                {validDeadline
                  ? validDeadline.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  : "Choose time"}
              </ThemedText>
            </Pressable>
          </View>
        ) : null}
        {!allowDeadlineClear && value.closesAt ? (
          <ThemedText style={styles.hint} themeColor="textSecondary">
            An existing deadline can be changed but not removed.
          </ThemedText>
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

      <PolicyToggle
        label="Allow multiple selections"
        value={value.allowMultiple}
        disabled={configurationDisabled}
        onValueChange={(allowMultiple) => update({ allowMultiple })}
      />
      <PolicyToggle
        label="Allow vote changes"
        value={value.allowVoteChange}
        disabled={configurationDisabled}
        onValueChange={(allowVoteChange) => update({ allowVoteChange })}
      />
      <PolicyToggle
        label="Allow vote withdrawal"
        value={value.allowVoteWithdraw}
        disabled={configurationDisabled}
        onValueChange={(allowVoteWithdraw) => update({ allowVoteWithdraw })}
      />
      <PolicyToggle
        label="Anonymous voting"
        value={value.anonymousVoting}
        disabled={configurationDisabled}
        onValueChange={(anonymousVoting) => update({ anonymousVoting })}
      />

      <View style={styles.section}>
        <ThemedText style={styles.label}>Results visibility</ThemedText>
        <View style={styles.choiceWrap}>
          {RESULT_VISIBILITY.map((item) => {
            const selected = value.resultsVisibility === item.value;
            return (
              <Pressable
                key={item.value}
                onPress={() => update({ resultsVisibility: item.value })}
                disabled={configurationDisabled}
                accessibilityRole="radio"
                accessibilityLabel={`Results ${item.label.toLowerCase()}`}
                accessibilityState={{ checked: selected, disabled: configurationDisabled }}
                style={[
                  styles.choice,
                  {
                    borderColor: selected ? BrandColors.primary : theme.border,
                    backgroundColor: selected
                      ? BrandColors.primarySurface
                      : theme.backgroundElement,
                  },
                ]}
              >
                <ThemedText style={selected ? styles.selectedChoiceText : undefined}>
                  {item.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Pressable
        onPress={() => setPreviewVisible((visible) => !visible)}
        accessibilityRole="button"
        accessibilityLabel={previewVisible ? "Hide poll preview" : "Show poll preview"}
      >
        <ThemedText style={{ color: BrandColors.primary, fontWeight: "600" }}>
          {previewVisible ? "Hide preview" : "Preview poll"}
        </ThemedText>
      </Pressable>
      {previewVisible ? (
        <View
          style={[styles.preview, { borderColor: theme.border }]}
          testID="poll-preview"
        >
          <ThemedText style={styles.previewQuestion}>
            {value.question.trim() || "Your poll question"}
          </ThemedText>
          {value.options.map((option, index) => (
            <ThemedText key={index} style={styles.previewOption}>
              {value.allowMultiple ? "☐" : "○"} {option.trim() || `Option ${index + 1}`}
            </ThemedText>
          ))}
          <ThemedText style={styles.hint} themeColor="textSecondary">
            {value.allowMultiple ? "Multiple selections" : "Single selection"} · Results {value.resultsVisibility.toLowerCase().replaceAll("_", " ")}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

function PolicyToggle({
  label,
  value,
  disabled,
  onValueChange,
}: {
  label: string;
  value: boolean;
  disabled: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <ThemedText style={styles.toggleLabel}>{label}</ThemedText>
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
  container: { gap: Spacing.three },
  section: { gap: Spacing.two },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: { fontSize: 14, fontWeight: "600" },
  hint: { fontSize: 12, lineHeight: 17 },
  notice: { fontSize: 13, lineHeight: 19 },
  questionInput: { minHeight: 110, textAlignVertical: "top" },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  choice: {
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  selectedChoiceText: { color: BrandColors.primary, fontWeight: "600" },
  optionRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  optionInput: { flex: 1 },
  addOption: { alignSelf: "flex-start", paddingVertical: Spacing.one },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
    minHeight: 36,
  },
  toggleLabel: { flex: 1, fontSize: 14, fontWeight: "500" },
  deadlineRow: { flexDirection: "row", gap: Spacing.two },
  deadlineButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.three,
  },
  preview: { borderWidth: 1, borderRadius: BorderRadius.md, padding: Spacing.three, gap: Spacing.two },
  previewQuestion: { fontSize: 16, fontWeight: "700" },
  previewOption: { fontSize: 14 },
});
