import React, { useMemo, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { PrimaryButton } from "@/shared/components/primary-button";
import { KeyboardAwareScrollView } from "@/shared/components/keyboard-aware-scroll-view";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/core/api/api-error";
import { createShopApi } from "../services/shop-api";

/**
 * Review composer — two modes: `orderItemId` reviews a single purchased item
 * (product review shown on the product page), `sellerOrderId` reviews the
 * shop's fulfilment of the whole order (shop review shown on the storefront).
 */
export default function ReviewScreen() {
  const { sellerOrderId, orderItemId, productName, shopName } =
    useLocalSearchParams<{ sellerOrderId?: string; orderItemId?: string;
      productName?: string; shopName?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { apiClient } = useSession();
  const api = useMemo(() => createShopApi(apiClient), [apiClient]);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const itemMode = !!orderItemId;

  const submit = async () => {
    setBusy(true);
    try {
      if (itemMode) {
        await api.reviewProduct(orderItemId!, rating, text.trim());
      } else if (sellerOrderId) {
        await api.reviewShop(sellerOrderId, rating, text.trim());
      }
      router.back();
    } catch (cause) {
      Alert.alert("Review failed", ApiError.isApiError(cause) ? cause.userMessage : "Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 12 }}>
          <Pressable onPress={() => router.back()} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={{ color: theme.text, fontSize: 20, fontWeight: "700" }}>Leave a review</ThemedText>
        </View>
        <KeyboardAwareScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 24 }}>
          {itemMode && productName ? (
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Reviewing {productName}
            </ThemedText>
          ) : shopName ? (
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Reviewing your order from {shopName}
            </ThemedText>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            {[1, 2, 3, 4, 5].map((s) => (
              <Pressable key={s} onPress={() => setRating(s)}
                accessibilityLabel={`${s} star${s === 1 ? "" : "s"}`}>
                <Ionicons name={rating >= s ? "star" : "star-outline"} size={32} color={theme.warning} />
              </Pressable>
            ))}
          </View>
          <TextInput value={text} onChangeText={setText}
            placeholder={itemMode ? "How was the item?" : "How was your order?"}
            multiline placeholderTextColor={theme.textMuted}
            style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, minHeight: 100,
              paddingHorizontal: 12, paddingVertical: 10, color: theme.text, textAlignVertical: "top" }} />
          <PrimaryButton label="Submit review" onPress={() => void submit()} loading={busy} />
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
