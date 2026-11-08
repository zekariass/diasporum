import React, { useEffect, useState } from 'react';
import {
  Animated, Pressable, StyleSheet, Switch, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { BorderRadius, Spacing } from '@/shared/theme/spacing';
import type { Choice } from '../types/matchmaking-options';
import type { ReferenceOption } from '../types/matchmaking-types';

type IconName = keyof typeof Ionicons.glyphMap;

/** Option shape shared by the wizard pickers — icon is a decorative aid. */
export interface WizardOption {
  value: string;
  label: string;
  icon?: IconName;
  hint?: string;
}

/**
 * Dating onboarding chrome. The five large segments represent product stages;
 * an optional dot track represents questions inside the current stage.
 */
export function WizardHeader({
  step,
  total,
  title,
  icon,
  onBack,
  subStep,
  subTotal,
  showBrand = false,
}: {
  step: number;
  total: number;
  title: string;
  icon: IconName;
  onBack: () => void;
  subStep?: number;
  subTotal?: number;
  showBrand?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <View style={styles.headerSide}>
          {showBrand ? (
            <View style={styles.brand} accessibilityLabel="Diasporum Dating">
              <Ionicons name="heart" size={18} color={theme.primary} />
              <ThemedText style={styles.brandLabel}>Dating</ThemedText>
            </View>
          ) : (
            <Pressable onPress={onBack} hitSlop={8}
              accessibilityRole="button" accessibilityLabel="Back"
              style={({ pressed }) => [
                styles.backButton, { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}>
              <Ionicons name="chevron-back" size={20} color={theme.text} />
            </Pressable>
          )}
        </View>
        <View style={styles.stageHeading}>
          <Ionicons name={icon} size={17} color={theme.primary} />
          <ThemedText style={styles.stageTitle} numberOfLines={1}>{title}</ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
          {step + 1} of {total}
        </ThemedText>
      </View>
      <View style={styles.segments} accessibilityRole="progressbar"
        accessibilityLabel={`Step ${step + 1} of ${total}`}
        accessibilityValue={{ min: 0, max: total, now: step + 1 }}>
        {Array.from({ length: total }, (_, index) => (
          <View key={index} style={[
            styles.segment,
            index === step && styles.segmentCurrent,
            { backgroundColor: index <= step ? theme.primary : theme.backgroundElement },
          ]} />
        ))}
      </View>
      {subStep != null && subTotal != null ? (
        <View style={styles.subProgress} accessibilityRole="progressbar"
          accessibilityLabel={`Profile question ${subStep + 1} of ${subTotal}`}
          accessibilityValue={{ min: 0, max: subTotal, now: subStep + 1 }}>
          {Array.from({ length: subTotal }, (_, index) => (
            <View key={index} style={[styles.subSegment, {
              backgroundColor: index <= subStep ? theme.primary : theme.backgroundElement,
            }]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Question block at the top of every step: accent icon chip, large readable
 * question text and a short helpful description.
 */
export function StepQuestion({ icon, title, description }: {
  icon: IconName;
  title: string;
  description?: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.question}>
      <View style={[styles.questionIcon, { backgroundColor: theme.primarySurface }]}
        accessibilityElementsHidden importantForAccessibility="no">
        <Ionicons name={icon} size={24} color={theme.primary} />
      </View>
      <ThemedText style={styles.questionTitle}>{title}</ThemedText>
      {description ? (
        <ThemedText style={styles.questionDescription} themeColor="textSecondary">
          {description}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** Completion artwork used after preferences have been saved and previewed. */
export function CompletionHero() {
  const theme = useTheme();
  return (
    <View style={styles.completionHero} accessibilityElementsHidden
      importantForAccessibility="no">
      <View style={[styles.completionRing, styles.completionRingOuter,
        { backgroundColor: theme.primarySurface }]} />
      <View style={[styles.completionRing, styles.completionRingInner,
        { backgroundColor: theme.primarySurface }]} />
      <View style={[styles.completionCheck, { backgroundColor: theme.primary }]}>
        <Ionicons name="checkmark" size={54} color="#fff" />
      </View>
    </View>
  );
}

/** Small label heading used above each question inside a two-question step. */
export function FieldLabel({ label, required = false }: { label: string; required?: boolean }) {
  return (
    <ThemedText style={styles.fieldLabel}>
      {label}{required ? ' *' : ''}
    </ThemedText>
  );
}

/**
 * Large visual selection card — used for gender and relationship intention.
 * The whole card is the touch target; selection shows a filled accent,
 * stronger border and a check badge.
 */
export function OptionCard({ icon, label, hint, selected, onPress, accessibilityLabel }: {
  icon: IconName;
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: selected ? theme.primarySurface : theme.backgroundElement,
          borderColor: selected ? theme.primary : theme.border,
        },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.cardIcon, {
        backgroundColor: selected ? theme.primary : theme.background,
      }]}>
        <Ionicons name={icon} size={26}
          color={selected ? '#fff' : theme.primary} />
      </View>
      <ThemedText style={[styles.cardLabel, selected && { color: theme.primary }]}>
        {label}
      </ThemedText>
      {hint ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.cardHint}>
          {hint}
        </ThemedText>
      ) : null}
      {selected ? (
        <View style={[styles.cardCheck, { backgroundColor: theme.primary }]}>
          <Ionicons name="checkmark" size={12} color="#fff" />
        </View>
      ) : null}
    </Pressable>
  );
}

/** Two-column grid for OptionCards; the last odd card stretches full width. */
export function OptionGrid({ children }: { children: React.ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

export function GridItem({ children, wide = false }: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return <View style={[styles.gridItem, wide && styles.gridItemWide]}>{children}</View>;
}

/**
 * Single-select list of full-width rows with a leading icon (optional) and a
 * trailing check — used for longer enum questions where chips feel cramped.
 */
export function OptionRows({ label, options, value, onChange, required = false }: {
  label: string;
  options: (WizardOption | Choice | ReferenceOption)[];
  value: string | null;
  onChange: (value: string | null) => void;
  required?: boolean;
}) {
  const theme = useTheme();
  const normalized = options.map(option => ({
    value: 'value' in option ? option.value : option.id,
    label: option.label,
    icon: 'icon' in option ? option.icon : undefined,
    hint: 'hint' in option ? option.hint : undefined,
  }));
  return (
    <View style={styles.field} accessibilityLabel={label}>
      <FieldLabel label={label} required={required} />
      <View style={styles.rows}>
        {normalized.map(option => {
          const active = value === option.value;
          return (
            <Pressable key={option.value} onPress={() =>
                onChange(active && !required ? null : option.value)}
              accessibilityRole="button"
              accessibilityLabel={`${label}: ${option.label}`}
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: active ? theme.primarySurface : theme.backgroundElement,
                  borderColor: active ? theme.primary : theme.border,
                },
                pressed && styles.pressed,
              ]}>
              {option.icon ? (
                <View style={[styles.rowIcon, {
                  backgroundColor: active ? theme.primary : theme.background,
                }]}>
                  <Ionicons name={option.icon} size={18}
                    color={active ? '#fff' : theme.primary} />
                </View>
              ) : null}
              <View style={styles.rowCopy}>
                <ThemedText style={[styles.rowLabel, active && { color: theme.primary }]}>
                  {option.label}
                </ThemedText>
                {option.hint ? (
                  <ThemedText type="small" themeColor="textSecondary">{option.hint}</ThemedText>
                ) : null}
              </View>
              {active ? (
                <Ionicons name="checkmark-circle" size={20} color={theme.primary} />
              ) : (
                <View style={[styles.rowCircle, { borderColor: theme.border }]} />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Compact selection chips (with optional leading icons) for short option
 * lists and paired lifestyle questions.
 */
export function OptionChips({ label, options, value, onChange, required = false }: {
  label: string;
  options: (WizardOption | Choice | ReferenceOption)[];
  value: string | null;
  onChange: (value: string | null) => void;
  required?: boolean;
}) {
  const theme = useTheme();
  const normalized = options.map(option => ({
    value: 'value' in option ? option.value : option.id,
    label: option.label,
    icon: 'icon' in option ? option.icon : undefined,
  }));
  return (
    <View style={styles.field} accessibilityLabel={label}>
      <FieldLabel label={label} required={required} />
      <View style={styles.chips}>
        {normalized.map(option => {
          const active = value === option.value;
          return (
            <Pressable key={option.value} onPress={() =>
                onChange(active && !required ? null : option.value)}
              accessibilityRole="button"
              accessibilityLabel={`${label}: ${option.label}`}
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: active ? theme.primary : theme.backgroundElement,
                  borderColor: active ? theme.primary : theme.border,
                },
                pressed && styles.pressed,
              ]}>
              {option.icon ? (
                <Ionicons name={option.icon} size={15}
                  color={active ? '#fff' : theme.primary} />
              ) : null}
              <ThemedText style={[styles.chipText, active && styles.chipTextActive]}>
                {option.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Card-wrapped toggle for yes/no switches (distance, relocation, opt-in). */
export function ToggleCard({ icon, label, hint, value, onChange, disabled = false }: {
  icon: IconName;
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.toggleCard, {
      backgroundColor: theme.backgroundElement, borderColor: theme.border,
    }]}>
      <View style={[styles.toggleIcon, { backgroundColor: theme.primarySurface }]}
        accessibilityElementsHidden importantForAccessibility="no">
        <Ionicons name={icon} size={18} color={theme.primary} />
      </View>
      <View style={styles.toggleCopy}>
        <ThemedText style={styles.toggleLabel}>{label}</ThemedText>
        {hint ? (
          <ThemedText type="small" themeColor="textSecondary">{hint}</ThemedText>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled}
        trackColor={{ false: theme.border, true: theme.primary }}
        accessibilityLabel={label} />
    </View>
  );
}

/** Privacy microcopy with a lock icon, used below sensitive questions. */
export function PrivacyNote({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.note}>
      <Ionicons name="lock-closed-outline" size={14} color={theme.textSecondary} />
      <ThemedText type="small" themeColor="textSecondary" style={styles.noteText}>
        {children}
      </ThemedText>
    </View>
  );
}

/**
 * Fade-and-slide transition applied whenever the step changes. Uses the
 * built-in Animated API with the native driver — cheap and test-safe.
 */
export function StepTransition({ step, direction, children }: {
  step: number;
  direction: 1 | -1;
  children: React.ReactNode;
}) {
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [step, progress]);
  return (
    <Animated.View style={{
      flex: 1,
      opacity: progress,
      transform: [{
        translateX: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [direction * 28, 0],
        }),
      }],
    }}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.three, paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three, paddingBottom: Spacing.two,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  headerSide: { width: 76, alignItems: 'flex-start' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  brandLabel: { fontSize: 15, fontWeight: '700' },
  backButton: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  stageHeading: { flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: Spacing.one },
  stageTitle: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  segments: { flexDirection: 'row', gap: Spacing.one },
  segment: { flex: 1, height: 4, borderRadius: BorderRadius.full },
  segmentCurrent: { height: 6, marginTop: -1 },
  subProgress: { flexDirection: 'row', justifyContent: 'center', gap: 5,
    minHeight: 6, alignItems: 'center' },
  subSegment: { width: 6, height: 6, borderRadius: 3 },
  counter: { fontWeight: '600', width: 76, textAlign: 'right', flexShrink: 0 },
  completionHero: { width: 190, height: 170, alignSelf: 'center',
    alignItems: 'center', justifyContent: 'center' },
  completionRing: { position: 'absolute', borderRadius: BorderRadius.full },
  completionRingOuter: { width: 170, height: 170, opacity: 0.45 },
  completionRingInner: { width: 136, height: 136, opacity: 0.85 },
  completionCheck: { width: 104, height: 104, borderRadius: 52,
    alignItems: 'center', justifyContent: 'center' },
  question: { gap: Spacing.two, marginBottom: Spacing.four },
  questionIcon: {
    width: 52, height: 52, borderRadius: BorderRadius.lg,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.one,
  },
  questionTitle: { fontSize: 26, lineHeight: 32, fontWeight: '700', letterSpacing: -0.3 },
  questionDescription: { fontSize: 15, lineHeight: 22 },
  field: { gap: Spacing.two },
  fieldLabel: { fontSize: 15, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  gridItem: { flexBasis: '46%', flexGrow: 1 },
  gridItemWide: { flexBasis: '100%' },
  card: {
    borderWidth: 1.5, borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.four, paddingHorizontal: Spacing.three,
    alignItems: 'center', gap: Spacing.two, minHeight: 118,
    justifyContent: 'center',
  },
  cardIcon: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
  },
  cardLabel: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  cardHint: { textAlign: 'center' },
  cardCheck: {
    position: 'absolute', top: 8, right: 8,
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  rows: { gap: Spacing.two },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.three,
    borderWidth: 1.5, borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.three, paddingVertical: Spacing.three,
    minHeight: 56,
  },
  rowIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  rowCopy: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15, fontWeight: '600' },
  rowCircle: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 1.5,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.one,
    borderWidth: 1.5, borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three, paddingVertical: 10,
  },
  chipText: { fontSize: 14, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  toggleCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.three,
    borderWidth: 1, borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.three, paddingVertical: Spacing.three,
  },
  toggleIcon: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  toggleCopy: { flex: 1, gap: 2 },
  toggleLabel: { fontSize: 15, fontWeight: '600' },
  note: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  noteText: { flex: 1 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
});
