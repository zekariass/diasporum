/**
 * MultiSelectField — dropdown-style multi-choice form field.
 * Tap the field to open a searchable bottom-sheet picker built on SearchableList.
 * Selections are shown as removable chips so large option sets stay usable.
 */
import React, { useMemo, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { SearchableList } from "./searchable-list";
import type { SelectOption } from "./select-field";

export function MultiSelectField({
  label,
  values,
  options,
  onChange,
  placeholder = "Select…",
  modalTitle,
  searchPlaceholder = "Search…",
  inputStyle,
  leadingIcon,
  hint,
  required,
  error,
}: {
  label: string;
  values: string[];
  options: SelectOption[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  modalTitle?: string;
  searchPlaceholder?: string;
  inputStyle?: StyleProp<ViewStyle>;
  leadingIcon?: keyof typeof Ionicons.glyphMap;
  hint?: string;
  required?: boolean;
  error?: string;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const selectedIds = useMemo(() => new Set(values), [values]);
  const selectedOptions = useMemo(
    () => options.filter((option) => selectedIds.has(option.id)),
    [options, selectedIds],
  );

  function toggle(id: string) {
    onChange(
      selectedIds.has(id)
        ? values.filter((value) => value !== id)
        : [...values, id],
    );
  }

  return (
    <View style={styles.field}>
      <ThemedText style={styles.label}>
        {label}
        {required ? (
          <ThemedText style={[styles.label, { color: theme.error }]}>
            {" "}
            *
          </ThemedText>
        ) : null}
      </ThemedText>
      <Pressable
        onPress={() => {
          Keyboard.dismiss();
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={required ? `${label} (required)` : label}
        accessibilityValue={
          selectedOptions.length
            ? { text: `${selectedOptions.length} selected` }
            : undefined
        }
        style={[
          styles.input,
          {
            borderColor: error ? theme.error : theme.border,
            backgroundColor: theme.backgroundElement,
          },
          inputStyle,
        ]}
      >
        {leadingIcon ? (
          <Ionicons name={leadingIcon} size={19} color={theme.textSecondary} />
        ) : null}
        <ThemedText
          style={[
            styles.value,
            !selectedOptions.length && { color: theme.textSecondary },
          ]}
          numberOfLines={1}
        >
          {selectedOptions.length
            ? selectedOptions.map((option) => option.label).join(", ")
            : placeholder}
        </ThemedText>
        {selectedOptions.length ? (
          <View
            style={[styles.countBadge, { backgroundColor: theme.primarySurface }]}
          >
            <ThemedText
              style={[styles.countText, { color: theme.primary }]}
            >
              {selectedOptions.length}
            </ThemedText>
          </View>
        ) : null}
        <Ionicons name="chevron-down" size={16} color={theme.textSecondary} />
      </Pressable>
      {error ? (
        <ThemedText
          style={[styles.hint, { color: theme.error }]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {error}
        </ThemedText>
      ) : hint ? (
        <ThemedText themeColor="textSecondary" style={styles.hint}>
          {hint}
        </ThemedText>
      ) : null}
      {selectedOptions.length ? (
        <View style={styles.chipWrap}>
          {selectedOptions.map((option) => (
            <Pressable
              key={option.id}
              onPress={() => toggle(option.id)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${option.label}`}
              style={({ pressed }) => [
                styles.chip,
                {
                  borderColor: theme.primary,
                  backgroundColor: theme.primarySurface,
                },
                pressed && { opacity: 0.75 },
              ]}
            >
              <ThemedText
                style={[styles.chipText, { color: theme.primary }]}
                numberOfLines={1}
              >
                {option.label}
              </ThemedText>
              <Ionicons name="close" size={14} color={theme.primary} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Pressable
            style={styles.backdrop}
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            accessibilityLabel={`Close ${label} picker`}
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.background,
                borderColor: theme.border,
                paddingBottom: Spacing.three + insets.bottom,
              },
            ]}
          >
            <View style={styles.sheetHeader}>
              <ThemedText style={styles.sheetTitle}>
                {modalTitle ?? label}
              </ThemedText>
              <Pressable
                onPress={() => setOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
              >
                <Ionicons name="close" size={20} color={theme.textSecondary} />
              </Pressable>
            </View>
            <SearchableList
              items={options}
              multiSelect
              selectedIds={selectedIds}
              onSelect={(item) => toggle(item.id)}
              searchPlaceholder={searchPlaceholder}
              listStyle={{ maxHeight: windowHeight * 0.45 }}
            />
            <View style={styles.sheetActions}>
              {values.length ? (
                <Pressable
                  onPress={() => onChange([])}
                  accessibilityRole="button"
                  accessibilityLabel={`Clear all ${label}`}
                  style={[styles.sheetButton, { borderColor: theme.border }]}
                >
                  <ThemedText style={styles.sheetButtonText}>
                    Clear all
                  </ThemedText>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => setOpen(false)}
                accessibilityRole="button"
                accessibilityLabel={`Done ${label}`}
                style={[
                  styles.sheetButton,
                  styles.sheetButtonGrow,
                  { backgroundColor: BrandColors.primary },
                ]}
              >
                <ThemedText
                  style={[styles.sheetButtonText, { color: BrandColors.white }]}
                >
                  Done
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1 },
  field: { gap: Spacing.two },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  hint: { fontSize: 12, lineHeight: 17 },
  input: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: 12,
    minHeight: 43,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  value: { flex: 1, fontSize: 15 },
  countBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.two,
  },
  countText: { fontSize: 12, lineHeight: 16, fontWeight: "800" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  chip: {
    maxWidth: "100%",
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  chipText: { fontSize: 13, lineHeight: 18, fontWeight: "600", flexShrink: 1 },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15,14,23,0.6)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "80%",
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    borderTopWidth: 1,
    paddingTop: Spacing.three,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
    flexShrink: 1,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetTitle: { fontSize: 16, fontWeight: "800" },
  sheetActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  sheetButton: {
    minHeight: 44,
    minWidth: 96,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.three,
  },
  sheetButtonGrow: { flex: 1 },
  sheetButtonText: { fontSize: 14, lineHeight: 19, fontWeight: "700" },
});
