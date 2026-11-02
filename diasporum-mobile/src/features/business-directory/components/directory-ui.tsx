import React from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/themed-text";
import { safeBack } from "@/core/navigation/safe-back";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";

export function DirectoryHeader({
  title,
  back = true,
  action,
}: {
  title: string;
  back?: boolean;
  action?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.header, { borderBottomColor: theme.border }]}>
      {back ? (
        <Pressable onPress={safeBack} hitSlop={8} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
      ) : (
        <View style={styles.headerSpacer} />
      )}
      <ThemedText style={styles.headerTitle} numberOfLines={1}>
        {title}
      </ThemedText>
      <View style={styles.headerAction}>{action}</View>
    </View>
  );
}

export function DirectoryField({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <View style={styles.field}>
      <ThemedText style={styles.label}>{label}</ThemedText>
      {children}
      {hint ? (
        <ThemedText style={styles.hint} themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

export function DirectoryInput({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  keyboardType = "default",
  autoCapitalize = "sentences",
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  maxLength?: number;
}) {
  const theme = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.textSecondary}
      accessibilityLabel={label}
      multiline={multiline}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      autoCorrect={autoCapitalize !== "none"}
      maxLength={maxLength}
      style={[
        styles.input,
        {
          color: theme.text,
          borderColor: theme.border,
          backgroundColor: theme.backgroundElement,
        },
        multiline && styles.multiline,
      ]}
    />
  );
}

export function DirectoryChip({
  label,
  active = false,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={[
        styles.chip,
        {
          backgroundColor: active
            ? BrandColors.primary
            : theme.backgroundElement,
          borderColor: active ? BrandColors.primary : theme.border,
        },
      ]}
    >
      <ThemedText style={[styles.chipText, active && styles.activeChipText]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

export function DirectoryMessage({
  children,
  error = false,
}: {
  children: string;
  error?: boolean;
}) {
  return (
    <ThemedText
      style={[styles.message, error && { color: BrandColors.error }]}
      themeColor={error ? undefined : "textSecondary"}
    >
      {children}
    </ThemedText>
  );
}

export function DirectoryEmpty({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <Ionicons
        name="storefront-outline"
        size={42}
        color={theme.textSecondary}
      />
      <ThemedText style={styles.emptyTitle}>{title}</ThemedText>
      <ThemedText style={styles.emptyBody} themeColor="textSecondary">
        {body}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  headerSpacer: { width: 24 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: "800" },
  headerAction: { minWidth: 24, alignItems: "flex-end" },
  field: { gap: 7 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  hint: { fontSize: 12, lineHeight: 17 },
  input: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: 11,
    fontSize: 15,
  },
  multiline: { minHeight: 110, textAlignVertical: "top" },
  chip: {
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  chipText: { fontSize: 13, fontWeight: "600" },
  activeChipText: { color: BrandColors.white },
  message: { fontSize: 13, lineHeight: 19 },
  empty: {
    alignItems: "center",
    paddingHorizontal: Spacing.five,
    paddingVertical: 56,
    gap: Spacing.two,
  },
  emptyTitle: { fontSize: 18, fontWeight: "800", textAlign: "center" },
  emptyBody: { fontSize: 14, lineHeight: 20, textAlign: "center" },
});
