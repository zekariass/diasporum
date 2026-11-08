import React, { useState } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import { PrimaryButton } from "@/shared/components/primary-button";
import { Sheet } from "@/shared/components/sheet";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import type { Category, DiscoveryFilters, DiscoverySort } from "../types/spare-bag-types";
import { DateField } from "./form-controls";
import { formatShortDate } from "./spare-bag-ui";

/** Explains how Spare Bag works — passenger offers vs sender requests. */
export function InfoSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const rows: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
    {
      icon: "airplane-outline",
      title: "Passenger Offers",
      body: "Travellers publish spare luggage capacity on a route and date, with an asking price per kg or per parcel.",
    },
    {
      icon: "cube-outline",
      title: "Sender Requests",
      body: "Members list parcels they need carried — route, preferred dates, estimated weight, and an optional maximum budget.",
    },
    {
      icon: "chatbubbles-outline",
      title: "Contact requests",
      body: "Send a contact request from a listing to agree details privately. An accepted request opens a conversation — it does not mean the parcel is booked or guaranteed to be carried.",
    },
    {
      icon: "shield-checkmark-outline",
      title: "Travel safely",
      body: "Declare contents truthfully and never carry restricted, undeclared, or unknown items. Private addresses and phone numbers are only shared inside an accepted contact request.",
    },
  ];
  return (
    <Sheet visible={visible} title="How Spare Bag works" onClose={onClose}>
      <View style={styles.infoList}>
        {rows.map((row) => (
          <View key={row.title} style={styles.infoRow}>
            <View style={[styles.infoIcon, { backgroundColor: theme.primarySurface }]}>
              <Ionicons name={row.icon} size={20} color={theme.primary} />
            </View>
            <View style={styles.infoCopy}>
              <ThemedText type="smallBold">{row.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{row.body}</ThemedText>
            </View>
          </View>
        ))}
      </View>
    </Sheet>
  );
}

const SORT_OPTIONS: { value: DiscoverySort; label: string; description: string }[] = [
  { value: "TRAVEL_DATE", label: "Travel Date", description: "Soonest departing first" },
  { value: "NEWEST", label: "Newest", description: "Most recently published first" },
];

export function sortLabel(sort: DiscoverySort): string {
  return SORT_OPTIONS.find((option) => option.value === sort)?.label ?? "Travel Date";
}

