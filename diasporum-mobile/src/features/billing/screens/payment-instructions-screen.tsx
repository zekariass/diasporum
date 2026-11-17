import React, { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { FormInput } from "@/shared/components/form-input";
import { PrimaryButton } from "@/shared/components/primary-button";
import { uploadMedia } from "@/shared/services/media-upload";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { BillingShell } from "../components/billing-shell";
import { DetailRow } from "../components/detail-row";
import { useBillingApi } from "../hooks/use-billing-api";
import type { CheckoutResult } from "../types/billing-types";
import {
  PROOF_ALREADY_SUBMITTED_CODE,
  billingErrorCode,
  friendlyBillingMessage,
} from "../utils/billing-errors";
import { humanizeKey } from "../utils/billing-format";
import {
  hasProofErrors,
  validateProof,
  type ProofFormErrors,
} from "../utils/proof-validation";

/** Receipt photos are images; the backend accepts OTHER (image/*) or DOCUMENT (files). */
const RECEIPT_PURPOSE = "OTHER";

function parseResult(raw: string | undefined): CheckoutResult | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CheckoutResult;
  } catch {
    return null;
  }
}

function displayValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

export default function PaymentInstructionsScreen() {
  const params = useLocalSearchParams<{ paymentId: string; result?: string }>();
  const paymentId = params.paymentId;
  const result = useMemo(() => parseResult(params.result), [params.result]);
  const api = useBillingApi();
  const { apiClient } = useSession();
  const router = useRouter();
  const theme = useTheme();

  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [receiptName, setReceiptName] = useState<string | null>(null);
  const [mediaObjectId, setMediaObjectId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<ProofFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // paymentReference first, then the rest of the provider-defined details.
  const detailEntries = useMemo(() => {
    const entries = Object.entries(result?.details ?? {}).filter(
      ([, v]) => displayValue(v) !== "",
    );
    return entries.sort(([a], [b]) =>
      a === "paymentReference" ? -1 : b === "paymentReference" ? 1 : 0,
    );
  }, [result]);

  const pickReceipt = async () => {
    setServerError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setServerError("Allow photo access to attach a receipt.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    setUploading(true);
    try {
      const id = await uploadMedia(
        apiClient,
        {
          uri: asset.uri,
          mimeType: (asset.mimeType ?? "image/jpeg").toLowerCase(),
          fileName: asset.fileName ?? undefined,
        },
        RECEIPT_PURPOSE,
      );
      setMediaObjectId(id);
      setReceiptName(asset.fileName ?? "Receipt photo");
      setErrors((e) => ({ ...e, form: undefined }));
    } catch (e) {
      setServerError(friendlyBillingMessage(e, "We couldn't upload your receipt."));
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async () => {
    setServerError(null);
    const found = validateProof({ proofReference: reference, mediaObjectId, notes });
    setErrors(found);
    if (hasProofErrors(found)) return;
    setSubmitting(true);
    try {
      await api.submitProof(paymentId, {
        proofReference: reference,
        mediaObjectId,
        notes,
      });
      setSubmitted(true);
    } catch (e) {
      if (billingErrorCode(e) === PROOF_ALREADY_SUBMITTED_CODE) {
        setSubmitted(true);
      } else {
        setServerError(friendlyBillingMessage(e, "We couldn't submit your proof."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <BillingShell title="Payment submitted" backFallback="/(app)/billing">
        <View style={[styles.card, { backgroundColor: theme.warningSurface }]}>
          <ThemedText style={styles.pendingTitle}>Pending verification</ThemedText>
          <ThemedText themeColor="textSecondary">
            We received your payment details. Our team will verify your transfer
            and activate your subscription once it is confirmed.
          </ThemedText>
        </View>
        <PrimaryButton
          label="View subscription"
          onPress={() => router.replace("/(app)/billing" as never)}
        />
      </BillingShell>
    );
  }

  return (
    <BillingShell title="Complete payment" backFallback="/(app)/billing">
      {result ? (
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          {result.instructions ? (
            <ThemedText style={styles.instructions}>{result.instructions}</ThemedText>
          ) : null}
          {detailEntries.map(([key, value]) => (
            <DetailRow
              key={key}
              label={humanizeKey(key)}
              value={displayValue(value)}
              emphasized={key === "paymentReference"}
            />
          ))}
        </View>
      ) : null}

      <ThemedText style={styles.section}>Submit your proof of payment</ThemedText>

      <FormInput
        label="Transfer reference"
        value={reference}
        onChangeText={setReference}
        error={errors.proofReference}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="e.g. bank transaction ID"
      />

      <View style={styles.receipt}>
        <PrimaryButton
          label={mediaObjectId ? "Replace receipt photo" : "Attach receipt photo (optional)"}
          variant="secondary"
          onPress={pickReceipt}
          loading={uploading}
        />
        {receiptName ? (
          <ThemedText type="small" themeColor="textSecondary">
            Attached: {receiptName}
          </ThemedText>
        ) : null}
      </View>

      <FormInput
        label="Notes (optional)"
        value={notes}
        onChangeText={setNotes}
        error={errors.notes}
        multiline
      />

      {errors.form || serverError ? (
        <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>
          {errors.form ?? serverError}
        </ThemedText>
      ) : null}

      <PrimaryButton
        label="Submit for verification"
        onPress={onSubmit}
        loading={submitting}
        disabled={uploading}
      />
    </BillingShell>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  instructions: { fontSize: 15, lineHeight: 22, marginBottom: Spacing.two },
  section: { fontSize: 16, fontWeight: "800", marginTop: Spacing.two },
  receipt: { gap: Spacing.two },
  pendingTitle: { fontSize: 18, fontWeight: "800", marginBottom: Spacing.one },
});
