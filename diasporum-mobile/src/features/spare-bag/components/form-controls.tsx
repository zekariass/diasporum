import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { Field } from "@/shared/components/form-controls";
import type { Airport } from "../types/spare-bag-types";

export {
  ChoiceChip,
  DateField,
  Field,
  FormInput,
  SegmentedControl,
  StepProgress,
} from "@/shared/components/form-controls";

/** Searchable airport picker modal shared by the labelled form field and the
 * compact dashboard route selector. */
export function AirportPickerModal({
  visible,
  title,
  airports,
  selectedId,
  allowAny = false,
  onSearch,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  airports: Airport[];
  selectedId: string;
  allowAny?: boolean;
  onSearch?: (query: string) => Promise<Airport[]>;
  onSelect: (airport: Airport | null) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Airport[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    const timer = setTimeout(() => {
      if (onSearch && query.trim()) {
        setSearching(true);
        onSearch(query.trim())
          .then((items) => { if (active) setResults(items); })
          .catch(() => { if (active) setResults([]); })
          .finally(() => { if (active) setSearching(false); });
      } else {
        setResults([]);
        setSearching(false);
      }
    }, query.trim() ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [visible, onSearch, query]);

  const options = useMemo(() => {
    if (query.trim() && onSearch) return results;
    const normalized = query.trim().toLowerCase();
    if (!normalized) return airports;
    return airports.filter((airport) => [airport.name, airport.city, airport.iataCode, airport.countryName]
      .some((part) => part.toLowerCase().includes(normalized)));
  }, [airports, onSearch, query, results]);

  function close() {
    setQuery("");
    setResults([]);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={[styles.modal, { backgroundColor: theme.background }]}>
        <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
          <View>
            <ThemedText style={styles.modalTitle}>{title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">Search by airport, city, code, or country</ThemedText>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Close ${title}`} onPress={close} style={styles.closeButton}>
            <Ionicons name="close" size={24} color={theme.text} />
          </Pressable>
        </View>
        <View style={[styles.search, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <Ionicons name="search" size={19} color={theme.textSecondary} />
          <TextInput
            accessibilityLabel={`Search ${title}`}
            value={query}
            onChangeText={setQuery}
            placeholder="Airport, city, IATA, or country"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            style={[styles.searchInput, { color: theme.text }]}
          />
          {searching ? <ActivityIndicator size="small" color={theme.primary} /> : null}
        </View>
        <FlatList
          data={options}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.airportList}
          ListHeaderComponent={allowAny && !query ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`${title}: any`} onPress={() => { onSelect(null); close(); }} style={styles.airportOption}>
              <ThemedText type="smallBold">Any airport</ThemedText>
            </Pressable>
          ) : undefined}
          ListEmptyComponent={!searching ? <ThemedText themeColor="textSecondary" style={styles.noResults}>No airports found. Try a city, country, or IATA code.</ThemedText> : undefined}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.iataCode} — ${item.city}`}
              accessibilityState={{ selected: selectedId === item.id }}
              onPress={() => { onSelect(item); close(); }}
              style={[styles.airportOption, selectedId === item.id && { backgroundColor: theme.primarySurface }]}
            >
              <View style={[styles.iata, { backgroundColor: theme.primarySurface }]}>
                <ThemedText type="smallBold" style={{ color: theme.primary }}>{item.iataCode}</ThemedText>
              </View>
              <View style={styles.selectorCopy}>
                <ThemedText type="smallBold" numberOfLines={2}>{item.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{item.city}, {item.countryName}</ThemedText>
              </View>
              {selectedId === item.id ? <Ionicons name="checkmark-circle" size={21} color={theme.primary} /> : null}
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

export function AirportField({
  label,
  airports,
  value,
  onChange,
  onSearch,
  required = true,
}: {
  label: string;
  airports: Airport[];
  value: string;
  onChange: (id: string) => void;
  onSearch?: (query: string) => Promise<Airport[]>;
  required?: boolean;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [searched, setSearched] = useState<Airport[]>([]);
  const selected = airports.find((airport) => airport.id === value)
    ?? searched.find((airport) => airport.id === value);

  const searchAndRemember = useMemo(() => onSearch ? async (query: string) => {
    const items = await onSearch(query);
    setSearched((current) => {
      const known = new Set(current.map((airport) => airport.id));
      return [...current, ...items.filter((airport) => !known.has(airport.id))];
    });
    return items;
  } : undefined, [onSearch]);

  return (
    <Field label={label}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={selected ? `${label}: ${selected.iataCode} — ${selected.city}` : `${label}: choose`}
        onPress={() => setOpen(true)}
        style={[styles.selector, { backgroundColor: theme.background, borderColor: theme.border }]}
      >
        <View style={[styles.selectorIcon, { backgroundColor: theme.primarySurface }]}>
          <Ionicons name="airplane-outline" size={19} color={theme.primary} />
        </View>
        <View style={styles.selectorCopy}>
          <ThemedText type="smallBold" numberOfLines={1} style={!selected ? { color: theme.textSecondary } : undefined}>
            {selected ? `${selected.iataCode} · ${selected.name}` : required ? "Search airports" : "Any airport"}
          </ThemedText>
          {selected ? <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{selected.city}, {selected.countryName}</ThemedText> : null}
        </View>
        <Ionicons name="chevron-down" size={18} color={theme.textSecondary} />
      </Pressable>
      <AirportPickerModal
        visible={open}
        title={label}
        airports={airports}
        selectedId={value}
        allowAny={!required}
        onSearch={searchAndRemember}
        onSelect={(airport) => onChange(airport?.id ?? "")}
        onClose={() => setOpen(false)}
      />
    </Field>
  );
}

const styles = StyleSheet.create({
  selector: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: Spacing.two, borderWidth: 1, borderRadius: BorderRadius.md, padding: Spacing.two },
  selectorIcon: { width: 42, height: 42, borderRadius: BorderRadius.md, alignItems: "center", justifyContent: "center" },
  selectorCopy: { flex: 1, minWidth: 0, gap: 2 },
  modal: { flex: 1, paddingTop: Spacing.six },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.two, padding: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  modalTitle: { fontSize: 20, lineHeight: 26, fontWeight: "700" },
  closeButton: { padding: Spacing.two },
  search: { flexDirection: "row", alignItems: "center", gap: Spacing.two, margin: Spacing.three, borderWidth: 1, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.three },
  searchInput: { flex: 1, minHeight: 48, fontSize: 16 },
  airportList: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.one },
  airportOption: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: Spacing.three, borderRadius: BorderRadius.md, padding: Spacing.two },
  iata: { width: 50, minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: BorderRadius.md, padding: Spacing.one },
  noResults: { textAlign: "center", padding: Spacing.four },
});
