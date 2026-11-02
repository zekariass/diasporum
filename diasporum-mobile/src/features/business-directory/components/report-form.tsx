import React, { useState } from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { PrimaryButton } from "@/shared/components/primary-button";
import { Spacing } from "@/shared/theme/spacing";
import { DirectoryChip, DirectoryInput } from "./directory-ui";

const REASONS = [
  "SPAM",
  "SCAM",
  "HARASSMENT",
  "HATE",
  "SEXUAL_MISCONDUCT",
  "MISINFORMATION",
  "IMPERSONATION",
  "PRIVACY",
  "OTHER",
] as const;

export function ReportForm({
  onSubmit,
  onCancel,
  busy,
}: {
  onSubmit: (reason: string, details: string) => Promise<void>;
  onCancel: () => void;
  busy: boolean;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={styles.form}>
      <ThemedText style={styles.title}>Report to platform moderators</ThemedText>
      <View style={styles.reasons}>
        {REASONS.map((item) => (
          <DirectoryChip
            key={item}
            label={item.toLowerCase().replaceAll("_", " ")}
            active={reason === item}
            onPress={() => setReason(item)}
          />
        ))}
      </View>
      <DirectoryInput
        label="Report details (optional)"
        value={details}
        onChangeText={setDetails}
        placeholder="Add information that will help moderators"
        multiline
        maxLength={4000}
      />
      {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
      <PrimaryButton
        label="Submit report"
        variant="danger"
        loading={busy}
        onPress={() => {
          if (!reason) {
            setError("Choose a report reason.");
            return;
          }
          setError(null);
          void onSubmit(reason, details.trim()).catch(() => undefined);
        }}
      />
      <PrimaryButton label="Cancel report" variant="ghost" onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: Spacing.three },
  title: { fontSize: 15, fontWeight: "800" },
  reasons: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  error: { color: "#B3261E", fontSize: 13 },
});
