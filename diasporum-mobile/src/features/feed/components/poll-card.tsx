import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/themed-text";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { PrimaryButton } from "@/shared/components/primary-button";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type { Poll } from "../types/feed-types";

interface PollCardProps {
  poll: Poll;
  onVote?: (optionId: string, withdraw: boolean) => Promise<Poll>;
  onChange?: (poll: Poll) => void;
}

export function PollCard({ poll, onVote, onChange }: PollCardProps) {
  const theme = useTheme();
  const [selected, setSelected] = useState<string[]>(poll.myVotes);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const active = poll.status === "ACTIVE";
  const interactive = active && Boolean(onVote);

  // A mutation response is authoritative and replaces both results and selections.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setSelected(poll.myVotes), [poll.myVotes]);

  const additions = selected.filter((id) => !poll.myVotes.includes(id));
  const removals = poll.myVotes.filter((id) => !selected.includes(id));
  const hasChanges = additions.length > 0 || removals.length > 0;

  function optionDisabled(optionId: string, checked: boolean): boolean {
    if (!interactive || submitting) return true;
    const voted = poll.myVotes.includes(optionId);
    if (voted && checked && !poll.allowVoteWithdraw) return true;
    if (
      !poll.allowMultiple &&
      poll.myVotes.length > 0 &&
      !voted &&
      !poll.allowVoteChange
    ) {
      return true;
    }
    return false;
  }

  function toggleOption(optionId: string) {
    const checked = selected.includes(optionId);
    if (optionDisabled(optionId, checked)) return;
    setError(null);
    if (!poll.allowMultiple) {
      setSelected(checked ? [] : [optionId]);
      return;
    }
    setSelected((current) =>
      current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId],
    );
  }

  async function submitVotes() {
    if (busyRef.current || !onVote || !active || !hasChanges) return;
    busyRef.current = true;
    setSubmitting(true);
    setError(null);
    let latest = poll;
    try {
      if (!poll.allowMultiple) {
        const next = selected[0];
        const current = poll.myVotes[0];
        if (next && next !== current) {
          latest = await onVote(next, false);
          onChange?.(latest);
        } else if (!next && current) {
          latest = await onVote(current, true);
          onChange?.(latest);
        }
      } else {
        const operations = [
          ...removals.map((optionId) => ({ optionId, withdraw: true })),
          ...additions.map((optionId) => ({ optionId, withdraw: false })),
        ];
        for (const operation of operations) {
          latest = await onVote(operation.optionId, operation.withdraw);
          onChange?.(latest);
        }
      }
      setSelected(latest.myVotes);
    } catch (cause) {
      setSelected(latest.myVotes);
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "Failed to update your vote. Please try again.",
      );
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  }

  const hiddenExplanation =
    poll.resultsVisibility === "AFTER_VOTING"
      ? "Results are visible after you vote."
      : poll.resultsVisibility === "AFTER_CLOSE"
        ? "Results are visible after the poll closes."
        : "Results are hidden.";

  return (
    <View style={styles.container} testID="poll-card">
      <View style={styles.heading}>
        <ThemedText style={styles.question}>{poll.question}</ThemedText>
        <View style={styles.metaRow}>
          <ThemedText
            style={[
              styles.status,
              { color: active ? BrandColors.primary : theme.textSecondary },
            ]}
          >
            {poll.status.toLowerCase()}
          </ThemedText>
          {poll.anonymousVoting ? (
            <ThemedText style={styles.meta} themeColor="textSecondary">
              Anonymous voting
            </ThemedText>
          ) : null}
        </View>
        {poll.closesAt ? (
          <ThemedText style={styles.meta} themeColor="textSecondary">
            {active ? "Closes" : "Closed"}{" "}
            {new Date(poll.closesAt).toLocaleString()}
          </ThemedText>
        ) : null}
        {poll.closedAt && !poll.closesAt ? (
          <ThemedText style={styles.meta} themeColor="textSecondary">
            Closed {new Date(poll.closedAt).toLocaleString()}
          </ThemedText>
        ) : null}
        <ThemedText style={styles.meta} themeColor="textSecondary">
          {poll.allowMultiple
            ? "Select one or more options"
            : "Select one option"}
        </ThemedText>
      </View>

      <View style={styles.options}>
        {poll.options.map((option) => {
          const checked = selected.includes(option.id);
          const disabled = optionDisabled(option.id, checked);
          const percentage = option.percentage ?? 0;
          return (
            <View key={option.id} style={styles.optionContainer}>
              <Pressable
                onPress={() => toggleOption(option.id)}
                disabled={disabled}
                accessibilityRole={poll.allowMultiple ? "checkbox" : "radio"}
                accessibilityLabel={option.text}
                accessibilityState={{ checked, disabled }}
                style={[
                  styles.option,
                  {
                    borderColor: checked ? theme.primary : theme.border,
                    backgroundColor: checked
                      ? theme.primarySurface
                      : theme.background,
                  },
                  disabled && styles.optionDisabled,
                ]}
              >
                <View style={styles.optionTextRow}>
                  <View
                    style={[
                      styles.selectionIndicator,
                      !poll.allowMultiple && styles.radioIndicator,
                      {
                        borderColor: checked ? theme.primary : theme.textMuted,
                        backgroundColor: checked
                          ? theme.primary
                          : "transparent",
                      },
                    ]}
                  >
                    {checked ? (
                      <Ionicons
                        name="checkmark"
                        size={13}
                        color={BrandColors.white}
                      />
                    ) : null}
                  </View>
                  <ThemedText style={styles.optionText}>
                    {option.text}
                  </ThemedText>
                  {poll.resultsVisible ? (
                    <ThemedText
                      style={[styles.resultText, { color: theme.primary }]}
                    >
                      {option.voteCount ?? 0} · {percentage.toFixed(1)}%
                    </ThemedText>
                  ) : null}
                </View>
                {poll.resultsVisible ? (
                  <View
                    style={[
                      styles.progressTrack,
                      { backgroundColor: theme.backgroundSelected },
                    ]}
                    accessibilityLabel={`${percentage.toFixed(1)} percent`}
                  >
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${Math.max(0, Math.min(100, percentage))}%`,
                          backgroundColor: theme.primary,
                        },
                      ]}
                    />
                  </View>
                ) : null}
              </Pressable>
            </View>
          );
        })}
      </View>

      {poll.resultsVisible ? (
        <View style={styles.totals}>
          <ThemedText style={styles.meta} themeColor="textSecondary">
            {poll.totalVoters ?? 0} voters · {poll.totalVotes ?? 0} votes
          </ThemedText>
          {poll.totalVoters === 0 ? (
            <ThemedText style={styles.meta} themeColor="textSecondary">
              No votes yet.
            </ThemedText>
          ) : null}
        </View>
      ) : (
        <ThemedText style={styles.meta} themeColor="textSecondary">
          {hiddenExplanation}
        </ThemedText>
      )}

      {!active ? (
        <ThemedText style={styles.meta} themeColor="textSecondary">
          {poll.status === "EXPIRED"
            ? "This poll has expired. Voting is closed."
            : "This poll is closed. Voting is closed."}
        </ThemedText>
      ) : null}
      {error ? (
        <ThemedText style={styles.error} accessibilityRole="alert">
          {error}
        </ThemedText>
      ) : null}
      {interactive ? (
        <PrimaryButton
          label={poll.myVotes.length > 0 ? "Update vote" : "Submit vote"}
          onPress={() => void submitVotes()}
          loading={submitting}
          disabled={!hasChanges || submitting}
          style={styles.submit}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
  },
  heading: { gap: 4 },
  question: { fontSize: 18, fontWeight: "700", lineHeight: 26 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  status: { fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  meta: { fontSize: 12, lineHeight: 17 },
  options: { gap: Spacing.two },
  optionContainer: { minWidth: 0 },
  option: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - 2,
    gap: Spacing.two + 2,
    overflow: "hidden",
  },
  optionDisabled: { opacity: 0.88 },
  optionTextRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  selectionIndicator: {
    width: 20,
    height: 20,
    borderWidth: 1.5,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  radioIndicator: { borderRadius: BorderRadius.full },
  optionText: { flex: 1, fontSize: 14, fontWeight: "500", lineHeight: 20 },
  resultText: { fontSize: 12, fontWeight: "700" },
  progressTrack: { height: 5, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 5, borderRadius: 3 },
  totals: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  error: { color: BrandColors.error, fontSize: 13 },
  submit: {
    alignSelf: "stretch",
    minHeight: 44,
    marginTop: Spacing.half,
    paddingVertical: Spacing.two,
    borderRadius: BorderRadius.full,
  },
});
