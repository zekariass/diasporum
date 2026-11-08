import React, { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { createServiceMarketplaceApi } from "../services/service-marketplace-api";
import { ScreenHeader, serviceStyles } from "../components/service-ui";

export function validateReview(rating: number, text: string) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return "Choose a rating from 1 to 5.";
  if (text.length > 4000) return "Review text cannot exceed 4000 characters.";
  return null;
}

export default function ReviewEditorScreen() {
  const { id, providerId } = useLocalSearchParams<{ id: string; providerId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { apiClient } = useSession();
  const api = useMemo(() => createServiceMarketplaceApi(apiClient), [apiClient]);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const validation = validateReview(rating, text);
    if (validation || !id || !providerId) {
      setError(validation ?? "The provider interaction is missing.");
      return;
    }
    setSaving(true);
    try {
      await api.createReview(id, providerId, rating, text.trim() || undefined);
      router.replace(`/(app)/services/providers/${providerId}` as never);
    } catch (cause) {
      setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not publish the review.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ThemedView style={serviceStyles.root}>
      <SafeAreaView style={serviceStyles.root} edges={["top", "left", "right"]}>
        <ScreenHeader back title="Review interaction" />
        <KeyboardAvoidingView style={serviceStyles.keyboard} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={serviceStyles.content} keyboardShouldPersistTaps="handled">
          <ThemedText type="small" themeColor="textSecondary">
            Reviews require a recorded response or lead interaction. They do not verify that work was completed.
          </ThemedText>
          <ThemedText type="subtitle">Rating</ThemedText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {[1, 2, 3, 4, 5].map((value) => <PrimaryButton key={value} label={`${value} star${value === 1 ? "" : "s"}`}
              variant={rating === value ? "primary" : "secondary"} onPress={() => setRating(value)} />)}
          </View>
          <TextInput accessibilityLabel="Review text" placeholder="Describe communication and your interaction (optional)"
            value={text} onChangeText={setText} multiline maxLength={4000}
            style={[serviceStyles.input, serviceStyles.multiline, { color: theme.text, borderColor: theme.border }]} />
          {error ? <ThemedText accessibilityRole="alert" style={{ color: BrandColors.error }}>{error}</ThemedText> : null}
          <PrimaryButton label="Publish review" loading={saving} disabled={!rating} onPress={() => void save()} />
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}
