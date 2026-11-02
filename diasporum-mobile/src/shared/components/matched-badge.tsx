import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/themed-text';
import { BrandColors } from '@/shared/theme/colors';

export function MatchedBadge({ compact = false }: { compact?: boolean }) {
  return (
    <View
      style={[styles.badge, compact && styles.compact]}
      accessibilityLabel="Matched"
      testID="matched-badge"
    >
      <Ionicons name="heart" size={compact ? 10 : 12} color={BrandColors.primaryDark} />
      <ThemedText style={[styles.label, compact && styles.compactLabel]}>Matched</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: BrandColors.primarySurface, borderRadius: 999,
    paddingHorizontal: 9, paddingVertical: 5, alignSelf: 'flex-start',
  },
  compact: { paddingHorizontal: 7, paddingVertical: 3, gap: 3 },
  label: { color: BrandColors.primaryDark, fontSize: 12, lineHeight: 15, fontWeight: '700' },
  compactLabel: { fontSize: 10, lineHeight: 12 },
});
