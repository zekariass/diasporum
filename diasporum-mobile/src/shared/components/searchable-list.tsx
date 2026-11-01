/**
 * Generic searchable list picker — used for countries, languages, communities.
 * Renders a search input + filtered list with selection state.
 * No data hardcoding — caller supplies items and renderItem.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { BrandColors } from '@/shared/theme/colors';
import { BorderRadius, Spacing } from '@/shared/theme/spacing';
import { LoadingScreen } from './loading-screen';
import { ErrorState } from './error-state';

export interface SearchableListItem {
  readonly id: string;
  readonly label: string;
  readonly sublabel?: string;
  readonly emoji?: string;
  readonly selected?: boolean;
}

interface SearchableListProps {
  items: SearchableListItem[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onSelect: (item: SearchableListItem) => void;
  selectedId?: string | null;
  multiSelect?: boolean;
  selectedIds?: Set<string>;
  searchPlaceholder?: string;
  emptyLabel?: string;
  renderItem?: (item: SearchableListItem) => React.ReactNode;
}

export function SearchableList({
  items,
  loading = false,
  error = null,
  onRetry,
  onSelect,
  selectedId,
  multiSelect = false,
  selectedIds = new Set(),
  searchPlaceholder = 'Search…',
  emptyLabel = 'No results found',
  renderItem,
}: SearchableListProps) {
  const theme = useTheme();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.sublabel?.toLowerCase().includes(q)
    );
  }, [items, query]);

  const isSelected = useCallback(
    (item: SearchableListItem) =>
      multiSelect ? selectedIds.has(item.id) : selectedId === item.id,
    [multiSelect, selectedIds, selectedId]
  );

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;

  return (
    <View style={styles.container}>
      <View style={[styles.searchWrap, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={searchPlaceholder}
          placeholderTextColor={theme.textSecondary}
          style={[styles.searchInput, { color: theme.text }]}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={searchPlaceholder}
          clearButtonMode="while-editing"
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <ThemedText style={styles.empty} themeColor="textSecondary">
            {emptyLabel}
          </ThemedText>
        }
        renderItem={({ item }) =>
          renderItem ? (
            <>{renderItem(item)}</>
          ) : (
            <DefaultRow
              item={item}
              selected={isSelected(item)}
              onPress={() => onSelect(item)}
            />
          )
        }
      />
    </View>
  );
}

function DefaultRow({
  item,
  selected,
  onPress,
}: {
  item: SearchableListItem;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={item.label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.row,
        { borderColor: theme.border },
        selected && { backgroundColor: BrandColors.primarySurface, borderColor: BrandColors.primary },
        pressed && styles.rowPressed,
      ]}>
      {item.emoji ? (
        <ThemedText style={styles.emoji}>{item.emoji}</ThemedText>
      ) : null}
      <View style={styles.rowText}>
        <ThemedText style={[styles.rowLabel, selected && { color: BrandColors.primary }]}>
          {item.label}
        </ThemedText>
        {item.sublabel ? (
          <ThemedText style={styles.rowSub} themeColor="textSecondary">
            {item.sublabel}
          </ThemedText>
        ) : null}
      </View>
      {selected ? (
        <ThemedText style={[styles.check, { color: BrandColors.primary }]}>✓</ThemedText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: Spacing.two },
  searchWrap: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: 2,
  },
  searchInput: {
    fontSize: 15,
    paddingVertical: Spacing.two,
    minHeight: 40,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    gap: Spacing.two,
    minHeight: 52,
  },
  rowPressed: { opacity: 0.7 },
  emoji: { fontSize: 22 },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  rowSub: { fontSize: 12 },
  check: { fontSize: 18, fontWeight: '700' },
  empty: { textAlign: 'center', marginTop: Spacing.four },
});
