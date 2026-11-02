import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useTheme } from "@/hooks/use-theme";
import { safeBack } from "@/core/navigation/safe-back";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";

export function PropertyScreen({
  title,
  children,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Pressable onPress={safeBack} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={8}>
            <Ionicons name="chevron-back" size={24} color={theme.text} />
          </Pressable>
          <ThemedText type="title" style={styles.headerTitle} numberOfLines={1}>{title}</ThemedText>
          <View style={styles.actions}>{actions ?? <View style={styles.headerSpacer} />}</View>
        </View>
        {children}
      </SafeAreaView>
    </ThemedView>
  );
}

export function Chip({
  label,
  active,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: active }}
      style={[styles.chip, { borderColor: active ? BrandColors.primary : theme.border, backgroundColor: active ? BrandColors.primary : theme.backgroundElement }]}
    >
      <ThemedText style={[styles.chipText, active && { color: BrandColors.white }]}>{label}</ThemedText>
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  secureTextEntry,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  secureTextEntry?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText style={styles.label}>{label}</ThemedText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        keyboardType={keyboardType}
        multiline={multiline}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        accessibilityLabel={label}
        style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }, multiline && styles.multiline]}
      />
    </View>
  );
}

export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      {children}
    </View>
  );
}

export function ActionButton({
  label,
  onPress,
  loading,
  disabled,
  danger,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  const busy = Boolean(loading || disabled);
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: Boolean(loading), disabled: busy }}
      style={[styles.actionButton, { backgroundColor: danger ? BrandColors.errorSurface : BrandColors.primary }, busy && { opacity: 0.55 }]}
    >
      {loading ? <ActivityIndicator color={danger ? BrandColors.error : BrandColors.white} /> : <ThemedText style={[styles.actionText, danger && { color: BrandColors.error }]}>{label}</ThemedText>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { flex: 1, fontSize: 18 },
  actions: { minWidth: 24, alignItems: "flex-end" },
  headerSpacer: { width: 24 },
  chip: { borderWidth: 1, borderRadius: BorderRadius.full, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 12, lineHeight: 17, fontWeight: "600" },
  field: { gap: Spacing.one },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  input: { borderWidth: 1, borderRadius: BorderRadius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  multiline: { minHeight: 110, textAlignVertical: "top" },
  section: { gap: Spacing.two },
  sectionTitle: { fontSize: 17, lineHeight: 23, fontWeight: "800", marginTop: Spacing.two },
  actionButton: { minHeight: 46, borderRadius: BorderRadius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: Spacing.three, paddingVertical: 11 },
  actionText: { color: BrandColors.white, fontSize: 14, fontWeight: "700" },
});
