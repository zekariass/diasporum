import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ApiError } from "@/core/api/api-error";
import { safeBack } from "@/core/navigation/safe-back";
import { useSession } from "@/core/session/session-provider";
import { FormInput } from "@/shared/components/form-input";
import { PrimaryButton } from "@/shared/components/primary-button";
import { BrandColors } from "@/shared/theme/colors";
import { Spacing } from "@/shared/theme/spacing";
import { useTheme } from "@/hooks/use-theme";
import { createBusinessApi } from "../services/business-api";

export default function CreateBusinessScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { apiClient } = useSession();
  const businessApi = React.useMemo(
    () => createBusinessApi(apiClient),
    [apiClient],
  );
  const [accountName, setAccountName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const normalized = accountName.trim();
    if (!normalized || submitting) {
      if (!normalized) setError("Enter a Business Account name.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const account = await businessApi.createAccount(normalized);
      router.replace(`/(app)/business/workspace/${account.id}` as never);
    } catch (cause) {
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "Could not create the Business Account. Please try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={[styles.nav, { borderBottomColor: theme.border }]}>
            <Pressable onPress={safeBack} hitSlop={8} accessibilityLabel="Back">
              <Ionicons name="arrow-back" size={24} color={theme.text} />
            </Pressable>
            <ThemedText style={styles.navTitle}>Business Workspace</ThemedText>
            <View style={styles.navSpacer} />
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.icon}>
              <Ionicons
                name="briefcase-outline"
                size={34}
                color={BrandColors.primary}
              />
            </View>
            <ThemedText style={styles.title}>
              Create a Business Account
            </ThemedText>
            <ThemedText style={styles.subtitle} themeColor="textSecondary">
              Create a workspace to manage your business activities on
              Diasporum.
            </ThemedText>

            <View style={styles.form}>
              <FormInput
                label="Business Account name"
                value={accountName}
                onChangeText={setAccountName}
                placeholder="Workspace name"
                required
                maxLength={180}
                autoCapitalize="words"
                editable={!submitting}
                error={error ?? undefined}
              />
              <ThemedText style={styles.explanation} themeColor="textSecondary">
                This is the private workspace name, not a public Business
                Directory profile. You will become its first owner.
              </ThemedText>
              <PrimaryButton
                label="Create Business Account"
                onPress={() => void submit()}
                loading={submitting}
                disabled={!accountName.trim()}
              />
            </View>

            <View
              style={[
                styles.identityNote,
                { backgroundColor: theme.backgroundElement },
              ]}
            >
              <Ionicons
                name="shield-checkmark-outline"
                size={22}
                color={BrandColors.primary}
              />
              <ThemedText
                style={styles.identityText}
                themeColor="textSecondary"
              >
                Your personal login and identity stay unchanged. No separate
                business password or account is created.
              </ThemedText>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  nav: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
  },
  navTitle: { fontSize: 16, fontWeight: "700" },
  navSpacer: { width: 24 },
  content: { padding: Spacing.four, paddingBottom: Spacing.six },
  icon: {
    width: 68,
    height: 68,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.primarySurface,
    marginBottom: Spacing.four,
  },
  title: { fontSize: 27, lineHeight: 34, fontWeight: "800" },
  subtitle: { fontSize: 14, lineHeight: 21, marginTop: Spacing.two },
  form: { gap: Spacing.three, marginTop: Spacing.five },
  explanation: { fontSize: 12, lineHeight: 18 },
  identityNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.three,
    borderRadius: 16,
    padding: Spacing.three,
    marginTop: Spacing.five,
  },
  identityText: { flex: 1, fontSize: 12, lineHeight: 18 },
});
