import React from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { BorderRadius, Spacing } from '@/shared/theme/spacing';
import type { Choice } from '../types/matchmaking-options';
import type { ReferenceOption } from '../types/matchmaking-types';

export function ScreenHeader({ title, subtitle, back = true, action }: {
  title: string;
  subtitle?: string;
  back?: boolean;
  action?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.header, { borderBottomColor: theme.border }]}>
      {back ? (
        <Pressable onPress={() => router.back()} style={styles.back}
          accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={25} color={theme.text} />
        </Pressable>
      ) : null}
      <View style={styles.headerCopy}>
        <ThemedText type="title" style={styles.headerTitle}>{title}</ThemedText>
        {subtitle ? <ThemedText type="small" themeColor="textSecondary">{subtitle}</ThemedText> : null}
      </View>
      {action}
    </View>
  );
}

export function Section({ title, hint, children }: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <ThemedText type="subtitle">{title}</ThemedText>
      {hint ? <ThemedText type="small" themeColor="textSecondary">{hint}</ThemedText> : null}
      {children}
    </View>
  );
}

export function ChoiceChips({ label, choices, value, onChange, multi = false, required = false }: {
  label: string;
  choices: (Choice | ReferenceOption)[];
  value: string | null | string[];
  onChange: (value: string | null | string[]) => void;
  multi?: boolean;
  required?: boolean;
}) {
  const theme = useTheme();
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const choose = (next: string) => {
    if (multi) {
      onChange(selected.includes(next)
        ? selected.filter(item => item !== next)
        : [...selected, next]);
    } else {
      onChange(selected.includes(next) && !required ? null : next);
    }
  };
  return (
    <View style={styles.field} accessibilityLabel={label}>
      <ThemedText style={styles.label}>{label}{required ? ' *' : ''}</ThemedText>
      <View style={styles.chips}>
        {choices.map(choice => {
          const choiceValue = 'value' in choice ? choice.value : choice.id;
          const active = selected.includes(choiceValue);
          return (
            <Pressable key={choiceValue} onPress={() => choose(choiceValue)}
              accessibilityRole="button" accessibilityState={{ selected: active }}
              accessibilityLabel={`${label}: ${choice.label}`}
              style={[styles.chip, {
                backgroundColor: active ? theme.primary : theme.backgroundElement,
                borderColor: active ? theme.primary : theme.border,
              }]}>
              <ThemedText style={[styles.chipText, active && styles.selectedChipText]}>
                {choice.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ToggleRow({ label, hint, value, onChange, disabled = false }: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleCopy}>
        <ThemedText style={styles.toggleLabel}>{label}</ThemedText>
        {hint ? <ThemedText type="small" themeColor="textSecondary">{hint}</ThemedText> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled}
        trackColor={{ false: theme.border, true: theme.primary }}
        accessibilityLabel={label} />
    </View>
  );
}

export function ProfilePhoto({ uri, name, size = 88 }: {
  uri: string | null;
  name: string;
  size?: number;
}) {
  const theme = useTheme();
  const style = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return <Image source={{ uri }} style={style} contentFit="cover"
      accessibilityLabel={`${name} profile photo`} transition={150} />;
  }
  return (
    <View style={[style, styles.photoPlaceholder, { backgroundColor: theme.primarySurface }]}
      accessibilityLabel={`${name} photo hidden`}>
      <Ionicons name="person" size={size * 0.45} color={theme.primary} />
    </View>
  );
}

export function EmptyState({ title, body, icon = 'heart-outline', action }: {
  title: string;
  body: string;
  icon?: keyof typeof Ionicons.glyphMap;
  action?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.primarySurface }]}>
        <Ionicons name={icon} size={30} color={theme.primary} />
      </View>
      <ThemedText type="subtitle" style={styles.centerText}>{title}</ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.centerText}>{body}</ThemedText>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    paddingHorizontal: Spacing.three, paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { padding: Spacing.one },
  headerCopy: { flex: 1 },
  headerTitle: { fontSize: 25, lineHeight: 31 },
  section: { gap: Spacing.three },
  field: { gap: Spacing.two },
  label: { fontSize: 14, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderWidth: 1, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.three, paddingVertical: 9 },
  chipText: { fontSize: 13, lineHeight: 17 },
  selectedChipText: { color: '#fff', fontWeight: '700' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  toggleCopy: { flex: 1, gap: 3 },
  toggleLabel: { fontSize: 15, fontWeight: '600' },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', justifyContent: 'center', padding: Spacing.five, gap: Spacing.three, flexGrow: 1 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
});