/** Real server-side sort selection — both options map to API ordering. */
export function SortSheet({
  visible,
  value,
  onApply,
  onClose,
}: {
  visible: boolean;
  value: DiscoverySort;
  onApply: (sort: DiscoverySort) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  return (
    <Sheet visible={visible} title="Sort listings" onClose={onClose}>
      <View style={styles.optionList}>
        {SORT_OPTIONS.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={`Sort by ${option.label}`}
            accessibilityState={{ selected: option.value === value }}
            onPress={() => { onApply(option.value); onClose(); }}
            style={[styles.option, { borderColor: option.value === value ? theme.primary : theme.border, backgroundColor: option.value === value ? theme.primarySurface : theme.background }]}
          >
            <View style={styles.optionCopy}>
              <ThemedText type="smallBold" style={{ color: option.value === value ? theme.primary : theme.text }}>{option.label}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{option.description}</ThemedText>
            </View>
            {option.value === value ? <Ionicons name="checkmark-circle" size={20} color={theme.primary} /> : null}
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

/** Travel date range — backed by the real dateFrom/dateTo API filters.
 * Draft state lives in the inner form, which remounts on every open. */
export function DateRangeSheet({
  visible,
  dateFrom,
  dateTo,
  onApply,
  onClose,
}: {
  visible: boolean;
  dateFrom?: string;
  dateTo?: string;
  onApply: (dateFrom?: string, dateTo?: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} title="Travel dates" onClose={onClose}>
      <DateRangeForm dateFrom={dateFrom} dateTo={dateTo} onApply={onApply} onClose={onClose} />
    </Sheet>
  );
}

function DateRangeForm({ dateFrom, dateTo, onApply, onClose }: {
  dateFrom?: string;
  dateTo?: string;
  onApply: (dateFrom?: string, dateTo?: string) => void;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(dateFrom ?? "");
  const [to, setTo] = useState(dateTo ?? "");
  return (
    <>
      <DateField label="Travelling from" value={from} onChange={setFrom} optional />
      <DateField label="Travelling until" value={to} onChange={setTo} optional />
      <View style={styles.sheetActions}>
        <PrimaryButton label="Clear dates" variant="ghost" onPress={() => { onApply(undefined, undefined); onClose(); }} />
        <PrimaryButton label="Apply dates" onPress={() => { onApply(from || undefined, to || undefined); onClose(); }} />
      </View>
    </>
  );
}

/** Single numeric filter (capacity, weight, price, or budget). */
export function NumberFilterSheet({
  visible,
  title,
  hint,
  value,
  onApply,
  onClose,
}: {
  visible: boolean;
  title: string;
  hint: string;
  value?: string;
  onApply: (value?: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <NumberFilterForm title={title} hint={hint} value={value} onApply={onApply} onClose={onClose} />
    </Sheet>
  );
}

function NumberFilterForm({ title, hint, value, onApply, onClose }: {
  title: string;
  hint: string;
  value?: string;
  onApply: (value?: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState(value ?? "");
  return (
    <>
      <ThemedText type="small" themeColor="textSecondary">{hint}</ThemedText>
      <TextInput
        accessibilityLabel={title}
        value={draft}
        onChangeText={setDraft}
        placeholder="0"
        placeholderTextColor={theme.textSecondary}
        keyboardType="decimal-pad"
        style={[styles.numberInput, { borderColor: theme.border, backgroundColor: theme.background, color: theme.text }]}
      />
      <View style={styles.sheetActions}>
        <PrimaryButton label="Clear" variant="ghost" onPress={() => { onApply(undefined); onClose(); }} />
        <PrimaryButton label="Apply" onPress={() => { onApply(draft.trim() || undefined); onClose(); }} />
      </View>
    </>
  );
}

/** Full filter sheet — all server-side filters relevant to the active tab. */
export function FiltersSheet({
  visible,
  sender,
  filters,
  categories,
  onApply,
  onClose,
}: {
  visible: boolean;
  sender: boolean;
  filters: DiscoveryFilters;
  categories: Category[];
  onApply: (filters: DiscoveryFilters) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} title="Filters" onClose={onClose}>
      <FiltersForm sender={sender} filters={filters} categories={categories} onApply={onApply} onClose={onClose} />
    </Sheet>
  );
}

function FiltersForm({ sender, filters, categories, onApply, onClose }: {
  sender: boolean;
  filters: DiscoveryFilters;
  categories: Category[];
  onApply: (filters: DiscoveryFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DiscoveryFilters>(filters);

  function patch(value: Partial<DiscoveryFilters>) {
    setDraft((current) => ({ ...current, ...value }));
  }

  return (
    <>
      <ThemedText type="smallBold">Travel dates</ThemedText>
      <View style={styles.datePair}>
        <View style={styles.flex}><DateField label="From" value={draft.dateFrom ?? ""} onChange={(dateFrom) => patch({ dateFrom: dateFrom || undefined })} optional /></View>
        <View style={styles.flex}><DateField label="To" value={draft.dateTo ?? ""} onChange={(dateTo) => patch({ dateTo: dateTo || undefined })} optional /></View>
      </View>
      {sender ? (
        <NumberField label="Maximum parcel weight (kg)" value={draft.maxWeightKg} onChange={(maxWeightKg) => patch({ maxWeightKg })} />
      ) : (
        <NumberField label="Minimum capacity (kg)" value={draft.minimumCapacityKg} onChange={(minimumCapacityKg) => patch({ minimumCapacityKg })} />
      )}
      <NumberField label={sender ? "Maximum budget" : "Maximum price"} value={draft.maxPrice} onChange={(maxPrice) => patch({ maxPrice })} />
      <CurrencyField value={draft.priceCurrency} onChange={(priceCurrency) => patch({ priceCurrency })} />
      {categories.length ? (
        <View style={styles.categoryGroup}>
          <ThemedText type="smallBold">Parcel category</ThemedText>
          <View style={styles.categoryWrap}>
            <CategoryChip label="All categories" selected={!draft.categoryKey} onPress={() => patch({ categoryKey: undefined })} />
            {categories.map((category) => (
              <CategoryChip key={category.key} label={category.displayName} selected={draft.categoryKey === category.key} onPress={() => patch({ categoryKey: draft.categoryKey === category.key ? undefined : category.key })} />
            ))}
          </View>
        </View>
      ) : null}
      <View style={styles.sheetActions}>
        <PrimaryButton
          label="Clear all filters"
          variant="ghost"
          onPress={() => onApply({ listingType: filters.listingType })}
        />
        <PrimaryButton label="Apply filters" onPress={() => { onApply(draft); onClose(); }} />
      </View>
    </>
  );
}

function NumberField({ label, value, onChange }: { label: string; value?: string; onChange: (value?: string) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.numberField}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        value={value ?? ""}
        onChangeText={(text) => onChange(text.trim() || undefined)}
        placeholder="Any"
        placeholderTextColor={theme.textSecondary}
        keyboardType="decimal-pad"
        style={[styles.numberInput, { borderColor: theme.border, backgroundColor: theme.background, color: theme.text }]}
      />
    </View>
  );
}

function CurrencyField({ value, onChange }: { value?: string; onChange: (value?: string) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.numberField}>
      <ThemedText type="smallBold">Price currency</ThemedText>
      <TextInput
        accessibilityLabel="Price currency"
        value={value ?? ""}
        onChangeText={(text) => onChange(text.trim().toUpperCase() || undefined)}
        placeholder="Any"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="characters"
        maxLength={3}
        style={[styles.numberInput, { borderColor: theme.border, backgroundColor: theme.background, color: theme.text }]}
      />
    </View>
  );
}

function CategoryChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.categoryChip, { borderColor: selected ? theme.primary : theme.border, backgroundColor: selected ? theme.primarySurface : theme.background }]}
    >
      <ThemedText type="small" style={{ color: selected ? theme.primary : theme.text }}>{label}</ThemedText>
    </Pressable>
  );
}

/** "+ Create a Listing" chooser — routes into the two existing editor flows. */
export function CreateListingSheet({ visible, onSelect, onClose }: {
  visible: boolean;
  onSelect: (type: "PASSENGER_OFFER" | "SENDER_REQUEST") => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const options = [
    {
      type: "SENDER_REQUEST" as const,
      icon: "cube-outline" as const,
      title: "Send a Parcel",
      body: "Find a traveller who can carry your parcel.",
    },
    {
      type: "PASSENGER_OFFER" as const,
      icon: "airplane-outline" as const,
      title: "I Have Free Space",
      body: "Offer spare room in your luggage on an upcoming trip.",
    },
  ];
  return (
    <Sheet visible={visible} title="Create a Listing" onClose={onClose}>
      <View style={styles.optionList}>
        {options.map((option) => (
          <Pressable
            key={option.type}
            accessibilityRole="button"
            accessibilityLabel={option.title}
            onPress={() => { onClose(); onSelect(option.type); }}
            style={[styles.option, { borderColor: theme.border, backgroundColor: theme.background }]}
          >
            <View style={[styles.infoIcon, { backgroundColor: theme.primarySurface }]}>
              <Ionicons name={option.icon} size={20} color={theme.primary} />
            </View>
            <View style={styles.optionCopy}>
              <ThemedText type="smallBold">{option.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{option.body}</ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

/** Compact label for the date filter chip. */
export function dateRangeLabel(dateFrom?: string, dateTo?: string): string {
  if (!dateFrom && !dateTo) return "Date";
  if (dateFrom && dateTo) return `${formatShortDate(dateFrom)} – ${formatShortDate(dateTo)}`;
  if (dateFrom) return `From ${formatShortDate(dateFrom)}`;
  return `Until ${formatShortDate(dateTo as string)}`;
}

const styles = StyleSheet.create({
  infoList: { gap: Spacing.three },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.three },
  infoIcon: { width: 38, height: 38, borderRadius: BorderRadius.full, alignItems: "center", justifyContent: "center" },
  infoCopy: { flex: 1, gap: 2 },
  optionList: { gap: Spacing.two },
  option: { flexDirection: "row", alignItems: "center", gap: Spacing.three, borderWidth: 1, borderRadius: BorderRadius.lg, padding: Spacing.three },
  optionCopy: { flex: 1, gap: 2 },
  datePair: { flexDirection: "row", gap: Spacing.two },
  flex: { flex: 1 },
  sheetActions: { flexDirection: "row", justifyContent: "flex-end", gap: Spacing.two, marginTop: Spacing.two },
  numberField: { gap: Spacing.two },
  numberInput: { minHeight: 48, borderWidth: 1, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.three, fontSize: 16 },
  categoryGroup: { gap: Spacing.two },
  categoryWrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  categoryChip: { borderWidth: 1, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
});
