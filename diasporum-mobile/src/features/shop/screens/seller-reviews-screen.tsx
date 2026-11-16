/**
 * Seller reviews — every product/shop review left on this shop, with an inline
 * public response editor for reviews the seller hasn't answered yet.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { KeyboardAwareScrollView } from "@/shared/components/keyboard-aware-scroll-view";
import { ErrorState } from "@/shared/components/error-state";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import { createShopApi } from "../services/shop-api";
import { ShopEmpty, StatusPill } from "../components/shop-ui";
import type { Review } from "../types/shop-types";

export default function SellerReviewsScreen() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { apiClient } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!shopId) return;
    try {
      setReviews(await api.sellerShopReviews(shopId));
      setError(null);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load reviews.");
      setReviews([]);
    }
  }, [api, shopId]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const respond = async (reviewId: string) => {
    if (!reply.trim()) return;
    setSaving(true);
    try {
      await api.respondToReview(shopId!, reviewId, reply.trim());
      setReplyTo(null);
      setReply("");
      await load();
    } catch (cause) {
      Alert.alert("Could not respond", ApiError.isApiError(cause) ? cause.userMessage : "Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 12 }}>
          <Pressable onPress={() => router.back()} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={{ color: theme.text, fontSize: 20, fontWeight: "700" }}>Reviews</ThemedText>
        </View>
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : reviews === null ? (
          <LoadingScreen />
        ) : (
          <KeyboardAwareScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 24 }}>
            {reviews.length === 0 ? (
              <ShopEmpty icon="star-outline" title="No reviews yet"
                message="Reviews buyers leave on your orders appear here." />
            ) : reviews.map((r) => (
              <View key={r.id} style={{ backgroundColor: theme.backgroundElement,
                borderRadius: 14, padding: 14, gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ flexDirection: "row", gap: 2 }}>
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Ionicons key={s} name={r.rating >= s ? "star" : "star-outline"}
                        size={14} color={theme.warning} />
                    ))}
                  </View>
                  <ThemedText type="small" style={{ color: theme.textSecondary, flex: 1 }}>
                    {r.reviewerDisplayName}{r.productName ? ` · ${r.productName}` : ""}
                  </ThemedText>
                  <StatusPill status={r.status} />
                </View>
                {r.text ? (
                  <ThemedText style={{ color: theme.text }}>{r.text}</ThemedText>
                ) : null}
                <ThemedText type="small" style={{ color: theme.textMuted }}>
                  {r.createdAt.slice(0, 10)}
                </ThemedText>
                {r.sellerResponse ? (
                  <View style={{ borderLeftWidth: 3, borderLeftColor: theme.primary,
                    paddingLeft: 10, gap: 2 }}>
                    <ThemedText type="smallBold" style={{ color: theme.textSecondary }}>
                      Your response
                    </ThemedText>
                    <ThemedText type="small" style={{ color: theme.text }}>{r.sellerResponse}</ThemedText>
                  </View>
                ) : replyTo === r.id ? (
                  <View style={{ gap: 8 }}>
                    <TextInput value={reply} onChangeText={setReply} multiline
                      placeholder="Write a public response…" placeholderTextColor={theme.textMuted}
                      style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10,
                        paddingHorizontal: 12, paddingVertical: 10, color: theme.text,
                        minHeight: 70, textAlignVertical: "top" }} />
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <PrimaryButton label="Post response" loading={saving}
                          onPress={() => void respond(r.id)} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <PrimaryButton label="Cancel" variant="secondary"
                          onPress={() => { setReplyTo(null); setReply(""); }} />
                      </View>
                    </View>
                  </View>
                ) : (
                  <Pressable onPress={() => { setReplyTo(r.id); setReply(""); }}
                    style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Ionicons name="chatbox-outline" size={15} color={theme.primary} />
                    <ThemedText type="small" style={{ color: theme.primary }}>Respond</ThemedText>
                  </Pressable>
                )}
              </View>
            ))}
          </KeyboardAwareScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}
