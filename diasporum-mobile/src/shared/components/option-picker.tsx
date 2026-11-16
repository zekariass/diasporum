/**
 * Single-select dropdown field — a compact row showing the current choice that
 * opens a bottom-sheet picker (optional search, checkmark on the selection).
 * Use instead of inline chip rows when the option list can grow large.
 */
import React, { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";

export interface PickerOption {
  id: string;
  label: string;
}

export function OptionPicker({
  options,
  selectedId,
  onSelect,
  placeholder = "Select…",
  searchable = false,
  disabled = false,
  icon,
  variant = "outline",
}: {
  options: PickerOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  /** "outline" = bordered form field; "soft" = borderless tinted pill. */
  variant?: "outline" | "soft";
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = options.find((o) => o.id === selectedId);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, search]);
  const soft = variant === "soft";

  const close = () => {
    setOpen(false);
    setSearch("");
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        accessibilityRole="combobox"
        accessibilityState={{ expanded: open, disabled }}
        style={({ pressed }) => [
          styles.field,
          soft
            ? { backgroundColor: theme.primarySurface, borderWidth: 0, borderRadius: 12 }
            : { borderColor: theme.border, backgroundColor: theme.backgroundElement },
          pressed && { opacity: 0.75 },
          disabled && { opacity: 0.5 },
        ]}
      >
        {icon ? (
          <View style={[styles.iconChip, { backgroundColor: theme.background }]}>
            <Ionicons name={icon} size={14} color={theme.primary} />
          </View>
        ) : null}
        <ThemedText
          style={{
            color: selected
              ? soft
                ? theme.primaryDark
                : theme.text
              : theme.textMuted,
            flex: 1,
            ...(soft && selected ? { fontWeight: "600" as const } : null),
          }}
          numberOfLines={1}
        >
          {selected?.label ?? placeholder}
        </ThemedText>
        <Ionicons
          name="chevron-down"
          size={16}
          color={soft ? theme.primary : theme.textMuted}
        />
      </Pressable>

      <Modal visible={open} animationType="slide" transparent
        onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={[styles.sheet,
          { backgroundColor: theme.background, paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.grabber} />
          {searchable ? (
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search…"
              placeholderTextColor={theme.textMuted}
              autoFocus
              style={[styles.search, { borderColor: theme.border, color: theme.text }]}
            />
          ) : null}
          <FlatList
            data={filtered}
            keyExtractor={(o) => o.id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="none"
            style={styles.list}
            renderItem={({ item }) => {
              const isSelected = item.id === selectedId;
              return (
                <Pressable
                  onPress={() => { onSelect(item.id); close(); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  style={({ pressed }) => [
                    styles.row,
                    { borderBottomColor: theme.border },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <ThemedText style={{ color: theme.text, flex: 1 }}>
                    {item.label}
                  </ThemedText>
                  {isSelected ? (
                    <Ionicons name="checkmark" size={18} color={theme.primary} />
                  ) : null}
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <ThemedText style={[styles.empty, { color: theme.textSecondary }]}>
                Nothing found.
              </ThemedText>
            }
          />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11,
  },
  iconChip: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: "center", justifyContent: "center",
  },
  backdrop: { flex: 1, backgroundColor: "#00000066" },
  sheet: {
    maxHeight: "65%",
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
  },
  grabber: {
    alignSelf: "center", width: 36, height: 4, borderRadius: 2,
    backgroundColor: "#00000022", marginTop: 8, marginBottom: 4,
  },
  search: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9,
    marginHorizontal: 16, marginVertical: 8,
  },
  list: { flexGrow: 0 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  empty: { textAlign: "center", paddingVertical: 24 },
});
