/**
 * SelectField — reusable dropdown for single-choice form fields.
 * Tap the field to open a searchable bottom-sheet picker built on SearchableList.
 */
import React, { useState } from "react";
import {
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
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { SearchableList, type SearchableListItem } from "./searchable-list";

export type SelectOption = SearchableListItem;

export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder = "Select…",
  modalTitle,
  searchPlaceholder = "Search…",
  inputStyle,
  leadingIcon,
  hint,
}: {
  label: string;
  value: string | undefined;
  options: SelectOption[];
  onChange: (id: string) => void;
  placeholder?: string;
  modalTitle?: string;
  searchPlaceholder?: string;
  inputStyle?: StyleProp<ViewStyle>;
  leadingIcon?: keyof typeof Ionicons.glyphMap;
  hint?: string;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value);

  return (
    <View style={styles.field}>
      <ThemedText style={styles.label}>{label}</ThemedText>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={selected ? { text: selected.label } : undefined}
        style={[
          styles.input,
          {
            borderColor: theme.border,
            backgroundColor: theme.backgroundElement,
          },
          inputStyle,
        ]}
      >
        {leadingIcon ? (
          <Ionicons name={leadingIcon} size={19} color={theme.textSecondary} />
        ) : null}
        <ThemedText
          style={[styles.value, !selected && { color: theme.textSecondary }]}
          numberOfLines={1}
        >
          {selected ? selected.label : placeholder}
        </ThemedText>
        <Ionicons name="chevron-down" size={16} color={theme.textSecondary} />
      </Pressable>
      {hint ? (
        <ThemedText themeColor="textSecondary" style={styles.hint}>
          {hint}
        </ThemedText>
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
              selectedId={value}
              onSelect={(item) => {
                onChange(item.id);
                setOpen(false);
              }}
              searchPlaceholder={searchPlaceholder}
              listStyle={{ maxHeight: windowHeight * 0.55 }}
            />
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
    maxHeight: "72%",
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
});
