import React, { useCallback, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ApiError } from "@/core/api/api-error";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { PrimaryButton } from "@/shared/components/primary-button";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { createDirectoryApi } from "../services/directory-api";
import type { BusinessReview } from "../types/directory-types";
import {
  DirectoryEmpty,
  DirectoryInput,
  DirectoryMessage,
} from "./directory-ui";
import { ReportForm } from "./report-form";

export function BusinessReviews({
  businessId,
  canManage,
  onChanged,
}: {
  businessId: string;
  canManage: boolean;
  onChanged?: () => void;
}) {
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = React.useMemo(() => createDirectoryApi(apiClient), [apiClient]);
  const [items, setItems] = useState<BusinessReview[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [response, setResponse] = useState("");
  const [reportingId, setReportingId] = useState<string | null>(null);
  const busyRef = useRef(false);

  const load = useCallback(
    async (nextCursor?: string) => {
      try {
        const page = await api.reviews(businessId, nextCursor);
        setItems((previous) =>
          nextCursor ? [...previous, ...page.items] : page.items,
        );
        setCursor(page.nextCursor);
        setError(null);
      } catch (cause) {
        setError(
          ApiError.isApiError(cause)
            ? cause.userMessage
            : "Could not load reviews.",
        );
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [api, businessId],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const run = async (key: string, operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await operation();
      await load();
      onChanged?.();
    } catch (cause) {
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "The review operation could not be completed.",
      );
      throw cause;
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const submitReview = () => {
    void run("review", async () => {
      if (editingId) {
        await api.updateReview(businessId, editingId, rating, body.trim());
        setNotice("Your review was updated.");
      } else {
        await api.createReview(businessId, rating, body.trim());
        setNotice("Your review was published.");
      }
      setEditingId(null);
      setBody("");
      setRating(5);
    }).catch(() => undefined);
  };

  return (
    <View style={styles.root}>
      <ThemedText style={styles.heading}>Reviews</ThemedText>
      {error ? <DirectoryMessage error>{error}</DirectoryMessage> : null}
      {notice ? <DirectoryMessage>{notice}</DirectoryMessage> : null}

      {!canManage ? (
        <View
          style={[
            styles.editor,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}
        >
          <ThemedText style={styles.editorTitle}>
            {editingId ? "Edit your review" : "Write a review"}
          </ThemedText>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((value) => (
              <Pressable
                key={value}
                onPress={() => setRating(value)}
                accessibilityLabel={`${value} star rating`}
                accessibilityRole="button"
              >
                <Ionicons
                  name={value <= rating ? "star" : "star-outline"}
                  size={28}
                  color={BrandColors.warning}
                />
              </Pressable>
            ))}
          </View>
          <DirectoryInput
            label="Review (optional)"
            value={body}
            onChangeText={setBody}
            placeholder="Share your experience"
            multiline
            maxLength={4000}
          />
          <PrimaryButton
            label={editingId ? "Save review" : "Publish review"}
            loading={busy === "review"}
            onPress={submitReview}
          />
          {editingId ? (
            <PrimaryButton
              label="Cancel review edit"
              variant="ghost"
              onPress={() => {
                setEditingId(null);
                setBody("");
                setRating(5);
              }}
            />
          ) : null}
        </View>
      ) : null}

      {loading ? (
        <DirectoryMessage>Loading reviews…</DirectoryMessage>
      ) : items.length === 0 ? (
        <DirectoryEmpty
          title="No reviews yet"
          body="Reviews from directory visitors will appear here."
        />
      ) : (
        items.map((review) => (
          <View
            key={review.id}
            style={[styles.review, { borderBottomColor: theme.border }]}
          >
            <View style={styles.reviewHeader}>
              <View style={styles.reviewerCopy}>
                <ThemedText style={styles.reviewer}>
                  {review.reviewer?.displayName ??
                    review.reviewer?.username ??
                    "Diasporum member"}
                </ThemedText>
                <ThemedText style={styles.date} themeColor="textSecondary">
                  {new Date(review.createdAt).toLocaleDateString()}
                </ThemedText>
              </View>
              <ThemedText style={styles.rating}>{review.rating} / 5</ThemedText>
            </View>
            {review.body ? <ThemedText style={styles.body}>{review.body}</ThemedText> : null}
            {review.ownerResponse ? (
              <View style={styles.responseBox}>
                <ThemedText style={styles.responseTitle}>Owner response</ThemedText>
                <ThemedText style={styles.body}>{review.ownerResponse}</ThemedText>
              </View>
            ) : null}

            <View style={styles.actions}>
              {review.mine ? (
                <>
                  <Pressable
                    accessibilityLabel={`Edit review ${review.id}`}
                    onPress={() => {
                      setEditingId(review.id);
                      setRating(review.rating);
                      setBody(review.body ?? "");
                    }}
                  >
                    <ThemedText style={styles.action}>Edit</ThemedText>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Delete review ${review.id}`}
                    onPress={() =>
                      Alert.alert("Delete your review?", "This also updates the business rating.", [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete",
                          style: "destructive",
                          onPress: () =>
                            void run(`delete-${review.id}`, async () => {
                              await api.deleteReview(businessId, review.id);
                              if (editingId === review.id) {
                                setEditingId(null);
                                setBody("");
                              }
                            }).catch(() => undefined),
                        },
                      ])
                    }
                  >
                    <ThemedText style={styles.delete}>Delete</ThemedText>
                  </Pressable>
                </>
              ) : null}
              {canManage ? (
                <Pressable
                  accessibilityLabel={`Respond to review ${review.id}`}
                  onPress={() => {
                    setRespondingId(
                      respondingId === review.id ? null : review.id,
                    );
                    setResponse(review.ownerResponse ?? "");
                  }}
                >
                  <ThemedText style={styles.action}>
                    {review.ownerResponse ? "Edit response" : "Respond"}
                  </ThemedText>
                </Pressable>
              ) : null}
              {!review.mine && !canManage ? (
                <Pressable
                  accessibilityLabel={`Report review ${review.id}`}
                  onPress={() =>
                    setReportingId(reportingId === review.id ? null : review.id)
                  }
                >
                  <ThemedText style={styles.action}>Report</ThemedText>
                </Pressable>
              ) : null}
            </View>

            {respondingId === review.id && canManage ? (
              <View style={styles.inlineForm}>
                <DirectoryInput
                  label={`Response to ${review.reviewer?.displayName ?? "reviewer"}`}
                  value={response}
                  onChangeText={setResponse}
                  placeholder="Write a public owner response"
                  multiline
                  maxLength={4000}
                />
                <PrimaryButton
                  label="Save owner response"
                  loading={busy === `response-${review.id}`}
                  onPress={() =>
                    void run(`response-${review.id}`, async () => {
                      await api.respondToReview(businessId, review.id, response.trim());
                      setRespondingId(null);
                      setNotice("Owner response saved.");
                    }).catch(() => undefined)
                  }
                />
              </View>
            ) : null}
            {reportingId === review.id ? (
              <ReportForm
                busy={busy === `report-${review.id}`}
                onCancel={() => setReportingId(null)}
                onSubmit={async (reason, details) => {
                  await run(`report-${review.id}`, async () => {
                    await api.reportReview(businessId, review.id, reason, details);
                    setReportingId(null);
                    setNotice("Review reported to platform moderators.");
                  });
                }}
              />
            ) : null}
          </View>
        ))
      )}
      {cursor ? (
        <PrimaryButton
          label="Load more reviews"
          variant="ghost"
          loading={loadingMore}
          onPress={() => {
            setLoadingMore(true);
            void load(cursor);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.three },
  heading: { fontSize: 21, lineHeight: 28, fontWeight: "800" },
  editor: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  editorTitle: { fontSize: 15, fontWeight: "800" },
  stars: { flexDirection: "row", gap: Spacing.one },
  review: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.three, gap: Spacing.two },
  reviewHeader: { flexDirection: "row", alignItems: "center" },
  reviewerCopy: { flex: 1 },
  reviewer: { fontSize: 14, fontWeight: "700" },
  date: { fontSize: 11 },
  rating: { fontSize: 13, fontWeight: "800", color: BrandColors.primary },
  body: { fontSize: 14, lineHeight: 21 },
  responseBox: { padding: Spacing.three, backgroundColor: BrandColors.primarySurface, borderRadius: BorderRadius.md, gap: 4 },
  responseTitle: { fontSize: 12, fontWeight: "800", color: BrandColors.primaryDark },
  actions: { flexDirection: "row", gap: Spacing.four },
  action: { color: BrandColors.primary, fontSize: 12, fontWeight: "700" },
  delete: { color: BrandColors.error, fontSize: 12, fontWeight: "700" },
  inlineForm: { gap: Spacing.two, marginTop: Spacing.two },
});
