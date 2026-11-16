/**
 * Shared form primitives for shop seller/buyer editing screens: labeled inputs,
 * a searchable country picker modal (single- and multi-select), and a reusable
 * address field block matching the backend AddressInput shape.
 */
import React, { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import type { CountryView } from "@/features/communities/types/community-types";
import type { AddressInput } from "../types/shop-types";

// ------------------------------------------------------------------ inputs

export function FormInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  autoCapitalize,
}: {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 4 }}>
      {label ? (
        <ThemedText type="small" style={{ color: theme.textSecondary }}>{label}</ThemedText>
      ) : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        keyboardType={keyboardType}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        style={[
          styles.input,
          { borderColor: theme.border, color: theme.text },
          multiline && { minHeight: 90, textAlignVertical: "top" },
        ]}
      />
    </View>
  );
}

export function FieldRow({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", gap: 8 }}>{children}</View>;
}

export function FieldCell({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1 }}>{children}</View>;
}

// ------------------------------------------------------------------ country picker

/**
 * Searchable modal listing active countries. `multiple` returns toggled ids in
 * `selected`; single-select calls `onPick` and closes itself.
 */
export function CountryPickerModal({
  visible,
  countries,
  selected,
  multiple,
  onToggle,
  onPick,
  onClose,
}: {
  visible: boolean;
  countries: CountryView[];
  selected: string[];
  multiple?: boolean;
  onToggle?: (countryId: string) => void;
  onPick?: (countryId: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter((c) =>
      c.name.toLowerCase().includes(q) || c.iso2.toLowerCase() === q);
  }, [countries, search]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.pickerRoot, { backgroundColor: theme.background }]}>
        <View style={styles.pickerHeader}>
          <ThemedText type="subtitle" style={{ color: theme.text, flex: 1 }}>
            {multiple ? "Select countries" : "Select country"}
          </ThemedText>
          <Pressable onPress={onClose} accessibilityLabel="Done" hitSlop={8}>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>Done</ThemedText>
          </Pressable>
        </View>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search countries"
          placeholderTextColor={theme.textMuted}
          style={[styles.input, { borderColor: theme.border, color: theme.text, margin: 16, marginTop: 0 }]}
        />
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          contentContainerStyle={{ paddingBottom: insets.bottom + 8 }}
          renderItem={({ item }) => {
            const isSelected = selected.includes(item.id);
            return (
              <Pressable
                onPress={() => (multiple ? onToggle?.(item.id) : (onPick?.(item.id), onClose()))}
                style={({ pressed }) => [
                  styles.countryRow,
                  { borderBottomColor: theme.border },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <ThemedText style={{ color: theme.text, flex: 1 }}>
                  {item.flagEmoji ? `${item.flagEmoji} ` : ""}{item.name}
                </ThemedText>
                {isSelected ? (
                  <Ionicons name="checkmark-circle" size={20} color={theme.primary} />
                ) : (
                  <Ionicons name="ellipse-outline" size={20} color={theme.textMuted} />
                )}
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}

/** Row that opens a single-select country picker and shows the chosen name. */
export function CountryField({
  label,
  countries,
  value,
  onChange,
}: {
  label?: string;
  countries: CountryView[];
  value: string | null;
  onChange: (countryId: string) => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const chosen = countries.find((c) => c.id === value);
  return (
    <View style={{ gap: 4 }}>
      {label ? (
        <ThemedText type="small" style={{ color: theme.textSecondary }}>{label}</ThemedText>
      ) : null}
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.input, styles.selectRow, { borderColor: theme.border }]}
      >
        <ThemedText style={{ color: chosen ? theme.text : theme.textMuted, flex: 1 }}>
          {chosen ? `${chosen.flagEmoji ? chosen.flagEmoji + " " : ""}${chosen.name}` : "Choose country"}
        </ThemedText>
        <Ionicons name="chevron-down" size={16} color={theme.textMuted} />
      </Pressable>
      <CountryPickerModal
        visible={open}
        countries={countries}
        selected={value ? [value] : []}
        onPick={onChange}
        onClose={() => setOpen(false)}
      />
    </View>
  );
}

// ------------------------------------------------------------------ address block

export interface AddressDraft {
  countryId: string | null;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
}

export function emptyAddressDraft(countryId?: string | null): AddressDraft {
  return { countryId: countryId ?? null, line1: "", line2: "", city: "", region: "", postalCode: "" };
}

export function addressDraftToInput(draft: AddressDraft): AddressInput | null {
  if (!draft.countryId || !draft.line1.trim() || !draft.city.trim() || !draft.postalCode.trim()) {
    return null;
  }
  return {
    countryId: draft.countryId,
    line1: draft.line1.trim(),
    line2: draft.line2.trim() || null,
    city: draft.city.trim(),
    region: draft.region.trim() || null,
    postalCode: draft.postalCode.trim(),
  };
}

export function AddressFields({
  draft,
  countries,
  onChange,
}: {
  draft: AddressDraft;
  countries: CountryView[];
  onChange: (patch: Partial<AddressDraft>) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <CountryField label="Country" countries={countries} value={draft.countryId}
        onChange={(countryId) => onChange({ countryId })} />
      <FormInput label="Address line 1" value={draft.line1}
        onChangeText={(line1) => onChange({ line1 })} placeholder="Street and number" />
      <FormInput label="Address line 2 (optional)" value={draft.line2}
        onChangeText={(line2) => onChange({ line2 })} placeholder="Apartment, suite…" />
      <FieldRow>
        <FieldCell>
          <FormInput label="City" value={draft.city}
            onChangeText={(city) => onChange({ city })} />
        </FieldCell>
        <FieldCell>
          <FormInput label="Region / state" value={draft.region}
            onChangeText={(region) => onChange({ region })} />
        </FieldCell>
      </FieldRow>
      <FormInput label="Postal code" value={draft.postalCode}
        onChangeText={(postalCode) => onChange({ postalCode })} autoCapitalize="characters" />
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  selectRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pickerRoot: { flex: 1, paddingTop: 60 },
  pickerHeader: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 12,
  },
  countryRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
