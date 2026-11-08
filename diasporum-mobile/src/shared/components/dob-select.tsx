import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { BorderRadius, Spacing } from '@/shared/theme/spacing';
import { MAX_DOB_YEAR, MIN_DOB } from '../utils/date-of-birth';

type Field = 'day' | 'month' | 'year';

interface Option {
  value: number;
  label: string;
}

const MONTHS: Option[] = Array.from({ length: 12 }, (_, i) => ({
  value: i,
  label: new Date(2000, i, 1).toLocaleString(undefined, { month: 'long' }),
}));

function daysIn(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Date-of-birth input as three dropdown fields (day / month / year).
 * Option lists are validity-aware — the year range tops out at
 * current year − 18 (the adult requirement) and impossible day/month
 * combinations (Feb 30, leap years) cannot be picked. Emits `null`
 * while the selection is incomplete so callers keep the action
 * disabled instead of saving a stale date.
 */
export function DobSelect({ value, onChange }: {
  value: Date | null;
  onChange: (date: Date | null) => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState<Field | null>(null);
  const [year, setYear] = useState<number | null>(value?.getFullYear() ?? null);
  const [month, setMonth] = useState<number | null>(value ? value.getMonth() : null);
  const [day, setDay] = useState<number | null>(value?.getDate() ?? null);

  const minYear = MIN_DOB.getFullYear();

  const yearOptions = useMemo<Option[]>(() => {
    const list: Option[] = [];
    for (let y = MAX_DOB_YEAR; y >= minYear; y--) list.push({ value: y, label: String(y) });
    return list;
  }, [minYear]);

  const monthOptions = MONTHS;

  const dayOptions = useMemo<Option[]>(() => {
    const maxDay = year != null && month != null ? daysIn(year, month) : 31;
    return Array.from({ length: maxDay }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
  }, [year, month]);

  const choose = (field: Field, picked: number) => {
    setOpen(null);
    let y = year;
    let m = month;
    let d = day;
    if (field === 'year') y = picked;
    if (field === 'month') m = picked;
    if (field === 'day') d = picked;
    // Clear a now-impossible combination (e.g. 31st of a 30-day month).
    if (y != null && m != null && d != null && d > daysIn(y, m)) d = null;
    setYear(y);
    setMonth(m);
    setDay(d);
    onChange(y != null && m != null && d != null ? new Date(y, m, d) : null);
  };

  const renderField = (field: Field, label: string, selected: string | null, flex: number) => (
    <Pressable
      onPress={() => setOpen(field)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.select, { flex, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <ThemedText numberOfLines={1}
        style={[styles.selectText, !selected && { color: theme.textSecondary }]}>
        {selected ?? label}
      </ThemedText>
      <Ionicons name="chevron-down" size={15} color={theme.textSecondary} />
    </Pressable>
  );

  const options = open === 'year' ? yearOptions : open === 'month' ? monthOptions : dayOptions;
  const optionLabel = (option: Option) =>
    open === 'year' ? `Year: ${option.label}`
    : open === 'month' ? `Month: ${option.label}`
    : `Date: ${option.label}`;

  return (
    <View style={styles.row}>
      {renderField('day', 'Date', day != null ? String(day) : null, 1)}
      {renderField('month', 'Month', month != null ? MONTHS[month].label : null, 1.6)}
      {renderField('year', 'Year', year != null ? String(year) : null, 1.1)}

      <Modal transparent visible={open != null} animationType="fade"
        onRequestClose={() => setOpen(null)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(null)}>
          {/* Inner pressable swallows taps so the card itself doesn't dismiss. */}
          <Pressable onPress={() => {}} style={[styles.card, {
            backgroundColor: theme.backgroundElement, borderColor: theme.border,
          }]}>
            <FlatList
              data={options}
              keyExtractor={item => String(item.value)}
              keyboardShouldPersistTaps="handled"
              // Bounded option sets (≤ ~126 years) — render them all so any
              // option is reachable without scrolling into the window.
              initialNumToRender={options.length}
              renderItem={({ item }) => {
                const active = (open === 'year' && item.value === year)
                  || (open === 'month' && item.value === month)
                  || (open === 'day' && item.value === day);
                return (
                  <Pressable
                    onPress={() => open && choose(open, item.value)}
                    accessibilityRole="button"
                    accessibilityLabel={optionLabel(item)}
                    style={[styles.option, active && { backgroundColor: theme.primarySurface }]}>
                    <ThemedText style={[styles.optionText, active && { color: theme.primary }]}>
                      {item.label}
                    </ThemedText>
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two },
  select: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.three,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  selectText: { fontSize: 15, flexShrink: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    alignSelf: 'stretch',
    maxWidth: 360,
    maxHeight: 340,
    borderRadius: BorderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  option: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  optionText: { fontSize: 15 },
});
